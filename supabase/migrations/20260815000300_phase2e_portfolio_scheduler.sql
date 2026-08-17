-- Phase 2E: portfolio arbitration inside the scheduler that already works.
--
-- `20260815000200` added the state — priority, focus, pause, ceilings. This
-- migration is where selection starts using it. Nothing new claims work: the
-- one claim path is still `claim_phase1c_run`, and the body below is the
-- existing `claim_phase1c_run_budget_internal` with four changes, kept
-- otherwise byte-identical so no behaviour is lost in a retype:
--
--   1. A worker may hold no more leases than its declared capacity.
--   2. A paused project is not scheduled, and a candidate must pass the
--      portfolio capacity verdict.
--   3. Ordering leads with effective priority, then strategic focus, before
--      falling back to the original task-priority and age keys.
--   4. Every assignment, and every ready-but-withheld unit of work, is recorded
--      in `scheduling_decisions`.
--
-- What deliberately did *not* change: nothing is cancelled to make room. Goal
-- 24 asks that P0 be able to reserve capacity and goal 25 that running work not
-- be destroyed to reprioritise, and those two are the same requirement read
-- from either end. The emergency reserve does it without a single kill —
-- ordinary work is capped below the ceiling, so a slot is always free for an
-- incident the moment any run finishes, and reprioritising changes only what
-- starts next.

-- ---------------------------------------------------------------------------
-- The capacity verdict
-- ---------------------------------------------------------------------------

-- One function, three callers: the claim query filters on it, the withheld
-- audit explains with it, and the queue view shows it. Written once because
-- three copies of a limit rule is three chances for the console to disagree
-- with the scheduler about why work is not moving.
--
-- Active means *leased*: `status = 'running'` with a lease still in the future.
-- A run whose lease has expired is reclaimable, not occupying capacity, which
-- is how capacity is released by a crash as well as by completion (goal 18).
create or replace function public.portfolio_capacity_verdict(
  p_organization_id uuid,
  p_project_id uuid,
  p_provider text,
  p_connection_id uuid,
  p_effective_priority smallint
)
returns table (allowed boolean, reason text, capacity jsonb)
language plpgsql
stable
set search_path = pg_catalog
as $function$
declare
  organization_record public.organizations%rowtype;
  project_limit integer;
  provider_limit integer;
  connection_limit integer;
  organization_active integer;
  project_active integer;
  provider_active integer;
  connection_active integer;
  ordinary_ceiling integer;
  is_emergency boolean := coalesce(p_effective_priority, 3) = 0;
  verdict_reason text := 'Within every portfolio, project, provider and connection ceiling.';
  verdict_allowed boolean := true;
begin
  select * into organization_record
  from public.organizations organization where organization.id = p_organization_id;
  if not found then
    return query select false,
      'Organization not found.'::text, '{}'::jsonb;
    return;
  end if;

  select project.maximum_concurrent_runs into project_limit
  from public.projects project where project.id = p_project_id;

  select limits.maximum_concurrent_runs into provider_limit
  from public.provider_capacity_limits limits
  where limits.organization_id = p_organization_id
    and limits.provider = p_provider
    and limits.connection_id is null;

  select limits.maximum_concurrent_runs into connection_limit
  from public.provider_capacity_limits limits
  where limits.organization_id = p_organization_id
    and limits.provider = p_provider
    and limits.connection_id = p_connection_id;

  select
    count(*) filter (where active.organization_id = p_organization_id),
    count(*) filter (where active.project_id = p_project_id),
    count(*) filter (
      where active.organization_id = p_organization_id and active.provider = p_provider
    ),
    count(*) filter (
      where active.organization_id = p_organization_id
        and active.provider = p_provider
        and active.connection_id = p_connection_id
    )
  into organization_active, project_active, provider_active, connection_active
  from public.agent_runs active
  where active.status = 'running'::public.run_status
    and active.lease_expires_at > now()
    and (active.organization_id = p_organization_id or active.project_id = p_project_id);

  -- The reserve is subtracted for everything except effective P0. That single
  -- subtraction is the whole of preemption: ordinary work stops short of the
  -- ceiling, so the next slot to free up is already spoken for by an emergency,
  -- and no running work had to be killed to produce it.
  ordinary_ceiling := organization_record.maximum_concurrent_runs
    - case when is_emergency then 0 else organization_record.emergency_reserved_runs end;

  if organization_active >= ordinary_ceiling then
    verdict_allowed := false;
    verdict_reason := case
      when is_emergency then 'Portfolio is at its concurrency ceiling.'
      else 'Portfolio ceiling reached, less the slots reserved for emergency work.'
    end;
  elsif project_active >= coalesce(project_limit, 0) then
    verdict_allowed := false;
    verdict_reason := 'Project is at its concurrency ceiling.';
  elsif provider_limit is not null and provider_active >= provider_limit then
    verdict_allowed := false;
    verdict_reason := 'Provider account is at its concurrency ceiling.';
  elsif connection_limit is not null and connection_active >= connection_limit then
    verdict_allowed := false;
    verdict_reason := 'Connection is at its concurrency ceiling.';
  end if;

  return query select verdict_allowed, verdict_reason, jsonb_build_object(
    'organizationActive', organization_active,
    'organizationLimit', organization_record.maximum_concurrent_runs,
    'emergencyReserved', organization_record.emergency_reserved_runs,
    'ordinaryCeiling', ordinary_ceiling,
    'projectActive', project_active,
    'projectLimit', project_limit,
    'providerActive', provider_active,
    'providerLimit', provider_limit,
    'connectionActive', connection_active,
    'connectionLimit', connection_limit,
    'effectivePriority', p_effective_priority
  );
end;
$function$;

comment on function public.portfolio_capacity_verdict(uuid, uuid, text, uuid, smallint) is
  'Whether one candidate may start now, which ceiling is binding if not, and the counts behind the answer. Shared by the scheduler, the withheld audit and the queue view so they cannot disagree.';

-- ---------------------------------------------------------------------------
-- Portfolio-aware selection
-- ---------------------------------------------------------------------------

create or replace function public.claim_phase1c_run_budget_internal(
  p_worker_id text, p_provider text, p_model text,
  p_lease_seconds integer default 120
)
returns table (
  run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
  command_id uuid, agent_id uuid, prompt text, command_type text,
  requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
  connection_id uuid, repository_id uuid, internal_installation_id uuid,
  external_installation_id bigint, app_id bigint, external_repository_id bigint,
  repository_full_name text, base_branch text, base_sha text,
  lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
  cancellation_requested boolean, logical_agent_role text, provider text, model text,
  maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
  maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
  owner_approval_id uuid, owner_approval_expires_at timestamptz,
  recovery_head_branch text, recovery_head_sha text,
  recovery_pull_request_number integer, recovery_pull_request_url text,
  recovery_provider_run_reference text, recovery_usage jsonb
)
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  claimed_run_id uuid;
  worker_capacity integer;
  worker_active integer;
  claimed_priority smallint;
  claimed_verdict record;
  withheld_candidate record;
  claimed_run public.agent_runs%rowtype;
  exhausted_run public.agent_runs%rowtype;
  terminal_outcome text;
  deadline_exhausted boolean;
  terminal_error_code text;
  terminal_failure_summary text;
  new_lease_token uuid := gen_random_uuid();
  bounded_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 300));
begin
  if not exists (
    select 1 from public.phase1c_workers worker
    where worker.worker_id = p_worker_id and worker.status = 'active'
      and worker.last_heartbeat_at > now() - interval '5 minutes'
      and worker.last_heartbeat_at <= now() + interval '1 minute'
  ) then raise exception using errcode = '42501', message = 'worker is not registered and active'; end if;
  if p_provider <> 'openai' or p_model <> 'gpt-5.3-codex' then
    raise exception using errcode = '22023', message = 'unsupported worker provider or model';
  end if;

  for exhausted_run in
    select run.* from public.agent_runs run
    join public.commands deadline_command on deadline_command.id = run.command_id
      and deadline_command.organization_id = run.organization_id
    where (
      run.status = 'running'::public.run_status
      and run.lease_expires_at < now()
      and (run.cancellation_requested_at is not null
        or run.attempt_number >= run.max_attempts
        or run.started_at is null
        or case
          when deadline_command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
            and (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
              between 60000 and 3600000
            then run.started_at + make_interval(secs =>
              (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) <= now()
          else true
        end)
    ) or (
      run.status = 'queued'::public.run_status
      and run.started_at is not null
      and case
        when deadline_command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
          and (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
            between 60000 and 3600000
          then run.started_at + make_interval(secs =>
            (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) <= now()
        else true
      end
    )
    for update of run skip locked
  loop
    select case
      when exhausted_run.started_at is null then true
      when command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
        and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
          between 60000 and 3600000
        then exhausted_run.started_at + make_interval(secs =>
          (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) <= now()
      else true
    end into deadline_exhausted
    from public.commands command
    where command.id = exhausted_run.command_id
      and command.organization_id = exhausted_run.organization_id;
    terminal_outcome := case when exhausted_run.cancellation_requested_at is not null
      then 'cancelled' else 'failed' end;
    terminal_error_code := case
      when terminal_outcome = 'cancelled' then null
      when deadline_exhausted then 'timed_out'
      else 'lease_attempts_exhausted'
    end;
    terminal_failure_summary := case
      when deadline_exhausted then 'The configured maximum execution duration elapsed.'
      else 'The bounded worker attempt limit was exhausted.'
    end;
    update public.agent_runs run set status = terminal_outcome::public.run_status,
      lease_worker_id = null, lease_token = null, lease_expires_at = null,
      retryable = false, error_code = terminal_error_code,
      error_message = case when terminal_outcome = 'failed' then
        case when deadline_exhausted
          then 'The bounded execution deadline elapsed before the stale lease could be reclaimed.'
          else 'The worker lease expired after the bounded attempt limit.' end
        end,
      result_summary = case when terminal_outcome = 'cancelled'
        then 'The owner-requested cancellation completed after the worker lease expired.'
        else terminal_failure_summary end,
      completed_at = now(), updated_at = now()
      where run.id = exhausted_run.id;
    update public.tasks task set status = terminal_outcome::public.task_status,
      blocked_reason = case when terminal_outcome = 'failed' then terminal_failure_summary end,
      result_summary = case when terminal_outcome = 'cancelled'
        then 'The owner-requested cancellation completed safely.'
        when deadline_exhausted then 'The worker stopped at the durable execution deadline.'
        else 'The worker stopped after repeated lease loss.' end,
      completed_at = now(), updated_at = now() where task.id = exhausted_run.task_id;
    update public.commands command set status = terminal_outcome::public.command_status,
      completed_at = now(), updated_at = now() where command.id = exhausted_run.command_id;
    update public.agents agent set status = 'idle'::public.agent_status,
      current_assignment = null, last_run_at = now(), updated_at = now()
      where agent.id = exhausted_run.agent_id;
    update public.phase1c_workers worker set current_run_id = null,
      status = case when worker.status = 'disabled' then worker.status else 'error' end,
      updated_at = now() where worker.current_run_id = exhausted_run.id;
    insert into public.phase1c_run_events (
      organization_id, run_id, attempt_number, event_type, message, details
    ) values (
      exhausted_run.organization_id, exhausted_run.id, exhausted_run.attempt_number,
      terminal_outcome, case when terminal_outcome = 'cancelled'
        then 'The stale worker lease reached the owner-requested cancellation boundary.'
        when deadline_exhausted then 'The stale worker lease reached the durable execution deadline.'
        else 'The stale worker lease exhausted the bounded attempt limit.' end,
      jsonb_build_object('errorCode', terminal_error_code)
    );
    perform public.record_activity_event(
      exhausted_run.organization_id, exhausted_run.project_id,
      case when terminal_outcome = 'cancelled' then 'agent.cancelled'::public.activity_event_type
        else 'agent.failed'::public.activity_event_type end,
      'agent_run', exhausted_run.id,
      case when terminal_outcome = 'cancelled'
        then 'Phase 1C run cancelled after its worker lease expired'
        when deadline_exhausted then 'Phase 1C run failed at its durable execution deadline'
        else 'Phase 1C run failed after bounded lease exhaustion' end,
      jsonb_build_object('attempt', exhausted_run.attempt_number,
        'maxAttempts', exhausted_run.max_attempts)
    );
    insert into public.reports (
      organization_id, project_id, generated_by_agent_id, type, status,
      title, summary, content, period_start, period_end, published_at
    ) values (
      exhausted_run.organization_id, exhausted_run.project_id, exhausted_run.agent_id,
      'quality'::public.report_type, 'published'::public.report_status,
      'Phase 1C run ' || left(exhausted_run.id::text, 8) || ' ' || terminal_outcome,
      case when terminal_outcome = 'cancelled'
        then 'The owner-requested cancellation completed after the worker lease expired.'
        else terminal_failure_summary end,
      jsonb_build_object(
        'outcome', terminal_outcome, 'runIds', jsonb_build_array(exhausted_run.id),
        'pullRequestNumbers', coalesce((select jsonb_agg(evidence.external_number)
          from (select pull.external_number from public.pull_requests pull
            where pull.agent_run_id = exhausted_run.id
            order by pull.created_at desc limit 10) evidence), '[]'::jsonb),
        'changedFiles', exhausted_run.changed_files,
        'checks', exhausted_run.checks,
        'validations', coalesce((select jsonb_agg(jsonb_build_object(
          'name', evidence.name, 'status', evidence.status,
          'durationMs', evidence.duration_ms,
          'attempt', evidence.attempt_number, 'round', evidence.validation_round
        ) order by evidence.attempt_number desc, evidence.validation_round desc)
          from (select validation.* from public.phase1c_run_validations validation
            where validation.run_id = exhausted_run.id
            order by validation.attempt_number desc, validation.validation_round desc limit 100
          ) evidence), '[]'::jsonb),
        'sections', jsonb_build_array(jsonb_build_object(
          'title', case when terminal_outcome = 'cancelled'
            then 'Cancellation completed'
            when deadline_exhausted then 'Execution deadline reached'
            else 'Bounded lease exhaustion' end,
          'body', case when terminal_outcome = 'cancelled'
            then 'The run stopped after its worker lease expired.'
            when deadline_exhausted
            then 'The stale lease was terminalized before another worker could exceed the durable execution deadline.'
            else 'The worker lease expired after the configured attempt limit.' end
        )),
        'findings', jsonb_build_array(jsonb_build_object(
          'title', 'Execution stopped',
          'severity', case when terminal_outcome = 'cancelled' then 'medium' else 'high' end,
          'status', 'open', 'summary', case when terminal_outcome = 'cancelled'
            then 'The owner-requested safe boundary was honored.'
            when deadline_exhausted then 'No additional worker was permitted after the execution deadline.'
            else 'No further automatic attempt is permitted.' end
        )),
        'security', jsonb_build_object(
          'risk', exhausted_run.risk_level,
          'errorCode', terminal_error_code,
          'blocker', case when terminal_outcome = 'cancelled'
            then 'Owner-requested cancellation.'
            when deadline_exhausted then 'The durable execution deadline elapsed.'
            else 'The bounded worker attempt limit was exhausted.' end
        ),
        'decisions', case when terminal_outcome = 'cancelled' then jsonb_build_array(
          jsonb_build_object('id', exhausted_run.id::text || '-cancellation',
            'title', 'Cancellation requested', 'status', 'recorded',
            'ownerAction', left(exhausted_run.cancellation_reason, 500))
        ) else '[]'::jsonb end
      ),
      exhausted_run.started_at, now(), now()
    );
  end loop;

  -- Worker capacity. Measured from live leases rather than from
  -- `current_run_id`, so a worker that crashed mid-run stops consuming capacity
  -- the moment its lease expires instead of holding a slot until someone
  -- notices. No audit row: `phase1c_workers` is not organization-scoped, so
  -- there is no organization this could honestly be attributed to, and worker
  -- utilisation is directly visible from the leases themselves.
  select worker.maximum_concurrent_runs into worker_capacity
  from public.phase1c_workers worker where worker.worker_id = p_worker_id;
  select count(*) into worker_active
  from public.agent_runs active
  where active.lease_worker_id = p_worker_id
    and active.status = 'running'::public.run_status
    and active.lease_expires_at > now();
  if worker_active >= coalesce(worker_capacity, 1) then return; end if;

  select run.id, portfolio_priority.value into claimed_run_id, claimed_priority
  from public.agent_runs run
  join public.tasks task on task.id = run.task_id and task.organization_id = run.organization_id
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.agents assigned_agent on assigned_agent.id = run.agent_id
    and assigned_agent.organization_id = run.organization_id
  join public.projects project on project.id = run.project_id and project.organization_id = run.organization_id
  join public.organizations organization on organization.id = run.organization_id
  cross join lateral (
    select public.effective_work_priority(
      project.engineering_priority, project.strategic_focus,
      public.is_emergency_work(task.id, command.id), run.created_at,
      organization.fairness_promotion_seconds, now()
    ) as value
  ) portfolio_priority
  cross join lateral public.portfolio_capacity_verdict(
    run.organization_id, run.project_id, run.provider, run.connection_id,
    portfolio_priority.value
  ) capacity_verdict
  join public.project_connections link on link.project_id = project.id
    and link.organization_id = project.organization_id and link.connection_id = run.connection_id
    and link.github_repository_id = run.github_repository_id and link.is_primary
  join public.connections connection on connection.id = link.connection_id
    and connection.organization_id = link.organization_id
  join public.github_installations installation on installation.connection_id = connection.id
    and installation.organization_id = connection.organization_id
  join public.github_repositories repository on repository.id = run.github_repository_id
    and repository.installation_id = installation.id and repository.organization_id = run.organization_id
  where (run.status = 'queued'::public.run_status
      or (run.status = 'running'::public.run_status and run.lease_expires_at < now()))
    and run.attempt_number < run.max_attempts and run.cancellation_requested_at is null
    and command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
    and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer between 60000 and 3600000
    and (run.started_at is null or run.started_at + make_interval(secs =>
      (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) > now())
    and run.risk_level in ('green'::public.risk_level, 'yellow'::public.risk_level)
    and command.requested_risk = run.risk_level
    and command.status in ('queued'::public.command_status, 'running'::public.command_status)
    and task.status in ('queued'::public.task_status, 'in_progress'::public.task_status)
    and run.provider = p_provider and run.model = p_model
    and project.status = 'active'::public.project_status
    and not project.engineering_paused
    and capacity_verdict.allowed
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch
    and run.base_branch = repository.default_branch
    and not exists (
      select 1 from public.agent_runs other_run
      where other_run.agent_id = run.agent_id and other_run.id <> run.id
        and other_run.status = 'running'::public.run_status
        and other_run.lease_expires_at > now()
    )
    and not exists (
      select 1 from public.task_dependencies dependency
      join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
        and prerequisite.organization_id = dependency.organization_id
      where dependency.task_id = task.id and dependency.organization_id = task.organization_id
        and prerequisite.status <> 'completed'::public.task_status
    )
    and (
      (
        not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'branch')
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'commit')
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'pull_request')
        and not exists (select 1 from public.pull_requests pull where pull.agent_run_id = run.id)
      ) or (
        (select count(*) from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'branch') = 1
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'commit')
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'pull_request')
        and not exists (select 1 from public.pull_requests pull where pull.agent_run_id = run.id)
      ) or (
        (select count(*) from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'branch') = 1
        and (select count(*) from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'commit') >= 1
        and run.head_branch ~ '^factory/[A-Za-z0-9._/-]{1,240}$'
        and run.head_sha ~ '^[0-9a-f]{40}$'
        and exists (select 1 from public.phase1c_run_artifacts branch
          where branch.run_id = run.id and branch.artifact_type = 'branch'
            and branch.reference = run.head_branch)
        and exists (select 1 from public.phase1c_run_artifacts commit
          where commit.run_id = run.id and commit.artifact_type = 'commit'
            and lower(commit.reference) = run.head_sha)
        and (
          (
            not exists (select 1 from public.phase1c_run_artifacts artifact
              where artifact.run_id = run.id and artifact.artifact_type = 'pull_request')
            and not exists (select 1 from public.pull_requests pull
              where pull.agent_run_id = run.id)
          ) or (
            (select count(*) from public.phase1c_run_artifacts artifact
              where artifact.run_id = run.id and artifact.artifact_type = 'pull_request') = 1
            and (select count(*) from public.pull_requests pull
              where pull.agent_run_id = run.id) = 1
            and exists (
              select 1 from public.pull_requests pull
              where pull.agent_run_id = run.id and pull.organization_id = run.organization_id
                and pull.project_id = run.project_id and pull.repository = repository.full_name
                and pull.status = 'draft'::public.pull_request_status
                and pull.head_branch = run.head_branch and pull.base_branch = run.base_branch
                and exists (select 1 from public.phase1c_run_artifacts artifact
                  where artifact.run_id = run.id and artifact.artifact_type = 'pull_request'
                    and artifact.reference = pull.url
                    and artifact.external_number = pull.external_number)
            )
          )
        )
      )
    )
  order by portfolio_priority.value asc,
    case when run.status = 'queued'::public.run_status then 0 else 1 end,
    case when project.strategic_focus then 0 else 1 end,
    task.priority desc, run.created_at asc
  limit 1 for update of run, assigned_agent skip locked;
  if claimed_run_id is null then
    -- Nothing was claimed. If portfolio work was ready and a ceiling is what
    -- held it back, that is a bottleneck the owner needs to see. It is the only
    -- case recorded: an idle poll against an empty queue is evidence of
    -- nothing, and writing a row for it would bury the rows that matter.
    select run.organization_id as organization_id, run.project_id as project_id,
      withheld_verdict.reason as reason, withheld_verdict.capacity as capacity,
      withheld_priority.value as effective_priority
    into withheld_candidate
    from public.agent_runs run
    join public.tasks task on task.id = run.task_id
      and task.organization_id = run.organization_id
    join public.commands command on command.id = run.command_id
      and command.organization_id = run.organization_id
    join public.projects project on project.id = run.project_id
      and project.organization_id = run.organization_id
    join public.organizations organization on organization.id = run.organization_id
    cross join lateral (
      select public.effective_work_priority(
        project.engineering_priority, project.strategic_focus,
        public.is_emergency_work(task.id, command.id), run.created_at,
        organization.fairness_promotion_seconds, now()
      ) as value
    ) withheld_priority
    cross join lateral public.portfolio_capacity_verdict(
      run.organization_id, run.project_id, run.provider, run.connection_id,
      withheld_priority.value
    ) withheld_verdict
    where run.status = 'queued'::public.run_status
      and run.provider = p_provider and run.model = p_model
      and run.cancellation_requested_at is null
      and run.attempt_number < run.max_attempts
      and project.status = 'active'::public.project_status
      and not project.engineering_paused
      and not exists (
        select 1 from public.task_dependencies dependency
        join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
          and prerequisite.organization_id = dependency.organization_id
        where dependency.task_id = task.id
          and dependency.organization_id = task.organization_id
          and prerequisite.status <> 'completed'::public.task_status
      )
      and not withheld_verdict.allowed
    order by withheld_priority.value asc, run.created_at asc
    limit 1;

    if found then
      insert into public.scheduling_decisions (
        organization_id, decision, project_id, worker_id, provider, model,
        effective_priority, reason, capacity
      )
      select withheld_candidate.organization_id, 'withheld',
        withheld_candidate.project_id, p_worker_id, p_provider, p_model,
        withheld_candidate.effective_priority, withheld_candidate.reason,
        withheld_candidate.capacity
      -- A worker polls continuously, and a ceiling stays binding for as long as
      -- the work it is holding runs. Without this the audit would be one row per
      -- poll for the same unchanged fact.
      where not exists (
        select 1 from public.scheduling_decisions recent
        where recent.organization_id = withheld_candidate.organization_id
          and recent.worker_id = p_worker_id
          and recent.decision = 'withheld'
          and recent.reason = withheld_candidate.reason
          and recent.occurred_at > now() - interval '1 minute'
      );
    end if;
    return;
  end if;

  update public.agent_runs run set
    status = 'running'::public.run_status, lease_worker_id = p_worker_id,
    lease_token = new_lease_token,
    lease_expires_at = now() + make_interval(secs => bounded_lease_seconds),
    attempt_number = run.attempt_number + 1, retryable = false,
    error_code = null, error_message = null,
    started_at = coalesce(run.started_at, now()), completed_at = null, updated_at = now()
  where run.id = claimed_run_id returning run.* into claimed_run;
  update public.tasks task set status = 'in_progress'::public.task_status,
    started_at = coalesce(task.started_at, now()), updated_at = now()
    where task.id = claimed_run.task_id;
  update public.commands command set status = 'running'::public.command_status, updated_at = now()
    where command.id = claimed_run.command_id;
  update public.agents agent set status = 'busy'::public.agent_status,
    current_assignment = claimed_run.task_id::text, last_run_at = now(), updated_at = now()
    where agent.id = claimed_run.agent_id;
  update public.phase1c_workers worker set current_run_id = claimed_run.id,
    last_heartbeat_at = now(), updated_at = now() where worker.worker_id = p_worker_id;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    claimed_run.organization_id, claimed_run.id, claimed_run.attempt_number,
    'claimed', 'Worker claimed the durable run lease.',
    jsonb_build_object('workerId', p_worker_id, 'leaseSeconds', bounded_lease_seconds)
  );

  -- Goal 28: project, task, agent, provider, connection and reason, on every
  -- assignment. The capacity snapshot is taken *after* the claim, so it shows
  -- the state this assignment produced rather than the state it was weighed
  -- against; the effective priority records what it was weighed at.
  select * into claimed_verdict from public.portfolio_capacity_verdict(
    claimed_run.organization_id, claimed_run.project_id, claimed_run.provider,
    claimed_run.connection_id, claimed_priority
  );
  insert into public.scheduling_decisions (
    organization_id, decision, project_id, run_id, task_id, agent_id,
    connection_id, worker_id, provider, model, effective_priority, reason,
    capacity
  ) values (
    claimed_run.organization_id, 'assigned', claimed_run.project_id,
    claimed_run.id, claimed_run.task_id, claimed_run.agent_id,
    claimed_run.connection_id, p_worker_id, claimed_run.provider,
    claimed_run.model, claimed_priority,
    'Highest effective priority P' || claimed_priority::text
      || ' within project, provider and portfolio capacity.',
    claimed_verdict.capacity
  );

  return query
  select run.id, run.organization_id, run.project_id, run.task_id,
    run.command_id, run.agent_id, command.prompt, command.command_type,
    run.risk_level, command.acceptance_criteria, command.execution_plan,
    run.connection_id, run.github_repository_id, installation.id,
    installation.external_installation_id, installation.app_id,
    repository.external_repository_id, repository.full_name,
    run.base_branch, run.base_sha, run.lease_token, run.lease_expires_at,
    run.attempt_number, run.cancellation_requested_at is not null,
    run.logical_agent_role::text, run.provider, run.model,
    least(
      (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer,
      greatest(1, floor(extract(epoch from (
        run.started_at + make_interval(secs =>
          (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0
        ) - now()
      )) * 1000)::integer)
    ),
    (command.parameters -> 'budget' ->> 'maximumTurns')::integer,
    (command.parameters -> 'budget' ->> 'maximumInputTokens')::integer,
    (command.parameters -> 'budget' ->> 'maximumOutputTokens')::integer,
    (command.parameters -> 'budget' ->> 'maximumRepairAttempts')::integer,
    (command.parameters -> 'budget' ->> 'ciTimeoutMs')::integer,
    null::uuid, null::timestamptz,
    case when exists (select 1 from public.phase1c_run_artifacts branch
      where branch.run_id = run.id and branch.artifact_type = 'branch'
        and branch.reference = run.head_branch) then run.head_branch end,
    case when exists (select 1 from public.phase1c_run_artifacts commit
      where commit.run_id = run.id and commit.artifact_type = 'commit'
        and lower(commit.reference) = run.head_sha) then run.head_sha end,
    pull.external_number, pull.url,
    case when exists (select 1 from public.phase1c_run_artifacts branch
      where branch.run_id = run.id and branch.artifact_type = 'branch'
        and branch.reference = run.head_branch)
      and exists (select 1 from public.phase1c_run_artifacts commit
        where commit.run_id = run.id and commit.artifact_type = 'commit'
          and lower(commit.reference) = run.head_sha)
      then run.provider_run_reference end,
    case when exists (select 1 from public.phase1c_run_artifacts branch
      where branch.run_id = run.id and branch.artifact_type = 'branch'
        and branch.reference = run.head_branch)
      and exists (select 1 from public.phase1c_run_artifacts commit
        where commit.run_id = run.id and commit.artifact_type = 'commit'
          and lower(commit.reference) = run.head_sha)
      then run.usage else '{}'::jsonb end
  from public.agent_runs run
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.github_repositories repository on repository.id = run.github_repository_id
    and repository.organization_id = run.organization_id
  join public.github_installations installation on installation.id = repository.installation_id
    and installation.organization_id = repository.organization_id
  left join public.pull_requests pull on pull.agent_run_id = run.id
    and pull.status = 'draft'::public.pull_request_status
  where run.id = claimed_run.id;
end;
$function$;
revoke all on function public.portfolio_capacity_verdict(uuid, uuid, text, uuid, smallint)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_budget_internal(text, text, text, integer)
  from public, anon, authenticated, service_role;

comment on function public.claim_phase1c_run_budget_internal(text, text, text, integer) is
  'Portfolio-aware selection: effective priority, strategic focus, engineering pause, and worker/project/provider/portfolio ceilings, recorded in scheduling_decisions.';
