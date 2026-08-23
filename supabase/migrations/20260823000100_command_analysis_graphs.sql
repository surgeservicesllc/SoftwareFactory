-- A record-only factory command on a Claude bot gains a real, bounded
-- execution: the command's prompt becomes the goal of one analysis graph
-- that the subscription-authenticated graph worker drains with read-only
-- tools (Phase 2A's boundary: analysis artifacts only, never a repository
-- write). The repository-writing lane stays exactly where it was - the
-- manual Codex path. This file adds only the durable one-to-one link, the
-- launch doorway, and its read; it replaces no existing function and adds
-- no enum label.

do $preflight$
begin
  if to_regclass('public.command_analysis_graphs') is not null
    or to_regprocedure('public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)') is not null
    or to_regprocedure('public.list_command_analysis_graphs(uuid)') is not null then
    raise exception using errcode = '55000',
      message = '20260823000100 preflight: a command-analysis object already exists; this file is forward-only';
  end if;
  if to_regclass('public.commands') is null
    or to_regclass('public.graphs') is null
    or to_regclass('public.graph_runs') is null
    or to_regclass('public.graph_artifacts') is null
    or to_regclass('public.activity_events') is null
    or to_regprocedure('public.create_graph_from_plan(uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.is_organization_member(uuid)') is null then
    raise exception using errcode = '55000',
      message = '20260823000100 preflight: a prerequisite table or function is missing';
  end if;
  if not exists (
    select 1 from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    where enum_type.typname = 'activity_event_type'
      and enum_value.enumlabel = 'lifecycle.graph_created'
  ) then
    raise exception using errcode = '55000',
      message = '20260823000100 preflight: the lifecycle.graph_created activity label is missing';
  end if;
end;
$preflight$;

create table public.command_analysis_graphs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  command_id uuid not null references public.commands(id) on delete restrict,
  graph_id uuid not null references public.graphs(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint command_analysis_graphs_command_unique unique (command_id),
  constraint command_analysis_graphs_graph_unique unique (graph_id)
);

comment on table public.command_analysis_graphs is
  'One durable link from a record-only command to the analysis graph its prompt launched. The unique constraints are the idempotency: a command launches at most one graph, and a graph answers at most one command.';

create index command_analysis_graphs_org_idx
  on public.command_analysis_graphs (organization_id);
create index command_analysis_graphs_graph_idx
  on public.command_analysis_graphs (graph_id);

alter table public.command_analysis_graphs enable row level security;
alter table public.command_analysis_graphs force row level security;

create policy command_analysis_graphs_select_members
  on public.command_analysis_graphs
  for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.command_analysis_graphs
  from public, anon, authenticated, service_role;
grant select on table public.command_analysis_graphs to authenticated;

create function public.launch_command_analysis_graph(
  p_organization_id uuid,
  p_project_id uuid,
  p_command_id uuid,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_command public.commands%rowtype;
  v_existing uuid;
  v_graph_id uuid;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select command.* into v_command
  from public.commands command
  where command.id = p_command_id
    and command.organization_id = p_organization_id
    and command.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'the command does not exist in this project';
  end if;
  if coalesce(v_command.parameters ->> 'executionMode', '') <> 'record_only'
    or coalesce(v_command.parameters ->> 'provider', '') <> 'anthropic' then
    raise exception using errcode = '55000',
      message = 'only a record-only Claude command launches an analysis graph';
  end if;

  select link.graph_id into v_existing
  from public.command_analysis_graphs link
  where link.command_id = p_command_id;
  if found then
    -- Idempotent: the durable answer, never a second launch.
    return v_existing;
  end if;

  -- The graph's goal is exactly the command's stored prompt, read here
  -- rather than accepted from the caller, so the analysis evidence can
  -- never claim to answer a different question than the command asked.
  v_graph_id := public.create_graph_from_plan(
    p_organization_id, p_project_id, v_command.prompt,
    p_topology, p_topology_reasons, p_risk_level,
    p_requires_owner_approval, p_nodes, p_edges, p_budget
  );

  insert into public.command_analysis_graphs (
    organization_id, command_id, graph_id, created_by
  ) values (p_organization_id, p_command_id, v_graph_id, auth.uid());

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id, p_project_id, auth.uid(), 'lifecycle.graph_created',
    'graph', v_graph_id,
    'Analysis graph planned from a recorded command',
    jsonb_build_object(
      'command_id', p_command_id,
      'execution', 'subscription_analysis'
    )
  );

  return v_graph_id;
end;
$function$;

comment on function public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb) is
  'Launches the one analysis graph a record-only Claude command may have. Delegates to create_graph_from_plan with the command''s own prompt as the goal and records the immutable link and activity event.';

revoke all on function public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)
  to authenticated;

create function public.list_command_analysis_graphs(p_organization_id uuid)
returns table (
  command_id uuid,
  graph_id uuid,
  goal text,
  requires_owner_approval boolean,
  linked_at timestamptz,
  latest_run_id uuid,
  latest_run_state text,
  latest_run_started_at timestamptz,
  latest_run_completed_at timestamptz,
  artifact_count integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select link.command_id,
         link.graph_id,
         graph.goal,
         graph.requires_owner_approval,
         link.created_at,
         latest_run.id,
         latest_run.state::text,
         latest_run.started_at,
         latest_run.completed_at,
         coalesce(artifact_rollup.artifact_count, 0)
  from public.command_analysis_graphs link
  join public.graphs graph on graph.id = link.graph_id
  left join lateral (
    select run.id, run.state, run.started_at, run.completed_at
    from public.graph_runs run
    where run.graph_id = link.graph_id
    order by run.created_at desc
    limit 1
  ) latest_run on true
  left join lateral (
    select count(*)::integer as artifact_count
    from public.graph_artifacts artifact
    where artifact.graph_run_id = latest_run.id
  ) artifact_rollup on true
  where link.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by link.created_at desc
$function$;

comment on function public.list_command_analysis_graphs(uuid) is
  'The command-to-analysis-graph links with each graph''s latest run state and artifact count. A non-member reads zero rows rather than an error, which is the fail-closed shape every list read here uses.';

revoke all on function public.list_command_analysis_graphs(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_command_analysis_graphs(uuid)
  to authenticated;

do $postflight$
declare
  v_owner oid;
  v_bad text;
begin
  select relowner into v_owner from pg_class where oid = 'public.projects'::regclass;

  -- Hosted Supabase default privileges grant new functions and tables to
  -- anon/authenticated/service_role; the revokes above must have left the
  -- exact intended shape on every database, hosted included.
  select string_agg(failing.name, ', ') into v_bad from (
    select 'launch_acl' as name
    where (select count(*) from aclexplode((select proacl from pg_proc where oid = to_regprocedure('public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)')))) <> 2
       or has_function_privilege('anon', to_regprocedure('public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)'), 'EXECUTE')
       or has_function_privilege('service_role', to_regprocedure('public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)'), 'EXECUTE')
       or not has_function_privilege('authenticated', to_regprocedure('public.launch_command_analysis_graph(uuid,uuid,uuid,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)'), 'EXECUTE')
    union all
    select 'list_acl'
    where (select count(*) from aclexplode((select proacl from pg_proc where oid = to_regprocedure('public.list_command_analysis_graphs(uuid)')))) <> 2
       or has_function_privilege('anon', to_regprocedure('public.list_command_analysis_graphs(uuid)'), 'EXECUTE')
       or has_function_privilege('service_role', to_regprocedure('public.list_command_analysis_graphs(uuid)'), 'EXECUTE')
       or not has_function_privilege('authenticated', to_regprocedure('public.list_command_analysis_graphs(uuid)'), 'EXECUTE')
    union all
    select 'table_posture'
    where not exists (
      select 1 from pg_class relation
      where relation.oid = 'public.command_analysis_graphs'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner = v_owner
        and not has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege('service_role', relation.oid, 'SELECT,INSERT,UPDATE,DELETE')
        and has_table_privilege('authenticated', relation.oid, 'SELECT')
        and not has_table_privilege('authenticated', relation.oid, 'INSERT,UPDATE,DELETE')
    )
    union all
    select 'table_policy'
    where (select count(*) from pg_policy where polrelid = 'public.command_analysis_graphs'::regclass) <> 1
  ) failing;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260823000100 postflight: posture is not exact',
      detail = v_bad;
  end if;
end;
$postflight$;
