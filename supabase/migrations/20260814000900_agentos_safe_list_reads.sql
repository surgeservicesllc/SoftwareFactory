-- Safe browser projections for AgentOS.
--
-- Authenticated sessions have SELECT on the agentos_* tables, but the console
-- reads through these instead. Two reasons:
--
--   * A projection states exactly which columns leave the database. Adding a
--     column to a table cannot silently widen what the browser receives.
--   * Presence, not value. A credential reference is reported as a boolean;
--     the variable NAME never reaches a browser response either, because
--     knowing which variable holds a token is itself a hint worth withholding.
--
-- Every function resolves membership itself and bounds its row count, so a
-- caller cannot ask for another organization's rows or for an unbounded page.

-- ---------------------------------------------------------------------------
-- Agents with their resolved grants
-- ---------------------------------------------------------------------------

create or replace function public.agentos_list_agent_grants(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  agent_id uuid,
  agent_name text,
  configured boolean,
  inbox_access boolean,
  runner_preference text,
  environment_name text,
  networking text,
  allowed_host_count integer,
  mcp_count integer,
  skill_count integer,
  repo_count integer,
  filesystem_grant_count integer,
  collaborator_count integer
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
    a.id,
    a.name,
    (g.id is not null) as configured,
    coalesce(g.inbox_access, false),
    coalesce(g.runner_preference, 'inherit'),
    e.name,
    -- An agent with no environment is reported as limited, matching the
    -- resolver: absence is the closed reading, not an unknown one.
    coalesce(e.networking::text, 'limited'),
    coalesce(cardinality(e.allowed_hosts), 0),
    (select count(*)::integer from public.agentos_agent_mcp_grants m where m.agent_id = a.id),
    (select count(*)::integer from public.agentos_agent_skill_grants s where s.agent_id = a.id),
    (select count(*)::integer from public.agentos_agent_repo_grants r where r.agent_id = a.id),
    (select count(*)::integer from public.agentos_agent_filesystem_grants f where f.agent_id = a.id),
    (select count(*)::integer from public.agentos_agent_collaborators c where c.agent_id = a.id)
  from public.agents a
  left join public.agentos_agent_grants g on g.agent_id = a.id
  left join public.agentos_environments e on e.id = g.environment_id
  where a.organization_id = p_organization_id
  order by a.name
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.agentos_list_agent_grants(uuid, integer)
  from public, anon, service_role;
grant execute on function public.agentos_list_agent_grants(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

create or replace function public.agentos_list_inbox(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  author text,
  kind text,
  status text,
  body text,
  choices text[],
  selected_choice text,
  answer_body text,
  agent_name text,
  agent_run_id uuid,
  created_at timestamptz,
  answered_at timestamptz
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
    m.id, m.author::text, m.kind::text, m.status::text, m.body, m.choices,
    -- The label, so a browser never re-derives what an index meant.
    case when m.selected_choice_index is null then null
         else m.choices[m.selected_choice_index + 1] end,
    m.answer_body,
    a.name,
    m.agent_run_id,
    m.created_at,
    m.answered_at
  from public.agentos_inbox_messages m
  left join public.agents a on a.id = m.agent_id
  where m.organization_id = p_organization_id
  order by (m.status = 'open') desc, m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.agentos_list_inbox(uuid, integer) from public, anon, service_role;
grant execute on function public.agentos_list_inbox(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------

create or replace function public.agentos_list_goals(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  title text,
  status text,
  project_name text,
  dod_total integer,
  dod_satisfied integer,
  spend_cap_usd numeric,
  spent_usd numeric,
  uncapped_acknowledged boolean,
  max_duration_minutes integer,
  stuck_threshold smallint,
  iterations integer,
  stopped_reason text,
  created_at timestamptz
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
    g.id, g.title, g.status::text, p.name,
    (select count(*)::integer from public.agentos_goal_dod_items d where d.goal_id = g.id),
    (select count(*)::integer from public.agentos_goal_dod_items d
      where d.goal_id = g.id and d.satisfied),
    g.spend_cap_usd, g.spent_usd,
    -- Whether someone accepted running uncapped, not who. The identity is on
    -- the row for audit; a list does not need it.
    (g.uncapped_spend_acknowledged_by is not null),
    g.max_duration_minutes, g.stuck_threshold,
    (select count(*)::integer from public.agentos_goal_progress pr where pr.goal_id = g.id),
    g.stopped_reason,
    g.created_at
  from public.agentos_goals g
  join public.projects p on p.id = g.project_id
  where g.organization_id = p_organization_id
  order by g.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.agentos_list_goals(uuid, integer) from public, anon, service_role;
grant execute on function public.agentos_list_goals(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Chains
-- ---------------------------------------------------------------------------

create or replace function public.agentos_list_chains(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  title text,
  template_name text,
  project_name text,
  total_steps integer,
  done_steps integer,
  current_step_name text,
  current_step_state text,
  current_step_gated boolean,
  created_at timestamptz
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
    c.id, c.title, t.display_name, p.name,
    (select count(*)::integer from public.agentos_task_chain_steps s where s.chain_id = c.id),
    (select count(*)::integer from public.agentos_task_chain_steps s
      where s.chain_id = c.id and s.state = 'done'),
    -- The earliest step that is not finished: what a human is waiting on.
    (select s.name from public.agentos_task_chain_steps s
      where s.chain_id = c.id and s.state <> 'done'
      order by s.step_index limit 1),
    (select s.state::text from public.agentos_task_chain_steps s
      where s.chain_id = c.id and s.state <> 'done'
      order by s.step_index limit 1),
    (select s.approval_gate from public.agentos_task_chain_steps s
      where s.chain_id = c.id and s.state <> 'done'
      order by s.step_index limit 1),
    c.created_at
  from public.agentos_task_chains c
  join public.agentos_task_templates t on t.id = c.template_id
  join public.projects p on p.id = c.project_id
  where c.organization_id = p_organization_id
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.agentos_list_chains(uuid, integer) from public, anon, service_role;
grant execute on function public.agentos_list_chains(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers and automations
-- ---------------------------------------------------------------------------

create or replace function public.agentos_list_triggers(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  display_name text,
  agent_name text,
  project_name text,
  enabled boolean,
  secret_configured boolean,
  delivery_count integer,
  accepted_count integer,
  last_received_at timestamptz
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
    t.id, t.name, t.display_name, a.name, p.name, t.enabled,
    -- Presence only. Which variable holds the secret is itself a hint, and
    -- the public slug is deliberately absent from this projection: a browser
    -- listing does not need the callable URL.
    (t.secret_env_var is not null),
    (select count(*)::integer from public.agentos_trigger_deliveries d where d.trigger_id = t.id),
    (select count(*)::integer from public.agentos_trigger_deliveries d
      where d.trigger_id = t.id and d.status = 'accepted'),
    (select max(d.received_at) from public.agentos_trigger_deliveries d where d.trigger_id = t.id)
  from public.agentos_triggers t
  join public.agents a on a.id = t.agent_id
  join public.projects p on p.id = t.project_id
  where t.organization_id = p_organization_id
  order by t.name
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.agentos_list_triggers(uuid, integer) from public, anon, service_role;
grant execute on function public.agentos_list_triggers(uuid, integer) to authenticated;
