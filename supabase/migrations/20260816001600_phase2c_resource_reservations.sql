-- Phase 2C: make the concurrency and rate limits survive a restart, and hold
-- across processes.
--
-- `lib/resources/capacity.ts`, `dispatch.ts` and `rate-limits.ts` are pure
-- functions over a reservation set and a rate window the caller owns. That was
-- honest -- the plan says "in-process; not yet persisted" -- but it leaves two
-- real holes, and the second is the serious one:
--
--   1. A restart forgets every held slot, so the fleet can exceed its limit
--      immediately after a deploy, which is exactly when it is least watched.
--   2. Two processes each keep their own list. Each sees one free slot, each
--      admits, and the limit is exceeded by however many processes are running.
--      No amount of care in TypeScript fixes this: the check and the take have
--      to happen in one place that both can see, atomically.
--
-- So enforcement lives here, in the same statement that records the take. A
-- table that merely *stored* reservations while TypeScript still decided would
-- have all the cost of persistence and none of the safety.
--
-- What is deliberately NOT here: the limit values themselves. They are passed
-- in from `lib/resources/capacity.ts` and `rate-limits.ts`, exactly as the
-- breaker thresholds are passed into `record_resource_breaker_fault`, so the
-- rule that decides when work is refused has one home rather than two that can
-- drift apart.
--
-- Neither table grants `service_role` anything, and the browser gets SELECT
-- only: every write goes through a SECURITY DEFINER function below.

-- ---------------------------------------------------------------------------
-- Held slots
-- ---------------------------------------------------------------------------

create table public.resource_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  -- Free-form for the same reason `resource_breakers.target` is: the catalogue
  -- is code, and pinning an enum here means a migration per model.
  agent_id text not null check (
    length(btrim(agent_id)) between 1 and 200
    and agent_id = btrim(agent_id)
    and not public.text_has_likely_secret(agent_id)
  ),
  provider text not null check (
    length(btrim(provider)) between 1 and 128
    and not public.text_has_likely_secret(provider)
  ),
  model text not null check (
    length(btrim(model)) between 1 and 128
    and not public.text_has_likely_secret(model)
  ),

  -- The routed unit of work, so a leaked slot can be traced to what took it.
  -- Not a foreign key, for the same reason `resource_assignments.node_id` is
  -- not: a Phase 2B graph node must be able to reuse it without a migration.
  node_id uuid,

  acquired_at timestamptz not null default now(),

  -- Every reservation expires. A lease released only on success leaks a slot
  -- every time a worker dies, and the fleet quietly throttles itself to a halt
  -- with nothing to point at. This is the same reasoning as an expired work
  -- lock being retired by the statement that contends for it.
  expires_at timestamptz not null,

  -- Set when the slot is given back. Kept rather than deleted so a released
  -- reservation remains visible as evidence for as long as the row is retained.
  released_at timestamptz,

  constraint resource_reservations_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,

  constraint resource_reservations_expires_after_acquire check (expires_at > acquired_at),
  constraint resource_reservations_released_after_acquire check (
    released_at is null or released_at >= acquired_at
  )
);

comment on table public.resource_reservations is
  'One held concurrency slot. Counted while unreleased and unexpired; the acquire function enforces the per-worker, per-provider and per-project limits atomically so two processes cannot both take the last slot.';
comment on column public.resource_reservations.expires_at is
  'Every lease expires. A slot released only on success leaks whenever a worker dies, and the fleet throttles itself with nothing to point at.';

-- The index the admission count actually uses: live rows for one organization.
create index resource_reservations_live
  on public.resource_reservations (organization_id, expires_at)
  where released_at is null;
create index resource_reservations_project_recent
  on public.resource_reservations (project_id, acquired_at desc);

alter table public.resource_reservations enable row level security;
alter table public.resource_reservations force row level security;

create policy resource_reservations_select_members
  on public.resource_reservations for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.resource_reservations from anon, authenticated;
grant select on table public.resource_reservations to authenticated;

-- ---------------------------------------------------------------------------
-- The rate window
-- ---------------------------------------------------------------------------

create table public.resource_rate_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  provider text not null check (
    length(btrim(provider)) between 1 and 128
    and not public.text_has_likely_secret(provider)
  ),

  requested_at timestamptz not null default now(),

  tokens integer not null default 0 check (tokens >= 0),

  -- Whether `tokens` is a prediction or a measurement. The real count is only
  -- known after the call, so an admission has to be decided against an
  -- estimate -- but an estimate recorded as though it were a measurement is
  -- the same error as inventing a success rate for a worker with no history,
  -- which this subsystem already refuses to make.
  estimated boolean not null default true,

  reservation_id uuid references public.resource_reservations(id) on delete set null
);

comment on table public.resource_rate_events is
  'One provider request inside the sliding rate window. Rows outside the window are pruned by the acquire function, so retention is bounded by the window rather than by uptime.';
comment on column public.resource_rate_events.estimated is
  'True until the provider reports the real token count. Usage built from estimates is reported as estimated rather than as measured.';

create index resource_rate_events_window
  on public.resource_rate_events (organization_id, provider, requested_at desc);

alter table public.resource_rate_events enable row level security;
alter table public.resource_rate_events force row level security;

create policy resource_rate_events_select_members
  on public.resource_rate_events for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.resource_rate_events from anon, authenticated;
grant select on table public.resource_rate_events to authenticated;

-- ---------------------------------------------------------------------------
-- Acquire: check and take, in one statement both processes can see
-- ---------------------------------------------------------------------------

create or replace function public.acquire_resource_reservation(
  p_project_id uuid,
  p_agent_id text,
  p_provider text,
  p_model text,
  p_lease_seconds integer,
  p_max_per_worker integer,
  p_max_per_provider integer,
  p_max_per_project integer,
  p_node_id uuid default null,
  p_rate_window_seconds integer default null,
  p_max_requests_per_window integer default null,
  p_max_tokens_per_window integer default null,
  p_estimated_tokens integer default 0
)
returns table (
  admitted boolean,
  refusal text,
  reservation_id uuid,
  retry_after_ms integer,
  worker_in_use integer,
  provider_in_use integer,
  project_in_use integer,
  requests_in_window integer,
  tokens_in_window integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_refusal text := null;
  v_retry_after_ms integer := null;
  v_reservation_id uuid := null;
  v_worker integer := 0;
  v_provider integer := 0;
  v_project integer := 0;
  v_requests integer := 0;
  v_tokens integer := 0;
  v_oldest timestamptz;
  v_freed integer;
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

  if p_lease_seconds is null or p_lease_seconds < 1 then
    raise exception using errcode = '22023', message = 'lease seconds must be at least 1';
  end if;

  -- A limit of zero is refused rather than treated as "unlimited". It reads as
  -- "no restriction" to about half the people who see it and "nothing may run"
  -- to the other half, and those are opposites -- so it cannot be written at
  -- all, and whoever wants either must say which. `validateLimits` refuses the
  -- same value in TypeScript; this is the boundary that cannot be bypassed.
  if coalesce(p_max_per_worker, 0) < 1
     or coalesce(p_max_per_provider, 0) < 1
     or coalesce(p_max_per_project, 0) < 1 then
    raise exception using errcode = '22023',
      message = 'every capacity limit must be at least 1; 0 is ambiguous between unlimited and nothing may run';
  end if;

  -- Serialize admission for this organization.
  --
  -- Counting rows does not lock them, so without this two concurrent
  -- transactions both count one free slot and both insert -- the exact defect
  -- persistence is here to close. The lock is per organization rather than per
  -- worker because the three limits span different groupings (a per-worker lock
  -- cannot make the per-provider count safe), and admission is infrequent
  -- relative to the work it admits, so correctness is worth more here than
  -- concurrency between two admissions in the same tenant.
  perform pg_advisory_xact_lock(
    hashtextextended('resource_capacity:' || project_record.organization_id::text, 0)
  );

  -- Retire what has aged out before counting. Expired rows are marked released
  -- rather than deleted, so a leaked slot stays visible as evidence of the
  -- worker that failed to give it back.
  update public.resource_reservations
     set released_at = v_now
   where organization_id = project_record.organization_id
     and released_at is null
     and expires_at <= v_now;

  select
    count(*) filter (where r.agent_id = p_agent_id and r.provider = p_provider and r.model = p_model),
    count(*) filter (where r.provider = p_provider),
    count(*) filter (where r.project_id = p_project_id)
  into v_worker, v_provider, v_project
  from public.resource_reservations r
  where r.organization_id = project_record.organization_id
    and r.released_at is null;

  -- Narrowest limit first, so the reported reason is the most specific one that
  -- applies. Told "the project is full" when a single worker is the real
  -- constraint, an operator raises the wrong number and the real limit refuses
  -- again immediately.
  if v_worker >= p_max_per_worker then
    v_refusal := 'WORKER_AT_CAPACITY';
  elsif v_provider >= p_max_per_provider then
    v_refusal := 'PROVIDER_AT_CAPACITY';
  elsif v_project >= p_max_per_project then
    v_refusal := 'PROJECT_AT_CAPACITY';
  end if;

  -- Rate is a separate question from capacity, not a stricter version of it.
  -- Concurrency asks whether a slot is free; rate asks whether too much has
  -- happened recently. Short calls satisfy a concurrency cap continuously while
  -- still exceeding a per-minute limit, so one does not imply the other.
  if v_refusal is null and p_rate_window_seconds is not null then
    v_window_start := v_now - make_interval(secs => p_rate_window_seconds);

    -- Prune here so retention is bounded by the window rather than by uptime.
    delete from public.resource_rate_events
     where organization_id = project_record.organization_id
       and requested_at <= v_window_start;

    select count(*), coalesce(sum(e.tokens), 0)
      into v_requests, v_tokens
      from public.resource_rate_events e
     where e.organization_id = project_record.organization_id
       and e.provider = p_provider
       and e.requested_at > v_window_start;

    if p_max_requests_per_window is not null and v_requests >= p_max_requests_per_window then
      v_refusal := 'REQUEST_RATE_EXCEEDED';

      -- A rate refusal can say when it clears, and a capacity refusal cannot:
      -- a window drains at a computable time, whereas nobody can predict when
      -- another run will finish.
      select min(e.requested_at) into v_oldest
        from public.resource_rate_events e
       where e.organization_id = project_record.organization_id
         and e.provider = p_provider
         and e.requested_at > v_window_start;

      if v_oldest is not null then
        v_retry_after_ms := greatest(
          0,
          (extract(epoch from (v_oldest + make_interval(secs => p_rate_window_seconds) - v_now)) * 1000)::integer
        );
      end if;

    elsif p_max_tokens_per_window is not null
      and v_tokens + coalesce(p_estimated_tokens, 0) > p_max_tokens_per_window then
      v_refusal := 'TOKEN_RATE_EXCEEDED';

      -- For tokens the wait is not simply "when the oldest ages out": events
      -- are retired oldest-first until the freed tokens cover the shortfall.
      -- Reporting the oldest would under-report the wait and produce a caller
      -- that retries too early, repeatedly -- a backoff that is really a hot
      -- loop.
      v_freed := v_tokens + coalesce(p_estimated_tokens, 0) - p_max_tokens_per_window;

      select r.requested_at into v_oldest
        from (
          select e.requested_at,
                 sum(e.tokens) over (order by e.requested_at, e.id) as running
            from public.resource_rate_events e
           where e.organization_id = project_record.organization_id
             and e.provider = p_provider
             and e.requested_at > v_window_start
        ) r
       where r.running >= v_freed
       order by r.requested_at
       limit 1;

      if v_oldest is not null then
        v_retry_after_ms := greatest(
          0,
          (extract(epoch from (v_oldest + make_interval(secs => p_rate_window_seconds) - v_now)) * 1000)::integer
        );
      end if;
    end if;
  end if;

  if v_refusal is null then
    insert into public.resource_reservations (
      organization_id, project_id, agent_id, provider, model, node_id, acquired_at, expires_at
    ) values (
      project_record.organization_id, p_project_id, p_agent_id, p_provider, p_model, p_node_id,
      v_now, v_now + make_interval(secs => p_lease_seconds)
    )
    returning id into v_reservation_id;

    if p_rate_window_seconds is not null then
      insert into public.resource_rate_events (
        organization_id, provider, requested_at, tokens, estimated, reservation_id
      ) values (
        project_record.organization_id, p_provider, v_now,
        coalesce(p_estimated_tokens, 0), true, v_reservation_id
      );
    end if;
  end if;

  return query select
    v_refusal is null,
    v_refusal,
    v_reservation_id,
    v_retry_after_ms,
    v_worker,
    v_provider,
    v_project,
    v_requests,
    v_tokens;
end;
$function$;

comment on function public.acquire_resource_reservation is
  'Atomically decide and take one concurrency slot. Enforces the per-worker, per-provider and per-project limits plus the sliding rate window under an advisory lock, so two concurrent callers cannot both take the last slot. A refusal names which limit refused, and a rate refusal reports when it clears.';

revoke all on function public.acquire_resource_reservation(
  uuid, text, text, text, integer, integer, integer, integer, uuid, integer, integer, integer, integer
) from public, anon, service_role;
grant execute on function public.acquire_resource_reservation(
  uuid, text, text, text, integer, integer, integer, integer, uuid, integer, integer, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Release: give the slot back
-- ---------------------------------------------------------------------------

create or replace function public.release_resource_reservation(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  reservation_record public.resource_reservations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into reservation_record
    from public.resource_reservations
   where id = p_reservation_id
   for update;

  if not found then
    raise exception using errcode = '42704', message = 'reservation not found';
  end if;

  if not public.is_organization_member(reservation_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  -- Releasing an already-released reservation returns false rather than
  -- raising. A worker that died after its lease expired and is then reported
  -- complete hits this on the happy path of a recovery; the expiry already did
  -- the right thing, and throwing would turn a clean recovery into an error.
  if reservation_record.released_at is not null then
    return false;
  end if;

  update public.resource_reservations
     set released_at = now()
   where id = p_reservation_id;

  return true;
end;
$function$;

comment on function public.release_resource_reservation is
  'Give back one held slot. Returns false rather than raising when the slot was already released or expired, because that is the normal shape of a recovery.';

revoke all on function public.release_resource_reservation(uuid) from public, anon, service_role;
grant execute on function public.release_resource_reservation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settle: replace an estimate with what the provider actually reported
-- ---------------------------------------------------------------------------

create or replace function public.settle_resource_rate_event(
  p_reservation_id uuid,
  p_actual_tokens integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  reservation_record public.resource_reservations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if p_actual_tokens is null or p_actual_tokens < 0 then
    raise exception using errcode = '22023', message = 'actual tokens must be zero or more';
  end if;

  select * into reservation_record
    from public.resource_reservations
   where id = p_reservation_id;

  if not found then
    raise exception using errcode = '42704', message = 'reservation not found';
  end if;

  if not public.is_organization_member(reservation_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  -- An event already pruned out of the window is not resurrected: it no longer
  -- counts toward anything, so correcting it would change nothing except to
  -- make the window disagree with itself.
  update public.resource_rate_events
     set tokens = p_actual_tokens,
         estimated = false
   where reservation_id = p_reservation_id
     and estimated;

  return found;
end;
$function$;

comment on function public.settle_resource_rate_event is
  'Replace an estimated token count with the measurement the provider reported, so the window stops reporting itself as estimated.';

revoke all on function public.settle_resource_rate_event(uuid, integer) from public, anon, service_role;
grant execute on function public.settle_resource_rate_event(uuid, integer) to authenticated;
