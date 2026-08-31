\set ON_ERROR_STOP on

-- This verifier is deliberately read-only.  It accepts only the immutable
-- identity emitted by the start phase and the exact release/deployment
-- identity independently established by the finish workflow.
select pg_catalog.set_config('softwarefactory.causal.account_email', :'account_email', false) as account_setting \gset
select pg_catalog.set_config('softwarefactory.causal.project_id', :'project_id', false) as project_setting \gset
select pg_catalog.set_config('softwarefactory.causal.repository', :'repository', false) as repository_setting \gset
select pg_catalog.set_config('softwarefactory.causal.default_branch', :'default_branch', false) as branch_setting \gset
select pg_catalog.set_config('softwarefactory.causal.production_origin', :'production_origin', false) as origin_setting \gset
select pg_catalog.set_config('softwarefactory.causal.start_release_sha', :'start_release_sha', false) as start_release_setting \gset
select pg_catalog.set_config('softwarefactory.causal.release_sha', :'release_sha', false) as release_setting \gset
select pg_catalog.set_config('softwarefactory.causal.session_id', :'session_id', false) as session_setting \gset
select pg_catalog.set_config('softwarefactory.causal.graph_id', :'graph_id', false) as graph_setting \gset
select pg_catalog.set_config('softwarefactory.causal.initial_graph_run_id', :'initial_graph_run_id', false) as initial_graph_run_setting \gset
select pg_catalog.set_config('softwarefactory.causal.draft_graph_run_id', :'draft_graph_run_id', false) as draft_graph_run_setting \gset
select pg_catalog.set_config('softwarefactory.causal.start_graph_run_ids', :'start_graph_run_ids', false) as start_graph_runs_setting \gset
select pg_catalog.set_config('softwarefactory.causal.start_claude_node_run_ids', :'start_claude_node_run_ids', false) as start_claude_runs_setting \gset
select pg_catalog.set_config('softwarefactory.causal.wake_intent_id', :'wake_intent_id', false) as wake_setting \gset
select pg_catalog.set_config('softwarefactory.causal.control_revision', :'control_revision', false) as revision_setting \gset
select pg_catalog.set_config('softwarefactory.causal.dispatch_attempt_id', :'dispatch_attempt_id', false) as dispatch_setting \gset
select pg_catalog.set_config('softwarefactory.causal.wake_receipt_id', :'wake_receipt_id', false) as receipt_setting \gset
select pg_catalog.set_config('softwarefactory.causal.worker_id', :'worker_id', false) as worker_setting \gset
select pg_catalog.set_config('softwarefactory.causal.bridge_id', :'bridge_id', false) as bridge_setting \gset
select pg_catalog.set_config('softwarefactory.causal.command_id', :'command_id', false) as command_setting \gset
select pg_catalog.set_config('softwarefactory.causal.task_id', :'task_id', false) as task_setting \gset
select pg_catalog.set_config('softwarefactory.causal.agent_run_id', :'agent_run_id', false) as agent_run_setting \gset
select pg_catalog.set_config('softwarefactory.causal.pull_request_id', :'pull_request_id', false) as pull_request_setting \gset
select pg_catalog.set_config('softwarefactory.causal.pull_request_number', :'pull_request_number', false) as pull_request_number_setting \gset
select pg_catalog.set_config('softwarefactory.causal.head_branch', :'head_branch', false) as head_branch_setting \gset
select pg_catalog.set_config('softwarefactory.causal.head_sha', :'head_sha', false) as head_setting \gset
select pg_catalog.set_config('softwarefactory.causal.external_deployment_id', :'external_deployment_id', false) as deployment_external_setting \gset
select pg_catalog.set_config('softwarefactory.causal.deployment_url', :'deployment_url', false) as deployment_url_setting \gset

do $grok_causal_finish_identity$
declare
  v_user uuid;
  v_org uuid;
  v_project uuid := pg_catalog.current_setting('softwarefactory.causal.project_id')::uuid;
  v_session uuid := pg_catalog.current_setting('softwarefactory.causal.session_id')::uuid;
  v_graph uuid := pg_catalog.current_setting('softwarefactory.causal.graph_id')::uuid;
  v_initial_run uuid := pg_catalog.current_setting(
    'softwarefactory.causal.initial_graph_run_id'
  )::uuid;
  v_draft_run uuid := pg_catalog.current_setting(
    'softwarefactory.causal.draft_graph_run_id'
  )::uuid;
  v_start_runs jsonb := pg_catalog.current_setting(
    'softwarefactory.causal.start_graph_run_ids'
  )::jsonb;
  v_start_claude_runs jsonb := pg_catalog.current_setting(
    'softwarefactory.causal.start_claude_node_run_ids'
  )::jsonb;
  v_wake uuid := pg_catalog.current_setting('softwarefactory.causal.wake_intent_id')::uuid;
  v_revision bigint := pg_catalog.current_setting('softwarefactory.causal.control_revision')::bigint;
  v_bridge uuid := pg_catalog.current_setting('softwarefactory.causal.bridge_id')::uuid;
  v_release text := pg_catalog.current_setting('softwarefactory.causal.release_sha');
begin
  if v_release !~ '^[0-9a-f]{40}$'
    or pg_catalog.current_setting('softwarefactory.causal.start_release_sha') !~ '^[0-9a-f]{40}$'
    or v_release = pg_catalog.current_setting('softwarefactory.causal.start_release_sha')
    or pg_catalog.current_setting('softwarefactory.causal.production_origin') <> 'https://www.theagoras.com'
    or pg_catalog.current_setting('softwarefactory.causal.deployment_url') !~
      '^https://softwarefactory-[a-z0-9]+-surgeservices-projects[.]vercel[.]app$'
    or pg_catalog.current_setting('softwarefactory.causal.external_deployment_id') !~ '^[1-9][0-9]*$'
  then raise exception 'grok_causal_finish_release_or_deployment_input_invalid'; end if;

  if (
    select pg_catalog.count(*) = 21 and pg_catalog.count(distinct migration.version) = 21
      from supabase_migrations.schema_migrations migration
     where migration.version = any (array[
       '20260831000100', '20260831000200', '20260831000300',
       '20260831000400', '20260831000500', '20260831000600',
       '20260831000700', '20260831000800', '20260831000900', '20260831001000',
       '20260831001100', '20260831001200', '20260831001300',
       '20260831001400', '20260831001500', '20260831001600',
       '20260831001700', '20260831001800', '20260831001900',
       '20260831002000', '20260831002100'
     ]::text[])
  ) is distinct from true then
    raise exception 'grok_causal_finish_required_ledger_not_exact';
  end if;

  if (
    select pg_catalog.count(*) = 2
      and pg_catalog.bool_and(function_definition.prosecdef)
      and pg_catalog.bool_and(
        function_definition.proconfig = array['search_path=pg_catalog']::text[]
      )
      and pg_catalog.bool_and(pg_catalog.has_function_privilege(
        'service_role', function_definition.oid, 'EXECUTE'
      ))
      and pg_catalog.bool_and(not pg_catalog.has_function_privilege(
        'authenticated', function_definition.oid, 'EXECUTE'
      ))
      and pg_catalog.bool_and(not pg_catalog.has_function_privilege(
        'anon', function_definition.oid, 'EXECUTE'
      ))
      from pg_catalog.pg_proc function_definition
     where function_definition.oid = any (array[
       pg_catalog.to_regprocedure(
         'public.resolve_graph_execution_target_as_worker(uuid,integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)'
       )
     ]::pg_catalog.oid[])
  ) is distinct from true or exists (
    select 1
      from pg_catalog.pg_proc function_definition
      cross join lateral pg_catalog.aclexplode(coalesce(
        function_definition.proacl,
        pg_catalog.acldefault('f', function_definition.proowner)
      )) access_control
     where function_definition.oid = any (array[
       pg_catalog.to_regprocedure(
         'public.resolve_graph_execution_target_as_worker(uuid,integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)'
       )
     ]::pg_catalog.oid[])
       and access_control.privilege_type = 'EXECUTE'
       and access_control.grantee not in (
         function_definition.proowner,
         (select role_definition.oid from pg_catalog.pg_roles role_definition
           where role_definition.rolname = 'service_role')
       )
  ) then raise exception 'grok_causal_finish_runtime_catalog_or_acl_mismatch'; end if;

  if pg_catalog.jsonb_typeof(v_start_runs) <> 'array'
    or pg_catalog.jsonb_array_length(v_start_runs) not between 2 and 10
    or pg_catalog.jsonb_typeof(v_start_claude_runs) <> 'array'
    or pg_catalog.jsonb_array_length(v_start_claude_runs) not between 1 and 32
    or v_start_runs ->> 0 is distinct from v_initial_run::text
    or v_start_runs ->> (pg_catalog.jsonb_array_length(v_start_runs) - 1)
      is distinct from v_draft_run::text
    or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(v_start_runs) item(value)
       where item.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(v_start_claude_runs) item(value)
       where item.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or (
      select pg_catalog.count(distinct item.value)
        from pg_catalog.jsonb_array_elements_text(v_start_runs) item(value)
    ) <> pg_catalog.jsonb_array_length(v_start_runs)
    or (
      select pg_catalog.count(distinct item.value)
        from pg_catalog.jsonb_array_elements_text(v_start_claude_runs) item(value)
    ) <> pg_catalog.jsonb_array_length(v_start_claude_runs)
  then raise exception 'grok_causal_finish_start_chain_input_invalid'; end if;

  select account.id into strict v_user
    from auth.users account
   where pg_catalog.lower(account.email) = pg_catalog.lower(
     pg_catalog.current_setting('softwarefactory.causal.account_email')
   ) and account.email_confirmed_at is not null and account.deleted_at is null;

  select session.organization_id into strict v_org
    from public.grok_sessions session
    join public.grok_graph_launches launch
      on launch.session_id = session.id
     and launch.organization_id = session.organization_id
     and launch.project_id = session.project_id
    join public.graphs graph
      on graph.id = launch.graph_id and graph.organization_id = launch.organization_id
    join public.projects project
      on project.id = graph.project_id and project.organization_id = graph.organization_id
    join public.github_repositories repository
      on repository.id = graph.github_repository_id
     and repository.organization_id = graph.organization_id
    join public.organization_members member
      on member.organization_id = session.organization_id
     and member.user_id = v_user
     and member.role = 'owner'::public.organization_member_role
   where session.id = v_session
     and session.project_id = v_project
     and session.created_by = v_user
     and launch.graph_id = v_graph
     and graph.template_key = 'full_lifecycle'
     and graph.template_version = 2
     and graph.base_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
     and graph.base_sha = pg_catalog.current_setting('softwarefactory.causal.start_release_sha')
     and graph.required_check_names = pg_catalog.to_jsonb(array[
       'Lint, typecheck, test, and build',
       'Browser and accessibility tests 1/3',
       'Browser and accessibility tests 2/3',
       'Browser and accessibility tests 3/3'
     ]::text[])
     and graph.required_checks_sha256 = pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(graph.required_check_names::text, 'UTF8')
     ), 'hex')
     and project.id = v_project
     and project.status = 'active'::public.project_status
     and project.github_repository = pg_catalog.current_setting('softwarefactory.causal.repository')
     and project.default_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
     and pg_catalog.rtrim(project.production_url, '/') =
       pg_catalog.current_setting('softwarefactory.causal.production_origin')
     and repository.full_name = pg_catalog.current_setting('softwarefactory.causal.repository');

  if exists (
    select 1 from public.organizations organization
     where organization.id = v_org
       and (coalesce(organization.autonomous_mode, false)
         or organization.autonomy_kill_switch_active is distinct from true
         or coalesce(organization.auto_plan, false)
         or coalesce(organization.auto_code, false)
         or coalesce(organization.auto_test, false)
         or coalesce(organization.auto_repair, false)
         or coalesce(organization.auto_review, false)
         or coalesce(organization.auto_approve, false)
         or coalesce(organization.auto_merge, false)
         or coalesce(organization.auto_deploy, false)
         or coalesce(organization.auto_rollback, false))
  ) or exists (
    select 1 from public.projects project
     where project.id = v_project
       and (coalesce(project.autonomous_mode, false)
         or coalesce(project.auto_plan, false)
         or coalesce(project.auto_code, false)
         or coalesce(project.auto_test, false)
         or coalesce(project.auto_repair, false)
         or coalesce(project.auto_review, false)
         or coalesce(project.auto_approve, false)
         or coalesce(project.auto_merge, false)
         or coalesce(project.auto_deploy, false)
         or coalesce(project.auto_rollback, false))
  ) then raise exception 'grok_causal_finish_safety_state_mismatch'; end if;

  if not exists (
    select 1 from public.graph_runs run
     where run.id = v_initial_run and run.graph_id = v_graph
       and run.organization_id = v_org
       and run.state in ('PARTIAL', 'COMPLETED')
       and not run.had_partial_input and run.completed_at is not null
  ) or not exists (
    select 1 from public.graph_runs run
     where run.id = v_draft_run and run.graph_id = v_graph
       and run.organization_id = v_org and run.phase1c_bridge_id = v_bridge
       and run.state in ('PARTIAL', 'COMPLETED')
       and not run.had_partial_input and run.completed_at is not null
  ) or (
    select pg_catalog.count(*) from public.graph_runs run
     where run.graph_id = v_graph and run.organization_id = v_org
  ) not between pg_catalog.jsonb_array_length(v_start_runs) and 10
    or exists (
      select 1 from public.graph_runs run
       where run.graph_id = v_graph and run.organization_id = v_org
         and (run.state in ('FAILED', 'CANCELLED', 'BUDGET_STOPPED')
           or run.had_partial_input)
    )
    or exists (
      select 1 from public.node_runs node_run
      join public.graph_runs graph_run on graph_run.id = node_run.graph_run_id
       where graph_run.graph_id = v_graph and graph_run.organization_id = v_org
         and node_run.state in ('FAILED', 'CANCELLED')
    )
    or exists (
      with ordered_runs as (
        select run.id::text as id,
               pg_catalog.row_number() over (order by run.created_at, run.id) as ordinal
          from public.graph_runs run
         where run.graph_id = v_graph and run.organization_id = v_org
      )
      select 1
        from pg_catalog.jsonb_array_elements_text(v_start_runs)
          with ordinality expected(id, ordinal)
        left join ordered_runs actual on actual.ordinal = expected.ordinal
       where actual.id is distinct from expected.id
    )
  then raise exception 'grok_causal_finish_graph_history_mismatch'; end if;

  if (
    select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements_text(v_start_claude_runs) expected(id)
      join public.node_runs node_run on node_run.id = expected.id::uuid
      join public.graph_runs graph_run on graph_run.id = node_run.graph_run_id
      join public.graph_nodes node on node.id = node_run.node_id
       and node.organization_id = node_run.organization_id
       and node.graph_id = graph_run.graph_id
     where graph_run.graph_id = v_graph and graph_run.organization_id = v_org
       and node.executor = 'MODEL'::public.graph_node_executor
       and node_run.state = 'COMPLETED'::public.graph_node_state
       and node_run.provider = 'anthropic' and node_run.attempt = 1
       and pg_catalog.btrim(coalesce(node_run.model, '')) <> ''
       and node_run.started_at is not null and node_run.completed_at is not null
       and node_run.latency_ms is not null and node_run.latency_ms > 0
       and exists (
         select 1 from public.graph_artifacts artifact
          where artifact.graph_run_id = node_run.graph_run_id
            and artifact.node_run_id = node_run.id
       )
  ) <> pg_catalog.jsonb_array_length(v_start_claude_runs)
  then raise exception 'grok_causal_finish_start_claude_evidence_mismatch'; end if;

  if (select pg_catalog.count(*) from public.grok_graph_wake_intents intent
       where intent.graph_id = v_graph) <> 1
    or (select pg_catalog.count(*) from public.grok_graph_wake_dispatch_attempts attempt
         where attempt.wake_intent_id = v_wake) <> 1
    or (select pg_catalog.count(*) from public.grok_graph_wake_receipts receipt
         where receipt.wake_intent_id = v_wake) <> 1
    or not exists (
      select 1 from public.grok_graph_wake_intents intent
       where intent.id = v_wake and intent.organization_id = v_org
         and intent.project_id = v_project and intent.session_id = v_session
         and intent.graph_id = v_graph and intent.control_revision = v_revision
    )
    or not exists (
      select 1 from public.grok_graph_wake_dispatch_attempts attempt
       where attempt.id = pg_catalog.current_setting(
         'softwarefactory.causal.dispatch_attempt_id'
       )::uuid
         and attempt.wake_intent_id = v_wake
         and attempt.control_revision = v_revision
         and attempt.attempt_number = 1 and attempt.outcome = 'accepted'
    )
    or not exists (
      select 1 from public.grok_graph_wake_receipts receipt
       where receipt.id = pg_catalog.current_setting(
         'softwarefactory.causal.wake_receipt_id'
       )::uuid
         and receipt.wake_intent_id = v_wake
         and receipt.control_revision = v_revision
         and receipt.session_id = v_session and receipt.graph_id = v_graph
         and receipt.graph_run_id = v_initial_run
         and receipt.worker_id = pg_catalog.current_setting('softwarefactory.causal.worker_id')
         and receipt.protocol_version = 1 and receipt.capability_version = 1
    )
  then raise exception 'grok_causal_finish_wake_history_mismatch'; end if;

  if not exists (
    select 1 from public.graph_phase1c_bridges bridge
     where bridge.id = v_bridge and bridge.organization_id = v_org
       and bridge.project_id = v_project and bridge.graph_id = v_graph
       and bridge.graph_run_id = v_initial_run
       and bridge.command_id = pg_catalog.current_setting('softwarefactory.causal.command_id')::uuid
       and bridge.task_id = pg_catalog.current_setting('softwarefactory.causal.task_id')::uuid
       and bridge.agent_run_id = pg_catalog.current_setting('softwarefactory.causal.agent_run_id')::uuid
       and bridge.pull_request_id = pg_catalog.current_setting('softwarefactory.causal.pull_request_id')::uuid
       and bridge.head_sha = pg_catalog.current_setting('softwarefactory.causal.head_sha')
       and (bridge.merge_commit_sha is null or bridge.merge_commit_sha = v_release)
  ) or not exists (
    select 1 from public.agent_runs run
     where run.id = pg_catalog.current_setting('softwarefactory.causal.agent_run_id')::uuid
       and run.organization_id = v_org and run.project_id = v_project
       and run.command_id = pg_catalog.current_setting('softwarefactory.causal.command_id')::uuid
       and run.task_id = pg_catalog.current_setting('softwarefactory.causal.task_id')::uuid
       and run.status = 'succeeded'::public.run_status
       and run.provider = 'openai' and run.model = 'gpt-5.3-codex'
       and run.provider_run_reference is not null
       and run.base_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
       and run.base_sha = pg_catalog.current_setting('softwarefactory.causal.start_release_sha')
       and run.head_branch = pg_catalog.current_setting('softwarefactory.causal.head_branch')
       and run.head_sha = pg_catalog.current_setting('softwarefactory.causal.head_sha')
       and run.attempt_number = 1
  ) or not exists (
    select 1 from public.pull_requests pull
     where pull.id = pg_catalog.current_setting('softwarefactory.causal.pull_request_id')::uuid
       and pull.organization_id = v_org and pull.project_id = v_project
       and pull.agent_run_id = pg_catalog.current_setting('softwarefactory.causal.agent_run_id')::uuid
       and pull.repository = pg_catalog.current_setting('softwarefactory.causal.repository')
       and pull.external_number = pg_catalog.current_setting(
         'softwarefactory.causal.pull_request_number'
       )::integer
       and pull.head_branch = pg_catalog.current_setting('softwarefactory.causal.head_branch')
       and pull.base_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
       and pull.head_sha = pg_catalog.current_setting('softwarefactory.causal.head_sha')
       and (
         (pull.status = 'draft'::public.pull_request_status
           and pull.merge_commit_sha is null and pull.merged_at is null)
         or (pull.status = 'merged'::public.pull_request_status
           and pull.merge_commit_sha = v_release and pull.merged_at is not null)
       )
  ) then raise exception 'grok_causal_finish_phase1c_or_pull_request_identity_mismatch'; end if;

  if exists (
    select 1 from public.node_runs run
    join public.graph_nodes node
      on node.id = run.node_id and node.organization_id = run.organization_id
    join public.graph_runs graph_run on graph_run.id = run.graph_run_id
    where graph_run.graph_id = v_graph and graph_run.organization_id = v_org
      and node.graph_id = graph_run.graph_id
      and node.executor = 'MODEL'
      and run.state = 'COMPLETED'
      and (run.provider is distinct from 'anthropic'
        or run.attempt <> 1
        or pg_catalog.btrim(coalesce(run.model, '')) = ''
        or run.started_at is null or run.completed_at is null
        or run.latency_ms is null or run.latency_ms <= 0
        or not exists (
          select 1 from public.graph_artifacts artifact
           where artifact.graph_run_id = run.graph_run_id and artifact.node_run_id = run.id
        ))
  ) then raise exception 'grok_causal_finish_claude_provider_identity_mismatch'; end if;
end;
$grok_causal_finish_identity$;

with exact_graph as (
  select graph.* from public.graphs graph
   where graph.id = pg_catalog.current_setting('softwarefactory.causal.graph_id')::uuid
), initial_run as (
  select run.* from public.graph_runs run
  join exact_graph graph on graph.id = run.graph_id
   where run.id = pg_catalog.current_setting(
     'softwarefactory.causal.initial_graph_run_id'
   )::uuid
), exact_bridge as (
  select bridge.* from public.graph_phase1c_bridges bridge
  join initial_run run on run.id = bridge.graph_run_id
   where bridge.id = pg_catalog.current_setting('softwarefactory.causal.bridge_id')::uuid
), draft_run as (
  select run.* from public.graph_runs run
  join exact_graph graph on graph.id = run.graph_id
  join exact_bridge bridge on bridge.id = run.phase1c_bridge_id
   where run.id = pg_catalog.current_setting(
     'softwarefactory.causal.draft_graph_run_id'
   )::uuid
), terminal_run as (
  select run.* from public.graph_runs run
  join exact_graph graph on graph.id = run.graph_id
  join exact_bridge bridge on bridge.id = run.phase1c_bridge_id
   where run.state = 'COMPLETED'::public.graph_run_state
     and not run.had_partial_input and run.completed_at is not null
   order by run.created_at desc, run.id desc
   limit 1
), graph_history as (
  select pg_catalog.jsonb_agg(run.id order by run.created_at, run.id) as ids,
         pg_catalog.count(*)::integer as run_count,
         pg_catalog.count(*) filter (
           where run.state not in ('PARTIAL', 'COMPLETED')
         )::integer as in_flight_or_bad_count,
         pg_catalog.count(*) filter (
           where run.had_partial_input or run.completed_at is null
         )::integer as incomplete_identity_count
    from public.graph_runs run
    join exact_graph graph on graph.id = run.graph_id
  having pg_catalog.count(*) between 2 and 10
), exact_agent_run as (
  select run.* from public.agent_runs run
  join exact_bridge bridge on bridge.agent_run_id = run.id
), exact_pull as (
  select pull.* from public.pull_requests pull
  join exact_bridge bridge on bridge.pull_request_id = pull.id
), exact_deployment as (
  select deployment.* from public.deployments deployment
  join exact_bridge bridge on bridge.deployment_id = deployment.id
   where deployment.external_reference = pg_catalog.current_setting(
     'softwarefactory.causal.external_deployment_id'
   )
), exact_observation as (
  select observation.* from public.monitor_observations observation
  join exact_bridge bridge on bridge.monitor_observation_id = observation.id
  join exact_deployment deployment on deployment.id = observation.deployment_id
), exact_validation as (
  select validation.* from public.deployment_validations validation
  join exact_bridge bridge on bridge.deployment_validation_id = validation.id
  join exact_deployment deployment on deployment.id = validation.deployment_id
), exact_monitor as (
  select monitor.* from public.production_monitors monitor
  join exact_observation observation on observation.monitor_id = monitor.id
), exact_receipt as (
  select receipt.* from public.grok_graph_wake_receipts receipt
  join initial_run run on run.id = receipt.graph_run_id
   where receipt.id = pg_catalog.current_setting(
     'softwarefactory.causal.wake_receipt_id'
   )::uuid
), node_evidence as (
  select pg_catalog.count(*)::integer as node_run_count,
         pg_catalog.count(*) filter (
           where run.state = 'COMPLETED'::public.graph_node_state
             and run.started_at is not null and run.completed_at is not null
             and exists (
               select 1 from public.graph_artifacts artifact
                where artifact.graph_run_id = run.graph_run_id
                  and artifact.node_run_id = run.id
             )
         )::integer as completed_with_artifact_count,
         pg_catalog.count(*) filter (
           where node.executor = 'MODEL'::public.graph_node_executor
             and run.state = 'COMPLETED'::public.graph_node_state
             and run.provider = 'anthropic' and run.attempt = 1
             and pg_catalog.btrim(coalesce(run.model, '')) <> ''
             and run.started_at is not null and run.completed_at is not null
             and run.latency_ms is not null and run.latency_ms > 0
         )::integer as claude_count
    from public.node_runs run
    join public.graph_nodes node
      on node.id = run.node_id and node.organization_id = run.organization_id
    join terminal_run graph_run on graph_run.id = run.graph_run_id
), graph_node_count as (
  select pg_catalog.count(*)::integer as total from public.graph_nodes node
  join exact_graph graph on graph.id = node.graph_id
), terminal_anchor as (
  select artifact.id
    from public.graph_artifacts artifact
    join public.node_runs run
      on run.id = artifact.node_run_id
     and run.organization_id = artifact.organization_id
     and run.graph_run_id = artifact.graph_run_id
    join public.graph_nodes node
      on node.id = run.node_id and node.organization_id = run.organization_id
    join terminal_run graph_run on graph_run.id = artifact.graph_run_id
    join exact_deployment deployment on true
   where artifact.kind = 'ANCHOR'::public.graph_artifact_kind
     and run.state = 'COMPLETED'::public.graph_node_state
     and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage
     and artifact.payload ->> 'observation' = 'production_http_probe'
     and artifact.payload ->> 'deploymentId' = deployment.id::text
     and artifact.payload ->> 'postDeployValidation' = 'passed'
     and artifact.payload -> 'healthy' = 'true'::jsonb
     and artifact.payload -> 'observationWindowComplete' = 'true'::jsonb
     and pg_catalog.lower(artifact.payload ->> 'releaseSha') =
       pg_catalog.current_setting('softwarefactory.causal.release_sha')
     and pg_catalog.rtrim(artifact.payload ->> 'url', '/') =
       pg_catalog.current_setting('softwarefactory.causal.production_origin')
     and pg_catalog.rtrim(artifact.payload ->> 'deploymentUrl', '/') =
       pg_catalog.current_setting('softwarefactory.causal.deployment_url')
     and pg_catalog.jsonb_typeof(artifact.payload -> 'checks') = 'array'
     and pg_catalog.jsonb_array_length(artifact.payload -> 'checks') = 5
     and not exists (
       select 1
         from pg_catalog.jsonb_array_elements(artifact.payload -> 'checks') check_item
        where check_item ->> 'stage' not in (
          'identity', 'availability', 'data_integration', 'quality_security', 'observation'
        ) or check_item -> 'required' is distinct from 'true'::jsonb
          or check_item ->> 'result' is distinct from 'pass'
     )
     and (
       select pg_catalog.count(distinct check_item ->> 'stage')
         from pg_catalog.jsonb_array_elements(artifact.payload -> 'checks') check_item
     ) = 5
)
select case when exists (
  select 1
    from exact_graph graph
    join initial_run initial on true
    join draft_run draft on true
    join terminal_run terminal on true
    join graph_history history on true
    join exact_bridge bridge on true
    join exact_agent_run agent_run on true
    join exact_pull pull on true
    join exact_deployment deployment on true
    join exact_observation observation on true
    join exact_validation validation on true
    join exact_monitor monitor on true
    join exact_receipt receipt on true
    join node_evidence nodes on true
    join graph_node_count graph_nodes on true
   where initial.state in ('PARTIAL', 'COMPLETED')
     and not initial.had_partial_input and initial.completed_at is not null
     and draft.state in ('PARTIAL', 'COMPLETED')
     and not draft.had_partial_input and draft.completed_at is not null
     and terminal.state = 'COMPLETED'::public.graph_run_state
     and not terminal.had_partial_input and terminal.completed_at is not null
     and history.in_flight_or_bad_count = 0
     and history.incomplete_identity_count = 0
     and history.ids ->> 0 = initial.id::text
     and history.ids @> pg_catalog.jsonb_build_array(draft.id)
     and history.ids ->> (history.run_count - 1) = terminal.id::text
     and bridge.state = 'VALIDATED'
     and bridge.merge_commit_sha = pg_catalog.current_setting('softwarefactory.causal.release_sha')
     and pull.status = 'merged'::public.pull_request_status
     and pull.merge_commit_sha = pg_catalog.current_setting('softwarefactory.causal.release_sha')
     and pull.merged_at is not null
     and agent_run.status = 'succeeded'::public.run_status
     and agent_run.attempt_number = 1
     and pg_catalog.jsonb_array_length(agent_run.checks) = 4
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(agent_run.checks) check_item
        where check_item ->> 'conclusion' is distinct from 'success'
          or check_item ->> 'name' not in (
            'Lint, typecheck, test, and build',
            'Browser and accessibility tests 1/3',
            'Browser and accessibility tests 2/3',
            'Browser and accessibility tests 3/3'
          )
     )
     and (
       select pg_catalog.count(distinct check_item ->> 'name')
         from pg_catalog.jsonb_array_elements(agent_run.checks) check_item
     ) = 4
     and deployment.environment = 'Production'
     and deployment.provider = 'github'
     and pg_catalog.lower(deployment.commit_sha) =
       pg_catalog.current_setting('softwarefactory.causal.release_sha')
     and pg_catalog.rtrim(deployment.url, '/') =
       pg_catalog.current_setting('softwarefactory.causal.deployment_url')
     and deployment.status = 'succeeded'::public.deployment_status
     and deployment.started_at >= pull.merged_at and deployment.completed_at is not null
     and observation.outcome = 'pass'::public.signal_outcome
     and observation.status_code between 200 and 299
     and observation.evidence ->> 'deploymentId' = deployment.id::text
     and observation.evidence ->> 'postDeployValidation' = 'passed'
     and pg_catalog.lower(observation.evidence ->> 'releaseSha') =
       pg_catalog.current_setting('softwarefactory.causal.release_sha')
     and pg_catalog.rtrim(observation.evidence ->> 'url', '/') =
       pg_catalog.current_setting('softwarefactory.causal.production_origin')
     and pg_catalog.rtrim(observation.evidence ->> 'deploymentUrl', '/') =
       pg_catalog.current_setting('softwarefactory.causal.deployment_url')
     and monitor.signal_kind = 'uptime'::public.production_signal_kind
     and monitor.provider = 'http'
     and monitor.target_reference = 'graph_phase1c_bridge:' || bridge.id::text
     and pg_catalog.rtrim(monitor.target_url, '/') =
       pg_catalog.current_setting('softwarefactory.causal.production_origin')
     and monitor.connection_state = 'connected'::public.monitor_connection_state
     and not monitor.enabled
     and validation.state = 'passed'::public.deployment_validation_state
     and validation.validator_version = 'graph-production-validator-v3'
     and validation.policy_version = 'post-deploy-v1'
     and validation.baseline_reference = 'release:' || bridge.merge_commit_sha
     and validation.correlation_id = observation.correlation_id
     and validation.started_at is not null and validation.completed_at is not null
     and pg_catalog.jsonb_array_length(validation.checks) = 5
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(validation.checks) check_item
        where check_item ->> 'stage' not in (
          'identity', 'availability', 'data_integration', 'quality_security', 'observation'
        ) or check_item -> 'required' is distinct from 'true'::jsonb
          or check_item ->> 'result' is distinct from 'pass'
     )
     and (
       select pg_catalog.count(distinct check_item ->> 'stage')
         from pg_catalog.jsonb_array_elements(validation.checks) check_item
     ) = 5
     and nodes.node_run_count = graph_nodes.total
     and nodes.completed_with_artifact_count = graph_nodes.total
     and nodes.claude_count >= 1
     and (select pg_catalog.count(*) from terminal_anchor) = 1
) then (
  select pg_catalog.jsonb_build_object(
    'ready', true,
    'sessionId', pg_catalog.current_setting('softwarefactory.causal.session_id')::uuid,
    'graphId', graph.id,
    'initialGraphRunId', initial.id,
    'draftGraphRunId', draft.id,
    'terminalGraphRunId', terminal.id,
    'graphRunIds', history.ids,
    'wakeReceiptId', receipt.id,
    'bridgeId', bridge.id,
    'agentRunId', agent_run.id,
    'pullRequestId', pull.id,
    'pullRequestNumber', pull.external_number,
    'headSha', pull.head_sha,
    'mergeCommitSha', pull.merge_commit_sha,
    'deploymentId', deployment.id,
    'monitorObservationId', observation.id,
    'deploymentValidationId', validation.id,
    'terminalArtifactId', (select id from terminal_anchor),
    'deploymentUrl', pg_catalog.rtrim(deployment.url, '/')
  )
    from exact_graph graph
    join initial_run initial on true
    join draft_run draft on true
    join terminal_run terminal on true
    join graph_history history on true
    join exact_bridge bridge on true
    join exact_agent_run agent_run on true
    join exact_pull pull on true
    join exact_deployment deployment on true
    join exact_observation observation on true
    join exact_validation validation on true
    join exact_receipt receipt on true
) else pg_catalog.jsonb_build_object('ready', false) end;
