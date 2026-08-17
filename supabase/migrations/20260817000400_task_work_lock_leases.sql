-- Give `task_work_locks` a lease, so something can safely depend on it.
--
-- Phase 2E left goal 17 open deliberately and said why: the obvious way to
-- close it is to refuse a Phase 1C claim while another task holds a path lock
-- in the same project, and that would have been unsafe. `task_work_locks`
-- recorded `acquired_at` and `released_at` and nothing else — no expiry, no
-- heartbeat, no sweep — while its sibling `graph_work_locks` has all three. A
-- lock whose holder crashed, or whose task was cancelled between acquiring and
-- releasing, is held forever.
--
-- Today that leak is invisible, because nothing consults these locks when work
-- is scheduled. It stops being invisible the moment anything does, and turns
-- into a project that never schedules again with no error and nothing to clear
-- it. So the lease comes first and the gate comes after, in that order.
--
-- Three properties, matching what `graph_work_locks` already does:
--
--   A lock is held only while its lease is in the future. Expiry is not a
--   background job that might not be running — it is part of the predicate, so
--   an abandoned lock stops blocking at its expiry whether or not anything ever
--   sweeps it.
--
--   The holder extends its own lease by heartbeating. A worker that is alive
--   keeps its ground; one that stopped gives it up on a bounded clock.
--
--   The sweep exists anyway, to mark abandoned locks explicitly rather than
--   leaving rows that read as held to anyone querying the table directly.

alter table public.task_work_locks
  add column heartbeat_at timestamptz not null default now(),
  add column expires_at timestamptz not null default (now() + interval '15 minutes'),
  add column expired_at timestamptz;

alter table public.task_work_locks
  add constraint task_work_locks_expiry_after_acquisition
    check (expires_at > acquired_at),
  -- A lock cannot be both released by its holder and reclaimed as abandoned.
  -- Recording both would make the two outcomes indistinguishable afterwards,
  -- and they mean different things about the worker that held it.
  add constraint task_work_locks_one_ending
    check (released_at is null or expired_at is null);

comment on column public.task_work_locks.expires_at is
  'When this lock stops being held. Part of the conflict predicate, not merely a hint for a sweeper, so an abandoned lock releases its ground on a bounded clock even if nothing sweeps.';
comment on column public.task_work_locks.heartbeat_at is
  'Last time the holder said it was still working. Extending the lease is how a live holder keeps its ground.';
comment on column public.task_work_locks.expired_at is
  'Set by the sweep when a lease ran out without being released. Distinct from released_at: one is a worker finishing, the other is a worker vanishing.';

create index task_work_locks_live_idx
  on public.task_work_locks (project_id, expires_at)
  where released_at is null and expired_at is null;

-- ---------------------------------------------------------------------------
-- Acquisition, now leased
-- ---------------------------------------------------------------------------

create or replace function public.acquire_task_work_lock(
  p_project_id uuid,
  p_path_prefix text,
  p_task_id uuid,
  p_role public.agent_role,
  p_lease_seconds integer default 900
)
returns table (
  lock_id uuid,
  acquired boolean,
  conflicting_prefix text,
  conflicting_task_id uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  existing public.task_work_locks%rowtype;
  normalized text := btrim(p_path_prefix);
  bounded_lease integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
  new_id uuid;
  new_expiry timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = '42704', message = 'project not found';
  end if;
  if not public.is_organization_member(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  -- Serialize acquisition per project so two callers cannot both observe "no
  -- conflict" and both insert.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text, 0));

  -- Retire anything abandoned in the same statement that contends for it, so a
  -- dead holder never blocks a live one. This is the reason the whole migration
  -- exists.
  update public.task_work_locks
  set expired_at = now()
  where project_id = p_project_id
    and released_at is null and expired_at is null and expires_at <= now();

  select * into existing
  from public.task_work_locks
  where project_id = p_project_id
    and released_at is null
    and expired_at is null
    and expires_at > now()
    and (
      normalized like path_prefix || '%'
      or path_prefix like normalized || '%'
    )
  limit 1;

  if found then
    return query select null::uuid, false, existing.path_prefix, existing.held_by_task_id,
      null::timestamptz;
    return;
  end if;

  new_expiry := now() + pg_catalog.make_interval(secs => bounded_lease);
  insert into public.task_work_locks (
    organization_id, project_id, path_prefix, held_by_task_id, held_by_role,
    heartbeat_at, expires_at
  ) values (
    project_record.organization_id, p_project_id, normalized, p_task_id, p_role,
    now(), new_expiry
  )
  returning id into new_id;

  return query select new_id, true, null::text, null::uuid, new_expiry;
end;
$function$;

comment on function public.acquire_task_work_lock(uuid, text, uuid, public.agent_role, integer) is
  'Acquire a leased path-prefix lock. Conflicts on overlap in either direction, ignores expired leases, and retires abandoned ones in the statement that contends for them.';

-- ---------------------------------------------------------------------------
-- Heartbeat and sweep
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat_task_work_lock(
  p_lock_id uuid,
  p_lease_seconds integer default 900
)
returns table (extended boolean, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  lock_record public.task_work_locks%rowtype;
  bounded_lease integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into lock_record from public.task_work_locks where id = p_lock_id for update;
  if not found then
    return query select false, null::timestamptz;
    return;
  end if;
  if not public.is_organization_member(lock_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  -- A lease that already lapsed is not extended. Its ground may already have
  -- been taken by another task, and silently reviving it would produce exactly
  -- the double-assignment this table exists to prevent.
  if lock_record.released_at is not null
    or lock_record.expired_at is not null
    or lock_record.expires_at <= now() then
    return query select false, null::timestamptz;
    return;
  end if;

  update public.task_work_locks
  set heartbeat_at = now(),
    expires_at = now() + pg_catalog.make_interval(secs => bounded_lease)
  where id = p_lock_id
  returning * into lock_record;

  return query select true, lock_record.expires_at;
end;
$function$;

comment on function public.heartbeat_task_work_lock(uuid, integer) is
  'Extend a live lease. Refuses a lapsed one, because its ground may already have been taken.';

create or replace function public.expire_abandoned_task_work_locks(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  swept integer;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  update public.task_work_locks
  set expired_at = now()
  where organization_id = p_organization_id
    and released_at is null and expired_at is null and expires_at <= now();
  get diagnostics swept = row_count;
  return swept;
end;
$function$;

comment on function public.expire_abandoned_task_work_locks(uuid) is
  'Marks lapsed leases explicitly. Not required for correctness — expiry is in the conflict predicate — but it stops the table reading as held to anyone querying it directly.';

revoke all on function public.acquire_task_work_lock(
  uuid, text, uuid, public.agent_role, integer
) from public, anon, service_role;
revoke all on function public.heartbeat_task_work_lock(uuid, integer)
  from public, anon, service_role;
revoke all on function public.expire_abandoned_task_work_locks(uuid)
  from public, anon, service_role;

grant execute on function public.acquire_task_work_lock(
  uuid, text, uuid, public.agent_role, integer
) to authenticated;
grant execute on function public.heartbeat_task_work_lock(uuid, integer) to authenticated;
grant execute on function public.expire_abandoned_task_work_locks(uuid) to authenticated;

-- The unleased four-argument form is dropped rather than kept as an overload.
-- Two functions of the same name is a PostgREST routing hazard — `/rpc/<name>`
-- resolves by name — and `migration-object-collisions` asserts the schema holds
-- no overloaded public function.
drop function if exists public.acquire_task_work_lock(uuid, text, uuid, public.agent_role);
