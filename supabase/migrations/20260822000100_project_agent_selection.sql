-- Selecting logical agents for a project's AI Factory, and making the
-- selection stick.
--
-- The Agents page defines the eleven standard logical roles, but nothing on
-- it could say "this factory uses these agents": there was no record for the
-- AI Factory journey to read, so the roster and the factory never met. This
-- is the light act that connects them — recording that a project's factory
-- includes an agent — exactly parallel to project_pipelines, and like it,
-- selection is routing intent, never execution: nothing here dispatches a
-- bot, claims work, or spends a token.
--
-- A project may select many agents. An agent is selectable into a project
-- when it belongs to the same organization and is either organization-wide
-- (project_id null — the standard roster) or already bound to that project.

alter type public.activity_event_type add value if not exists 'agent.selected';
alter type public.activity_event_type add value if not exists 'agent.deselected';

create table if not exists public.project_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  agent_id uuid not null,
  selected_by uuid not null references auth.users(id) on delete restrict,
  selected_at timestamptz not null default now(),

  constraint project_agents_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint project_agents_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint project_agents_unique unique (project_id, agent_id)
);

comment on table public.project_agents is
  'Which logical agents a project''s AI Factory includes. Selection is routing intent recorded by a person; it dispatches nothing.';

create index if not exists project_agents_project_idx
  on public.project_agents (project_id, selected_at desc);

create index if not exists project_agents_organization_idx
  on public.project_agents (organization_id, selected_at desc);

create index if not exists project_agents_agent_idx
  on public.project_agents (agent_id);

alter table public.project_agents enable row level security;
alter table public.project_agents force row level security;

-- No browser write path and no service-role read path: selections are read
-- and written through the definer functions below, under the caller's own
-- identity, so an organization boundary is never crossed by a widened grant.
revoke all on table public.project_agents from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

/*
 * Selecting is idempotent: including an agent already included returns the
 * existing row rather than raising, because a person pressing a toggle twice
 * has expressed one intention, not an error. Removing an unselected agent is
 * likewise a no-op that reports it changed nothing.
 */
create or replace function public.select_project_agent(
  p_organization_id uuid,
  p_project_id uuid,
  p_agent_id uuid
)
returns table (
  selection_id uuid,
  selection_agent_id uuid,
  selection_selected_at timestamptz,
  selection_created boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_project public.projects%rowtype;
  v_agent public.agents%rowtype;
  v_existing public.project_agents%rowtype;
  v_new public.project_agents%rowtype;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  -- Two callers including the same agent must not both insert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:project-agent:' || p_project_id::text || ':' || p_agent_id::text,
      0
    )
  );

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project was not found';
  end if;
  if v_project.status = 'archived'::public.project_status then
    raise exception using errcode = '55000',
      message = 'an archived project cannot change its agents';
  end if;

  select agent.* into v_agent
  from public.agents agent
  where agent.id = p_agent_id
    and agent.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'agent was not found';
  end if;
  if v_agent.project_id is not null and v_agent.project_id <> p_project_id then
    raise exception using errcode = '55000',
      message = 'an agent bound to another project cannot be included here';
  end if;

  select existing.* into v_existing
  from public.project_agents existing
  where existing.project_id = p_project_id
    and existing.agent_id = p_agent_id;
  if found then
    -- Already included. Report the row that is there, and record nothing:
    -- an audit trail of unchanged state is noise, not evidence.
    return query
    select v_existing.id, v_existing.agent_id, v_existing.selected_at, false;
    return;
  end if;

  insert into public.project_agents
    (organization_id, project_id, agent_id, selected_by)
  values (p_organization_id, p_project_id, p_agent_id, v_caller)
  returning * into v_new;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    p_project_id,
    v_caller,
    'agent.selected'::public.activity_event_type,
    'project_agent',
    v_new.id,
    'Logical agent included in the project''s AI Factory. Selection is routing intent, not execution.',
    pg_catalog.jsonb_build_object(
      'agent_id', p_agent_id,
      'agent_name', v_agent.name,
      'agent_role', v_agent.role
    )
  );

  return query
  select v_new.id, v_new.agent_id, v_new.selected_at, true;
end;
$function$;

create or replace function public.deselect_project_agent(
  p_organization_id uuid,
  p_project_id uuid,
  p_agent_id uuid
)
returns table (selection_removed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_removed public.project_agents%rowtype;
  v_agent_name text;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:project-agent:' || p_project_id::text || ':' || p_agent_id::text,
      0
    )
  );

  delete from public.project_agents existing
  where existing.organization_id = p_organization_id
    and existing.project_id = p_project_id
    and existing.agent_id = p_agent_id
  returning * into v_removed;
  if not found then
    return query select false;
    return;
  end if;

  select agent.name into v_agent_name
  from public.agents agent
  where agent.id = v_removed.agent_id
    and agent.organization_id = p_organization_id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    p_project_id,
    v_caller,
    'agent.deselected'::public.activity_event_type,
    'project_agent',
    v_removed.id,
    'Logical agent removed from the project''s AI Factory. Work already recorded keeps its history.',
    pg_catalog.jsonb_build_object(
      'agent_id', v_removed.agent_id,
      'agent_name', v_agent_name
    )
  );

  return query select true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- Every selection in the organization, for a console that shows several
-- projects at once. A member may read; only an owner or administrator writes.
create or replace function public.list_project_agents(p_organization_id uuid)
returns table (
  selection_id uuid,
  selection_project_id uuid,
  selection_agent_id uuid,
  selection_selected_at timestamptz,
  agent_name text,
  agent_role text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select
    selection.id,
    selection.project_id,
    selection.agent_id,
    selection.selected_at,
    agent.name,
    agent.role::text
  from public.project_agents selection
  join public.agents agent
    on agent.id = selection.agent_id
   and agent.organization_id = selection.organization_id
  where selection.organization_id = p_organization_id
  order by selection.selected_at asc, agent.name asc;
end;
$function$;

revoke all on function public.select_project_agent(uuid, uuid, uuid)
  from public, anon, service_role;
revoke all on function public.deselect_project_agent(uuid, uuid, uuid)
  from public, anon, service_role;
revoke all on function public.list_project_agents(uuid)
  from public, anon, service_role;

grant execute on function public.select_project_agent(uuid, uuid, uuid) to authenticated;
grant execute on function public.deselect_project_agent(uuid, uuid, uuid) to authenticated;
grant execute on function public.list_project_agents(uuid) to authenticated;
