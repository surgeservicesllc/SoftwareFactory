-- Forward-only lint repairs for the final Phase 1C function catalog.
--
-- Keep the command row lock in the terminal completion path without using a
-- throwaway row variable, and describe the usage normalizer with the same
-- STABLE volatility as the JSON construction expression it evaluates.

create or replace function public.complete_phase1c_run_internal(
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
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  run_record public.agent_runs%rowtype;
  task_record public.tasks%rowtype;
  repository_record public.github_repositories%rowtype;
  branch_reference text;
  commit_reference text;
  pull_request_reference text;
  pull_request_number integer;
  next_status public.run_status;
  terminal_event public.activity_event_type;
  latest_validation_round integer;
begin
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now()
  for update;
  if not found then raise exception using errcode = '42501', message = 'active run lease required'; end if;
  if p_outcome not in ('succeeded','failed','cancelled') then
    raise exception using errcode = '22023', message = 'invalid terminal run outcome';
  end if;
  if jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_changed_files, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_checks, '[]'::jsonb)) <> 'array'
    or octet_length(coalesce(p_usage, '{}'::jsonb)::text) > 32768
    or octet_length(coalesce(p_changed_files, '[]'::jsonb)::text) > 32768
    or octet_length(coalesce(p_checks, '[]'::jsonb)::text) > 32768
    or jsonb_array_length(coalesce(p_changed_files, '[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(p_checks, '[]'::jsonb)) > 500
    or public.jsonb_has_sensitive_keys(coalesce(p_usage, '{}'::jsonb))
    or public.jsonb_has_sensitive_keys(coalesce(p_changed_files, '[]'::jsonb))
    or public.jsonb_has_sensitive_keys(coalesce(p_checks, '[]'::jsonb))
    or public.text_has_likely_secret(coalesce(p_summary, ''))
    or public.text_has_likely_secret(coalesce(p_error_message, '')) then
    raise exception using errcode = '22023', message = 'invalid or sensitive terminal evidence';
  end if;
  if char_length(coalesce(p_summary, '')) > 4000
    or char_length(coalesce(p_error_message, '')) > 4000
    or (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,62}$')
    or (p_provider_run_reference is not null and char_length(p_provider_run_reference) > 255) then
    raise exception using errcode = '22023', message = 'terminal evidence exceeds its bounds';
  end if;

  if p_outcome = 'succeeded' then
    select artifact.reference into branch_reference
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id and artifact.attempt_number = run_record.attempt_number
      and artifact.artifact_type = 'branch' order by artifact.created_at desc limit 1;
    select artifact.reference into commit_reference
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id and artifact.attempt_number = run_record.attempt_number
      and artifact.artifact_type = 'commit' order by artifact.created_at desc limit 1;
    select artifact.reference, artifact.external_number
    into pull_request_reference, pull_request_number
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id and artifact.attempt_number = run_record.attempt_number
      and artifact.artifact_type = 'pull_request' order by artifact.created_at desc limit 1;
    if branch_reference is null or branch_reference !~ '^factory/[A-Za-z0-9._/-]{1,240}$'
      or commit_reference is null or commit_reference !~ '^[0-9a-fA-F]{40}$'
      or pull_request_reference is null or pull_request_reference !~ '^https://github\.com/'
      or pull_request_number is null then
      raise exception using errcode = '55000', message = 'successful run requires branch, commit, and draft pull request evidence';
    end if;
    select max(validation.validation_round) into latest_validation_round
    from public.phase1c_run_validations validation
    where validation.run_id = run_record.id
      and validation.attempt_number = run_record.attempt_number
      and validation.validation_round > 0;
    if latest_validation_round is null or exists (
      select 1 from public.phase1c_run_validations validation
      where validation.run_id = run_record.id
        and validation.attempt_number = run_record.attempt_number
        and validation.validation_round = latest_validation_round
        and validation.status = 'failed'
    ) or not exists (
      select 1 from public.phase1c_run_validations validation
      where validation.run_id = run_record.id
        and validation.attempt_number = run_record.attempt_number
        and validation.validation_round = latest_validation_round
        and validation.name = 'diff-check' and validation.status = 'passed'
    ) then
      raise exception using errcode = '55000', message = 'successful run requires passing deterministic validation evidence';
    end if;
  end if;

  next_status := p_outcome::public.run_status;
  update public.agent_runs run set
    status = next_status,
    provider_run_reference = nullif(btrim(coalesce(p_provider_run_reference, '')), ''),
    output = jsonb_build_object('outcome', p_outcome, 'summary', p_summary),
    error_code = p_error_code,
    error_message = nullif(btrim(coalesce(p_error_message, '')), ''),
    retryable = p_outcome = 'failed' and coalesce(p_retryable, false)
      and run.attempt_number < run.max_attempts,
    result_summary = nullif(btrim(coalesce(p_summary, '')), ''),
    usage = coalesce(p_usage, '{}'::jsonb),
    changed_files = coalesce(p_changed_files, '[]'::jsonb),
    checks = coalesce(p_checks, '[]'::jsonb),
    head_branch = case when p_outcome = 'succeeded' then branch_reference else run.head_branch end,
    head_sha = case when p_outcome = 'succeeded' then lower(commit_reference) else run.head_sha end,
    lease_worker_id = null, lease_token = null, lease_expires_at = null,
    completed_at = now(), updated_at = now()
  where run.id = run_record.id returning run.* into run_record;

  select task.* into task_record from public.tasks task where task.id = run_record.task_id for update;
  perform 1 from public.commands command where command.id = run_record.command_id for update;
  select repository.* into repository_record from public.github_repositories repository
  where repository.id = run_record.github_repository_id;

  update public.tasks task set
    status = case p_outcome
      when 'succeeded' then 'completed'::public.task_status
      when 'cancelled' then 'cancelled'::public.task_status
      else 'failed'::public.task_status end,
    result = jsonb_build_object('runId', run_record.id, 'outcome', p_outcome),
    result_summary = nullif(btrim(coalesce(p_summary, '')), ''),
    blocked_reason = case when p_outcome = 'failed' then nullif(btrim(coalesce(p_error_message, '')), '') else null end,
    completed_at = now(), updated_at = now()
  where task.id = run_record.task_id;
  update public.commands command set
    status = case p_outcome
      when 'succeeded' then 'succeeded'::public.command_status
      when 'cancelled' then 'cancelled'::public.command_status
      else 'failed'::public.command_status end,
    completed_at = now(), updated_at = now()
  where command.id = run_record.command_id;
  update public.agents agent set
    status = case when p_outcome = 'failed' then 'error'::public.agent_status else 'idle'::public.agent_status end,
    current_assignment = null, last_run_at = now(), updated_at = now()
  where agent.id = run_record.agent_id;
  update public.phase1c_workers worker set current_run_id = null,
    last_heartbeat_at = now(), updated_at = now()
  where worker.worker_id = p_worker_id and worker.current_run_id = run_record.id;

  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    p_outcome, case p_outcome
      when 'succeeded' then 'Run completed with draft pull request evidence.'
      when 'cancelled' then 'Run stopped at a safe cancellation boundary.'
      else 'Run failed and preserved bounded diagnostics.' end,
    jsonb_build_object('retryable', run_record.retryable, 'errorCode', p_error_code)
  );

  if p_outcome = 'succeeded' then
    insert into public.pull_requests (
      organization_id, project_id, agent_run_id, repository, external_number,
      title, url, head_branch, base_branch, status, risk_level, opened_at
    ) values (
      run_record.organization_id, run_record.project_id, run_record.id,
      repository_record.full_name, pull_request_number, task_record.title,
      pull_request_reference, branch_reference, run_record.base_branch,
      'draft'::public.pull_request_status, run_record.risk_level, now()
    ) on conflict (project_id, repository, external_number) do update set
      agent_run_id = excluded.agent_run_id, title = excluded.title,
      url = excluded.url, head_branch = excluded.head_branch,
      base_branch = excluded.base_branch, status = 'draft'::public.pull_request_status,
      updated_at = now();

    insert into public.reports (
      organization_id, project_id, generated_by_agent_id, type, status,
      title, summary, content, period_start, period_end, published_at
    ) values (
      run_record.organization_id, run_record.project_id, run_record.agent_id,
      'quality'::public.report_type, 'published'::public.report_status,
      'Phase 1C run ' || left(run_record.id::text, 8),
      coalesce(nullif(btrim(p_summary), ''), 'Codex completed a validated draft pull request.'),
      jsonb_build_object(
        'sections', jsonb_build_array(jsonb_build_object(
          'title', 'Validated result',
          'body', coalesce(nullif(btrim(p_summary), ''), 'Validated draft pull request created.')
        )),
        'findings', '[]'::jsonb, 'decisions', '[]'::jsonb,
        'runIds', jsonb_build_array(run_record.id),
        'pullRequestNumbers', jsonb_build_array(pull_request_number)
      ),
      run_record.started_at, now(), now()
    );
  end if;

  terminal_event := case p_outcome
    when 'succeeded' then 'agent.completed'::public.activity_event_type
    when 'cancelled' then 'agent.cancelled'::public.activity_event_type
    else 'agent.failed'::public.activity_event_type end;
  perform public.record_activity_event(
    run_record.organization_id, run_record.project_id, terminal_event,
    'agent_run', run_record.id, 'Phase 1C run ' || p_outcome,
    jsonb_build_object('status', p_outcome, 'attempt', run_record.attempt_number,
      'retryable', run_record.retryable)
  );
  return query select run_record.id, run_record.status, run_record.completed_at;
end;
$function$;

alter function public.canonical_phase1c_usage(jsonb) stable;
