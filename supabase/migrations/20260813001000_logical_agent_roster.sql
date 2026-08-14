-- Phase 1C provider-neutral logical agent roster and SQL risk parity.
--
-- Logical agents describe durable responsibilities. Provider/model selection is
-- execution metadata on agent_runs, never part of the logical identity.

-- A repair may push more than one immutable commit to the same draft PR. Keep
-- each observed PR-head transition as append-only evidence without rewriting
-- the original pull_request artifact.
alter table public.phase1c_run_artifacts
  drop constraint phase1c_run_artifacts_artifact_type_check;
alter table public.phase1c_run_artifacts
  add constraint phase1c_run_artifacts_artifact_type_check check (
    artifact_type in ('branch', 'commit', 'pull_request', 'pull_request_head', 'file', 'report')
  );

-- GitHub Actions workers are deliberately ephemeral. A clean one-shot exit is
-- idle/available, while disabled remains an explicit operator stop state.
alter table public.phase1c_workers
  drop constraint phase1c_workers_status_check;
alter table public.phase1c_workers
  add constraint phase1c_workers_status_check check (
    status in ('active', 'draining', 'idle', 'disabled', 'error')
  );

create or replace function public.initialize_standard_logical_agent_roster(
  p_organization_id uuid,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  roster record;
begin
  if p_organization_id is null or p_created_by is null then
    raise exception using errcode = '23503', message = 'logical roster requires an organization and creator';
  end if;
  -- The organization row is the serialization point for concurrent lazy
  -- initialization, so the check-then-insert loop remains exactly idempotent.
  perform organization.id from public.organizations organization
  where organization.id = p_organization_id
    and exists (select 1 from auth.users user_record where user_record.id = p_created_by)
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'logical roster requires an organization and creator';
  end if;

  for roster in
    select * from (values
      ('Orchestrator', 'orchestrator'::public.agent_role, 'Coordinates bounded work across logical roles.', '["coordination","planning","delegation"]'::jsonb),
      ('Product', 'product'::public.agent_role, 'Clarifies product intent, scope, and acceptance criteria.', '["product","requirements","acceptance-criteria"]'::jsonb),
      ('Architect', 'architect'::public.agent_role, 'Owns system architecture, planning, and technical review.', '["architecture","planning","review"]'::jsonb),
      ('Frontend', 'frontend'::public.agent_role, 'Owns accessible, responsive client experiences.', '["frontend","accessibility","responsive-ui"]'::jsonb),
      ('Backend', 'backend'::public.agent_role, 'Owns server behavior, APIs, and debugging.', '["backend","api","debugging"]'::jsonb),
      ('Database', 'database'::public.agent_role, 'Owns schema, data integrity, and row-level security.', '["database","schema","rls"]'::jsonb),
      ('QA', 'qa'::public.agent_role, 'Owns testing, audits, and deterministic validation.', '["testing","audit","validation"]'::jsonb),
      ('Security', 'security'::public.agent_role, 'Owns security review and threat modeling.', '["security-review","threat-modeling","policy"]'::jsonb),
      ('Performance', 'performance'::public.agent_role, 'Owns profiling and bounded performance optimization.', '["performance","profiling","optimization"]'::jsonb),
      ('Release', 'release'::public.agent_role, 'Owns release readiness and delivery coordination.', '["release-readiness","change-management","verification"]'::jsonb),
      ('CEO Reporter', 'ceo_reporter'::public.agent_role, 'Produces evidence-backed executive reporting.', '["reporting","summarization","decision-support"]'::jsonb)
    ) as value(name, role, description, capabilities)
  loop
    -- Reuse an existing organization-wide provider-neutral role if one exists.
    -- Factory-created rows are named exactly as their role; user-created rows
    -- with different names are never overwritten.
    if not exists (
      select 1 from public.agents agent
      where agent.organization_id = p_organization_id
        and agent.project_id is null
        and agent.role = roster.role
        and agent.name = roster.name
        and agent.provider is null
        and agent.model is null
    ) then
      insert into public.agents (
        organization_id, project_id, name, role, description, status,
        provider, model, capabilities, created_by
      ) values (
        p_organization_id, null, roster.name, roster.role, roster.description,
        'idle'::public.agent_status, null, null, roster.capabilities, p_created_by
      );
    end if;
  end loop;
end;
$function$;

create or replace function public.initialize_standard_logical_agent_roster_after_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.initialize_standard_logical_agent_roster(new.id, new.created_by);
  return new;
end;
$function$;

create trigger organizations_initialize_logical_agent_roster
  after insert on public.organizations
  for each row execute function public.initialize_standard_logical_agent_roster_after_organization();

-- Preserve Phase 2A's public setup contract while delegating identity to the
-- canonical provider-neutral roster introduced above.
create or replace function public.ensure_default_agents(p_organization_id uuid)
returns setof public.agents
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  perform public.initialize_standard_logical_agent_roster(p_organization_id, caller_id);
  return query
    select agent.* from public.agents agent
    where agent.organization_id = p_organization_id
    order by agent.created_at, agent.name;
end;
$function$;

do $backfill$
declare organization_record record;
begin
  for organization_record in
    select organization.id, organization.created_by from public.organizations organization
  loop
    perform public.initialize_standard_logical_agent_roster(
      organization_record.id,
      organization_record.created_by
    );
  end loop;
end;
$backfill$;

-- Rebind existing Phase 1C execution records to provider-neutral role rows
-- before removing obsolete, unreferenced provider-bound factory identities.
update public.tasks task
set assigned_agent_id = neutral.id
from public.agents bound
join public.agents neutral
  on neutral.organization_id = bound.organization_id
  and neutral.project_id is null
  and neutral.role = case when bound.role = 'custom'::public.agent_role
    then 'orchestrator'::public.agent_role else bound.role end
  and neutral.provider is null
  and neutral.model is null
where task.assigned_agent_id = bound.id
  and bound.project_id is null
  and bound.description = 'Provider-neutral logical Phase 1C role.'
  and (bound.provider is not null or bound.model is not null);

update public.agent_runs run
set agent_id = neutral.id
from public.agents bound
join public.agents neutral
  on neutral.organization_id = bound.organization_id
  and neutral.project_id is null
  and neutral.role = case when bound.role = 'custom'::public.agent_role
    then 'orchestrator'::public.agent_role else bound.role end
  and neutral.provider is null
  and neutral.model is null
where run.agent_id = bound.id
  and bound.project_id is null
  and bound.description = 'Provider-neutral logical Phase 1C role.'
  and (bound.provider is not null or bound.model is not null);

update public.reports report
set generated_by_agent_id = neutral.id
from public.agents bound
join public.agents neutral
  on neutral.organization_id = bound.organization_id
  and neutral.project_id is null
  and neutral.role = case when bound.role = 'custom'::public.agent_role
    then 'orchestrator'::public.agent_role else bound.role end
  and neutral.provider is null
  and neutral.model is null
where report.generated_by_agent_id = bound.id
  and bound.project_id is null
  and bound.description = 'Provider-neutral logical Phase 1C role.'
  and (bound.provider is not null or bound.model is not null);

delete from public.agents bound
where bound.project_id is null
  and bound.description = 'Provider-neutral logical Phase 1C role.'
  and (bound.provider is not null or bound.model is not null)
  and not exists (select 1 from public.tasks task where task.assigned_agent_id = bound.id)
  and not exists (select 1 from public.agent_runs run where run.agent_id = bound.id)
  and not exists (select 1 from public.reports report where report.generated_by_agent_id = bound.id);

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
begin
  if new.command_id is null then return new; end if;

  select command.* into command_record from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found then return new; end if;
  new.acceptance_criteria := command_record.acceptance_criteria;
  if command_record.requested_risk = 'red'::public.risk_level then return new; end if;
  if command_record.requested_risk not in ('green'::public.risk_level, 'yellow'::public.risk_level)
    or new.status <> 'queued'::public.task_status then
    raise exception using errcode = '55000', message = 'only queued manual GREEN or YELLOW commands enter Phase 1C';
  end if;

  binding := command_record.parameters -> 'repositoryBinding';
  budget := command_record.parameters -> 'budget';
  role_text := command_record.parameters ->> 'agentRole';
  provider_text := command_record.parameters ->> 'provider';
  model_text := command_record.parameters ->> 'model';
  if jsonb_typeof(binding) <> 'object' or jsonb_typeof(budget) <> 'object'
    or role_text not in ('orchestrator','product','architect','frontend','backend','database','qa','security','performance','release','ceo_reporter')
    or provider_text <> 'openai' or model_text <> 'gpt-5.3-codex'
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

  select project.id as project_id into repository_record
  from public.projects project
  join public.project_connections link on link.project_id = project.id
    and link.organization_id = project.organization_id and link.is_primary
  join public.connections connection on connection.id = link.connection_id
    and connection.organization_id = link.organization_id
  join public.github_installations installation on installation.connection_id = connection.id
    and installation.organization_id = connection.organization_id
  join public.github_repositories repository on repository.id = link.github_repository_id
    and repository.installation_id = installation.id and repository.organization_id = link.organization_id
  where project.id = new.project_id and project.organization_id = new.organization_id
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

  select agent.* into agent_record from public.agents agent
  where agent.organization_id = new.organization_id and agent.project_id is null
    and agent.role = role_text::public.agent_role
    and agent.name = case role_text
      when 'ceo_reporter' then 'CEO Reporter'
      when 'qa' then 'QA'
      else initcap(replace(role_text, '_', ' ')) end
    and agent.provider is null and agent.model is null
  order by agent.created_at asc limit 1 for update;
  if not found then
    perform public.initialize_standard_logical_agent_roster(
      new.organization_id,
      command_record.submitted_by
    );
    select agent.* into agent_record from public.agents agent
    where agent.organization_id = new.organization_id and agent.project_id is null
      and agent.role = role_text::public.agent_role
      and agent.name = case role_text
        when 'ceo_reporter' then 'CEO Reporter'
        when 'qa' then 'QA'
        else initcap(replace(role_text, '_', ' ')) end
      and agent.provider is null and agent.model is null
    order by agent.created_at asc limit 1 for update;
  end if;
  if not found then
    raise exception using errcode = '55000', message = 'standard logical agent roster is unavailable';
  end if;
  new.assigned_agent_id := agent_record.id;
  return new;
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
    'ciTimeoutMs', 900000, 'maximumDurationMs', 2700000,
    'maximumInputTokens', 200000, 'maximumOutputTokens', 50000,
    'maximumRepairAttempts', 1, 'maximumTurns', 4
  );
  expected_plan constant jsonb := jsonb_build_object(
    'requiresDraftPullRequest', true,
    'stages', jsonb_build_array('inspect','implement','validate','policy_scan',
      'commit','draft_pull_request','ci','report'),
    'workflow', 'codex_draft_pr'
  );
begin
  if command_type_value not in ('fix_bug','build_feature','audit','test','mobile','security','performance','other')
    or coalesce(new.parameters ->> 'executionMode', '') <> 'manual'
    or jsonb_typeof(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) > 30
    or exists (
      select 1 from jsonb_array_elements(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) criterion
      where jsonb_typeof(criterion) <> 'string'
        or char_length(btrim(criterion #>> '{}')) not between 3 and 500
        or public.text_has_likely_secret(criterion #>> '{}')
    )
    or jsonb_typeof(coalesce(new.parameters -> 'plan', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(new.parameters -> 'riskAssessment', '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid Phase 1C command plan';
  end if;
  select normalized_prompt || ' ' || coalesce(string_agg(lower(criterion #>> '{}'), ' '), '')
    into normalized_prompt
  from jsonb_array_elements(new.parameters -> 'acceptanceCriteria') criterion;
  required_role := case command_type_value
    when 'audit' then 'qa' when 'test' then 'qa' when 'mobile' then 'frontend'
    when 'security' then 'security' when 'performance' then 'performance'
    when 'build_feature' then 'architect' when 'fix_bug' then 'backend'
    else 'orchestrator' end;
  if new.parameters ->> 'provider' <> 'openai'
    or new.parameters ->> 'model' <> 'gpt-5.3-codex'
    or new.parameters ->> 'agentRole' <> required_role
    or new.parameters -> 'budget' is distinct from expected_budget
    or new.parameters -> 'plan' is distinct from expected_plan then
    raise exception using errcode = '22023', message = 'Phase 1C execution configuration is not supported';
  end if;
  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(\mauth\M|authentication|authorization|oauth|session|cookie|rbac|permission|secret|credential|password|private[ _-]?key|api[ _-]?key|token|rls|row[ -]?level security|service[ _-]?role|production database|delete production|drop table|truncate|dns|domain ownership|billing|payment|money|auto[ -]?(merge|deploy|rollback|approve)|branch protection)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug','build_feature','mobile','performance','other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package(\.json)?|lockfile|upgrade|api|backend|frontend|component|route|workflow|configuration|refactor|feature|bug|performance|mobile|accessibility)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level end;
  new.requested_risk := greatest(new.requested_risk, risk_floor);
  new.parameters := jsonb_set(jsonb_set(new.parameters,
    '{riskAssessment,effectiveRisk}', to_jsonb(new.requested_risk::text), true),
    '{riskAssessment,classificationSource}', '"database_policy"'::jsonb, true);
  new.command_type := command_type_value;
  new.acceptance_criteria := coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb);
  new.execution_plan := coalesce(new.parameters -> 'plan', '{}'::jsonb);
  new.risk_assessment := coalesce(new.parameters -> 'riskAssessment', '{}'::jsonb);
  return new;
end;
$function$;

create or replace function public.record_phase1c_run_artifact(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_artifact_type text, p_reference text, p_external_number integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $function$
declare
  run_record public.agent_runs%rowtype;
  artifact_id uuid;
  pull_record public.pull_requests%rowtype;
  repository_name text;
  canonical_pull_url text;
  task_title text;
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
    ) for update;
  if not found then raise exception using errcode = '42501', message = 'active run lease required'; end if;
  select repository.full_name into repository_name
  from public.github_repositories repository
  where repository.id = run_record.github_repository_id
    and repository.organization_id = run_record.organization_id;
  if repository_name is null then
    raise exception using errcode = '55000', message = 'authorized run repository is unavailable';
  end if;
  if p_external_number is not null then
    canonical_pull_url := 'https://github.com/' || repository_name || '/pull/' || p_external_number::text;
  end if;
  if p_artifact_type not in ('branch','commit','pull_request','pull_request_head','file','report')
    or char_length(btrim(coalesce(p_reference, ''))) not between 1 and 2000
    or (p_external_number is not null and p_external_number <= 0)
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 16384
    or public.text_has_likely_secret(coalesce(p_reference, ''))
    or public.jsonb_has_sensitive_keys(coalesce(p_metadata, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'invalid or sensitive run artifact';
  end if;
  if p_artifact_type = 'branch' and btrim(p_reference) !~ '^factory/[A-Za-z0-9._/-]{1,240}$' then
    raise exception using errcode = '22023', message = 'invalid factory branch artifact';
  end if;
  if p_artifact_type = 'commit' and btrim(p_reference) !~ '^[0-9a-fA-F]{40}$' then
    raise exception using errcode = '22023', message = 'invalid commit artifact';
  end if;
  if p_artifact_type = 'pull_request' and (
    p_external_number is null or btrim(p_reference) is distinct from canonical_pull_url
    or coalesce(p_metadata ->> 'commitSha', '') !~ '^[0-9a-fA-F]{40}$'
    or lower(p_metadata ->> 'commitSha') is distinct from run_record.head_sha
    or run_record.head_branch !~ '^factory/[A-Za-z0-9._/-]{1,240}$'
  ) then
    raise exception using errcode = '22023', message = 'invalid or incoherent pull request artifact';
  end if;
  if p_artifact_type = 'pull_request_head' and (
    p_external_number is null
    or btrim(p_reference) !~ '^[0-9a-fA-F]{40}$'
    or btrim(coalesce(p_metadata ->> 'pullRequestUrl', '')) is distinct from canonical_pull_url
    or lower(btrim(p_reference)) is distinct from run_record.head_sha
  ) then
    raise exception using errcode = '22023', message = 'invalid or incoherent pull request head artifact';
  end if;

  insert into public.phase1c_run_artifacts (
    organization_id, run_id, attempt_number, artifact_type, reference, external_number, metadata
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    p_artifact_type, btrim(p_reference), p_external_number, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (run_id, attempt_number, artifact_type, reference) do nothing
  returning id into artifact_id;
  if artifact_id is null then
    select artifact.id into artifact_id from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id and artifact.attempt_number = run_record.attempt_number
      and artifact.artifact_type = p_artifact_type and artifact.reference = btrim(p_reference)
      and artifact.organization_id = run_record.organization_id
      and artifact.external_number is not distinct from p_external_number
      and artifact.metadata = coalesce(p_metadata, '{}'::jsonb);
    if artifact_id is null then
      raise exception using errcode = '23505', message = 'artifact replay conflicts with immutable evidence';
    end if;
  end if;

  if p_artifact_type = 'branch' then
    update public.agent_runs run set head_branch = btrim(p_reference), updated_at = now()
      where run.id = run_record.id returning run.* into run_record;
  elsif p_artifact_type = 'commit' then
    update public.agent_runs run set head_sha = lower(btrim(p_reference)), updated_at = now()
      where run.id = run_record.id returning run.* into run_record;
  elsif p_artifact_type = 'pull_request' then
    select task.title into task_title from public.tasks task where task.id = run_record.task_id;
    insert into public.pull_requests (
      organization_id, project_id, agent_run_id, repository, external_number,
      title, url, head_branch, base_branch, status, risk_level, opened_at
    ) values (
      run_record.organization_id, run_record.project_id, run_record.id, repository_name,
      p_external_number, task_title, btrim(p_reference), run_record.head_branch,
      run_record.base_branch, 'draft'::public.pull_request_status, run_record.risk_level, now()
    ) on conflict (project_id, repository, external_number) do nothing;
    select pull.* into pull_record from public.pull_requests pull
    where pull.project_id = run_record.project_id and pull.repository = repository_name
      and pull.external_number = p_external_number;
    if pull_record.agent_run_id is distinct from run_record.id
      or pull_record.organization_id is distinct from run_record.organization_id
      or pull_record.status <> 'draft'::public.pull_request_status
      or pull_record.url <> btrim(p_reference)
      or pull_record.head_branch <> run_record.head_branch
      or pull_record.base_branch <> run_record.base_branch then
      raise exception using errcode = '55000', message = 'pull request evidence conflicts with durable run state';
    end if;
  end if;
  return artifact_id;
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
    status = case when run.status = 'queued'::public.run_status
      then 'cancelled'::public.run_status else run.status end,
    output = case when run.status = 'queued'::public.run_status then jsonb_build_object(
      'outcome', 'cancelled', 'summary', 'Cancelled before execution started.'
    ) else run.output end,
    result_summary = case when run.status = 'queued'::public.run_status
      then 'Cancelled before execution started.' else run.result_summary end,
    completed_at = case when run.status = 'queued'::public.run_status
      then now() else run.completed_at end,
    updated_at = now()
  where run.id = run_record.id returning run.* into run_record;
  if run_record.status = 'cancelled'::public.run_status then
    update public.tasks task set status = 'cancelled'::public.task_status,
      result = jsonb_build_object('runId', run_record.id, 'outcome', 'cancelled'),
      result_summary = 'Cancelled before execution started.',
      completed_at = now(), updated_at = now()
      where task.id = run_record.task_id;
    update public.commands command set status = 'cancelled'::public.command_status,
      completed_at = now(), updated_at = now() where command.id = run_record.command_id;
  end if;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    'cancellation_requested', 'An owner or administrator requested cancellation.',
    jsonb_build_object('requestedBy', auth.uid(), 'reason', left(btrim(p_reason), 500),
      'queuedCancellation', run_record.status = 'cancelled'::public.run_status)
  );
  if run_record.status = 'cancelled'::public.run_status then
    insert into public.phase1c_run_events (
      organization_id, run_id, attempt_number, event_type, message, details
    ) values (
      run_record.organization_id, run_record.id, run_record.attempt_number,
      'cancelled', 'The queued run was cancelled before a worker claim.',
      jsonb_build_object('requestedBy', run_record.cancellation_requested_by)
    );
    perform public.record_activity_event(
      run_record.organization_id, run_record.project_id,
      'agent.cancelled'::public.activity_event_type, 'agent_run', run_record.id,
      'Phase 1C queued run cancelled',
      jsonb_build_object('attempt', run_record.attempt_number)
    );
    insert into public.reports (
      organization_id, project_id, generated_by_agent_id, type, status,
      title, summary, content, period_start, period_end, published_at
    ) values (
      run_record.organization_id, run_record.project_id, run_record.agent_id,
      'quality'::public.report_type, 'published'::public.report_status,
      'Phase 1C run ' || left(run_record.id::text, 8) || ' cancelled',
      'Cancelled before execution started.',
      jsonb_build_object(
        'outcome', 'cancelled', 'runIds', jsonb_build_array(run_record.id),
        'pullRequestNumbers', '[]'::jsonb,
        'changedFiles', '[]'::jsonb, 'checks', '[]'::jsonb, 'validations', '[]'::jsonb,
        'sections', jsonb_build_array(jsonb_build_object(
          'title', 'Cancellation completed',
          'body', 'The queued run was cancelled before a worker claimed it.'
        )),
        'findings', jsonb_build_array(jsonb_build_object(
          'title', 'Execution not started', 'severity', 'medium', 'status', 'open',
          'summary', 'No repository or provider mutation occurred.'
        )),
        'security', jsonb_build_object(
          'risk', run_record.risk_level, 'errorCode', null,
          'blocker', 'Owner-requested cancellation.'
        ),
        'decisions', jsonb_build_array(jsonb_build_object(
          'id', run_record.id::text || '-cancellation',
          'title', 'Cancellation requested', 'status', 'recorded',
          'ownerAction', left(run_record.cancellation_reason, 500)
        ))
      ), null, now(), now()
    );
  end if;
  return query select run_record.id, run_record.status, run_record.cancellation_requested_at;
end;
$function$;

create or replace function public.retry_phase1c_run(
  p_organization_id uuid, p_run_id uuid, p_reason text
)
returns table (run_id uuid, status public.run_status, attempt_number integer)
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  run_record public.agent_runs%rowtype;
  branch_artifact_count integer;
  commit_artifact_count integer;
  pull_artifact_count integer;
  draft_pull_count integer;
  recovery_is_coherent boolean;
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
    or run_record.error_code = 'timed_out'
    or run_record.cancellation_requested_at is not null
    or exists (select 1 from public.phase1c_run_events event
      where event.run_id = run_record.id and event.event_type = 'succeeded') then
    raise exception using errcode = '55000', message = 'run is not eligible for a bounded retry';
  end if;

  select count(*)::integer into branch_artifact_count
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id and artifact.artifact_type = 'branch';
  select count(*)::integer into commit_artifact_count
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id and artifact.artifact_type = 'commit';
  select count(*)::integer into pull_artifact_count
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id and artifact.artifact_type = 'pull_request';
  select count(*)::integer into draft_pull_count
  from public.pull_requests pull
  where pull.agent_run_id = run_record.id;
  -- A branch artifact is a durable local intent, not proof that a provider
  -- mutation occurred. A failure before commit/push can restart cleanly.
  if branch_artifact_count = 1 and commit_artifact_count = 0
    and pull_artifact_count = 0 and draft_pull_count = 0 then
    recovery_is_coherent := true;
  elsif branch_artifact_count > 0 or commit_artifact_count > 0
    or pull_artifact_count > 0 or draft_pull_count > 0 then
    select (
      branch_artifact_count = 1
      and commit_artifact_count >= 1
      and run_record.head_branch ~ '^factory/[A-Za-z0-9._/-]{1,240}$'
      and run_record.head_sha ~ '^[0-9a-f]{40}$'
      and exists (select 1 from public.phase1c_run_artifacts branch
        where branch.run_id = run_record.id and branch.artifact_type = 'branch'
          and branch.reference = run_record.head_branch)
      and (select count(*) from public.phase1c_run_artifacts commit
        where commit.run_id = run_record.id and commit.artifact_type = 'commit'
          and lower(commit.reference) = run_record.head_sha) = 1
      and (
        (pull_artifact_count = 0 and draft_pull_count = 0)
        or (
          pull_artifact_count = 1 and draft_pull_count = 1
          and exists (
            select 1 from public.pull_requests pull
            join public.github_repositories repository
              on repository.id = run_record.github_repository_id
              and repository.organization_id = run_record.organization_id
            where pull.agent_run_id = run_record.id
              and pull.organization_id = run_record.organization_id
              and pull.project_id = run_record.project_id
              and pull.repository = repository.full_name
              and pull.status = 'draft'::public.pull_request_status
              and pull.head_branch = run_record.head_branch
              and pull.base_branch = run_record.base_branch
              and exists (select 1 from public.phase1c_run_artifacts artifact
                where artifact.run_id = run_record.id
                  and artifact.artifact_type = 'pull_request'
                  and artifact.reference = pull.url
                  and artifact.external_number = pull.external_number)
          )
        )
      )
    ) into recovery_is_coherent;
    if not coalesce(recovery_is_coherent, false) then
      raise exception using errcode = '55000', message = 'recovery evidence is partial or inconsistent';
    end if;
  end if;

  update public.agent_runs run set
    status = 'queued'::public.run_status, retryable = false, error_code = null,
    error_message = null, result_summary = null, completed_at = null,
    lease_worker_id = null, lease_token = null, lease_expires_at = null,
    updated_at = now()
  where run.id = run_record.id returning run.* into run_record;
  update public.tasks set status = 'queued'::public.task_status,
    blocked_reason = null, result = null, result_summary = null,
    started_at = null, completed_at = null, updated_at = now()
    where id = run_record.task_id;
  update public.commands set status = 'queued'::public.command_status,
    completed_at = null, updated_at = now() where id = run_record.command_id;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    run_record.organization_id, run_record.id, run_record.attempt_number,
    'retry_requested', 'An owner or administrator requested a bounded retry.',
    jsonb_build_object('requestedBy', auth.uid(), 'reason', left(btrim(p_reason), 500),
      'recoverBranch', branch_artifact_count = 1 and commit_artifact_count = 1,
      'recoverDraftPullRequest', pull_artifact_count = 1 and draft_pull_count = 1)
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

alter function public.complete_phase1c_run(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) rename to complete_phase1c_run_internal;

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
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  run_record public.agent_runs%rowtype;
  result_record record;
  source_attempt integer;
  source_round integer;
  report_id uuid;
  pull_number integer;
  structured_content jsonb;
  branch_count integer;
  commit_count integer;
  pull_artifact_count integer;
  branch_reference text;
  commit_reference text;
  pull_reference text;
  pull_metadata jsonb;
  repository_record public.github_repositories%rowtype;
  task_title text;
  persisted_pull public.pull_requests%rowtype;
  maximum_duration_ms integer;
begin
  select run.* into run_record from public.agent_runs run
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now() for update;
  if not found then raise exception using errcode = '42501', message = 'active run lease required'; end if;
  select (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
    into maximum_duration_ms
  from public.commands command
  where command.id = run_record.command_id
    and command.organization_id = run_record.organization_id;
  if run_record.cancellation_requested_at is not null then
    p_outcome := 'cancelled';
    p_summary := 'Run stopped at the owner-requested safe cancellation boundary.';
    p_error_code := null;
    p_error_message := null;
    p_retryable := false;
  elsif maximum_duration_ms is null
    or maximum_duration_ms not between 60000 and 3600000
    or run_record.started_at is null
    or run_record.started_at + make_interval(secs => maximum_duration_ms / 1000.0) <= now() then
    p_outcome := 'failed';
    p_summary := 'Run stopped at the configured maximum execution duration.';
    p_error_code := 'timed_out';
    p_error_message := 'The bounded execution deadline elapsed before completion.';
    p_retryable := false;
  end if;

  -- Reconcile provider evidence before any terminal transition. This also
  -- repairs pre-030 runs whose immutable artifacts were written before the
  -- draft pull-request projection existed. No provider call occurs here.
  select count(*)::integer, min(artifact.reference)
    into branch_count, branch_reference
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id
    and artifact.attempt_number = run_record.attempt_number
    and artifact.artifact_type = 'branch';
  select count(*)::integer
    into commit_count
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id
    and artifact.attempt_number = run_record.attempt_number
    and artifact.artifact_type = 'commit';
  select artifact.reference into commit_reference
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id
    and artifact.attempt_number = run_record.attempt_number
    and artifact.artifact_type = 'commit'
    and lower(artifact.reference) = run_record.head_sha
  order by artifact.created_at desc, artifact.id desc limit 1;
  select count(*)::integer, min(artifact.reference)
    into pull_artifact_count, pull_reference
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id
    and artifact.attempt_number = run_record.attempt_number
    and artifact.artifact_type = 'pull_request';
  select artifact.metadata into pull_metadata
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id
    and artifact.attempt_number = run_record.attempt_number
    and artifact.artifact_type = 'pull_request'
  order by artifact.created_at asc limit 1;
  select repository.* into repository_record
  from public.github_repositories repository
  where repository.id = run_record.github_repository_id
    and repository.organization_id = run_record.organization_id;
  select artifact.external_number into pull_number
  from public.phase1c_run_artifacts artifact
  where artifact.run_id = run_record.id
    and artifact.attempt_number = run_record.attempt_number
    and artifact.artifact_type = 'pull_request';
  if branch_count = 1 and commit_count >= 1
    and branch_reference ~ '^factory/[A-Za-z0-9._/-]{1,240}$'
    and commit_reference ~ '^[0-9a-fA-F]{40}$' then
    update public.agent_runs run set head_branch = branch_reference,
      head_sha = lower(commit_reference), updated_at = now()
      where run.id = run_record.id returning run.* into run_record;
    if pull_artifact_count = 1 then
      if repository_record.id is null or pull_number is null
        or pull_reference is distinct from
          'https://github.com/' || repository_record.full_name || '/pull/' || pull_number::text
        or coalesce(pull_metadata ->> 'commitSha', '') !~ '^[0-9a-fA-F]{40}$'
        or not exists (
          select 1 from public.phase1c_run_artifacts commit_artifact
          where commit_artifact.run_id = run_record.id
            and commit_artifact.attempt_number = run_record.attempt_number
            and commit_artifact.artifact_type = 'commit'
            and lower(commit_artifact.reference) = lower(pull_metadata ->> 'commitSha')
        ) then
        raise exception using errcode = '55000',
          message = 'pull request evidence conflicts with the authorized repository';
      end if;
      select task.title into task_title from public.tasks task
      where task.id = run_record.task_id and task.organization_id = run_record.organization_id;
      insert into public.pull_requests (
        organization_id, project_id, agent_run_id, repository, external_number,
        title, url, head_branch, base_branch, status, risk_level, opened_at
      ) values (
        run_record.organization_id, run_record.project_id, run_record.id,
        repository_record.full_name, pull_number, task_title, pull_reference,
        branch_reference, run_record.base_branch, 'draft'::public.pull_request_status,
        run_record.risk_level, now()
      ) on conflict (project_id, repository, external_number) do nothing;
      select pull.* into persisted_pull from public.pull_requests pull
      where pull.project_id = run_record.project_id
        and pull.repository = repository_record.full_name
        and pull.external_number = pull_number;
      if persisted_pull.agent_run_id is distinct from run_record.id
        or persisted_pull.organization_id is distinct from run_record.organization_id
        or persisted_pull.status <> 'draft'::public.pull_request_status
        or persisted_pull.url <> pull_reference
        or persisted_pull.head_branch <> branch_reference
        or persisted_pull.base_branch <> run_record.base_branch then
        raise exception using errcode = '55000', message = 'pull request evidence conflicts with durable run state';
      end if;
    end if;
  end if;

  -- A recovery claim may complete using immutable evidence from its immediately
  -- preceding attempt after the worker revalidates the exact draft PR head.
  -- Materialize explicit carry-forward records; never mutate/delete history.
  if p_outcome = 'succeeded'
    and not exists (select 1 from public.phase1c_run_artifacts artifact
      where artifact.run_id = run_record.id
        and artifact.attempt_number = run_record.attempt_number
        and artifact.artifact_type = 'pull_request')
    and exists (select 1 from public.pull_requests pull
      where pull.agent_run_id = run_record.id and pull.status = 'draft'::public.pull_request_status
        and pull.head_branch = run_record.head_branch)
  then
    if run_record.head_branch !~ '^factory/[A-Za-z0-9._/-]{1,240}$'
      or run_record.head_sha !~ '^[0-9a-f]{40}$' then
      raise exception using errcode = '55000', message = 'recovery head evidence is incomplete';
    end if;
    select max(artifact.attempt_number) into source_attempt
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id and artifact.artifact_type = 'pull_request';
    insert into public.phase1c_run_artifacts (
      organization_id, run_id, attempt_number, artifact_type,
      reference, external_number, metadata
    )
    select artifact.organization_id, artifact.run_id, run_record.attempt_number,
      artifact.artifact_type, artifact.reference, artifact.external_number,
      artifact.metadata || jsonb_build_object('recoveredFromAttempt', source_attempt)
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id and artifact.attempt_number = source_attempt
      and (
        (artifact.artifact_type = 'branch' and artifact.reference = run_record.head_branch)
        or (artifact.artifact_type = 'commit' and lower(artifact.reference) = run_record.head_sha)
        or (artifact.artifact_type = 'pull_request_head'
          and lower(artifact.reference) = run_record.head_sha)
        or (artifact.artifact_type = 'pull_request' and exists (
          select 1 from public.pull_requests pull where pull.agent_run_id = run_record.id
            and pull.url = artifact.reference and pull.external_number = artifact.external_number
            and pull.status = 'draft'::public.pull_request_status
        ))
      )
    on conflict on constraint phase1c_run_artifacts_unique do nothing;

  end if;

  -- The recovery worker may have re-recorded branch/PR evidence before this
  -- call. Validation carry-forward is therefore deliberately independent of
  -- whether this attempt already has a pull-request artifact.
  if p_outcome = 'succeeded'
    and not exists (select 1 from public.phase1c_run_validations validation
      where validation.run_id = run_record.id
        and validation.attempt_number = run_record.attempt_number) then
    select candidate.attempt_number, candidate.validation_round
    into source_attempt, source_round
    from (
      select validation.attempt_number, validation.validation_round
      from public.phase1c_run_validations validation
      where validation.run_id = run_record.id
        and validation.attempt_number < run_record.attempt_number
        and validation.validation_round > 0
      group by validation.attempt_number, validation.validation_round
      having bool_or(validation.name = 'diff-check' and validation.status = 'passed')
        and not bool_or(validation.status = 'failed')
      order by validation.attempt_number desc, validation.validation_round desc
      limit 1
    ) candidate;
    if source_attempt is null then
      raise exception using errcode = '55000', message = 'recovery validation evidence is incomplete';
    end if;
    insert into public.phase1c_run_validations (
      organization_id, run_id, attempt_number, validation_round,
      name, command, status, duration_ms, output_summary
    )
    select validation.organization_id, validation.run_id, run_record.attempt_number,
      validation.validation_round, validation.name, validation.command,
      validation.status, validation.duration_ms,
      left('Recovered immutable validation from attempt ' || source_attempt || '. ' ||
        validation.output_summary, 4000)
    from public.phase1c_run_validations validation
    where validation.run_id = run_record.id
      and validation.attempt_number = source_attempt
      and validation.validation_round = source_round
    on conflict on constraint phase1c_run_validations_unique do nothing;
  end if;

  if p_outcome = 'succeeded' then
    select count(*) filter (where artifact.artifact_type = 'branch')::integer,
      count(*) filter (where artifact.artifact_type = 'commit')::integer,
      count(*) filter (where artifact.artifact_type = 'pull_request')::integer,
      min(artifact.reference) filter (where artifact.artifact_type = 'branch'),
      min(artifact.reference) filter (where artifact.artifact_type = 'commit'
        and lower(artifact.reference) = run_record.head_sha),
      min(artifact.reference) filter (where artifact.artifact_type = 'pull_request')
    into branch_count, commit_count, pull_artifact_count,
      branch_reference, commit_reference, pull_reference
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id
      and artifact.attempt_number = run_record.attempt_number;
    select artifact.external_number into pull_number
    from public.phase1c_run_artifacts artifact
    where artifact.run_id = run_record.id
      and artifact.attempt_number = run_record.attempt_number
      and artifact.artifact_type = 'pull_request';
    if branch_count <> 1 or commit_count < 1 or pull_artifact_count <> 1
      or branch_reference is distinct from run_record.head_branch
      or lower(commit_reference) is distinct from run_record.head_sha
      or not exists (
        select 1 from public.phase1c_run_artifacts evidence
        where evidence.run_id = run_record.id
          and evidence.attempt_number = run_record.attempt_number
          and evidence.external_number = pull_number
          and (
            (evidence.artifact_type = 'pull_request'
              and evidence.reference = pull_reference
              and lower(evidence.metadata ->> 'commitSha') = run_record.head_sha)
            or (evidence.artifact_type = 'pull_request_head'
              and lower(evidence.reference) = run_record.head_sha
              and evidence.metadata ->> 'pullRequestUrl' = pull_reference)
          )
      )
      or not exists (
        select 1 from public.pull_requests pull
        where pull.agent_run_id = run_record.id
          and pull.organization_id = run_record.organization_id
          and pull.project_id = run_record.project_id
          and pull.status = 'draft'::public.pull_request_status
          and pull.head_branch = branch_reference
          and pull.base_branch = run_record.base_branch
          and pull.url = pull_reference
          and pull.external_number = pull_number
      ) then
      raise exception using errcode = '55000', message = 'successful run evidence is not unique and coherent';
    end if;
  end if;

  select * into result_record from public.complete_phase1c_run_internal(
    p_worker_id, p_run_id, p_lease_token, p_outcome, p_summary,
    p_provider_run_reference, p_usage, p_changed_files, p_checks,
    p_error_code, p_error_message, p_retryable
  );

  select pull.external_number into pull_number from public.pull_requests pull
  where pull.agent_run_id = run_record.id order by pull.created_at desc limit 1;
  structured_content := jsonb_build_object(
    'outcome', p_outcome,
    'runIds', jsonb_build_array(run_record.id),
    'pullRequestNumbers', case when pull_number is null then '[]'::jsonb
      else jsonb_build_array(pull_number) end,
    'pullRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'number', evidence.external_number, 'url', evidence.url,
      'status', evidence.status, 'headBranch', evidence.head_branch,
      'baseBranch', evidence.base_branch
    ) order by evidence.created_at desc) from (
      select pull.* from public.pull_requests pull
      where pull.agent_run_id = run_record.id order by pull.created_at desc limit 10
    ) evidence), '[]'::jsonb),
    'changedFiles', coalesce(p_changed_files, '[]'::jsonb),
    'checks', coalesce(p_checks, '[]'::jsonb),
    'validations', coalesce((select jsonb_agg(jsonb_build_object(
      'name', evidence.name, 'status', evidence.status,
      'durationMs', evidence.duration_ms, 'attempt', evidence.attempt_number,
      'round', evidence.validation_round
    ) order by evidence.attempt_number desc, evidence.validation_round desc, evidence.created_at asc)
      from (select validation.* from public.phase1c_run_validations validation
        where validation.run_id = run_record.id
        order by validation.attempt_number desc, validation.validation_round desc,
          validation.created_at asc limit 100) evidence), '[]'::jsonb),
    'sections', jsonb_build_array(
      jsonb_build_object('title', 'Outcome', 'body', coalesce(nullif(btrim(p_summary), ''),
        case p_outcome when 'succeeded' then 'Validated draft pull request created.'
          when 'cancelled' then 'Execution stopped at a safe cancellation boundary.'
          else 'Execution failed with bounded evidence.' end)),
      jsonb_build_object('title', 'Evidence', 'items', jsonb_build_array(
        'Run ' || run_record.id::text,
        'Validation records: ' || (select count(*)::text from public.phase1c_run_validations validation
          where validation.run_id = run_record.id),
        'Observed checks: ' || jsonb_array_length(coalesce(p_checks, '[]'::jsonb))::text
      ))
    ),
    'findings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', evidence.id,
        'title', 'Codex residual risk',
        'summary', left(evidence.details ->> 'text', 1000),
        'severity', 'medium',
        'status', 'open'
      ) order by evidence.created_at asc)
      from (select event.* from public.phase1c_run_events event
        where event.run_id = run_record.id
          and event.event_type = 'agent_event'
          and event.details ->> 'category' = 'security_finding'
          and char_length(coalesce(event.details ->> 'text', '')) between 1 and 1000
        order by event.created_at asc limit 50) evidence), '[]'::jsonb)
      || case when p_outcome = 'succeeded' then '[]'::jsonb else jsonb_build_array(
        jsonb_build_object('title', case when p_outcome = 'cancelled' then 'Run cancelled' else 'Run blocked' end,
          'summary', left(coalesce(nullif(btrim(p_error_message), ''),
            nullif(btrim(p_summary), ''), 'No additional diagnostic was retained.'), 1000),
          'severity', case when p_outcome = 'failed' then 'high' else 'medium' end,
          'status', 'open')
      ) end,
    'security', jsonb_build_object(
      'risk', run_record.risk_level,
      'errorCode', p_error_code,
      'blocker', case when p_outcome = 'succeeded' then null
        else left(coalesce(nullif(btrim(p_error_message), ''),
          nullif(btrim(p_summary), ''), 'No blocker detail was retained.'), 1000) end
    ),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', evidence.id,
      'title', case evidence.event_type when 'retry_requested'
        then 'Bounded retry requested' else 'Cancellation requested' end,
      'status', 'recorded',
      'ownerAction', left(evidence.details ->> 'reason', 500)
    ) order by evidence.created_at asc) from (
      select event.* from public.phase1c_run_events event
      where event.run_id = run_record.id
        and event.event_type in ('retry_requested', 'cancellation_requested')
      order by event.created_at asc limit 20
    ) evidence), '[]'::jsonb)
  );

  select report.id into report_id from public.reports report
  where report.organization_id = run_record.organization_id
    and report.content -> 'runIds' @> jsonb_build_array(run_record.id)
  order by report.created_at desc limit 1;
  if report_id is null then
    insert into public.reports (
      organization_id, project_id, generated_by_agent_id, type, status,
      title, summary, content, period_start, period_end, published_at
    ) values (
      run_record.organization_id, run_record.project_id, run_record.agent_id,
      'quality'::public.report_type, 'published'::public.report_status,
      'Phase 1C run ' || left(run_record.id::text, 8) || ' ' || p_outcome,
      coalesce(nullif(btrim(p_summary), ''), case p_outcome
        when 'cancelled' then 'Run cancelled with bounded evidence.'
        else 'Run failed with bounded evidence.' end),
      structured_content, run_record.started_at, now(), now()
    );
  else
    update public.reports report set content = structured_content,
      summary = coalesce(nullif(btrim(p_summary), ''), report.summary), updated_at = now()
    where report.id = report_id;
  end if;
  return query select result_record.run_id, result_record.status, result_record.completed_at;
end;
$function$;

-- Match the server classifier exactly. This wrapper is the authoritative risk
-- floor for authenticated callers that bypass the application route.
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
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  command_type_value text := coalesce(p_parameters ->> 'commandType', 'other');
  normalized_prompt text := lower(btrim(coalesce(p_prompt, '')));
  risk_floor public.risk_level;
  effective_risk public.risk_level;
  normalized_parameters jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if jsonb_typeof(coalesce(p_parameters, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_parameters, '{}'::jsonb)::text) > 65536
    or public.jsonb_has_sensitive_keys(coalesce(p_parameters, '{}'::jsonb))
    or (select array_agg(parameter_key order by parameter_key)
        from jsonb_object_keys(coalesce(p_parameters, '{}'::jsonb)) parameter_key)
      is distinct from array[
        'acceptanceCriteria','agentRole','budget','commandType','executionMode',
        'model','plan','provider','repositoryBinding','riskAssessment'
      ]::text[]
    or jsonb_typeof(coalesce(p_parameters -> 'acceptanceCriteria', '[]'::jsonb)) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(coalesce(p_parameters -> 'acceptanceCriteria', '[]'::jsonb)) criterion
      where jsonb_typeof(criterion) <> 'string'
        or char_length(btrim(criterion #>> '{}')) not between 3 and 500
        or public.text_has_likely_secret(criterion #>> '{}')
    ) then
    raise exception using errcode = '22023', message = 'invalid or unsupported Phase 1C command parameters';
  end if;
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and public.is_organization_owner(project.organization_id)
  ) then
    raise exception using errcode = '42501', message = 'only an organization owner may submit a command';
  end if;
  select normalized_prompt || ' ' || coalesce(string_agg(lower(criterion #>> '{}'), ' '), '')
    into normalized_prompt
  from jsonb_array_elements(p_parameters -> 'acceptanceCriteria') criterion;
  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(\mauth\M|authentication|authorization|oauth|session|cookie|rbac|permission|secret|credential|password|private[ _-]?key|api[ _-]?key|token|rls|row[ -]?level security|service[ _-]?role|production database|delete production|drop table|truncate|dns|domain ownership|billing|payment|money|auto[ -]?(merge|deploy|rollback|approve)|branch protection)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug', 'build_feature', 'mobile', 'performance', 'other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package(\.json)?|lockfile|upgrade|api|backend|frontend|component|route|workflow|configuration|refactor|feature|bug|performance|mobile|accessibility)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level
  end;
  effective_risk := greatest(coalesce(p_requested_risk, 'green'::public.risk_level), risk_floor);
  normalized_parameters := jsonb_set(
    coalesce(p_parameters, '{}'::jsonb), '{riskAssessment}',
    coalesce(p_parameters -> 'riskAssessment', '{}'::jsonb) || jsonb_build_object(
      'effectiveRisk', effective_risk::text, 'classificationSource', 'database_policy'
    ), true
  );
  normalized_parameters := jsonb_set(normalized_parameters, '{agentRole}', to_jsonb(
    case command_type_value
      when 'audit' then 'qa' when 'test' then 'qa' when 'mobile' then 'frontend'
      when 'security' then 'security' when 'performance' then 'performance'
      when 'build_feature' then 'architect' when 'fix_bug' then 'backend'
      else 'orchestrator' end
  ), true);
  return query select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created
  from public.submit_command_phase1a_internal(
    p_project_id, p_prompt, effective_risk, normalized_parameters, p_idempotency_key
  ) submission;
end;
$function$;

-- A recovered worker may lease only the remaining slice of the original
-- durable run deadline. Heartbeats cannot extend a lease beyond that ceiling.
create or replace function public.heartbeat_phase1c_run(
  p_worker_id text, p_run_id uuid, p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns table (lease_expires_at timestamptz, cancellation_requested boolean)
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  run_record public.agent_runs%rowtype;
  deadline_at timestamptz;
begin
  select run.* into run_record
  from public.agent_runs run
  join public.commands command on command.id = run.command_id
    and command.organization_id = run.organization_id
  where run.id = p_run_id and run.status = 'running'::public.run_status
    and run.lease_worker_id = p_worker_id and run.lease_token = p_lease_token
    and run.lease_expires_at > now() and run.started_at is not null
    and command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
    and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer between 60000 and 3600000
  for update of run;
  if not found then
    raise exception using errcode = '42501', message = 'run deadline is missing or expired';
  end if;
  select run_record.started_at + make_interval(secs =>
    (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0)
    into deadline_at
  from public.commands command
  where command.id = run_record.command_id
    and command.organization_id = run_record.organization_id;
  if deadline_at is null or deadline_at <= now() then
    raise exception using errcode = '42501', message = 'run deadline is missing or expired';
  end if;
  update public.agent_runs run set
    lease_expires_at = least(deadline_at,
      now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300)))),
    updated_at = now()
  where run.id = run_record.id returning run.* into run_record;
  update public.phase1c_workers worker set current_run_id = p_run_id,
    last_heartbeat_at = now(), updated_at = now()
  where worker.worker_id = p_worker_id and worker.status in ('active','draining');
  if not found then raise exception using errcode = '42501', message = 'worker is not active'; end if;
  return query select run_record.lease_expires_at, run_record.cancellation_requested_at is not null;
end;
$function$;

drop function public.claim_phase1c_run(text, text, text, integer);
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
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  claimed_run_id uuid;
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

  select run.id into claimed_run_id
  from public.agent_runs run
  join public.tasks task on task.id = run.task_id and task.organization_id = run.organization_id
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.agents assigned_agent on assigned_agent.id = run.agent_id
    and assigned_agent.organization_id = run.organization_id
  join public.projects project on project.id = run.project_id and project.organization_id = run.organization_id
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
  order by case when run.status = 'queued'::public.run_status then 0 else 1 end,
    task.priority desc, run.created_at asc
  limit 1 for update of run, assigned_agent skip locked;
  if claimed_run_id is null then return; end if;

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

create or replace function public.list_agents(
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
    assignment.provider::text, assignment.model, agent.last_run_at,
    case when octet_length(agent.capabilities::text) <= 8192
      then agent.capabilities else '[]'::jsonb end,
    left(agent.current_assignment, 240),
    case when assignment.provider is null then null
      when exists (
        select 1 from public.provider_model_configurations configuration
        where configuration.organization_id = agent.organization_id
          and configuration.provider = assignment.provider
          and configuration.enabled
          and (assignment.model is null or configuration.model = assignment.model)
      ) then 'configured' else 'not_configured' end,
    project.id, project.name
  from public.agents agent
  left join public.provider_agent_assignments assignment
    on assignment.agent_id = agent.id
    and assignment.organization_id = agent.organization_id
  left join public.projects project
    on project.id = agent.project_id and project.organization_id = agent.organization_id
  where agent.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by agent.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

-- Bounded provider read projections. The browser never regains SELECT on the
-- sensitive agents/agent_runs base tables.
create or replace function public.get_provider_agent_assignment(
  p_organization_id uuid, p_agent_id uuid
)
returns table (id uuid, role public.agent_role, provider text, model text)
language sql stable security definer set search_path = pg_catalog as $function$
  select agent.id, agent.role, assignment.provider::text, assignment.model
  from public.agents agent
  left join public.provider_agent_assignments assignment
    on assignment.agent_id = agent.id
    and assignment.organization_id = agent.organization_id
  where agent.id = p_agent_id
    and agent.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

create or replace function public.list_provider_run_metrics(
  p_organization_id uuid, p_limit integer default 50
)
returns table (provider text, status public.run_status, latency_ms integer)
language sql stable security definer set search_path = pg_catalog as $function$
  select run.provider, run.status, run.latency_ms
  from public.agent_runs run
  where run.organization_id = p_organization_id
    and run.provider in ('anthropic', 'openai')
    and public.is_organization_member(p_organization_id)
  order by run.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$function$;

-- Advisory provider rows share agent_runs with Phase 1C. Populate the common
-- risk/role dimensions from immutable tenant-bound routing evidence without
-- treating a provider preference as the logical agent's identity.
create or replace function public.normalize_provider_agent_run_dimensions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare routing_record public.provider_routing_decisions%rowtype;
declare agent_role_value public.agent_role;
begin
  if new.command_id is not null or new.routing_decision_id is null then
    return new;
  end if;
  select routing.* into routing_record
  from public.provider_routing_decisions routing
  where routing.id = new.routing_decision_id
    and routing.organization_id = new.organization_id;
  if not found or routing_record.project_id <> new.project_id
    or routing_record.task_id is distinct from new.task_id
    or routing_record.agent_id is distinct from new.agent_id then
    raise exception using errcode = '23503',
      message = 'provider run routing evidence does not match the run';
  end if;
  select agent.role into agent_role_value
  from public.agents agent
  where agent.id = new.agent_id and agent.organization_id = new.organization_id;
  new.risk_level := routing_record.risk_level;
  new.logical_agent_role := agent_role_value;
  return new;
end;
$function$;

create trigger agent_runs_normalize_provider_dimensions
  before insert on public.agent_runs
  for each row execute function public.normalize_provider_agent_run_dimensions();

create or replace function public.finish_phase1c_worker(
  p_worker_id text, p_status text default 'idle'
)
returns table (worker_id text, status text, last_heartbeat_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $function$
declare worker_record public.phase1c_workers%rowtype;
begin
  if p_status not in ('idle', 'disabled', 'error') then
    raise exception using errcode = '22023', message = 'invalid terminal worker status';
  end if;
  update public.phase1c_workers worker set
    status = p_status, current_run_id = null,
    last_heartbeat_at = now(), updated_at = now()
  where worker.worker_id = p_worker_id
  returning worker.* into worker_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'worker is not registered';
  end if;
  return query select worker_record.worker_id, worker_record.status,
    worker_record.last_heartbeat_at;
end;
$function$;

create or replace function public.get_phase1c_worker_status(p_organization_id uuid)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select case when public.is_organization_member(p_organization_id) then
    jsonb_build_object(
      'connectionStatus', case when count(*) filter (
        where ((worker.status = 'active'
            and worker.last_heartbeat_at > now() - interval '5 minutes')
          or (worker.status = 'idle'
            and worker.last_heartbeat_at > now() - interval '10 minutes'))
          and worker.last_heartbeat_at <= now() + interval '1 minute'
      ) > 0 then 'connected' else 'not_connected' end,
      'statusLabel', case when count(*) filter (
        where ((worker.status = 'active'
            and worker.last_heartbeat_at > now() - interval '5 minutes')
          or (worker.status = 'idle'
            and worker.last_heartbeat_at > now() - interval '10 minutes'))
          and worker.last_heartbeat_at <= now() + interval '1 minute'
      ) > 0 then 'Connected' else 'Not Connected' end,
      'lastHeartbeatAt', max(worker.last_heartbeat_at) filter (
        where worker.status in ('active', 'idle')),
      'activeWorkers', count(*) filter (
        where worker.status = 'active'
          and worker.last_heartbeat_at > now() - interval '5 minutes'
          and worker.last_heartbeat_at <= now() + interval '1 minute'),
      'availableWorkers', count(*) filter (
        where ((worker.status = 'active'
            and worker.last_heartbeat_at > now() - interval '5 minutes')
          or (worker.status = 'idle'
            and worker.last_heartbeat_at > now() - interval '10 minutes'))
          and worker.last_heartbeat_at <= now() + interval '1 minute'),
      'staleAfterSeconds', 600
    )
  else null end
  from public.phase1c_workers worker;
$function$;

alter function public.get_agent_detail(uuid, uuid) rename to get_agent_detail_phase1c_internal;
create function public.get_agent_detail(p_organization_id uuid, p_agent_id uuid)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select jsonb_set(
    jsonb_set(
      jsonb_set(source.detail, '{provider}',
        coalesce(to_jsonb(assignment.provider::text), 'null'::jsonb), true),
      '{model}', coalesce(to_jsonb(assignment.model), 'null'::jsonb), true),
    '{providerConnectionStatus}',
    case when assignment.provider is null then 'null'::jsonb
      when exists (
        select 1 from public.provider_model_configurations configuration
        where configuration.organization_id = p_organization_id
          and configuration.provider = assignment.provider
          and configuration.enabled
          and (assignment.model is null or configuration.model = assignment.model)
      ) then '"configured"'::jsonb else '"not_configured"'::jsonb end,
    true
  )
  from public.get_agent_detail_phase1c_internal(p_organization_id, p_agent_id) source
  left join public.provider_agent_assignments assignment
    on assignment.agent_id = p_agent_id
    and assignment.organization_id = p_organization_id;
$function$;

alter function public.get_report_detail(uuid, uuid) rename to get_report_detail_phase1c_internal;
create function public.get_report_detail(p_organization_id uuid, p_report_id uuid)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select (source.detail - 'pullRequests') || jsonb_build_object(
    'pullRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'number', pull.external_number, 'title', pull.title, 'url', pull.url,
      'status', pull.status, 'draft', pull.status = 'draft'::public.pull_request_status
    ) order by pull.created_at desc) from (
      select source_pull.* from public.pull_requests source_pull
      where source_pull.organization_id = report.organization_id
        and source_pull.project_id is not distinct from report.project_id
        and source_pull.agent_run_id in (select value::uuid
          from jsonb_array_elements_text(case
            when jsonb_typeof(report.content -> 'runIds') = 'array'
              then report.content -> 'runIds' else '[]'::jsonb end) limit 100)
      order by source_pull.created_at desc limit 100
    ) pull), '[]'::jsonb),
    'changedFiles', case when jsonb_typeof(report.content -> 'changedFiles') = 'array'
      then coalesce((select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(report.content -> 'changedFiles')
          with ordinality item(value, ordinality)
        where item.ordinality <= 100 and octet_length(item.value::text) <= 2048), '[]'::jsonb)
      else '[]'::jsonb end,
    'checks', case when jsonb_typeof(report.content -> 'checks') = 'array'
      then coalesce((select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(report.content -> 'checks')
          with ordinality item(value, ordinality)
        where item.ordinality <= 100 and octet_length(item.value::text) <= 8192), '[]'::jsonb)
      else '[]'::jsonb end,
    'validations', case when jsonb_typeof(report.content -> 'validations') = 'array'
      then coalesce((select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(report.content -> 'validations')
          with ordinality item(value, ordinality)
        where item.ordinality <= 100 and octet_length(item.value::text) <= 8192), '[]'::jsonb)
      else '[]'::jsonb end,
    'security', case when jsonb_typeof(report.content -> 'security') = 'object'
        and octet_length((report.content -> 'security')::text) <= 8192
      then report.content -> 'security' else 'null'::jsonb end
  )
  from public.get_report_detail_phase1c_internal(p_organization_id, p_report_id) source
  join public.reports report on report.id = p_report_id
    and report.organization_id = p_organization_id
  where public.is_organization_member(p_organization_id);
$function$;

revoke all on function public.initialize_standard_logical_agent_roster(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.initialize_standard_logical_agent_roster_after_organization()
  from public, anon, authenticated, service_role;
revoke all on function public.plan_phase1c_task_and_run()
  from public, anon, authenticated, service_role;
revoke all on function public.normalize_phase1c_command()
  from public, anon, authenticated, service_role;
revoke all on function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_phase1c_run_artifact(text, uuid, uuid, text, text, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.request_phase1c_run_cancellation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_phase1c_run(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run(text, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run_internal(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.list_agents(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_agent_detail_phase1c_internal(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_agent_detail(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_report_detail_phase1c_internal(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_report_detail(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_default_agents(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.normalize_provider_agent_run_dimensions()
  from public, anon, authenticated, service_role;
revoke all on function public.get_provider_agent_assignment(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_provider_run_metrics(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  to authenticated;
grant execute on function public.ensure_default_agents(uuid) to authenticated;
grant execute on function public.request_phase1c_run_cancellation(uuid, uuid, text) to authenticated;
grant execute on function public.retry_phase1c_run(uuid, uuid, text) to authenticated;
grant execute on function public.record_phase1c_run_artifact(text, uuid, uuid, text, text, integer, jsonb)
  to service_role;
grant execute on function public.claim_phase1c_run(text, text, text, integer) to service_role;
grant execute on function public.complete_phase1c_run(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean)
  to service_role;
grant execute on function public.list_agents(uuid, integer) to authenticated;
grant execute on function public.get_agent_detail(uuid, uuid) to authenticated;
grant execute on function public.get_report_detail(uuid, uuid) to authenticated;
grant execute on function public.get_provider_agent_assignment(uuid, uuid) to authenticated;
grant execute on function public.list_provider_run_metrics(uuid, integer) to authenticated;

-- Reconcile ACLs after every pending Phase 1E, provider, bot-fabric, marketing,
-- and Phase 1C table exists. Hosted Supabase may apply permissive service_role
-- default privileges to tables created after migration 026, so the final
-- chronological migration must close them again.
revoke all on table public.deployment_validations
  from public, anon, service_role;
revoke all on table public.monitor_observations
  from public, anon, service_role;
revoke all on table public.operations_audit_events
  from public, anon, service_role;
revoke all on table public.operations_events
  from public, anon, service_role;
revoke all on table public.production_diagnoses
  from public, anon, service_role;
revoke all on table public.production_monitors
  from public, anon, service_role;
revoke all on table public.project_health_snapshots
  from public, anon, service_role;
revoke all on table public.release_freezes
  from public, anon, service_role;
revoke all on table public.repair_attempts
  from public, anon, service_role;
revoke all on table public.rollback_operations
  from public, anon, service_role;
revoke all on table public.synthetic_journeys
  from public, anon, service_role;
revoke all on table public.bot_assignments from service_role;
revoke all on table public.bot_roles from service_role;
revoke all on table public.bots from service_role;
revoke all on table public.marketing_features from service_role;
revoke all on table public.marketing_logos from service_role;
revoke all on table public.marketing_pages from service_role;
revoke all on table public.marketing_plan_features from service_role;
revoke all on table public.marketing_pricing_plans from service_role;
revoke all on table public.marketing_resource_topics from service_role;
revoke all on table public.marketing_resources from service_role;
revoke all on table public.marketing_stats from service_role;
revoke all on table public.marketing_team_members from service_role;
revoke all on table public.marketing_testimonials from service_role;
revoke all on table public.newsletter_subscribers from service_role;
revoke all on table public.provider_model_configurations
  from public, anon, authenticated, service_role;
revoke all on table public.provider_agent_assignments
  from public, anon, authenticated, service_role;
revoke all on table public.provider_routing_decisions
  from public, anon, authenticated, service_role;
revoke all on table public.provider_run_events
  from public, anon, authenticated, service_role;
grant select on table public.provider_model_configurations to authenticated;
grant select on table public.provider_routing_decisions to authenticated;
grant select on table public.provider_run_events to authenticated;

comment on function public.initialize_standard_logical_agent_roster(uuid, uuid) is
  'Internal idempotent initializer for the provider-neutral eleven-role logical roster.';
