-- Phase 2A provider execution layer.
--
-- Adds the multi-provider model catalogue, immutable routing evidence, and
-- append-only provider run events, and extends agent runs with the provider,
-- model, usage, and routing columns an auditable run needs.
--
-- Scope boundary: nothing here merges, deploys, approves, or writes to a
-- repository. A provider run records an advisory artifact. Externally
-- mutating provider execution is additionally gated by a per-organization
-- switch that defaults OFF.

-- Owner-controlled switch for spending money at an external AI provider.
-- Defaults OFF so a configured credential alone never authorizes a run.
alter table public.organizations
  add column ai_provider_execution_enabled boolean not null default false;

comment on column public.organizations.ai_provider_execution_enabled is
  'Owner switch for outbound AI provider execution. Defaults OFF; a present credential is not consent to spend.';

-- ---------------------------------------------------------------------------
-- Model catalogue
-- ---------------------------------------------------------------------------

create table public.provider_model_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.connection_provider not null,
  model text not null check (
    char_length(btrim(model)) between 1 and 128
    and model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  capabilities jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  is_default boolean not null default false,
  -- Declared reference prices in micro-USD per million tokens. Null means the
  -- organization has not declared a price; it never means free.
  input_cost_per_million_micros bigint check (
    input_cost_per_million_micros is null or input_cost_per_million_micros >= 0
  ),
  output_cost_per_million_micros bigint check (
    output_cost_per_million_micros is null or output_cost_per_million_micros >= 0
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_model_configurations_id_organization_unique unique (id, organization_id),
  constraint provider_model_configurations_org_provider_model_unique
    unique (organization_id, provider, model),
  constraint provider_model_configurations_ai_provider_only
    check (provider in ('openai'::public.connection_provider, 'anthropic'::public.connection_provider)),
  constraint provider_model_configurations_capabilities_array
    check (jsonb_typeof(capabilities) = 'array'),
  constraint provider_model_configurations_capabilities_no_sensitive_data
    check (not public.jsonb_has_sensitive_keys(capabilities))
);

comment on table public.provider_model_configurations is
  'Per-organization AI model catalogue. Holds only non-secret metadata; credentials stay in server-side environment settings.';

create unique index provider_model_configurations_single_default
  on public.provider_model_configurations (organization_id, provider)
  where is_default;

create index provider_model_configurations_org_provider_idx
  on public.provider_model_configurations (organization_id, provider, enabled);

-- Provider preference is routing metadata, not logical-agent identity. Keep it
-- in a separate tenant-bound record so assigning Claude/OpenAI cannot mutate
-- the provider-neutral roster consumed by the Phase 1C planner.
create table public.provider_agent_assignments (
  agent_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.connection_provider not null,
  model text check (
    model is null or (
      char_length(btrim(model)) between 1 and 120
      and model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_agent_assignments_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint provider_agent_assignments_ai_provider_only
    check (provider in ('openai'::public.connection_provider, 'anthropic'::public.connection_provider))
);

comment on table public.provider_agent_assignments is
  'Optional provider/model routing preference for a provider-neutral logical agent. Contains no credential material.';

create index provider_agent_assignments_org_provider_idx
  on public.provider_agent_assignments (organization_id, provider);

-- ---------------------------------------------------------------------------
-- Routing evidence
-- ---------------------------------------------------------------------------

create table public.provider_routing_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  task_id uuid,
  agent_id uuid,
  task_kind text not null check (
    task_kind in (
      'plan', 'architecture_review', 'implementation_proposal',
      'implementation_review', 'security_review', 'qa_assessment', 'status_report'
    )
  ),
  risk_level public.risk_level not null,
  requested_provider text not null check (requested_provider in ('AUTO', 'ANTHROPIC', 'OPENAI')),
  decision text not null check (
    decision in ('ROUTED', 'NO_PROVIDER_AVAILABLE', 'BLOCKED_BY_RISK_POLICY')
  ),
  source text check (
    source is null or source in (
      'OWNER_OVERRIDE', 'AGENT_ASSIGNMENT', 'PROJECT_DEFAULT', 'AUTO_SCORE', 'FALLBACK'
    )
  ),
  selected_provider public.connection_provider,
  selected_model text check (
    selected_model is null or char_length(btrim(selected_model)) between 1 and 128
  ),
  fallback_from_provider public.connection_provider,
  policy_version text not null check (char_length(btrim(policy_version)) between 1 and 64),
  reasons jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint provider_routing_decisions_id_organization_unique unique (id, organization_id),
  constraint provider_routing_decisions_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint provider_routing_decisions_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete cascade,
  constraint provider_routing_decisions_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete restrict,
  constraint provider_routing_decisions_reasons_array check (jsonb_typeof(reasons) = 'array'),
  constraint provider_routing_decisions_candidates_array check (jsonb_typeof(candidates) = 'array'),
  constraint provider_routing_decisions_reasons_no_sensitive_data
    check (not public.jsonb_has_sensitive_keys(reasons)),
  constraint provider_routing_decisions_candidates_no_sensitive_data
    check (not public.jsonb_has_sensitive_keys(candidates)),
  -- A routed decision must name what it routed to; a blocked one must not.
  constraint provider_routing_decisions_routed_target check (
    (decision = 'ROUTED' and selected_provider is not null and selected_model is not null and source is not null)
    or (decision <> 'ROUTED' and selected_provider is null and selected_model is null)
  )
);

comment on table public.provider_routing_decisions is
  'Immutable evidence of why a task was routed to a provider and model, including scored candidates and structured reasons.';

create index provider_routing_decisions_project_created_idx
  on public.provider_routing_decisions (project_id, created_at desc);
create index provider_routing_decisions_org_provider_idx
  on public.provider_routing_decisions (organization_id, selected_provider, created_at desc);

-- ---------------------------------------------------------------------------
-- Agent run provider columns
-- ---------------------------------------------------------------------------

alter table public.agent_runs
  add column provider text check (provider is null or provider in ('anthropic', 'openai')),
  add column model text check (model is null or char_length(btrim(model)) between 1 and 120),
  add column task_kind text check (
    task_kind is null or task_kind in (
      'plan', 'architecture_review', 'implementation_proposal',
      'implementation_review', 'security_review', 'qa_assessment', 'status_report'
    )
  ),
  add column usage jsonb not null default '{}'::jsonb,
  add column latency_ms integer check (latency_ms is null or latency_ms >= 0),
  add column routing_decision_id uuid,
  add column fallback_from_provider public.connection_provider,
  add column cancelled_at timestamptz;

alter table public.agent_runs
  add constraint agent_runs_routing_decision_fk
    foreign key (routing_decision_id, organization_id)
    references public.provider_routing_decisions(id, organization_id) on delete set null,
  add constraint agent_runs_usage_object
    check (usage is null or jsonb_typeof(usage) = 'object'),
  add constraint agent_runs_usage_no_sensitive_data
    check (usage is null or not public.jsonb_has_sensitive_keys(usage)),
  add constraint agent_runs_cancelled_at_consistent
    check (cancelled_at is null or status = 'cancelled'::public.run_status);

comment on column public.agent_runs.provider is
  'The AI provider that executed the run. Separate from the logical agent, which is a role and never a provider account.';

create index agent_runs_provider_created_idx
  on public.agent_runs (organization_id, provider, created_at desc)
  where provider is not null;

-- ---------------------------------------------------------------------------
-- Append-only provider run events
-- ---------------------------------------------------------------------------

create table public.provider_run_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_run_id uuid not null,
  sequence integer not null check (sequence between 1 and 1000),
  event_type text not null check (
    event_type in (
      'run_created', 'request_sent', 'response_received',
      'run_succeeded', 'run_failed', 'run_cancelled'
    )
  ),
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint provider_run_events_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete cascade,
  constraint provider_run_events_run_sequence_unique unique (agent_run_id, sequence),
  constraint provider_run_events_message_no_likely_secret
    check (not public.text_has_likely_secret(message))
);

comment on table public.provider_run_events is
  'Append-only provider run trace. Messages are redacted summaries, never prompts, responses, or credentials.';

create index provider_run_events_run_sequence_idx
  on public.provider_run_events (agent_run_id, sequence);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.provider_model_configurations enable row level security;
alter table public.provider_model_configurations force row level security;
alter table public.provider_agent_assignments enable row level security;
alter table public.provider_agent_assignments force row level security;
alter table public.provider_routing_decisions enable row level security;
alter table public.provider_routing_decisions force row level security;
alter table public.provider_run_events enable row level security;
alter table public.provider_run_events force row level security;

create policy provider_model_configurations_select_members
  on public.provider_model_configurations for select to authenticated
  using (public.is_organization_member(organization_id));

create policy provider_agent_assignments_select_members
  on public.provider_agent_assignments for select to authenticated
  using (public.is_organization_member(organization_id));

create policy provider_routing_decisions_select_members
  on public.provider_routing_decisions for select to authenticated
  using (public.is_organization_member(organization_id));

create policy provider_run_events_select_members
  on public.provider_run_events for select to authenticated
  using (public.is_organization_member(organization_id));

-- Writes travel exclusively through the audited functions below, matching the
-- boundary established for every other control-plane table.
revoke all on table public.provider_model_configurations from public, anon, authenticated, service_role;
revoke all on table public.provider_agent_assignments from public, anon, authenticated, service_role;
revoke all on table public.provider_routing_decisions from public, anon, authenticated, service_role;
revoke all on table public.provider_run_events from public, anon, authenticated, service_role;

grant select on table public.provider_model_configurations to authenticated;
grant select on table public.provider_routing_decisions to authenticated;
grant select on table public.provider_run_events to authenticated;

-- ---------------------------------------------------------------------------
-- Owner and administrator workflows
-- ---------------------------------------------------------------------------

-- A logical agent name identifies a role within one organization, so seeding
-- the roster twice must be a no-op rather than a duplicate roster.
-- Seed the standard logical agent roster for an organization. Agents are
-- roles; this never creates or references a provider account.
create or replace function public.ensure_default_agents(p_organization_id uuid)
returns setof public.agents
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  seed record;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  -- Serialize concurrent idempotent setup without imposing a global name
  -- uniqueness rule on user-created logical agents.
  perform organization.id from public.organizations organization
  where organization.id = p_organization_id
  for update;

  for seed in
    select *
    from (
      values
        ('Orchestrator', 'orchestrator'::public.agent_role, 'Plans work, routes it to a provider, and enforces policy gates.'),
        ('Product Manager', 'product'::public.agent_role, 'Turns outcomes into scoped requirements and acceptance criteria.'),
        ('Architect', 'custom'::public.agent_role, 'Assesses architecture, boundaries, and failure modes.'),
        ('Frontend Engineer', 'frontend'::public.agent_role, 'Proposes accessible, responsive interface changes.'),
        ('Backend Engineer', 'backend'::public.agent_role, 'Proposes API, validation, and server-side changes.'),
        ('Database Engineer', 'database'::public.agent_role, 'Owns schema quality, migrations, RLS, and query performance.'),
        ('QA Engineer', 'qa'::public.agent_role, 'Assesses coverage, validation, and release evidence.'),
        ('Security Reviewer', 'security'::public.agent_role, 'Reviews threat boundaries, sensitive changes, and secret handling.'),
        ('Performance Analyst', 'custom'::public.agent_role, 'Assesses latency, cost, and resource behavior.'),
        ('Release Controller', 'release'::public.agent_role, 'Coordinates validation, readiness, and rollback evidence.'),
        ('CEO Reporter', 'ceo_reporter'::public.agent_role, 'Summarizes outcomes, blockers, and owner decisions.')
    ) as roster(agent_name, agent_role, agent_description)
  loop
    insert into public.agents (organization_id, name, role, description, status, capabilities, created_by)
    select
      p_organization_id, seed.agent_name, seed.agent_role, seed.agent_description,
      'idle'::public.agent_status, '[]'::jsonb, caller_id
    where not exists (
      select 1 from public.agents agent
      where agent.organization_id = p_organization_id
        and agent.project_id is null
        and agent.name = seed.agent_name
        and agent.role = seed.agent_role
        and agent.provider is null
        and agent.model is null
    );
  end loop;

  return query
    select agent.*
    from public.agents agent
    where agent.organization_id = p_organization_id
    order by agent.created_at, agent.name;
end;
$function$;

-- Bind a logical agent to a provider and model, or clear the binding so the
-- agent falls back to project policy and automatic routing.
create or replace function public.set_agent_provider_assignment(
  p_agent_id uuid,
  p_provider text default null,
  p_model text default null
)
returns table (id uuid, name text, provider text, model text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  agent_record public.agents%rowtype;
  normalized_provider public.connection_provider;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select agent.* into agent_record
  from public.agents agent
  where agent.id = p_agent_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'agent not found';
  end if;
  if not public.can_manage_organization(agent_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  if p_provider is null then
    if p_model is not null then
      raise exception using errcode = '22023', message = 'a model cannot be assigned without a provider';
    end if;

    delete from public.provider_agent_assignments assignment
    where assignment.agent_id = p_agent_id
      and assignment.organization_id = agent_record.organization_id;
  else
    if p_provider not in ('anthropic', 'openai') then
      raise exception using errcode = '22023', message = 'provider must be anthropic or openai';
    end if;
    normalized_provider := p_provider::public.connection_provider;

    if p_model is not null and not exists (
      select 1
      from public.provider_model_configurations configuration
      where configuration.organization_id = agent_record.organization_id
        and configuration.provider = normalized_provider
        and configuration.model = p_model
        and configuration.enabled
    ) then
      raise exception using errcode = '23514',
        message = 'the model is not an enabled configuration for this organization and provider';
    end if;

    insert into public.provider_agent_assignments (
      agent_id, organization_id, provider, model, created_by
    ) values (
      p_agent_id, agent_record.organization_id, normalized_provider, p_model, auth.uid()
    )
    on conflict (agent_id) do update set
      provider = excluded.provider,
      model = excluded.model,
      updated_at = now();
  end if;

  perform public.record_activity_event(
    agent_record.organization_id,
    agent_record.project_id,
    'connection.changed'::public.activity_event_type,
    'agent_provider_assignment',
    p_agent_id,
    format('Agent %s provider assignment set to %s.', agent_record.name, coalesce(p_provider, 'automatic routing')),
    jsonb_build_object('provider', p_provider, 'model', p_model)
  );

  return query
    select agent.id, agent.name, assignment.provider::text, assignment.model
    from public.agents agent
    left join public.provider_agent_assignments assignment
      on assignment.agent_id = agent.id
      and assignment.organization_id = agent.organization_id
    where agent.id = p_agent_id;
end;
$function$;

-- Create or update one model configuration entry.
create or replace function public.upsert_provider_model_configuration(
  p_organization_id uuid,
  p_provider text,
  p_model text,
  p_display_name text,
  p_capabilities jsonb default '[]'::jsonb,
  p_enabled boolean default true,
  p_is_default boolean default false,
  p_input_cost_per_million_micros bigint default null,
  p_output_cost_per_million_micros bigint default null
)
returns setof public.provider_model_configurations
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  normalized_provider public.connection_provider;
  configuration_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if p_provider is null or p_provider not in ('anthropic', 'openai') then
    raise exception using errcode = '22023', message = 'provider must be anthropic or openai';
  end if;
  if public.jsonb_has_sensitive_keys(coalesce(p_capabilities, '[]'::jsonb)) then
    raise exception using errcode = '23514', message = 'model capabilities contain sensitive data';
  end if;

  normalized_provider := p_provider::public.connection_provider;

  -- Only one default per provider; clear the previous one in the same
  -- statement so the partial unique index is never transiently violated.
  if p_is_default then
    update public.provider_model_configurations
    set is_default = false, updated_at = now()
    where organization_id = p_organization_id
      and provider = normalized_provider
      and is_default
      and model <> p_model;
  end if;

  insert into public.provider_model_configurations (
    organization_id, provider, model, display_name, capabilities,
    enabled, is_default, input_cost_per_million_micros,
    output_cost_per_million_micros, created_by
  )
  values (
    p_organization_id, normalized_provider, p_model, p_display_name,
    coalesce(p_capabilities, '[]'::jsonb), coalesce(p_enabled, true),
    coalesce(p_is_default, false), p_input_cost_per_million_micros,
    p_output_cost_per_million_micros, caller_id
  )
  on conflict (organization_id, provider, model) do update
  set display_name = excluded.display_name,
      capabilities = excluded.capabilities,
      enabled = excluded.enabled,
      is_default = excluded.is_default,
      input_cost_per_million_micros = excluded.input_cost_per_million_micros,
      output_cost_per_million_micros = excluded.output_cost_per_million_micros,
      updated_at = now()
  returning id into configuration_id;

  perform public.record_activity_event(
    p_organization_id,
    null,
    'connection.changed'::public.activity_event_type,
    'provider_model_configuration',
    configuration_id,
    format('Model %s configured for %s.', p_model, p_provider),
    jsonb_build_object('provider', p_provider, 'model', p_model, 'enabled', coalesce(p_enabled, true))
  );

  return query
    select configuration.*
    from public.provider_model_configurations configuration
    where configuration.id = configuration_id;
end;
$function$;

-- Owner-only switch for outbound provider execution.
create or replace function public.set_provider_execution_enabled(
  p_organization_id uuid,
  p_enabled boolean
)
returns table (organization_id uuid, ai_provider_execution_enabled boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may change provider execution';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'an explicit value is required';
  end if;

  update public.organizations
  set ai_provider_execution_enabled = p_enabled, updated_at = now()
  where id = p_organization_id;

  perform public.record_activity_event(
    p_organization_id,
    null,
    'connection.changed'::public.activity_event_type,
    'provider_execution_control',
    p_organization_id,
    case when p_enabled
      then 'Outbound AI provider execution was enabled by the owner.'
      else 'Outbound AI provider execution was disabled.'
    end,
    jsonb_build_object('enabled', p_enabled)
  );

  return query
    select organization.id, organization.ai_provider_execution_enabled
    from public.organizations organization
    where organization.id = p_organization_id;
end;
$function$;

-- Record one completed provider attempt: its routing evidence, the agent run,
-- the append-only trace, and an immutable activity event, in one transaction.
create or replace function public.record_provider_run(
  p_organization_id uuid,
  p_project_id uuid,
  p_task_id uuid,
  p_agent_id uuid,
  p_task_kind text,
  p_risk_level public.risk_level,
  p_requested_provider text,
  p_policy_version text,
  p_decision text,
  p_source text,
  p_selected_provider text,
  p_selected_model text,
  p_reasons jsonb,
  p_candidates jsonb,
  p_fallback_from_provider text,
  p_run_status public.run_status,
  p_provider_run_reference text,
  p_input jsonb,
  p_output jsonb,
  p_usage jsonb,
  p_latency_ms integer,
  p_error_message text,
  p_events jsonb
)
returns table (routing_decision_id uuid, agent_run_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  new_routing_id uuid;
  new_run_id uuid;
  event_entry jsonb;
  event_sequence integer := 0;
  persisted_task_risk public.risk_level;
  project_risk_ceiling public.risk_level;
  execution_enabled boolean;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  -- Revalidate the exact tenant binding rather than trusting the caller.
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'project not found in this organization';
  end if;
  if not exists (
    select 1 from public.tasks task
    where task.id = p_task_id and task.organization_id = p_organization_id
      and task.project_id = p_project_id
  ) then
    raise exception using errcode = 'P0002', message = 'task not found for this project';
  end if;
  if not exists (
    select 1 from public.agents agent
    where agent.id = p_agent_id and agent.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'agent not found in this organization';
  end if;

  select task.risk_level, project.maximum_autonomous_risk,
    organization.ai_provider_execution_enabled
  into persisted_task_risk, project_risk_ceiling, execution_enabled
  from public.tasks task
  join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  join public.organizations organization on organization.id = task.organization_id
  where task.id = p_task_id
    and task.organization_id = p_organization_id
    and task.project_id = p_project_id;

  if persisted_task_risk is distinct from p_risk_level then
    raise exception using errcode = '22023', message = 'provider run risk must match the persisted task';
  end if;
  if p_decision = 'ROUTED' and not execution_enabled then
    raise exception using errcode = '55000', message = 'outbound provider execution is disabled';
  end if;
  -- Phase 2A has no durable, exact RED approval record. A RED task may retain
  -- blocked routing evidence but may not manufacture an executed provider run.
  if p_decision = 'ROUTED' and p_risk_level = 'red'::public.risk_level then
    raise exception using errcode = '42501', message = 'RED provider execution requires a separately approved phase';
  end if;
  if p_decision = 'ROUTED' and p_risk_level > project_risk_ceiling then
    raise exception using errcode = '42501', message = 'provider run risk exceeds the project ceiling';
  end if;
  if p_decision = 'ROUTED' and p_run_status not in (
    'succeeded'::public.run_status,
    'failed'::public.run_status,
    'cancelled'::public.run_status
  ) then
    raise exception using errcode = '22023',
      message = 'a completed provider attempt requires a terminal run status';
  end if;
  if p_decision = 'ROUTED' and not exists (
    select 1
    from public.provider_model_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.provider = nullif(p_selected_provider, '')::public.connection_provider
      and configuration.model = nullif(p_selected_model, '')
      and configuration.enabled
  ) then
    raise exception using errcode = '23514',
      message = 'the routed model is not enabled for this organization and provider';
  end if;

  if public.jsonb_has_sensitive_keys(coalesce(p_reasons, '[]'::jsonb))
    or public.jsonb_has_sensitive_keys(coalesce(p_candidates, '[]'::jsonb))
    or public.jsonb_has_sensitive_keys(coalesce(p_input, '{}'::jsonb))
    or public.jsonb_has_sensitive_keys(coalesce(p_output, '{}'::jsonb))
    or public.jsonb_has_sensitive_keys(coalesce(p_usage, '{}'::jsonb)) then
    raise exception using errcode = '23514', message = 'provider run evidence contains sensitive data';
  end if;
  if p_error_message is not null and public.text_has_likely_secret(p_error_message) then
    raise exception using errcode = '23514', message = 'provider error message contains a likely secret';
  end if;

  insert into public.provider_routing_decisions (
    organization_id, project_id, task_id, agent_id, task_kind, risk_level,
    requested_provider, decision, source, selected_provider, selected_model,
    fallback_from_provider, policy_version, reasons, candidates, created_by
  )
  values (
    p_organization_id, p_project_id, p_task_id, p_agent_id, p_task_kind, p_risk_level,
    p_requested_provider, p_decision, p_source,
    nullif(p_selected_provider, '')::public.connection_provider,
    nullif(p_selected_model, ''),
    nullif(p_fallback_from_provider, '')::public.connection_provider,
    p_policy_version, coalesce(p_reasons, '[]'::jsonb), coalesce(p_candidates, '[]'::jsonb),
    caller_id
  )
  returning id into new_routing_id;

  -- Only a routed decision produces a run; a blocked decision is evidence on
  -- its own and must not manufacture an execution record.
  if p_decision <> 'ROUTED' then
    return query select new_routing_id, null::uuid;
    return;
  end if;

  insert into public.agent_runs (
    organization_id, project_id, task_id, agent_id, status, provider_run_reference,
    input, output, error_message, started_at, completed_at, provider, model,
    task_kind, usage, latency_ms, routing_decision_id, fallback_from_provider,
    cancelled_at
  )
  values (
    p_organization_id, p_project_id, p_task_id, p_agent_id, p_run_status,
    p_provider_run_reference, coalesce(p_input, '{}'::jsonb), p_output, p_error_message,
    now() - (coalesce(p_latency_ms, 0) || ' milliseconds')::interval, now(),
    nullif(p_selected_provider, '')::public.connection_provider,
    nullif(p_selected_model, ''), p_task_kind, coalesce(p_usage, '{}'::jsonb), p_latency_ms, new_routing_id,
    nullif(p_fallback_from_provider, '')::public.connection_provider,
    case when p_run_status = 'cancelled'::public.run_status then now() else null end
  )
  returning id into new_run_id;

  if p_events is not null and jsonb_typeof(p_events) = 'array' then
    for event_entry in select * from jsonb_array_elements(p_events)
    loop
      event_sequence := event_sequence + 1;
      exit when event_sequence > 1000;
      insert into public.provider_run_events (
        organization_id, agent_run_id, sequence, event_type, message
      )
      values (
        p_organization_id, new_run_id, event_sequence,
        event_entry ->> 'type', left(coalesce(event_entry ->> 'message', 'event'), 1000)
      );
    end loop;
  end if;

  update public.agents
  set last_run_at = now(), updated_at = now()
  where id = p_agent_id;

  perform public.record_activity_event(
    p_organization_id,
    p_project_id,
    'agent.started'::public.activity_event_type,
    'provider_agent_run',
    new_run_id,
    format('Provider run %s on %s finished with status %s.',
           p_task_kind, coalesce(p_selected_provider, 'unrouted'), p_run_status),
    jsonb_build_object(
      'provider', p_selected_provider,
      'model', p_selected_model,
      'task_kind', p_task_kind,
      'status', p_run_status,
      'fallback_from_provider', p_fallback_from_provider,
      'latency_ms', p_latency_ms
    )
  );

  return query select new_routing_id, new_run_id;
end;
$function$;

revoke all on function public.ensure_default_agents(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_agent_provider_assignment(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.upsert_provider_model_configuration(uuid, text, text, text, jsonb, boolean, boolean, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.set_provider_execution_enabled(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.ensure_default_agents(uuid) to authenticated;
grant execute on function public.set_agent_provider_assignment(uuid, text, text) to authenticated;
grant execute on function public.upsert_provider_model_configuration(uuid, text, text, text, jsonb, boolean, boolean, bigint, bigint) to authenticated;
grant execute on function public.set_provider_execution_enabled(uuid, boolean) to authenticated;
grant execute on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) to authenticated;

create trigger provider_model_configurations_set_updated_at
  before update on public.provider_model_configurations
  for each row execute function public.set_updated_at();
