\set ON_ERROR_STOP on

select pg_catalog.set_config('softwarefactory.causal.account_email', :'account_email', false) as account_email_setting \gset
select pg_catalog.set_config('softwarefactory.causal.project_id', :'project_id', false) as project_id_setting \gset
select pg_catalog.set_config('softwarefactory.causal.repository', :'repository', false) as repository_setting \gset
select pg_catalog.set_config('softwarefactory.causal.default_branch', :'default_branch', false) as default_branch_setting \gset
select pg_catalog.set_config('softwarefactory.causal.release_sha', :'release_sha', false) as release_sha_setting \gset
select pg_catalog.set_config('softwarefactory.causal.goal', :'goal', false) as goal_setting \gset
select pg_catalog.set_config('softwarefactory.causal.context_sha256', :'context_sha256', false) as context_sha_setting \gset
select pg_catalog.set_config('softwarefactory.causal.session_id', :'session_id', false) as session_id_setting \gset
select pg_catalog.set_config('softwarefactory.causal.graph_id', :'graph_id', false) as graph_id_setting \gset
select pg_catalog.set_config('softwarefactory.causal.wake_intent_id', :'wake_intent_id', false) as wake_id_setting \gset
select pg_catalog.set_config('softwarefactory.causal.control_revision', :'control_revision', false) as revision_setting \gset

do $grok_causal_start_identity$
declare
  v_user uuid;
  v_org uuid;
  v_project uuid := pg_catalog.current_setting('softwarefactory.causal.project_id')::uuid;
  v_session uuid := pg_catalog.current_setting('softwarefactory.causal.session_id')::uuid;
  v_graph uuid := pg_catalog.current_setting('softwarefactory.causal.graph_id')::uuid;
  v_wake uuid := pg_catalog.current_setting('softwarefactory.causal.wake_intent_id')::uuid;
  v_revision bigint := pg_catalog.current_setting('softwarefactory.causal.control_revision')::bigint;
  v_run uuid;
begin
  select account.id into strict v_user from auth.users account
   where pg_catalog.lower(account.email) = pg_catalog.lower(
     pg_catalog.current_setting('softwarefactory.causal.account_email')
   ) and account.email_confirmed_at is not null and account.deleted_at is null;
  select session.organization_id into strict v_org
    from public.grok_sessions session
    join public.grok_graph_launches launch on launch.session_id = session.id
     and launch.organization_id = session.organization_id
     and launch.project_id = session.project_id
    join public.graphs graph on graph.id = launch.graph_id
     and graph.organization_id = launch.organization_id
    join public.github_repositories repository on repository.id = graph.github_repository_id
     and repository.organization_id = graph.organization_id
   where session.id = v_session and session.project_id = v_project
     and session.created_by = v_user and launch.graph_id = v_graph
     and graph.template_key = 'full_lifecycle' and graph.template_version = 2
     and graph.goal = pg_catalog.current_setting('softwarefactory.causal.goal')
     and graph.base_sha = pg_catalog.current_setting('softwarefactory.causal.release_sha')
     and graph.base_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
     and repository.full_name = pg_catalog.current_setting('softwarefactory.causal.repository')
     and graph.required_check_names = pg_catalog.to_jsonb(array[
       'Lint, typecheck, test, and build',
       'Browser and accessibility tests 1/3',
       'Browser and accessibility tests 2/3',
       'Browser and accessibility tests 3/3'
     ]::text[])
     and graph.required_checks_sha256 = pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(graph.required_check_names::text, 'UTF8')
     ), 'hex');

  if (select pg_catalog.count(*) from public.grok_messages message
       where message.organization_id = v_org and message.session_id = v_session) <> 2
    or (select pg_catalog.count(*) from public.grok_context_envelopes envelope
         where envelope.organization_id = v_org and envelope.session_id = v_session) <> 1
    or not exists (
    select 1 from public.grok_messages message
     where message.organization_id = v_org and message.session_id = v_session
       and message.sequence_no = 1 and message.role = 'user'
       and message.content = pg_catalog.current_setting('softwarefactory.causal.goal')
  ) or not exists (
    select 1 from public.grok_messages message
     where message.organization_id = v_org and message.session_id = v_session
       and message.sequence_no = 2 and message.role = 'assistant'
       and message.metadata #>> '{plan,planner,version}' = '3'
       and message.metadata #>> '{plan,intent,kind}' in ('build', 'fix')
  ) or not exists (
    select 1 from public.grok_context_envelopes envelope
     where envelope.organization_id = v_org and envelope.session_id = v_session
       and envelope.input_sha256 = pg_catalog.current_setting('softwarefactory.causal.context_sha256')
       and envelope.item_count = 3 and not envelope.replan_required
       and (select pg_catalog.count(*) from public.grok_context_items item
             where item.envelope_id = envelope.id and item.organization_id = v_org) = 3
       and (select pg_catalog.count(*) from public.grok_context_items item
             where item.envelope_id = envelope.id and item.organization_id = v_org
               and item.kind = 'file' and item.state = 'captured') = 1
  ) then raise exception 'grok_causal_plan_roster_or_context_identity_mismatch'; end if;

  if not exists (
    select 1 from public.grok_specialist_admissions admission
     where admission.organization_id = v_org and admission.project_id = v_project
       and admission.session_id = v_session
       and admission.admission_sha256 = public.grok_specialist_admission_hash(admission)
     group by admission.session_id
    having pg_catalog.bool_or(admission.provider = 'anthropic'::public.bot_provider)
       and pg_catalog.bool_or(admission.provider = 'openai'::public.bot_provider)
       and pg_catalog.count(*) between 2 and 64
  ) or exists (
    select 1 from public.grok_specialist_admissions admission
     where admission.organization_id = v_org and admission.project_id = v_project
       and admission.session_id = v_session
       and admission.admission_sha256 is distinct from
         public.grok_specialist_admission_hash(admission)
  ) or not exists (
    select 1 from public.grok_execution_admissions admission
     where admission.organization_id = v_org and admission.project_id = v_project
       and admission.session_id = v_session and admission.graph_id = v_graph
  ) or exists (
    select 1 from public.grok_execution_admissions admission
     where admission.organization_id = v_org and admission.graph_id = v_graph
       and admission.admission_sha256 is distinct from public.grok_current_execution_admission_hash(admission)
  ) then raise exception 'grok_causal_admission_identity_mismatch'; end if;

  if (select pg_catalog.count(*) from public.grok_graph_wake_intents wake
       where wake.graph_id = v_graph and wake.organization_id = v_org) <> 1
    or (select pg_catalog.count(*) from public.grok_graph_wake_dispatch_attempts attempt
         where attempt.wake_intent_id = v_wake) <> 1
    or (select pg_catalog.count(*) from public.grok_graph_wake_receipts receipt
         where receipt.wake_intent_id = v_wake) <> 1
    or not exists (
    select 1 from public.grok_graph_wake_intents wake
     where wake.id = v_wake and wake.organization_id = v_org
       and wake.project_id = v_project and wake.session_id = v_session
       and wake.graph_id = v_graph and wake.control_revision = v_revision
  ) or not exists (
    select 1 from public.grok_graph_wake_dispatch_attempts attempt
     where attempt.wake_intent_id = v_wake and attempt.control_revision = v_revision
       and attempt.outcome = 'accepted'
  ) or not exists (
    select 1 from public.grok_graph_wake_receipts receipt
     where receipt.wake_intent_id = v_wake and receipt.control_revision = v_revision
       and receipt.session_id = v_session and receipt.graph_id = v_graph
       and receipt.protocol_version = 1 and receipt.capability_version = 1
  ) then raise exception 'grok_causal_durable_wake_receipt_mismatch'; end if;

  select receipt.graph_run_id into strict v_run
    from public.grok_graph_wake_receipts receipt where receipt.wake_intent_id = v_wake;
  if not exists (
    select 1 from public.graph_runs run
     where run.id = v_run and run.graph_id = v_graph
       and run.organization_id = v_org
       and run.state in ('RUNNING', 'PARTIAL', 'COMPLETED')
  ) or exists (
    select 1 from public.graph_runs run
     where run.graph_id = v_graph
       and (run.state in ('FAILED', 'CANCELLED', 'BUDGET_STOPPED')
         or run.had_partial_input)
  ) or exists (
    select 1 from public.node_runs node_run
    join public.graph_runs graph_run on graph_run.id = node_run.graph_run_id
     where graph_run.graph_id = v_graph
       and node_run.state in ('FAILED', 'CANCELLED')
  ) then raise exception 'grok_causal_run_history_or_provider_failure_mismatch'; end if;

  if exists (
    select 1 from public.graph_phase1c_bridges bridge
     where bridge.graph_id = v_graph and (
       bridge.graph_run_id is distinct from v_run
       or bridge.project_id is distinct from v_project
       or (bridge.agent_run_id is not null and not exists (
         select 1 from public.agent_runs run where run.id = bridge.agent_run_id
           and run.organization_id = bridge.organization_id
           and run.project_id = v_project and run.base_sha = pg_catalog.current_setting('softwarefactory.causal.release_sha')
           and run.provider = 'openai' and run.model = 'gpt-5.3-codex'
       ))
     )
  ) then raise exception 'grok_causal_phase1c_identity_mismatch'; end if;
end;
$grok_causal_start_identity$;

with wake as (
  select intent.id, intent.organization_id, intent.project_id, intent.session_id,
         intent.graph_id, intent.control_revision
    from public.grok_graph_wake_intents intent
   where intent.id = pg_catalog.current_setting('softwarefactory.causal.wake_intent_id')::uuid
), receipt as (
  select receipt.* from public.grok_graph_wake_receipts receipt
  join wake on wake.id = receipt.wake_intent_id
), dispatch as (
  select attempt.* from public.grok_graph_wake_dispatch_attempts attempt
  join wake on wake.id = attempt.wake_intent_id
  where attempt.outcome = 'accepted' and attempt.attempt_number = 1
    and not exists (
      select 1 from public.grok_graph_wake_dispatch_attempts other
       where other.wake_intent_id = attempt.wake_intent_id and other.id <> attempt.id
    )
), bridge as (
  select bridge.* from public.graph_phase1c_bridges bridge
  join receipt on receipt.graph_run_id = bridge.graph_run_id
), phase1c as (
  select run.* from public.agent_runs run
  join bridge on bridge.agent_run_id = run.id
  where run.status = 'succeeded'::public.run_status
    and run.provider = 'openai' and run.model = 'gpt-5.3-codex'
    and run.provider_run_reference is not null
    and run.attempt_number = 1
    and run.head_sha = bridge.head_sha and run.base_sha = pg_catalog.current_setting('softwarefactory.causal.release_sha')
), pull_request as (
  select pull.* from public.pull_requests pull
  join bridge on bridge.pull_request_id = pull.id
  join phase1c on phase1c.id = pull.agent_run_id
  where pull.status = 'draft'::public.pull_request_status
    and pull.head_sha = bridge.head_sha and pull.merge_commit_sha is null
    and pull.repository = pg_catalog.current_setting('softwarefactory.causal.repository')
    and pull.base_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
), graph_history as (
  select pg_catalog.jsonb_agg(run.id order by run.created_at, run.id) as ids,
         pg_catalog.count(*)::integer as run_count,
         pg_catalog.count(*) filter (
           where run.state not in ('PARTIAL', 'COMPLETED')
         )::integer as in_flight_or_bad_count,
         pg_catalog.count(*) filter (
           where run.state in ('FAILED', 'CANCELLED', 'BUDGET_STOPPED')
         )::integer as bad_count,
         pg_catalog.count(*) filter (where run.had_partial_input)::integer as partial_input_count,
         pg_catalog.count(*) filter (
           where run.state in ('PARTIAL', 'COMPLETED') and run.completed_at is null
         )::integer as missing_completion_count
    from public.graph_runs run
    join wake on wake.graph_id = run.graph_id
  having pg_catalog.count(*) between 2 and 10
), test_gate as (
  select gate.opened_by_run_id as graph_run_id
    from public.graph_gates gate
    join bridge on bridge.graph_id = gate.graph_id
    join public.graph_runs run on run.id = gate.opened_by_run_id
     and run.organization_id = gate.organization_id
     and run.graph_id = gate.graph_id
     and run.phase1c_bridge_id = bridge.id
   where gate.stage = 'TEST'::public.sdlc_stage
     and gate.kind = 'HUMAN'::public.gate_kind
     and gate.state = 'OPEN'::public.gate_state
     and run.state in ('PARTIAL', 'COMPLETED')
     and run.completed_at is not null
), claude as (
  select pg_catalog.jsonb_agg(run.id order by run.id) as ids
    from public.node_runs run
    join public.graph_runs graph_run on graph_run.id = run.graph_run_id
    join wake on wake.graph_id = graph_run.graph_id
    join public.graph_nodes node on node.id = run.node_id
     and node.organization_id = run.organization_id
     and node.graph_id = graph_run.graph_id
     and node.graph_id = graph_run.graph_id
   where run.state = 'COMPLETED' and run.provider = 'anthropic'
     and node.executor = 'MODEL' and run.attempt = 1
     and pg_catalog.btrim(coalesce(run.model, '')) <> ''
     and run.started_at is not null and run.completed_at is not null
     and run.latency_ms is not null and run.latency_ms > 0
     and exists (
       select 1 from public.graph_artifacts artifact
        where artifact.graph_run_id = run.graph_run_id and artifact.node_run_id = run.id
     )
  having pg_catalog.count(*) between 1 and 32
), validation as (
  select validation.run_id, validation.validation_round
    from public.phase1c_run_validations validation
    join phase1c on phase1c.id = validation.run_id
   where validation.attempt_number = phase1c.attempt_number
     and validation.validation_round = (
     select pg_catalog.max(candidate.validation_round)
       from public.phase1c_run_validations candidate
      where candidate.run_id = validation.run_id
        and candidate.attempt_number = phase1c.attempt_number
   )
   group by validation.run_id, validation.validation_round
  having pg_catalog.count(*) = 5
     and pg_catalog.count(*) filter (where validation.status = 'failed') = 0
     and pg_catalog.count(*) filter (
       where validation.name in ('diff-check', 'lint', 'typecheck', 'test', 'build')
         and validation.status = 'passed'
     ) = 5
     and pg_catalog.count(distinct validation.name) = 5
)
select case when exists (
  select 1 from wake join receipt on true join dispatch on true join bridge on true
  join phase1c on true join pull_request on true join graph_history on true
  join test_gate on true join claude on true join validation on true
  where bridge.state = 'PULL_REQUEST_RECORDED'
    and graph_history.in_flight_or_bad_count = 0 and graph_history.bad_count = 0
    and graph_history.partial_input_count = 0 and graph_history.missing_completion_count = 0
    and graph_history.ids ->> 0 = receipt.graph_run_id::text
    and graph_history.ids ->> (graph_history.run_count - 1) = test_gate.graph_run_id::text
    and pg_catalog.jsonb_array_length(phase1c.checks) = 4
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(phase1c.checks) check_item
       where check_item.value ->> 'conclusion' is distinct from 'success'
         or check_item.value ->> 'name' not in (
           'Lint, typecheck, test, and build',
           'Browser and accessibility tests 1/3',
           'Browser and accessibility tests 2/3',
           'Browser and accessibility tests 3/3'
         )
    )
    and (
      select pg_catalog.count(distinct check_item.value ->> 'name')
        from pg_catalog.jsonb_array_elements(phase1c.checks) check_item
    ) = 4
) then (
  select pg_catalog.jsonb_build_object(
    'ready', true,
    'initialGraphRunId', receipt.graph_run_id,
    'draftGraphRunId', test_gate.graph_run_id,
    'graphRunIds', graph_history.ids,
    'dispatchAttemptId', dispatch.id,
    'wakeReceiptId', receipt.id,
    'workerId', receipt.worker_id,
    'claudeNodeRunIds', claude.ids,
    'bridgeId', bridge.id,
    'commandId', bridge.command_id,
    'taskId', bridge.task_id,
    'agentRunId', bridge.agent_run_id,
    'pullRequestId', pull_request.id,
    'pullRequestNumber', pull_request.external_number,
    'pullRequestUrl', pull_request.url,
    'headBranch', pull_request.head_branch,
    'baseBranch', pull_request.base_branch,
    'headSha', pull_request.head_sha
  ) from wake join receipt on true join dispatch on true join bridge on true
       join phase1c on true join pull_request on true join graph_history on true
       join test_gate on true join claude on true join validation on true
) else pg_catalog.jsonb_build_object('ready', false) end;
