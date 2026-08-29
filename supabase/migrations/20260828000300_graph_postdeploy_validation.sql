-- Full Lifecycle v2: complete MONITOR only after a release-bound public
-- observation window, exact-sha health/readiness, Supabase reachability,
-- tenant-auth refusal, required CI, and security headers all pass.
--
-- Vercel's immutable deployment URL remains the provider identity even when
-- Deployment Protection makes it return 302. The project production URL is
-- the independently configured public surface. Its /api/health response binds
-- that surface back to the exact merge SHA before this function advances the
-- bridge from DEPLOYMENT_RECORDED through MONITORING_RECORDED to VALIDATED.

-- The stronger DEPLOY and MONITOR artifacts deliberately change the built-in
-- full_lifecycle v2 launch plan. Replace exactly the one canonical digest in
-- the already-hardened launch boundary instead of restating its large body:
-- pg_get_functiondef gives us that exact installed definition, the preflight
-- proves its signature/security/ACL and every structural guard from 27000200,
-- and a one-occurrence replacement admits only the new canonical plan.
do $full_lifecycle_v2_postdeploy_plan$
declare
  function_record record;
  updated_definition text;
  old_digest constant text :=
    'ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09';
  new_digest constant text :=
    '0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49';
  old_digest_count integer;
begin
  select routine.prosecdef, routine.proconfig, routine.prosrc,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
         pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
         pg_catalog.pg_get_functiondef(routine.oid) as definition
    into function_record
  from pg_catalog.pg_proc routine
  where routine.oid =
    'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)'::pg_catalog.regprocedure;
  if not found
    or function_record.owner_name <> 'postgres'
    or not function_record.prosecdef
    or function_record.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or function_record.source_md5 <> 'd6e614af6d985a9b6a9adaddc1c1d3ba'
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.strpos(function_record.prosrc,
      'exact built-in full_lifecycle v2 launch identity is required') = 0
    or pg_catalog.strpos(function_record.prosrc,
      'graph does not match the built-in full_lifecycle v2 structural contract') = 0
    or pg_catalog.strpos(function_record.prosrc,
      'graph edges do not match the built-in full_lifecycle v2 structural contract') = 0
    or pg_catalog.strpos(function_record.prosrc, 'valid_anchor_nodes <> 6') = 0
    or pg_catalog.strpos(function_record.prosrc,
      'connected selected GitHub default-branch identity is required') = 0
    or pg_catalog.strpos(function_record.prosrc, new_digest) > 0
  then
    raise exception 'full_lifecycle v2 launch boundary does not match the exact pre-update contract';
  end if;

  old_digest_count := (
    pg_catalog.length(function_record.definition)
      - pg_catalog.length(pg_catalog.replace(function_record.definition, old_digest, ''))
  ) / pg_catalog.length(old_digest);
  if old_digest_count <> 1 then
    raise exception 'full_lifecycle v2 launch boundary does not contain one exact prior digest';
  end if;

  updated_definition := pg_catalog.replace(
    function_record.definition, old_digest, new_digest
  );
  execute updated_definition;

  select routine.prosecdef, routine.proconfig, routine.prosrc,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
         pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5
    into function_record
  from pg_catalog.pg_proc routine
  where routine.oid =
    'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)'::pg_catalog.regprocedure;
  if not found
    or function_record.owner_name <> 'postgres'
    or not function_record.prosecdef
    or function_record.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or function_record.source_md5 <> '878b6df53f450d723a4ef7da9dd677b2'
    or pg_catalog.strpos(function_record.prosrc, old_digest) > 0
    or pg_catalog.strpos(function_record.prosrc, new_digest) = 0
  then
    raise exception 'full_lifecycle v2 canonical post-deploy plan replacement failed';
  end if;
end;
$full_lifecycle_v2_postdeploy_plan$;

revoke all on function public.create_graph_from_plan_with_release_identity_as_server(
  uuid, uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean,
  jsonb, jsonb, jsonb, text, integer, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_graph_from_plan_with_release_identity_as_server(
  uuid, uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean,
  jsonb, jsonb, jsonb, text, integer, uuid, text, text, jsonb
) to service_role;

create or replace function public.complete_graph_run_with_validated_release_as_worker(
  p_worker_id text,
  p_graph_run_id uuid,
  p_state public.graph_run_state,
  p_had_partial_input boolean default false,
  p_tokens_used bigint default null,
  p_cost_micros bigint default null,
  p_budget_action text default null,
  p_closure_note text default null
)
returns public.graph_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.graph_runs%rowtype;
  graph_record public.graphs%rowtype;
  project_record public.projects%rowtype;
  bridge_record public.graph_phase1c_bridges%rowtype;
  deployment_record public.deployments%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  monitor_record public.production_monitors%rowtype;
  validation_record public.deployment_validations%rowtype;
  observation_id uuid;
  validation_id uuid;
  monitor_id uuid;
  monitor_count integer;
  graph_node_count integer;
  node_run_count integer;
  monitor_node_count integer;
  monitor_artifact_count integer;
  required_stage_count integer;
  invalid_check_count integer;
  monitor_node_started_at timestamptz;
  normalized_closure_note text := nullif(pg_catalog.btrim(coalesce(p_closure_note, '')), '');
  public_url text;
  deployment_url text;
  target_reference_value text;
  observed_at timestamptz;
  validation_started_at timestamptz;
  validation_completed_at timestamptz;
  observed_status integer;
  observed_latency integer;
  correlation_id uuid := gen_random_uuid();
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_state <> 'COMPLETED'::public.graph_run_state then
    return public.complete_graph_run_with_phase1c_bridge_as_worker(
      p_worker_id, p_graph_run_id, p_state, p_had_partial_input,
      p_tokens_used, p_cost_micros, p_budget_action, p_closure_note
    );
  end if;
  if normalized_closure_note is not null
    and pg_catalog.char_length(normalized_closure_note) > 2000
  then
    normalized_closure_note := pg_catalog.left(normalized_closure_note, 1997) || '...';
  end if;

  select * into run_record
  from public.graph_runs run
  where run.id = p_graph_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph_run_not_found';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = run_record.graph_id
    and graph.organization_id = run_record.organization_id;
  -- Only the exact revised plan owns the stronger artifact schemas. Existing
  -- Full Lifecycle v2 rows retain their stored DEPLOY/MONITOR contracts and
  -- continue through the predecessor completion boundary.
  if not found
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or graph_record.template_plan_sha256 is distinct from
      '0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49'
  then
    return public.complete_graph_run_with_phase1c_bridge_as_worker(
      p_worker_id, p_graph_run_id, p_state, p_had_partial_input,
      p_tokens_used, p_cost_micros, p_budget_action, p_closure_note
    );
  end if;

  -- Lost-response replay returns only after the exact terminal and validated
  -- identities are still present. It never writes duplicate evidence.
  if run_record.state in (
    'COMPLETED'::public.graph_run_state,
    'PARTIAL'::public.graph_run_state,
    'FAILED'::public.graph_run_state,
    'CANCELLED'::public.graph_run_state,
    'BUDGET_STOPPED'::public.graph_run_state
  ) then
    if run_record.state <> 'COMPLETED'::public.graph_run_state
      or run_record.had_partial_input
      or p_had_partial_input
      or (p_tokens_used is not null and run_record.tokens_used is distinct from p_tokens_used)
      or (p_cost_micros is not null and run_record.cost_micros is distinct from p_cost_micros)
      or (p_budget_action is not null and run_record.budget_action is distinct from p_budget_action)
      or run_record.closure_note is distinct from normalized_closure_note
      or run_record.completed_at is null
    then
      raise exception using errcode = '55000',
        message = 'terminal graph run does not match exact validated completion replay';
    end if;
    select * into bridge_record
    from public.graph_phase1c_bridges bridge
    where bridge.id = run_record.phase1c_bridge_id
      and bridge.organization_id = run_record.organization_id
      and bridge.graph_id = graph_record.id
      and bridge.project_id = graph_record.project_id;
    if not found
      or bridge_record.state <> 'VALIDATED'
      or bridge_record.monitor_observation_id is null
      or bridge_record.deployment_validation_id is null
      or not exists (
        select 1
        from public.deployment_validations validation
        join public.monitor_observations observation
          on observation.id = bridge_record.monitor_observation_id
         and observation.organization_id = validation.organization_id
         and observation.project_id = validation.project_id
         and observation.deployment_id = validation.deployment_id
         and observation.correlation_id = validation.correlation_id
        join public.production_monitors monitor
          on monitor.id = observation.monitor_id
         and monitor.organization_id = observation.organization_id
         and monitor.project_id = observation.project_id
        join public.deployments release
          on release.id = validation.deployment_id
         and release.organization_id = validation.organization_id
         and release.project_id = validation.project_id
        join public.projects project
          on project.id = validation.project_id
         and project.organization_id = validation.organization_id
        where validation.id = bridge_record.deployment_validation_id
          and validation.organization_id = bridge_record.organization_id
          and validation.project_id = bridge_record.project_id
          and validation.deployment_id = bridge_record.deployment_id
          and validation.state = 'passed'::public.deployment_validation_state
          and validation.validator_version = 'graph-production-validator-v3'
          and validation.policy_version = 'post-deploy-v1'
          and validation.baseline_reference = 'release:' || bridge_record.merge_commit_sha
          and pg_catalog.jsonb_typeof(validation.checks) = 'array'
          and pg_catalog.jsonb_array_length(validation.checks) = 5
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(validation.checks) replay_check
            where replay_check ->> 'stage' not in (
                'identity','availability','data_integration','quality_security','observation'
              )
              or replay_check -> 'required' is distinct from 'true'::jsonb
              or replay_check ->> 'result' is distinct from 'pass'
          )
          and (
            select pg_catalog.count(distinct replay_check ->> 'stage')
            from pg_catalog.jsonb_array_elements(validation.checks) replay_check
          ) = 5
          and validation.started_at is not null
          and validation.completed_at is not null
          and release.status = 'succeeded'::public.deployment_status
          and release.completed_at is not null
          and pg_catalog.lower(release.commit_sha) = bridge_record.merge_commit_sha
          and observation.outcome = 'pass'::public.signal_outcome
          and observation.status_code between 200 and 299
          and observation.evidence ->> 'deploymentId' = bridge_record.deployment_id::text
          and pg_catalog.rtrim(coalesce(observation.evidence ->> 'deploymentUrl', ''), '/') =
            pg_catalog.rtrim(coalesce(release.url, ''), '/')
          and observation.evidence ->> 'postDeployValidation' = 'passed'
          and pg_catalog.lower(coalesce(observation.evidence ->> 'releaseSha', '')) =
            bridge_record.merge_commit_sha
          and monitor.signal_kind = 'uptime'::public.production_signal_kind
          and monitor.provider = 'http'
          and monitor.target_reference = 'graph_phase1c_bridge:' || bridge_record.id::text
          and pg_catalog.rtrim(coalesce(monitor.target_url, ''), '/') =
            pg_catalog.rtrim(coalesce(observation.evidence ->> 'url', ''), '/')
          and pg_catalog.rtrim(coalesce(monitor.target_url, ''), '/') =
            pg_catalog.rtrim(coalesce(project.production_url, ''), '/')
          and monitor.connection_state = 'connected'::public.monitor_connection_state
          and not monitor.enabled
      )
    then
      raise exception using errcode = '55000',
        message = 'terminal lifecycle replay has no exact passing validation lineage';
    end if;
    return run_record;
  end if;

  if p_had_partial_input then
    raise exception using errcode = '55000',
      message = 'validated lifecycle completion cannot have partial input';
  end if;

  -- Parent lock first, then the complete child set: no terminal parent can be
  -- committed over a missing, in-flight, failed, or foreign child.
  perform 1
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id
  order by node_run.id
  for update;

  select pg_catalog.count(*)::integer into graph_node_count
  from public.graph_nodes node
  where node.graph_id = graph_record.id
    and node.organization_id = graph_record.organization_id;
  select pg_catalog.count(*)::integer into node_run_count
  from public.node_runs node_run
  join public.graph_nodes node
    on node.id = node_run.node_id
   and node.organization_id = node_run.organization_id
   and node.graph_id = graph_record.id
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id;
  if graph_node_count < 1
    or node_run_count <> graph_node_count
    or exists (
      select 1 from public.node_runs node_run
      where node_run.graph_run_id = run_record.id
        and node_run.organization_id = run_record.organization_id
        and node_run.state <> 'COMPLETED'::public.graph_node_state
    )
  then
    raise exception using errcode = '55000',
      message = 'validated lifecycle completion requires every exact child to be complete';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = run_record.phase1c_bridge_id
    and bridge.organization_id = graph_record.organization_id
    and bridge.graph_id = graph_record.id
    and bridge.project_id = graph_record.project_id
  for update;
  if not found or bridge_record.state <> 'DEPLOYMENT_RECORDED' then
    raise exception using errcode = '55000',
      message = 'validated lifecycle requires an exact recorded deployment bridge';
  end if;

  select * into deployment_record
  from public.deployments deployment
  where deployment.id = bridge_record.deployment_id
    and deployment.organization_id = bridge_record.organization_id
    and deployment.project_id = bridge_record.project_id
  for share;
  deployment_url := pg_catalog.rtrim(coalesce(deployment_record.url, ''), '/');
  if not found
    or deployment_url !~ '^https://[^/@?#[:space:]]+(?::[0-9]+)?(?:/[^?#[:cntrl:]\\]*)?$'
    or pg_catalog.strpos(deployment_url, '?') > 0
    or pg_catalog.strpos(deployment_url, '#') > 0
    or public.text_has_likely_secret(deployment_url)
    or deployment_record.status <> 'succeeded'::public.deployment_status
    or deployment_record.completed_at is null
    or pg_catalog.lower(deployment_record.commit_sha) is distinct from bridge_record.merge_commit_sha
  then
    raise exception using errcode = '55000',
      message = 'validated lifecycle deployment identity is incomplete or conflicting';
  end if;

  select * into project_record
  from public.projects project
  where project.id = bridge_record.project_id
    and project.organization_id = bridge_record.organization_id
  for share;
  public_url := pg_catalog.rtrim(coalesce(project_record.production_url, ''), '/');
  if not found
    or public_url !~ '^https://[^/@?#[:space:]]+(?::[0-9]+)?(?:/[^?#[:cntrl:]\\]*)?$'
    or pg_catalog.strpos(public_url, '?') > 0
    or pg_catalog.strpos(public_url, '#') > 0
    or public.text_has_likely_secret(public_url)
    or deployment_url = ''
    or public_url = deployment_url
  then
    raise exception using errcode = '55000',
      message = 'project has no safe public production URL distinct from deployment identity';
  end if;

  select pg_catalog.count(*)::integer into monitor_node_count
  from public.graph_nodes node
  where node.organization_id = graph_record.organization_id
    and node.graph_id = graph_record.id
    and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage;
  select pg_catalog.count(*)::integer into monitor_artifact_count
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  join public.graph_nodes node
    on node.id = node_run.node_id
   and node.organization_id = node_run.organization_id
   and node.graph_id = graph_record.id
  where artifact.organization_id = graph_record.organization_id
    and artifact.graph_run_id = run_record.id
    and artifact.kind = 'ANCHOR'::public.graph_artifact_kind
    and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage
    and node_run.state = 'COMPLETED'::public.graph_node_state;
  if monitor_node_count <> 1 or monitor_artifact_count <> 1 then
    raise exception using errcode = '55000',
      message = 'validated lifecycle requires one completed monitor and one anchor artifact';
  end if;

  select artifact.* into artifact_record
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  join public.graph_nodes node
    on node.id = node_run.node_id
   and node.organization_id = node_run.organization_id
   and node.graph_id = graph_record.id
  where artifact.organization_id = graph_record.organization_id
    and artifact.graph_run_id = run_record.id
    and artifact.kind = 'ANCHOR'::public.graph_artifact_kind
    and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage
    and node_run.state = 'COMPLETED'::public.graph_node_state
  limit 1;
  if not found
    or pg_catalog.octet_length(artifact_record.payload::text) > 32768
    or public.jsonb_has_sensitive_keys(artifact_record.payload)
    or artifact_record.payload ->> 'observation' is distinct from 'production_http_probe'
    or artifact_record.payload ->> 'deploymentId' is distinct from bridge_record.deployment_id::text
    or pg_catalog.rtrim(coalesce(artifact_record.payload ->> 'deploymentUrl', ''), '/') is distinct from deployment_url
    or pg_catalog.rtrim(coalesce(artifact_record.payload ->> 'url', ''), '/') is distinct from public_url
    or pg_catalog.lower(coalesce(artifact_record.payload ->> 'releaseSha', '')) is distinct from bridge_record.merge_commit_sha
    or artifact_record.payload -> 'healthy' is distinct from 'true'::jsonb
    or artifact_record.payload ->> 'postDeployValidation' is distinct from 'passed'
    or artifact_record.payload -> 'observationWindowComplete' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(artifact_record.payload -> 'checks') <> 'array'
    or pg_catalog.jsonb_array_length(artifact_record.payload -> 'checks') <> 5
    or coalesce(artifact_record.payload ->> 'status', '') !~ '^2[0-9]{2}$'
    or coalesce(artifact_record.payload ->> 'latencyMs', '') !~ '^[0-9]{1,6}$'
    or coalesce(artifact_record.payload ->> 'observedAt', '') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    or coalesce(artifact_record.payload ->> 'startedAt', '') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    or coalesce(artifact_record.payload ->> 'completedAt', '') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
  then
    raise exception using errcode = '55000',
      message = 'monitor artifact does not contain exact passing post-deploy evidence';
  end if;

  select pg_catalog.count(distinct check_item ->> 'stage')::integer,
         pg_catalog.count(*) filter (where
           check_item ->> 'stage' not in ('identity','availability','data_integration','quality_security','observation')
           or check_item -> 'required' is distinct from 'true'::jsonb
           or check_item ->> 'result' <> 'pass'
           or coalesce(check_item ->> 'name', '') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
         )::integer
    into required_stage_count, invalid_check_count
  from pg_catalog.jsonb_array_elements(artifact_record.payload -> 'checks') check_item;
  if required_stage_count <> 5 or invalid_check_count <> 0 then
    raise exception using errcode = '55000',
      message = 'post-deploy evidence did not pass every required validation stage';
  end if;

  select node_run.started_at into monitor_node_started_at
  from public.node_runs node_run
  where node_run.id = artifact_record.node_run_id
    and node_run.organization_id = artifact_record.organization_id
    and node_run.graph_run_id = artifact_record.graph_run_id;
  observed_status := (artifact_record.payload ->> 'status')::integer;
  observed_latency := (artifact_record.payload ->> 'latencyMs')::integer;
  observed_at := (artifact_record.payload ->> 'observedAt')::timestamptz;
  validation_started_at := (artifact_record.payload ->> 'startedAt')::timestamptz;
  validation_completed_at := (artifact_record.payload ->> 'completedAt')::timestamptz;
  if monitor_node_started_at is null
    or validation_started_at < deployment_record.completed_at
    or validation_started_at < monitor_node_started_at
    or observed_at < validation_started_at
    or validation_completed_at < observed_at
    or validation_completed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
    or artifact_record.created_at < validation_started_at - interval '5 minutes'
    or artifact_record.created_at > validation_completed_at + interval '10 minutes'
    or observed_latency > 600000
  then
    raise exception using errcode = '55000',
      message = 'post-deploy validation timing does not follow the recorded deployment';
  end if;

  -- The base closer and all evidence writes share this transaction. Any
  -- lineage mismatch rolls the terminal parent back with the evidence.
  run_record := public.complete_graph_run_as_worker(
    p_worker_id, p_graph_run_id, p_state, false,
    p_tokens_used, p_cost_micros, p_budget_action, normalized_closure_note
  );

  target_reference_value := 'graph_phase1c_bridge:' || bridge_record.id::text;
  select pg_catalog.count(*)::integer, min(monitor.id::text)::uuid
    into monitor_count, monitor_id
  from public.production_monitors monitor
  where monitor.organization_id = bridge_record.organization_id
    and monitor.project_id = bridge_record.project_id
    and monitor.target_reference = target_reference_value;
  if monitor_count > 1 then
    raise exception using errcode = '55000', message = 'graph production monitor identity is ambiguous';
  elsif monitor_count = 1 then
    select * into monitor_record
    from public.production_monitors monitor
    where monitor.id = monitor_id
    for update;
    if monitor_record.signal_kind <> 'uptime'::public.production_signal_kind
      or monitor_record.provider <> 'http'
      or pg_catalog.rtrim(coalesce(monitor_record.target_url, ''), '/') is distinct from public_url
      or monitor_record.connection_state <> 'connected'::public.monitor_connection_state
      or monitor_record.enabled
      or monitor_record.expected_status_code <> observed_status
    then
      raise exception using errcode = '55000', message = 'stored production monitor conflicts with validation evidence';
    end if;
  else
    insert into public.production_monitors (
      organization_id, project_id, name, signal_kind, provider, target_url,
      target_reference, connection_state, enabled, expected_status_code,
      last_observed_at, last_outcome, created_by
    ) values (
      bridge_record.organization_id, bridge_record.project_id,
      'Full lifecycle validation ' || bridge_record.deployment_id::text,
      'uptime'::public.production_signal_kind, 'http', public_url,
      target_reference_value, 'connected'::public.monitor_connection_state,
      false, observed_status, observed_at, 'pass'::public.signal_outcome,
      bridge_record.created_by
    ) returning * into monitor_record;
  end if;

  insert into public.monitor_observations (
    organization_id, project_id, monitor_id, deployment_id, signal_kind,
    outcome, latency_ms, status_code, evidence, correlation_id, observed_at
  ) values (
    bridge_record.organization_id, bridge_record.project_id, monitor_record.id,
    bridge_record.deployment_id, 'uptime'::public.production_signal_kind,
    'pass'::public.signal_outcome, observed_latency, observed_status,
    artifact_record.payload || pg_catalog.jsonb_build_object(
      'graphId', graph_record.id, 'graphRunId', run_record.id,
      'artifactId', artifact_record.id, 'providerDeploymentUrl', deployment_url
    ), correlation_id, observed_at
  ) returning id into observation_id;

  perform public.record_graph_phase1c_monitor_as_worker(bridge_record.id, observation_id);

  insert into public.deployment_validations (
    organization_id, project_id, deployment_id, state, checks,
    baseline_reference, validator_version, policy_version, summary,
    correlation_id, started_at, completed_at
  ) values (
    bridge_record.organization_id, bridge_record.project_id,
    bridge_record.deployment_id, 'passed'::public.deployment_validation_state,
    artifact_record.payload -> 'checks', 'release:' || bridge_record.merge_commit_sha,
    'graph-production-validator-v3', 'post-deploy-v1',
    'Every required post-deploy stage passed for the exact public release.',
    correlation_id, validation_started_at, validation_completed_at
  ) returning * into validation_record;
  validation_id := validation_record.id;

  perform public.record_graph_phase1c_validation_as_worker(bridge_record.id, validation_id);
  return run_record;
end;
$function$;

revoke all on function public.complete_graph_run_with_validated_release_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_graph_run_with_validated_release_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) to service_role;

do $postdeploy_validation_postflight$
declare
  function_record record;
  launch_record record;
begin
  select routine.prosecdef, routine.proconfig, routine.proacl,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
  into function_record
  from pg_catalog.pg_proc routine
  where routine.oid = 'public.complete_graph_run_with_validated_release_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)'::pg_catalog.regprocedure;
  if not found
    or function_record.owner_name <> 'postgres'
    or not function_record.prosecdef
    or function_record.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.complete_graph_run_with_validated_release_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.complete_graph_run_with_validated_release_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.complete_graph_run_with_validated_release_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'validated lifecycle completion function ACL/security contract is incomplete';
  end if;

  select routine.prosecdef, routine.proconfig, routine.prosrc,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
         pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5
  into launch_record
  from pg_catalog.pg_proc routine
  where routine.oid =
    'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)'::pg_catalog.regprocedure;
  if not found
    or launch_record.owner_name <> 'postgres'
    or not launch_record.prosecdef
    or launch_record.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or launch_record.source_md5 <> '878b6df53f450d723a4ef7da9dd677b2'
    or pg_catalog.strpos(
      launch_record.prosrc,
      '0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49'
    ) = 0
    or pg_catalog.strpos(
      launch_record.prosrc,
      'ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09'
    ) > 0
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
      'EXECUTE'
    )
  then
    raise exception 'full_lifecycle v2 launch digest/ACL/security contract is incomplete';
  end if;
end;
$postdeploy_validation_postflight$;
