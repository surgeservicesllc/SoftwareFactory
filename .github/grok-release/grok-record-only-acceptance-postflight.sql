\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'softwarefactory.acceptance.account_email', :'account_email', false
) as account_email_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.project_id', :'project_id', false
) as project_id_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.project_name', :'project_name', false
) as project_name_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.goal', :'goal', false
) as goal_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.session_id', :'session_id', false
) as session_id_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.graph_id', :'graph_id', false
) as graph_id_setting \gset

do $grok_record_only_postflight$
declare
  v_account_email text := pg_catalog.current_setting(
    'softwarefactory.acceptance.account_email'
  );
  v_project_id uuid := pg_catalog.current_setting(
    'softwarefactory.acceptance.project_id'
  )::uuid;
  v_project_name text := pg_catalog.current_setting(
    'softwarefactory.acceptance.project_name'
  );
  v_goal text := pg_catalog.current_setting(
    'softwarefactory.acceptance.goal'
  );
  v_session_id uuid := pg_catalog.current_setting(
    'softwarefactory.acceptance.session_id'
  )::uuid;
  v_graph_id uuid := pg_catalog.current_setting(
    'softwarefactory.acceptance.graph_id'
  )::uuid;
  v_user_id uuid;
  v_organization_id uuid;
  v_plan_message public.grok_messages;
  v_plan jsonb;
  v_roster jsonb;
  v_roster_count integer;
  v_expected_route_count integer;
  v_admission_count integer;
  v_session public.grok_sessions;
  v_graph public.graphs;
  v_json_assignment_ids text[];
  v_row_assignment_ids text[];
begin
  select account.id
    into strict v_user_id
    from auth.users account
   where pg_catalog.lower(account.email) = pg_catalog.lower(v_account_email)
     and account.email_confirmed_at is not null
     and account.deleted_at is null;

  select project.organization_id
    into strict v_organization_id
    from public.projects project
    join public.organization_members member
      on member.organization_id = project.organization_id
     and member.user_id = v_user_id
     and member.role = 'owner'::public.organization_member_role
   where project.id = v_project_id
     and project.name = v_project_name;

  select session.*
    into strict v_session
    from public.grok_sessions session
     where session.id = v_session_id
       and session.organization_id = v_organization_id
       and session.project_id = v_project_id
       and session.created_by = v_user_id
       and session.status = 'active'
       and session.closed_at is null
       and session.last_message_sequence = 2
       and session.last_event_sequence = 6;
  if (select pg_catalog.count(*) from public.grok_messages message
       where message.session_id = v_session_id
         and message.organization_id = v_organization_id) <> 2
      or not exists (
        select 1 from public.grok_messages message
         where message.session_id = v_session_id
           and message.sequence_no = 1
           and message.role = 'user'
           and message.content = v_goal
           and message.actor_user_id = v_user_id
      )
  then
    raise exception 'grok_record_only_exact_transcript_mismatch';
  end if;

  select message.*
    into strict v_plan_message
    from public.grok_messages message
   where message.session_id = v_session_id
     and message.organization_id = v_organization_id
     and message.project_id = v_project_id
     and message.sequence_no = 2
     and message.role = 'assistant'
     and message.actor_user_id is null
     and message.metadata ->> 'kind' = 'grok.plan';
  v_plan := v_plan_message.metadata -> 'plan';
  v_roster := v_plan -> 'admissionRoster';
  if pg_catalog.jsonb_typeof(v_plan) is distinct from 'object'
      or v_plan #>> '{planner,id}' is distinct from 'grok-chief-of-staff'
      or v_plan #>> '{planner,version}' is distinct from '3'
      or v_plan #>> '{planner,deterministic}' is distinct from 'true'
      or v_plan #>> '{planner,executionStarted}' is distinct from 'false'
      or v_plan #>> '{intent,kind}' is distinct from 'build'
      or v_plan #>> '{intent,prompt}' is distinct from v_goal
      or v_plan #>> '{project,projectId}' is distinct from v_project_id::text
      or v_plan #>> '{project,name}' is distinct from v_project_name
      or v_plan #>> '{delivery,mode}' is distinct from 'HANDOFF_ONLY'
      or v_plan #>> '{validation,compiler}' is distinct from 'PASSED'
      or v_plan #>> '{validation,removedEdgeCount}' is distinct from '0'
      or v_plan #>> '{validation,unresolvedWriteConflictCount}' is distinct from '0'
      or pg_catalog.jsonb_typeof(v_roster) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_roster) not between 1 and 64
      or pg_catalog.jsonb_typeof(v_plan #> '{dag,tasks}') is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_plan #> '{dag,tasks}') < 1
  then
    raise exception 'grok_record_only_planner_v3_plan_mismatch';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_plan #> '{dag,tasks}') task
     where pg_catalog.jsonb_typeof(task.value) <> 'object'
        or not task.value ?& array[
          'id', 'provider', 'model', 'agentId', 'assignmentId',
          'assignmentRevision', 'botId', 'botRevision', 'roleId',
          'roleUpdatedAt', 'aiAccountId', 'credentialRef',
          'credentialPurpose', 'accountUpdatedAt', 'agentCapabilities',
          'agentMaxModelTier', 'capability'
        ]
        or task.value ->> 'provider' not in ('anthropic', 'openai')
        or pg_catalog.btrim(coalesce(task.value ->> 'model', '')) = ''
        or not exists (
          select 1
            from pg_catalog.jsonb_array_elements(v_roster) roster_entry
           where roster_entry.value ->> 'assignmentId'
             = task.value ->> 'assignmentId'
        )
  ) then
    raise exception 'grok_record_only_task_route_is_not_complete';
  end if;

  v_roster_count := pg_catalog.jsonb_array_length(v_roster);
  select pg_catalog.array_agg(
           roster_entry.value ->> 'assignmentId'
           order by roster_entry.value ->> 'assignmentId'
         )
    into v_json_assignment_ids
    from pg_catalog.jsonb_array_elements(v_roster) roster_entry;
  select pg_catalog.array_agg(
           admission.assignment_id::text order by admission.assignment_id::text
         )
    into v_row_assignment_ids
    from public.grok_specialist_admissions admission
   where admission.organization_id = v_organization_id
     and admission.project_id = v_project_id
     and admission.session_id = v_session_id
     and admission.message_id = v_plan_message.id;
  if v_json_assignment_ids is distinct from v_row_assignment_ids
      or pg_catalog.cardinality(v_row_assignment_ids) is distinct from v_roster_count
      or exists (
        select 1 from public.grok_specialist_admissions admission
         where admission.organization_id = v_organization_id
           and admission.session_id = v_session_id
           and admission.message_id = v_plan_message.id
           and (
             admission.roster_version <> 1
             or admission.admission_sha256 is distinct from
                public.grok_specialist_admission_hash(admission)
             or not exists (
               select 1 from pg_catalog.jsonb_array_elements(v_roster) roster_entry
                where roster_entry.value ->> 'assignmentId' = admission.assignment_id::text
                  and (roster_entry.value ->> 'assignmentRevision')::bigint = admission.assignment_revision
                  and (roster_entry.value ->> 'botId')::uuid = admission.bot_id
                  and (roster_entry.value ->> 'botRevision')::bigint = admission.bot_revision
                  and (roster_entry.value ->> 'roleId')::uuid = admission.role_id
                  and (roster_entry.value ->> 'aiAccountId')::uuid = admission.ai_account_id
                  and roster_entry.value ->> 'provider' = admission.provider::text
                  and roster_entry.value ->> 'model' = admission.model
                  and roster_entry.value ->> 'credentialRef' = admission.credential_ref
                  and roster_entry.value ->> 'credentialPurpose' = admission.credential_purpose
             )
           )
      )
  then
    raise exception 'grok_record_only_specialist_roster_evidence_mismatch';
  end if;

  if not exists (
    select 1 from public.grok_events event
     where event.session_id = v_session_id
       and event.organization_id = v_organization_id
       and event.sequence_no = 4
       and event.event_type = 'roster.admitted'
       and event.message_id = v_plan_message.id
       and event.payload ->> 'workerWoken' = 'false'
       and event.payload ->> 'executionStarted' = 'false'
       and (event.payload ->> 'rosterCount')::integer = v_roster_count
       and event.payload ->> 'rosterSha256' = pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(v_roster::text, 'UTF8')),
         'hex'
       )
  ) or not exists (
    select 1 from public.grok_events event
     where event.session_id = v_session_id
       and event.sequence_no = 5
       and event.event_type = 'session.planned'
  ) or not exists (
    select 1 from public.grok_events event
     where event.session_id = v_session_id
       and event.sequence_no = 6
       and event.event_type = 'graph.planned'
       and event.payload ->> 'workerWoken' = 'false'
       and event.payload ->> 'executionStarted' = 'false'
       and (event.payload ->> 'graphId')::uuid = v_graph_id
  ) then
    raise exception 'grok_record_only_immutable_event_evidence_mismatch';
  end if;

  select graph.*
    into strict v_graph
    from public.graphs graph
   where graph.id = v_graph_id
     and graph.organization_id = v_organization_id
     and graph.project_id = v_project_id
     and graph.goal = v_goal
     and graph.created_by = v_user_id;
  if v_graph.pause_requested_at is null
      or v_graph.pause_requested_by is distinct from v_user_id
      or v_graph.withdrawn_at is not null
      or v_graph.template_key is distinct from 'full_lifecycle'
      or v_graph.template_version is distinct from 2
  then
    raise exception 'grok_record_only_graph_is_not_exactly_paused';
  end if;
  if (select pg_catalog.count(*) from public.grok_graph_launches launch
       where launch.organization_id = v_organization_id
         and launch.project_id = v_project_id
         and launch.session_id = v_session_id
         and launch.message_id = v_plan_message.id
         and launch.graph_id = v_graph_id
         and launch.created_by = v_user_id) <> 1
      or (select pg_catalog.count(*) from public.grok_task_links task_link
           where task_link.organization_id = v_organization_id
             and task_link.session_id = v_session_id
             and task_link.message_id = v_plan_message.id
             and task_link.graph_id = v_graph_id
             and task_link.graph_run_id is null
             and task_link.command_id is null
             and task_link.task_id is null
             and task_link.relation = 'planned') <> 1
  then
    raise exception 'grok_record_only_launch_or_lineage_mismatch';
  end if;

  select pg_catalog.count(*)::integer
    into v_expected_route_count
    from public.graph_nodes node
   where node.organization_id = v_organization_id
     and node.graph_id = v_graph_id
     and (
       node.executor = 'MODEL'::public.graph_node_executor
       or (
         node.executor = 'ANCHOR'::public.graph_node_executor
         and node.node_key = 'implement'
         and node.capability = 'implementation'
       )
     );
  select pg_catalog.count(*)::integer
    into v_admission_count
    from public.grok_execution_admissions admission
   where admission.organization_id = v_organization_id
     and admission.project_id = v_project_id
     and admission.session_id = v_session_id
     and admission.message_id = v_plan_message.id
     and admission.graph_id = v_graph_id;
  if v_expected_route_count < 1
      or v_admission_count is distinct from v_expected_route_count
      or public.assert_current_grok_execution_admissions(v_graph_id) is distinct from true
      or exists (
        select 1 from public.grok_execution_admissions admission
         where admission.organization_id = v_organization_id
           and admission.graph_id = v_graph_id
           and (
             admission.specialist_admission_id is null
             or admission.admission_sha256 is distinct from
                public.grok_current_execution_admission_hash(admission)
           )
      )
  then
    raise exception 'grok_record_only_provider_route_admission_mismatch';
  end if;

  if exists (
    select 1 from public.graph_runs graph_run
     where graph_run.organization_id = v_organization_id
       and graph_run.graph_id = v_graph_id
  ) or exists (
    select 1 from public.node_runs node_run
     join public.graph_runs graph_run
       on graph_run.id = node_run.graph_run_id
      and graph_run.organization_id = node_run.organization_id
     where graph_run.graph_id = v_graph_id
  ) or exists (
    select 1 from public.graph_phase1c_bridges bridge
     where bridge.organization_id = v_organization_id
       and bridge.graph_id = v_graph_id
  ) or exists (
    select 1 from public.grok_phase1c_submission_guards
  ) or exists (
    select 1 from public.agent_runs agent_run
     where agent_run.organization_id = v_organization_id
       and agent_run.project_id = v_project_id
       and agent_run.created_at >= v_session.created_at
  ) or exists (
    select 1
      from public.provider_run_events provider_event
      join public.agent_runs agent_run
        on agent_run.id = provider_event.agent_run_id
       and agent_run.organization_id = provider_event.organization_id
     where agent_run.organization_id = v_organization_id
       and agent_run.project_id = v_project_id
       and agent_run.created_at >= v_session.created_at
  ) then
    raise exception 'grok_record_only_execution_evidence_must_be_zero';
  end if;

  if exists (
    select 1 from public.organizations organization
     where coalesce(organization.autonomous_mode, false)
        or organization.autonomy_kill_switch_active is distinct from true
        or coalesce(organization.auto_plan, false)
        or coalesce(organization.auto_code, false)
        or coalesce(organization.auto_test, false)
        or coalesce(organization.auto_repair, false)
        or coalesce(organization.auto_review, false)
        or coalesce(organization.auto_approve, false)
        or coalesce(organization.auto_merge, false)
        or coalesce(organization.auto_deploy, false)
        or coalesce(organization.auto_rollback, false)
  ) or exists (
    select 1 from public.projects project
     where coalesce(project.autonomous_mode, false)
        or coalesce(project.auto_plan, false)
        or coalesce(project.auto_code, false)
        or coalesce(project.auto_test, false)
        or coalesce(project.auto_repair, false)
        or coalesce(project.auto_review, false)
        or coalesce(project.auto_approve, false)
        or coalesce(project.auto_merge, false)
        or coalesce(project.auto_deploy, false)
        or coalesce(project.auto_rollback, false)
  ) or exists (
    select 1 from public.phase1c_workers worker
     where worker.last_heartbeat_at > pg_catalog.now() - interval '10 minutes'
        or worker.last_heartbeat_at > pg_catalog.now() + interval '1 minute'
        or worker.current_run_id is not null
  ) or exists (
    select 1 from public.graph_runs graph_run
     where graph_run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs agent_run
     where agent_run.status = 'running'::public.run_status
  ) then
    raise exception 'grok_record_only_postflight_containment_not_stopped';
  end if;
end;
$grok_record_only_postflight$;

select 'grok-record-only-postflight-ok';
