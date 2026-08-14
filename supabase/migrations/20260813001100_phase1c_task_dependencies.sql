-- Phase 1C task-dependency submission and cumulative retry budgets.
--
-- Dependency IDs are tenant/project scoped and persisted in the same
-- transaction as command/task creation. Retry claims consume the original
-- total turn/token budgets; a new lease never resets prior provider usage.

create or replace function public.canonical_phase1c_usage(p_usage jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  usage_entry record;
  numeric_value numeric;
begin
  if jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid Phase 1C usage evidence';
  end if;

  for usage_entry in
    select entry.key, entry.value from jsonb_each(coalesce(p_usage, '{}'::jsonb)) entry
  loop
    if usage_entry.key not in (
      'turns', 'inputTokens', 'cachedInputTokens',
      'outputTokens', 'reasoningOutputTokens'
    ) or jsonb_typeof(usage_entry.value) <> 'number'
      or usage_entry.value::text !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'invalid Phase 1C usage evidence';
    end if;
    numeric_value := usage_entry.value::text::numeric;
    if (usage_entry.key = 'turns' and numeric_value > 1000)
      or (usage_entry.key <> 'turns' and numeric_value > 2000000000) then
      raise exception using errcode = '22023', message = 'invalid Phase 1C usage evidence';
    end if;
  end loop;

  return jsonb_build_object(
    'turns', coalesce(p_usage ->> 'turns', '0')::integer,
    'inputTokens', coalesce(p_usage ->> 'inputTokens', '0')::integer,
    'cachedInputTokens', coalesce(p_usage ->> 'cachedInputTokens', '0')::integer,
    'outputTokens', coalesce(p_usage ->> 'outputTokens', '0')::integer,
    'reasoningOutputTokens', coalesce(p_usage ->> 'reasoningOutputTokens', '0')::integer
  );
end;
$function$;

-- The authoritative submit boundary accepts only the fixed Phase 1C plan plus
-- a canonical dependency list. Empty criteria become one deterministic,
-- command-type-specific criterion before idempotency comparison and storage.
create or replace function public.submit_command(
  p_project_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid, task_id uuid, command_state public.command_status,
  task_state public.task_status, requires_owner_approval boolean, was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  command_type_value text;
  normalized_prompt text := lower(btrim(coalesce(p_prompt, '')));
  normalized_parameters jsonb;
  normalized_criteria jsonb;
  dependency_ids jsonb;
  risk_floor public.risk_level;
  effective_risk public.risk_level;
  project_record public.projects%rowtype;
  submission record;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if jsonb_typeof(coalesce(p_parameters, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_parameters, '{}'::jsonb)::text) > 65536
    or public.jsonb_has_sensitive_keys(coalesce(p_parameters, '{}'::jsonb))
    or (select array_agg(parameter_key order by parameter_key)
        from jsonb_object_keys(coalesce(p_parameters, '{}'::jsonb)) parameter_key)
      is distinct from array[
        'acceptanceCriteria','agentRole','budget','commandType','dependencyTaskIds',
        'executionMode','model','plan','provider','repositoryBinding','riskAssessment'
      ]::text[] then
    raise exception using errcode = '22023',
      message = 'invalid or unsupported Phase 1C command parameters';
  end if;

  command_type_value := p_parameters ->> 'commandType';
  if command_type_value not in (
    'fix_bug','build_feature','audit','test','mobile','security','performance','other'
  ) or jsonb_typeof(p_parameters -> 'acceptanceCriteria') <> 'array'
    or jsonb_array_length(p_parameters -> 'acceptanceCriteria') > 12
    or exists (
      select 1 from jsonb_array_elements(p_parameters -> 'acceptanceCriteria') criterion
      where jsonb_typeof(criterion) <> 'string'
        or char_length(btrim(criterion #>> '{}')) not between 3 and 500
        or criterion #>> '{}' is distinct from btrim(criterion #>> '{}')
        or public.text_has_likely_secret(criterion #>> '{}')
    )
    or jsonb_array_length(p_parameters -> 'acceptanceCriteria') is distinct from (
      select count(distinct criterion #>> '{}')::integer
      from jsonb_array_elements(p_parameters -> 'acceptanceCriteria') criterion
    ) then
    raise exception using errcode = '22023',
      message = 'invalid or unsupported Phase 1C command parameters';
  end if;

  normalized_criteria := p_parameters -> 'acceptanceCriteria';
  if jsonb_array_length(normalized_criteria) = 0 then
    normalized_criteria := jsonb_build_array(case command_type_value
      when 'fix_bug' then
        'The reported defect is fixed and verified without unrelated regressions.'
      when 'build_feature' then
        'The requested feature works as described and passes applicable validation.'
      when 'audit' then
        'The audit findings are documented with cited evidence and prioritized follow-up.'
      when 'test' then
        'The requested test coverage passes and protects the specified behavior.'
      when 'mobile' then
        'The requested mobile behavior is verified at supported responsive widths.'
      when 'security' then
        'The requested security change is verified against the applicable authorization boundary.'
      when 'performance' then
        'The requested performance improvement is measured and preserves existing behavior.'
      else
        'The requested outcome is implemented and verified without unrelated changes.'
    end);
  end if;

  dependency_ids := p_parameters -> 'dependencyTaskIds';
  if jsonb_typeof(dependency_ids) <> 'array'
    or jsonb_array_length(dependency_ids) > 20
    or exists (
      select 1 from jsonb_array_elements(dependency_ids) dependency
      where jsonb_typeof(dependency) <> 'string'
        or dependency #>> '{}' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or exists (
      select 1 from (
        select dependency #>> '{}' as dependency_id,
          lag(dependency #>> '{}') over (order by dependency_order) as previous_id
        from jsonb_array_elements(dependency_ids)
          with ordinality listed(dependency, dependency_order)
      ) ordered
      where ordered.previous_id is not null
        and ordered.dependency_id <= ordered.previous_id
    ) then
    raise exception using errcode = '22023', message = 'invalid command dependencies';
  end if;

  select project.* into project_record
  from public.projects project
  where project.id = p_project_id
    and public.is_organization_owner(project.organization_id);
  if not found then
    raise exception using errcode = '42501',
      message = 'only an organization owner may submit a command';
  end if;

  -- Use one deliberately generic failure for missing, cross-tenant,
  -- cross-project, failed, and cancelled IDs so this boundary cannot enumerate
  -- another tenant's tasks.
  if jsonb_array_length(dependency_ids) <> (
    select count(*)::integer
    from public.tasks dependency_task
    where dependency_task.id in (
      select (dependency #>> '{}')::uuid
      from jsonb_array_elements(dependency_ids) dependency
    )
      and dependency_task.organization_id = project_record.organization_id
      and dependency_task.project_id = project_record.id
      and dependency_task.status not in (
        'failed'::public.task_status, 'cancelled'::public.task_status
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid command dependencies';
  end if;

  normalized_parameters := jsonb_set(
    p_parameters, '{acceptanceCriteria}', normalized_criteria, true
  );
  select normalized_prompt || ' '
    || coalesce(string_agg(lower(criterion #>> '{}'), ' '), '')
  into normalized_prompt
  from jsonb_array_elements(normalized_criteria) criterion;

  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(\mauth\M|authentication|authorization|oauth|session|cookie|rbac|permission|secret|credential|password|private[ _-]?key|api[ _-]?key|token|rls|row[ -]?level security|service[ _-]?role|production database|delete production|drop table|truncate|dns|domain ownership|billing|payment|money|auto[ -]?(merge|deploy|rollback|approve)|branch protection)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug','build_feature','mobile','performance','other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package(\.json)?|lockfile|upgrade|api|backend|frontend|component|route|workflow|configuration|refactor|feature|bug|performance|mobile|accessibility)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level
  end;
  effective_risk := greatest(
    coalesce(p_requested_risk, 'green'::public.risk_level), risk_floor
  );
  normalized_parameters := jsonb_set(
    normalized_parameters, '{riskAssessment}',
    coalesce(normalized_parameters -> 'riskAssessment', '{}'::jsonb)
      || jsonb_build_object(
        'effectiveRisk', effective_risk::text,
        'classificationSource', 'database_policy'
      ), true
  );
  normalized_parameters := jsonb_set(
    normalized_parameters, '{agentRole}', to_jsonb(case command_type_value
      when 'audit' then 'qa' when 'test' then 'qa' when 'mobile' then 'frontend'
      when 'security' then 'security' when 'performance' then 'performance'
      when 'build_feature' then 'architect' when 'fix_bug' then 'backend'
      else 'orchestrator' end), true
  );

  select * into submission
  from public.submit_command_phase1a_internal(
    p_project_id, p_prompt, effective_risk, normalized_parameters, p_idempotency_key
  );

  -- The idempotency comparison above includes the normalized criteria and the
  -- exact canonical dependency array. Replays may repair a missing edge, but
  -- an unexplained extra edge is never silently erased.
  if exists (
    select 1 from public.task_dependencies dependency
    where dependency.task_id = submission.task_id
      and dependency.organization_id = project_record.organization_id
      and dependency.depends_on_task_id not in (
        select (requested #>> '{}')::uuid
        from jsonb_array_elements(dependency_ids) requested
      )
  ) then
    raise exception using errcode = '55000',
      message = 'idempotent command dependency evidence conflicts';
  end if;

  insert into public.task_dependencies (
    organization_id, task_id, depends_on_task_id, created_by
  )
  select project_record.organization_id, submission.task_id,
    (dependency #>> '{}')::uuid, caller_id
  from jsonb_array_elements(dependency_ids) dependency
  on conflict on constraint task_dependencies_unique do nothing;

  return query select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created;
end;
$function$;

-- A retry request is rejected before requeueing when any cumulative provider
-- budget is already consumed. The underlying recovery-coherence and duration
-- rules remain authoritative and unchanged.
alter function public.retry_phase1c_run(uuid, uuid, text)
  rename to retry_phase1c_run_budget_internal;

create function public.retry_phase1c_run(
  p_organization_id uuid, p_run_id uuid, p_reason text
)
returns table (run_id uuid, status public.run_status, attempt_number integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  command_budget jsonb;
  prior_usage jsonb;
begin
  if auth.uid() is null or not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role,'admin'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501',
      message = 'run retry requires owner or administrator access';
  end if;

  select run.* into run_record
  from public.agent_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id
  for update of run;
  if not found then return; end if;

  select command.parameters -> 'budget' into command_budget
  from public.commands command
  where command.id = run_record.command_id
    and command.organization_id = run_record.organization_id;

  prior_usage := public.canonical_phase1c_usage(run_record.usage);
  if command_budget ->> 'maximumTurns' !~ '^[1-8]$'
    or command_budget ->> 'maximumInputTokens' !~ '^[0-9]{4,7}$'
    or command_budget ->> 'maximumOutputTokens' !~ '^[0-9]{3,6}$'
    or (prior_usage ->> 'turns')::integer
      >= (command_budget ->> 'maximumTurns')::integer
    or (prior_usage ->> 'inputTokens')::integer
      >= (command_budget ->> 'maximumInputTokens')::integer
    or (prior_usage ->> 'outputTokens')::integer
      >= (command_budget ->> 'maximumOutputTokens')::integer then
    raise exception using errcode = '55000',
      message = 'run is not eligible for a bounded retry';
  end if;

  return query
    select retried.run_id, retried.status, retried.attempt_number
    from public.retry_phase1c_run_budget_internal(
      p_organization_id, p_run_id, p_reason
    ) retried;
end;
$function$;

-- Normalize every terminal Phase 1C usage payload so retries can account for
-- provider work even when failure happened before a branch/commit artifact.
alter function public.complete_phase1c_run(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) rename to complete_phase1c_run_usage_internal;

create function public.complete_phase1c_run(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_outcome text, p_summary text default null,
  p_provider_run_reference text default null,
  p_usage jsonb default '{}'::jsonb,
  p_changed_files jsonb default '[]'::jsonb,
  p_checks jsonb default '[]'::jsonb,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default false
)
returns table (run_id uuid, status public.run_status, completed_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  normalized_usage jsonb;
  command_budget jsonb;
begin
  normalized_usage := public.canonical_phase1c_usage(p_usage);
  select command.parameters -> 'budget' into command_budget
  from public.agent_runs run
  join public.commands command on command.id = run.command_id
    and command.organization_id = run.organization_id
  where run.id = p_run_id;

  if command_budget is not null and (
    (normalized_usage ->> 'turns')::integer
      >= (command_budget ->> 'maximumTurns')::integer
    or (normalized_usage ->> 'inputTokens')::integer
      >= (command_budget ->> 'maximumInputTokens')::integer
    or (normalized_usage ->> 'outputTokens')::integer
      >= (command_budget ->> 'maximumOutputTokens')::integer
  ) then
    p_retryable := false;
  end if;

  return query
    select completed.run_id, completed.status, completed.completed_at
    from public.complete_phase1c_run_usage_internal(
      p_worker_id, p_run_id, p_lease_token, p_outcome, p_summary,
      p_provider_run_reference, normalized_usage, p_changed_files, p_checks,
      p_error_code, p_error_message, p_retryable
    ) completed;
end;
$function$;

-- Keep the existing claim implementation and TABLE signature. This wrapper
-- makes turns/tokens remaining totals and always returns prior cumulative usage
-- independently of branch/commit recovery evidence. Raising after an invalid
-- internal claim rolls the entire statement back atomically.
alter function public.claim_phase1c_run(text, text, text, integer)
  rename to claim_phase1c_run_budget_internal;

create function public.claim_phase1c_run(
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
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  claimed record;
  command_budget jsonb;
  prior_usage jsonb;
begin
  select * into claimed
  from public.claim_phase1c_run_budget_internal(
    p_worker_id, p_provider, p_model, p_lease_seconds
  );
  if not found then return; end if;

  select command.parameters -> 'budget',
    public.canonical_phase1c_usage(run.usage)
  into command_budget, prior_usage
  from public.agent_runs run
  join public.commands command on command.id = run.command_id
    and command.organization_id = run.organization_id
  where run.id = claimed.run_id;

  if command_budget ->> 'maximumTurns' !~ '^[1-8]$'
    or command_budget ->> 'maximumInputTokens' !~ '^[0-9]{4,7}$'
    or command_budget ->> 'maximumOutputTokens' !~ '^[0-9]{3,6}$'
    or (prior_usage ->> 'turns')::integer
      >= (command_budget ->> 'maximumTurns')::integer
    or (prior_usage ->> 'inputTokens')::integer
      >= (command_budget ->> 'maximumInputTokens')::integer
    or (prior_usage ->> 'outputTokens')::integer
      >= (command_budget ->> 'maximumOutputTokens')::integer then
    raise exception using errcode = '55000', message = 'run budget is exhausted';
  end if;

  return query select
    claimed.run_id, claimed.organization_id, claimed.project_id, claimed.task_id,
    claimed.command_id, claimed.agent_id, claimed.prompt, claimed.command_type,
    claimed.requested_risk, claimed.acceptance_criteria, claimed.plan,
    claimed.connection_id, claimed.repository_id, claimed.internal_installation_id,
    claimed.external_installation_id, claimed.app_id, claimed.external_repository_id,
    claimed.repository_full_name, claimed.base_branch, claimed.base_sha,
    claimed.lease_token, claimed.lease_expires_at, claimed.attempt_number,
    claimed.cancellation_requested, claimed.logical_agent_role,
    claimed.provider, claimed.model, claimed.maximum_duration_ms,
    greatest(1, (command_budget ->> 'maximumTurns')::integer
      - (prior_usage ->> 'turns')::integer),
    greatest(1, (command_budget ->> 'maximumInputTokens')::integer
      - (prior_usage ->> 'inputTokens')::integer),
    greatest(1, (command_budget ->> 'maximumOutputTokens')::integer
      - (prior_usage ->> 'outputTokens')::integer),
    claimed.maximum_repair_attempts, claimed.ci_timeout_ms,
    claimed.owner_approval_id, claimed.owner_approval_expires_at,
    claimed.recovery_head_branch, claimed.recovery_head_sha,
    claimed.recovery_pull_request_number, claimed.recovery_pull_request_url,
    claimed.recovery_provider_run_reference, prior_usage;
end;
$function$;

revoke all on function public.canonical_phase1c_usage(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_phase1c_run_budget_internal(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_phase1c_run(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run_usage_internal(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_budget_internal(text, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run(text, text, text, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  to authenticated;
grant execute on function public.retry_phase1c_run(uuid, uuid, text)
  to authenticated;
grant execute on function public.complete_phase1c_run(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) to service_role;
grant execute on function public.claim_phase1c_run(text, text, text, integer)
  to service_role;

comment on function public.submit_command(uuid, text, public.risk_level, jsonb, text) is
  'Owner-only Phase 1C submission with canonical non-empty criteria and exact same-project dependency persistence.';
comment on function public.claim_phase1c_run(text, text, text, integer) is
  'Claims one eligible GREEN/YELLOW run and returns only remaining cumulative duration/turn/token budgets.';
