-- Project the exact inspection-only subset of a planner-v3 RED deploy intent.
-- The immutable plan keeps its RED intent and owner-gated delivery handoff;
-- this boundary excludes that handoff and records only four GREEN Claude MODEL
-- inspections with zero resources, writes, lifecycle stages, or gates. The
-- graph is atomically paused and no run or wake is created here.

create function public.launch_grok_deploy_readiness_v1_as_server(
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
  v_user_message public.grok_messages;
  v_project public.projects;
  v_plan jsonb;
  v_original_nodes jsonb;
  v_original_edges jsonb;
  v_expected_nodes jsonb;
  v_expected_edges jsonb;
  v_expected_budget jsonb;
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
  v_new public.grok_execution_admissions;
  v_input_sha256 text;
  v_plan_sha256 text;
  v_node_key text;
begin
  if p_requested_by is null
      or p_idempotency_key is null
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
      or p_goal is distinct from
        'Inspect immutable release evidence for the saved RED deploy intent. Do not merge, deploy, mutate resources, wake workers, or claim production.'
      or p_topology is distinct from 'DAG'::public.graph_topology
      or p_risk_level is distinct from 'green'::public.risk_level
      or p_requires_owner_approval is distinct from false
      or pg_catalog.jsonb_typeof(coalesce(p_topology_reasons, 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_typeof(coalesce(p_nodes, 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_nodes) is distinct from 4
      or pg_catalog.jsonb_typeof(coalesce(p_edges, 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_edges) is distinct from 3
      or pg_catalog.jsonb_typeof(coalesce(p_budget, 'null'::jsonb)) is distinct from 'object'
      or pg_catalog.jsonb_typeof(coalesce(p_admissions, 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_admissions) is distinct from 4
  then
    raise exception using errcode = '22023',
      message = 'invalid grok deploy-readiness launch input';
  end if;
  if public.text_has_likely_secret(p_goal)
      or public.text_has_likely_secret(p_topology_reasons::text)
      or public.text_has_likely_secret(p_nodes::text)
      or public.text_has_likely_secret(p_edges::text)
      or public.text_has_likely_secret(p_budget::text)
  then
    raise exception using errcode = '22023',
      message = 'grok deploy-readiness launch contains likely secret material';
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
      message = 'grok deploy-readiness owner, project, or active-session identity mismatch';
  end if;

  select message.* into v_message
    from public.grok_messages message
   where message.id = p_message_id
     and message.organization_id = p_organization_id
     and message.project_id = p_project_id
     and message.session_id = p_session_id;
  if not found
      or v_message.role is distinct from 'assistant'
      or v_message.sequence_no is distinct from 2::bigint
      or v_message.actor_user_id is not null
      or v_message.reply_to_message_id is null
      or v_message.content is distinct from
        'I recorded a deterministic deploy plan with 5 tasks across 3 dependency-safe layers. Execution has not started.'
      or v_message.metadata ->> 'schemaVersion' is distinct from '1'
      or v_message.metadata ->> 'kind' is distinct from 'grok.plan'
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_message.metadata) metadata_key
         where metadata_key not in ('schemaVersion', 'kind', 'plan')
      )
  then
    raise exception using errcode = 'P0002',
      message = 'immutable grok deploy plan message not found';
  end if;

  v_plan := v_message.metadata -> 'plan';
  v_original_nodes := v_plan #> '{graphLaunch,nodes}';
  v_original_edges := v_plan #> '{graphLaunch,edges}';
  if pg_catalog.jsonb_typeof(coalesce(v_plan, 'null'::jsonb)) is distinct from 'object'
      or v_plan #>> '{planner,version}' is distinct from '3'
      or v_plan #>> '{planner,executionStarted}' is distinct from 'false'
      or v_plan #>> '{intent,kind}' is distinct from 'deploy'
      or v_plan #>> '{intent,risk}' is distinct from 'RED'
      or v_plan #>> '{intent,prompt}' is distinct from v_plan #>> '{graphLaunch,goal}'
      or v_plan #>> '{project,projectId}' is distinct from p_project_id::text
      or v_plan #>> '{project,repositoryFullName}' is distinct from v_project.github_repository
      or v_plan #>> '{project,defaultBranch}' is distinct from v_project.default_branch
      or v_plan #>> '{dag,topology}' is distinct from 'DAG'
      or v_plan #>> '{graphLaunch,topology}' is distinct from 'DAG'
      or v_plan #>> '{graphLaunch,riskLevel}' is distinct from 'red'
      or v_plan #>> '{graphLaunch,requiresOwnerApproval}' is distinct from 'true'
      or v_plan #>> '{delivery,mode}' is distinct from 'HANDOFF_ONLY'
      or v_plan #>> '{delivery,taskId}' is distinct from 'delivery'
      or v_plan #>> '{delivery,ownerApprovalRequired}' is distinct from 'true'
      or pg_catalog.jsonb_typeof(coalesce(v_plan #> '{dag,tasks}', 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_plan #> '{dag,tasks}') is distinct from 5
      or pg_catalog.jsonb_typeof(coalesce(v_original_nodes, 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_original_nodes) is distinct from 5
      or pg_catalog.jsonb_typeof(coalesce(v_original_edges, 'null'::jsonb)) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_original_edges) is distinct from 4
  then
    raise exception using errcode = '55000',
      message = 'grok deploy readiness requires the exact immutable RED planner-v3 plan';
  end if;

  select message.* into v_user_message
    from public.grok_messages message
   where message.id = v_message.reply_to_message_id
     and message.organization_id = p_organization_id
     and message.project_id = p_project_id
     and message.session_id = p_session_id
     and message.sequence_no = 1
     and message.role = 'user'
     and message.actor_user_id = p_requested_by;
  if not found
      or pg_catalog.btrim(v_user_message.content) is distinct from v_plan #>> '{intent,prompt}'
  then
    raise exception using errcode = '55000',
      message = 'grok deploy readiness source message identity mismatch';
  end if;

  if (
    select pg_catalog.jsonb_agg(task.value -> 'id' order by task.ordinality)
      from pg_catalog.jsonb_array_elements(v_plan #> '{dag,tasks}')
        with ordinality task(value, ordinality)
  ) is distinct from
    '["inspect_release","verify_release_tests","review_release_security","verification_fan_in","delivery"]'::jsonb
  or (
    select pg_catalog.jsonb_agg(node.value -> 'node_key' order by node.ordinality)
      from pg_catalog.jsonb_array_elements(v_original_nodes)
        with ordinality node(value, ordinality)
  ) is distinct from
    '["inspect_release","verify_release_tests","review_release_security","verification_fan_in","delivery"]'::jsonb
  then
    raise exception using errcode = '55000',
      message = 'grok deploy plan task identity mismatch';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_plan #> '{dag,tasks}') task
     where pg_catalog.jsonb_typeof(task.value) is distinct from 'object'
        or task.value ->> 'title' is distinct from case task.value ->> 'id'
             when 'inspect_release' then 'Release identity inspection'
             when 'verify_release_tests' then 'Release test inspection'
             when 'review_release_security' then 'Release security inspection'
             when 'verification_fan_in' then 'Release readiness fan-in'
             when 'delivery' then 'Delivery handoff'
             else null end
        or task.value ->> 'job' is distinct from case task.value ->> 'id'
             when 'inspect_release' then 'Inspect the exact repository, branch, commit, and existing release evidence. Do not create or mutate a release.'
             when 'verify_release_tests' then 'Inspect exact-head required-check and test evidence without rerunning or inventing a result.'
             when 'review_release_security' then 'Inspect the release evidence for protected-path, secret, migration, and security-policy risk.'
             when 'verification_fan_in' then 'Synthesize exact release identity, tests, and security evidence. Missing or conflicting evidence must block readiness.'
             when 'delivery' then 'Produce the exact delivery handoff package from verified artifacts. This task records readiness only; it must not claim that a merge, deployment, or production change occurred.'
             else null end
        or task.value ->> 'executor' is distinct from 'MODEL'
        or task.value ->> 'lane' is distinct from 'claude_read_only'
        or task.value ->> 'provider' is distinct from 'anthropic'
        or not pg_catalog.pg_input_is_valid(task.value ->> 'assignmentId', 'uuid')
        or task.value ->> 'capability' is distinct from case task.value ->> 'id'
             when 'inspect_release' then 'review'
             when 'verify_release_tests' then 'qa'
             when 'review_release_security' then 'security_review'
             when 'verification_fan_in' then 'synthesis'
             when 'delivery' then 'reporting'
             else null end
        or task.value ->> 'modelTier' is distinct from case task.value ->> 'id'
             when 'verify_release_tests' then 'STANDARD'
             when 'delivery' then 'STANDARD'
             when 'inspect_release' then 'STRONG'
             when 'review_release_security' then 'STRONG'
             when 'verification_fan_in' then 'STRONG'
             else null end
        or task.value ->> 'risk' is distinct from case
             when task.value ->> 'id' = 'delivery' then 'RED' else 'GREEN' end
        or task.value -> 'dependsOn' is distinct from case task.value ->> 'id'
             when 'verification_fan_in' then
               '["inspect_release","verify_release_tests","review_release_security"]'::jsonb
             when 'delivery' then '["verification_fan_in"]'::jsonb
              else '[]'::jsonb end
        or task.value ->> 'maxAttempts' is distinct from case
             when task.value ->> 'id' in ('verification_fan_in', 'delivery') then '1'
             else '2' end
        or task.value ->> 'timeoutMs' is distinct from '480000'
        or task.value ->> 'contextPolicy' is distinct from case
             when task.value ->> 'id' = 'delivery' then 'DEPENDENCY_ARTIFACTS_ONLY'
             else 'FRESH_INDEPENDENT_VERIFIER' end
        or task.value -> 'independentOf' is distinct from '[]'::jsonb
        or task.value -> 'artifacts' is distinct from pg_catalog.jsonb_build_object(
             'consumes', case task.value ->> 'id'
               when 'verification_fan_in' then
                 '["inspect_release.v1","verify_release_tests.v1","review_release_security.v1"]'::jsonb
               when 'delivery' then '["verification_fan_in.v1"]'::jsonb
               else '[]'::jsonb end,
             'produces', (task.value ->> 'id') || '.v1',
             'schemaVersion', 1
           )
        or task.value -> 'contract' is distinct from pg_catalog.jsonb_build_object(
             'input', case
               when task.value ->> 'id' in ('verification_fan_in', 'delivery') then 'DEPENDENCY_ENVELOPE'
               else 'GOAL' end,
             'outputArtifact', case task.value ->> 'id'
               when 'inspect_release' then 'release_identity'
               when 'verify_release_tests' then 'release_test_evidence'
               when 'review_release_security' then 'release_security_evidence'
               when 'verification_fan_in' then 'release_readiness'
               when 'delivery' then 'delivery_handoff'
               else null end,
             'acceptsPartialInputs', false
           )
        or task.value -> 'gate' is distinct from case
             when task.value ->> 'id' = 'delivery' then
               '{"kind":"HUMAN","requiredRole":"owner","reason":"RED delivery requires the owner to approve exact immutable evidence before any external action."}'::jsonb
             else 'null'::jsonb end
  ) then
    raise exception using errcode = '55000',
      message = 'grok deploy task contract mismatch';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_original_nodes) node
     where pg_catalog.jsonb_typeof(node.value) is distinct from 'object'
        or node.value ->> 'job' is distinct from case node.value ->> 'node_key'
             when 'inspect_release' then 'Inspect the exact repository, branch, commit, and existing release evidence. Do not create or mutate a release.'
             when 'verify_release_tests' then 'Inspect exact-head required-check and test evidence without rerunning or inventing a result.'
             when 'review_release_security' then 'Inspect the release evidence for protected-path, secret, migration, and security-policy risk.'
             when 'verification_fan_in' then 'Synthesize exact release identity, tests, and security evidence. Missing or conflicting evidence must block readiness.'
             when 'delivery' then 'Produce the exact delivery handoff package from verified artifacts. This task records readiness only; it must not claim that a merge, deployment, or production change occurred.'
             else null end
        or node.value ->> 'executor' is distinct from 'MODEL'
        or node.value ->> 'capability' is distinct from case node.value ->> 'node_key'
             when 'inspect_release' then 'review'
             when 'verify_release_tests' then 'qa'
             when 'review_release_security' then 'security_review'
             when 'verification_fan_in' then 'synthesis'
             when 'delivery' then 'reporting'
             else null end
        or node.value ->> 'model_tier' is distinct from case node.value ->> 'node_key'
             when 'verify_release_tests' then 'STANDARD'
             when 'delivery' then 'STANDARD'
             when 'inspect_release' then 'STRONG'
             when 'review_release_security' then 'STRONG'
             when 'verification_fan_in' then 'STRONG'
             else null end
        or node.value ->> 'risk_level' is distinct from case
             when node.value ->> 'node_key' = 'delivery' then 'red' else 'green' end
        or node.value ->> 'timeout_ms' is distinct from '480000'
        or node.value ->> 'max_attempts' is distinct from case
             when node.value ->> 'node_key' in ('verification_fan_in', 'delivery') then '1'
             else '2' end
        or node.value ->> 'allow_provider_fallback' is distinct from 'false'
        or node.value ->> 'tolerates_partial_inputs' is distinct from 'false'
        or pg_catalog.jsonb_typeof(coalesce(node.value -> 'input_schema', 'null'::jsonb)) is distinct from 'object'
        or pg_catalog.jsonb_typeof(coalesce(node.value -> 'output_schema', 'null'::jsonb)) is distinct from 'object'
        or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
             pg_catalog.jsonb_build_object(
               'input_schema', node.value -> 'input_schema',
               'output_schema', node.value -> 'output_schema'
             )::text,
             'UTF8'
           )), 'hex') is distinct from case node.value ->> 'node_key'
             when 'inspect_release' then 'efc2a28df64601a3048798cfacb08b459097ad9a952588c662fc0adfe2cd380e'
             when 'verify_release_tests' then 'dc42d15d4a9e9ce60cdeae79c3e148a8aca7f096c68a87a2c069938d0a933b3b'
             when 'review_release_security' then '7cc588fde1620c83108d1335e10a48e05914aaa42174af03abe73dee7a47e21c'
             when 'verification_fan_in' then 'cf53dc6e3d1892c9f72d5afd8d7c1071a2b79eed4aa41f0fcc80fa5ec189bd95'
             when 'delivery' then 'ca1bc59f0ab120842b45982958a618f97f80f7fb8d3479f08303a39a20719142'
             else null end
        or node.value -> 'lifecycle_stage' is distinct from 'null'::jsonb
        or node.value -> 'gate_kind' is distinct from case
             when node.value ->> 'node_key' = 'delivery' then '"HUMAN"'::jsonb
             else 'null'::jsonb end
        or node.value -> 'writes' is distinct from '[]'::jsonb
        or node.value -> 'reads' is distinct from pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'kind', 'directory',
               'id', (v_plan #>> '{project,repositoryFullName}') || ':read-only-snapshot'
             )
           )
  ) then
    raise exception using errcode = '55000',
      message = 'grok deploy node contract is not exact read-only planner work';
  end if;

  if (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'from', edge.value ->> 'from_node_key',
        'to', edge.value ->> 'to_node_key',
        'feedback', edge.value -> 'is_feedback'
      ) order by edge.ordinality
    )
      from pg_catalog.jsonb_array_elements(v_original_edges)
        with ordinality edge(value, ordinality)
  ) is distinct from '[
    {"from":"inspect_release","to":"verification_fan_in","feedback":false},
    {"from":"verify_release_tests","to":"verification_fan_in","feedback":false},
    {"from":"review_release_security","to":"verification_fan_in","feedback":false},
    {"from":"verification_fan_in","to":"delivery","feedback":false}
  ]'::jsonb
  then
    raise exception using errcode = '55000',
      message = 'grok deploy dependency graph is not the exact acyclic readiness fan-in';
  end if;

  if v_plan #> '{graphLaunch,budget}' is distinct from
      '{"max_nodes":5,"max_concurrent_nodes":3,"max_duration_ms":5400000,"max_retries":3,"max_discovery_rounds":0}'::jsonb
  then
    raise exception using errcode = '55000',
      message = 'grok deploy planner-v3 budget mismatch';
  end if;

  select pg_catalog.jsonb_agg(
           (node.value - 'risk_level' - 'reads' - 'writes' - 'lifecycle_stage' - 'gate_kind')
           || pg_catalog.jsonb_build_object(
             'risk_level', 'green',
             'reads', '[]'::jsonb,
             'writes', '[]'::jsonb,
             'lifecycle_stage', null,
             'gate_kind', null
           )
           order by node.ordinality
         ) into v_expected_nodes
    from pg_catalog.jsonb_array_elements(v_original_nodes)
      with ordinality node(value, ordinality)
   where node.value ->> 'node_key' is distinct from 'delivery';
  select pg_catalog.jsonb_agg(edge.value order by edge.ordinality)
    into v_expected_edges
    from pg_catalog.jsonb_array_elements(v_original_edges)
      with ordinality edge(value, ordinality)
   where edge.value ->> 'from_node_key' is distinct from 'delivery'
     and edge.value ->> 'to_node_key' is distinct from 'delivery';
  v_expected_budget :=
    '{"max_nodes":4,"max_concurrent_nodes":3,"max_duration_ms":5400000,"max_retries":3,"max_discovery_rounds":0}'::jsonb;

  if p_topology_reasons is distinct from v_plan #> '{graphLaunch,topologyReasons}'
      or p_nodes is distinct from v_expected_nodes
      or p_edges is distinct from v_expected_edges
      or p_budget is distinct from v_expected_budget
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(p_nodes) node
         where pg_catalog.jsonb_typeof(node.value) is distinct from 'object'
            or node.value ->> 'executor' is distinct from 'MODEL'
            or node.value ->> 'risk_level' is distinct from 'green'
            or node.value -> 'reads' is distinct from '[]'::jsonb
            or node.value -> 'writes' is distinct from '[]'::jsonb
            or node.value -> 'lifecycle_stage' is distinct from 'null'::jsonb
            or node.value -> 'gate_kind' is distinct from 'null'::jsonb
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(p_edges) edge
         where pg_catalog.jsonb_typeof(edge.value) is distinct from 'object'
            or edge.value ->> 'is_feedback' is distinct from 'false'
      )
  then
    raise exception using errcode = '55000',
      message = 'grok deploy-readiness input does not match the exact safe projection';
  end if;

  -- The v2 boundary rejects null/missing roster versions before it delegates
  -- to the immutable roster recorder and locks every current source row.
  perform public.record_grok_specialist_roster_v2_as_server(
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
     where pg_catalog.jsonb_typeof(admission.value) is distinct from 'object'
        or admission.value ->> 'version' is distinct from '2'
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
    having pg_catalog.count(*) is distinct from 1
  ) then
    raise exception using errcode = '22023',
      message = 'invalid or duplicate grok deploy-readiness admission entry';
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
        or pg_catalog.pg_input_is_valid(v_entry ->> 'sourceRosterAssignmentId', 'uuid') is distinct from true
        or pg_catalog.pg_input_is_valid(v_entry ->> 'assignmentId', 'uuid') is distinct from true
        or v_entry ->> 'sourceRosterAssignmentId' is distinct from v_entry ->> 'assignmentId'
    then
      raise exception using errcode = '22023',
        message = 'invalid grok deploy-readiness admission identity';
    end if;

    select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(node.value) -> 0
      into v_matching_count, v_node_input
      from pg_catalog.jsonb_array_elements(p_nodes) node
     where node.value ->> 'node_key' = v_node_key;
    select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(task.value) -> 0
      into v_expected_count, v_task
      from pg_catalog.jsonb_array_elements(v_plan #> '{dag,tasks}') task
     where task.value ->> 'id' = v_node_key;
    if v_matching_count is distinct from 1
        or v_expected_count is distinct from 1
        or v_node_input ->> 'capability' is distinct from v_entry ->> 'capability'
        or v_task ->> 'executor' is distinct from 'MODEL'
        or v_task ->> 'provider' is distinct from 'anthropic'
        or v_task ->> 'assignmentId' is distinct from v_entry ->> 'assignmentId'
        or v_task ->> 'capability' is distinct from v_entry ->> 'capability'
        or v_task ->> 'modelTier' is distinct from v_node_input ->> 'model_tier'
        or v_task ->> 'model' is distinct from v_entry ->> 'model'
    then
      raise exception using errcode = '55000',
        message = 'grok deploy-readiness admission does not match its exact planner task';
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
        message = 'grok deploy-readiness admission does not match immutable specialist evidence';
    end if;
  end loop;

  v_plan_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    v_plan::text, 'UTF8'
  )), 'hex');
  v_input_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bridge', 'grok_deploy_readiness_v1',
      'sourceIntent', 'deploy',
      'sourceRisk', 'RED',
      'sourcePlanSha256', v_plan_sha256,
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
      'excludedTasks', pg_catalog.jsonb_build_array('delivery'),
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
        or v_graph.goal is distinct from p_goal
        or v_graph.topology is distinct from 'DAG'::public.graph_topology
        or v_graph.risk_level is distinct from 'green'::public.risk_level
        or v_graph.requires_owner_approval is distinct from false
        or v_graph.pause_requested_at is null
        or v_graph.withdrawn_at is not null
        or v_graph.is_lifecycle is distinct from false
        or v_graph.template_key is not null
        or (select pg_catalog.count(*) from public.graph_nodes node
             where node.organization_id = p_organization_id
               and node.graph_id = v_existing.graph_id) is distinct from 4::bigint
        or exists (
          select 1 from public.graph_nodes node
           where node.organization_id = p_organization_id
             and node.graph_id = v_existing.graph_id
             and (node.lifecycle_stage is not null or node.gate_kind is not null)
        )
        or exists (
          select 1
            from public.graph_nodes node
            join public.node_contracts contract
              on contract.node_id = node.id
             and contract.organization_id = node.organization_id
           where node.organization_id = p_organization_id
             and node.graph_id = v_existing.graph_id
             and (
               contract.reads is distinct from '[]'::jsonb
               or contract.writes is distinct from '[]'::jsonb
             )
        )
        or exists (
          select 1 from public.graph_gates gate
           where gate.organization_id = p_organization_id
             and gate.graph_id = v_existing.graph_id
        )
        or exists (
          select 1 from public.graph_runs run
           where run.organization_id = p_organization_id
             and run.graph_id = v_existing.graph_id
        )
    then
      raise exception using errcode = '22023',
        message = 'grok deploy-readiness idempotency key conflicts with durable evidence';
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
      or v_graph.goal is distinct from p_goal
      or v_graph.topology is distinct from 'DAG'::public.graph_topology
      or v_graph.risk_level is distinct from 'green'::public.risk_level
      or v_graph.requires_owner_approval is distinct from false
      or v_graph.pause_requested_at is null
      or v_graph.pause_requested_by is distinct from p_requested_by
      or v_graph.withdrawn_at is not null
      or v_graph.is_lifecycle is distinct from false
      or v_graph.template_key is not null
      or (select pg_catalog.count(*) from public.graph_nodes node
           where node.organization_id = p_organization_id
             and node.graph_id = v_graph.id) is distinct from 4::bigint
      or exists (
        select 1 from public.graph_nodes node
         where node.organization_id = p_organization_id
           and node.graph_id = v_graph.id
           and (node.lifecycle_stage is not null or node.gate_kind is not null)
      )
      or exists (
        select 1
          from public.graph_nodes node
          join public.node_contracts contract
            on contract.node_id = node.id
           and contract.organization_id = node.organization_id
         where node.organization_id = p_organization_id
           and node.graph_id = v_graph.id
           and (
             contract.reads is distinct from '[]'::jsonb
             or contract.writes is distinct from '[]'::jsonb
           )
      )
      or exists (
        select 1 from public.graph_gates gate
         where gate.organization_id = p_organization_id
           and gate.graph_id = v_graph.id
      )
      or exists (
        select 1 from public.graph_runs run
         where run.organization_id = p_organization_id
           and run.graph_id = v_graph.id
      )
  then
    raise exception using errcode = '55000',
      message = 'grok deploy-readiness graph was not atomically contained';
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
        message = 'persisted deploy-readiness node does not match provider admission';
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
  if v_admission_count is distinct from 4
      or public.assert_current_grok_execution_admissions(v_graph.id) is distinct from true
  then
    raise exception using errcode = '55000',
      message = 'grok deploy-readiness execution admission set is incomplete';
  end if;

  perform public.record_grok_event_as_server(
    p_organization_id,
    p_session_id,
    'graph.planned',
    v_graph.id,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'detail', 'The exact read-only release-readiness graph was recorded and paused before execution. The RED delivery handoff remains only in the immutable plan.',
      'graphId', v_graph.id,
      'bridge', 'grok_deploy_readiness_v1',
      'sourceIntent', 'deploy',
      'sourceRisk', 'RED',
      'projectedRisk', 'GREEN',
      'excludedTasks', pg_catalog.jsonb_build_array('delivery'),
      'taskCount', 4,
      'resourceCount', 0,
      'gateCount', 0,
      'workerWoken', false,
      'executionStarted', false,
      'productionChanged', false
    ),
    v_session.last_event_sequence,
    p_message_id,
    v_link.id
  );

  return v_launch;
end;
$function$;

revoke all on function public.launch_grok_deploy_readiness_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_deploy_readiness_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) to service_role;

comment on function public.launch_grok_deploy_readiness_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) is
  'Service-only, owner-attributed projection of the exact non-delivery inspection subset from an immutable RED Grok deploy plan. It records a resource-free GREEN graph, pauses it atomically, and never creates or wakes a run.';

do $postflight$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'public.launch_grok_deploy_readiness_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
  );
begin
  if routine_oid is null then
    raise exception 'grok deploy-readiness launcher is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc procedure
     where procedure.oid = routine_oid
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=pg_catalog']
  ) then
    raise exception 'grok deploy-readiness launcher security identity mismatch';
  end if;
  if pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
  then
    raise exception 'grok deploy-readiness launcher ACL mismatch';
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
    raise exception 'grok deploy-readiness evidence RLS mismatch';
  end if;
end;
$postflight$;
