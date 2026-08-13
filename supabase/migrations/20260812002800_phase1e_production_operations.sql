-- Phase 1E production-operations control plane.
--
-- This migration adds monitoring, health, incident, protection, rollback
-- decision, diagnosis, repair, and durable event state. It deliberately adds
-- NO executor: nothing here deploys, merges, rolls back, or runs a worker.
-- Every workflow that would mutate production stops at a recorded blocker.
--
-- Privilege boundary: no new table privileges are granted to service_role, so
-- the verified migration-026 ACL matrix is unchanged. Browsers receive SELECT
-- only through RLS plus bounded caller-member RPCs, and every write goes
-- through a narrow SECURITY DEFINER workflow that re-derives the caller from
-- auth.uid().

/* ------------------------------------------------------------------ enums */

create type public.production_signal_kind as enum (
  'uptime',
  'deployment',
  'error_rate',
  'latency',
  'critical_route',
  'authentication',
  'database',
  'job',
  'integration',
  'synthetic'
);

create type public.monitor_connection_state as enum (
  'not_connected',
  'connected',
  'error',
  'disabled'
);

create type public.signal_outcome as enum ('pass', 'degraded', 'fail', 'unknown');

create type public.project_health_state as enum (
  'healthy',
  'degraded',
  'critical',
  'unknown',
  'paused'
);

create type public.incident_sev as enum ('sev1', 'sev2', 'sev3', 'sev4');

create type public.synthetic_profile as enum ('basic', 'standard', 'critical');

create type public.freeze_state as enum ('active', 'released');

create type public.deployment_validation_state as enum (
  'passed',
  'failed',
  'inconclusive',
  'cancelled'
);

create type public.rollback_state as enum (
  'evaluated',
  'blocked',
  'approved',
  'executing',
  'succeeded',
  'failed',
  'escalated',
  'cancelled'
);

create type public.repair_state as enum (
  'created',
  'blocked',
  'assigned',
  'in_progress',
  'succeeded',
  'failed',
  'escalated'
);

create type public.diagnosis_confidence as enum ('low', 'medium', 'high');

create type public.operations_event_state as enum (
  'pending',
  'processing',
  'processed',
  'failed',
  'dead_letter'
);

create type public.operations_audit_kind as enum (
  'monitor.configured',
  'monitor.observed',
  'health.changed',
  'incident.created',
  'incident.deduplicated',
  'incident.severity_changed',
  'incident.resolved',
  'freeze.activated',
  'freeze.released',
  'operations.stopped',
  'validation.recorded',
  'rollback.evaluated',
  'rollback.blocked',
  'rollback.failed',
  'rollback.escalated',
  'diagnosis.recorded',
  'repair.created',
  'repair.failed',
  'repair.escalated',
  'event.enqueued',
  'event.processed'
);

/* ------------------------------------------------------- project additions */

alter table public.projects
  add column operations_health_state public.project_health_state not null default 'unknown',
  add column operations_health_reason text
    check (operations_health_reason is null or char_length(btrim(operations_health_reason)) between 1 and 500),
  add column operations_health_computed_at timestamptz,
  add column autonomous_releases_frozen boolean not null default false,
  add column autonomous_operations_stopped boolean not null default false,
  add column owner_attention_required boolean not null default false;

comment on column public.projects.operations_health_state is
  'Derived Phase 1E health. UNKNOWN until real signals exist; it is never optimistically defaulted to healthy.';
comment on column public.projects.autonomous_releases_frozen is
  'Release freeze marker. A freeze only removes authority, so it may be applied automatically; releasing it is owner-only.';

/* ----------------------------------------------------- incident additions */

alter table public.incidents
  add column sev public.incident_sev,
  add column source public.production_signal_kind,
  add column monitor_id uuid,
  add column fingerprint text
    check (fingerprint is null or fingerprint ~ '^[a-z0-9]([a-z0-9:._-]{6,126})[a-z0-9]$'),
  add column symptoms text check (symptoms is null or char_length(btrim(symptoms)) between 1 and 2000),
  add column impact text check (impact is null or char_length(btrim(impact)) between 1 and 2000),
  add column commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-fA-F]{7,64}$'),
  add column pull_request_id uuid,
  add column agent_run_id uuid,
  add column evidence jsonb not null default '{}'::jsonb,
  add column occurrence_count integer not null default 1 check (occurrence_count between 1 and 1000000),
  add column first_signal_at timestamptz,
  add column last_signal_at timestamptz,
  add column root_cause text check (root_cause is null or char_length(btrim(root_cause)) between 10 and 4000),
  add column corrective_action text
    check (corrective_action is null or char_length(btrim(corrective_action)) between 10 and 4000),
  add column prevention_reference text
    check (prevention_reference is null or char_length(btrim(prevention_reference)) between 1 and 500),
  add column resolution_validation_id uuid,
  add column owner_attention_required boolean not null default false,
  add column auto_created boolean not null default false;

alter table public.incidents
  add constraint incidents_evidence_object check (jsonb_typeof(evidence) = 'object'),
  add constraint incidents_evidence_no_sensitive_data check (not public.jsonb_has_sensitive_keys(evidence)),
  add constraint incidents_sev_severity_aligned check (
    sev is null
    or (sev = 'sev1' and severity = 'critical')
    or (sev = 'sev2' and severity = 'high')
    or (sev = 'sev3' and severity = 'medium')
    or (sev = 'sev4' and severity = 'low')
  ),
  add constraint incidents_resolution_requires_cause check (
    status not in ('resolved', 'closed')
    or (root_cause is not null and corrective_action is not null and resolved_at is not null)
  ),
  add constraint incidents_pull_request_fk foreign key (pull_request_id, organization_id)
    references public.pull_requests(id, organization_id) on delete set null,
  add constraint incidents_agent_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete set null,
  add constraint incidents_id_organization_unique unique (id, organization_id);

-- One open incident per project fingerprint. Repeated signals deduplicate into
-- the existing record instead of creating incident storms.
create unique index incidents_open_fingerprint_unique
  on public.incidents (project_id, fingerprint)
  where fingerprint is not null and status in ('open', 'investigating', 'mitigated');

create index incidents_project_sev_status_idx on public.incidents (project_id, sev, status, detected_at desc);
create index incidents_owner_attention_idx on public.incidents (organization_id, owner_attention_required)
  where owner_attention_required;

comment on constraint incidents_resolution_requires_cause on public.incidents is
  'An incident may not be marked resolved or closed merely because a later deployment succeeded. Root cause and corrective action are mandatory evidence.';

/* -------------------------------------------------------- monitoring plane */

create table public.production_monitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  signal_kind public.production_signal_kind not null,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  -- PostgreSQL bounds a regex repetition count at 255, so the length ceiling
  -- lives in the pattern itself rather than in a separate wider check.
  target_url text check (
    target_url is null
    or target_url ~ '^https://[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]{3,200}$'
  ),
  target_reference text check (target_reference is null or char_length(btrim(target_reference)) between 1 and 200),
  profile public.synthetic_profile,
  connection_state public.monitor_connection_state not null default 'not_connected',
  unavailable_reason text check (unavailable_reason is null or char_length(btrim(unavailable_reason)) between 1 and 300),
  enabled boolean not null default false,
  failure_threshold smallint not null default 2 check (failure_threshold between 1 and 10),
  degraded_latency_ms integer not null default 2000 check (degraded_latency_ms between 100 and 120000),
  timeout_ms integer not null default 10000 check (timeout_ms between 1000 and 60000),
  expected_status_code smallint not null default 200 check (expected_status_code between 100 and 599),
  consecutive_failures smallint not null default 0 check (consecutive_failures between 0 and 1000),
  last_observed_at timestamptz,
  last_outcome public.signal_outcome not null default 'unknown',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_monitors_id_organization_unique unique (id, organization_id),
  constraint production_monitors_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint production_monitors_name_unique unique (project_id, name),
  -- A monitor may only be enabled when its adapter is actually connected. This
  -- is the database-level guarantee that the product cannot fabricate signals.
  constraint production_monitors_enabled_requires_connection check (
    not enabled or connection_state = 'connected'
  ),
  constraint production_monitors_connected_requires_target check (
    connection_state <> 'connected' or target_url is not null
  ),
  constraint production_monitors_unavailable_reason_present check (
    connection_state <> 'not_connected' or unavailable_reason is not null
  ),
  constraint production_monitors_synthetic_profile check (
    (signal_kind = 'synthetic') = (profile is not null)
  )
);

comment on table public.production_monitors is
  'Provider-neutral production monitor definitions. connection_state is not_connected until a real adapter is configured, and an unconnected monitor cannot be enabled.';

create table public.monitor_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  monitor_id uuid not null,
  signal_kind public.production_signal_kind not null,
  outcome public.signal_outcome not null,
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 600000),
  status_code smallint check (status_code is null or status_code between 100 and 599),
  failure_reason text check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 400),
  evidence jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint monitor_observations_id_organization_unique unique (id, organization_id),
  constraint monitor_observations_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint monitor_observations_monitor_fk foreign key (monitor_id, organization_id)
    references public.production_monitors(id, organization_id) on delete cascade,
  constraint monitor_observations_evidence_object check (jsonb_typeof(evidence) = 'object'),
  constraint monitor_observations_evidence_no_sensitive_data check (not public.jsonb_has_sensitive_keys(evidence))
);

create index monitor_observations_monitor_time_idx
  on public.monitor_observations (monitor_id, observed_at desc);
create index monitor_observations_project_time_idx
  on public.monitor_observations (project_id, observed_at desc);

alter table public.incidents
  add constraint incidents_monitor_fk foreign key (monitor_id, organization_id)
    references public.production_monitors(id, organization_id) on delete set null;

create table public.project_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  state public.project_health_state not null,
  previous_state public.project_health_state,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  reasons jsonb not null default '[]'::jsonb,
  signal_summary jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  constraint project_health_snapshots_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint project_health_snapshots_reasons_array check (jsonb_typeof(reasons) = 'array'),
  constraint project_health_snapshots_summary_object check (jsonb_typeof(signal_summary) = 'object'),
  constraint project_health_snapshots_no_sensitive_data check (
    not public.jsonb_has_sensitive_keys(reasons) and not public.jsonb_has_sensitive_keys(signal_summary)
  )
);

create index project_health_snapshots_project_time_idx
  on public.project_health_snapshots (project_id, computed_at desc);

/* ---------------------------------------------------------- protection */

create table public.release_freezes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  state public.freeze_state not null default 'active',
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{2,49}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  incident_id uuid,
  automatic boolean not null default false,
  frozen_at timestamptz not null default now(),
  frozen_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  release_note text check (release_note is null or char_length(btrim(release_note)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_freezes_id_organization_unique unique (id, organization_id),
  constraint release_freezes_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint release_freezes_incident_fk foreign key (incident_id, organization_id)
    references public.incidents(id, organization_id) on delete set null,
  constraint release_freezes_state_evidence check (
    (state = 'active' and released_at is null and released_by is null)
    or (state = 'released' and released_at is not null)
  ),
  constraint release_freezes_automatic_actor check (automatic or frozen_by is not null)
);

create unique index release_freezes_active_unique
  on public.release_freezes (project_id)
  where state = 'active';

comment on table public.release_freezes is
  'A freeze only removes autonomous release authority, so it may be created automatically. Releasing a freeze is an owner-only decision and is always recorded.';

/* --------------------------------------------------- deployment validation */

create table public.deployment_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  deployment_id uuid not null,
  state public.deployment_validation_state not null,
  checks jsonb not null default '[]'::jsonb,
  baseline_reference text check (baseline_reference is null or char_length(btrim(baseline_reference)) between 1 and 200),
  validator_version text not null check (char_length(btrim(validator_version)) between 1 and 60),
  policy_version text not null check (char_length(btrim(policy_version)) between 1 and 60),
  summary text check (summary is null or char_length(btrim(summary)) between 1 and 1000),
  correlation_id uuid not null default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint deployment_validations_id_organization_unique unique (id, organization_id),
  constraint deployment_validations_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint deployment_validations_deployment_fk foreign key (deployment_id, organization_id)
    references public.deployments(id, organization_id) on delete cascade,
  constraint deployment_validations_checks_array check (jsonb_typeof(checks) = 'array'),
  constraint deployment_validations_no_sensitive_data check (not public.jsonb_has_sensitive_keys(checks))
);

create index deployment_validations_deployment_idx
  on public.deployment_validations (deployment_id, created_at desc);

alter table public.incidents
  add constraint incidents_resolution_validation_fk
    foreign key (resolution_validation_id, organization_id)
    references public.deployment_validations(id, organization_id) on delete set null;

/* ------------------------------------------------------- rollback decisions */

create table public.rollback_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  incident_id uuid not null,
  from_deployment_id uuid,
  to_deployment_id uuid,
  state public.rollback_state not null default 'evaluated',
  attempt smallint not null default 1 check (attempt between 1 and 3),
  eligible boolean not null default false,
  blocked_reason text check (blocked_reason is null or char_length(btrim(blocked_reason)) between 1 and 300),
  eligibility jsonb not null default '{}'::jsonb,
  outcome_note text check (outcome_note is null or char_length(btrim(outcome_note)) between 1 and 1000),
  validation_id uuid,
  escalated boolean not null default false,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rollback_operations_id_organization_unique unique (id, organization_id),
  constraint rollback_operations_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint rollback_operations_incident_fk foreign key (incident_id, organization_id)
    references public.incidents(id, organization_id) on delete cascade,
  constraint rollback_operations_from_deployment_fk foreign key (from_deployment_id, organization_id)
    references public.deployments(id, organization_id) on delete set null,
  constraint rollback_operations_to_deployment_fk foreign key (to_deployment_id, organization_id)
    references public.deployments(id, organization_id) on delete set null,
  constraint rollback_operations_validation_fk foreign key (validation_id, organization_id)
    references public.deployment_validations(id, organization_id) on delete set null,
  constraint rollback_operations_blocked_reason check (state <> 'blocked' or blocked_reason is not null),
  constraint rollback_operations_ineligible_cannot_execute check (
    eligible or state in ('evaluated', 'blocked', 'cancelled', 'escalated')
  ),
  constraint rollback_operations_eligibility_object check (jsonb_typeof(eligibility) = 'object'),
  constraint rollback_operations_no_sensitive_data check (not public.jsonb_has_sensitive_keys(eligibility)),
  constraint rollback_operations_failure_escalates check (state <> 'failed' or escalated)
);

create unique index rollback_operations_incident_attempt_unique
  on public.rollback_operations (incident_id, attempt);

comment on table public.rollback_operations is
  'Rollback decision evidence. Phase 1E contains no deployment executor: an evaluated rollback is recorded and blocked with EXECUTOR_NOT_CONNECTED rather than performed.';
comment on constraint rollback_operations_failure_escalates on public.rollback_operations is
  'A failed rollback must escalate. Recovery failure never degrades into silence.';

/* --------------------------------------------------------------- diagnosis */

create table public.production_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  incident_id uuid not null,
  likely_cause text not null check (char_length(btrim(likely_cause)) between 5 and 500),
  affected_subsystem text not null check (char_length(btrim(affected_subsystem)) between 2 and 120),
  confidence public.diagnosis_confidence not null,
  recommended_action text not null check (char_length(btrim(recommended_action)) between 5 and 500),
  risk_level public.risk_level not null,
  evidence jsonb not null default '[]'::jsonb,
  analyzer text not null check (char_length(btrim(analyzer)) between 1 and 60),
  created_at timestamptz not null default now(),
  constraint production_diagnoses_id_organization_unique unique (id, organization_id),
  constraint production_diagnoses_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint production_diagnoses_incident_fk foreign key (incident_id, organization_id)
    references public.incidents(id, organization_id) on delete cascade,
  constraint production_diagnoses_evidence_array check (jsonb_typeof(evidence) = 'array'),
  constraint production_diagnoses_no_sensitive_data check (not public.jsonb_has_sensitive_keys(evidence))
);

comment on table public.production_diagnoses is
  'Structured Production Investigator conclusions only: cause, cited evidence, subsystem, confidence, recommended action, and risk. Intermediate reasoning is never stored or returned.';

/* ------------------------------------------------------------ self-healing */

create table public.repair_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  incident_id uuid not null,
  diagnosis_id uuid,
  task_id uuid,
  attempt_number smallint not null check (attempt_number between 1 and 3),
  state public.repair_state not null default 'created',
  assignment_status text not null default 'not_connected'
    check (assignment_status in ('not_connected', 'pending', 'assigned')),
  blocked_reason text check (blocked_reason is null or char_length(btrim(blocked_reason)) between 1 and 300),
  failure_reason text check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 500),
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repair_attempts_id_organization_unique unique (id, organization_id),
  constraint repair_attempts_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint repair_attempts_incident_fk foreign key (incident_id, organization_id)
    references public.incidents(id, organization_id) on delete cascade,
  constraint repair_attempts_diagnosis_fk foreign key (diagnosis_id, organization_id)
    references public.production_diagnoses(id, organization_id) on delete set null,
  constraint repair_attempts_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete set null,
  constraint repair_attempts_incident_attempt_unique unique (incident_id, attempt_number),
  constraint repair_attempts_blocked_reason check (state <> 'blocked' or blocked_reason is not null),
  constraint repair_attempts_failure_reason check (state <> 'failed' or failure_reason is not null)
);

comment on table public.repair_attempts is
  'Bounded self-healing work. Phase 1C is Not Connected, so an attempt creates owner-visible repair work and records assignment as not_connected; it never executes a fix.';

/* -------------------------------------------------------- durable events */

create table public.operations_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  event_type text not null check (event_type in (
    'health.failed',
    'deployment.failed',
    'deployment.degraded',
    'synthetic.failed',
    'incident.created',
    'rollback.started',
    'rollback.completed',
    'repair.started',
    'repair.failed',
    'incident.resolved'
  )),
  dedupe_key text not null check (char_length(btrim(dedupe_key)) between 8 and 200),
  payload jsonb not null default '{}'::jsonb,
  state public.operations_event_state not null default 'pending',
  attempts smallint not null default 0 check (attempts between 0 and 20),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text check (last_error is null or char_length(btrim(last_error)) between 1 and 500),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_events_id_organization_unique unique (id, organization_id),
  constraint operations_events_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint operations_events_dedupe_unique unique (organization_id, dedupe_key),
  constraint operations_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint operations_events_no_sensitive_data check (not public.jsonb_has_sensitive_keys(payload)),
  constraint operations_events_terminal_evidence check (
    state <> 'processed' or processed_at is not null
  )
);

create index operations_events_pending_idx
  on public.operations_events (organization_id, available_at)
  where state = 'pending';

comment on table public.operations_events is
  'Durable, idempotent operations orchestration queue. dedupe_key is unique per organization, so a repeated real-world signal enqueues exactly once.';

create table public.operations_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  kind public.operations_audit_kind not null,
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 60),
  entity_id uuid,
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint operations_audit_events_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint operations_audit_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint operations_audit_events_no_sensitive_data check (not public.jsonb_has_sensitive_keys(metadata))
);

create index operations_audit_events_org_time_idx
  on public.operations_audit_events (organization_id, created_at desc);

comment on table public.operations_audit_events is
  'Immutable Phase 1E audit trail. Rows may never be updated or deleted by any role reachable from the application.';

/* ------------------------------------------------------ shared row guards */

do $phase1e_triggers$
declare
  operations_table text;
begin
  foreach operations_table in array array[
    'production_monitors', 'monitor_observations', 'project_health_snapshots',
    'release_freezes', 'deployment_validations', 'rollback_operations',
    'production_diagnoses', 'repair_attempts', 'operations_events',
    'operations_audit_events'
  ]
  loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.reject_sensitive_row_data()',
      operations_table || '_reject_sensitive_data', operations_table
    );
    execute format(
      'alter table public.%I enable row level security',
      operations_table
    );
    execute format(
      'alter table public.%I force row level security',
      operations_table
    );
    execute format(
      'revoke all on table public.%I from anon, authenticated',
      operations_table
    );
    execute format(
      'grant select on table public.%I to authenticated',
      operations_table
    );
  end loop;

  foreach operations_table in array array[
    'production_monitors', 'release_freezes', 'rollback_operations',
    'repair_attempts', 'operations_events'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      operations_table || '_set_updated_at', operations_table
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_organization_reassignment()',
      operations_table || '_prevent_org_change', operations_table
    );
  end loop;
end;
$phase1e_triggers$;

create or replace function public.reject_operations_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'operations evidence rows are append-only';
end;
$function$;

create trigger monitor_observations_append_only
  before update or delete on public.monitor_observations
  for each row execute function public.reject_operations_record_mutation();

create trigger project_health_snapshots_append_only
  before update or delete on public.project_health_snapshots
  for each row execute function public.reject_operations_record_mutation();

create trigger production_diagnoses_append_only
  before update or delete on public.production_diagnoses
  for each row execute function public.reject_operations_record_mutation();

create trigger operations_audit_events_append_only
  before update or delete on public.operations_audit_events
  for each row execute function public.reject_operations_record_mutation();

/* ------------------------------------------------------------- RLS reads */

create policy production_monitors_select_members
  on public.production_monitors for select to authenticated
  using (public.is_organization_member(organization_id));
create policy monitor_observations_select_members
  on public.monitor_observations for select to authenticated
  using (public.is_organization_member(organization_id));
create policy project_health_snapshots_select_members
  on public.project_health_snapshots for select to authenticated
  using (public.is_organization_member(organization_id));
create policy release_freezes_select_members
  on public.release_freezes for select to authenticated
  using (public.is_organization_member(organization_id));
create policy deployment_validations_select_members
  on public.deployment_validations for select to authenticated
  using (public.is_organization_member(organization_id));
create policy rollback_operations_select_members
  on public.rollback_operations for select to authenticated
  using (public.is_organization_member(organization_id));
create policy production_diagnoses_select_members
  on public.production_diagnoses for select to authenticated
  using (public.is_organization_member(organization_id));
create policy repair_attempts_select_members
  on public.repair_attempts for select to authenticated
  using (public.is_organization_member(organization_id));
create policy operations_events_select_members
  on public.operations_events for select to authenticated
  using (public.is_organization_member(organization_id));
create policy operations_audit_events_select_members
  on public.operations_audit_events for select to authenticated
  using (public.is_organization_member(organization_id));

/* -------------------------------------------------------- internal helpers */

create or replace function public.record_operations_audit_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_kind public.operations_audit_kind,
  p_entity_type text,
  p_entity_id uuid,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  audit_id uuid;
begin
  if p_organization_id is null then
    raise exception using errcode = '23502', message = 'organization is required for operations audit events';
  end if;

  if public.jsonb_has_sensitive_keys(coalesce(p_metadata, '{}'::jsonb)) then
    raise exception using errcode = '23514', message = 'operations audit metadata contains sensitive data';
  end if;

  insert into public.operations_audit_events (
    organization_id, project_id, kind, entity_type, entity_id, summary, metadata, actor_user_id
  )
  values (
    p_organization_id, p_project_id, p_kind, p_entity_type, p_entity_id,
    left(p_summary, 500), coalesce(p_metadata, '{}'::jsonb), auth.uid()
  )
  returning id into audit_id;

  return audit_id;
end;
$function$;

create or replace function public.enqueue_operations_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_event_type text,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  event_id uuid;
begin
  insert into public.operations_events (
    organization_id, project_id, event_type, dedupe_key, payload
  )
  values (
    p_organization_id, p_project_id, p_event_type, p_dedupe_key, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (organization_id, dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    -- Idempotent by contract: the same real-world signal enqueues once.
    select existing.id into event_id
    from public.operations_events existing
    where existing.organization_id = p_organization_id
      and existing.dedupe_key = p_dedupe_key;
    return event_id;
  end if;

  perform public.record_operations_audit_event(
    p_organization_id, p_project_id, 'event.enqueued'::public.operations_audit_kind,
    'operations_event', event_id, 'Operations event enqueued',
    pg_catalog.jsonb_build_object('event_type', p_event_type)
  );

  return event_id;
end;
$function$;

/* ----------------------------------------------------- severity and health */

create or replace function public.classify_production_severity(
  p_signal_kind public.production_signal_kind,
  p_production_unavailable boolean,
  p_affects_all_users boolean,
  p_deployment_attributed boolean,
  p_consecutive_failures integer
)
returns public.incident_sev
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_production_unavailable and p_affects_all_users then 'sev1'::public.incident_sev
    when p_production_unavailable then 'sev2'::public.incident_sev
    when p_signal_kind in ('authentication', 'database') then 'sev2'::public.incident_sev
    when p_deployment_attributed and coalesce(p_consecutive_failures, 0) >= 2 then 'sev2'::public.incident_sev
    when p_signal_kind in ('critical_route', 'synthetic', 'error_rate') then 'sev3'::public.incident_sev
    else 'sev4'::public.incident_sev
  end;
$function$;

create or replace function public.incident_sev_to_severity(p_sev public.incident_sev)
returns public.incident_severity
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_sev
    when 'sev1' then 'critical'::public.incident_severity
    when 'sev2' then 'high'::public.incident_severity
    when 'sev3' then 'medium'::public.incident_severity
    else 'low'::public.incident_severity
  end;
$function$;

create or replace function public.evaluate_project_health(p_project_id uuid)
returns public.project_health_state
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  failing_monitors integer := 0;
  degraded_monitors integer := 0;
  connected_monitors integer := 0;
  open_sev1 integer := 0;
  open_sev2 integer := 0;
  open_lower integer := 0;
  failed_deployments integer := 0;
  next_state public.project_health_state;
  next_reason text;
  reason_list jsonb := '[]'::jsonb;
begin
  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.can_access_project(p_project_id) then
    raise exception using errcode = '42501', message = 'project access is required';
  end if;

  select
    count(*) filter (where monitor.enabled and monitor.connection_state = 'connected'),
    count(*) filter (where monitor.enabled and monitor.last_outcome = 'fail'
      and monitor.consecutive_failures >= monitor.failure_threshold),
    count(*) filter (where monitor.enabled and monitor.last_outcome = 'degraded')
  into connected_monitors, failing_monitors, degraded_monitors
  from public.production_monitors monitor
  where monitor.project_id = p_project_id;

  select
    count(*) filter (where incident.sev = 'sev1'),
    count(*) filter (where incident.sev = 'sev2'),
    count(*) filter (where incident.sev in ('sev3', 'sev4'))
  into open_sev1, open_sev2, open_lower
  from public.incidents incident
  where incident.project_id = p_project_id
    and incident.status in ('open', 'investigating', 'mitigated');

  select count(*)
  into failed_deployments
  from public.deployments deployment
  where deployment.project_id = p_project_id
    and deployment.status = 'failed'
    and deployment.created_at > now() - interval '24 hours';

  if project_record.status = 'paused' or project_record.autonomous_operations_stopped then
    next_state := 'paused';
    next_reason := 'Operations are paused for this project.';
  elsif open_sev1 > 0 or failing_monitors > 0 then
    next_state := 'critical';
    next_reason := format(
      'Critical: %s failing monitor(s) past threshold and %s open SEV1 incident(s).',
      failing_monitors, open_sev1
    );
  elsif open_sev2 > 0 or degraded_monitors > 0 or failed_deployments > 0 then
    next_state := 'degraded';
    next_reason := format(
      'Degraded: %s open SEV2 incident(s), %s degraded monitor(s), %s failed deployment(s) in 24h.',
      open_sev2, degraded_monitors, failed_deployments
    );
  elsif connected_monitors = 0 then
    next_state := 'unknown';
    next_reason := 'No connected production monitor is enabled, so health cannot be evidenced.';
  elsif open_lower > 0 then
    next_state := 'degraded';
    next_reason := format('Degraded: %s open lower-severity incident(s).', open_lower);
  else
    next_state := 'healthy';
    next_reason := format('Healthy: %s connected monitor(s) reporting passing signals.', connected_monitors);
  end if;

  reason_list := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('code', 'connected_monitors', 'value', connected_monitors),
    pg_catalog.jsonb_build_object('code', 'failing_monitors', 'value', failing_monitors),
    pg_catalog.jsonb_build_object('code', 'degraded_monitors', 'value', degraded_monitors),
    pg_catalog.jsonb_build_object('code', 'open_sev1', 'value', open_sev1),
    pg_catalog.jsonb_build_object('code', 'open_sev2', 'value', open_sev2),
    pg_catalog.jsonb_build_object('code', 'open_lower_severity', 'value', open_lower),
    pg_catalog.jsonb_build_object('code', 'failed_deployments_24h', 'value', failed_deployments)
  );

  insert into public.project_health_snapshots (
    organization_id, project_id, state, previous_state, reason, reasons, signal_summary
  )
  values (
    project_record.organization_id, p_project_id, next_state,
    project_record.operations_health_state, next_reason, reason_list,
    pg_catalog.jsonb_build_object(
      'connected_monitors', connected_monitors,
      'failing_monitors', failing_monitors,
      'degraded_monitors', degraded_monitors
    )
  );

  if project_record.operations_health_state is distinct from next_state then
    perform public.record_operations_audit_event(
      project_record.organization_id, p_project_id, 'health.changed'::public.operations_audit_kind,
      'project', p_project_id, left(next_reason, 500),
      pg_catalog.jsonb_build_object('from', project_record.operations_health_state, 'to', next_state)
    );
  end if;

  update public.projects
  set operations_health_state = next_state,
    operations_health_reason = left(next_reason, 500),
    operations_health_computed_at = now()
  where id = p_project_id;

  return next_state;
end;
$function$;

/* ------------------------------------------------------------ monitoring */

create or replace function public.configure_production_monitor(
  p_project_id uuid,
  p_name text,
  p_signal_kind public.production_signal_kind,
  p_provider text,
  p_target_url text,
  p_profile public.synthetic_profile default null,
  p_expected_status_code smallint default 200,
  p_degraded_latency_ms integer default 2000,
  p_failure_threshold smallint default 2,
  p_enabled boolean default true
)
returns setof public.production_monitors
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  resolved_state public.monitor_connection_state;
  resolved_reason text;
  resolved_enabled boolean;
  monitor_record public.production_monitors%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.can_manage_organization(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  -- Only the direct HTTPS probe adapter exists in Phase 1E. Every other
  -- provider is recorded as Not Connected and cannot be enabled, so the
  -- product can never present a signal it did not actually observe.
  if p_provider = 'http' and p_target_url is not null then
    resolved_state := 'connected'::public.monitor_connection_state;
    resolved_reason := null;
    resolved_enabled := coalesce(p_enabled, true);
  else
    resolved_state := 'not_connected'::public.monitor_connection_state;
    resolved_reason := format('No connected adapter for provider %s in Phase 1E.', p_provider);
    resolved_enabled := false;
  end if;

  insert into public.production_monitors (
    organization_id, project_id, name, signal_kind, provider, target_url, profile,
    connection_state, unavailable_reason, enabled, failure_threshold,
    degraded_latency_ms, expected_status_code, created_by
  )
  values (
    project_record.organization_id, p_project_id, p_name, p_signal_kind, p_provider,
    p_target_url, p_profile, resolved_state, resolved_reason, resolved_enabled,
    coalesce(p_failure_threshold, 2), coalesce(p_degraded_latency_ms, 2000),
    coalesce(p_expected_status_code, 200), auth.uid()
  )
  on conflict (project_id, name) do update
  set signal_kind = excluded.signal_kind,
    provider = excluded.provider,
    target_url = excluded.target_url,
    profile = excluded.profile,
    connection_state = excluded.connection_state,
    unavailable_reason = excluded.unavailable_reason,
    enabled = excluded.enabled,
    failure_threshold = excluded.failure_threshold,
    degraded_latency_ms = excluded.degraded_latency_ms,
    expected_status_code = excluded.expected_status_code
  returning * into monitor_record;

  perform public.record_operations_audit_event(
    project_record.organization_id, p_project_id, 'monitor.configured'::public.operations_audit_kind,
    'production_monitor', monitor_record.id, format('Monitor %s configured', monitor_record.name),
    pg_catalog.jsonb_build_object(
      'signal_kind', monitor_record.signal_kind,
      'provider', monitor_record.provider,
      'connection_state', monitor_record.connection_state,
      'enabled', monitor_record.enabled
    )
  );

  perform public.evaluate_project_health(p_project_id);

  return next monitor_record;
end;
$function$;

create or replace function public.record_monitor_observation(
  p_monitor_id uuid,
  p_outcome public.signal_outcome,
  p_latency_ms integer default null,
  p_status_code smallint default null,
  p_failure_reason text default null,
  p_evidence jsonb default '{}'::jsonb
)
returns table (
  observation_id uuid,
  observed_monitor_id uuid,
  observed_outcome public.signal_outcome,
  failures_after smallint,
  threshold_breached boolean,
  health_state public.project_health_state
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  monitor_record public.production_monitors%rowtype;
  new_observation_id uuid;
  next_failures smallint;
  breached boolean;
  resulting_state public.project_health_state;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into monitor_record
  from public.production_monitors
  where id = p_monitor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'monitor not found';
  end if;

  if not public.can_manage_organization(monitor_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  if monitor_record.connection_state <> 'connected' or not monitor_record.enabled then
    raise exception using
      errcode = '23514',
      message = 'a monitor that is not connected and enabled cannot record observations';
  end if;

  next_failures := case
    when p_outcome = 'fail' then least(monitor_record.consecutive_failures + 1, 1000)
    else 0
  end;

  insert into public.monitor_observations (
    organization_id, project_id, monitor_id, signal_kind, outcome,
    latency_ms, status_code, failure_reason, evidence
  )
  values (
    monitor_record.organization_id, monitor_record.project_id, monitor_record.id,
    monitor_record.signal_kind, p_outcome, p_latency_ms, p_status_code,
    left(p_failure_reason, 400), coalesce(p_evidence, '{}'::jsonb)
  )
  returning id into new_observation_id;

  update public.production_monitors
  set last_outcome = p_outcome,
    last_observed_at = now(),
    consecutive_failures = next_failures
  where id = monitor_record.id;

  breached := p_outcome = 'fail' and next_failures >= monitor_record.failure_threshold;

  perform public.record_operations_audit_event(
    monitor_record.organization_id, monitor_record.project_id,
    'monitor.observed'::public.operations_audit_kind,
    'monitor_observation', new_observation_id,
    format('Monitor %s reported %s', monitor_record.name, p_outcome),
    pg_catalog.jsonb_build_object(
      'outcome', p_outcome,
      'consecutive_failures', next_failures,
      'threshold_breached', breached
    )
  );

  if breached then
    perform public.enqueue_operations_event(
      monitor_record.organization_id,
      monitor_record.project_id,
      case when monitor_record.signal_kind = 'synthetic' then 'synthetic.failed' else 'health.failed' end,
      format('monitor:%s:failures:%s', monitor_record.id, next_failures),
      pg_catalog.jsonb_build_object(
        'monitor_id', monitor_record.id,
        'signal_kind', monitor_record.signal_kind,
        'consecutive_failures', next_failures
      )
    );
  end if;

  resulting_state := public.evaluate_project_health(monitor_record.project_id);

  return query select new_observation_id, monitor_record.id, p_outcome, next_failures, breached, resulting_state;
end;
$function$;

/* ------------------------------------------------------------- incidents */

create or replace function public.open_production_incident(
  p_project_id uuid,
  p_fingerprint text,
  p_title text,
  p_sev public.incident_sev,
  p_source public.production_signal_kind,
  p_symptoms text,
  p_impact text,
  p_monitor_id uuid default null,
  p_deployment_id uuid default null,
  p_commit_sha text default null,
  p_evidence jsonb default '{}'::jsonb
)
returns table (
  incident_id uuid,
  incident_sev_level public.incident_sev,
  incident_status_value public.incident_status,
  occurrences integer,
  deduplicated boolean,
  freeze_applied boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  incident_record public.incidents%rowtype;
  was_deduplicated boolean := false;
  was_frozen boolean := false;
  escalated_sev public.incident_sev;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.can_manage_organization(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  select existing.* into incident_record
  from public.incidents existing
  where existing.project_id = p_project_id
    and existing.fingerprint = p_fingerprint
    and existing.status in ('open', 'investigating', 'mitigated')
  for update;

  if found then
    was_deduplicated := true;
    -- Repeated signals raise pressure on the same incident rather than
    -- creating a second one. Severity may only move upward here.
    escalated_sev := least(incident_record.sev, p_sev);

    update public.incidents
    set occurrence_count = incident_record.occurrence_count + 1,
      last_signal_at = now(),
      sev = escalated_sev,
      severity = public.incident_sev_to_severity(escalated_sev),
      evidence = incident_record.evidence || coalesce(p_evidence, '{}'::jsonb)
    where id = incident_record.id
    returning * into incident_record;

    perform public.record_operations_audit_event(
      project_record.organization_id, p_project_id,
      'incident.deduplicated'::public.operations_audit_kind,
      'incident', incident_record.id,
      format('Repeat signal folded into incident (%s occurrences)', incident_record.occurrence_count),
      pg_catalog.jsonb_build_object('fingerprint', p_fingerprint, 'sev', incident_record.sev)
    );
  else
    insert into public.incidents (
      organization_id, project_id, deployment_id, title, description, severity, status,
      sev, source, monitor_id, fingerprint, symptoms, impact, commit_sha, evidence,
      detected_at, first_signal_at, last_signal_at, auto_created, created_by
    )
    values (
      project_record.organization_id, p_project_id, p_deployment_id, p_title, p_symptoms,
      public.incident_sev_to_severity(p_sev), 'open'::public.incident_status,
      p_sev, p_source, p_monitor_id, p_fingerprint, p_symptoms, p_impact, p_commit_sha,
      coalesce(p_evidence, '{}'::jsonb), now(), now(), now(), true, auth.uid()
    )
    returning * into incident_record;

    perform public.record_operations_audit_event(
      project_record.organization_id, p_project_id,
      'incident.created'::public.operations_audit_kind,
      'incident', incident_record.id, format('%s incident opened: %s', upper(p_sev::text), p_title),
      pg_catalog.jsonb_build_object('sev', p_sev, 'source', p_source, 'fingerprint', p_fingerprint)
    );

    perform public.enqueue_operations_event(
      project_record.organization_id, p_project_id, 'incident.created',
      format('incident:%s:created', incident_record.id),
      pg_catalog.jsonb_build_object('incident_id', incident_record.id, 'sev', p_sev)
    );
  end if;

  -- Automatic protection. A SEV1/SEV2 production failure freezes autonomous
  -- releases immediately; investigation and repair work remain available.
  if incident_record.sev in ('sev1', 'sev2') then
    was_frozen := public.freeze_project_releases(
      p_project_id,
      'SEVERE_PRODUCTION_FAILURE',
      format('Autonomous releases frozen by %s incident.', upper(incident_record.sev::text)),
      incident_record.id,
      true
    );
  end if;

  perform public.evaluate_project_health(p_project_id);

  return query select incident_record.id, incident_record.sev, incident_record.status,
    incident_record.occurrence_count, was_deduplicated, was_frozen;
end;
$function$;

/* ------------------------------------------------------------- protection */

create or replace function public.freeze_project_releases(
  p_project_id uuid,
  p_reason_code text,
  p_reason text,
  p_incident_id uuid default null,
  p_automatic boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  freeze_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.can_manage_organization(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  insert into public.release_freezes (
    organization_id, project_id, reason_code, reason, incident_id, automatic, frozen_by
  )
  values (
    project_record.organization_id, p_project_id, p_reason_code, p_reason, p_incident_id,
    p_automatic, auth.uid()
  )
  on conflict do nothing
  returning id into freeze_id;

  if freeze_id is null then
    -- Already frozen. Freezing is idempotent by design.
    return false;
  end if;

  update public.projects
  set autonomous_releases_frozen = true
  where id = p_project_id;

  perform public.record_operations_audit_event(
    project_record.organization_id, p_project_id, 'freeze.activated'::public.operations_audit_kind,
    'release_freeze', freeze_id, left(p_reason, 500),
    pg_catalog.jsonb_build_object('reason_code', p_reason_code, 'automatic', p_automatic)
  );

  return true;
end;
$function$;

create or replace function public.resume_project_releases(
  p_project_id uuid,
  p_note text,
  p_acknowledge_open_incidents boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  freeze_record public.release_freezes%rowtype;
  open_severe integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  -- Resuming restores authority, so it is owner-only and never automatic.
  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may resume releases';
  end if;

  if p_note is null or char_length(btrim(p_note)) < 10 then
    raise exception using errcode = '22023', message = 'a resume note of at least 10 characters is required';
  end if;

  select count(*) into open_severe
  from public.incidents
  where project_id = p_project_id
    and sev in ('sev1', 'sev2')
    and status in ('open', 'investigating', 'mitigated');

  if open_severe > 0 and not p_acknowledge_open_incidents then
    raise exception using
      errcode = '23514',
      message = 'open SEV1/SEV2 incidents exist; resuming requires explicit acknowledgement';
  end if;

  select * into freeze_record
  from public.release_freezes
  where project_id = p_project_id and state = 'active'
  for update;

  if not found then
    return false;
  end if;

  update public.release_freezes
  set state = 'released', released_at = now(), released_by = auth.uid(), release_note = p_note
  where id = freeze_record.id;

  update public.projects
  set autonomous_releases_frozen = false
  where id = p_project_id;

  perform public.record_operations_audit_event(
    project_record.organization_id, p_project_id, 'freeze.released'::public.operations_audit_kind,
    'release_freeze', freeze_record.id, left(p_note, 500),
    pg_catalog.jsonb_build_object(
      'acknowledged_open_incidents', open_severe > 0,
      'open_severe_incidents', open_severe
    )
  );

  return true;
end;
$function$;

create or replace function public.stop_autonomous_operations(
  p_organization_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  affected integer := 0;
  project_record record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may stop autonomous operations';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception using errcode = '22023', message = 'a reason of at least 10 characters is required';
  end if;

  for project_record in
    select id from public.projects
    where organization_id = p_organization_id and status <> 'archived'
  loop
    perform public.freeze_project_releases(
      project_record.id, 'OWNER_EMERGENCY_STOP', left(p_reason, 500), null, false
    );
    affected := affected + 1;
  end loop;

  update public.projects
  set autonomous_operations_stopped = true, owner_attention_required = true
  where organization_id = p_organization_id and status <> 'archived';

  perform public.record_operations_audit_event(
    p_organization_id, null, 'operations.stopped'::public.operations_audit_kind,
    'organization', p_organization_id, left(p_reason, 500),
    pg_catalog.jsonb_build_object('projects_stopped', affected)
  );

  return affected;
end;
$function$;

/* ------------------------------------------------- deployment validation */

create or replace function public.record_deployment_validation(
  p_deployment_id uuid,
  p_state public.deployment_validation_state,
  p_checks jsonb,
  p_validator_version text,
  p_policy_version text,
  p_summary text default null,
  p_baseline_reference text default null
)
returns setof public.deployment_validations
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  deployment_record public.deployments%rowtype;
  validation_record public.deployment_validations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into deployment_record from public.deployments where id = p_deployment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'deployment not found';
  end if;

  if not public.can_manage_organization(deployment_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  insert into public.deployment_validations (
    organization_id, project_id, deployment_id, state, checks,
    validator_version, policy_version, summary, baseline_reference, completed_at
  )
  values (
    deployment_record.organization_id, deployment_record.project_id, p_deployment_id,
    p_state, coalesce(p_checks, '[]'::jsonb), p_validator_version, p_policy_version,
    p_summary, p_baseline_reference, now()
  )
  returning * into validation_record;

  perform public.record_operations_audit_event(
    deployment_record.organization_id, deployment_record.project_id,
    'validation.recorded'::public.operations_audit_kind,
    'deployment_validation', validation_record.id,
    format('Post-deploy validation %s', p_state),
    pg_catalog.jsonb_build_object('deployment_id', p_deployment_id, 'state', p_state)
  );

  return next validation_record;
end;
$function$;

create or replace function public.last_known_good_deployment(
  p_project_id uuid,
  p_environment text default 'production',
  p_before timestamptz default null
)
returns table (
  deployment_id uuid,
  commit_sha text,
  validated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select deployment.id, deployment.commit_sha, validation.completed_at
  from public.deployments deployment
  join public.deployment_validations validation
    on validation.deployment_id = deployment.id
    and validation.organization_id = deployment.organization_id
  where deployment.project_id = p_project_id
    and deployment.environment = p_environment
    and deployment.status = 'succeeded'
    and validation.state = 'passed'
    and (p_before is null or deployment.created_at < p_before)
    and public.can_access_project(p_project_id)
  order by deployment.created_at desc
  limit 1;
$function$;

comment on function public.last_known_good_deployment(uuid, text, timestamptz) is
  'Last Known Good is evidence-bound: a deployment qualifies only when it succeeded AND its own post-deploy validation passed. A provider "ready" status alone is never sufficient.';

/* -------------------------------------------------------------- rollback */

create or replace function public.record_rollback_decision(
  p_incident_id uuid,
  p_eligible boolean,
  p_blocked_reason text,
  p_eligibility jsonb,
  p_from_deployment_id uuid default null,
  p_to_deployment_id uuid default null
)
returns setof public.rollback_operations
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  incident_record public.incidents%rowtype;
  next_attempt smallint;
  rollback_record public.rollback_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into incident_record from public.incidents where id = p_incident_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'incident not found';
  end if;

  if not public.is_organization_owner(incident_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may record a rollback decision';
  end if;

  select coalesce(max(attempt), 0) + 1 into next_attempt
  from public.rollback_operations
  where incident_id = p_incident_id;

  if next_attempt > 3 then
    raise exception using errcode = '23514', message = 'the bounded rollback attempt limit was reached';
  end if;

  insert into public.rollback_operations (
    organization_id, project_id, incident_id, from_deployment_id, to_deployment_id,
    state, attempt, eligible, blocked_reason, eligibility, requested_by
  )
  values (
    incident_record.organization_id, incident_record.project_id, p_incident_id,
    p_from_deployment_id, p_to_deployment_id,
    case when p_eligible then 'evaluated'::public.rollback_state else 'blocked'::public.rollback_state end,
    next_attempt, p_eligible,
    case when p_eligible then null else coalesce(p_blocked_reason, 'INELIGIBLE') end,
    coalesce(p_eligibility, '{}'::jsonb), auth.uid()
  )
  returning * into rollback_record;

  perform public.record_operations_audit_event(
    incident_record.organization_id, incident_record.project_id,
    case when p_eligible then 'rollback.evaluated'::public.operations_audit_kind
      else 'rollback.blocked'::public.operations_audit_kind end,
    'rollback_operation', rollback_record.id,
    case when p_eligible then 'Rollback evaluated as eligible' else left(coalesce(p_blocked_reason, 'INELIGIBLE'), 500) end,
    pg_catalog.jsonb_build_object('attempt', next_attempt, 'eligible', p_eligible)
  );

  perform public.enqueue_operations_event(
    incident_record.organization_id, incident_record.project_id, 'rollback.started',
    format('rollback:%s:started', rollback_record.id),
    pg_catalog.jsonb_build_object('rollback_id', rollback_record.id, 'eligible', p_eligible)
  );

  return next rollback_record;
end;
$function$;

create or replace function public.record_rollback_outcome(
  p_rollback_id uuid,
  p_succeeded boolean,
  p_note text,
  p_validation_id uuid default null
)
returns setof public.rollback_operations
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  rollback_record public.rollback_operations%rowtype;
  incident_record public.incidents%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into rollback_record from public.rollback_operations where id = p_rollback_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'rollback operation not found';
  end if;

  if not public.is_organization_owner(rollback_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may record a rollback outcome';
  end if;

  if rollback_record.state in ('succeeded', 'failed', 'escalated', 'cancelled') then
    raise exception using errcode = '23514', message = 'this rollback already has a terminal outcome';
  end if;

  if not rollback_record.eligible then
    raise exception using errcode = '23514', message = 'an ineligible rollback cannot report an execution outcome';
  end if;

  update public.rollback_operations
  set state = case when p_succeeded then 'succeeded'::public.rollback_state else 'failed'::public.rollback_state end,
    escalated = not p_succeeded,
    outcome_note = left(p_note, 1000),
    validation_id = p_validation_id,
    completed_at = now()
  where id = p_rollback_id
  returning * into rollback_record;

  select * into incident_record from public.incidents where id = rollback_record.incident_id for update;

  if not p_succeeded then
    -- A failed rollback expands the incident. Severity escalates to SEV1 and
    -- the owner is flagged; automation stops here by policy.
    update public.incidents
    set sev = 'sev1'::public.incident_sev,
      severity = 'critical'::public.incident_severity,
      owner_attention_required = true,
      status = case when status = 'resolved' then 'investigating'::public.incident_status else status end
    where id = incident_record.id;

    update public.projects
    set owner_attention_required = true
    where id = rollback_record.project_id;

    perform public.record_operations_audit_event(
      rollback_record.organization_id, rollback_record.project_id,
      'rollback.failed'::public.operations_audit_kind,
      'rollback_operation', rollback_record.id, left(p_note, 500),
      pg_catalog.jsonb_build_object('attempt', rollback_record.attempt, 'escalated_to', 'sev1')
    );

    perform public.record_operations_audit_event(
      rollback_record.organization_id, rollback_record.project_id,
      'rollback.escalated'::public.operations_audit_kind,
      'incident', incident_record.id, 'Rollback failed; owner attention required',
      pg_catalog.jsonb_build_object('rollback_id', rollback_record.id)
    );
  end if;

  perform public.enqueue_operations_event(
    rollback_record.organization_id, rollback_record.project_id, 'rollback.completed',
    format('rollback:%s:completed', rollback_record.id),
    pg_catalog.jsonb_build_object('rollback_id', rollback_record.id, 'succeeded', p_succeeded)
  );

  perform public.evaluate_project_health(rollback_record.project_id);

  return next rollback_record;
end;
$function$;

/* ------------------------------------------------------------- diagnosis */

create or replace function public.record_production_diagnosis(
  p_incident_id uuid,
  p_likely_cause text,
  p_affected_subsystem text,
  p_confidence public.diagnosis_confidence,
  p_recommended_action text,
  p_risk_level public.risk_level,
  p_evidence jsonb,
  p_analyzer text
)
returns setof public.production_diagnoses
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  incident_record public.incidents%rowtype;
  diagnosis_record public.production_diagnoses%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into incident_record from public.incidents where id = p_incident_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'incident not found';
  end if;

  if not public.can_manage_organization(incident_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  insert into public.production_diagnoses (
    organization_id, project_id, incident_id, likely_cause, affected_subsystem,
    confidence, recommended_action, risk_level, evidence, analyzer
  )
  values (
    incident_record.organization_id, incident_record.project_id, p_incident_id,
    p_likely_cause, p_affected_subsystem, p_confidence, p_recommended_action,
    p_risk_level, coalesce(p_evidence, '[]'::jsonb), p_analyzer
  )
  returning * into diagnosis_record;

  update public.incidents
  set status = case when status = 'open' then 'investigating'::public.incident_status else status end
  where id = p_incident_id;

  perform public.record_operations_audit_event(
    incident_record.organization_id, incident_record.project_id,
    'diagnosis.recorded'::public.operations_audit_kind,
    'production_diagnosis', diagnosis_record.id, left(p_likely_cause, 500),
    pg_catalog.jsonb_build_object(
      'confidence', p_confidence, 'subsystem', p_affected_subsystem, 'risk', p_risk_level
    )
  );

  return next diagnosis_record;
end;
$function$;

/* ----------------------------------------------------------- self-healing */

create or replace function public.create_repair_attempt(
  p_incident_id uuid,
  p_diagnosis_id uuid,
  p_task_title text,
  p_task_description text,
  p_risk_level public.risk_level default 'yellow'
)
returns table (
  repair_id uuid,
  repair_attempt_number smallint,
  repair_state_value public.repair_state,
  repair_task_id uuid,
  repair_assignment_status text,
  repair_escalated boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  incident_record public.incidents%rowtype;
  next_attempt smallint;
  new_task_id uuid;
  repair_record public.repair_attempts%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into incident_record from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'incident not found';
  end if;

  if not public.can_manage_organization(incident_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  select coalesce(max(existing.attempt_number), 0) + 1 into next_attempt
  from public.repair_attempts existing
  where existing.incident_id = p_incident_id;

  if next_attempt > 3 then
    -- Bounded attempts. Repeated failure becomes an owner decision, not a loop.
    update public.incidents
    set owner_attention_required = true
    where id = p_incident_id;

    update public.projects
    set owner_attention_required = true
    where id = incident_record.project_id;

    perform public.record_operations_audit_event(
      incident_record.organization_id, incident_record.project_id,
      'repair.escalated'::public.operations_audit_kind,
      'incident', p_incident_id, 'Repair attempt limit reached; owner attention required',
      pg_catalog.jsonb_build_object('attempt_limit', 3)
    );

    raise exception using errcode = '23514', message = 'the bounded repair attempt limit was reached';
  end if;

  insert into public.tasks (
    organization_id, project_id, title, description, status, risk_level, priority,
    input, created_by
  )
  values (
    incident_record.organization_id, incident_record.project_id,
    left(p_task_title, 240), p_task_description, 'backlog'::public.task_status,
    p_risk_level, 90,
    pg_catalog.jsonb_build_object(
      'incident_id', p_incident_id,
      'origin', 'phase1e_self_healing',
      'executor', 'not_connected'
    ),
    auth.uid()
  )
  returning id into new_task_id;

  insert into public.repair_attempts (
    organization_id, project_id, incident_id, diagnosis_id, task_id, attempt_number,
    state, assignment_status, blocked_reason
  )
  values (
    incident_record.organization_id, incident_record.project_id, p_incident_id,
    p_diagnosis_id, new_task_id, next_attempt,
    'blocked'::public.repair_state, 'not_connected',
    'Codex execution is Not Connected in this phase; the repair task awaits owner action.'
  )
  returning * into repair_record;

  perform public.record_operations_audit_event(
    incident_record.organization_id, incident_record.project_id,
    'repair.created'::public.operations_audit_kind,
    'repair_attempt', repair_record.id,
    format('Repair attempt %s created', next_attempt),
    pg_catalog.jsonb_build_object('task_id', new_task_id, 'assignment_status', 'not_connected')
  );

  perform public.enqueue_operations_event(
    incident_record.organization_id, incident_record.project_id, 'repair.started',
    format('repair:%s:started', repair_record.id),
    pg_catalog.jsonb_build_object('repair_id', repair_record.id, 'attempt', next_attempt)
  );

  return query select repair_record.id, repair_record.attempt_number, repair_record.state,
    repair_record.task_id, repair_record.assignment_status, repair_record.escalated;
end;
$function$;

create or replace function public.record_repair_failure(
  p_repair_id uuid,
  p_failure_reason text
)
returns setof public.repair_attempts
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  repair_record public.repair_attempts%rowtype;
  should_escalate boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into repair_record from public.repair_attempts where id = p_repair_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'repair attempt not found';
  end if;

  if not public.can_manage_organization(repair_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  should_escalate := repair_record.attempt_number >= 3;

  update public.repair_attempts
  set state = case when should_escalate then 'escalated'::public.repair_state else 'failed'::public.repair_state end,
    failure_reason = left(p_failure_reason, 500),
    escalated = should_escalate
  where id = p_repair_id
  returning * into repair_record;

  if should_escalate then
    update public.incidents set owner_attention_required = true where id = repair_record.incident_id;
    update public.projects set owner_attention_required = true where id = repair_record.project_id;
  end if;

  perform public.record_operations_audit_event(
    repair_record.organization_id, repair_record.project_id,
    case when should_escalate then 'repair.escalated'::public.operations_audit_kind
      else 'repair.failed'::public.operations_audit_kind end,
    'repair_attempt', repair_record.id, left(p_failure_reason, 500),
    pg_catalog.jsonb_build_object('attempt', repair_record.attempt_number, 'escalated', should_escalate)
  );

  perform public.enqueue_operations_event(
    repair_record.organization_id, repair_record.project_id, 'repair.failed',
    format('repair:%s:failed', repair_record.id),
    pg_catalog.jsonb_build_object('repair_id', repair_record.id, 'escalated', should_escalate)
  );

  return next repair_record;
end;
$function$;

/* ------------------------------------------------------------- resolution */

create or replace function public.resolve_production_incident(
  p_incident_id uuid,
  p_root_cause text,
  p_corrective_action text,
  p_validation_id uuid,
  p_prevention_reference text default null
)
returns setof public.incidents
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  incident_record public.incidents%rowtype;
  validation_record public.deployment_validations%rowtype;
  failing_monitors integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into incident_record from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'incident not found';
  end if;

  if not public.can_manage_organization(incident_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  if incident_record.status in ('resolved', 'closed') then
    raise exception using errcode = '23514', message = 'this incident is already resolved';
  end if;

  -- Production must actually be restored. A successful deployment on its own
  -- is explicitly not sufficient evidence.
  select count(*) into failing_monitors
  from public.production_monitors monitor
  where monitor.project_id = incident_record.project_id
    and monitor.enabled
    and monitor.last_outcome = 'fail'
    and monitor.consecutive_failures >= monitor.failure_threshold;

  if failing_monitors > 0 then
    raise exception using
      errcode = '23514',
      message = 'production is still failing its own monitors; the incident cannot be resolved';
  end if;

  if p_validation_id is null then
    raise exception using errcode = '22023', message = 'a passing validation record is required to resolve an incident';
  end if;

  select * into validation_record
  from public.deployment_validations
  where id = p_validation_id and organization_id = incident_record.organization_id;

  if not found or validation_record.state <> 'passed' then
    raise exception using errcode = '23514', message = 'the referenced validation did not pass';
  end if;

  if validation_record.project_id <> incident_record.project_id then
    raise exception using errcode = '23514', message = 'the validation belongs to a different project';
  end if;

  if p_root_cause is null or char_length(btrim(p_root_cause)) < 10 then
    raise exception using errcode = '22023', message = 'a recorded root cause is required';
  end if;

  if p_corrective_action is null or char_length(btrim(p_corrective_action)) < 10 then
    raise exception using errcode = '22023', message = 'a recorded corrective action is required';
  end if;

  if incident_record.sev in ('sev1', 'sev2')
    and (p_prevention_reference is null or char_length(btrim(p_prevention_reference)) = 0) then
    raise exception using
      errcode = '22023',
      message = 'SEV1 and SEV2 incidents require a recorded prevention or follow-up reference';
  end if;

  update public.incidents
  set status = 'resolved'::public.incident_status,
    resolved_at = now(),
    root_cause = p_root_cause,
    corrective_action = p_corrective_action,
    prevention_reference = p_prevention_reference,
    resolution_validation_id = p_validation_id,
    owner_attention_required = false
  where id = p_incident_id
  returning * into incident_record;

  perform public.record_operations_audit_event(
    incident_record.organization_id, incident_record.project_id,
    'incident.resolved'::public.operations_audit_kind,
    'incident', incident_record.id, left(p_root_cause, 500),
    pg_catalog.jsonb_build_object(
      'validation_id', p_validation_id,
      'prevention_reference', p_prevention_reference is not null
    )
  );

  perform public.enqueue_operations_event(
    incident_record.organization_id, incident_record.project_id, 'incident.resolved',
    format('incident:%s:resolved', incident_record.id),
    pg_catalog.jsonb_build_object('incident_id', incident_record.id)
  );

  perform public.evaluate_project_health(incident_record.project_id);

  return next incident_record;
end;
$function$;

/* --------------------------------------------------------- event handling */

create or replace function public.claim_operations_event(p_organization_id uuid)
returns setof public.operations_events
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  event_record public.operations_events%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  select * into event_record
  from public.operations_events
  where organization_id = p_organization_id
    and state = 'pending'
    and available_at <= now()
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.operations_events
  set state = 'processing', claimed_at = now(), attempts = event_record.attempts + 1
  where id = event_record.id
  returning * into event_record;

  return next event_record;
end;
$function$;

create or replace function public.complete_operations_event(
  p_event_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns setof public.operations_events
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  event_record public.operations_events%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into event_record from public.operations_events where id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'operations event not found';
  end if;

  if not public.can_manage_organization(event_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  if event_record.state = 'processed' then
    -- Idempotent completion: replaying a delivery never double-processes.
    return next event_record;
  end if;

  if p_succeeded then
    update public.operations_events
    set state = 'processed', processed_at = now(), last_error = null
    where id = p_event_id
    returning * into event_record;
  elsif event_record.attempts >= event_record.max_attempts then
    update public.operations_events
    set state = 'dead_letter', last_error = left(p_error, 500)
    where id = p_event_id
    returning * into event_record;
  else
    update public.operations_events
    set state = 'pending',
      last_error = left(p_error, 500),
      available_at = now() + (interval '30 seconds' * event_record.attempts)
    where id = p_event_id
    returning * into event_record;
  end if;

  perform public.record_operations_audit_event(
    event_record.organization_id, event_record.project_id,
    'event.processed'::public.operations_audit_kind,
    'operations_event', event_record.id,
    format('Event %s is %s', event_record.event_type, event_record.state),
    pg_catalog.jsonb_build_object('succeeded', p_succeeded, 'attempts', event_record.attempts)
  );

  return next event_record;
end;
$function$;

/* ----------------------------------------------------- bounded list reads */

create or replace function public.list_production_monitors(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  name text,
  signal_kind public.production_signal_kind,
  provider text,
  target_url text,
  profile public.synthetic_profile,
  connection_state public.monitor_connection_state,
  unavailable_reason text,
  enabled boolean,
  last_outcome public.signal_outcome,
  last_observed_at timestamptz,
  consecutive_failures smallint,
  failure_threshold smallint
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select monitor.id, monitor.project_id, project.name, monitor.name, monitor.signal_kind,
    monitor.provider, monitor.target_url, monitor.profile, monitor.connection_state,
    monitor.unavailable_reason, monitor.enabled, monitor.last_outcome,
    monitor.last_observed_at, monitor.consecutive_failures, monitor.failure_threshold
  from public.production_monitors monitor
  join public.projects project
    on project.id = monitor.project_id and project.organization_id = monitor.organization_id
  where monitor.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by project.name asc, monitor.name asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_production_incidents(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  title text,
  sev public.incident_sev,
  status public.incident_status,
  source public.production_signal_kind,
  symptoms text,
  impact text,
  occurrence_count integer,
  detected_at timestamptz,
  last_signal_at timestamptz,
  resolved_at timestamptz,
  owner_attention_required boolean,
  root_cause text,
  corrective_action text,
  auto_created boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select incident.id, incident.project_id, project.name, incident.title, incident.sev,
    incident.status, incident.source, left(incident.symptoms, 1000), left(incident.impact, 1000),
    incident.occurrence_count, incident.detected_at, incident.last_signal_at,
    incident.resolved_at, incident.owner_attention_required,
    left(incident.root_cause, 1000), left(incident.corrective_action, 1000), incident.auto_created
  from public.incidents incident
  join public.projects project
    on project.id = incident.project_id and project.organization_id = incident.organization_id
  where incident.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by incident.detected_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_operations_projects(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  status public.project_status,
  health_state public.project_health_state,
  health_reason text,
  health_computed_at timestamptz,
  releases_frozen boolean,
  operations_stopped boolean,
  owner_attention_required boolean,
  connected_monitors bigint,
  open_incidents bigint
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select project.id, project.name, project.status, project.operations_health_state,
    project.operations_health_reason, project.operations_health_computed_at,
    project.autonomous_releases_frozen, project.autonomous_operations_stopped,
    project.owner_attention_required,
    (select count(*) from public.production_monitors monitor
      where monitor.project_id = project.id and monitor.enabled
        and monitor.connection_state = 'connected'),
    (select count(*) from public.incidents incident
      where incident.project_id = project.id
        and incident.status in ('open', 'investigating', 'mitigated'))
  from public.projects project
  where project.organization_id = p_organization_id
    and project.status <> 'archived'
    and public.is_organization_member(p_organization_id)
  order by project.name asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_operations_audit_events(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  project_id uuid,
  kind public.operations_audit_kind,
  entity_type text,
  entity_id uuid,
  summary text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select event.id, event.project_id, event.kind, event.entity_type, event.entity_id,
    left(event.summary, 500), event.created_at
  from public.operations_audit_events event
  where event.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by event.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.operations_portfolio_summary(p_organization_id uuid)
returns table (
  projects_total bigint,
  projects_healthy bigint,
  projects_degraded bigint,
  projects_critical bigint,
  projects_unknown bigint,
  projects_paused bigint,
  projects_frozen bigint,
  open_incidents bigint,
  open_sev1 bigint,
  open_sev2 bigint,
  incidents_resolved_24h bigint,
  failed_deployments_24h bigint,
  rollbacks_24h bigint,
  failed_rollbacks_24h bigint,
  repairs_open bigint,
  owner_attention bigint,
  connected_monitors bigint,
  pending_events bigint
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived'),
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived' and p.operations_health_state = 'healthy'),
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived' and p.operations_health_state = 'degraded'),
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived' and p.operations_health_state = 'critical'),
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived' and p.operations_health_state = 'unknown'),
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived' and p.operations_health_state = 'paused'),
    (select count(*) from public.projects p where p.organization_id = p_organization_id and p.status <> 'archived' and p.autonomous_releases_frozen),
    (select count(*) from public.incidents i where i.organization_id = p_organization_id and i.status in ('open', 'investigating', 'mitigated')),
    (select count(*) from public.incidents i where i.organization_id = p_organization_id and i.status in ('open', 'investigating', 'mitigated') and i.sev = 'sev1'),
    (select count(*) from public.incidents i where i.organization_id = p_organization_id and i.status in ('open', 'investigating', 'mitigated') and i.sev = 'sev2'),
    (select count(*) from public.incidents i where i.organization_id = p_organization_id and i.resolved_at is not null and i.resolved_at > now() - interval '24 hours'),
    (select count(*) from public.deployments d where d.organization_id = p_organization_id and d.status = 'failed' and d.created_at > now() - interval '24 hours'),
    (select count(*) from public.rollback_operations r where r.organization_id = p_organization_id and r.created_at > now() - interval '24 hours'),
    (select count(*) from public.rollback_operations r where r.organization_id = p_organization_id and r.state = 'failed' and r.created_at > now() - interval '24 hours'),
    (select count(*) from public.repair_attempts ra where ra.organization_id = p_organization_id and ra.state in ('created', 'blocked', 'assigned', 'in_progress')),
    (select count(*) from public.incidents i where i.organization_id = p_organization_id and i.owner_attention_required),
    (select count(*) from public.production_monitors m where m.organization_id = p_organization_id and m.enabled and m.connection_state = 'connected'),
    (select count(*) from public.operations_events e where e.organization_id = p_organization_id and e.state = 'pending')
  where public.is_organization_member(p_organization_id);
$function$;

/* -------------------------------------------------------------- reporting */

create or replace function public.generate_operations_report(
  p_organization_id uuid,
  p_period_hours integer default 24
)
returns setof public.reports
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  period_start timestamptz;
  report_content jsonb;
  report_record public.reports%rowtype;
  recurring jsonb;
  frozen jsonb;
  decisions jsonb;
  risks jsonb;
  hours integer := greatest(1, least(coalesce(p_period_hours, 24), 168));
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  period_start := now() - make_interval(hours => hours);

  -- Recurring failures are the fingerprints that came back, not merely the
  -- incidents that were noisy once.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'fingerprint', incident.fingerprint,
      'project_id', incident.project_id,
      'occurrences', incident.occurrence_count,
      'sev', incident.sev
    )
  ), '[]'::jsonb)
  into recurring
  from public.incidents incident
  where incident.organization_id = p_organization_id
    and incident.fingerprint is not null
    and incident.occurrence_count > 1
    and incident.detected_at >= period_start;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'project_id', release_freeze.project_id,
      'reason_code', release_freeze.reason_code,
      'automatic', release_freeze.automatic,
      'frozen_at', release_freeze.frozen_at
    )
  ), '[]'::jsonb)
  into frozen
  from public.release_freezes release_freeze
  where release_freeze.organization_id = p_organization_id
    and release_freeze.state = 'active';

  -- Owner decisions are the recorded ones only: resumes, emergency stops, and
  -- rollback determinations.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'kind', event.kind,
      'summary', left(event.summary, 200),
      'created_at', event.created_at
    )
  ), '[]'::jsonb)
  into decisions
  from public.operations_audit_events event
  where event.organization_id = p_organization_id
    and event.created_at >= period_start
    and event.kind in (
      'freeze.released'::public.operations_audit_kind,
      'operations.stopped'::public.operations_audit_kind,
      'rollback.evaluated'::public.operations_audit_kind,
      'rollback.blocked'::public.operations_audit_kind
    );

  select coalesce(pg_catalog.jsonb_agg(risk), '[]'::jsonb)
  into risks
  from (
    select pg_catalog.jsonb_build_object(
      'project_id', project.id,
      'project', project.name,
      'health', project.operations_health_state,
      'reason', left(coalesce(project.operations_health_reason, 'No evidence recorded.'), 300)
    ) as risk
    from public.projects project
    where project.organization_id = p_organization_id
      and project.status <> 'archived'
      and project.operations_health_state in ('critical', 'degraded', 'unknown')
    order by project.operations_health_state, project.name
    limit 10
  ) top_risks;

  select pg_catalog.jsonb_build_object(
    'policy_version', 'phase1e-operations-v1',
    'period_hours', hours,
    'portfolio', (
      select pg_catalog.jsonb_build_object(
        'total', count(*),
        'healthy', count(*) filter (where project.operations_health_state = 'healthy'),
        'degraded', count(*) filter (where project.operations_health_state = 'degraded'),
        'critical', count(*) filter (where project.operations_health_state = 'critical'),
        'unknown', count(*) filter (where project.operations_health_state = 'unknown'),
        'paused', count(*) filter (where project.operations_health_state = 'paused')
      )
      from public.projects project
      where project.organization_id = p_organization_id and project.status <> 'archived'
    ),
    'incidents', (
      select pg_catalog.jsonb_build_object(
        'opened', count(*) filter (where incident.detected_at >= period_start),
        'resolved', count(*) filter (where incident.resolved_at >= period_start),
        'open_now', count(*) filter (where incident.status in ('open', 'investigating', 'mitigated')),
        'sev1_open', count(*) filter (
          where incident.sev = 'sev1' and incident.status in ('open', 'investigating', 'mitigated')
        )
      )
      from public.incidents incident
      where incident.organization_id = p_organization_id
    ),
    'unavailability', (
      -- Downtime is reported as observed failing checks, not as an estimate.
      select pg_catalog.jsonb_build_object(
        'failing_observations', count(*) filter (where observation.outcome = 'fail'),
        'degraded_observations', count(*) filter (where observation.outcome = 'degraded'),
        'total_observations', count(*)
      )
      from public.monitor_observations observation
      where observation.organization_id = p_organization_id
        and observation.observed_at >= period_start
    ),
    'deployments', (
      select pg_catalog.jsonb_build_object(
        'failed', count(*) filter (where deployment.status = 'failed'),
        'succeeded', count(*) filter (where deployment.status = 'succeeded')
      )
      from public.deployments deployment
      where deployment.organization_id = p_organization_id
        and deployment.created_at >= period_start
    ),
    'rollbacks', (
      select pg_catalog.jsonb_build_object(
        'recorded', count(*),
        'blocked', count(*) filter (where rollback_operation.state = 'blocked'),
        'failed', count(*) filter (where rollback_operation.state = 'failed'),
        'executed', 0,
        'executor', 'not_connected'
      )
      from public.rollback_operations rollback_operation
      where rollback_operation.organization_id = p_organization_id
        and rollback_operation.created_at >= period_start
    ),
    'repairs', (
      select pg_catalog.jsonb_build_object(
        'created', count(*),
        'escalated', count(*) filter (where repair.escalated),
        'executor', 'not_connected'
      )
      from public.repair_attempts repair
      where repair.organization_id = p_organization_id
        and repair.created_at >= period_start
    ),
    'recurring_failures', recurring,
    'frozen_projects', frozen,
    'owner_decisions', decisions,
    'top_operational_risks', risks
  )
  into report_content;

  insert into public.reports (
    organization_id, type, status, title, summary, content, period_start, period_end, published_at
  )
  values (
    p_organization_id,
    'daily_ceo'::public.report_type,
    'published'::public.report_status,
    format('Daily operations report (%s hours)', hours),
    format(
      '%s open incident(s), %s frozen project(s), %s rollback decision(s) recorded. No deployment, rollback, or repair was executed: those executors are Not Connected.',
      report_content -> 'incidents' ->> 'open_now',
      pg_catalog.jsonb_array_length(frozen),
      report_content -> 'rollbacks' ->> 'recorded'
    ),
    report_content,
    period_start,
    now(),
    now()
  )
  returning * into report_record;

  perform public.record_operations_audit_event(
    p_organization_id, null, 'event.processed'::public.operations_audit_kind,
    'report', report_record.id, 'Daily operations report generated',
    pg_catalog.jsonb_build_object('period_hours', hours)
  );

  return next report_record;
end;
$function$;

comment on function public.generate_operations_report(uuid, integer) is
  'Builds the daily operational report from recorded evidence only. Downtime is reported as observed failing checks, never as an estimate, and executed rollbacks are always zero while no executor is connected.';

/* ------------------------------------------------------ execution boundary */

create or replace function public.autonomous_release_allowed(p_project_id uuid)
returns table (allowed boolean, blockers text[])
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  found_blockers text[] := array[]::text[];
  kill_switch boolean;
begin
  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.can_access_project(p_project_id) then
    raise exception using errcode = '42501', message = 'project access is required';
  end if;

  select organization.autonomy_kill_switch_active into kill_switch
  from public.organizations organization
  where organization.id = project_record.organization_id;

  if kill_switch then
    found_blockers := found_blockers || 'GLOBAL_KILL_SWITCH_ACTIVE'::text;
  end if;
  if project_record.autonomous_releases_frozen then
    found_blockers := found_blockers || 'RELEASE_FREEZE_ACTIVE'::text;
  end if;
  if project_record.autonomous_operations_stopped then
    found_blockers := found_blockers || 'OWNER_STOPPED_OPERATIONS'::text;
  end if;
  if not project_record.autonomous_mode then
    found_blockers := found_blockers || 'AUTONOMOUS_MODE_OFF'::text;
  end if;

  -- There is no deployment or rollback executor in this phase, and this
  -- blocker is unconditional so no configuration change can remove it.
  found_blockers := found_blockers || 'EXECUTOR_NOT_CONNECTED'::text;

  return query select false, found_blockers;
end;
$function$;

comment on function public.autonomous_release_allowed(uuid) is
  'Always returns false. It enumerates the live blockers so the UI can explain why autonomous release authority does not exist, and it can never return true while EXECUTOR_NOT_CONNECTED is unconditional.';

/* ------------------------------------------------------------ privileges */

revoke all on function public.reject_operations_record_mutation() from public, anon, authenticated, service_role;
revoke all on function public.record_operations_audit_event(uuid, uuid, public.operations_audit_kind, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_operations_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.evaluate_project_health(uuid) from public, anon, service_role;
revoke all on function public.classify_production_severity(public.production_signal_kind, boolean, boolean, boolean, integer) from public, anon, service_role;
revoke all on function public.incident_sev_to_severity(public.incident_sev) from public, anon, service_role;
revoke all on function public.configure_production_monitor(uuid, text, public.production_signal_kind, text, text, public.synthetic_profile, smallint, integer, smallint, boolean) from public, anon, service_role;
revoke all on function public.record_monitor_observation(uuid, public.signal_outcome, integer, smallint, text, jsonb) from public, anon, service_role;
revoke all on function public.open_production_incident(uuid, text, text, public.incident_sev, public.production_signal_kind, text, text, uuid, uuid, text, jsonb) from public, anon, service_role;
revoke all on function public.freeze_project_releases(uuid, text, text, uuid, boolean) from public, anon, service_role;
revoke all on function public.resume_project_releases(uuid, text, boolean) from public, anon, service_role;
revoke all on function public.stop_autonomous_operations(uuid, text) from public, anon, service_role;
revoke all on function public.record_deployment_validation(uuid, public.deployment_validation_state, jsonb, text, text, text, text) from public, anon, service_role;
revoke all on function public.last_known_good_deployment(uuid, text, timestamptz) from public, anon, service_role;
revoke all on function public.record_rollback_decision(uuid, boolean, text, jsonb, uuid, uuid) from public, anon, service_role;
revoke all on function public.record_rollback_outcome(uuid, boolean, text, uuid) from public, anon, service_role;
revoke all on function public.record_production_diagnosis(uuid, text, text, public.diagnosis_confidence, text, public.risk_level, jsonb, text) from public, anon, service_role;
revoke all on function public.create_repair_attempt(uuid, uuid, text, text, public.risk_level) from public, anon, service_role;
revoke all on function public.record_repair_failure(uuid, text) from public, anon, service_role;
revoke all on function public.resolve_production_incident(uuid, text, text, uuid, text) from public, anon, service_role;
revoke all on function public.claim_operations_event(uuid) from public, anon, service_role;
revoke all on function public.complete_operations_event(uuid, boolean, text) from public, anon, service_role;
revoke all on function public.list_production_monitors(uuid, integer) from public, anon, service_role;
revoke all on function public.list_production_incidents(uuid, integer) from public, anon, service_role;
revoke all on function public.list_operations_projects(uuid, integer) from public, anon, service_role;
revoke all on function public.list_operations_audit_events(uuid, integer) from public, anon, service_role;
revoke all on function public.operations_portfolio_summary(uuid) from public, anon, service_role;
revoke all on function public.autonomous_release_allowed(uuid) from public, anon, service_role;
revoke all on function public.generate_operations_report(uuid, integer) from public, anon, service_role;

grant execute on function public.classify_production_severity(public.production_signal_kind, boolean, boolean, boolean, integer) to authenticated;
grant execute on function public.incident_sev_to_severity(public.incident_sev) to authenticated;
grant execute on function public.evaluate_project_health(uuid) to authenticated;
grant execute on function public.configure_production_monitor(uuid, text, public.production_signal_kind, text, text, public.synthetic_profile, smallint, integer, smallint, boolean) to authenticated;
grant execute on function public.record_monitor_observation(uuid, public.signal_outcome, integer, smallint, text, jsonb) to authenticated;
grant execute on function public.open_production_incident(uuid, text, text, public.incident_sev, public.production_signal_kind, text, text, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.freeze_project_releases(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.resume_project_releases(uuid, text, boolean) to authenticated;
grant execute on function public.stop_autonomous_operations(uuid, text) to authenticated;
grant execute on function public.record_deployment_validation(uuid, public.deployment_validation_state, jsonb, text, text, text, text) to authenticated;
grant execute on function public.last_known_good_deployment(uuid, text, timestamptz) to authenticated;
grant execute on function public.record_rollback_decision(uuid, boolean, text, jsonb, uuid, uuid) to authenticated;
grant execute on function public.record_rollback_outcome(uuid, boolean, text, uuid) to authenticated;
grant execute on function public.record_production_diagnosis(uuid, text, text, public.diagnosis_confidence, text, public.risk_level, jsonb, text) to authenticated;
grant execute on function public.create_repair_attempt(uuid, uuid, text, text, public.risk_level) to authenticated;
grant execute on function public.record_repair_failure(uuid, text) to authenticated;
grant execute on function public.resolve_production_incident(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.claim_operations_event(uuid) to authenticated;
grant execute on function public.complete_operations_event(uuid, boolean, text) to authenticated;
grant execute on function public.list_production_monitors(uuid, integer) to authenticated;
grant execute on function public.list_production_incidents(uuid, integer) to authenticated;
grant execute on function public.list_operations_projects(uuid, integer) to authenticated;
grant execute on function public.list_operations_audit_events(uuid, integer) to authenticated;
grant execute on function public.operations_portfolio_summary(uuid) to authenticated;
grant execute on function public.autonomous_release_allowed(uuid) to authenticated;
grant execute on function public.generate_operations_report(uuid, integer) to authenticated;
