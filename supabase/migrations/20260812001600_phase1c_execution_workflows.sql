-- Phase 1C execution workflows.
--
-- Every write to a run, task, workspace, result, or settings row goes through an
-- audited SECURITY DEFINER function here. Authenticated callers keep read-only
-- table privileges; the durable worker boundary uses service-role-only functions
-- that are revoked from anon and authenticated.
--
-- Safety boundaries preserved by this migration:
--   * Commanded execution is OFF by default and owner-gated per organization.
--   * The Phase 1D autonomy kill switch is untouched and still locked ON.
--   * RED tasks still cannot run without an unexpired owner approval; the
--     Phase 1A enforcement triggers remain the final authority.
--   * No approval, merge, deployment, or rollback capability is created.

-- ---------------------------------------------------------------------------
-- Built-in logical agent roster
-- ---------------------------------------------------------------------------

create or replace function public.ensure_default_agents(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  inserted_count integer := 0;
  definition record;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  for definition in
    select *
    from (
      values
        ('Orchestrator', 'orchestrator', 'Interprets owner commands, classifies risk, plans tasks, and assigns agents.', '["planning","risk-classification","task-decomposition"]'),
        ('Product Manager', 'product', 'Turns objectives into acceptance criteria and prioritized backlog items.', '["requirements","acceptance-criteria","prioritization"]'),
        ('Architect', 'architect', 'Reviews structure, boundaries, and technical approach before implementation.', '["architecture","design-review","dependency-analysis"]'),
        ('Frontend Engineer', 'frontend', 'Implements user interface, accessibility, and responsive behavior.', '["ui","accessibility","responsive-design"]'),
        ('Backend Engineer', 'backend', 'Implements server routes, domain logic, and integration boundaries.', '["api","server-logic","integration"]'),
        ('Database Engineer', 'database', 'Designs additive schema changes, indexes, and row level security.', '["schema","migrations","rls"]'),
        ('QA Engineer', 'qa', 'Adds and repairs automated tests and interprets real validation evidence.', '["unit-tests","integration-tests","e2e"]'),
        ('Security Engineer', 'security', 'Reviews authorization, secrets handling, and protected-resource contact.', '["security-review","secret-scanning","authorization"]'),
        ('Performance Engineer', 'performance', 'Investigates latency, payload size, and rendering cost.', '["profiling","performance-budget"]'),
        ('Release Engineer', 'release', 'Prepares reviewable pull requests and reads real CI evidence.', '["pull-requests","ci-observation"]'),
        ('CEO Reporter', 'ceo_reporter', 'Summarizes structured factory data into executive reports.', '["reporting","summarization"]')
    ) as roster(agent_name, agent_role, agent_description, agent_capabilities)
  loop
    insert into public.agents (
      organization_id, name, role, description, status, capabilities, enabled, created_by
    )
    select
      p_organization_id,
      definition.agent_name,
      definition.agent_role::public.agent_role,
      definition.agent_description,
      'idle'::public.agent_status,
      definition.agent_capabilities::jsonb,
      true,
      caller_id
    where not exists (
      select 1
      from public.agents existing
      where existing.organization_id = p_organization_id
        and existing.role = definition.agent_role::public.agent_role
        and existing.project_id is null
    );

    inserted_count := inserted_count + case when found then 1 else 0 end;
  end loop;

  return inserted_count;
end;
$function$;

comment on function public.ensure_default_agents(uuid) is
  'Creates the built-in logical agent roster for an organization. An agent is an operating role and never stores provider credentials.';

-- ---------------------------------------------------------------------------
-- Organization settings
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_settings(p_organization_id uuid)
returns public.organization_settings
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  settings public.organization_settings%rowtype;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access denied';
  end if;

  select * into settings
  from public.organization_settings
  where organization_id = p_organization_id;

  if not found then
    insert into public.organization_settings (organization_id)
    values (p_organization_id)
    on conflict (organization_id) do nothing;

    select * into settings
    from public.organization_settings
    where organization_id = p_organization_id;
  end if;

  return settings;
end;
$function$;

create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_factory_name text default null,
  p_timezone text default null,
  p_execution_enabled boolean default null,
  p_daily_report_enabled boolean default null,
  p_daily_report_hour smallint default null,
  p_max_repair_attempts smallint default null,
  p_max_ci_repair_attempts smallint default null,
  p_max_concurrent_runs smallint default null,
  p_default_provider text default null,
  p_default_model text default null,
  p_notify_on_owner_action boolean default null,
  p_notify_on_run_failure boolean default null,
  p_notify_on_security_finding boolean default null,
  p_activity_retention_days smallint default null
)
returns public.organization_settings
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  previous public.organization_settings%rowtype;
  updated public.organization_settings%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may change factory settings';
  end if;

  insert into public.organization_settings (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select * into previous
  from public.organization_settings
  where organization_id = p_organization_id
  for update;

  update public.organization_settings
  set
    factory_name = coalesce(nullif(btrim(p_factory_name), ''), factory_name),
    timezone = coalesce(nullif(btrim(p_timezone), ''), timezone),
    execution_enabled = coalesce(p_execution_enabled, execution_enabled),
    daily_report_enabled = coalesce(p_daily_report_enabled, daily_report_enabled),
    daily_report_hour = coalesce(p_daily_report_hour, daily_report_hour),
    max_repair_attempts = coalesce(p_max_repair_attempts, max_repair_attempts),
    max_ci_repair_attempts = coalesce(p_max_ci_repair_attempts, max_ci_repair_attempts),
    max_concurrent_runs = coalesce(p_max_concurrent_runs, max_concurrent_runs),
    default_provider = coalesce(nullif(btrim(p_default_provider), ''), default_provider),
    default_model = coalesce(nullif(btrim(p_default_model), ''), default_model),
    notify_on_owner_action = coalesce(p_notify_on_owner_action, notify_on_owner_action),
    notify_on_run_failure = coalesce(p_notify_on_run_failure, notify_on_run_failure),
    notify_on_security_finding = coalesce(p_notify_on_security_finding, notify_on_security_finding),
    activity_retention_days = coalesce(p_activity_retention_days, activity_retention_days),
    updated_by = caller_id
  where organization_id = p_organization_id
  returning * into updated;

  perform public.record_activity_event(
    p_organization_id,
    null,
    'settings.updated'::public.activity_event_type,
    'organization_settings',
    null,
    'Factory settings were updated by an organization owner.',
    jsonb_build_object(
      'execution_enabled_before', previous.execution_enabled,
      'execution_enabled_after', updated.execution_enabled,
      'default_provider', updated.default_provider,
      'max_concurrent_runs', updated.max_concurrent_runs
    )
  );

  return updated;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Project portfolio management
-- ---------------------------------------------------------------------------

create or replace function public.update_project_metadata(
  p_project_id uuid,
  p_name text default null,
  p_description text default null,
  p_status public.project_status default null,
  p_production_url text default null,
  p_tags text[] default null,
  p_vercel_project_id text default null,
  p_vercel_team_slug text default null,
  p_supabase_project_ref text default null
)
returns public.projects
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  updated public.projects%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if p_status is not null and p_status = 'archived'::public.project_status
    and exists (
      select 1
      from public.agent_runs run
      where run.project_id = p_project_id
        and run.status in (
          'queued'::public.run_status,
          'running'::public.run_status,
          'validating'::public.run_status,
          'cancelling'::public.run_status
        )
    ) then
    raise exception using errcode = '55000', message = 'cancel active runs before archiving this project';
  end if;

  update public.projects
  set
    name = coalesce(nullif(btrim(p_name), ''), name),
    description = coalesce(p_description, description),
    status = coalesce(p_status, status),
    production_url = coalesce(nullif(btrim(p_production_url), ''), production_url),
    tags = coalesce(p_tags, tags),
    vercel_project_id = coalesce(nullif(btrim(p_vercel_project_id), ''), vercel_project_id),
    vercel_team_slug = coalesce(nullif(btrim(p_vercel_team_slug), ''), vercel_team_slug),
    supabase_project_ref = coalesce(nullif(btrim(p_supabase_project_ref), ''), supabase_project_ref),
    archived_at = case
      when coalesce(p_status, status) = 'archived'::public.project_status then coalesce(archived_at, now())
      else null
    end
  where id = p_project_id
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  return updated;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Backlog management
-- ---------------------------------------------------------------------------

create or replace function public.upsert_backlog_task(
  p_project_id uuid,
  p_title text,
  p_description text default null,
  p_acceptance_criteria text default null,
  p_risk public.risk_level default 'green'::public.risk_level,
  p_priority smallint default 50,
  p_status public.task_status default 'backlog'::public.task_status,
  p_source public.task_source default 'owner'::public.task_source,
  p_assigned_agent_id uuid default null,
  p_depends_on_task_id uuid default null,
  p_task_id uuid default null
)
returns public.tasks
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  result public.tasks%rowtype;
  normalized_title text := btrim(coalesce(p_title, ''));
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if char_length(normalized_title) < 1 or char_length(normalized_title) > 240 then
    raise exception using errcode = '22023', message = 'backlog title must contain 1 to 240 characters';
  end if;
  if public.text_has_likely_secret(normalized_title)
    or (p_description is not null and public.text_has_likely_secret(p_description))
    or (p_acceptance_criteria is not null and public.text_has_likely_secret(p_acceptance_criteria)) then
    raise exception using errcode = '22023', message = 'backlog items cannot contain credentials or likely secret values';
  end if;

  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if p_depends_on_task_id is not null and not exists (
    select 1 from public.tasks dependency
    where dependency.id = p_depends_on_task_id
      and dependency.organization_id = project_record.organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'dependency task not found in this organization';
  end if;

  if p_assigned_agent_id is not null and not exists (
    select 1 from public.agents agent
    where agent.id = p_assigned_agent_id
      and agent.organization_id = project_record.organization_id
      and agent.enabled
  ) then
    raise exception using errcode = 'P0002', message = 'assigned agent is not available in this organization';
  end if;

  if p_task_id is null then
    insert into public.tasks (
      organization_id, project_id, title, description, acceptance_criteria,
      status, risk_level, priority, source, assigned_agent_id, depends_on_task_id, created_by
    )
    values (
      project_record.organization_id, p_project_id, normalized_title, p_description, p_acceptance_criteria,
      p_status, p_risk, p_priority, p_source, p_assigned_agent_id, p_depends_on_task_id, caller_id
    )
    returning * into result;
  else
    update public.tasks
    set
      title = normalized_title,
      description = coalesce(p_description, description),
      acceptance_criteria = coalesce(p_acceptance_criteria, acceptance_criteria),
      status = p_status,
      priority = p_priority,
      source = p_source,
      assigned_agent_id = p_assigned_agent_id,
      depends_on_task_id = p_depends_on_task_id,
      completed_at = case
        when p_status in ('completed'::public.task_status, 'failed'::public.task_status, 'cancelled'::public.task_status)
          then coalesce(completed_at, now())
        else null
      end
    where id = p_task_id
      and organization_id = project_record.organization_id
    returning * into result;

    if not found then
      raise exception using errcode = 'P0002', message = 'task not found';
    end if;
  end if;

  perform public.record_activity_event(
    project_record.organization_id,
    p_project_id,
    case when p_task_id is null
      then 'task.created'::public.activity_event_type
      else 'task.updated'::public.activity_event_type
    end,
    'task',
    result.id,
    left('Backlog item ' || case when p_task_id is null then 'created' else 'updated' end || ': ' || normalized_title, 500),
    jsonb_build_object('status', result.status, 'risk', result.risk_level, 'source', result.source)
  );

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Command planning
-- ---------------------------------------------------------------------------

create or replace function public.persist_command_plan(
  p_command_id uuid,
  p_plan jsonb
)
returns table (
  command_id uuid,
  command_state public.command_status,
  task_ids uuid[],
  run_ids uuid[]
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  command_record public.commands%rowtype;
  project_record public.projects%rowtype;
  settings public.organization_settings%rowtype;
  plan_task jsonb;
  created_task_ids uuid[] := array[]::uuid[];
  created_run_ids uuid[] := array[]::uuid[];
  key_to_task jsonb := '{}'::jsonb;
  new_task_id uuid;
  new_run_id uuid;
  target_agent_id uuid;
  dependency_id uuid;
  target_role public.agent_role;
  task_risk public.risk_level;
  requires_owner_action boolean := coalesce((p_plan ->> 'requiresOwnerAction')::boolean, false);
  final_state public.command_status;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if jsonb_typeof(coalesce(p_plan, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'plan must be a JSON object';
  end if;
  if public.jsonb_has_sensitive_keys(p_plan) then
    raise exception using errcode = '23514', message = 'plans cannot contain credentials or sensitive keys';
  end if;

  select * into command_record from public.commands where id = p_command_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'command not found';
  end if;
  if command_record.submitted_by <> caller_id
    and not public.can_manage_organization(command_record.organization_id) then
    raise exception using errcode = '42501', message = 'command access denied';
  end if;
  if command_record.status not in (
    'submitted'::public.command_status,
    'planning'::public.command_status,
    'awaiting_approval'::public.command_status,
    'queued'::public.command_status
  ) then
    raise exception using errcode = '55000', message = 'this command has already advanced past planning';
  end if;
  if exists (
    select 1 from public.tasks task
    where task.command_id = command_record.id
      and task.source = 'orchestrator'::public.task_source
  ) then
    raise exception using errcode = '55000', message = 'this command already has a persisted plan';
  end if;

  select * into project_record from public.projects where id = command_record.project_id;
  settings := public.get_organization_settings(command_record.organization_id);

  for plan_task in select * from jsonb_array_elements(coalesce(p_plan -> 'tasks', '[]'::jsonb))
  loop
    target_role := coalesce(plan_task ->> 'agentRole', 'backend')::public.agent_role;
    task_risk := coalesce(plan_task ->> 'risk', 'green')::public.risk_level;

    select agent.id into target_agent_id
    from public.agents agent
    where agent.organization_id = command_record.organization_id
      and agent.role = target_role
      and agent.enabled
      and (agent.project_id is null or agent.project_id = command_record.project_id)
    order by (agent.project_id is null), agent.created_at
    limit 1;

    if target_agent_id is null then
      raise exception using errcode = 'P0002',
        message = 'no enabled agent is available for role ' || target_role::text;
    end if;

    dependency_id := null;
    if plan_task ? 'dependsOn' and jsonb_typeof(plan_task -> 'dependsOn') = 'string' then
      dependency_id := nullif(key_to_task ->> (plan_task ->> 'dependsOn'), '')::uuid;
    end if;

    insert into public.tasks (
      organization_id, project_id, command_id, assigned_agent_id, title, description,
      acceptance_criteria, status, risk_level, priority, source, depends_on_task_id, input, created_by
    )
    values (
      command_record.organization_id,
      command_record.project_id,
      command_record.id,
      target_agent_id,
      left(btrim(coalesce(plan_task ->> 'title', 'Untitled task')), 240),
      plan_task ->> 'description',
      plan_task ->> 'acceptanceCriteria',
      case
        when task_risk = 'red'::public.risk_level then 'awaiting_approval'::public.task_status
        when dependency_id is not null then 'blocked'::public.task_status
        else 'queued'::public.task_status
      end,
      task_risk,
      coalesce((plan_task ->> 'priority')::smallint, 50),
      'orchestrator'::public.task_source,
      dependency_id,
      jsonb_strip_nulls(jsonb_build_object(
        'workType', plan_task ->> 'workType',
        'validationPlan', plan_task -> 'validationPlan'
      )),
      caller_id
    )
    returning id into new_task_id;

    created_task_ids := created_task_ids || new_task_id;
    if plan_task ? 'key' then
      key_to_task := key_to_task || jsonb_build_object(plan_task ->> 'key', new_task_id::text);
    end if;

    insert into public.agent_runs (
      organization_id, project_id, task_id, agent_id, status, provider, model,
      max_attempts, step, input
    )
    values (
      command_record.organization_id,
      command_record.project_id,
      new_task_id,
      target_agent_id,
      'queued'::public.run_status,
      coalesce(nullif(btrim(plan_task ->> 'provider'), ''), settings.default_provider),
      coalesce(nullif(btrim(plan_task ->> 'model'), ''), settings.default_model),
      greatest(1, least(10, coalesce(settings.max_repair_attempts, 2)::integer + 1)),
      'resolve_repository',
      jsonb_strip_nulls(jsonb_build_object(
        'commandId', command_record.id::text,
        'workType', plan_task ->> 'workType'
      ))
    )
    returning id into new_run_id;

    created_run_ids := created_run_ids || new_run_id;

    insert into public.run_events (
      organization_id, project_id, agent_run_id, sequence, event_type, message, metadata
    )
    values (
      command_record.organization_id,
      command_record.project_id,
      new_run_id,
      1,
      'run.queued'::public.run_event_type,
      'Run queued for durable execution.',
      jsonb_build_object('taskId', new_task_id::text, 'risk', task_risk)
    );
  end loop;

  -- The intake task recorded at submission is superseded by the concrete plan so
  -- the backlog never shows a queued item that no run will ever pick up.
  if array_length(created_task_ids, 1) is not null then
    update public.tasks as intake
    set status = 'superseded'::public.task_status,
        description = coalesce(intake.description, '') || ' Superseded by the orchestrator plan.'
    where intake.command_id = command_record.id
      and intake.source = 'owner'::public.task_source
      and intake.status not in (
        'completed'::public.task_status,
        'failed'::public.task_status,
        'cancelled'::public.task_status
      );
  end if;

  final_state := case
    when requires_owner_action then 'owner_action_required'::public.command_status
    when array_length(created_run_ids, 1) is null then 'succeeded'::public.command_status
    when exists (
      select 1 from public.tasks task
      where task.command_id = command_record.id
        and task.risk_level = 'red'::public.risk_level
    ) then 'awaiting_approval'::public.command_status
    when not coalesce(settings.execution_enabled, false) then 'owner_action_required'::public.command_status
    else 'queued'::public.command_status
  end;

  update public.commands
  set status = final_state,
      parameters = parameters || jsonb_build_object(
        'planSummary', left(coalesce(p_plan ->> 'summary', ''), 2000),
        'plannedTasks', coalesce(jsonb_array_length(p_plan -> 'tasks'), 0)
      ),
      completed_at = case when final_state = 'succeeded'::public.command_status then now() else null end
  where id = command_record.id;

  perform public.record_activity_event(
    command_record.organization_id,
    command_record.project_id,
    'command.planned'::public.activity_event_type,
    'command',
    command_record.id,
    left('Command planned into ' || coalesce(array_length(created_task_ids, 1), 0) || ' task(s).', 500),
    jsonb_build_object(
      'commandState', final_state,
      'taskCount', coalesce(array_length(created_task_ids, 1), 0),
      'executionEnabled', coalesce(settings.execution_enabled, false)
    )
  );

  return query select command_record.id, final_state, created_task_ids, created_run_ids;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Cancellation
-- ---------------------------------------------------------------------------

create or replace function public.request_run_cancellation(
  p_run_id uuid,
  p_reason text default null
)
returns public.agent_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  run_record public.agent_runs%rowtype;
  updated public.agent_runs%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into run_record from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;
  if not public.can_manage_organization(run_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if run_record.status in ('succeeded'::public.run_status, 'failed'::public.run_status, 'cancelled'::public.run_status) then
    raise exception using errcode = '55000', message = 'this run has already finished';
  end if;

  -- A queued run is cancelled immediately. A leased run is marked cancelling so
  -- the worker stops before any further external effect, including PR creation.
  update public.agent_runs
  set
    cancel_requested_at = now(),
    cancel_requested_by = caller_id,
    status = case
      when run_record.status = 'queued'::public.run_status then 'cancelled'::public.run_status
      else 'cancelling'::public.run_status
    end,
    completed_at = case when run_record.status = 'queued'::public.run_status then now() else completed_at end,
    failure_kind = case when run_record.status = 'queued'::public.run_status then 'cancelled'::public.run_failure_kind else failure_kind end,
    lease_owner = case when run_record.status = 'queued'::public.run_status then null else lease_owner end,
    lease_expires_at = case when run_record.status = 'queued'::public.run_status then null else lease_expires_at end
  where id = p_run_id
  returning * into updated;

  insert into public.run_events (
    organization_id, project_id, agent_run_id, sequence, event_type, message, metadata
  )
  select
    updated.organization_id,
    updated.project_id,
    updated.id,
    coalesce(max(event.sequence), 0) + 1,
    'run.cancelled'::public.run_event_type,
    left('Cancellation requested by an organization manager.' ||
      case when p_reason is null then '' else ' Reason: ' || left(btrim(p_reason), 300) end, 500),
    jsonb_build_object('immediate', updated.status = 'cancelled'::public.run_status)
  from public.run_events event
  where event.agent_run_id = updated.id;

  perform public.record_activity_event(
    updated.organization_id,
    updated.project_id,
    'run.cancelled'::public.activity_event_type,
    'agent_run',
    updated.id,
    'Run cancellation was requested.',
    jsonb_build_object('status', updated.status)
  );

  return updated;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Durable worker boundary (service role only)
-- ---------------------------------------------------------------------------

create or replace function public.record_run_event(
  p_run_id uuid,
  p_event_type public.run_event_type,
  p_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  next_sequence bigint;
begin
  select * into run_record from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;
  if public.jsonb_has_sensitive_keys(coalesce(p_metadata, '{}'::jsonb)) then
    raise exception using errcode = '23514', message = 'run event metadata contains sensitive data';
  end if;

  select coalesce(max(event.sequence), 0) + 1 into next_sequence
  from public.run_events event
  where event.agent_run_id = p_run_id;

  insert into public.run_events (
    organization_id, project_id, agent_run_id, sequence, event_type, message, metadata
  )
  values (
    run_record.organization_id,
    run_record.project_id,
    p_run_id,
    next_sequence,
    p_event_type,
    left(btrim(coalesce(p_message, 'Execution event.')), 500),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return next_sequence;
end;
$function$;

create or replace function public.claim_agent_runs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns setof public.agent_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  candidate public.agent_runs%rowtype;
  claimed public.agent_runs%rowtype;
  claimed_count integer := 0;
  active_runs integer;
  concurrency_limit integer;
  bounded_limit integer := greatest(1, least(10, coalesce(p_limit, 1)));
  bounded_lease integer := greatest(30, least(900, coalesce(p_lease_seconds, 300)));
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'a worker id is required';
  end if;

  for candidate in
    select run.*
    from public.agent_runs run
    join public.tasks task on task.id = run.task_id
    join public.organization_settings settings on settings.organization_id = run.organization_id
    where settings.execution_enabled
      and (run.next_attempt_at is null or run.next_attempt_at <= now())
      and (
        run.status = 'queued'::public.run_status
        or (
          run.status in ('running'::public.run_status, 'validating'::public.run_status)
          and run.lease_expires_at is not null
          and run.lease_expires_at < now()
        )
      )
      -- RED work is never claimed without an unexpired owner approval.
      and (task.risk_level <> 'red'::public.risk_level or public.has_valid_owner_approval(task.id))
      -- Dependent work never runs before its dependency completes.
      and (
        task.depends_on_task_id is null
        or exists (
          select 1 from public.tasks dependency
          where dependency.id = task.depends_on_task_id
            and dependency.status = 'completed'::public.task_status
        )
      )
      and run.cancel_requested_at is null
    order by run.next_attempt_at nulls first, run.created_at
    limit bounded_limit * 4
    for update of run skip locked
  loop
    exit when claimed_count >= bounded_limit;

    select settings.max_concurrent_runs into concurrency_limit
    from public.organization_settings settings
    where settings.organization_id = candidate.organization_id;

    select count(*) into active_runs
    from public.agent_runs active
    where active.organization_id = candidate.organization_id
      and active.id <> candidate.id
      and active.lease_expires_at is not null
      and active.lease_expires_at > now();

    if active_runs >= coalesce(concurrency_limit, 2) then
      continue;
    end if;

    if candidate.status <> 'queued'::public.run_status then
      insert into public.run_events (
        organization_id, project_id, agent_run_id, sequence, event_type, message, metadata
      )
      select
        candidate.organization_id, candidate.project_id, candidate.id,
        coalesce(max(event.sequence), 0) + 1,
        'run.lease_expired'::public.run_event_type,
        'A previous worker lease expired; the run was safely reclaimed.',
        jsonb_build_object('previousStatus', candidate.status)
      from public.run_events event
      where event.agent_run_id = candidate.id;
    end if;

    update public.agent_runs
    set
      status = 'running'::public.run_status,
      lease_owner = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => bounded_lease),
      heartbeat_at = now(),
      -- An attempt is counted once when the run first starts. A run that is
      -- released mid-flight between ticks resumes without spending its retry
      -- budget; a genuine retry is counted by finish_agent_run instead.
      attempt = case when started_at is null then attempt + 1 else attempt end,
      started_at = coalesce(started_at, now()),
      next_attempt_at = null
    where id = candidate.id
    returning * into claimed;

    update public.tasks
    set status = 'in_progress'::public.task_status,
        started_at = coalesce(started_at, now())
    where id = candidate.task_id
      and status in ('queued'::public.task_status, 'blocked'::public.task_status);

    claimed_count := claimed_count + 1;
    return next claimed;
  end loop;

  return;
end;
$function$;

comment on function public.claim_agent_runs(text, integer, integer) is
  'Service-role-only durable lease. Skips locked rows, honors organization concurrency, refuses unapproved RED work, and refuses dependent work whose dependency has not completed.';

create or replace function public.heartbeat_agent_run(
  p_run_id uuid,
  p_worker_id text,
  p_step text default null,
  p_lease_seconds integer default 300
)
returns public.agent_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  updated public.agent_runs%rowtype;
  bounded_lease integer := greatest(30, least(900, coalesce(p_lease_seconds, 300)));
begin
  update public.agent_runs
  set
    heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => bounded_lease),
    step = coalesce(nullif(btrim(p_step), ''), step)
  where id = p_run_id
    and lease_owner = btrim(coalesce(p_worker_id, ''))
  returning * into updated;

  if not found then
    raise exception using errcode = '42501', message = 'the run lease is no longer held by this worker';
  end if;

  return updated;
end;
$function$;

create or replace function public.finish_agent_run(
  p_run_id uuid,
  p_worker_id text,
  p_status public.run_status,
  p_failure_kind public.run_failure_kind default null,
  p_error_message text default null,
  p_retry_after_seconds integer default null
)
returns public.agent_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  updated public.agent_runs%rowtype;
  should_retry boolean := false;
begin
  select * into run_record from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;
  if run_record.lease_owner is distinct from btrim(coalesce(p_worker_id, '')) then
    raise exception using errcode = '42501', message = 'the run lease is no longer held by this worker';
  end if;
  if p_status not in (
    'succeeded'::public.run_status,
    'failed'::public.run_status,
    'cancelled'::public.run_status,
    'awaiting_review'::public.run_status,
    'validating'::public.run_status
  ) then
    raise exception using errcode = '22023', message = 'unsupported terminal run status';
  end if;

  -- Bounded retry. Transient provider and rate-limit failures may retry; policy
  -- failures never do.
  should_retry := p_status = 'failed'::public.run_status
    and p_failure_kind in (
      'provider_outage'::public.run_failure_kind,
      'provider_rate_limit'::public.run_failure_kind,
      'github_rate_limit'::public.run_failure_kind,
      'worker_timeout'::public.run_failure_kind
    )
    and run_record.attempt < run_record.max_attempts;

  update public.agent_runs
  set
    status = case
      when should_retry then 'queued'::public.run_status
      else p_status
    end,
    attempt = case when should_retry then attempt + 1 else attempt end,
    failure_kind = case
      when should_retry then null
      when p_status in ('failed'::public.run_status, 'cancelled'::public.run_status) then p_failure_kind
      else null
    end,
    error_message = case
      when p_error_message is null then error_message
      else left(btrim(p_error_message), 1000)
    end,
    completed_at = case
      when should_retry then null
      when p_status in ('succeeded'::public.run_status, 'failed'::public.run_status, 'cancelled'::public.run_status) then now()
      else null
    end,
    next_attempt_at = case
      when should_retry then now() + make_interval(secs => greatest(30, least(3600, coalesce(p_retry_after_seconds, 60))))
      else null
    end,
    lease_owner = null,
    lease_expires_at = null
  where id = p_run_id
  returning * into updated;

  update public.tasks
  set
    status = case
      when updated.status = 'succeeded'::public.run_status then 'completed'::public.task_status
      when updated.status = 'failed'::public.run_status then 'failed'::public.task_status
      when updated.status = 'cancelled'::public.run_status then 'cancelled'::public.task_status
      when updated.status = 'awaiting_review'::public.run_status then 'blocked'::public.task_status
      else status
    end,
    completed_at = case
      when updated.status in ('succeeded'::public.run_status, 'failed'::public.run_status, 'cancelled'::public.run_status)
        then now()
      else completed_at
    end
  where id = updated.task_id
    and updated.status in (
      'succeeded'::public.run_status,
      'failed'::public.run_status,
      'cancelled'::public.run_status,
      'awaiting_review'::public.run_status
    );

  if updated.status in ('succeeded'::public.run_status, 'failed'::public.run_status) then
    update public.agents
    set
      total_runs = total_runs + 1,
      succeeded_runs = succeeded_runs + case when updated.status = 'succeeded'::public.run_status then 1 else 0 end,
      failed_runs = failed_runs + case when updated.status = 'failed'::public.run_status then 1 else 0 end,
      last_run_at = now()
    where id = updated.agent_id;
  end if;

  return updated;
end;
$function$;

create or replace function public.record_run_workspace(
  p_run_id uuid,
  p_worker_id text,
  p_repository text,
  p_external_repository_id bigint,
  p_base_branch text,
  p_base_sha text,
  p_working_branch text,
  p_provider text,
  p_model text
)
returns public.run_workspaces
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  workspace public.run_workspaces%rowtype;
begin
  select * into run_record from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;
  if run_record.lease_owner is distinct from btrim(coalesce(p_worker_id, '')) then
    raise exception using errcode = '42501', message = 'the run lease is no longer held by this worker';
  end if;

  insert into public.run_workspaces (
    organization_id, project_id, agent_run_id, repository, external_repository_id,
    base_branch, base_sha, working_branch, provider, model
  )
  values (
    run_record.organization_id, run_record.project_id, p_run_id, p_repository, p_external_repository_id,
    p_base_branch, lower(p_base_sha), p_working_branch, p_provider, p_model
  )
  on conflict (agent_run_id) do update
  set base_sha = excluded.base_sha,
      base_branch = excluded.base_branch
  returning * into workspace;

  return workspace;
end;
$function$;

create or replace function public.record_run_result(
  p_run_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns public.run_results
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  stored public.run_results%rowtype;
begin
  select * into run_record from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;
  if run_record.lease_owner is distinct from btrim(coalesce(p_worker_id, '')) then
    raise exception using errcode = '42501', message = 'the run lease is no longer held by this worker';
  end if;
  if jsonb_typeof(coalesce(p_result, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'result must be a JSON object';
  end if;
  if public.jsonb_has_sensitive_keys(p_result) then
    raise exception using errcode = '23514', message = 'run results cannot contain credentials or sensitive keys';
  end if;

  insert into public.run_results (
    organization_id, project_id, agent_run_id, summary, files_changed, additions, deletions,
    commits, tests_outcome, lint_outcome, typecheck_outcome, build_outcome, risk_level,
    changed_files, warnings, blockers, security_findings, next_recommendation
  )
  values (
    run_record.organization_id,
    run_record.project_id,
    p_run_id,
    left(btrim(coalesce(p_result ->> 'summary', 'No summary was produced.')), 4000),
    coalesce((p_result ->> 'filesChanged')::integer, 0),
    coalesce((p_result ->> 'additions')::integer, 0),
    coalesce((p_result ->> 'deletions')::integer, 0),
    coalesce((p_result ->> 'commits')::integer, 0),
    coalesce(p_result ->> 'testsOutcome', 'not_run')::public.validation_outcome,
    coalesce(p_result ->> 'lintOutcome', 'not_run')::public.validation_outcome,
    coalesce(p_result ->> 'typecheckOutcome', 'not_run')::public.validation_outcome,
    coalesce(p_result ->> 'buildOutcome', 'not_run')::public.validation_outcome,
    coalesce(p_result ->> 'riskLevel', 'green')::public.risk_level,
    coalesce(p_result -> 'changedFiles', '[]'::jsonb),
    coalesce(p_result -> 'warnings', '[]'::jsonb),
    coalesce(p_result -> 'blockers', '[]'::jsonb),
    coalesce(p_result -> 'securityFindings', '[]'::jsonb),
    left(p_result ->> 'nextRecommendation', 2000)
  )
  on conflict (agent_run_id) do update
  set summary = excluded.summary,
      files_changed = excluded.files_changed,
      additions = excluded.additions,
      deletions = excluded.deletions,
      commits = excluded.commits,
      tests_outcome = excluded.tests_outcome,
      lint_outcome = excluded.lint_outcome,
      typecheck_outcome = excluded.typecheck_outcome,
      build_outcome = excluded.build_outcome,
      risk_level = excluded.risk_level,
      changed_files = excluded.changed_files,
      warnings = excluded.warnings,
      blockers = excluded.blockers,
      security_findings = excluded.security_findings,
      next_recommendation = excluded.next_recommendation
  returning * into stored;

  return stored;
end;
$function$;

create or replace function public.record_run_pull_request(
  p_run_id uuid,
  p_worker_id text,
  p_repository text,
  p_external_number integer,
  p_title text,
  p_url text,
  p_head_branch text,
  p_base_branch text,
  p_risk public.risk_level default 'green'::public.risk_level
)
returns public.pull_requests
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  stored public.pull_requests%rowtype;
begin
  select * into run_record from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;
  if run_record.lease_owner is distinct from btrim(coalesce(p_worker_id, '')) then
    raise exception using errcode = '42501', message = 'the run lease is no longer held by this worker';
  end if;

  insert into public.pull_requests (
    organization_id, project_id, agent_run_id, repository, external_number,
    title, url, head_branch, base_branch, status, risk_level, opened_at
  )
  values (
    run_record.organization_id, run_record.project_id, p_run_id, p_repository, p_external_number,
    left(btrim(p_title), 300), p_url, p_head_branch, p_base_branch,
    'draft'::public.pull_request_status, p_risk, now()
  )
  on conflict (project_id, repository, external_number) do update
  set title = excluded.title,
      status = excluded.status,
      agent_run_id = excluded.agent_run_id
  returning * into stored;

  update public.tasks set pull_request_id = stored.id where id = run_record.task_id;

  return stored;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Privilege boundaries
-- ---------------------------------------------------------------------------

revoke all on function public.ensure_default_agents(uuid) from public, anon;
revoke all on function public.get_organization_settings(uuid) from public, anon;
revoke all on function public.update_organization_settings(
  uuid, text, text, boolean, boolean, smallint, smallint, smallint, smallint, text, text, boolean, boolean, boolean, smallint
) from public, anon;
revoke all on function public.update_project_metadata(
  uuid, text, text, public.project_status, text, text[], text, text, text
) from public, anon;
revoke all on function public.upsert_backlog_task(
  uuid, text, text, text, public.risk_level, smallint, public.task_status, public.task_source, uuid, uuid, uuid
) from public, anon;
revoke all on function public.persist_command_plan(uuid, jsonb) from public, anon;
revoke all on function public.request_run_cancellation(uuid, text) from public, anon;

grant execute on function public.ensure_default_agents(uuid) to authenticated;
grant execute on function public.get_organization_settings(uuid) to authenticated;
grant execute on function public.update_organization_settings(
  uuid, text, text, boolean, boolean, smallint, smallint, smallint, smallint, text, text, boolean, boolean, boolean, smallint
) to authenticated;
grant execute on function public.update_project_metadata(
  uuid, text, text, public.project_status, text, text[], text, text, text
) to authenticated;
grant execute on function public.upsert_backlog_task(
  uuid, text, text, text, public.risk_level, smallint, public.task_status, public.task_source, uuid, uuid, uuid
) to authenticated;
grant execute on function public.persist_command_plan(uuid, jsonb) to authenticated;
grant execute on function public.request_run_cancellation(uuid, text) to authenticated;

-- The durable worker boundary is service-role only. No browser session and no
-- authenticated user may drive run execution directly.
revoke all on function public.record_run_event(uuid, public.run_event_type, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_agent_runs(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_agent_run(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_agent_run(uuid, text, public.run_status, public.run_failure_kind, text, integer)
  from public, anon, authenticated;
revoke all on function public.record_run_workspace(uuid, text, text, bigint, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.record_run_result(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_run_pull_request(uuid, text, text, integer, text, text, text, text, public.risk_level)
  from public, anon, authenticated;
revoke all on function public.reject_run_event_mutation() from public, anon, authenticated;

comment on function public.persist_command_plan(uuid, jsonb) is
  'Persists an orchestrator plan as tasks and queued runs. A queued run is intent and evidence only; it is never proof that work succeeded.';
comment on function public.finish_agent_run(uuid, text, public.run_status, public.run_failure_kind, text, integer) is
  'Terminal run transition with bounded retry. Only transient provider, rate-limit, and timeout failures may retry; policy failures never do.';
