-- Phase 1C execution schema.
--
-- Adds the durable structures the execution loop needs: append-only run events,
-- isolated run workspaces, normalized structured results, backlog fields, agent
-- enablement/metrics, project portfolio metadata, and organization settings.
--
-- This migration introduces no executor authority. Autonomous Mode remains
-- constrained OFF by migration 010, the organization kill switch remains locked
-- ON, and no automatic approval, merge, deployment, or rollback path is created.
-- Every new table receives RLS and FORCE RLS; writes go through the audited
-- SECURITY DEFINER workflows added in the following migration.

create type public.run_event_type as enum (
  'command.submitted',
  'plan.started',
  'plan.completed',
  'task.created',
  'agent.assigned',
  'run.queued',
  'run.started',
  'repository.resolved',
  'workspace.created',
  'repository_memory.loaded',
  'implementation.started',
  'provider.requested',
  'provider.completed',
  'file.modified',
  'diff.reviewed',
  'secret_scan.passed',
  'secret_scan.blocked',
  'validation.blocked',
  'test.started',
  'test.failed',
  'test.passed',
  'commit.created',
  'branch.pushed',
  'pr.created',
  'ci.started',
  'ci.failed',
  'ci.passed',
  'repair.started',
  'run.retry_scheduled',
  'run.lease_expired',
  'run.completed',
  'run.failed',
  'run.cancelled'
);

create type public.task_source as enum (
  'owner',
  'orchestrator',
  'ai_audit',
  'failed_test',
  'ci_failure',
  'security_finding',
  'incident',
  'feature_request'
);

create type public.run_failure_kind as enum (
  'provider_outage',
  'provider_rate_limit',
  'provider_invalid_output',
  'github_error',
  'github_rate_limit',
  'repository_conflict',
  'authorization',
  'invalid_command',
  'worker_timeout',
  'test_failure',
  'ci_failure',
  'validation_failed',
  'protected_resource',
  'secret_detected',
  'cancelled',
  'internal'
);

create type public.validation_outcome as enum (
  'not_run',
  'running',
  'passed',
  'failed',
  'skipped'
);

-- ---------------------------------------------------------------------------
-- Portfolio, workforce, and backlog fields on existing tables
-- ---------------------------------------------------------------------------

alter table public.projects
  add column tags text[] not null default '{}'::text[],
  add column vercel_project_id text
    check (vercel_project_id is null or vercel_project_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  add column vercel_team_slug text
    check (vercel_team_slug is null or vercel_team_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  add column supabase_project_ref text
    check (supabase_project_ref is null or supabase_project_ref ~ '^[a-z]{20}$'),
  add column archived_at timestamptz,
  add constraint projects_tags_bounded check (
    array_length(tags, 1) is null or array_length(tags, 1) <= 20
  ),
  add constraint projects_archived_at_consistent check (
    archived_at is null or status = 'archived'::public.project_status
  );

alter table public.agents
  add column enabled boolean not null default true,
  add column total_runs integer not null default 0 check (total_runs >= 0),
  add column succeeded_runs integer not null default 0 check (succeeded_runs >= 0),
  add column failed_runs integer not null default 0 check (failed_runs >= 0),
  add constraint agents_run_counts_consistent
    check (succeeded_runs + failed_runs <= total_runs);

alter table public.tasks
  add column acceptance_criteria text
    check (acceptance_criteria is null or char_length(acceptance_criteria) <= 4000),
  add column source public.task_source not null default 'owner',
  add column depends_on_task_id uuid,
  add column pull_request_id uuid,
  add constraint tasks_depends_on_fk foreign key (depends_on_task_id, organization_id)
    references public.tasks(id, organization_id) on delete set null,
  add constraint tasks_pull_request_fk foreign key (pull_request_id, organization_id)
    references public.pull_requests(id, organization_id) on delete set null,
  add constraint tasks_no_self_dependency check (depends_on_task_id is null or depends_on_task_id <> id),
  add constraint tasks_acceptance_criteria_no_likely_secret
    check (acceptance_criteria is null or not public.text_has_likely_secret(acceptance_criteria));

-- Durable worker state. Leases let a crashed or timed-out tick self-heal on the
-- next tick instead of stranding a run; nothing is held in process memory.
alter table public.agent_runs
  add column provider text check (provider is null or provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  add column model text check (model is null or char_length(btrim(model)) between 1 and 120),
  add column step text check (step is null or step ~ '^[a-z][a-z0-9_.]{0,63}$'),
  add column attempt integer not null default 0 check (attempt >= 0),
  add column max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  add column repair_attempts integer not null default 0 check (repair_attempts >= 0),
  add column ci_repair_attempts integer not null default 0 check (ci_repair_attempts >= 0),
  add column lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 128),
  add column lease_expires_at timestamptz,
  add column heartbeat_at timestamptz,
  add column next_attempt_at timestamptz,
  add column cancel_requested_at timestamptz,
  add column cancel_requested_by uuid references auth.users(id) on delete set null,
  add column failure_kind public.run_failure_kind,
  add constraint agent_runs_lease_consistent
    check ((lease_owner is null) = (lease_expires_at is null)),
  add constraint agent_runs_failure_kind_consistent
    check (failure_kind is null or status in ('failed'::public.run_status, 'cancelled'::public.run_status));

comment on column public.agent_runs.lease_expires_at is
  'Durable worker lease. An expired lease is reclaimable by the next tick; run state never depends on a live process or an open browser.';
comment on column public.agent_runs.provider is
  'Worker provider adapter key. Agents are operating roles; provider credentials live only in server-side environment settings.';

-- ---------------------------------------------------------------------------
-- Append-only per-run execution evidence
-- ---------------------------------------------------------------------------

create table public.run_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  agent_run_id uuid not null,
  sequence bigint not null check (sequence > 0),
  event_type public.run_event_type not null,
  message text not null check (char_length(btrim(message)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint run_events_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint run_events_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete cascade,
  constraint run_events_sequence_unique unique (agent_run_id, sequence),
  constraint run_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint run_events_metadata_no_sensitive_data check (not public.jsonb_has_sensitive_keys(metadata)),
  constraint run_events_message_no_likely_secret check (not public.text_has_likely_secret(message))
);

comment on table public.run_events is
  'Append-only execution evidence for one agent run. Never stores provider chain-of-thought, file bodies, diffs, or credentials.';

-- ---------------------------------------------------------------------------
-- Isolated engineering workspace for a code-changing run
-- ---------------------------------------------------------------------------

create table public.run_workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  agent_run_id uuid not null,
  repository text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  external_repository_id bigint not null check (external_repository_id > 0),
  base_branch text not null check (char_length(btrim(base_branch)) between 1 and 255),
  base_sha text not null check (base_sha ~ '^[0-9a-f]{40}$'),
  working_branch text not null check (working_branch ~ '^factory/[A-Za-z0-9._-]{1,180}$'),
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  model text not null check (char_length(btrim(model)) between 1 and 120),
  branch_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint run_workspaces_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint run_workspaces_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete cascade,
  constraint run_workspaces_run_unique unique (agent_run_id),
  constraint run_workspaces_branch_unique unique (repository, working_branch)
);

comment on table public.run_workspaces is
  'One isolated branch workspace per code-changing run. Concurrent runs cannot share a working branch.';

-- ---------------------------------------------------------------------------
-- Normalized structured run results
-- ---------------------------------------------------------------------------

create table public.run_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  agent_run_id uuid not null,
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  files_changed integer not null default 0 check (files_changed >= 0),
  additions integer not null default 0 check (additions >= 0),
  deletions integer not null default 0 check (deletions >= 0),
  commits integer not null default 0 check (commits >= 0),
  tests_outcome public.validation_outcome not null default 'not_run',
  lint_outcome public.validation_outcome not null default 'not_run',
  typecheck_outcome public.validation_outcome not null default 'not_run',
  build_outcome public.validation_outcome not null default 'not_run',
  risk_level public.risk_level not null default 'green',
  changed_files jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  security_findings jsonb not null default '[]'::jsonb,
  next_recommendation text check (next_recommendation is null or char_length(next_recommendation) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint run_results_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint run_results_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete cascade,
  constraint run_results_run_unique unique (agent_run_id),
  constraint run_results_changed_files_array check (jsonb_typeof(changed_files) = 'array'),
  constraint run_results_warnings_array check (jsonb_typeof(warnings) = 'array'),
  constraint run_results_blockers_array check (jsonb_typeof(blockers) = 'array'),
  constraint run_results_findings_array check (jsonb_typeof(security_findings) = 'array'),
  constraint run_results_no_sensitive_changed_files check (not public.jsonb_has_sensitive_keys(changed_files)),
  constraint run_results_no_sensitive_warnings check (not public.jsonb_has_sensitive_keys(warnings)),
  constraint run_results_no_sensitive_blockers check (not public.jsonb_has_sensitive_keys(blockers)),
  constraint run_results_no_sensitive_findings check (not public.jsonb_has_sensitive_keys(security_findings)),
  constraint run_results_summary_no_likely_secret check (not public.text_has_likely_secret(summary)),
  constraint run_results_recommendation_no_likely_secret
    check (next_recommendation is null or not public.text_has_likely_secret(next_recommendation))
);

comment on table public.run_results is
  'Normalized run outcome. Counts and validation outcomes are derived from provider structured output and real repository CI, never from model prose alone.';

-- ---------------------------------------------------------------------------
-- Organization settings
-- ---------------------------------------------------------------------------

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  factory_name text not null default 'SoftwareFactory'
    check (char_length(btrim(factory_name)) between 1 and 120),
  timezone text not null default 'UTC' check (char_length(btrim(timezone)) between 1 and 64),
  -- Commanded execution interlock. This is deliberately separate from the
  -- Phase 1D autonomy kill switch: it gates worker runs that an owner explicitly
  -- requested and that always end in a human-reviewed draft pull request. It
  -- never enables autonomous approval, merge, deployment, or rollback.
  execution_enabled boolean not null default false,
  daily_report_enabled boolean not null default false,
  daily_report_hour smallint not null default 8 check (daily_report_hour between 0 and 23),
  max_repair_attempts smallint not null default 2 check (max_repair_attempts between 0 and 5),
  max_ci_repair_attempts smallint not null default 1 check (max_ci_repair_attempts between 0 and 5),
  max_concurrent_runs smallint not null default 2 check (max_concurrent_runs between 1 and 10),
  default_provider text not null default 'openai_codex'
    check (default_provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  default_model text not null default 'gpt-5-codex'
    check (char_length(btrim(default_model)) between 1 and 120),
  notify_on_owner_action boolean not null default true,
  notify_on_run_failure boolean not null default true,
  notify_on_security_finding boolean not null default true,
  activity_retention_days smallint not null default 365
    check (activity_retention_days between 30 and 3650),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organization_settings is
  'Owner-managed factory preferences. A preference row never grants a capability that is not implemented and cannot weaken a protected-resource rule.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index run_events_run_sequence_idx on public.run_events (agent_run_id, sequence);
create index run_events_org_time_idx on public.run_events (organization_id, occurred_at desc);
create index run_events_project_time_idx on public.run_events (project_id, occurred_at desc);
create index run_workspaces_project_idx on public.run_workspaces (project_id, created_at desc);
create index run_results_project_idx on public.run_results (project_id, created_at desc);
create index projects_tags_idx on public.projects using gin (tags);
create index tasks_depends_on_idx on public.tasks (depends_on_task_id) where depends_on_task_id is not null;
create index tasks_source_idx on public.tasks (organization_id, source, created_at desc);
create index agents_enabled_idx on public.agents (organization_id, enabled, role);

-- Claiming index for the durable worker. Runs waiting for a lease are the only
-- rows a tick ever scans.
create index agent_runs_claimable_idx
  on public.agent_runs (next_attempt_at, created_at)
  where status in ('queued'::public.run_status, 'running'::public.run_status, 'validating'::public.run_status);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.run_events enable row level security;
alter table public.run_events force row level security;
alter table public.run_workspaces enable row level security;
alter table public.run_workspaces force row level security;
alter table public.run_results enable row level security;
alter table public.run_results force row level security;
alter table public.organization_settings enable row level security;
alter table public.organization_settings force row level security;

create policy run_events_select_members
  on public.run_events for select to authenticated
  using (public.is_organization_member(organization_id));
create policy run_workspaces_select_members
  on public.run_workspaces for select to authenticated
  using (public.is_organization_member(organization_id));
create policy run_results_select_members
  on public.run_results for select to authenticated
  using (public.is_organization_member(organization_id));
create policy organization_settings_select_members
  on public.organization_settings for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.run_events from anon, authenticated;
revoke all on table public.run_workspaces from anon, authenticated;
revoke all on table public.run_results from anon, authenticated;
revoke all on table public.organization_settings from anon, authenticated;

-- Reads only. Every write goes through an audited SECURITY DEFINER workflow.
grant select on table public.run_events to authenticated;
grant select on table public.run_workspaces to authenticated;
grant select on table public.run_results to authenticated;
grant select on table public.organization_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Immutability and shared triggers
-- ---------------------------------------------------------------------------

create or replace function public.reject_run_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000', message = 'run events are append-only';
end;
$function$;

revoke all on function public.reject_run_event_mutation() from public, anon, authenticated;

create trigger run_events_append_only
  before update or delete on public.run_events
  for each row execute function public.reject_run_event_mutation();

do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'run_events', 'run_workspaces', 'run_results', 'organization_settings'
  ]
  loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.reject_sensitive_row_data()',
      table_name || '_reject_sensitive_data', table_name
    );
  end loop;

  foreach table_name in array array['run_workspaces', 'run_results', 'organization_settings']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;

  -- run_events is already fully immutable through its append-only trigger.
  foreach table_name in array array['run_workspaces', 'run_results']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_organization_reassignment()',
      table_name || '_prevent_org_change', table_name
    );
  end loop;
end;
$triggers$;
