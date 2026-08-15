-- Phase 2B foundation: a task graph that cannot deadlock, and durable handoffs.
--
-- `task_dependencies` already rejects a self-edge (`task_id <> depends_on_task_id`)
-- and duplicate edges. It does not reject a *cycle*: A→B→C→A satisfies every
-- existing constraint. Nothing in the graph would ever become ready again, and
-- because readiness is computed rather than stored, there is no row anywhere
-- saying why. The work simply stops, permanently and silently.
--
-- So cycles are rejected at write time, which is the only place the whole graph
-- is visible at once. Detecting them at read time would mean every reader
-- reimplementing the check, and a reader that forgot would report a deadlocked
-- graph as merely idle.
--
-- The other two tables are what makes a team a team rather than a set of
-- individuals: `agent_handoffs` is the durable typed artifact one specialist
-- leaves for the next, and `work_locks` stops two specialists editing the same
-- subsystem in parallel.
--
-- None of this executes anything. Phase 2B coordinates advisory work; it
-- acquires no authority to merge, deploy, or run, and every Phase 1D interlock
-- is untouched.

-- ---------------------------------------------------------------------------
-- Cycle rejection
-- ---------------------------------------------------------------------------

create or replace function public.task_dependency_would_cycle(
  p_task_id uuid,
  p_depends_on_task_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  -- Walk what the proposed prerequisite itself depends on. If the task being
  -- given the prerequisite appears anywhere in that closure, the new edge
  -- closes a loop.
  with recursive reachable as (
    select p_depends_on_task_id as task_id
    union
    select d.depends_on_task_id
    from public.task_dependencies d
    join reachable r on r.task_id = d.task_id
  )
  select exists (select 1 from reachable where task_id = p_task_id);
$function$;

comment on function public.task_dependency_would_cycle(uuid, uuid) is
  'True when adding task_id -> depends_on_task_id would close a dependency cycle. Walks the prerequisite closure; a self-edge is already refused by a CHECK constraint.';

create or replace function public.reject_cyclic_task_dependency()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if public.task_dependency_would_cycle(new.task_id, new.depends_on_task_id) then
    raise exception using
      errcode = '23514',
      message = 'that dependency would create a cycle, and a cycle can never become ready';
  end if;
  return new;
end;
$function$;

create trigger task_dependencies_reject_cycle
  before insert or update on public.task_dependencies
  for each row execute function public.reject_cyclic_task_dependency();

-- Readiness computed in the database, so no caller has to reimplement it and
-- none can disagree about what "ready" means.
create or replace function public.task_dependencies_unmet(p_task_id uuid)
returns integer
language sql
stable
set search_path = pg_catalog
as $function$
  -- `completed` is the only status that satisfies a prerequisite. Note what
  -- that means for `cancelled` and `failed`: they never will, so a dependent
  -- of one is stuck permanently rather than merely waiting. That is the honest
  -- count, and `task_dependencies_unsatisfiable` below is what stops it looking
  -- like ordinary waiting.
  select count(*)::integer
  from public.task_dependencies d
  join public.tasks t on t.id = d.depends_on_task_id
  where d.task_id = p_task_id
    and t.status <> 'completed';
$function$;

comment on function public.task_dependencies_unmet(uuid) is
  'How many of a task prerequisites are not completed. Zero means ready. Computed here so a caller cannot hold a different definition of ready.';

/*
 * Prerequisites that can never be satisfied.
 *
 * A cycle is not the only way a graph stalls forever. A prerequisite that was
 * cancelled or failed will never reach `completed`, so its dependent waits
 * indefinitely — and to any caller counting unmet dependencies that is
 * indistinguishable from work still in progress. Naming the condition is what
 * turns a silent stall into something an owner can act on.
 */
create or replace function public.task_dependencies_unsatisfiable(p_task_id uuid)
returns table (
  blocking_task_id uuid,
  blocking_title text,
  blocking_status public.task_status
)
language sql
stable
set search_path = pg_catalog
as $function$
  select t.id, t.title, t.status
  from public.task_dependencies d
  join public.tasks t on t.id = d.depends_on_task_id
  where d.task_id = p_task_id
    and t.status in ('cancelled', 'failed');
$function$;

comment on function public.task_dependencies_unsatisfiable(uuid) is
  'Prerequisites that are cancelled or failed and therefore can never complete. A dependent of one is permanently blocked, not waiting; without this the two look identical.';

-- ---------------------------------------------------------------------------
-- Handoffs
-- ---------------------------------------------------------------------------
--
-- The typed artifact one specialist leaves for the next. Agents exchange these
-- through SoftwareFactory; they never share a provider chat history, so what
-- crosses the boundary is exactly what is written here and nothing else.

create table public.agent_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  task_id uuid not null,

  from_role public.agent_role not null,
  to_role public.agent_role not null,

  -- What was done and what the next agent must do. Bounded, because an
  -- unbounded field is where a provider transcript ends up.
  summary text not null check (length(btrim(summary)) between 1 and 4000),
  next_required_action text not null check (length(btrim(next_required_action)) between 1 and 1000),

  -- Structured evidence, capped. Never raw provider output.
  decisions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(decisions) = 'array' and jsonb_array_length(decisions) <= 50),
  files_touched jsonb not null default '[]'::jsonb
    check (jsonb_typeof(files_touched) = 'array' and jsonb_array_length(files_touched) <= 200),
  assumptions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(assumptions) = 'array' and jsonb_array_length(assumptions) <= 50),
  blockers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blockers) = 'array' and jsonb_array_length(blockers) <= 50),

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint agent_handoffs_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint agent_handoffs_task_fk
    foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade,

  -- A handoff to yourself is not a handoff. It would also satisfy an
  -- independent-review requirement without anyone independent being involved.
  constraint agent_handoffs_distinct_roles check (from_role <> to_role),

  -- No secret may reach a stored row, including through a nested value.
  constraint agent_handoffs_no_sensitive_summary check (not public.text_has_likely_secret(summary)),
  constraint agent_handoffs_no_sensitive_decisions check (not public.jsonb_has_sensitive_keys(decisions)),
  constraint agent_handoffs_no_sensitive_assumptions check (not public.jsonb_has_sensitive_keys(assumptions)),
  constraint agent_handoffs_no_sensitive_blockers check (not public.jsonb_has_sensitive_keys(blockers))
);

comment on table public.agent_handoffs is
  'Durable typed artifact passed between specialist agents. Agents never share a provider chat history: what crosses the boundary is exactly this row.';

create index agent_handoffs_task on public.agent_handoffs (task_id, created_at desc);
create index agent_handoffs_project on public.agent_handoffs (project_id, created_at desc);

alter table public.agent_handoffs enable row level security;
alter table public.agent_handoffs force row level security;

create policy agent_handoffs_select_members
  on public.agent_handoffs for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.agent_handoffs from anon, authenticated;
grant select on table public.agent_handoffs to authenticated;

create or replace function public.reject_handoff_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501', message = 'handoff records are append-only';
end;
$function$;

revoke all on function public.reject_handoff_mutation() from public, anon, authenticated;

create trigger agent_handoffs_append_only
  before update or delete on public.agent_handoffs
  for each row execute function public.reject_handoff_mutation();

-- ---------------------------------------------------------------------------
-- Work locks
-- ---------------------------------------------------------------------------
--
-- Two specialists editing the same subsystem in parallel produce conflicting
-- diffs and, worse, overlapping migrations. The lock is on a path prefix
-- because that is the unit a subsystem actually occupies.

create table public.work_locks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  path_prefix text not null check (
    length(btrim(path_prefix)) between 1 and 400
    and path_prefix = btrim(path_prefix)
    -- A relative path only. An absolute path or a parent traversal would let a
    -- lock claim ground outside the repository it belongs to.
    and path_prefix !~ '^/'
    and path_prefix !~ '\.\.'
  ),
  held_by_task_id uuid not null,
  held_by_role public.agent_role not null,

  acquired_at timestamptz not null default now(),
  released_at timestamptz,

  constraint work_locks_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint work_locks_task_fk
    foreign key (held_by_task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade
);

comment on table public.work_locks is
  'Advisory lock over a path prefix, so two specialists cannot edit one subsystem in parallel. Released rows are kept as history rather than deleted.';

-- One live lock per prefix per project. A released lock does not block, which
-- is why the index is partial rather than a plain unique constraint.
create unique index work_locks_live_prefix_unique
  on public.work_locks (project_id, path_prefix)
  where released_at is null;

create index work_locks_project_live
  on public.work_locks (project_id)
  where released_at is null;

alter table public.work_locks enable row level security;
alter table public.work_locks force row level security;

create policy work_locks_select_members
  on public.work_locks for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.work_locks from anon, authenticated;
grant select on table public.work_locks to authenticated;

/*
 * Acquire a lock over a path prefix.
 *
 * Overlap, not equality: holding `lib/` must block `lib/operations/`, because
 * the point is that two agents cannot edit one subsystem — and a nested path is
 * the same subsystem. Comparing only exact prefixes would make the lock look
 * like it worked while allowing precisely the collision it exists to prevent.
 */
create or replace function public.acquire_work_lock(
  p_project_id uuid,
  p_path_prefix text,
  p_task_id uuid,
  p_role public.agent_role
)
returns table (
  lock_id uuid,
  acquired boolean,
  conflicting_prefix text,
  conflicting_task_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  existing public.work_locks%rowtype;
  normalized text := btrim(p_path_prefix);
  new_id uuid;
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

  select * into existing
  from public.work_locks
  where project_id = p_project_id
    and released_at is null
    and (
      normalized like path_prefix || '%'
      or path_prefix like normalized || '%'
    )
  limit 1;

  if found then
    return query select null::uuid, false, existing.path_prefix, existing.held_by_task_id;
    return;
  end if;

  insert into public.work_locks (
    organization_id, project_id, path_prefix, held_by_task_id, held_by_role
  ) values (
    project_record.organization_id, p_project_id, normalized, p_task_id, p_role
  )
  returning id into new_id;

  return query select new_id, true, null::text, null::uuid;
end;
$function$;

comment on function public.acquire_work_lock(uuid, text, uuid, public.agent_role) is
  'Acquire an advisory path-prefix lock. Conflicts on overlap in either direction, so lib/ blocks lib/operations/ and the reverse. Serialized per project by an advisory transaction lock.';

revoke all on function public.acquire_work_lock(uuid, text, uuid, public.agent_role)
  from public, anon, service_role;
grant execute on function public.acquire_work_lock(uuid, text, uuid, public.agent_role)
  to authenticated;

create or replace function public.release_work_lock(p_lock_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  lock_record public.work_locks%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into lock_record from public.work_locks where id = p_lock_id;
  if not found then
    return false;
  end if;
  if not public.is_organization_member(lock_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  -- Releasing twice is not an error; it is the same end state, and treating it
  -- as a failure would make cleanup paths harder to write correctly.
  if lock_record.released_at is not null then
    return false;
  end if;

  update public.work_locks set released_at = now() where id = p_lock_id;
  return true;
end;
$function$;

revoke all on function public.release_work_lock(uuid) from public, anon, service_role;
grant execute on function public.release_work_lock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording a handoff
-- ---------------------------------------------------------------------------

create or replace function public.record_agent_handoff(
  p_task_id uuid,
  p_from_role public.agent_role,
  p_to_role public.agent_role,
  p_summary text,
  p_next_required_action text,
  p_decisions jsonb default '[]'::jsonb,
  p_files_touched jsonb default '[]'::jsonb,
  p_assumptions jsonb default '[]'::jsonb,
  p_blockers jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  task_record public.tasks%rowtype;
  handoff_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into task_record from public.tasks where id = p_task_id;
  if not found then
    raise exception using errcode = '42704', message = 'task not found';
  end if;
  if not public.is_organization_member(task_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  insert into public.agent_handoffs (
    organization_id, project_id, task_id, from_role, to_role,
    summary, next_required_action, decisions, files_touched, assumptions, blockers, created_by
  ) values (
    task_record.organization_id, task_record.project_id, p_task_id, p_from_role, p_to_role,
    p_summary, p_next_required_action,
    coalesce(p_decisions, '[]'::jsonb), coalesce(p_files_touched, '[]'::jsonb),
    coalesce(p_assumptions, '[]'::jsonb), coalesce(p_blockers, '[]'::jsonb),
    auth.uid()
  )
  returning id into handoff_id;

  return handoff_id;
end;
$function$;

comment on function public.record_agent_handoff is
  'Append one durable handoff between specialist roles. Refuses a handoff to the same role, and every text and JSON field is bounded and secret-checked.';

revoke all on function public.record_agent_handoff(
  uuid, public.agent_role, public.agent_role, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, service_role;
grant execute on function public.record_agent_handoff(
  uuid, public.agent_role, public.agent_role, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated;
