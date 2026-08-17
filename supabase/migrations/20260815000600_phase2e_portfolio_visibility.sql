-- Phase 2E: make the queue and its reasons readable.
--
-- Goal 27 asks that queue ordering and reason be visible and auditable, and
-- goal 32 that the portfolio dashboard show capacity, queues and bottlenecks.
-- `scheduling_decisions` already covers the audit — what was assigned and what
-- was withheld, after the fact. This is the other half: what is waiting right
-- now, in the order the scheduler would take it, and what is holding each item
-- back.
--
-- The ordering below is not a second opinion about priority. It calls the same
-- `effective_work_priority` and the same `portfolio_capacity_verdict` the
-- scheduler calls, so the console cannot show a queue the scheduler disagrees
-- with. If they ever diverge it will be because someone changed one of those
-- two functions, which changes both readings at once.
--
-- Browser-facing and therefore SECURITY DEFINER with an explicit membership
-- check: `agent_runs`, `tasks` and `commands` are not selectable by
-- `authenticated`, and this must not become a way around that. It returns
-- counts, names and reasons — never a prompt, a token, or a repository path.

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_scheduling_queue(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  run_id uuid,
  project_id uuid,
  project_name text,
  task_title text,
  run_status text,
  project_priority smallint,
  effective_priority smallint,
  strategic_focus boolean,
  emergency boolean,
  waiting_seconds integer,
  blocked_reason text,
  queue_position integer
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  with candidate as (
    select
      run.id as run_id,
      run.project_id as project_id,
      project.name as project_name,
      task.title as task_title,
      run.status::text as run_status,
      project.engineering_priority as project_priority,
      project.strategic_focus as strategic_focus,
      public.is_emergency_work(task.id, command.id) as emergency,
      greatest(0, extract(epoch from (now() - run.created_at))::integer) as waiting_seconds,
      public.effective_work_priority(
        project.engineering_priority, project.strategic_focus,
        public.is_emergency_work(task.id, command.id), run.created_at,
        organization.fairness_promotion_seconds, now()
      ) as effective_priority,
      project.engineering_paused as engineering_paused,
      task.priority as task_priority,
      run.created_at as created_at,
      run.provider as provider,
      run.model as model,
      run.connection_id as connection_id,
      exists (
        select 1 from public.task_dependencies dependency
        join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
          and prerequisite.organization_id = dependency.organization_id
        where dependency.task_id = task.id
          and dependency.organization_id = task.organization_id
          and prerequisite.status <> 'completed'::public.task_status
      ) as blocked_by_dependency
    from public.agent_runs run
    join public.tasks task on task.id = run.task_id
      and task.organization_id = run.organization_id
    join public.commands command on command.id = run.command_id
      and command.organization_id = run.organization_id
    join public.projects project on project.id = run.project_id
      and project.organization_id = run.organization_id
    join public.organizations organization on organization.id = run.organization_id
    where run.organization_id = p_organization_id
      and public.is_organization_member(p_organization_id)
      and run.status in ('queued'::public.run_status, 'running'::public.run_status)
  ),
  explained as (
    select candidate.*,
      case
        -- Ordered by what a reader can act on. A paused project explains
        -- everything else about it, so it is said first and once.
        when candidate.run_status = 'running' then null
        when candidate.engineering_paused then 'Project engineering is paused.'
        when candidate.blocked_by_dependency then 'Waiting on an incomplete dependency.'
        else coalesce(
          public.breaker_suppression_reason(
            p_organization_id, candidate.provider, candidate.model, now()
          ),
          (select verdict.reason from public.portfolio_capacity_verdict(
            p_organization_id, candidate.project_id, candidate.provider,
            candidate.connection_id, candidate.effective_priority
          ) verdict where not verdict.allowed)
        )
      end as blocked_reason
    from candidate
  )
  select
    explained.run_id, explained.project_id, explained.project_name,
    left(explained.task_title, 240), explained.run_status,
    explained.project_priority, explained.effective_priority,
    explained.strategic_focus, explained.emergency, explained.waiting_seconds,
    explained.blocked_reason,
    -- Position is over queued work only: a running item is not in a queue.
    -- The keys match the scheduler's `order by` exactly.
    case when explained.run_status = 'queued' then row_number() over (
      partition by explained.run_status
      order by explained.effective_priority asc,
        case when explained.strategic_focus then 0 else 1 end,
        explained.task_priority desc,
        explained.created_at asc
    )::integer end
  from explained
  order by
    case when explained.run_status = 'running' then 0 else 1 end,
    explained.effective_priority asc,
    case when explained.strategic_focus then 0 else 1 end,
    explained.task_priority desc,
    explained.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

comment on function public.portfolio_scheduling_queue(uuid, integer) is
  'Queued and running work in the order the scheduler would take it, with the reason each queued item is not moving. Calls the same priority and capacity functions the scheduler calls, so the two cannot disagree.';

-- ---------------------------------------------------------------------------
-- Capacity and bottlenecks
-- ---------------------------------------------------------------------------

create or replace function public.portfolio_capacity_overview(p_organization_id uuid)
returns table (
  organization_limit smallint,
  emergency_reserved smallint,
  ordinary_ceiling integer,
  active_runs integer,
  queued_runs integer,
  fairness_promotion_seconds integer,
  worker_count integer,
  worker_capacity integer,
  worker_leases integer,
  open_breakers integer,
  paused_projects integer,
  focused_projects integer,
  emergency_queued integer
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    organization.maximum_concurrent_runs,
    organization.emergency_reserved_runs,
    (organization.maximum_concurrent_runs - organization.emergency_reserved_runs)::integer,
    (select count(*) from public.agent_runs run
      where run.organization_id = p_organization_id
        and run.status = 'running'::public.run_status
        and run.lease_expires_at > now())::integer,
    (select count(*) from public.agent_runs run
      where run.organization_id = p_organization_id
        and run.status = 'queued'::public.run_status)::integer,
    organization.fairness_promotion_seconds,
    -- Workers are not organization-scoped in Phase 1C, so these three are
    -- factory-wide totals rather than this organization's share. Labelled as
    -- such wherever they are shown, because a number that quietly means
    -- something else is worse than no number.
    (select count(*) from public.phase1c_workers worker
      where worker.status = 'active'
        and worker.last_heartbeat_at > now() - interval '5 minutes')::integer,
    (select coalesce(sum(worker.maximum_concurrent_runs), 0) from public.phase1c_workers worker
      where worker.status = 'active'
        and worker.last_heartbeat_at > now() - interval '5 minutes')::integer,
    (select count(*) from public.agent_runs run
      where run.status = 'running'::public.run_status
        and run.lease_expires_at > now()
        and run.lease_worker_id is not null)::integer,
    (select count(*) from public.resource_breakers breaker
      where breaker.organization_id = p_organization_id
        and breaker.state = 'open'
        and breaker.opened_at is not null
        and breaker.fault is not null
        and breaker.opened_at + pg_catalog.make_interval(
          secs => public.breaker_cooldown_seconds(breaker.fault)
        ) > now())::integer,
    (select count(*) from public.projects project
      where project.organization_id = p_organization_id
        and project.engineering_paused)::integer,
    (select count(*) from public.projects project
      where project.organization_id = p_organization_id
        and project.strategic_focus)::integer,
    (select count(*) from public.agent_runs run
      join public.tasks task on task.id = run.task_id
        and task.organization_id = run.organization_id
      where run.organization_id = p_organization_id
        and run.status = 'queued'::public.run_status
        and public.is_emergency_work(task.id, run.command_id))::integer
  from public.organizations organization
  where organization.id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

comment on function public.portfolio_capacity_overview(uuid) is
  'One row of portfolio capacity: ceilings, reserve, live leases, queue depth, worker totals, open breakers, paused and focused projects.';

create or replace function public.portfolio_project_capacity(p_organization_id uuid)
returns table (
  project_id uuid,
  project_name text,
  engineering_priority smallint,
  strategic_focus boolean,
  engineering_paused boolean,
  engineering_pause_reason text,
  maximum_concurrent_runs smallint,
  active_runs integer,
  queued_runs integer
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select project.id, project.name, project.engineering_priority,
    project.strategic_focus, project.engineering_paused,
    left(project.engineering_pause_reason, 400),
    project.maximum_concurrent_runs,
    (select count(*) from public.agent_runs run
      where run.project_id = project.id
        and run.status = 'running'::public.run_status
        and run.lease_expires_at > now())::integer,
    (select count(*) from public.agent_runs run
      where run.project_id = project.id
        and run.status = 'queued'::public.run_status)::integer
  from public.projects project
  where project.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by project.engineering_priority asc, project.name asc;
$function$;

comment on function public.portfolio_project_capacity(uuid) is
  'Per-project scheduling state and live counts for the portfolio dashboard.';

revoke all on function public.portfolio_scheduling_queue(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.portfolio_capacity_overview(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.portfolio_project_capacity(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.portfolio_scheduling_queue(uuid, integer) to authenticated;
grant execute on function public.portfolio_capacity_overview(uuid) to authenticated;
grant execute on function public.portfolio_project_capacity(uuid) to authenticated;
