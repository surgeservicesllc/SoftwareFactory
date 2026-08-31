\set ON_ERROR_STOP on

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';

do $grok_research_catalog_postflight$
declare
  v_routine oid := pg_catalog.to_regprocedure(
    'public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
  );
begin
  if (select pg_catalog.count(*) from supabase_migrations.schema_migrations
       where version = '20260831001700') <> 1 then
    raise exception 'grok_research_postflight_ledger_mismatch';
  end if;
  if v_routine is null or not exists (
    select 1
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_language language_row on language_row.oid = routine.prolang
     where routine.oid = v_routine
       and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
       and language_row.lanname = 'plpgsql'
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.provolatile = 'v'
       and routine.proparallel = 'u'
       and routine.prokind = 'f'
       and routine.prorettype = 'public.grok_graph_launches'::pg_catalog.regtype
       and routine.pronargs = 16
       and routine.pronargdefaults = 0
       and not routine.proleakproof
       and not routine.proisstrict
       and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
         routine.prosrc, E'\r\n', E'\n'
       ), E'\r', E'\n')) = '29ac8f9a0a3589df78bd930dd99fbca8'
       and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
       and not exists (
         select 1 from pg_catalog.aclexplode(routine.proacl) acl
          where acl.privilege_type <> 'EXECUTE'
             or acl.grantor <> routine.proowner
             or (
               acl.grantee <> routine.proowner
               and acl.grantee <> (
                 select role.oid from pg_catalog.pg_roles role
                  where role.rolname = 'service_role'
               )
             )
       )
       and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl) acl
             where acl.privilege_type = 'EXECUTE') = 2
  ) then
    raise exception 'grok_research_postflight_function_identity_acl_or_hash_mismatch';
  end if;

  if 5 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in (
         'grok_graph_launches', 'grok_execution_admissions',
         'grok_task_links', 'grok_events', 'grok_specialist_admissions'
       )
       and relation.relkind = 'r'
       and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or exists (
    select 1
      from information_schema.role_table_grants privilege
     where privilege.table_schema = 'public'
       and privilege.table_name in (
         'grok_graph_launches', 'grok_execution_admissions',
         'grok_task_links', 'grok_events', 'grok_specialist_admissions'
       )
       and privilege.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) then
    raise exception 'grok_research_postflight_evidence_rls_or_acl_mismatch';
  end if;
end;
$grok_research_catalog_postflight$;

do $grok_research_runtime_postflight$
declare
  v_owner uuid := pg_catalog.gen_random_uuid();
  v_rival uuid := pg_catalog.gen_random_uuid();
  v_organization uuid := pg_catalog.gen_random_uuid();
  v_project uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid := pg_catalog.gen_random_uuid();
  v_bot_id uuid := pg_catalog.gen_random_uuid();
  v_role_id uuid := pg_catalog.gen_random_uuid();
  v_assignment_id uuid := pg_catalog.gen_random_uuid();
  v_assignment public.bot_assignments;
  v_bot public.bots;
  v_role public.bot_roles;
  v_account public.ai_accounts;
  v_session public.grok_sessions;
  v_user_message public.grok_messages;
  v_plan_message public.grok_messages;
  v_launch public.grok_graph_launches;
  v_replay public.grok_graph_launches;
  v_roster jsonb;
  v_task jsonb;
  v_nodes jsonb;
  v_edges jsonb := '[]'::jsonb;
  v_budget jsonb := pg_catalog.jsonb_build_object(
    'max_nodes', 1, 'max_concurrent_nodes', 1,
    'max_duration_ms', 120000, 'max_retries', 0,
    'max_discovery_rounds', 1, 'max_tokens', 4096
  );
  v_topology_reasons jsonb := pg_catalog.jsonb_build_array(
    'The bounded research task has no dependencies.'
  );
  v_admissions jsonb;
  v_context_items jsonb;
  v_goal text := 'Research the bounded repository evidence.';
  v_blocked boolean;
begin
  insert into auth.users(id, email) values
    (v_owner, 'grok-research-owner-' || v_owner::text || '@example.org'),
    (v_rival, 'grok-research-rival-' || v_rival::text || '@example.org');
  insert into public.organizations(id, name, slug, created_by) values (
    v_organization, 'Grok research release organization',
    'grr-' || pg_catalog.replace(v_organization::text, '-', ''), v_owner
  );
  insert into public.projects(
    id, organization_id, name, status, github_repository, default_branch,
    production_url, created_by
  ) values (
    v_project, v_organization, 'Grok Research Release', 'active',
    'example/grok-research-release', 'main',
    'https://research.example.org', v_owner
  );
  insert into public.ai_accounts(
    id, organization_id, provider, auth_method, display_name, status,
    credential_purpose, provider_identity, created_by
  ) values (
    v_account_id, v_organization, 'anthropic', 'subscription',
    'Grok research Claude', 'connected', 'claude_71',
    'grok-research-owner', v_owner
  );
  insert into public.provider_credentials(
    organization_id, purpose, sealed_envelope, source, created_by
  ) values (
    v_organization, 'claude_71',
    'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'connect_session', v_owner
  );
  insert into public.bot_roles(
    id, organization_id, name, slug, summary, instructions,
    risk_ceiling, capabilities, created_by
  ) values (
    v_role_id, v_organization, 'Grok research analyst',
    'grok-research-analyst', 'Bounded read-only research',
    'Analyze only bounded repository evidence.', 'green',
    '["research"]'::jsonb, v_owner
  );
  insert into public.bots(
    id, organization_id, name, provider, model, credential_ref,
    readiness, last_checked_at, ai_account_id, created_by
  ) values (
    v_bot_id, v_organization, 'Grok Research Claude', 'anthropic',
    'claude-opus-5', 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_71',
    'ready', pg_catalog.now(), v_account_id, v_owner
  );
  insert into public.bot_assignments(
    id, organization_id, bot_id, project_id, role_id, status,
    preset, model, work_effort, repository_access, can_open_pull_request,
    can_merge_pull_request, pipeline_access, environment_access,
    requires_human_approval, created_by
  ) values (
    v_assignment_id, v_organization, v_bot_id, v_project, v_role_id, 'active',
    'research', 'claude-opus-5', 'high', 'read', false, false,
    'all', 'none', true, v_owner
  );
  select * into strict v_assignment from public.bot_assignments
   where id = v_assignment_id;
  select * into strict v_bot from public.bots where id = v_bot_id;
  select * into strict v_role from public.bot_roles where id = v_role_id;
  select * into strict v_account from public.ai_accounts where id = v_account_id;

  v_roster := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'version', 1,
    'assignmentId', v_assignment.id,
    'assignmentRevision', v_assignment.revision,
    'botId', v_bot.id,
    'botRevision', v_bot.revision,
    'roleId', v_role.id,
    'roleUpdatedAt', v_role.updated_at,
    'aiAccountId', v_account.id,
    'credentialRef', v_bot.credential_ref,
    'credentialPurpose', v_account.credential_purpose,
    'providerIdentity', v_account.provider_identity,
    'accountUpdatedAt', v_account.updated_at,
    'provider', v_account.provider::text,
    'model', v_assignment.model,
    'capabilities', pg_catalog.jsonb_build_array('discovery'),
    'maxModelTier', 'STRONG'
  ));
  v_task := pg_catalog.jsonb_build_object(
    'id', 'research', 'executor', 'MODEL', 'provider', 'anthropic',
    'model', v_assignment.model, 'assignmentId', v_assignment.id,
    'capability', 'discovery', 'modelTier', 'STRONG'
  );
  v_nodes := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'node_key', 'research', 'job', 'Research bounded repository evidence',
    'executor', 'MODEL', 'capability', 'discovery', 'model_tier', 'STRONG',
    'risk_level', 'green', 'timeout_ms', 120000, 'max_attempts', 1,
    'allow_provider_fallback', false, 'tolerates_partial_inputs', false,
    'lifecycle_stage', null, 'gate_kind', null,
    'input_schema', '{}'::jsonb, 'output_schema', '{}'::jsonb,
    'reads', pg_catalog.jsonb_build_array('repository'),
    'writes', '[]'::jsonb,
    'acceptance_criteria', pg_catalog.jsonb_build_array('Cite bounded evidence.')
  ));
  v_admissions := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'version', 2, 'lane', 'graph_model', 'nodeKey', 'research',
    'sourceRosterAssignmentId', v_assignment.id,
    'assignmentId', v_assignment.id,
    'assignmentRevision', v_assignment.revision,
    'botId', v_bot.id, 'botRevision', v_bot.revision,
    'roleId', v_role.id, 'roleUpdatedAt', v_role.updated_at,
    'agentCapabilities', pg_catalog.jsonb_build_array('discovery'),
    'agentMaxModelTier', 'STRONG', 'aiAccountId', v_account.id,
    'accountUpdatedAt', v_account.updated_at,
    'provider', 'anthropic', 'model', v_assignment.model,
    'credentialPurpose', v_account.credential_purpose,
    'credentialRef', v_bot.credential_ref,
    'providerIdentity', v_account.provider_identity,
    'capability', 'discovery'
  ));

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  select * into strict v_session from public.create_grok_session(
    v_organization, v_project, 'Grok research acceptance',
    'grok-research-session'
  );
  select * into strict v_user_message from public.append_grok_user_message(
    v_organization, v_session.id, v_goal,
    pg_catalog.jsonb_build_object('schemaVersion', 1, 'kind', 'grok.user_prompt'),
    'grok-research-user', 0, null
  );
  select * into strict v_plan_message from public.append_grok_message_as_server(
    v_organization, v_session.id, 'assistant',
    'The read-only research plan is recorded.',
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'kind', 'grok.plan',
      'plan', pg_catalog.jsonb_build_object(
        'planner', pg_catalog.jsonb_build_object('version', 3),
        'intent', pg_catalog.jsonb_build_object('kind', 'research'),
        'admissionRoster', v_roster,
        'dag', pg_catalog.jsonb_build_object('tasks', pg_catalog.jsonb_build_array(v_task)),
        'graphLaunch', pg_catalog.jsonb_build_object(
          'goal', v_goal, 'topology', 'DAG',
          'topologyReasons', v_topology_reasons, 'riskLevel', 'green',
          'requiresOwnerApproval', false, 'nodes', v_nodes,
          'edges', v_edges, 'budget', v_budget
        )
      )
    ), 'grok-research-plan', 1, v_user_message.id
  );
  perform public.record_grok_specialist_roster_v1_as_server(
    v_organization, v_owner, v_project, v_session.id, v_plan_message.id,
    'grok-research-roster', 3
  );
  perform public.record_grok_event_as_server(
    v_organization, v_session.id, 'session.planned', v_session.id,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'detail', 'The exact read-only research plan was recorded.',
      'planMessageId', v_plan_message.id,
      'plannerVersion', 3,
      'taskCount', 1
    ), 4, v_plan_message.id, null
  );
  v_context_items := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'kind', 'project', 'label', 'Grok Research Release',
      'media_type', null, 'source_url', 'https://research.example.org',
      'repository_path', null, 'integration_id', null, 'content_text', null,
      'byte_size', 0, 'state', 'reference_only'
    ),
    pg_catalog.jsonb_build_object(
      'kind', 'repository', 'label', 'example/grok-research-release',
      'media_type', null, 'source_url', null, 'repository_path', 'main',
      'integration_id', null, 'content_text', null, 'byte_size', 0,
      'state', 'reference_only'
    )
  );
  perform public.record_grok_context_envelope_as_server(
    v_organization, v_owner, v_project, v_session.id, v_user_message.id,
    v_context_items, 'grok-research-context', 5, false
  );

  v_launch := public.launch_grok_read_only_research_v1_as_server(
    v_organization, v_owner, v_project, v_session.id, v_plan_message.id,
    'grok-research-launch', v_goal, 'DAG', v_topology_reasons,
    'green', false, v_nodes, v_edges, v_budget,
    'grok-research-roster', v_admissions
  );
  v_replay := public.launch_grok_read_only_research_v1_as_server(
    v_organization, v_owner, v_project, v_session.id, v_plan_message.id,
    'grok-research-launch', v_goal, 'DAG', v_topology_reasons,
    'green', false, v_nodes, v_edges, v_budget,
    'grok-research-roster', v_admissions
  );
  if v_replay.id is distinct from v_launch.id
      or v_replay.graph_id is distinct from v_launch.graph_id
  then
    raise exception 'grok_research_postflight_idempotent_replay_mismatch';
  end if;

  v_blocked := false;
  begin
    perform public.launch_grok_read_only_research_v1_as_server(
      v_organization, v_rival, v_project, v_session.id, v_plan_message.id,
      'grok-research-rival', v_goal, 'DAG', v_topology_reasons,
      'green', false, v_nodes, v_edges, v_budget,
      'grok-research-roster', v_admissions
    );
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_research_postflight_cross_tenant_owner_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.launch_grok_read_only_research_v1_as_server(
      v_organization, v_owner, v_project, v_session.id, v_plan_message.id,
      'grok-research-launch', v_goal || ' changed', 'DAG', v_topology_reasons,
      'green', false, v_nodes, v_edges, v_budget,
      'grok-research-roster', v_admissions
    );
  exception when sqlstate '55000' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_research_postflight_changed_replay_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    alter table public.grok_messages disable trigger grok_messages_immutable;
    update public.grok_messages
       set metadata = pg_catalog.jsonb_set(
         metadata, '{plan,graphLaunch,nodes}',
         pg_catalog.jsonb_set(v_nodes, '{0,writes}', '["repository"]'::jsonb),
         false
       )
     where id = v_plan_message.id;
    perform public.launch_grok_read_only_research_v1_as_server(
      v_organization, v_owner, v_project, v_session.id, v_plan_message.id,
      'grok-research-write-denied', v_goal, 'DAG', v_topology_reasons,
      'green', false,
      pg_catalog.jsonb_set(v_nodes, '{0,writes}', '["repository"]'::jsonb),
      v_edges, v_budget, 'grok-research-roster', v_admissions
    );
  exception when sqlstate '22023' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_research_postflight_write_node_was_not_blocked';
  end if;

  if not exists (
    select 1 from public.graphs graph
     where graph.id = v_launch.graph_id
       and graph.organization_id = v_organization
       and graph.project_id = v_project
       and graph.goal = v_goal
       and graph.pause_requested_at is not null
       and graph.pause_requested_by = v_owner
       and graph.withdrawn_at is null
       and not graph.is_lifecycle
       and graph.template_key is null
  ) or (select pg_catalog.count(*) from public.graph_nodes node
         where node.graph_id = v_launch.graph_id
           and node.executor = 'MODEL'
           and node.lifecycle_stage is null
           and node.gate_kind is null) <> 1
      or (select pg_catalog.count(*) from public.node_contracts contract
           join public.graph_nodes node on node.id = contract.node_id
          where node.graph_id = v_launch.graph_id
            and contract.writes = '[]'::jsonb) <> 1
      or (select pg_catalog.count(*) from public.grok_execution_admissions admission
           where admission.graph_id = v_launch.graph_id
             and admission.lane = 'graph_model'
             and admission.provider = 'anthropic'
             and admission.admission_sha256 =
               public.grok_current_execution_admission_hash(admission)) <> 1
      or public.assert_current_grok_execution_admissions(v_launch.graph_id)
           is distinct from true
      or not exists (
        select 1 from public.grok_events event
         where event.session_id = v_session.id
           and event.event_type = 'graph.planned'
           and event.payload ->> 'bridge' = 'grok_read_only_research_v1'
           and event.payload ->> 'workerWoken' = 'false'
           and event.payload ->> 'executionStarted' = 'false'
           and not event.payload ?| array['content', 'content_text', 'items', 'credentialRef']
      )
      or exists (
        select 1 from public.graph_runs graph_run where graph_run.graph_id = v_launch.graph_id
      )
      or exists (
        select 1 from public.node_runs node_run
        join public.graph_runs graph_run on graph_run.id = node_run.graph_run_id
       where graph_run.graph_id = v_launch.graph_id
      )
      or exists (
        select 1 from public.agent_runs agent_run where agent_run.project_id = v_project
      )
      or exists (
        select 1 from public.provider_run_events provider_event
        join public.agent_runs agent_run on agent_run.id = provider_event.agent_run_id
       where agent_run.project_id = v_project
      )
      or exists (
        select 1 from public.graph_phase1c_bridges bridge where bridge.graph_id = v_launch.graph_id
      )
  then
    raise exception 'grok_research_postflight_pause_admission_audit_or_zero_run_mismatch';
  end if;
end;
$grok_research_runtime_postflight$;

select 'grok-read-only-research-release-postflight-ok';
rollback;
