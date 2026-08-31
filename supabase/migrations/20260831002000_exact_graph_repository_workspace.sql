-- Exact, immutable repository workspaces for target-bound Grok execution.
--
-- A graph worker checkout is reviewed worker runtime, never target code. Before
-- a target-bound claim can create a run, the worker must read and echo the one
-- current active GitHub App/repository binding for that graph. The database
-- compares the complete bounded identity again in the claim transaction.
-- Repository contents and credentials never enter this projection.

do $preflight$
declare
  signature text;
  routine regprocedure;
begin
  foreach signature in array array[
    'resolve_graph_execution_target_as_worker(uuid,integer)',
    'claim_planned_graph_by_target_v4(text,text[],jsonb,integer)',
    'launch_grok_read_only_research_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure('public.' || signature) is not null then
      raise exception using errcode = '55000',
        message = pg_catalog.format('exact graph workspace routine already exists: %s', signature);
    end if;
  end loop;

  foreach signature in array array[
    'claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
    'launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
  ] loop
    routine := pg_catalog.to_regprocedure('public.' || signature);
    if routine is null or not exists (
      select 1
        from pg_catalog.pg_proc procedure
       where procedure.oid = routine
         and procedure.prosecdef
         and procedure.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    ) or not pg_catalog.has_function_privilege('service_role', routine, 'execute')
      or pg_catalog.has_function_privilege('anon', routine, 'execute')
      or pg_catalog.has_function_privilege('authenticated', routine, 'execute')
    then
      raise exception using errcode = '55000',
        message = pg_catalog.format('exact graph workspace predecessor mismatch: %s', signature);
    end if;
  end loop;

  if exists (
    select 1 from public.organizations organization
     where organization.autonomous_mode
        or not organization.autonomy_kill_switch_active
  ) or exists (
    select 1 from public.projects project where project.autonomous_mode
  ) or exists (
    select 1 from public.graph_runs run
     where run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs run
     where run.status = 'running'::public.run_status
  ) then
    raise exception using errcode = '55000',
      message = 'exact graph workspace cutover requires autonomy off, kill switches on, and drained workers';
  end if;
end;
$preflight$;

create function public.resolve_graph_execution_target_as_worker(
  p_target_graph_id uuid,
  p_protocol_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_count integer;
  v_identity jsonb;
begin
  if p_target_graph_id is null then
    raise exception using errcode = '22023',
      message = 'an exact target graph id is required';
  end if;
  if p_protocol_version is distinct from 1 then
    raise exception using errcode = '0A000',
      message = 'graph execution target protocol version 1 is required';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'protocol_version', 1,
           'graph_id', graph.id,
           'organization_id', graph.organization_id,
           'project_id', graph.project_id,
           'connection_id', connection.id,
           'github_repository_id', repository.id,
           'internal_installation_id', installation.id,
           'external_installation_id', installation.external_installation_id,
           'app_id', installation.app_id,
           'external_repository_id', repository.external_repository_id,
           'repository_full_name', repository.full_name,
           'base_branch', graph.base_branch,
           'base_sha', graph.base_sha,
           'required_check_names', graph.required_check_names,
           'required_checks_sha256', graph.required_checks_sha256
         ) order by connection.id, installation.id, repository.id) -> 0
    into v_count, v_identity
    from public.graphs graph
    join public.organizations organization
      on organization.id = graph.organization_id
    join public.projects project
      on project.id = graph.project_id
     and project.organization_id = graph.organization_id
    join public.project_connections link
      on link.organization_id = graph.organization_id
     and link.project_id = graph.project_id
     and link.is_primary
    join public.connections connection
      on connection.id = link.connection_id
     and connection.organization_id = link.organization_id
    join public.github_repositories repository
      on repository.id = link.github_repository_id
     and repository.organization_id = link.organization_id
     and repository.id = graph.github_repository_id
    join public.github_installations installation
      on installation.id = repository.installation_id
     and installation.organization_id = repository.organization_id
     and installation.connection_id = connection.id
   where graph.id = p_target_graph_id
     and graph.withdrawn_at is null
     and project.status = 'active'::public.project_status
     and not project.autonomous_mode
     and not organization.autonomous_mode
     and organization.autonomy_kill_switch_active
     and connection.provider = 'github'::public.connection_provider
     and connection.status = 'connected'::public.connection_status
     and installation.status = 'active'
     and installation.suspended_at is null
     and installation.deleted_at is null
     and installation.external_installation_id > 0
     and installation.app_id > 0
     and repository.external_repository_id > 0
     and repository.selected
     and not repository.archived
     and not repository.disabled
     and project.github_repository is not distinct from repository.full_name
     and project.default_branch is not distinct from repository.default_branch
     and graph.base_branch is not distinct from repository.default_branch
     and graph.base_sha ~ '^[0-9a-f]{40}$'
     and public.graph_required_check_policy_is_safe(graph.required_check_names)
     and graph.required_checks_sha256 ~ '^[0-9a-f]{64}$'
     and graph.required_checks_sha256 = pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(graph.required_check_names::text, 'UTF8')
     ), 'hex');

  if v_count is distinct from 1 or v_identity is null then
    raise exception using errcode = 'P0002',
      message = 'exact active graph repository target not found';
  end if;

  return v_identity || pg_catalog.jsonb_build_object(
    'target_sha256', pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(v_identity::text, 'UTF8')
    ), 'hex')
  );
end;
$function$;

revoke all on function public.resolve_graph_execution_target_as_worker(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_graph_execution_target_as_worker(uuid, integer)
  to service_role;

create function public.claim_planned_graph_by_target_v4(
  p_worker_id text,
  p_supported_executors text[],
  p_expected_target jsonb,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph_id uuid;
  v_target jsonb;
  v_claim jsonb;
begin
  if p_protocol_version is distinct from 4 then
    raise exception using errcode = '0A000',
      message = 'graph worker protocol version 4 is required';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_expected_target, 'null'::jsonb))
      is distinct from 'object'
      or p_expected_target ->> 'protocol_version' is distinct from '1'
      or coalesce(p_expected_target ->> 'graph_id', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or p_expected_target ->> 'target_sha256' !~ '^[0-9a-f]{64}$'
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(p_expected_target) key
         where key not in (
           'protocol_version', 'graph_id', 'organization_id', 'project_id',
           'connection_id', 'github_repository_id', 'internal_installation_id',
           'external_installation_id', 'app_id', 'external_repository_id',
           'repository_full_name', 'base_branch', 'base_sha',
           'required_check_names', 'required_checks_sha256', 'target_sha256'
         )
      )
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_expected_target)) <> 16
  then
    raise exception using errcode = '22023',
      message = 'the exact graph execution target projection is invalid';
  end if;

  v_graph_id := (p_expected_target ->> 'graph_id')::uuid;
  v_target := public.resolve_graph_execution_target_as_worker(v_graph_id, 1);
  if v_target is distinct from p_expected_target then
    raise exception using errcode = '55000',
      message = 'the graph repository target changed before claim';
  end if;

  v_claim := public.claim_planned_graph_by_id_v3(
    p_worker_id,
    p_supported_executors,
    v_target ->> 'repository_full_name',
    v_target -> 'required_check_names',
    v_graph_id,
    3
  );
  if v_claim is null then
    return null;
  end if;
  if v_claim ->> 'graph_id' is distinct from v_target ->> 'graph_id'
      or v_claim ->> 'organization_id' is distinct from v_target ->> 'organization_id'
      or v_claim ->> 'project_id' is distinct from v_target ->> 'project_id'
      or v_claim ->> 'project_repository' is distinct from v_target ->> 'repository_full_name'
  then
    raise exception using errcode = '55000',
      message = 'the claimed graph does not match its exact repository target';
  end if;
  if public.resolve_graph_execution_target_as_worker(v_graph_id, 1)
      is distinct from v_target
  then
    raise exception using errcode = '55000',
      message = 'the graph repository target changed during claim';
  end if;

  -- Older non-lifecycle claim projections omitted repository policy/base
  -- fields. Protocol v4 makes them mandatory for every exact-target graph.
  return v_claim || pg_catalog.jsonb_build_object(
    'base_branch', v_target ->> 'base_branch',
    'base_sha', v_target ->> 'base_sha',
    'required_check_names', v_target -> 'required_check_names',
    'required_checks_sha256', v_target ->> 'required_checks_sha256',
    'repository_target_sha256', v_target ->> 'target_sha256'
  );
end;
$function$;

revoke all on function public.claim_planned_graph_by_target_v4(text, text[], jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_planned_graph_by_target_v4(text, text[], jsonb, integer)
  to service_role;

-- Research graphs previously carried a repository label in their prompt
-- context but no immutable checkout identity. This wrapper preserves the
-- exact v2 planner/admission transaction and establishes the null release
-- identity fields before that same transaction commits. Exact replay must
-- match every field; the existing write-once trigger rejects later changes.
create function public.launch_grok_read_only_research_v3_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb,
  p_github_repository_id uuid,
  p_base_branch text,
  p_base_sha text,
  p_required_check_names jsonb,
  p_roster_idempotency_key text,
  p_admissions jsonb
)
returns public.grok_graph_launches
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_launch public.grok_graph_launches;
  v_graph public.graphs;
  v_required_checks_sha256 text;
begin
  if p_github_repository_id is null
      or p_base_branch is null
      or p_base_branch is distinct from pg_catalog.btrim(p_base_branch)
      or pg_catalog.char_length(p_base_branch) not between 1 and 255
      or p_base_sha !~ '^[0-9a-f]{40}$'
      or not public.graph_required_check_policy_is_safe(p_required_check_names)
  then
    raise exception using errcode = '22023',
      message = 'exact research repository, base, and required-check identity is required';
  end if;
  v_required_checks_sha256 := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(p_required_check_names::text, 'UTF8')
  ), 'hex');

  if not exists (
    select 1
      from public.projects project
      join public.project_connections link
        on link.organization_id = project.organization_id
       and link.project_id = project.id
       and link.is_primary
      join public.connections connection
        on connection.id = link.connection_id
       and connection.organization_id = link.organization_id
      join public.github_repositories repository
        on repository.id = link.github_repository_id
       and repository.organization_id = link.organization_id
      join public.github_installations installation
        on installation.id = repository.installation_id
       and installation.organization_id = repository.organization_id
       and installation.connection_id = connection.id
     where project.id = p_project_id
       and project.organization_id = p_organization_id
       and project.status = 'active'::public.project_status
       and not project.autonomous_mode
       and link.github_repository_id = p_github_repository_id
       and connection.provider = 'github'::public.connection_provider
       and connection.status = 'connected'::public.connection_status
       and installation.status = 'active'
       and installation.suspended_at is null
       and installation.deleted_at is null
       and repository.selected
       and not repository.archived
       and not repository.disabled
       and project.github_repository is not distinct from repository.full_name
       and project.default_branch is not distinct from repository.default_branch
       and repository.default_branch is not distinct from p_base_branch
  ) then
    raise exception using errcode = '23514',
      message = 'research graph repository binding is not the current active target';
  end if;

  v_launch := public.launch_grok_read_only_research_v2_as_server(
    p_organization_id, p_requested_by, p_project_id, p_session_id,
    p_message_id, p_idempotency_key, p_goal, p_topology,
    p_topology_reasons, p_risk_level, p_requires_owner_approval,
    p_nodes, p_edges, p_budget, p_roster_idempotency_key, p_admissions
  );

  update public.graphs graph
     set github_repository_id = p_github_repository_id,
         base_branch = p_base_branch,
         base_sha = p_base_sha,
         required_check_names = p_required_check_names,
         required_checks_sha256 = v_required_checks_sha256
   where graph.id = v_launch.graph_id
     and graph.organization_id = p_organization_id
     and graph.project_id = p_project_id
     and graph.github_repository_id is null
     and graph.base_branch is null
     and graph.base_sha is null
     and graph.required_check_names is null
     and graph.required_checks_sha256 is null;

  select graph.* into v_graph
    from public.graphs graph
   where graph.id = v_launch.graph_id
     and graph.organization_id = p_organization_id
     and graph.project_id = p_project_id;
  if not found
      or v_graph.is_lifecycle
      or v_graph.template_key is not null
      or v_graph.github_repository_id is distinct from p_github_repository_id
      or v_graph.base_branch is distinct from p_base_branch
      or v_graph.base_sha is distinct from p_base_sha
      or v_graph.required_check_names is distinct from p_required_check_names
      or v_graph.required_checks_sha256 is distinct from v_required_checks_sha256
      or v_graph.pause_requested_at is null
      or v_graph.withdrawn_at is not null
      or exists (
        select 1 from public.graph_runs run
         where run.organization_id = p_organization_id
           and run.graph_id = v_graph.id
      )
  then
    raise exception using errcode = '55000',
      message = 'research graph immutable repository target is missing or conflicting';
  end if;

  return v_launch;
end;
$function$;

revoke all on function public.launch_grok_read_only_research_v3_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_read_only_research_v3_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) to service_role;

comment on function public.resolve_graph_execution_target_as_worker(uuid, integer) is
  'Service-role-only bounded projection of one exact graph current active GitHub App/repository binding and immutable repository policy/base identity; returns no credentials.';
comment on function public.claim_planned_graph_by_target_v4(text, text[], jsonb, integer) is
  'Claims only after the complete exact repository target projection is re-resolved and remains identical in the claim transaction.';
comment on function public.launch_grok_read_only_research_v3_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) is
  'Service-only research launch that records provider admission and an immutable exact GitHub repository/base/check-policy target while the graph remains paused and no run exists.';

do $postflight$
declare
  signature text;
  routine regprocedure;
begin
  foreach signature in array array[
    'resolve_graph_execution_target_as_worker(uuid,integer)',
    'claim_planned_graph_by_target_v4(text,text[],jsonb,integer)',
    'launch_grok_read_only_research_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
  ] loop
    routine := pg_catalog.to_regprocedure('public.' || signature);
    if routine is null or not exists (
      select 1 from pg_catalog.pg_proc procedure
       where procedure.oid = routine
         and procedure.prosecdef
         and procedure.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    ) or not pg_catalog.has_function_privilege('service_role', routine, 'execute')
      or pg_catalog.has_function_privilege('public', routine, 'execute')
      or pg_catalog.has_function_privilege('anon', routine, 'execute')
      or pg_catalog.has_function_privilege('authenticated', routine, 'execute')
    then
      raise exception using errcode = '42501',
        message = pg_catalog.format('exact graph workspace routine metadata or ACL mismatch: %s', signature);
    end if;
  end loop;

end;
$postflight$;
