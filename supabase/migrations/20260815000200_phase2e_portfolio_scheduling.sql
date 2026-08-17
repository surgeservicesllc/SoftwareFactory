-- Phase 2E: portfolio resource optimization — durable scheduling state.
--
-- What was already true before this migration, and is worth stating so nobody
-- builds a second scheduler beside the working one:
--
--   `public.claim_phase1c_run` is already a durable, deterministic, lease-based
--   scheduler. It reclaims stale leases, refuses runs with incomplete
--   dependencies, refuses a second concurrent run for one agent, requires a
--   connected installation and a selected repository, and orders by
--   `task.priority desc, run.created_at asc`.
--
-- What was missing is everything *portfolio* about it. Ordering by task
-- priority alone means a P3 chore in one project outranks feature work in a
-- project the owner has declared critical, because the two projects have no
-- relative standing. There is also no notion of capacity: concurrency was
-- bounded only by how many workers happened to be registered, so a single
-- project could consume the whole factory.
--
-- This migration adds the state that a portfolio scheduler needs, and nothing
-- that executes anything. Selection itself is changed in the migration that
-- follows, against the state defined here.
--
-- Two rules held throughout:
--
--   Scheduling is arithmetic, not judgement. Every decision below is a pure
--   function of stored rows and `now()`. No model is consulted, so scheduling
--   costs nothing per decision and produces the same answer twice.
--
--   Nothing here grants a browser a write. Authenticated sessions hold SELECT
--   only; every mutation is a SECURITY DEFINER function that checks ownership
--   against the caller's own JWT.

-- ---------------------------------------------------------------------------
-- Portfolio limits, on the organization
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column maximum_concurrent_runs smallint not null default 4,
  add column emergency_reserved_runs smallint not null default 1,
  add column fairness_promotion_seconds integer not null default 900;

alter table public.organizations
  add constraint organizations_maximum_concurrent_runs_bounded
    check (maximum_concurrent_runs between 0 and 64),
  -- Reserved slots are carved *out of* the global limit, never added to it.
  -- Allowing a reserve larger than the limit would mean ordinary work could
  -- never start at all, which is a configuration that looks like an outage.
  add constraint organizations_emergency_reserve_within_limit
    check (emergency_reserved_runs between 0 and maximum_concurrent_runs),
  add constraint organizations_fairness_promotion_bounded
    check (fairness_promotion_seconds between 60 and 86400);

comment on column public.organizations.maximum_concurrent_runs is
  'Portfolio-wide ceiling on concurrently leased runs. Zero halts all engineering.';
comment on column public.organizations.emergency_reserved_runs is
  'Slots inside the ceiling that only effective-P0 work may occupy, so an incident is never queued behind routine work that arrived first.';
comment on column public.organizations.fairness_promotion_seconds is
  'A queued item improves one priority tier per interval of waiting. This is the anti-starvation guarantee: any queued work reaches P1 in bounded time.';

-- ---------------------------------------------------------------------------
-- Project scheduling state
-- ---------------------------------------------------------------------------

alter table public.projects
  add column engineering_priority smallint not null default 2,
  add column strategic_focus boolean not null default false,
  add column engineering_paused boolean not null default false,
  add column engineering_paused_at timestamptz,
  add column engineering_paused_by uuid references auth.users(id) on delete set null,
  add column engineering_pause_reason text,
  add column maximum_concurrent_runs smallint not null default 2;

alter table public.projects
  -- 0 = P0 … 3 = P3. Lower is more urgent, matching the goal's own numbering
  -- and letting `order by` read in the obvious direction.
  add constraint projects_engineering_priority_bounded
    check (engineering_priority between 0 and 3),
  add constraint projects_maximum_concurrent_runs_bounded
    check (maximum_concurrent_runs between 0 and 32),
  -- A pause with no record of who paused it or why is an unexplained outage
  -- three weeks later. A resume must clear all three together, so a stale
  -- reason cannot outlive the pause it described.
  add constraint projects_engineering_pause_is_explained check (
    (engineering_paused
      and engineering_paused_at is not null
      and engineering_pause_reason is not null)
    or (not engineering_paused
      and engineering_paused_at is null
      and engineering_paused_by is null
      and engineering_pause_reason is null)
  ),
  add constraint projects_engineering_pause_reason_bounded check (
    engineering_pause_reason is null or (
      char_length(btrim(engineering_pause_reason)) between 1 and 400
      and not public.text_has_likely_secret(engineering_pause_reason)
    )
  );

comment on column public.projects.engineering_priority is
  'P0 (0) critical incident/security, P1 (1) critical product/reliability, P2 (2) normal, P3 (3) optimization. Owner-set through set_project_engineering_priority.';
comment on column public.projects.strategic_focus is
  'Owner focus. Worth one priority tier and wins ties, but can never manufacture P0: only an incident or security policy reaches the emergency reserve.';
comment on column public.projects.engineering_paused is
  'Stops the scheduler assigning new work without archiving the project or disturbing work already running.';
comment on column public.projects.maximum_concurrent_runs is
  'Ceiling on concurrently leased runs for this project, so one project cannot consume the portfolio.';

create index projects_scheduling_idx
  on public.projects (organization_id, engineering_priority, strategic_focus)
  where status = 'active' and not engineering_paused;

-- ---------------------------------------------------------------------------
-- Worker capacity
-- ---------------------------------------------------------------------------

alter table public.phase1c_workers
  add column maximum_concurrent_runs smallint not null default 1;

alter table public.phase1c_workers
  add constraint phase1c_workers_maximum_concurrent_runs_bounded
    check (maximum_concurrent_runs between 1 and 8);

comment on column public.phase1c_workers.maximum_concurrent_runs is
  'How many leases this worker may hold at once. Capacity is measured from live leases in agent_runs rather than from current_run_id, so a crashed worker stops consuming capacity the moment its lease expires.';

-- ---------------------------------------------------------------------------
-- Provider and account concurrency limits
-- ---------------------------------------------------------------------------

-- A subscription-authenticated provider account has its own concurrency
-- ceiling, unrelated to how many workers exist locally. Exceeding it is how a
-- factory gets itself rate-limited, which then trips the 2C breaker and takes
-- the provider out entirely — a self-inflicted outage worth one small table.
create table public.provider_capacity_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),

  -- Null means the provider account as a whole. A row naming a connection
  -- narrows the limit to work bound to that connection.
  connection_id uuid,

  maximum_concurrent_runs smallint not null default 2
    check (maximum_concurrent_runs between 0 and 32),

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint provider_capacity_limits_connection_fk
    foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete cascade
);

comment on table public.provider_capacity_limits is
  'Per-provider and per-connection concurrency ceilings. Absent rows mean unlimited by this table; the project and portfolio ceilings still apply.';

-- Two partial uniques rather than one: a null connection_id is the account-wide
-- row and must be unique on its own, which a plain unique constraint would not
-- enforce because nulls never collide.
create unique index provider_capacity_limits_account_unique
  on public.provider_capacity_limits (organization_id, provider)
  where connection_id is null;
create unique index provider_capacity_limits_connection_unique
  on public.provider_capacity_limits (organization_id, provider, connection_id)
  where connection_id is not null;

alter table public.provider_capacity_limits enable row level security;
alter table public.provider_capacity_limits force row level security;

create policy provider_capacity_limits_select_members
  on public.provider_capacity_limits for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.provider_capacity_limits from anon, authenticated, service_role;
grant select on table public.provider_capacity_limits to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling decisions, append-only
-- ---------------------------------------------------------------------------

-- Goal 27 asks for queue ordering and reason to be visible and auditable, and
-- goal 28 for every assignment to record project/task/agent/provider/connection
-- and reason. `resource_assignments` (2C) records a *routing* decision — which
-- model for which graph node. This records a *scheduling* decision — which unit
-- of portfolio work for which worker, and what it was weighed against.
create table public.scheduling_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,

  decision text not null check (decision in ('assigned', 'withheld')),

  -- Present on an assignment. A withheld decision names the project whose work
  -- was held back, and may have no run yet.
  project_id uuid,
  run_id uuid,
  task_id uuid,
  agent_id uuid,
  connection_id uuid,

  worker_id text not null check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  provider text not null check (provider in ('openai', 'anthropic')),
  model text not null check (
    char_length(btrim(model)) between 1 and 120
    and not public.text_has_likely_secret(model)
  ),

  effective_priority smallint check (effective_priority between 0 and 3),

  -- Why this work and not other work, in a generated sentence. Never a provider
  -- message and never free text from a caller.
  reason text not null check (
    char_length(btrim(reason)) between 1 and 400
    and not public.text_has_likely_secret(reason)
  ),

  -- The counts and limits the decision was made against, so a decision can be
  -- re-checked later without re-deriving state that has since moved on.
  capacity jsonb not null default '{}'::jsonb check (
    jsonb_typeof(capacity) = 'object'
    and not public.jsonb_has_sensitive_keys(capacity)
  ),

  occurred_at timestamptz not null default now(),

  constraint scheduling_decisions_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint scheduling_decisions_run_fk foreign key (run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,

  -- An assignment that names no run did not assign anything. Recording one
  -- would inflate every throughput number computed from this table.
  constraint scheduling_decisions_assignment_is_complete check (
    decision <> 'assigned' or (
      project_id is not null and run_id is not null and task_id is not null
      and agent_id is not null and effective_priority is not null
    )
  )
);

comment on table public.scheduling_decisions is
  'Append-only record of portfolio scheduling: what was assigned to which worker and why, and which work was withheld by which ceiling. Withheld rows are deduplicated per minute so an idle poll loop cannot flood the audit.';

create index scheduling_decisions_recent_idx
  on public.scheduling_decisions (organization_id, occurred_at desc);
create index scheduling_decisions_project_idx
  on public.scheduling_decisions (project_id, occurred_at desc)
  where project_id is not null;

alter table public.scheduling_decisions enable row level security;
alter table public.scheduling_decisions force row level security;

create policy scheduling_decisions_select_members
  on public.scheduling_decisions for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.scheduling_decisions from anon, authenticated, service_role;
grant select on table public.scheduling_decisions to authenticated;

create or replace function public.scheduling_decisions_are_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'scheduling_decisions is append-only';
end;
$function$;

create trigger scheduling_decisions_no_update
  before update or delete on public.scheduling_decisions
  for each row execute function public.scheduling_decisions_are_append_only();

-- ---------------------------------------------------------------------------
-- Effective priority
-- ---------------------------------------------------------------------------

-- The whole of 2E's ordering policy, as one immutable function of stored
-- values and a supplied clock. Immutable rather than stable so it can be
-- reasoned about, indexed against, and tested without a database clock.
--
-- Rules, in the order they apply:
--
--   1. Emergency work is P0. An open incident or a security change outranks
--      whatever the project's standing priority happens to be (goal 4).
--   2. Otherwise the project's own priority is the base.
--   3. Strategic focus is worth one tier (goal 5).
--   4. Waiting is worth one tier per fairness interval (goal 23). This is the
--      anti-starvation guarantee: a P3 item waiting two intervals is weighed as
--      P1, and among equal priorities the oldest wins, so every queued item
--      eventually reaches the front.
--   5. Neither focus nor waiting can reach P0. The emergency reserve exists to
--      keep a slot for incidents; a project that could age into it would empty
--      the reserve with routine work.
create or replace function public.effective_work_priority(
  p_project_priority smallint,
  p_strategic_focus boolean,
  p_emergency boolean,
  p_queued_at timestamptz,
  p_fairness_promotion_seconds integer,
  p_now timestamptz
)
returns smallint
language sql
immutable
set search_path = pg_catalog
as $function$
  select greatest(
    -- Floor: emergencies and projects the owner has declared P0 may be 0.
    -- Everything else floors at P1.
    case
      when coalesce(p_emergency, false) then 0
      when coalesce(p_project_priority, 2) = 0 then 0
      else 1
    end,
    case when coalesce(p_emergency, false) then 0
      else coalesce(p_project_priority, 2) end
      - (case when coalesce(p_strategic_focus, false) then 1 else 0 end)
      - least(3, greatest(0, floor(
          extract(epoch from (p_now - coalesce(p_queued_at, p_now)))
          / greatest(60, coalesce(p_fairness_promotion_seconds, 900))
        )::integer))
  )::smallint;
$function$;

comment on function public.effective_work_priority(
  smallint, boolean, boolean, timestamptz, integer, timestamptz
) is
  'Deterministic portfolio priority: emergency overrides, focus is worth one tier, waiting is worth one tier per fairness interval, and neither focus nor waiting can reach P0.';

-- Whether a unit of work is emergency work, by policy rather than by opinion.
-- Two sources, both already durable: a repair attempt bound to an unresolved
-- incident, and a command classified as a security change.
--
-- Note what this does *not* key on: `command_type`. A promoted incident repair
-- is submitted as `fix_bug` (`lib/operations/promotion.ts`), identical to an
-- ordinary bug fix, so command type cannot tell an emergency from a chore. The
-- `repair_attempts` row written by the 1E→1C promotion is the real linkage.
--
-- The incident test is stated negatively — anything not resolved or closed is
-- still an emergency — so that a status added later fails toward urgency rather
-- than silently dropping incidents out of P0.
create or replace function public.is_emergency_work(p_task_id uuid, p_command_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from public.repair_attempts attempt
    join public.incidents incident on incident.id = attempt.incident_id
      and incident.organization_id = attempt.organization_id
    where attempt.task_id = p_task_id
      and incident.status not in (
        'resolved'::public.incident_status, 'closed'::public.incident_status
      )
  ) or exists (
    select 1
    from public.commands command
    where command.id = p_command_id
      and command.command_type = 'security'
  );
$function$;

comment on function public.is_emergency_work(uuid, uuid) is
  'Policy definition of P0 work: a repair attempt against an unresolved incident, or a security command. Deliberately not keyed on command_type alone, because a promoted repair is submitted as fix_bug.';

-- ---------------------------------------------------------------------------
-- Owner controls
-- ---------------------------------------------------------------------------

create or replace function public.set_project_engineering_priority(
  p_project_id uuid,
  p_priority smallint,
  p_reason text default null
)
returns table (project_id uuid, engineering_priority smallint, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  previous_priority smallint;
begin
  if p_priority is null or p_priority not between 0 and 3 then
    raise exception using errcode = '22023',
      message = 'priority must be 0 (P0) through 3 (P3)';
  end if;

  select project.* into project_record
  from public.projects project where project.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may change project priority';
  end if;

  previous_priority := project_record.engineering_priority;

  update public.projects project
  set engineering_priority = p_priority, updated_at = now()
  where project.id = p_project_id
  returning project.* into project_record;

  perform public.record_activity_event(
    project_record.organization_id, project_record.id,
    'project.engineering_priority_changed'::public.activity_event_type,
    'project', project_record.id,
    'Project engineering priority set to P' || p_priority::text,
    jsonb_build_object(
      'from', previous_priority, 'to', p_priority,
      'reason', left(btrim(coalesce(p_reason, '')), 400)
    )
  );

  return query select project_record.id, project_record.engineering_priority,
    project_record.updated_at;
end;
$function$;

create or replace function public.set_project_engineering_pause(
  p_project_id uuid,
  p_paused boolean,
  p_reason text default null
)
returns table (project_id uuid, engineering_paused boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_paused is null then
    raise exception using errcode = '22023', message = 'paused must be true or false';
  end if;
  -- A pause with no reason is the thing nobody can explain later, so it is
  -- refused at the boundary rather than defaulted to a filler sentence.
  if p_paused and trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'a pause reason is required';
  end if;

  select project.* into project_record
  from public.projects project where project.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may pause or resume project engineering';
  end if;

  update public.projects project
  set engineering_paused = p_paused,
    engineering_paused_at = case when p_paused then now() end,
    engineering_paused_by = case when p_paused then auth.uid() end,
    engineering_pause_reason = case when p_paused then trimmed_reason end,
    updated_at = now()
  where project.id = p_project_id
  returning project.* into project_record;

  perform public.record_activity_event(
    project_record.organization_id, project_record.id,
    case when p_paused then 'project.engineering_paused'::public.activity_event_type
      else 'project.engineering_resumed'::public.activity_event_type end,
    'project', project_record.id,
    case when p_paused then 'Project engineering paused'
      else 'Project engineering resumed' end,
    jsonb_build_object('reason', coalesce(trimmed_reason, ''))
  );

  return query select project_record.id, project_record.engineering_paused,
    project_record.updated_at;
end;
$function$;

-- Goal 33: one owner command that reprioritizes the portfolio. Focus is set on
-- the named projects and cleared everywhere else in the same statement, because
-- "focus on A" that leaves B focused is not focus. Nothing running is touched.
create or replace function public.focus_portfolio_engineering(
  p_organization_id uuid,
  p_project_ids uuid[],
  p_reason text default null
)
returns table (project_id uuid, strategic_focus boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  requested uuid[] := coalesce(p_project_ids, array[]::uuid[]);
  changed_project public.projects%rowtype;
  trimmed_reason text := left(btrim(coalesce(p_reason, '')), 400);
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may set portfolio focus';
  end if;

  if exists (
    select 1 from unnest(requested) as requested_id
    where not exists (
      select 1 from public.projects project
      where project.id = requested_id
        and project.organization_id = p_organization_id
    )
  ) then
    raise exception using errcode = '22023',
      message = 'every focused project must belong to this organization';
  end if;

  -- The update is wrapped in a CTE because plpgsql will not iterate a
  -- data-modifying statement directly. One statement still, so a partial
  -- refocus cannot be observed.
  for changed_project in
    with refocused as (
      update public.projects project
      set strategic_focus = project.id = any(requested), updated_at = now()
      where project.organization_id = p_organization_id
        and project.strategic_focus is distinct from (project.id = any(requested))
      returning project.*
    )
    select * from refocused
  loop
    perform public.record_activity_event(
      changed_project.organization_id, changed_project.id,
      'project.strategic_focus_changed'::public.activity_event_type,
      'project', changed_project.id,
      case when changed_project.strategic_focus
        then 'Project placed in strategic focus'
        else 'Project removed from strategic focus' end,
      jsonb_build_object('focused', changed_project.strategic_focus, 'reason', trimmed_reason)
    );
  end loop;

  return query
    select project.id, project.strategic_focus
    from public.projects project
    where project.organization_id = p_organization_id
    order by project.name;
end;
$function$;

create or replace function public.set_portfolio_capacity_limits(
  p_organization_id uuid,
  p_maximum_concurrent_runs smallint default null,
  p_emergency_reserved_runs smallint default null,
  p_fairness_promotion_seconds integer default null,
  p_project_id uuid default null,
  p_project_maximum_concurrent_runs smallint default null
)
returns table (
  organization_id uuid,
  maximum_concurrent_runs smallint,
  emergency_reserved_runs smallint,
  fairness_promotion_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  organization_record public.organizations%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may change portfolio capacity';
  end if;

  if (p_project_id is null) <> (p_project_maximum_concurrent_runs is null) then
    raise exception using errcode = '22023',
      message = 'a project limit needs both the project and the limit';
  end if;

  update public.organizations organization
  set maximum_concurrent_runs =
        coalesce(p_maximum_concurrent_runs, organization.maximum_concurrent_runs),
    emergency_reserved_runs =
        coalesce(p_emergency_reserved_runs, organization.emergency_reserved_runs),
    fairness_promotion_seconds =
        coalesce(p_fairness_promotion_seconds, organization.fairness_promotion_seconds),
    updated_at = now()
  where organization.id = p_organization_id
  returning organization.* into organization_record;

  if p_project_id is not null then
    update public.projects project
    set maximum_concurrent_runs = p_project_maximum_concurrent_runs, updated_at = now()
    where project.id = p_project_id and project.organization_id = p_organization_id;
    if not found then
      raise exception using errcode = 'P0002',
        message = 'project not found in this organization';
    end if;
  end if;

  perform public.record_activity_event(
    p_organization_id, p_project_id,
    'portfolio.capacity_changed'::public.activity_event_type,
    'organization', p_organization_id,
    'Portfolio capacity limits changed',
    jsonb_build_object(
      'maximumConcurrentRuns', organization_record.maximum_concurrent_runs,
      'emergencyReservedRuns', organization_record.emergency_reserved_runs,
      'fairnessPromotionSeconds', organization_record.fairness_promotion_seconds,
      'projectMaximumConcurrentRuns', p_project_maximum_concurrent_runs
    )
  );

  return query select organization_record.id, organization_record.maximum_concurrent_runs,
    organization_record.emergency_reserved_runs, organization_record.fairness_promotion_seconds;
end;
$function$;

create or replace function public.set_provider_capacity_limit(
  p_organization_id uuid,
  p_provider text,
  p_maximum_concurrent_runs smallint,
  p_connection_id uuid default null
)
-- The OUT parameters are prefixed because plpgsql resolves an unqualified name
-- to the parameter before the column, so a bare `provider` inside the INSERT
-- below is ambiguous and fails at run time rather than at creation.
returns table (
  declared_provider text,
  declared_connection_id uuid,
  declared_maximum_concurrent_runs smallint
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  limit_record public.provider_capacity_limits%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may change provider capacity';
  end if;
  if p_provider not in ('openai', 'anthropic') then
    raise exception using errcode = '22023', message = 'unsupported provider';
  end if;
  if p_maximum_concurrent_runs is null or p_maximum_concurrent_runs not between 0 and 32 then
    raise exception using errcode = '22023',
      message = 'provider concurrency must be between 0 and 32';
  end if;
  if p_connection_id is not null and not exists (
    select 1 from public.connections connection
    where connection.id = p_connection_id
      and connection.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023',
      message = 'connection does not belong to this organization';
  end if;

  if p_connection_id is null then
    insert into public.provider_capacity_limits as target (
      organization_id, provider, connection_id, maximum_concurrent_runs
    ) values (p_organization_id, p_provider, null, p_maximum_concurrent_runs)
    on conflict (organization_id, provider) where connection_id is null
    do update set maximum_concurrent_runs = excluded.maximum_concurrent_runs,
      updated_at = now()
    returning target.* into limit_record;
  else
    insert into public.provider_capacity_limits as target (
      organization_id, provider, connection_id, maximum_concurrent_runs
    ) values (p_organization_id, p_provider, p_connection_id, p_maximum_concurrent_runs)
    on conflict (organization_id, provider, connection_id) where connection_id is not null
    do update set maximum_concurrent_runs = excluded.maximum_concurrent_runs,
      updated_at = now()
    returning target.* into limit_record;
  end if;

  perform public.record_activity_event(
    p_organization_id, null,
    'portfolio.capacity_changed'::public.activity_event_type,
    'organization', p_organization_id,
    'Provider concurrency limit changed',
    jsonb_build_object(
      'provider', p_provider,
      'scope', case when p_connection_id is null then 'account' else 'connection' end,
      'maximumConcurrentRuns', p_maximum_concurrent_runs
    )
  );

  return query select limit_record.provider, limit_record.connection_id,
    limit_record.maximum_concurrent_runs::smallint;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.effective_work_priority(
  smallint, boolean, boolean, timestamptz, integer, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.is_emergency_work(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.scheduling_decisions_are_append_only()
  from public, anon, authenticated, service_role;
revoke all on function public.set_project_engineering_priority(uuid, smallint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_project_engineering_pause(uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.focus_portfolio_engineering(uuid, uuid[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_portfolio_capacity_limits(
  uuid, smallint, smallint, integer, uuid, smallint
) from public, anon, authenticated, service_role;
revoke all on function public.set_provider_capacity_limit(uuid, text, smallint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.set_project_engineering_priority(uuid, smallint, text)
  to authenticated;
grant execute on function public.set_project_engineering_pause(uuid, boolean, text)
  to authenticated;
grant execute on function public.focus_portfolio_engineering(uuid, uuid[], text)
  to authenticated;
grant execute on function public.set_portfolio_capacity_limits(
  uuid, smallint, smallint, integer, uuid, smallint
) to authenticated;
grant execute on function public.set_provider_capacity_limit(uuid, text, smallint, uuid)
  to authenticated;
