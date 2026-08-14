-- Phase 1C: durable, manually requested Codex execution.
--
-- This migration does not weaken the Phase 1D autonomous kill switch and does
-- not add merge, deployment, rollback, workflow, administration, or default-
-- branch write authority.  A command is bound to one live repository snapshot;
-- a service-role worker may act only while holding its short-lived run lease.

alter table public.commands
  add column command_type text not null default 'other'
    check (command_type in ('fix_bug', 'build_feature', 'audit', 'test', 'mobile', 'security', 'performance', 'other')),
  add column acceptance_criteria jsonb not null default '[]'::jsonb
    check (jsonb_typeof(acceptance_criteria) = 'array' and not public.jsonb_has_sensitive_keys(acceptance_criteria)),
  add column execution_plan jsonb not null default '{}'::jsonb
    check (jsonb_typeof(execution_plan) = 'object' and not public.jsonb_has_sensitive_keys(execution_plan)),
  add column risk_assessment jsonb not null default '{}'::jsonb
    check (jsonb_typeof(risk_assessment) = 'object' and not public.jsonb_has_sensitive_keys(risk_assessment));

alter table public.tasks
  add column acceptance_criteria jsonb not null default '[]'::jsonb
    check (jsonb_typeof(acceptance_criteria) = 'array' and not public.jsonb_has_sensitive_keys(acceptance_criteria)),
  add column blocked_reason text check (blocked_reason is null or char_length(blocked_reason) between 1 and 1000),
  add column result_summary text check (result_summary is null or char_length(result_summary) between 1 and 4000);

alter table public.agent_runs
  add column command_id uuid,
  add column connection_id uuid,
  add column github_repository_id uuid,
  add column risk_level public.risk_level not null default 'green',
  add column logical_agent_role public.agent_role,
  add column base_branch text check (base_branch is null or char_length(btrim(base_branch)) between 1 and 255),
  add column base_sha text check (base_sha is null or base_sha ~ '^[0-9a-f]{40}$'),
  add column head_branch text check (head_branch is null or char_length(btrim(head_branch)) between 1 and 255),
  add column head_sha text check (head_sha is null or head_sha ~ '^[0-9a-f]{40}$'),
  add column lease_worker_id text check (lease_worker_id is null or lease_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column attempt_number integer not null default 0 check (attempt_number between 0 and 10),
  add column max_attempts integer not null default 2 check (max_attempts between 1 and 3),
  add column cancellation_requested_at timestamptz,
  add column cancellation_requested_by uuid references auth.users(id) on delete set null,
  add column cancellation_reason text check (cancellation_reason is null or char_length(cancellation_reason) between 10 and 500),
  add column retryable boolean not null default false,
  add column error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,62}$'),
  add column result_summary text check (result_summary is null or char_length(result_summary) between 1 and 4000),
  add column changed_files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(changed_files) = 'array' and not public.jsonb_has_sensitive_keys(changed_files)),
  add column checks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checks) = 'array' and not public.jsonb_has_sensitive_keys(checks)),
  add constraint agent_runs_command_fk foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete cascade,
  add constraint agent_runs_connection_fk foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  add constraint agent_runs_github_repository_fk foreign key (github_repository_id, organization_id)
    references public.github_repositories(id, organization_id) on delete restrict,
  add constraint agent_runs_lease_consistent check (
    (lease_worker_id is null and lease_token is null and lease_expires_at is null)
    or (lease_worker_id is not null and lease_token is not null and lease_expires_at is not null)
  );

-- The generic row scanner rejects every key ending in "token", including an
-- internal opaque UUID lease nonce. Preserve all other recursive secret scans
-- while allowing only this typed, server-only column.
create or replace function public.reject_phase1c_agent_run_sensitive_data()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
begin
  if public.jsonb_has_sensitive_keys(to_jsonb(new) - 'lease_token') then
    raise exception using errcode = '23514',
      message = 'plaintext credentials and sensitive keys are not permitted in agent runs';
  end if;
  return new;
end;
$function$;

drop trigger agent_runs_reject_sensitive_data on public.agent_runs;
create trigger agent_runs_reject_sensitive_data
  before insert or update on public.agent_runs
  for each row execute function public.reject_phase1c_agent_run_sensitive_data();

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint task_dependencies_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade,
  constraint task_dependencies_depends_on_fk foreign key (depends_on_task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade,
  constraint task_dependencies_distinct check (task_id <> depends_on_task_id),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id)
);

create table public.phase1c_workers (
  worker_id text primary key check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  version text not null check (char_length(btrim(version)) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'draining', 'disabled', 'error')),
  capabilities jsonb not null default '{}'::jsonb,
  current_run_id uuid,
  last_heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phase1c_workers_capabilities_object check (
    jsonb_typeof(capabilities) = 'object' and not public.jsonb_has_sensitive_keys(capabilities)
  )
);

create table public.phase1c_run_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  run_id uuid not null,
  attempt_number integer not null check (attempt_number between 0 and 10),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint phase1c_run_events_run_fk foreign key (run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint phase1c_run_events_details_object check (
    jsonb_typeof(details) = 'object' and not public.jsonb_has_sensitive_keys(details)
  )
);

create table public.phase1c_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  run_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 10),
  artifact_type text not null check (artifact_type in ('branch', 'commit', 'pull_request', 'file', 'report')),
  reference text not null check (char_length(btrim(reference)) between 1 and 2000),
  external_number integer check (external_number is null or external_number > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint phase1c_run_artifacts_run_fk foreign key (run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint phase1c_run_artifacts_metadata_object check (
    jsonb_typeof(metadata) = 'object' and not public.jsonb_has_sensitive_keys(metadata)
  ),
  constraint phase1c_run_artifacts_unique unique (run_id, attempt_number, artifact_type, reference)
);

create table public.phase1c_run_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  run_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 10),
  validation_round integer not null check (validation_round between 0 and 3),
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  command text not null check (char_length(btrim(command)) between 1 and 500),
  status text not null check (status in ('passed', 'failed', 'skipped')),
  duration_ms integer not null check (duration_ms between 0 and 3600000),
  output_summary text not null default '' check (char_length(output_summary) <= 4000),
  created_at timestamptz not null default now(),
  constraint phase1c_run_validations_run_fk foreign key (run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint phase1c_run_validations_no_secret check (
    not public.text_has_likely_secret(command) and not public.text_has_likely_secret(output_summary)
  ),
  constraint phase1c_run_validations_unique unique (run_id, attempt_number, validation_round, name)
);

create index task_dependencies_task_idx on public.task_dependencies (task_id);
create index task_dependencies_dependency_idx on public.task_dependencies (depends_on_task_id);
create index phase1c_workers_heartbeat_idx on public.phase1c_workers (status, last_heartbeat_at desc);
create index phase1c_run_events_run_idx on public.phase1c_run_events (run_id, occurred_at asc);
create index phase1c_run_artifacts_run_idx on public.phase1c_run_artifacts (run_id, created_at asc);
create index phase1c_run_validations_run_idx on public.phase1c_run_validations (run_id, created_at asc);
create index agent_runs_phase1c_claim_idx on public.agent_runs (status, provider, model, lease_expires_at, created_at)
  where command_id is not null;

alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;
alter table public.phase1c_workers enable row level security;
alter table public.phase1c_workers force row level security;
alter table public.phase1c_run_events enable row level security;
alter table public.phase1c_run_events force row level security;
alter table public.phase1c_run_artifacts enable row level security;
alter table public.phase1c_run_artifacts force row level security;
alter table public.phase1c_run_validations enable row level security;
alter table public.phase1c_run_validations force row level security;

create policy task_dependencies_select_members on public.task_dependencies
  for select to authenticated using (public.is_organization_member(organization_id));
create policy phase1c_workers_deny_browser on public.phase1c_workers
  for select to authenticated using (false);
create policy phase1c_run_events_select_members on public.phase1c_run_events
  for select to authenticated using (public.is_organization_member(organization_id));
create policy phase1c_run_artifacts_select_members on public.phase1c_run_artifacts
  for select to authenticated using (public.is_organization_member(organization_id));
create policy phase1c_run_validations_select_members on public.phase1c_run_validations
  for select to authenticated using (public.is_organization_member(organization_id));

revoke all on table public.task_dependencies from public, anon, authenticated, service_role;
revoke all on table public.phase1c_workers from public, anon, authenticated, service_role;
revoke all on table public.phase1c_run_events from public, anon, authenticated, service_role;
revoke all on table public.phase1c_run_artifacts from public, anon, authenticated, service_role;
revoke all on table public.phase1c_run_validations from public, anon, authenticated, service_role;

-- Preserve the Phase 1A persistence transaction behind a private name and put
-- the authoritative Phase 1C classifier in front of every PostgREST caller.
-- This keeps the existing application RPC contract while preventing a browser
-- from lowering its own risk classification.
alter function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  rename to submit_command_phase1a_internal;

create or replace function public.submit_command(
  p_project_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid,
  task_id uuid,
  command_state public.command_status,
  task_state public.task_status,
  requires_owner_approval boolean,
  was_created boolean
)
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  command_type_value text := coalesce(p_parameters ->> 'commandType', 'other');
  normalized_prompt text := lower(btrim(coalesce(p_prompt, '')));
  risk_floor public.risk_level;
  effective_risk public.risk_level;
  normalized_parameters jsonb;
begin
  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(authentication|authorization|\mauth\M|credential|secret|token|private[ -]?key|service[ -]?role|row[ -]?level[ -]?security|\mrls\M|production[ -]?(database|data)|\mdns\M|billing|payment|auto[ -]?(approve|merge|deploy|rollback)|default[ -]?branch|branch[ -]?protection|owner[ -]?approval)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug', 'build_feature', 'mobile', 'performance', 'other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package|\mapi\M|refactor|implement|build|fix|edit|change|write|commit|pull[ -]?request|\mcode\M)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level
  end;
  effective_risk := greatest(coalesce(p_requested_risk, 'green'::public.risk_level), risk_floor);
  normalized_parameters := jsonb_set(
    coalesce(p_parameters, '{}'::jsonb),
    '{riskAssessment}',
    coalesce(p_parameters -> 'riskAssessment', '{}'::jsonb) || jsonb_build_object(
      'effectiveRisk', effective_risk::text,
      'classificationSource', 'database_policy'
    ),
    true
  );

  return query select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created
  from public.submit_command_phase1a_internal(
    p_project_id, p_prompt, effective_risk, normalized_parameters, p_idempotency_key
  ) submission;
end;
$function$;

create or replace function public.reject_phase1c_evidence_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $function$
begin
  raise exception using errcode = '55000', message = 'Phase 1C execution evidence is append-only';
end;
$function$;

create or replace function public.get_phase1c_worker_status(p_organization_id uuid)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select case when public.is_organization_member(p_organization_id) then
    jsonb_build_object(
      'connectionStatus', case when count(*) filter (
        where worker.status = 'active'
          and worker.last_heartbeat_at > now() - interval '5 minutes'
          and worker.last_heartbeat_at <= now() + interval '1 minute'
      ) > 0 then 'connected' else 'not_connected' end,
      'statusLabel', case when count(*) filter (
        where worker.status = 'active'
          and worker.last_heartbeat_at > now() - interval '5 minutes'
          and worker.last_heartbeat_at <= now() + interval '1 minute'
      ) > 0 then 'Connected' else 'Not Connected' end,
      'lastHeartbeatAt', max(worker.last_heartbeat_at) filter (where worker.status <> 'disabled'),
      'activeWorkers', count(*) filter (
        where worker.status = 'active'
          and worker.last_heartbeat_at > now() - interval '5 minutes'
          and worker.last_heartbeat_at <= now() + interval '1 minute'
      ),
      'staleAfterSeconds', 300
    )
  else null end
  from public.phase1c_workers worker;
$function$;

create or replace function public.get_agent_run_detail(
  p_organization_id uuid, p_run_id uuid
)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select jsonb_build_object(
    'id', run.id, 'status', run.status,
    'project', jsonb_build_object('id', project.id, 'name', project.name),
    'task', jsonb_build_object('id', task.id, 'title', task.title),
    'command', jsonb_build_object('id', command.id, 'prompt', command.prompt),
    'agent', jsonb_build_object('id', agent.id, 'name', agent.name, 'role', agent.role),
    'provider', run.provider, 'model', run.model, 'risk', run.risk_level,
    'providerRunReference', run.provider_run_reference,
    'baseBranch', run.base_branch, 'baseSha', run.base_sha,
    'headBranch', run.head_branch, 'headSha', run.head_sha,
    'attempt', run.attempt_number, 'maxAttempts', run.max_attempts,
    'startedAt', run.started_at, 'completedAt', run.completed_at,
    'createdAt', run.created_at,
    'durationMs', case when run.started_at is null then null
      else floor(extract(epoch from (coalesce(run.completed_at, now()) - run.started_at)) * 1000)::bigint end,
    'cancellationRequestedAt', run.cancellation_requested_at,
    'cancellable', run.status in ('queued'::public.run_status,'running'::public.run_status)
      and run.cancellation_requested_at is null,
    'retryable', run.status = 'failed'::public.run_status and run.retryable
      and run.attempt_number < run.max_attempts,
    'summary', run.result_summary, 'blocker', task.blocked_reason,
    'errorMessage', left(run.error_message, 1000),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id, 'stage', event.event_type, 'message', event.message,
      'details', event.details, 'occurredAt', event.occurred_at
    ) order by event.occurred_at asc) from (
      select source.* from public.phase1c_run_events source
      where source.run_id = run.id order by source.occurred_at desc limit 200
    ) event), '[]'::jsonb),
    'changedFiles', run.changed_files,
    'files', coalesce((select jsonb_agg(jsonb_build_object(
      'path', artifact.reference, 'status', artifact.metadata ->> 'status',
      'additions', artifact.metadata ->> 'additions', 'deletions', artifact.metadata ->> 'deletions'
    ) order by artifact.created_at asc) from (
      select source.* from public.phase1c_run_artifacts source
      where source.run_id = run.id and source.artifact_type = 'file'
      order by source.created_at desc limit 200
    ) artifact), '[]'::jsonb),
    'commits', coalesce((select jsonb_agg(jsonb_build_object(
      'sha', artifact.reference, 'message', artifact.metadata ->> 'message',
      'url', artifact.metadata ->> 'url'
    ) order by artifact.created_at asc) from (
      select source.* from public.phase1c_run_artifacts source
      where source.run_id = run.id and source.artifact_type = 'commit'
      order by source.created_at desc limit 100
    ) artifact), '[]'::jsonb),
    'validations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', validation.id, 'name', validation.name, 'command', validation.command,
      'status', validation.status, 'summary', validation.output_summary,
      'round', validation.validation_round,
      'durationMs', validation.duration_ms, 'createdAt', validation.created_at
    ) order by validation.created_at asc) from (
      select source.* from public.phase1c_run_validations source
      where source.run_id = run.id order by source.created_at desc limit 200
    ) validation), '[]'::jsonb),
    'pullRequest', (select jsonb_build_object(
      'number', pull.external_number, 'title', pull.title, 'state', pull.status,
      'draft', pull.status = 'draft'::public.pull_request_status, 'url', pull.url
    ) from public.pull_requests pull where pull.agent_run_id = run.id
      order by pull.created_at desc limit 1),
    'checks', run.checks,
    'ci', jsonb_build_object('checks', run.checks)
  )
  from public.agent_runs run
  join public.projects project on project.id = run.project_id and project.organization_id = run.organization_id
  join public.tasks task on task.id = run.task_id and task.organization_id = run.organization_id
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.agents agent on agent.id = run.agent_id and agent.organization_id = run.organization_id
  where run.id = p_run_id and run.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

create or replace function public.get_task_detail(
  p_organization_id uuid, p_task_id uuid
)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select jsonb_build_object(
    'id', task.id, 'title', task.title, 'description', task.description,
    'status', task.status, 'risk', task.risk_level,
    'requiresOwnerApproval', task.requires_owner_approval,
    'priority', task.priority, 'createdAt', task.created_at,
    'project', jsonb_build_object('id', project.id, 'name', project.name),
    'agent', case when agent.id is null then null else jsonb_build_object('id', agent.id, 'name', agent.name) end,
    'command', case when command.id is null then null else jsonb_build_object('id', command.id, 'prompt', command.prompt) end,
    'acceptanceCriteria', task.acceptance_criteria,
    'blocker', task.blocked_reason, 'resultSummary', task.result_summary,
    'dependencies', coalesce((select jsonb_agg(jsonb_build_object(
      'id', prerequisite.id, 'title', prerequisite.title, 'status', prerequisite.status
    ) order by prerequisite.created_at asc)
      from (
        select prerequisite.* from public.task_dependencies dependency
        join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
          and prerequisite.organization_id = dependency.organization_id
        where dependency.task_id = task.id
        order by prerequisite.created_at asc limit 100
      ) prerequisite), '[]'::jsonb),
    'dependents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', dependent.id, 'title', dependent.title, 'status', dependent.status
    ) order by dependent.created_at asc)
      from (
        select dependent.* from public.task_dependencies dependency
        join public.tasks dependent on dependent.id = dependency.task_id
          and dependent.organization_id = dependency.organization_id
        where dependency.depends_on_task_id = task.id
        order by dependent.created_at asc limit 100
      ) dependent), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', run.id, 'status', run.status, 'createdAt', run.created_at,
      'branch', run.head_branch,
      'agent', jsonb_build_object('id', run_agent.id, 'name', run_agent.name),
      'pullRequest', (select jsonb_build_object('number', pull.external_number,
        'url', pull.url, 'status', pull.status, 'draft', pull.status = 'draft'::public.pull_request_status)
        from public.pull_requests pull where pull.agent_run_id = run.id limit 1)
    ) order by run.created_at desc)
      from (
        select source.*, run_agent.id as run_agent_id, run_agent.name as run_agent_name
        from public.agent_runs source join public.agents run_agent
          on run_agent.id = source.agent_id and run_agent.organization_id = source.organization_id
        where source.task_id = task.id order by source.created_at desc limit 100
      ) run
      join public.agents run_agent on run_agent.id = run.run_agent_id), '[]'::jsonb),
    'pullRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'number', pull.external_number, 'title', pull.title, 'url', pull.url,
      'status', pull.status, 'draft', pull.status = 'draft'::public.pull_request_status
    ) order by pull.created_at desc)
      from (
        select source.* from public.pull_requests source
        join public.agent_runs source_run on source_run.id = source.agent_run_id
        where source_run.task_id = task.id
        order by source.created_at desc limit 100
      ) pull), '[]'::jsonb)
  )
  from public.tasks task
  join public.projects project on project.id = task.project_id and project.organization_id = task.organization_id
  left join public.agents agent on agent.id = task.assigned_agent_id and agent.organization_id = task.organization_id
  left join public.commands command on command.id = task.command_id and command.organization_id = task.organization_id
  where task.id = p_task_id and task.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

create or replace function public.get_agent_detail(
  p_organization_id uuid, p_agent_id uuid
)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select jsonb_build_object(
    'id', agent.id, 'name', agent.name, 'role', agent.role,
    'description', left(agent.description, 1000), 'status', agent.status,
    'provider', agent.provider, 'model', agent.model,
    'lastRunAt', agent.last_run_at, 'currentAssignment', agent.current_assignment,
    'providerConnectionStatus', case when exists (
      select 1 from public.phase1c_workers worker where worker.status = 'active'
        and worker.last_heartbeat_at > now() - interval '5 minutes'
        and worker.last_heartbeat_at <= now() + interval '1 minute'
        and worker.capabilities -> 'providers' ? agent.provider
    ) then 'connected' else 'not_connected' end,
    'project', case when project.id is null then null else jsonb_build_object('id', project.id, 'name', project.name) end,
    'capabilities', case when octet_length(agent.capabilities::text) <= 8192 then agent.capabilities else '[]'::jsonb end,
    'responsibilities', case when octet_length(agent.capabilities::text) <= 8192 then agent.capabilities else '[]'::jsonb end,
    'currentRuns', coalesce((select jsonb_agg(jsonb_build_object(
      'id', run.id, 'title', task.title, 'status', run.status,
      'project', jsonb_build_object('id', run_project.id, 'name', run_project.name)
    ) order by run.created_at desc)
      from (
        select source.* from public.agent_runs source
        where source.agent_id = agent.id
          and source.status in ('queued'::public.run_status,'running'::public.run_status)
        order by source.created_at desc limit 100
      ) run join public.tasks task on task.id = run.task_id
      join public.projects run_project on run_project.id = run.project_id), '[]'::jsonb),
    'recentRuns', coalesce((select jsonb_agg(jsonb_build_object(
      'id', recent.id, 'title', recent.task_title, 'status', recent.status,
      'startedAt', recent.started_at, 'completedAt', recent.completed_at
    ) order by recent.created_at desc) from (
      select run.id, run.status, run.started_at, run.completed_at, run.created_at, task.title as task_title
      from public.agent_runs run join public.tasks task on task.id = run.task_id
      where run.agent_id = agent.id order by run.created_at desc limit 20
    ) recent), '[]'::jsonb),
    'runCounts', jsonb_build_object(
      'queued', count(run.id) filter (where run.status = 'queued'::public.run_status),
      'running', count(run.id) filter (where run.status = 'running'::public.run_status),
      'succeeded', count(run.id) filter (where run.status = 'succeeded'::public.run_status),
      'failed', count(run.id) filter (where run.status = 'failed'::public.run_status)
    )
  )
  from public.agents agent
  left join public.projects project on project.id = agent.project_id and project.organization_id = agent.organization_id
  left join public.agent_runs run on run.agent_id = agent.id and run.organization_id = agent.organization_id
  where agent.id = p_agent_id and agent.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  group by agent.id, project.id, project.name;
$function$;

create or replace function public.get_report_detail(
  p_organization_id uuid, p_report_id uuid
)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select jsonb_build_object(
    'id', report.id, 'type', report.type, 'status', report.status,
    'title', report.title, 'summary', left(report.summary, 1000),
    'periodStart', report.period_start, 'periodEnd', report.period_end,
    'publishedAt', report.published_at, 'createdAt', report.created_at,
    'evidenceGeneratedAt', report.created_at,
    'project', case when project.id is null then null else jsonb_build_object('id', project.id, 'name', project.name) end,
    'generatedBy', case when agent.id is null then null else jsonb_build_object('id', agent.id, 'name', agent.name) end,
    'sections', case when jsonb_typeof(report.content -> 'sections') = 'array'
      then coalesce((select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(report.content -> 'sections') with ordinality item(value, ordinality)
        where octet_length(item.value::text) <= 8192 and item.ordinality <= 100), '[]'::jsonb)
      else '[]'::jsonb end,
    'findings', case when jsonb_typeof(report.content -> 'findings') = 'array'
      then coalesce((select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(report.content -> 'findings') with ordinality item(value, ordinality)
        where octet_length(item.value::text) <= 8192 and item.ordinality <= 100), '[]'::jsonb)
      else '[]'::jsonb end,
    'decisions', case when jsonb_typeof(report.content -> 'decisions') = 'array'
      then coalesce((select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(report.content -> 'decisions') with ordinality item(value, ordinality)
        where octet_length(item.value::text) <= 8192 and item.ordinality <= 100), '[]'::jsonb)
      else '[]'::jsonb end,
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', run.id, 'title', task.title, 'status', run.status
    ) order by run.created_at desc) from (
      select source.* from public.agent_runs source
      where source.organization_id = report.organization_id
        and source.id in (select value::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(report.content -> 'runIds') = 'array'
            then report.content -> 'runIds' else '[]'::jsonb end
        ) limit 100)
      order by source.created_at desc limit 100
    ) run join public.tasks task on task.id = run.task_id), '[]'::jsonb),
    'pullRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'number', pull.external_number, 'title', pull.title, 'url', pull.url,
      'status', pull.status, 'draft', pull.status = 'draft'::public.pull_request_status
    ) order by pull.created_at desc) from (
      select source.* from public.pull_requests source
      where source.organization_id = report.organization_id
        and source.external_number in (select value::integer from jsonb_array_elements_text(
          case when jsonb_typeof(report.content -> 'pullRequestNumbers') = 'array'
            then report.content -> 'pullRequestNumbers' else '[]'::jsonb end
        ) limit 100)
      order by source.created_at desc limit 100
    ) pull), '[]'::jsonb)
  )
  from public.reports report
  left join public.projects project on project.id = report.project_id and project.organization_id = report.organization_id
  left join public.agents agent on agent.id = report.generated_by_agent_id and agent.organization_id = report.organization_id
  where report.id = p_report_id and report.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

create or replace function public.claim_phase1c_run(
  p_worker_id text,
  p_provider text,
  p_model text,
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
  owner_approval_id uuid, owner_approval_expires_at timestamptz
)
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  claimed_run_id uuid;
  claimed_run public.agent_runs%rowtype;
  new_lease_token uuid := gen_random_uuid();
  bounded_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 300));
begin
  if not exists (
    select 1 from public.phase1c_workers worker
    where worker.worker_id = p_worker_id and worker.status = 'active'
      and worker.last_heartbeat_at > now() - interval '5 minutes'
  ) then
    raise exception using errcode = '42501', message = 'worker is not registered and active';
  end if;
  if p_provider <> 'openai' or char_length(btrim(coalesce(p_model, ''))) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'unsupported worker provider or model';
  end if;
  if p_model <> 'gpt-5.3-codex' then
    raise exception using errcode = '22023', message = 'unsupported worker model';
  end if;

  select run.id into claimed_run_id
  from public.agent_runs run
  join public.tasks task on task.id = run.task_id and task.organization_id = run.organization_id
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.projects project on project.id = run.project_id and project.organization_id = run.organization_id
  join public.project_connections link
    on link.project_id = project.id and link.organization_id = project.organization_id
    and link.connection_id = run.connection_id and link.github_repository_id = run.github_repository_id
    and link.is_primary
  join public.connections connection
    on connection.id = link.connection_id and connection.organization_id = link.organization_id
  join public.github_installations installation
    on installation.connection_id = connection.id and installation.organization_id = connection.organization_id
  join public.github_repositories repository
    on repository.id = run.github_repository_id and repository.installation_id = installation.id
    and repository.organization_id = run.organization_id
  where (
      run.status = 'queued'::public.run_status
      or (run.status = 'running'::public.run_status and run.lease_expires_at < now())
    )
    and run.attempt_number < run.max_attempts
    and run.cancellation_requested_at is null
    and run.risk_level in ('green'::public.risk_level, 'yellow'::public.risk_level)
    and command.requested_risk = run.risk_level
    and command.status in ('queued'::public.command_status, 'running'::public.command_status)
    and task.status in ('queued'::public.task_status, 'in_progress'::public.task_status)
    and run.provider = p_provider and run.model = p_model
    and project.status = 'active'::public.project_status
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch
    and run.base_branch = repository.default_branch
    and not exists (
      select 1 from public.task_dependencies dependency
      join public.tasks prerequisite
        on prerequisite.id = dependency.depends_on_task_id
        and prerequisite.organization_id = dependency.organization_id
      where dependency.task_id = task.id
        and dependency.organization_id = task.organization_id
        and prerequisite.status <> 'completed'::public.task_status
    )
  order by case when run.status = 'queued'::public.run_status then 0 else 1 end,
    task.priority desc, run.created_at asc
  limit 1
  for update of run skip locked;

  if claimed_run_id is null then return; end if;

  update public.agent_runs run set
    status = 'running'::public.run_status,
    lease_worker_id = p_worker_id,
    lease_token = new_lease_token,
    lease_expires_at = now() + make_interval(secs => bounded_lease_seconds),
    attempt_number = run.attempt_number + 1,
    retryable = false,
    error_code = null,
    error_message = null,
    started_at = coalesce(run.started_at, now()),
    completed_at = null,
    updated_at = now()
  where run.id = claimed_run_id
  returning run.* into claimed_run;

  update public.tasks task set status = 'in_progress'::public.task_status,
    started_at = coalesce(task.started_at, now()), updated_at = now()
  where task.id = claimed_run.task_id;
  update public.commands command set status = 'running'::public.command_status, updated_at = now()
  where command.id = claimed_run.command_id;
  update public.agents agent set status = 'busy'::public.agent_status,
    current_assignment = claimed_run.task_id::text, last_run_at = now(), updated_at = now()
  where agent.id = claimed_run.agent_id;
  update public.phase1c_workers worker set current_run_id = claimed_run.id,
    last_heartbeat_at = now(), updated_at = now()
  where worker.worker_id = p_worker_id;

  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    claimed_run.organization_id, claimed_run.id, claimed_run.attempt_number,
    'claimed', 'Worker claimed the durable run lease.',
    jsonb_build_object('workerId', p_worker_id, 'leaseSeconds', bounded_lease_seconds)
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
    coalesce((command.parameters -> 'budget' ->> 'maximumDurationMs')::integer, 2700000),
    coalesce((command.parameters -> 'budget' ->> 'maximumTurns')::integer, 4),
    coalesce((command.parameters -> 'budget' ->> 'maximumInputTokens')::integer, 200000),
    coalesce((command.parameters -> 'budget' ->> 'maximumOutputTokens')::integer, 50000),
    coalesce((command.parameters -> 'budget' ->> 'maximumRepairAttempts')::integer, 1),
    coalesce((command.parameters -> 'budget' ->> 'ciTimeoutMs')::integer, 900000),
    null::uuid, null::timestamptz
  from public.agent_runs run
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.github_repositories repository
    on repository.id = run.github_repository_id and repository.organization_id = run.organization_id
  join public.github_installations installation
    on installation.id = repository.installation_id and installation.organization_id = repository.organization_id
  where run.id = claimed_run.id;
end;
$function$;

create or replace function public.heartbeat_phase1c_run(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns table (lease_expires_at timestamptz, cancellation_requested boolean)
language plpgsql security definer set search_path = pg_catalog as $function$
declare run_record public.agent_runs%rowtype;
begin
  update public.agent_runs run set
    lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300))),
    updated_at = now()
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now()
  returning run.* into run_record;
  if not found then raise exception using errcode = '42501', message = 'run lease is missing or expired'; end if;
  update public.phase1c_workers worker set current_run_id = p_run_id,
    last_heartbeat_at = now(), updated_at = now()
  where worker.worker_id = p_worker_id and worker.status in ('active','draining');
  if not found then raise exception using errcode = '42501', message = 'worker is not active'; end if;
  return query select run_record.lease_expires_at, run_record.cancellation_requested_at is not null;
end;
$function$;

create or replace function public.append_phase1c_run_event(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_event_type text, p_message text, p_details jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $function$
declare run_record public.agent_runs%rowtype; event_id uuid;
begin
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now()
    and exists (
      select 1 from public.commands command
      where command.id = run.command_id and command.organization_id = run.organization_id
        and command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
        and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
          between 60000 and 3600000
        and run.started_at is not null
        and run.started_at + make_interval(secs =>
          (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) > now()
    );
  if not found then raise exception using errcode = '42501', message = 'active run lease required'; end if;
  if coalesce(p_event_type, '') !~ '^[a-z][a-z0-9_]{0,62}$'
    or char_length(btrim(coalesce(p_message, ''))) not between 1 and 1000
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_details, '{}'::jsonb)::text) > 16384
    or public.jsonb_has_sensitive_keys(coalesce(p_details, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'invalid or sensitive run event';
  end if;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    p_event_type, btrim(p_message), coalesce(p_details, '{}'::jsonb)
  ) returning id into event_id;
  return event_id;
end;
$function$;

create or replace function public.record_phase1c_validation(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_validation_round integer, p_name text, p_command text, p_status text, p_duration_ms integer,
  p_output text default ''
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $function$
declare
  run_record public.agent_runs%rowtype;
  validation_id uuid;
  existing_validation public.phase1c_run_validations%rowtype;
begin
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now()
    and exists (
      select 1 from public.commands command
      where command.id = run.command_id and command.organization_id = run.organization_id
        and command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
        and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
          between 60000 and 3600000
        and run.started_at is not null
        and run.started_at + make_interval(secs =>
          (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) > now()
    );
  if not found then raise exception using errcode = '42501', message = 'active run lease required'; end if;
  if p_validation_round not between 0 and 3
    or coalesce(p_name, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or char_length(btrim(coalesce(p_command, ''))) not between 1 and 500
    or p_status not in ('passed','failed','skipped')
    or p_duration_ms not between 0 and 3600000
    or octet_length(coalesce(p_output, '')) > 16000
    or public.text_has_likely_secret(coalesce(p_command, ''))
    or public.text_has_likely_secret(coalesce(p_output, '')) then
    raise exception using errcode = '22023', message = 'invalid or sensitive validation evidence';
  end if;
  insert into public.phase1c_run_validations (
    organization_id, run_id, attempt_number, validation_round,
    name, command, status, duration_ms, output_summary
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number, p_validation_round,
    p_name, btrim(p_command), p_status, p_duration_ms, left(coalesce(p_output, ''), 4000)
  )
  on conflict (run_id, attempt_number, validation_round, name) do nothing
  returning id into validation_id;
  if validation_id is null then
    select validation.* into existing_validation
    from public.phase1c_run_validations validation
    where validation.run_id = run_record.id
      and validation.attempt_number = run_record.attempt_number
      and validation.validation_round = p_validation_round
      and validation.name = p_name;
    if existing_validation.organization_id <> run_record.organization_id
      or existing_validation.command <> btrim(p_command)
      or existing_validation.status <> p_status
      or existing_validation.duration_ms <> p_duration_ms
      or existing_validation.output_summary <> left(coalesce(p_output, ''), 4000) then
      raise exception using errcode = '23505', message = 'validation replay conflicts with immutable evidence';
    end if;
    validation_id := existing_validation.id;
  end if;
  return validation_id;
end;
$function$;

create or replace function public.record_phase1c_run_artifact(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_artifact_type text, p_reference text, p_external_number integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $function$
declare run_record public.agent_runs%rowtype; artifact_id uuid;
begin
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now();
  if not found then raise exception using errcode = '42501', message = 'active run lease required'; end if;
  if p_artifact_type not in ('branch','commit','pull_request','file','report')
    or char_length(btrim(coalesce(p_reference, ''))) not between 1 and 2000
    or (p_external_number is not null and p_external_number <= 0)
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 16384
    or public.text_has_likely_secret(coalesce(p_reference, ''))
    or public.jsonb_has_sensitive_keys(coalesce(p_metadata, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'invalid or sensitive run artifact';
  end if;
  if p_artifact_type = 'commit' and btrim(p_reference) !~ '^[0-9a-fA-F]{40}$' then
    raise exception using errcode = '22023', message = 'invalid commit artifact';
  end if;
  if p_artifact_type = 'pull_request'
    and (p_external_number is null or btrim(p_reference) !~ '^https://github\.com/') then
    raise exception using errcode = '22023', message = 'invalid pull request artifact';
  end if;
  insert into public.phase1c_run_artifacts (
    organization_id, run_id, attempt_number, artifact_type, reference, external_number, metadata
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    p_artifact_type, btrim(p_reference), p_external_number, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (run_id, attempt_number, artifact_type, reference) do nothing
  returning id into artifact_id;
  if artifact_id is null then
    select artifact.id into artifact_id
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id
      and artifact.attempt_number = run_record.attempt_number
      and artifact.artifact_type = p_artifact_type
      and artifact.reference = btrim(p_reference)
      and artifact.organization_id = run_record.organization_id
      and artifact.external_number is not distinct from p_external_number
      and artifact.metadata = coalesce(p_metadata, '{}'::jsonb);
    if artifact_id is null then
      raise exception using errcode = '23505', message = 'artifact replay conflicts with immutable evidence';
    end if;
  end if;
  return artifact_id;
end;
$function$;

create or replace function public.normalize_phase1c_command()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
declare
  command_type_value text := coalesce(new.parameters ->> 'commandType', 'other');
  required_role text;
  risk_floor public.risk_level;
  normalized_prompt text := lower(btrim(coalesce(new.prompt, '')));
  expected_budget constant jsonb := jsonb_build_object(
    'ciTimeoutMs', 900000,
    'maximumDurationMs', 2700000,
    'maximumInputTokens', 200000,
    'maximumOutputTokens', 50000,
    'maximumRepairAttempts', 1,
    'maximumTurns', 4
  );
  expected_plan constant jsonb := jsonb_build_object(
    'requiresDraftPullRequest', true,
    'stages', jsonb_build_array(
      'inspect', 'implement', 'validate', 'policy_scan', 'commit',
      'draft_pull_request', 'ci', 'report'
    ),
    'workflow', 'codex_draft_pr'
  );
begin
  if command_type_value not in ('fix_bug', 'build_feature', 'audit', 'test', 'mobile', 'security', 'performance', 'other') then
    raise exception using errcode = '22023', message = 'invalid Phase 1C command type';
  end if;
  if coalesce(new.parameters ->> 'executionMode', '') <> 'manual' then
    raise exception using errcode = '22023', message = 'Phase 1C execution must be manually requested';
  end if;
  if jsonb_typeof(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) > 30 then
    raise exception using errcode = '22023', message = 'invalid Phase 1C acceptance criteria';
  end if;
  if jsonb_typeof(coalesce(new.parameters -> 'plan', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(new.parameters -> 'riskAssessment', '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid Phase 1C plan or risk assessment';
  end if;

  required_role := case command_type_value
    when 'audit' then 'qa'
    when 'test' then 'qa'
    when 'mobile' then 'frontend'
    when 'security' then 'security'
    when 'performance' then 'performance'
    when 'build_feature' then 'architect'
    when 'fix_bug' then 'backend'
    else 'custom'
  end;

  -- This trigger is the authoritative boundary even when an authenticated
  -- caller invokes submit_command through PostgREST instead of the app route.
  -- Provider, model, role, budget, and workflow therefore cannot be widened by
  -- browser input.
  if new.parameters ->> 'provider' <> 'openai'
    or new.parameters ->> 'model' <> 'gpt-5.3-codex'
    or new.parameters ->> 'agentRole' <> required_role
    or new.parameters -> 'budget' is distinct from expected_budget
    or new.parameters -> 'plan' is distinct from expected_plan then
    raise exception using errcode = '22023',
      message = 'Phase 1C execution configuration is not supported';
  end if;

  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(authentication|authorization|\mauth\M|credential|secret|token|private[ -]?key|service[ -]?role|row[ -]?level[ -]?security|\mrls\M|production[ -]?(database|data)|\mdns\M|billing|payment|auto[ -]?(approve|merge|deploy|rollback)|default[ -]?branch|branch[ -]?protection|owner[ -]?approval)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug', 'build_feature', 'mobile', 'performance', 'other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package|\mapi\M|refactor|implement|build|fix|edit|change|write|commit|pull[ -]?request|\mcode\M)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level
  end;

  -- Enum ordering is GREEN < YELLOW < RED. Never lower the caller's request;
  -- independently raise it to the SQL-derived floor when needed.
  new.requested_risk := greatest(new.requested_risk, risk_floor);
  new.parameters := jsonb_set(
    jsonb_set(new.parameters, '{riskAssessment,effectiveRisk}', to_jsonb(new.requested_risk::text), true),
    '{riskAssessment,classificationSource}', '"database_policy"'::jsonb, true
  );

  new.command_type := command_type_value;
  new.acceptance_criteria := coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb);
  new.execution_plan := coalesce(new.parameters -> 'plan', '{}'::jsonb);
  new.risk_assessment := coalesce(new.parameters -> 'riskAssessment', '{}'::jsonb);
  return new;
end;
$function$;

create or replace function public.plan_phase1c_task_and_run()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
declare
  command_record public.commands%rowtype;
  binding jsonb;
  budget jsonb;
  role_text text;
  provider_text text;
  model_text text;
  repository_record record;
  agent_record public.agents%rowtype;
  capabilities_value jsonb;
begin
  if new.command_id is null then return new; end if;

  select command.* into command_record
  from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found then return new; end if;

  new.acceptance_criteria := command_record.acceptance_criteria;
  if command_record.requested_risk = 'red'::public.risk_level then
    return new;
  end if;
  if command_record.requested_risk not in ('green'::public.risk_level, 'yellow'::public.risk_level)
    or new.status <> 'queued'::public.task_status then
    raise exception using errcode = '55000', message = 'only queued manual GREEN or YELLOW commands enter Phase 1C';
  end if;

  binding := command_record.parameters -> 'repositoryBinding';
  budget := command_record.parameters -> 'budget';
  role_text := command_record.parameters ->> 'agentRole';
  provider_text := command_record.parameters ->> 'provider';
  model_text := command_record.parameters ->> 'model';

  if jsonb_typeof(binding) <> 'object'
    or jsonb_typeof(budget) <> 'object'
    or role_text not in ('orchestrator','product','architect','frontend','backend','database','qa','security','performance','release','ceo_reporter','custom')
    or provider_text <> 'openai'
    or char_length(coalesce(model_text, '')) not between 1 and 120
    or coalesce(binding ->> 'repositoryId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'connectionId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'installationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'externalInstallationId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'externalRepositoryId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'appId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'baseSha', '') !~ '^[0-9a-fA-F]{40}$'
    or char_length(coalesce(binding ->> 'baseBranch', '')) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'Phase 1C execution binding is incomplete';
  end if;

  select project.id as project_id, connection.id as connection_id,
    repository.id as repository_id, repository.full_name, repository.default_branch,
    installation.id as installation_id, installation.external_installation_id,
    installation.app_id, repository.external_repository_id
  into repository_record
  from public.projects project
  join public.project_connections link
    on link.project_id = project.id and link.organization_id = project.organization_id and link.is_primary
  join public.connections connection
    on connection.id = link.connection_id and connection.organization_id = link.organization_id
  join public.github_installations installation
    on installation.connection_id = connection.id and installation.organization_id = connection.organization_id
  join public.github_repositories repository
    on repository.id = link.github_repository_id
    and repository.installation_id = installation.id
    and repository.organization_id = link.organization_id
  where project.id = new.project_id
    and project.organization_id = new.organization_id
    and project.status = 'active'::public.project_status
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and repository.id = (binding ->> 'repositoryId')::uuid
    and connection.id = (binding ->> 'connectionId')::uuid
    and installation.id = (binding ->> 'installationId')::uuid
    and installation.external_installation_id = (binding ->> 'externalInstallationId')::bigint
    and repository.external_repository_id = (binding ->> 'externalRepositoryId')::bigint
    and installation.app_id = (binding ->> 'appId')::bigint
    and repository.default_branch = binding ->> 'baseBranch'
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch;
  if not found then
    raise exception using errcode = '55000', message = 'Phase 1C repository binding changed before queueing';
  end if;

  select agent.* into agent_record
  from public.agents agent
  where agent.organization_id = new.organization_id
    and agent.project_id is null
    and agent.role = role_text::public.agent_role
    and agent.provider = provider_text
    and agent.model = model_text
  order by agent.created_at asc
  limit 1
  for update;

  if not found then
    capabilities_value := case role_text
      when 'architect' then '["architecture","planning","review"]'::jsonb
      when 'frontend' then '["frontend","accessibility","responsive-ui"]'::jsonb
      when 'backend' then '["backend","api","debugging"]'::jsonb
      when 'database' then '["database","schema","rls"]'::jsonb
      when 'qa' then '["testing","audit","validation"]'::jsonb
      when 'security' then '["security-review","threat-modeling"]'::jsonb
      when 'performance' then '["performance","profiling","optimization"]'::jsonb
      else jsonb_build_array(role_text)
    end;
    insert into public.agents (
      organization_id, project_id, name, role, description, status,
      provider, model, capabilities, created_by
    ) values (
      new.organization_id, null,
      initcap(replace(role_text, '_', ' ')) || ' Agent',
      role_text::public.agent_role,
      'Provider-neutral logical Phase 1C role.', 'idle'::public.agent_status,
      provider_text, model_text, capabilities_value, command_record.submitted_by
    ) returning * into agent_record;
  end if;

  new.assigned_agent_id := agent_record.id;
  return new;
end;
$function$;

create or replace function public.queue_phase1c_run_for_task()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
declare
  command_record public.commands%rowtype;
  binding jsonb;
begin
  if new.command_id is null or new.status <> 'queued'::public.task_status then return new; end if;
  select command.* into command_record from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found or command_record.requested_risk = 'red'::public.risk_level then return new; end if;
  binding := command_record.parameters -> 'repositoryBinding';

  insert into public.agent_runs (
    organization_id, project_id, task_id, command_id, agent_id, status,
    input, connection_id, github_repository_id, risk_level, logical_agent_role,
    provider, model, base_branch, base_sha, max_attempts
  ) values (
    new.organization_id, new.project_id, new.id, new.command_id, new.assigned_agent_id,
    'queued'::public.run_status,
    jsonb_build_object(
      'commandType', command_record.command_type,
      'acceptanceCriteria', command_record.acceptance_criteria,
      'plan', command_record.execution_plan
    ),
    (binding ->> 'connectionId')::uuid,
    (binding ->> 'repositoryId')::uuid,
    command_record.requested_risk,
    (command_record.parameters ->> 'agentRole')::public.agent_role,
    command_record.parameters ->> 'provider',
    command_record.parameters ->> 'model',
    binding ->> 'baseBranch',
    lower(binding ->> 'baseSha'),
    2
  );
  return new;
end;
$function$;

create or replace function public.keep_phase1c_red_command_blocked()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
begin
  if new.requested_risk = 'red'::public.risk_level
    and new.parameters ->> 'executionMode' = 'manual'
    and new.status in (
      'queued'::public.command_status,
      'running'::public.command_status,
      'succeeded'::public.command_status
    ) then
    new.status := 'awaiting_approval'::public.command_status;
    new.completed_at := null;
  end if;
  return new;
end;
$function$;

create or replace function public.keep_phase1c_red_task_blocked()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
begin
  if new.risk_level = 'red'::public.risk_level
    and new.command_id is not null
    and new.status in (
      'queued'::public.task_status,
      'in_progress'::public.task_status,
      'completed'::public.task_status
    )
    and exists (
      select 1 from public.commands command
      where command.id = new.command_id
        and command.organization_id = new.organization_id
        and command.parameters ->> 'executionMode' = 'manual'
    ) then
    new.status := 'awaiting_approval'::public.task_status;
    new.started_at := null;
    new.completed_at := null;
  end if;
  return new;
end;
$function$;

create trigger commands_phase1c_normalize before insert on public.commands
  for each row execute function public.normalize_phase1c_command();
create trigger commands_phase1c_red_block before update on public.commands
  for each row execute function public.keep_phase1c_red_command_blocked();
create trigger tasks_phase1c_plan before insert on public.tasks
  for each row execute function public.plan_phase1c_task_and_run();
create trigger tasks_phase1c_queue after insert on public.tasks
  for each row execute function public.queue_phase1c_run_for_task();
create trigger tasks_phase1c_red_block before update on public.tasks
  for each row execute function public.keep_phase1c_red_task_blocked();

create or replace function public.register_phase1c_worker(
  p_worker_id text,
  p_version text,
  p_capabilities jsonb default '{}'::jsonb
)
returns table (worker_id text, status text, last_heartbeat_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $function$
declare worker_record public.phase1c_workers%rowtype;
begin
  delete from public.phase1c_workers worker
  where worker.current_run_id is null
    and worker.last_heartbeat_at < now() - interval '30 days';
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
    or char_length(btrim(coalesce(p_version, ''))) not between 1 and 80
    or jsonb_typeof(coalesce(p_capabilities, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_capabilities, '{}'::jsonb)::text) > 16384
    or public.jsonb_has_sensitive_keys(coalesce(p_capabilities, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'invalid worker registration';
  end if;
  insert into public.phase1c_workers as worker (
    worker_id, version, status, capabilities, last_heartbeat_at
  ) values (p_worker_id, btrim(p_version), 'active', p_capabilities, now())
  on conflict on constraint phase1c_workers_pkey do update set
    version = excluded.version,
    status = 'active',
    capabilities = excluded.capabilities,
    last_heartbeat_at = excluded.last_heartbeat_at,
    updated_at = now()
  where worker.status <> 'disabled'
  returning worker.* into worker_record;
  if not found then raise exception using errcode = '42501', message = 'worker is disabled'; end if;
  return query select worker_record.worker_id, worker_record.status, worker_record.last_heartbeat_at;
end;
$function$;

create or replace function public.heartbeat_phase1c_worker(
  p_worker_id text,
  p_current_run_id uuid default null
)
returns table (worker_id text, status text, last_heartbeat_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $function$
declare worker_record public.phase1c_workers%rowtype;
begin
  update public.phase1c_workers worker set
    current_run_id = p_current_run_id,
    last_heartbeat_at = now(),
    updated_at = now()
  where worker.worker_id = p_worker_id and worker.status in ('active','draining')
  returning worker.* into worker_record;
  if not found then raise exception using errcode = '42501', message = 'worker is not registered or active'; end if;
  return query select worker_record.worker_id, worker_record.status, worker_record.last_heartbeat_at;
end;
$function$;

create or replace function public.finish_phase1c_worker(
  p_worker_id text, p_status text default 'disabled'
)
returns table (worker_id text, status text, last_heartbeat_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $function$
declare worker_record public.phase1c_workers%rowtype;
begin
  if p_status not in ('disabled', 'error') then
    raise exception using errcode = '22023', message = 'invalid terminal worker status';
  end if;
  update public.phase1c_workers worker set
    status = p_status,
    current_run_id = null,
    last_heartbeat_at = now(),
    updated_at = now()
  where worker.worker_id = p_worker_id
  returning worker.* into worker_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'worker is not registered';
  end if;
  return query select worker_record.worker_id, worker_record.status,
    worker_record.last_heartbeat_at;
end;
$function$;

create trigger phase1c_run_events_append_only before update or delete on public.phase1c_run_events
  for each row execute function public.reject_phase1c_evidence_mutation();
create trigger phase1c_run_artifacts_append_only before update or delete on public.phase1c_run_artifacts
  for each row execute function public.reject_phase1c_evidence_mutation();
create trigger phase1c_run_validations_append_only before update or delete on public.phase1c_run_validations
  for each row execute function public.reject_phase1c_evidence_mutation();

create or replace function public.resolve_phase1c_command_target(
  p_organization_id uuid,
  p_project_id uuid
)
returns table (
  project_id uuid,
  connection_id uuid,
  repository_id uuid,
  internal_installation_id uuid,
  external_installation_id bigint,
  app_id bigint,
  external_repository_id bigint,
  repository_full_name text,
  base_branch text
)
language plpgsql stable security definer set search_path = pg_catalog as $function$
begin
  if auth.uid() is null or not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'project execution access denied';
  end if;

  return query
  select project.id, connection.id, repository.id, installation.id,
    installation.external_installation_id, installation.app_id,
    repository.external_repository_id, repository.full_name, repository.default_branch
  from public.projects project
  join public.project_connections link
    on link.project_id = project.id and link.organization_id = project.organization_id and link.is_primary
  join public.connections connection
    on connection.id = link.connection_id and connection.organization_id = link.organization_id
  join public.github_installations installation
    on installation.connection_id = connection.id and installation.organization_id = connection.organization_id
  join public.github_repositories repository
    on repository.id = link.github_repository_id
    and repository.installation_id = installation.id
    and repository.organization_id = link.organization_id
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.status = 'active'::public.project_status
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch;

  if not found then
    raise exception using errcode = '55000', message = 'project has no executable GitHub repository binding';
  end if;
end;
$function$;

create or replace function public.complete_phase1c_run(
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
  command_record public.commands%rowtype;
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
  select command.* into command_record from public.commands command where command.id = run_record.command_id for update;
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

create or replace function public.request_phase1c_run_cancellation(
  p_organization_id uuid, p_run_id uuid, p_reason text
)
returns table (run_id uuid, status public.run_status, cancel_requested_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $function$
declare run_record public.agent_runs%rowtype;
begin
  if auth.uid() is null or not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role,'admin'::public.organization_member_role]
  ) then raise exception using errcode = '42501', message = 'run cancellation requires owner or administrator access'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500
    or public.text_has_likely_secret(coalesce(p_reason, '')) then
    raise exception using errcode = '22023', message = 'invalid cancellation reason';
  end if;
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id
    and run.status in ('queued'::public.run_status,'running'::public.run_status)
  for update;
  if not found then return; end if;
  update public.agent_runs run set
    cancellation_requested_at = coalesce(run.cancellation_requested_at, now()),
    cancellation_requested_by = coalesce(run.cancellation_requested_by, auth.uid()),
    cancellation_reason = coalesce(run.cancellation_reason, btrim(p_reason)),
    status = case when run.status = 'queued'::public.run_status then 'cancelled'::public.run_status else run.status end,
    completed_at = case when run.status = 'queued'::public.run_status then now() else run.completed_at end,
    updated_at = now()
  where run.id = run_record.id returning run.* into run_record;
  if run_record.status = 'cancelled'::public.run_status then
    update public.tasks set status = 'cancelled'::public.task_status, completed_at = now(), updated_at = now()
      where id = run_record.task_id;
    update public.commands set status = 'cancelled'::public.command_status, completed_at = now(), updated_at = now()
      where id = run_record.command_id;
  end if;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    'cancellation_requested', 'An owner or administrator requested cancellation.',
    jsonb_build_object('requestedBy', auth.uid(), 'queuedCancellation', run_record.status = 'cancelled'::public.run_status)
  );
  return query select run_record.id, run_record.status, run_record.cancellation_requested_at;
end;
$function$;

create or replace function public.retry_phase1c_run(
  p_organization_id uuid, p_run_id uuid, p_reason text
)
returns table (run_id uuid, status public.run_status, attempt_number integer)
language plpgsql security definer set search_path = pg_catalog as $function$
declare run_record public.agent_runs%rowtype;
begin
  if auth.uid() is null or not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role,'admin'::public.organization_member_role]
  ) then raise exception using errcode = '42501', message = 'run retry requires owner or administrator access'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500
    or public.text_has_likely_secret(coalesce(p_reason, '')) then
    raise exception using errcode = '22023', message = 'invalid retry reason';
  end if;
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id for update;
  if not found then return; end if;
  if run_record.status <> 'failed'::public.run_status or not run_record.retryable
    or run_record.attempt_number >= run_record.max_attempts
    or run_record.cancellation_requested_at is not null
    or exists (select 1 from public.phase1c_run_artifacts artifact
      where artifact.run_id = run_record.id and artifact.artifact_type = 'pull_request') then
    raise exception using errcode = '55000', message = 'run is not eligible for a bounded retry';
  end if;
  update public.agent_runs run set
    status = 'queued'::public.run_status, retryable = false, error_code = null,
    error_message = null, result_summary = null, completed_at = null,
    updated_at = now()
  where run.id = run_record.id returning run.* into run_record;
  update public.tasks set status = 'queued'::public.task_status,
    blocked_reason = null, result_summary = null, completed_at = null, updated_at = now()
    where id = run_record.task_id;
  update public.commands set status = 'queued'::public.command_status,
    completed_at = null, updated_at = now() where id = run_record.command_id;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    'retry_requested', 'An owner or administrator requested a bounded retry.',
    jsonb_build_object('requestedBy', auth.uid(), 'reason', left(btrim(p_reason), 500))
  );
  perform public.record_activity_event(
    run_record.organization_id, run_record.project_id,
    'agent.retry_requested'::public.activity_event_type,
    'agent_run', run_record.id, 'Phase 1C bounded retry requested',
    jsonb_build_object('attempt', run_record.attempt_number, 'maxAttempts', run_record.max_attempts)
  );
  return query select run_record.id, run_record.status, run_record.attempt_number;
end;
$function$;

create or replace function public.record_phase1c_dispatch_outcome(
  p_organization_id uuid, p_command_id uuid, p_outcome text,
  p_reason_code text default null
)
returns table (event_id uuid, run_id uuid)
language plpgsql security definer set search_path = pg_catalog as $function$
declare run_record public.agent_runs%rowtype; new_event_id uuid;
begin
  if auth.uid() is null or not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'dispatch evidence access denied';
  end if;
  if p_outcome not in ('requested','delayed')
    or (p_reason_code is not null and p_reason_code !~ '^[a-z][a-z0-9_]{0,62}$') then
    raise exception using errcode = '22023', message = 'invalid dispatch outcome';
  end if;
  select run.* into run_record from public.agent_runs run
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  where command.id = p_command_id and command.organization_id = p_organization_id
    and (command.submitted_by = auth.uid() or public.can_manage_organization(p_organization_id))
  order by run.created_at desc limit 1;
  if not found then return; end if;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    'dispatch_' || p_outcome,
    case when p_outcome = 'requested' then 'Durable worker dispatch was requested.'
      else 'Durable worker dispatch is delayed; the queued run remains recoverable.' end,
    jsonb_build_object('reasonCode', p_reason_code)
  ) returning id into new_event_id;
  return query select new_event_id, run_record.id;
end;
$function$;

-- Replace the Phase 1A list projections so the Phase 1C consoles do not infer
-- execution state from absent columns. These remain caller-bound, bounded,
-- allowlisted projections; raw payloads, leases, worker identifiers, and
-- diagnostics stay server-only.
drop function public.list_agents(uuid, integer);
create function public.list_agents(
  p_organization_id uuid, p_limit integer default 50
)
returns table (
  id uuid, name text, role public.agent_role, description text,
  status public.agent_status, provider text, model text,
  last_run_at timestamptz, capabilities jsonb,
  current_assignment text, provider_connection_status text,
  project_id uuid, project_name text
)
language sql stable security definer set search_path = pg_catalog as $function$
  select agent.id, agent.name, agent.role, left(agent.description, 1000), agent.status,
    agent.provider, agent.model, agent.last_run_at,
    case when octet_length(agent.capabilities::text) <= 8192
      then agent.capabilities else '[]'::jsonb end,
    left(agent.current_assignment, 240),
    case when exists (
      select 1 from public.phase1c_workers worker
      where worker.status = 'active'
        and worker.last_heartbeat_at > now() - interval '5 minutes'
        and worker.last_heartbeat_at <= now() + interval '1 minute'
        and worker.capabilities -> 'providers' ? agent.provider
    ) then 'connected' else 'not_connected' end,
    project.id, project.name
  from public.agents agent
  left join public.projects project
    on project.id = agent.project_id and project.organization_id = agent.organization_id
  where agent.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by agent.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

drop function public.list_tasks(uuid, integer);
create function public.list_tasks(
  p_organization_id uuid, p_limit integer default 50
)
returns table (
  id uuid, title text, status public.task_status, risk_level public.risk_level,
  requires_owner_approval boolean, priority smallint, created_at timestamptz,
  project_id uuid, project_name text, assigned_agent_id uuid, agent_name text,
  command_id uuid, command_prompt text, dependency_count integer,
  latest_run_id uuid, latest_run_status public.run_status,
  pull_request_number integer, pull_request_url text,
  pull_request_status public.pull_request_status
)
language sql stable security definer set search_path = pg_catalog as $function$
  select task.id, task.title, task.status, task.risk_level,
    task.requires_owner_approval, task.priority, task.created_at,
    project.id, project.name, agent.id, agent.name,
    command.id, left(command.prompt, 1000),
    (select count(*)::integer from public.task_dependencies dependency
      where dependency.task_id = task.id),
    latest_run.id, latest_run.status,
    latest_pull.external_number, latest_pull.url, latest_pull.status
  from public.tasks task
  left join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  left join public.agents agent
    on agent.id = task.assigned_agent_id and agent.organization_id = task.organization_id
  left join public.commands command
    on command.id = task.command_id and command.organization_id = task.organization_id
  left join lateral (
    select run.id, run.status
    from public.agent_runs run where run.task_id = task.id
      and run.organization_id = task.organization_id
    order by run.created_at desc limit 1
  ) latest_run on true
  left join lateral (
    select pull.external_number, pull.url, pull.status
    from public.pull_requests pull join public.agent_runs run on run.id = pull.agent_run_id
      and run.organization_id = pull.organization_id
    where run.task_id = task.id and pull.organization_id = task.organization_id
    order by pull.created_at desc limit 1
  ) latest_pull on true
  where task.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by task.priority desc, task.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

drop function public.list_agent_runs(uuid, integer);
create function public.list_agent_runs(
  p_organization_id uuid, p_limit integer default 50
)
returns table (
  id uuid, status public.run_status, started_at timestamptz,
  completed_at timestamptz, created_at timestamptz,
  task_id uuid, task_title text, agent_id uuid, agent_name text,
  project_id uuid, project_name text, risk_level public.risk_level,
  provider text, model text, branch_name text
)
language sql stable security definer set search_path = pg_catalog as $function$
  select run.id, run.status, run.started_at, run.completed_at, run.created_at,
    task.id, task.title, agent.id, agent.name, project.id, project.name,
    run.risk_level, run.provider, run.model, run.head_branch
  from public.agent_runs run
  left join public.tasks task
    on task.id = run.task_id and task.organization_id = run.organization_id
  left join public.agents agent
    on agent.id = run.agent_id and agent.organization_id = run.organization_id
  left join public.projects project
    on project.id = run.project_id and project.organization_id = run.organization_id
  where run.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by run.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

drop function public.list_reports(uuid, integer);
create function public.list_reports(
  p_organization_id uuid, p_limit integer default 50
)
returns table (
  id uuid, type public.report_type, status public.report_status,
  title text, summary text, period_start timestamptz, period_end timestamptz,
  published_at timestamptz, created_at timestamptz,
  project_id uuid, project_name text,
  generated_by_agent_id uuid, generated_by_agent_name text
)
language sql stable security definer set search_path = pg_catalog as $function$
  select report.id, report.type, report.status, report.title, left(report.summary, 1000),
    report.period_start, report.period_end, report.published_at, report.created_at,
    project.id, project.name, agent.id, agent.name
  from public.reports report
  left join public.projects project
    on project.id = report.project_id and project.organization_id = report.organization_id
  left join public.agents agent
    on agent.id = report.generated_by_agent_id and agent.organization_id = report.organization_id
  where report.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by report.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- Close every Phase 1C entry point first, including trigger helpers, and then
-- grant only the minimum browser or worker surface deliberately.
revoke all on function public.submit_command_phase1a_internal(uuid, text, public.risk_level, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_command(uuid, text, public.risk_level, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.reject_phase1c_evidence_mutation() from public, anon, authenticated, service_role;
revoke all on function public.reject_phase1c_agent_run_sensitive_data() from public, anon, authenticated, service_role;
revoke all on function public.normalize_phase1c_command() from public, anon, authenticated, service_role;
revoke all on function public.plan_phase1c_task_and_run() from public, anon, authenticated, service_role;
revoke all on function public.queue_phase1c_run_for_task() from public, anon, authenticated, service_role;
revoke all on function public.keep_phase1c_red_command_blocked() from public, anon, authenticated, service_role;
revoke all on function public.keep_phase1c_red_task_blocked() from public, anon, authenticated, service_role;

revoke all on function public.resolve_phase1c_command_target(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_phase1c_worker_status(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_agent_run_detail(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_task_detail(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_agent_detail(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_report_detail(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.request_phase1c_run_cancellation(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.retry_phase1c_run(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_phase1c_dispatch_outcome(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.list_agents(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_tasks(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_agent_runs(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_reports(uuid, integer) from public, anon, authenticated, service_role;

revoke all on function public.register_phase1c_worker(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.heartbeat_phase1c_worker(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_phase1c_worker(text, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run(text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.heartbeat_phase1c_run(text, uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.append_phase1c_run_event(text, uuid, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.record_phase1c_validation(text, uuid, uuid, integer, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.record_phase1c_run_artifact(text, uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.submit_command(uuid, text, public.risk_level, jsonb, text) to authenticated;
grant execute on function public.resolve_phase1c_command_target(uuid, uuid) to authenticated;
grant execute on function public.get_phase1c_worker_status(uuid) to authenticated;
grant execute on function public.get_agent_run_detail(uuid, uuid) to authenticated;
grant execute on function public.get_task_detail(uuid, uuid) to authenticated;
grant execute on function public.get_agent_detail(uuid, uuid) to authenticated;
grant execute on function public.get_report_detail(uuid, uuid) to authenticated;
grant execute on function public.request_phase1c_run_cancellation(uuid, uuid, text) to authenticated;
grant execute on function public.retry_phase1c_run(uuid, uuid, text) to authenticated;
grant execute on function public.record_phase1c_dispatch_outcome(uuid, uuid, text, text) to authenticated;
grant execute on function public.list_agents(uuid, integer) to authenticated;
grant execute on function public.list_tasks(uuid, integer) to authenticated;
grant execute on function public.list_agent_runs(uuid, integer) to authenticated;
grant execute on function public.list_reports(uuid, integer) to authenticated;

grant execute on function public.register_phase1c_worker(text, text, jsonb) to service_role;
grant execute on function public.heartbeat_phase1c_worker(text, uuid) to service_role;
grant execute on function public.finish_phase1c_worker(text, text) to service_role;
grant execute on function public.claim_phase1c_run(text, text, text, integer) to service_role;
grant execute on function public.heartbeat_phase1c_run(text, uuid, uuid, integer) to service_role;
grant execute on function public.append_phase1c_run_event(text, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.record_phase1c_validation(text, uuid, uuid, integer, text, text, text, integer, text) to service_role;
grant execute on function public.record_phase1c_run_artifact(text, uuid, uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.complete_phase1c_run(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean) to service_role;

comment on function public.resolve_phase1c_command_target(uuid, uuid) is
  'Caller-bound executable GitHub target projection; returns no credentials.';
comment on function public.get_phase1c_worker_status(uuid) is
  'Caller-bound aggregate worker health projection; returns no worker identifiers or capabilities.';
comment on function public.claim_phase1c_run(text, text, text, integer) is
  'Service-role-only atomic GREEN/YELLOW run claim with a short-lived opaque lease.';
comment on function public.complete_phase1c_run(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean) is
  'Service-role-only terminal transition requiring an active lease and immutable evidence.';
