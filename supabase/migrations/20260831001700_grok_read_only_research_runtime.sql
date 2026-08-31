-- Execute the planner's exact research DAG instead of substituting the
-- canonical release lifecycle. This is a read-only analysis bridge only:
-- every node is an admitted Anthropic MODEL node, every writes set is empty,
-- the graph is atomically paused, and this migration creates no run or wake.

create function public.launch_grok_read_only_research_v1_as_server(
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
  p_roster_idempotency_key text,
  p_admissions jsonb
)
returns public.grok_graph_launches
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_message public.grok_messages;
  v_project public.projects;
  v_entry jsonb;
  v_task jsonb;
  v_node_input jsonb;
  v_matching_count integer;
  v_expected_count integer;
  v_admission_count integer;
  v_existing public.grok_graph_launches;
  v_launch public.grok_graph_launches;
  v_link public.grok_task_links;
  v_graph public.graphs;
  v_graph_node public.graph_nodes;
  v_specialist public.grok_specialist_admissions;
  v_existing_admission public.grok_execution_admissions;
  v_new public.grok_execution_admissions;
  v_input_sha256 text;
  v_node_key text;
begin
  if p_requested_by is null
      or p_idempotency_key is null
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
      or p_goal is null
      or pg_catalog.char_length(pg_catalog.btrim(p_goal)) not between 1 and 4000
      or p_topology is distinct from 'DAG'::public.graph_topology
      or p_risk_level is distinct from 'green'::public.risk_level
      or p_requires_owner_approval
      or pg_catalog.jsonb_typeof(coalesce(p_topology_reasons, 'null'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(coalesce(p_nodes, 'null'::jsonb)) <> 'array'
      or pg_catalog.jsonb_array_length(p_nodes) not between 1 and 32
      or pg_catalog.jsonb_typeof(coalesce(p_edges, 'null'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(coalesce(p_budget, 'null'::jsonb)) <> 'object'
      or pg_catalog.jsonb_typeof(coalesce(p_admissions, 'null'::jsonb)) <> 'array'
      or pg_catalog.jsonb_array_length(p_admissions) is distinct from
        pg_catalog.jsonb_array_length(p_nodes)
  then
    raise exception using errcode = '22023',
      message = 'invalid grok read-only research launch input';
  end if;
  if public.text_has_likely_secret(p_goal)
      or public.text_has_likely_secret(p_topology_reasons::text)
      or public.text_has_likely_secret(p_nodes::text)
      or public.text_has_likely_secret(p_edges::text)
      or public.text_has_likely_secret(p_budget::text)
  then
    raise exception using errcode = '22023',
      message = 'grok read-only research launch contains likely secret material';
  end if;
  if not exists (
    select 1
      from public.organization_members member
     where member.organization_id = p_organization_id
       and member.user_id = p_requested_by
       and member.role = 'owner'::public.organization_member_role
  ) then
    raise exception using errcode = '42501',
      message = 'an exact organization owner request identity is required';
  end if;

  select project.* into v_project
    from public.projects project
   where project.id = p_project_id
     and project.organization_id = p_organization_id
     and project.status = 'active'::public.project_status
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active project not found';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
     and session.project_id = p_project_id
   for update;
  if not found
      or v_session.created_by is distinct from p_requested_by
      or v_session.status is distinct from 'active'
  then
    raise exception using errcode = '42501',
      message = 'grok research owner, project, or active-session identity mismatch';
  end if;

  select message.* into v_message
    from public.grok_messages message
   where message.id = p_message_id
     and message.organization_id = p_organization_id
     and message.project_id = p_project_id
     and message.session_id = p_session_id
     and message.role = 'assistant'
     and message.metadata ->> 'kind' = 'grok.plan';
  if not found
      or v_message.metadata #>> '{plan,planner,version}' is distinct from '3'
      or v_message.metadata #>> '{plan,intent,kind}' is distinct from 'research'
      or v_message.metadata #>> '{plan,graphLaunch,goal}' is distinct from p_goal
      or v_message.metadata #>> '{plan,graphLaunch,topology}' is distinct from p_topology::text
      or v_message.metadata #> '{plan,graphLaunch,topologyReasons}' is distinct from p_topology_reasons
      or v_message.metadata #>> '{plan,graphLaunch,riskLevel}' is distinct from p_risk_level::text
      or (v_message.metadata #>> '{plan,graphLaunch,requiresOwnerApproval}')::boolean
        is distinct from p_requires_owner_approval
      or v_message.metadata #> '{plan,graphLaunch,nodes}' is distinct from p_nodes
      or v_message.metadata #> '{plan,graphLaunch,edges}' is distinct from p_edges
      or v_message.metadata #> '{plan,graphLaunch,budget}' is distinct from p_budget
  then
    raise exception using errcode = '55000',
      message = 'grok research launch does not match the immutable planner DAG';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_nodes) node
     where pg_catalog.jsonb_typeof(node.value) <> 'object'
        or node.value ->> 'executor' is distinct from 'MODEL'
        or coalesce(node.value ->> 'capability', '') = ''
        or coalesce(node.value ->> 'model_tier', '') not in ('ECONOMY', 'STANDARD', 'STRONG')
        or node.value -> 'writes' is distinct from '[]'::jsonb
        or node.value -> 'lifecycle_stage' is distinct from 'null'::jsonb
        or node.value -> 'gate_kind' is distinct from 'null'::jsonb
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_edges) edge
     where pg_catalog.jsonb_typeof(edge.value) <> 'object'
        or coalesce((edge.value ->> 'is_feedback')::boolean, false)
  ) then
    raise exception using errcode = '22023',
      message = 'research runtime accepts only read-only acyclic MODEL work';
  end if;

  -- Revalidate the entire planner roster under locks before graph creation.
  perform public.record_grok_specialist_roster_v1_as_server(
    p_organization_id, p_requested_by, p_project_id, p_session_id,
    p_message_id, p_roster_idempotency_key, 3
  );
  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
     and session.project_id = p_project_id
   for update;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     where pg_catalog.jsonb_typeof(admission.value) <> 'object'
        or not admission.value ?& array[
          'version', 'lane', 'nodeKey', 'sourceRosterAssignmentId',
          'assignmentId', 'assignmentRevision', 'botId', 'botRevision',
          'roleId', 'roleUpdatedAt', 'agentCapabilities', 'agentMaxModelTier',
          'aiAccountId', 'accountUpdatedAt', 'provider', 'model',
          'credentialPurpose', 'credentialRef', 'providerIdentity', 'capability'
        ]
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(admission.value) admission_key
           where admission_key not in (
             'version', 'lane', 'nodeKey', 'sourceRosterAssignmentId',
             'assignmentId', 'assignmentRevision', 'botId', 'botRevision',
             'roleId', 'roleUpdatedAt', 'agentCapabilities', 'agentMaxModelTier',
             'aiAccountId', 'accountUpdatedAt', 'provider', 'model',
             'credentialPurpose', 'credentialRef', 'providerIdentity', 'capability'
           )
        )
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     group by admission.value ->> 'nodeKey'
    having pg_catalog.count(*) <> 1
  ) then
    raise exception using errcode = '22023',
      message = 'invalid or duplicate grok research admission entry';
  end if;

  for v_entry in
    select admission.value
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     order by admission.value ->> 'nodeKey'
  loop
    v_node_key := v_entry ->> 'nodeKey';
    if v_entry ->> 'version' is distinct from '2'
        or v_entry ->> 'lane' is distinct from 'graph_model'
        or v_entry ->> 'provider' is distinct from 'anthropic'
        or coalesce(v_node_key, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'sourceRosterAssignmentId', 'uuid')
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'assignmentId', 'uuid')
        or v_entry ->> 'sourceRosterAssignmentId' is distinct from v_entry ->> 'assignmentId'
    then
      raise exception using errcode = '22023',
        message = 'invalid grok research admission identity';
    end if;

    select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(node.value) -> 0
      into v_matching_count, v_node_input
      from pg_catalog.jsonb_array_elements(p_nodes) node
     where node.value ->> 'node_key' = v_node_key;
    select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(task.value) -> 0
      into v_expected_count, v_task
      from pg_catalog.jsonb_array_elements(
        v_message.metadata #> '{plan,dag,tasks}'
      ) task
     where task.value ->> 'id' = v_node_key;
    if v_matching_count <> 1
        or v_expected_count <> 1
        or v_node_input ->> 'capability' is distinct from v_entry ->> 'capability'
        or v_task ->> 'executor' is distinct from 'MODEL'
        or v_task ->> 'provider' is distinct from 'anthropic'
        or v_task ->> 'assignmentId' is distinct from v_entry ->> 'assignmentId'
        or v_task ->> 'capability' is distinct from v_entry ->> 'capability'
        or v_task ->> 'modelTier' is distinct from v_node_input ->> 'model_tier'
        or v_task ->> 'model' is distinct from v_entry ->> 'model'
    then
      raise exception using errcode = '55000',
        message = 'grok research admission does not match its exact planner task';
    end if;

    select specialist.* into v_specialist
      from public.grok_specialist_admissions specialist
     where specialist.organization_id = p_organization_id
       and specialist.project_id = p_project_id
       and specialist.session_id = p_session_id
       and specialist.message_id = p_message_id
       and specialist.assignment_id = (v_entry ->> 'assignmentId')::uuid;
    if not found
        or v_specialist.assignment_revision is distinct from (v_entry ->> 'assignmentRevision')::bigint
        or v_specialist.bot_id is distinct from (v_entry ->> 'botId')::uuid
        or v_specialist.bot_revision is distinct from (v_entry ->> 'botRevision')::bigint
        or v_specialist.role_id is distinct from (v_entry ->> 'roleId')::uuid
        or v_specialist.role_updated_at is distinct from (v_entry ->> 'roleUpdatedAt')::timestamptz
        or v_specialist.capabilities is distinct from v_entry -> 'agentCapabilities'
        or v_specialist.max_model_tier is distinct from v_entry ->> 'agentMaxModelTier'
        or v_specialist.ai_account_id is distinct from (v_entry ->> 'aiAccountId')::uuid
        or v_specialist.ai_account_updated_at is distinct from (v_entry ->> 'accountUpdatedAt')::timestamptz
        or v_specialist.provider is distinct from 'anthropic'::public.bot_provider
        or v_specialist.model is distinct from v_entry ->> 'model'
        or v_specialist.credential_purpose is distinct from v_entry ->> 'credentialPurpose'
        or v_specialist.credential_ref is distinct from v_entry ->> 'credentialRef'
        or v_specialist.provider_identity is distinct from v_entry ->> 'providerIdentity'
        or v_specialist.admission_sha256 is distinct from public.grok_specialist_admission_hash(v_specialist)
        or not (v_specialist.capabilities @> pg_catalog.jsonb_build_array(v_entry ->> 'capability'))
        or (case v_specialist.max_model_tier when 'ECONOMY' then 1 when 'STANDARD' then 2 when 'STRONG' then 3 else -1 end)
          < (case v_node_input ->> 'model_tier' when 'ECONOMY' then 1 when 'STANDARD' then 2 when 'STRONG' then 3 else 99 end)
    then
      raise exception using errcode = '42501',
        message = 'grok research admission does not match immutable specialist evidence';
    end if;
  end loop;

  v_input_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bridge', 'grok_read_only_research_v1',
      'organizationId', p_organization_id,
      'requestedBy', p_requested_by,
      'projectId', p_project_id,
      'sessionId', p_session_id,
      'messageId', p_message_id,
      'goal', p_goal,
      'topology', p_topology::text,
      'topologyReasons', p_topology_reasons,
      'riskLevel', p_risk_level::text,
      'requiresOwnerApproval', p_requires_owner_approval,
      'nodes', p_nodes,
      'edges', p_edges,
      'budget', p_budget,
      'admissions', p_admissions
    )::text, 'UTF8'
  )), 'hex');

  select launch.* into v_existing
    from public.grok_graph_launches launch
   where launch.organization_id = p_organization_id
     and launch.session_id = p_session_id
     and launch.idempotency_key = p_idempotency_key;
  if found then
    select graph.* into v_graph
      from public.graphs graph
     where graph.id = v_existing.graph_id
       and graph.organization_id = p_organization_id
       and graph.project_id = p_project_id;
    if not found
        or v_existing.message_id is distinct from p_message_id
        or v_existing.created_by is distinct from p_requested_by
        or v_existing.input_sha256 is distinct from v_input_sha256
        or v_graph.pause_requested_at is null
        or v_graph.withdrawn_at is not null
        or v_graph.is_lifecycle
        or v_graph.template_key is not null
        or exists (
          select 1 from public.graph_runs run
           where run.organization_id = p_organization_id
             and run.graph_id = v_existing.graph_id
        )
    then
      raise exception using errcode = '22023',
        message = 'grok research idempotency key conflicts with durable evidence';
    end if;
    perform public.assert_current_grok_execution_admissions(v_existing.graph_id);
    return v_existing;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_requested_by::text, true);
  v_graph.id := public.create_graph_from_plan(
    p_organization_id, p_project_id, p_goal, p_topology,
    p_topology_reasons, p_risk_level, p_requires_owner_approval,
    p_nodes, p_edges, p_budget
  );
  perform public.set_graph_pause_as_member(p_organization_id, v_graph.id, true);
  select graph.* into v_graph
    from public.graphs graph
   where graph.id = v_graph.id
     and graph.organization_id = p_organization_id
     and graph.project_id = p_project_id;
  if not found
      or v_graph.pause_requested_at is null
      or v_graph.pause_requested_by is distinct from p_requested_by
      or v_graph.withdrawn_at is not null
      or v_graph.is_lifecycle
      or v_graph.template_key is not null
      or exists (
        select 1 from public.graph_runs run
         where run.organization_id = p_organization_id
           and run.graph_id = v_graph.id
      )
  then
    raise exception using errcode = '55000',
      message = 'grok research graph was not atomically paused before execution';
  end if;

  v_link := public.link_grok_task_as_server(
    p_organization_id, p_session_id, p_message_id,
    null, null, v_graph.id, null, 'planned'
  );
  insert into public.grok_graph_launches (
    organization_id, project_id, session_id, message_id, idempotency_key,
    input_sha256, graph_id, task_link_id, created_by
  ) values (
    p_organization_id, p_project_id, p_session_id, p_message_id,
    p_idempotency_key, v_input_sha256, v_graph.id, v_link.id, p_requested_by
  ) returning * into v_launch;

  for v_entry in
    select admission.value
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     order by admission.value ->> 'nodeKey'
  loop
    v_node_key := v_entry ->> 'nodeKey';
    select specialist.* into v_specialist
      from public.grok_specialist_admissions specialist
     where specialist.organization_id = p_organization_id
       and specialist.message_id = p_message_id
       and specialist.assignment_id = (v_entry ->> 'assignmentId')::uuid;
    select node.* into v_graph_node
      from public.graph_nodes node
     where node.organization_id = p_organization_id
       and node.graph_id = v_graph.id
       and node.node_key = v_node_key;
    if not found then
      raise exception using errcode = '55000',
        message = 'persisted research graph node does not match provider admission';
    end if;

    v_new.id := gen_random_uuid();
    v_new.organization_id := p_organization_id;
    v_new.project_id := p_project_id;
    v_new.session_id := p_session_id;
    v_new.message_id := p_message_id;
    v_new.graph_launch_id := v_launch.id;
    v_new.graph_id := v_graph.id;
    v_new.graph_node_id := v_graph_node.id;
    v_new.node_key := v_node_key;
    -- The v2 admission hash contract reserves source_task_key for the exact
    -- immutable roster identity. The planner task remains exact in node_key.
    v_new.source_task_key := 'roster:' || v_specialist.assignment_id::text;
    v_new.lane := 'graph_model';
    v_new.assignment_id := v_specialist.assignment_id;
    v_new.assignment_revision := v_specialist.assignment_revision;
    v_new.bot_id := v_specialist.bot_id;
    v_new.bot_revision := v_specialist.bot_revision;
    v_new.role_id := v_specialist.role_id;
    v_new.role_updated_at := v_specialist.role_updated_at;
    v_new.role_capabilities_sha256 := v_specialist.role_capabilities_sha256;
    v_new.agent_capabilities := v_specialist.capabilities;
    v_new.agent_max_model_tier := v_specialist.max_model_tier;
    v_new.ai_account_id := v_specialist.ai_account_id;
    v_new.ai_account_updated_at := v_specialist.ai_account_updated_at;
    v_new.provider := v_specialist.provider;
    v_new.model := v_specialist.model;
    v_new.credential_purpose := v_specialist.credential_purpose;
    v_new.credential_ref := v_specialist.credential_ref;
    v_new.provider_credential_id := v_specialist.provider_credential_id;
    v_new.provider_credential_rotated_at := v_specialist.provider_credential_rotated_at;
    v_new.provider_identity := v_specialist.provider_identity;
    v_new.capability := v_entry ->> 'capability';
    v_new.specialist_admission_id := v_specialist.id;
    v_new.created_by := p_requested_by;
    v_new.created_at := pg_catalog.now();
    v_new.admission_sha256 := public.grok_current_execution_admission_hash(v_new);
    insert into public.grok_execution_admissions values (v_new.*);
  end loop;

  select pg_catalog.count(*)::integer into v_admission_count
    from public.grok_execution_admissions admission
   where admission.organization_id = p_organization_id
     and admission.graph_id = v_graph.id;
  if v_admission_count is distinct from pg_catalog.jsonb_array_length(p_nodes)
      or not public.assert_current_grok_execution_admissions(v_graph.id)
  then
    raise exception using errcode = '55000',
      message = 'grok research execution admission set is incomplete';
  end if;

  perform public.record_grok_event_as_server(
    p_organization_id,
    p_session_id,
    'graph.planned',
    v_graph.id,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'detail', 'The exact read-only research graph was recorded and paused before execution.',
      'graphId', v_graph.id,
      'bridge', 'grok_read_only_research_v1',
      'taskCount', pg_catalog.jsonb_array_length(p_nodes),
      'workerWoken', false,
      'executionStarted', false
    ),
    v_session.last_event_sequence,
    p_message_id,
    v_link.id
  );

  return v_launch;
end;
$function$;

revoke all on function public.launch_grok_read_only_research_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_read_only_research_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) to service_role;

comment on function public.launch_grok_read_only_research_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) is
  'Service-only, owner-attributed, idempotent launch of the exact immutable Grok research DAG. It records a paused graph and current per-node Claude admission evidence; it never creates or wakes a run.';

do $postflight$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
  );
begin
  if routine_oid is null then
    raise exception 'grok read-only research launcher is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc procedure
     where procedure.oid = routine_oid
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=pg_catalog']
  ) then
    raise exception 'grok read-only research launcher security identity mismatch';
  end if;
  if pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
  then
    raise exception 'grok read-only research launcher ACL mismatch';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class relation
     join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'grok_graph_launches', 'grok_execution_admissions', 'grok_task_links',
        'grok_events', 'grok_specialist_admissions'
      )
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) then
    raise exception 'grok read-only research evidence RLS mismatch';
  end if;
end;
$postflight$;
