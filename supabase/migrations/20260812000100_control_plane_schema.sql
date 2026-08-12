-- SoftwareFactory Phase 1A control-plane schema.
-- Secrets belong in a server-side secret manager. This schema stores only opaque
-- secret references and rejects credential-shaped JSON keys and common token forms.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.organization_member_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.project_status as enum ('draft', 'active', 'paused', 'archived');
create type public.health_status as enum ('unknown', 'healthy', 'degraded', 'unhealthy');
create type public.connection_provider as enum ('github', 'openai', 'anthropic', 'vercel', 'supabase', 'other');
create type public.connection_status as enum ('not_connected', 'pending', 'connected', 'error', 'disabled');
create type public.risk_level as enum ('green', 'yellow', 'red');
create type public.agent_role as enum (
  'orchestrator', 'product', 'frontend', 'backend', 'database',
  'qa', 'security', 'release', 'ceo_reporter', 'custom'
);
create type public.agent_status as enum ('inactive', 'idle', 'busy', 'paused', 'error');
create type public.command_status as enum (
  'submitted', 'awaiting_approval', 'queued', 'running', 'succeeded', 'failed', 'cancelled'
);
create type public.task_status as enum (
  'backlog', 'awaiting_approval', 'queued', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'
);
create type public.run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.pull_request_status as enum ('draft', 'open', 'approved', 'merged', 'closed');
create type public.deployment_status as enum (
  'pending', 'in_progress', 'succeeded', 'failed', 'rolling_back', 'rolled_back', 'cancelled'
);
create type public.test_run_status as enum ('queued', 'running', 'passed', 'failed', 'cancelled');
create type public.test_run_kind as enum ('unit', 'integration', 'e2e', 'security', 'performance', 'smoke', 'other');
create type public.incident_status as enum ('open', 'investigating', 'mitigated', 'resolved', 'closed');
create type public.incident_severity as enum ('low', 'medium', 'high', 'critical');
create type public.report_type as enum ('daily_ceo', 'security', 'quality', 'release', 'incident', 'custom');
create type public.report_status as enum ('draft', 'published', 'archived');
create type public.policy_status as enum ('draft', 'active', 'superseded', 'archived');
create type public.approval_kind as enum (
  'red_task_execution', 'production_deployment', 'production_rollback',
  'auto_merge', 'secret_access', 'other'
);
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'expired', 'cancelled');
create type public.activity_event_type as enum (
  'organization.created',
  'project.created',
  'project.updated',
  'project.autonomous_mode_changed',
  'project.risk_authorization_changed',
  'project.automation_controls_changed',
  'connection.changed',
  'command.submitted',
  'task.created',
  'agent.started',
  'pull_request.created',
  'deployment.started',
  'deployment.rollback_initiated',
  'approval.requested',
  'approval.decided'
);

create or replace function public.text_has_likely_secret(input_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(
    input_text ~ '(?i)(-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|vercel_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})',
    false
  );
$function$;

create or replace function public.jsonb_has_sensitive_keys_internal(
  input_value jsonb,
  current_depth integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  entry record;
  item jsonb;
  normalized_key text;
begin
  if input_value is null then
    return false;
  end if;

  -- Reject rather than recurse indefinitely. Normal control-plane payloads are
  -- shallow; extreme nesting is both unnecessary and a potential stack attack.
  if current_depth >= 32 and jsonb_typeof(input_value) in ('object', 'array') then
    return true;
  end if;

  case jsonb_typeof(input_value)
    when 'object' then
      for entry in select key, value from pg_catalog.jsonb_each(input_value)
      loop
        normalized_key := pg_catalog.regexp_replace(pg_catalog.lower(entry.key), '[^a-z0-9]', '', 'g');

        if normalized_key = any (array[
          'password', 'passwd', 'apikey', 'privatekey', 'clientsecret',
          'accesstoken', 'refreshtoken', 'servicerolekey', 'authorization',
          'bearer', 'credential', 'credentials', 'signingsecret', 'webhooksecret'
        ])
        or normalized_key like '%password'
        or normalized_key like '%apikey'
        or normalized_key like '%privatekey'
        or normalized_key like '%credential'
        or normalized_key like '%secret'
        or normalized_key like '%token' then
          return true;
        end if;

        if public.jsonb_has_sensitive_keys_internal(entry.value, current_depth + 1) then
          return true;
        end if;
      end loop;
    when 'array' then
      for item in select value from pg_catalog.jsonb_array_elements(input_value)
      loop
        if public.jsonb_has_sensitive_keys_internal(item, current_depth + 1) then
          return true;
        end if;
      end loop;
    when 'string' then
      return public.text_has_likely_secret(input_value #>> '{}');
    else
      return false;
  end case;

  return false;
end;
$function$;

create or replace function public.jsonb_has_sensitive_keys(input_value jsonb)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog
as $function$
  select public.jsonb_has_sensitive_keys_internal(input_value, 0);
$function$;

comment on function public.jsonb_has_sensitive_keys(jsonb) is
  'Rejects credential-shaped keys recursively and common plaintext token patterns. Secret references must use the dedicated connections.secret_reference column.';

create or replace function public.reject_sensitive_row_data()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if public.jsonb_has_sensitive_keys(to_jsonb(new)) then
    raise exception using
      errcode = '23514',
      message = 'plaintext credentials and sensitive keys are not permitted in control-plane tables';
  end if;
  return new;
end;
$function$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 63),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_unique unique (slug)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_member_role not null default 'member',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_org_user_unique unique (organization_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text,
  status public.project_status not null default 'draft',
  github_repository text check (
    github_repository is null
    or github_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ),
  default_branch text not null default 'main' check (char_length(btrim(default_branch)) between 1 and 255),
  production_url text check (production_url is null or production_url ~ '^https://'),
  autonomous_mode boolean not null default false,
  maximum_autonomous_risk public.risk_level not null default 'green',
  auto_approve boolean not null default false,
  auto_merge boolean not null default false,
  auto_deploy boolean not null default false,
  auto_rollback boolean not null default false,
  health_status public.health_status not null default 'unknown',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_id_organization_unique unique (id, organization_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  provider public.connection_provider not null,
  status public.connection_status not null default 'not_connected',
  external_account_label text check (
    external_account_label is null or char_length(btrim(external_account_label)) between 1 and 160
  ),
  secret_reference text check (
    secret_reference is null
    or (
      char_length(secret_reference) between 7 and 255
      and secret_reference ~ '^(env|vault|secret-manager|supabase-vault)://[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    )
  ),
  settings jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  error_message text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_id_organization_unique unique (id, organization_id),
  constraint connections_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint connections_settings_no_sensitive_data check (not public.jsonb_has_sensitive_keys(settings)),
  constraint connected_connections_reference_secret check (status <> 'connected' or secret_reference is not null)
);

create table public.project_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  connection_id uuid not null,
  is_primary boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_connections_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint project_connections_connection_fk foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete cascade,
  constraint project_connections_project_connection_unique unique (project_id, connection_id)
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role public.agent_role not null,
  description text,
  status public.agent_status not null default 'inactive',
  provider text check (provider is null or char_length(btrim(provider)) between 1 and 80),
  model text check (model is null or char_length(btrim(model)) between 1 and 120),
  current_assignment text,
  last_run_at timestamptz,
  capabilities jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_id_organization_unique unique (id, organization_id),
  constraint agents_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint agents_capabilities_array check (jsonb_typeof(capabilities) = 'array'),
  constraint agents_capabilities_no_sensitive_data check (not public.jsonb_has_sensitive_keys(capabilities))
);

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 4000),
  requested_risk public.risk_level not null default 'green',
  status public.command_status not null default 'submitted',
  parameters jsonb not null default '{}'::jsonb,
  idempotency_key text check (
    idempotency_key is null
    or (char_length(idempotency_key) between 8 and 128 and idempotency_key ~ '^[A-Za-z0-9._:-]+$')
  ),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commands_id_organization_unique unique (id, organization_id),
  constraint commands_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint commands_parameters_object check (jsonb_typeof(parameters) = 'object'),
  constraint commands_parameters_no_sensitive_data check (not public.jsonb_has_sensitive_keys(parameters)),
  constraint commands_prompt_no_likely_secret check (not public.text_has_likely_secret(prompt)),
  constraint commands_completed_at_consistent check (
    completed_at is null or status in ('succeeded', 'failed', 'cancelled')
  )
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  command_id uuid,
  assigned_agent_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  status public.task_status not null default 'backlog',
  risk_level public.risk_level not null default 'green',
  requires_owner_approval boolean generated always as (risk_level = 'red'::public.risk_level) stored,
  priority smallint not null default 50 check (priority between 0 and 100),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_id_organization_unique unique (id, organization_id),
  constraint tasks_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint tasks_command_fk foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete cascade,
  constraint tasks_agent_fk foreign key (assigned_agent_id, organization_id)
    references public.agents(id, organization_id) on delete restrict,
  constraint tasks_input_object check (jsonb_typeof(input) = 'object'),
  constraint tasks_input_no_sensitive_data check (not public.jsonb_has_sensitive_keys(input)),
  constraint tasks_result_no_sensitive_data check (result is null or not public.jsonb_has_sensitive_keys(result)),
  constraint tasks_started_at_consistent check (started_at is null or status in ('in_progress', 'blocked', 'completed', 'failed', 'cancelled')),
  constraint tasks_completed_at_consistent check (completed_at is null or status in ('completed', 'failed', 'cancelled'))
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  task_id uuid not null,
  agent_id uuid not null,
  status public.run_status not null default 'queued',
  provider_run_reference text,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_runs_id_organization_unique unique (id, organization_id),
  constraint agent_runs_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint agent_runs_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade,
  constraint agent_runs_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete restrict,
  constraint agent_runs_input_no_sensitive_data check (not public.jsonb_has_sensitive_keys(input)),
  constraint agent_runs_output_no_sensitive_data check (output is null or not public.jsonb_has_sensitive_keys(output))
);

create table public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  agent_run_id uuid,
  repository text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  external_number integer not null check (external_number > 0),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  url text not null check (url ~ '^https://'),
  head_branch text not null,
  base_branch text not null,
  status public.pull_request_status not null default 'draft',
  risk_level public.risk_level not null default 'green',
  opened_at timestamptz,
  merged_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pull_requests_id_organization_unique unique (id, organization_id),
  constraint pull_requests_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint pull_requests_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint pull_requests_external_unique unique (project_id, repository, external_number)
);

create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  agent_run_id uuid,
  rollback_of_deployment_id uuid,
  environment text not null check (char_length(btrim(environment)) between 1 and 80),
  provider text,
  external_reference text,
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-fA-F]{7,64}$'),
  url text check (url is null or url ~ '^https://'),
  status public.deployment_status not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deployments_id_organization_unique unique (id, organization_id),
  constraint deployments_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint deployments_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint deployments_rollback_fk foreign key (rollback_of_deployment_id, organization_id)
    references public.deployments(id, organization_id) on delete restrict
);

create table public.test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  agent_run_id uuid,
  kind public.test_run_kind not null,
  status public.test_run_status not null default 'queued',
  total_count integer not null default 0 check (total_count >= 0),
  passed_count integer not null default 0 check (passed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  summary text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_runs_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint test_runs_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint test_runs_counts_consistent check (passed_count + failed_count + skipped_count <= total_count),
  constraint test_runs_details_no_sensitive_data check (not public.jsonb_has_sensitive_keys(details))
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  deployment_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  severity public.incident_severity not null,
  status public.incident_status not null default 'open',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint incidents_deployment_fk foreign key (deployment_id, organization_id)
    references public.deployments(id, organization_id) on delete restrict
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  generated_by_agent_id uuid,
  type public.report_type not null,
  status public.report_status not null default 'draft',
  title text not null check (char_length(btrim(title)) between 1 and 240),
  summary text,
  content jsonb not null default '{}'::jsonb,
  period_start timestamptz,
  period_end timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint reports_agent_fk foreign key (generated_by_agent_id, organization_id)
    references public.agents(id, organization_id) on delete restrict,
  constraint reports_content_object check (jsonb_typeof(content) = 'object'),
  constraint reports_content_no_sensitive_data check (not public.jsonb_has_sensitive_keys(content)),
  constraint reports_period_consistent check (period_end is null or period_start is null or period_end >= period_start)
);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  key text not null check (key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$' and char_length(key) <= 120),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text,
  body_markdown text not null default '',
  status public.policy_status not null default 'draft',
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policies_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint policies_body_no_likely_secret check (not public.text_has_likely_secret(body_markdown))
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  task_id uuid,
  command_id uuid,
  kind public.approval_kind not null,
  status public.approval_status not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete restrict,
  decided_by uuid references auth.users(id) on delete restrict,
  request_reason text not null check (char_length(btrim(request_reason)) between 1 and 1000),
  decision_notes text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approvals_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint approvals_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade,
  constraint approvals_command_fk foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete cascade,
  constraint approvals_entity_present check (task_id is not null or command_id is not null),
  constraint approvals_red_task_has_task check (kind <> 'red_task_execution' or task_id is not null),
  constraint approvals_decision_consistent check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  ),
  constraint approvals_expiry_consistent check (expires_at is null or expires_at > requested_at)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type public.activity_event_type not null,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  entity_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint activity_events_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint activity_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint activity_events_metadata_no_sensitive_data check (not public.jsonb_has_sensitive_keys(metadata))
);

create unique index commands_idempotency_unique
  on public.commands (submitted_by, project_id, idempotency_key)
  where idempotency_key is not null;
create unique index policies_scope_key_version_unique
  on public.policies (organization_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key, version);
create unique index approvals_one_pending_kind_per_task
  on public.approvals (task_id, kind)
  where task_id is not null and status = 'pending';

create index organization_members_user_idx on public.organization_members (user_id, organization_id);
create index organization_members_org_role_idx on public.organization_members (organization_id, role);
create index projects_org_status_idx on public.projects (organization_id, status, updated_at desc);
create index projects_github_repository_idx on public.projects (github_repository) where github_repository is not null;
create index connections_org_provider_idx on public.connections (organization_id, provider, status);
create index project_connections_connection_idx on public.project_connections (connection_id, project_id);
create index agents_project_status_idx on public.agents (project_id, status);
create index agents_org_role_idx on public.agents (organization_id, role);
create index commands_project_created_idx on public.commands (project_id, created_at desc);
create index commands_submitter_status_idx on public.commands (submitted_by, status, created_at desc);
create index tasks_project_status_idx on public.tasks (project_id, status, priority desc, created_at);
create index tasks_command_idx on public.tasks (command_id, created_at) where command_id is not null;
create index tasks_agent_status_idx on public.tasks (assigned_agent_id, status) where assigned_agent_id is not null;
create index agent_runs_task_created_idx on public.agent_runs (task_id, created_at desc);
create index agent_runs_project_status_idx on public.agent_runs (project_id, status, created_at desc);
create index pull_requests_project_status_idx on public.pull_requests (project_id, status, created_at desc);
create index deployments_project_status_idx on public.deployments (project_id, status, created_at desc);
create index test_runs_project_status_idx on public.test_runs (project_id, status, created_at desc);
create index incidents_project_status_idx on public.incidents (project_id, status, severity, detected_at desc);
create index reports_org_type_created_idx on public.reports (organization_id, type, created_at desc);
create index reports_project_created_idx on public.reports (project_id, created_at desc) where project_id is not null;
create index policies_org_status_idx on public.policies (organization_id, status, updated_at desc);
create index approvals_org_status_idx on public.approvals (organization_id, status, requested_at desc);
create index approvals_task_idx on public.approvals (task_id, status) where task_id is not null;
create index activity_events_org_time_idx on public.activity_events (organization_id, occurred_at desc);
create index activity_events_project_time_idx on public.activity_events (project_id, occurred_at desc) where project_id is not null;
create index activity_events_entity_idx on public.activity_events (entity_type, entity_id, occurred_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.prevent_organization_reassignment()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception using errcode = '23514', message = 'organization_id is immutable';
  end if;
  return new;
end;
$function$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists software_factory_on_auth_user_created on auth.users;
create trigger software_factory_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create or replace function public.bootstrap_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into public.organization_members (organization_id, user_id, role, created_by)
  values (new.id, new.created_by, 'owner'::public.organization_member_role, new.created_by)
  on conflict (organization_id, user_id) do update set role = 'owner'::public.organization_member_role;
  return new;
end;
$function$;

create trigger bootstrap_organization_owner_after_insert
  after insert on public.organizations
  for each row execute function public.bootstrap_organization_owner();

do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'organization_members', 'projects', 'connections',
    'project_connections', 'agents', 'commands', 'tasks', 'agent_runs',
    'pull_requests', 'deployments', 'test_runs', 'incidents', 'reports',
    'policies', 'approvals', 'activity_events'
  ]
  loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.reject_sensitive_row_data()',
      table_name || '_reject_sensitive_data', table_name
    );
  end loop;

  foreach table_name in array array[
    'profiles', 'organizations', 'organization_members', 'projects', 'connections',
    'project_connections', 'agents', 'commands', 'tasks', 'agent_runs',
    'pull_requests', 'deployments', 'test_runs', 'incidents', 'reports',
    'policies', 'approvals'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;

  foreach table_name in array array[
    'organization_members', 'projects', 'connections', 'project_connections',
    'agents', 'commands', 'tasks', 'agent_runs', 'pull_requests', 'deployments',
    'test_runs', 'incidents', 'reports', 'policies', 'approvals', 'activity_events'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_organization_reassignment()',
      table_name || '_prevent_org_change', table_name
    );
  end loop;
end;
$triggers$;

comment on table public.connections is
  'Provider-neutral connection metadata. secret_reference is an opaque locator; credentials must never be stored in this table.';
comment on column public.connections.secret_reference is
  'Opaque env://, vault://, secret-manager://, or supabase-vault:// locator. Never a credential value.';
comment on column public.projects.autonomous_mode is
  'Control-plane authorization flag only. Phase 1A contains no autonomous worker.';
comment on column public.tasks.requires_owner_approval is
  'Generated safety marker. RED execution is additionally enforced by database triggers in the workflow migration.';
