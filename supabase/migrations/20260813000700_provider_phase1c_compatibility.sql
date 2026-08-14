-- Forward compatibility between the immutable hosted Phase 2A provider layer
-- and the Phase 1C provider-neutral execution schema.
--
-- Migration 130001 is already hosted and must remain byte-for-byte immutable.
-- This migration carries only the additive/narrowing compatibility work that
-- the local Phase 1C candidate previously (and incorrectly) folded into it.

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

alter table public.provider_agent_assignments enable row level security;
alter table public.provider_agent_assignments force row level security;

create policy provider_agent_assignments_select_members
  on public.provider_agent_assignments for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.provider_agent_assignments
  from public, anon, authenticated, service_role;

create trigger provider_agent_assignments_set_updated_at
  before update on public.provider_agent_assignments
  for each row execute function public.set_updated_at();

-- Phase 1C fixes a single provider/model, while Phase 2A stores provider enum
-- evidence. Text is the common representation and remains allowlisted.
alter table public.agent_runs
  drop constraint agent_runs_model_check;

alter table public.agent_runs
  alter column provider type text using provider::text,
  alter column model type text,
  alter column usage set default '{}'::jsonb;

update public.agent_runs set usage = '{}'::jsonb where usage is null;

alter table public.agent_runs
  alter column usage set not null,
  add constraint agent_runs_provider_check
    check (provider is null or provider in ('anthropic', 'openai')),
  add constraint agent_runs_model_check
    check (model is null or char_length(btrim(model)) between 1 and 120);

-- Do not impose global organization/name uniqueness on user-authored logical
-- agents. The forward roster migration serializes and identifies only its
-- exact provider-neutral standard rows.
drop index public.agents_organization_name_unique;

drop function public.set_agent_provider_assignment(uuid, text, text);
create function public.set_agent_provider_assignment(
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
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  if p_provider is null then
    if p_model is not null then
      raise exception using errcode = '22023',
        message = 'a model cannot be assigned without a provider';
    end if;
    delete from public.provider_agent_assignments assignment
    where assignment.agent_id = p_agent_id
      and assignment.organization_id = agent_record.organization_id;
  else
    if p_provider not in ('anthropic', 'openai') then
      raise exception using errcode = '22023',
        message = 'provider must be anthropic or openai';
    end if;
    normalized_provider := p_provider::public.connection_provider;
    if p_model is not null and not exists (
      select 1 from public.provider_model_configurations configuration
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
    format('Agent %s provider assignment set to %s.',
      agent_record.name, coalesce(p_provider, 'automatic routing')),
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

-- Preserve the immutable Phase 2A implementation behind a private name and
-- put the current risk/spend/model checks in front of it.
alter function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) rename to record_provider_run_phase2a_internal;

create function public.record_provider_run(
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
  persisted_task_risk public.risk_level;
  project_risk_ceiling public.risk_level;
  execution_enabled boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
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

  if not found then
    raise exception using errcode = 'P0002',
      message = 'task not found for this project';
  end if;
  if persisted_task_risk is distinct from p_risk_level then
    raise exception using errcode = '22023',
      message = 'provider run risk must match the persisted task';
  end if;
  if p_decision = 'ROUTED' and not execution_enabled then
    raise exception using errcode = '55000',
      message = 'outbound provider execution is disabled';
  end if;
  if p_decision = 'ROUTED' and p_risk_level = 'red'::public.risk_level then
    raise exception using errcode = '42501',
      message = 'RED provider execution requires a separately approved phase';
  end if;
  if p_decision = 'ROUTED' and p_risk_level > project_risk_ceiling then
    raise exception using errcode = '42501',
      message = 'provider run risk exceeds the project ceiling';
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
    select 1 from public.provider_model_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.provider = nullif(p_selected_provider, '')::public.connection_provider
      and configuration.model = nullif(p_selected_model, '')
      and configuration.enabled
  ) then
    raise exception using errcode = '23514',
      message = 'the routed model is not enabled for this organization and provider';
  end if;

  return query
    select recorded.routing_decision_id, recorded.agent_run_id
    from public.record_provider_run_phase2a_internal(
      p_organization_id, p_project_id, p_task_id, p_agent_id, p_task_kind,
      p_risk_level, p_requested_provider, p_policy_version, p_decision,
      p_source, p_selected_provider, p_selected_model, p_reasons, p_candidates,
      p_fallback_from_provider, p_run_status, p_provider_run_reference, p_input,
      p_output, coalesce(p_usage, '{}'::jsonb), p_latency_ms, p_error_message,
      p_events
    ) recorded;
end;
$function$;

revoke all on table public.provider_model_configurations
  from public, anon, authenticated, service_role;
revoke all on table public.provider_routing_decisions
  from public, anon, authenticated, service_role;
revoke all on table public.provider_run_events
  from public, anon, authenticated, service_role;
grant select on table public.provider_model_configurations to authenticated;
grant select on table public.provider_routing_decisions to authenticated;
grant select on table public.provider_run_events to authenticated;

revoke all on function public.record_provider_run_phase2a_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.set_agent_provider_assignment(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.set_agent_provider_assignment(uuid, text, text)
  to authenticated;
grant execute on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) to authenticated;

comment on function public.record_provider_run_phase2a_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) is 'Private immutable Phase 2A implementation behind the forward compatibility policy wrapper.';
