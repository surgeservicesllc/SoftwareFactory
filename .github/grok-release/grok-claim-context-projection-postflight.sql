\set ON_ERROR_STOP on

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';

do $grok_claim_context_catalog_postflight$
declare
  v_expected record;
  v_routine oid;
begin
  if (select pg_catalog.count(*) from supabase_migrations.schema_migrations
       where version = '20260831001500') <> 1 then
    raise exception 'grok_claim_context_postflight_ledger_mismatch';
  end if;

  if 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and relation.relkind = 'r'
       and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or exists (
    select 1
      from information_schema.role_table_grants privilege
     where privilege.table_schema = 'public'
       and privilege.table_name in ('grok_context_envelopes', 'grok_context_items')
       and privilege.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) or 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and policy.polname in (
         'grok_context_envelopes_select_member',
         'grok_context_items_select_member'
       )
       and policy.polcmd = 'r'
       and policy.polpermissive
       and policy.polroles = array[(
         select role.oid from pg_catalog.pg_roles role
          where role.rolname = 'authenticated'
       )]
       and pg_catalog.replace(
         pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), ' ', ''
       ) in (
         'is_organization_member(organization_id)',
         'public.is_organization_member(organization_id)'
       )
       and policy.polwithcheck is null
  ) or 4 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and trigger_row.tgname in (
         'grok_context_envelopes_immutable', 'grok_context_envelopes_no_truncate',
         'grok_context_items_immutable', 'grok_context_items_no_truncate'
       )
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgfoid = pg_catalog.to_regprocedure(
         'public.reject_grok_evidence_mutation()'
       )
  ) then
    raise exception 'grok_claim_context_postflight_evidence_catalog_mismatch';
  end if;

  for v_expected in
    select * from (values
      ('public.grok_initial_context_claim_projection(uuid)',
       '06c7fb24b7c4b50bbf80aee57385ff57', false),
      ('public.attach_current_grok_admissions_to_claim(jsonb)',
       'c1075dafaa5bc957d16ff2599382a811', false),
      ('public.attach_current_grok_admission_to_phase1c_claim(jsonb)',
       '2562fa378097239ce4a3e47e9121d410', false),
      ('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)',
       '4a6da8bed8d1fdda17f11df00d549817', true),
      ('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
       'f83873aa19703d2c61553026d4141a4c', true),
      ('public.claim_phase1c_run_v3(text,text,text,integer,integer)',
       'ef8803cb5ec809266b8fdf6f048b1a2f', true),
      ('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)',
       '14c204c6c9d8da1ed6038d0f56942be8', true)
    ) expected(signature, source_md5, service_role_execute)
  loop
    v_routine := pg_catalog.to_regprocedure(v_expected.signature);
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
         and routine.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
         and not routine.proleakproof
         and not routine.proisstrict
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
           = v_expected.service_role_execute
         and not exists (
           select 1 from pg_catalog.aclexplode(routine.proacl) acl
            where acl.privilege_type <> 'EXECUTE'
               or acl.grantor <> routine.proowner
               or (
                 acl.grantee <> routine.proowner
                 and acl.grantee is distinct from case
                   when v_expected.service_role_execute then (
                     select role.oid from pg_catalog.pg_roles role
                      where role.rolname = 'service_role'
                   ) else null end
               )
         )
    ) then
      raise exception 'grok_claim_context_postflight_function_identity_acl_or_hash_mismatch: %',
        v_expected.signature;
    end if;
  end loop;
end;
$grok_claim_context_catalog_postflight$;

do $grok_claim_context_runtime_postflight$
declare
  v_owner uuid := pg_catalog.gen_random_uuid();
  v_organization uuid := pg_catalog.gen_random_uuid();
  v_project uuid := pg_catalog.gen_random_uuid();
  v_session public.grok_sessions;
  v_user_message public.grok_messages;
  v_plan_message public.grok_messages;
  v_link public.grok_task_links;
  v_graph_id uuid;
  v_initial jsonb;
  v_replay jsonb;
  v_projection jsonb;
  v_follow_up jsonb;
  v_items jsonb;
  v_initial_text text := 'Bounded initial claim context.';
  v_follow_up_text text := 'Later context requires a fresh plan.';
  v_blocked boolean;
begin
  insert into auth.users(id, email) values (
    v_owner, 'grok-claim-context-' || v_owner::text || '@example.org'
  );
  insert into public.organizations(id, name, slug, created_by) values (
    v_organization, 'Grok claim context release organization',
    'gcc-' || pg_catalog.replace(v_organization::text, '-', ''), v_owner
  );
  insert into public.projects(
    id, organization_id, name, status, github_repository, default_branch,
    production_url, created_by
  ) values (
    v_project, v_organization, 'Grok Claim Context Release', 'active',
    'example/grok-claim-context', 'main',
    'https://claim-context.example.org', v_owner
  );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  select * into strict v_session from public.create_grok_session(
    v_organization, v_project, 'Grok claim-context acceptance',
    'grok-claim-context-session'
  );
  select * into strict v_user_message from public.append_grok_user_message(
    v_organization, v_session.id, 'Keep the owner goal intact.',
    pg_catalog.jsonb_build_object('schemaVersion', 1, 'kind', 'grok.user_prompt'),
    'grok-claim-context-user', 0, null
  );
  v_items := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'kind', 'project', 'label', 'Grok Claim Context Release',
      'media_type', null, 'source_url', 'https://claim-context.example.org',
      'repository_path', null, 'integration_id', null, 'content_text', null,
      'byte_size', 0, 'state', 'reference_only'
    ),
    pg_catalog.jsonb_build_object(
      'kind', 'repository', 'label', 'example/grok-claim-context',
      'media_type', null, 'source_url', null, 'repository_path', 'main',
      'integration_id', null, 'content_text', null, 'byte_size', 0,
      'state', 'reference_only'
    ),
    pg_catalog.jsonb_build_object(
      'kind', 'file', 'label', 'claim-context.md',
      'media_type', 'text/markdown', 'source_url', null,
      'repository_path', null, 'integration_id', null,
      'content_text', v_initial_text,
      'byte_size', pg_catalog.octet_length(v_initial_text), 'state', 'captured'
    )
  );
  v_initial := public.record_grok_context_envelope_as_server(
    v_organization, v_owner, v_project, v_session.id, v_user_message.id,
    v_items, 'grok-claim-context-envelope', 2, false
  );
  v_replay := public.record_grok_context_envelope_as_server(
    v_organization, v_owner, v_project, v_session.id, v_user_message.id,
    v_items, 'grok-claim-context-envelope', 2, false
  );
  if v_initial ->> 'replayed' is distinct from 'false'
      or v_replay ->> 'replayed' is distinct from 'true'
      or v_initial #>> '{envelope,id}' is distinct from v_replay #>> '{envelope,id}'
  then
    raise exception 'grok_claim_context_postflight_context_replay_mismatch';
  end if;

  select * into strict v_plan_message from public.append_grok_message_as_server(
    v_organization, v_session.id, 'assistant', 'The immutable plan is recorded.',
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'kind', 'grok.plan',
      'plan', pg_catalog.jsonb_build_object(
        'planner', pg_catalog.jsonb_build_object('version', 3),
        'intent', pg_catalog.jsonb_build_object('kind', 'build')
      )
    ), 'grok-claim-context-plan', 1, v_user_message.id
  );
  v_graph_id := public.create_graph_from_plan(
    v_organization, v_project, 'Keep the owner goal intact.',
    'SINGLE_AGENT'::public.graph_topology, '[]'::jsonb,
    'green'::public.risk_level, false,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'node_key', 'record', 'job', 'Record only', 'executor', 'DETERMINISTIC',
      'capability', 'planning', 'model_tier', 'NONE', 'writes', '[]'::jsonb,
      'lifecycle_stage', null, 'gate_kind', null
    )), '[]'::jsonb,
    pg_catalog.jsonb_build_object('max_nodes', 1, 'max_concurrent_nodes', 1)
  );
  v_link := public.link_grok_task_as_server(
    v_organization, v_session.id, v_plan_message.id,
    null, null, v_graph_id, null, 'planned'
  );
  insert into public.grok_graph_launches(
    organization_id, project_id, session_id, message_id, idempotency_key,
    input_sha256, graph_id, task_link_id, created_by
  ) values (
    v_organization, v_project, v_session.id, v_plan_message.id,
    'grok-claim-context-launch', pg_catalog.repeat('a', 64),
    v_graph_id, v_link.id, v_owner
  );

  v_projection := public.grok_initial_context_claim_projection(v_graph_id);
  if v_projection #>> '{envelope_id}' is distinct from
       v_initial #>> '{envelope,id}'
      or v_projection #>> '{input_sha256}' is distinct from
       v_initial #>> '{envelope,input_sha256}'
      or v_projection #>> '{item_count}' is distinct from '3'
      or v_projection::text not like '%' || v_initial_text || '%'
      or v_projection::text like '%source_bytes%'
  then
    raise exception 'grok_claim_context_postflight_initial_projection_mismatch';
  end if;

  v_follow_up := public.append_grok_follow_up_context(
    v_organization, v_project, v_session.id, v_follow_up_text,
    pg_catalog.jsonb_build_array(
      v_items -> 0, v_items -> 1,
      pg_catalog.jsonb_build_object(
        'kind', 'file', 'label', 'later.md', 'media_type', 'text/markdown',
        'source_url', null, 'repository_path', null, 'integration_id', null,
        'content_text', v_follow_up_text,
        'byte_size', pg_catalog.octet_length(v_follow_up_text), 'state', 'captured'
      )
    ), 'grok-claim-context-follow-up', 2, 4, v_plan_message.id
  );
  v_projection := public.grok_initial_context_claim_projection(v_graph_id);
  if v_follow_up ->> 'replan_required' is distinct from 'true'
      or v_projection::text not like '%' || v_initial_text || '%'
      or v_projection::text like '%' || v_follow_up_text || '%'
  then
    raise exception 'grok_claim_context_postflight_follow_up_boundary_mismatch';
  end if;

  v_blocked := false;
  begin
    alter table public.grok_context_items disable trigger grok_context_items_immutable;
    alter table public.grok_context_items
      drop constraint grok_context_items_content_no_secret;
    update public.grok_context_items
       set content_text = 'API_KEY=' || 'sk-' || pg_catalog.repeat('x', 32),
           byte_size = 43,
           content_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
             'API_KEY=' || 'sk-' || pg_catalog.repeat('x', 32), 'UTF8'
           )), 'hex')
     where envelope_id = (v_initial #>> '{envelope,id}')::uuid
       and kind = 'file';
    perform public.grok_initial_context_claim_projection(v_graph_id);
  exception when sqlstate '55000' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_claim_context_postflight_secret_tamper_was_not_blocked';
  end if;

  if (select graph.goal from public.graphs graph where graph.id = v_graph_id)
       is distinct from 'Keep the owner goal intact.'
      or exists (
        select 1 from public.grok_events event
         where event.session_id = v_session.id
           and event.event_type = 'context.recorded'
           and (
             event.payload ?| array['content', 'content_text', 'items']
             or event.payload ->> 'workerWoken' is distinct from 'false'
             or event.payload ->> 'executionStarted' is distinct from 'false'
           )
      )
      or exists (
        select 1 from public.graph_runs graph_run where graph_run.graph_id = v_graph_id
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
        select 1 from public.graph_phase1c_bridges bridge where bridge.graph_id = v_graph_id
      )
  then
    raise exception 'grok_claim_context_postflight_goal_audit_or_zero_run_mismatch';
  end if;
end;
$grok_claim_context_runtime_postflight$;

select 'grok-claim-context-release-postflight-ok';
rollback;
