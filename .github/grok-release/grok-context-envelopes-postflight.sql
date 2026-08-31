\set ON_ERROR_STOP on

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';

do $grok_context_catalog_postflight$
declare
  v_table text;
  v_relation oid;
  v_expected_policy text;
begin
  if (select pg_catalog.count(*) from supabase_migrations.schema_migrations
       where version = '20260831001100') <> 1 then
    raise exception 'grok_context_postflight_ledger_mismatch';
  end if;

  foreach v_table in array array['grok_context_envelopes', 'grok_context_items'] loop
    select relation.oid
      into v_relation
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = v_table
       and relation.relkind = 'r'
       and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
       and relation.relrowsecurity
       and relation.relforcerowsecurity;
    if v_relation is null
        or pg_catalog.has_table_privilege(
          'anon', v_relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        or pg_catalog.has_table_privilege(
          'authenticated', v_relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        or pg_catalog.has_table_privilege(
          'service_role', v_relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        or exists (
          select 1
            from pg_catalog.aclexplode(coalesce(
              (select relation.relacl from pg_catalog.pg_class relation where relation.oid = v_relation),
              pg_catalog.acldefault('r', (
                select relation.relowner from pg_catalog.pg_class relation where relation.oid = v_relation
              ))
            )) acl
           where acl.grantor <> (
                   select relation.relowner from pg_catalog.pg_class relation
                    where relation.oid = v_relation
                 )
              or acl.grantee <> (
                   select relation.relowner from pg_catalog.pg_class relation
                    where relation.oid = v_relation
                 )
        )
    then
      raise exception 'grok_context_postflight_table_rls_or_acl_mismatch: %', v_table;
    end if;

    v_expected_policy := v_table || '_select_member';
    if (select pg_catalog.count(*) from pg_catalog.pg_policy policy
         where policy.polrelid = v_relation) <> 1
        or not exists (
          select 1 from pg_catalog.pg_policy policy
           where policy.polrelid = v_relation
             and policy.polname = v_expected_policy
             and policy.polcmd = 'r'
             and policy.polpermissive
             and policy.polroles = array[(
               select role_row.oid from pg_catalog.pg_roles role_row
                where role_row.rolname = 'authenticated'
             )]
              and pg_catalog.replace(
                pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), ' ', ''
              ) in (
                'is_organization_member(organization_id)',
                'public.is_organization_member(organization_id)'
              )
             and policy.polwithcheck is null
        )
    then
      raise exception 'grok_context_postflight_policy_mismatch: %', v_table;
    end if;

    if (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
         where trigger_row.tgrelid = v_relation and not trigger_row.tgisinternal) <> 2
        or not exists (
          select 1 from pg_catalog.pg_trigger trigger_row
           where trigger_row.tgrelid = v_relation
              and trigger_row.tgname = v_table || '_immutable'
              and not trigger_row.tgisinternal
              and trigger_row.tgenabled = 'O'
              and trigger_row.tgtype = 27
              and trigger_row.tgnargs = 0
              and trigger_row.tgqual is null
              and trigger_row.tgconstraint = 0
             and trigger_row.tgfoid = 'public.reject_grok_evidence_mutation()'::pg_catalog.regprocedure
        )
        or not exists (
          select 1 from pg_catalog.pg_trigger trigger_row
           where trigger_row.tgrelid = v_relation
              and trigger_row.tgname = v_table || '_no_truncate'
              and not trigger_row.tgisinternal
              and trigger_row.tgenabled = 'O'
              and trigger_row.tgtype = 34
              and trigger_row.tgnargs = 0
              and trigger_row.tgqual is null
              and trigger_row.tgconstraint = 0
             and trigger_row.tgfoid = 'public.reject_grok_evidence_mutation()'::pg_catalog.regprocedure
        )
    then
      raise exception 'grok_context_postflight_trigger_mismatch: %', v_table;
    end if;
  end loop;

  if not coalesce((
    with expected(signature, execute_role, volatility, argument_defaults, source_md5) as (values
      ('public.record_grok_context_envelope_internal(uuid,uuid,uuid,uuid,jsonb,text,bigint,uuid,boolean)', null::text, 'v', 0, '9ab00eb67e8ca22d1dabf1f883ec5f58'),
      ('public.record_grok_context_envelope_as_server(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,boolean)', 'service_role', 'v', 1, 'fee968c9a9864cac4b34f7b258812deb'),
      ('public.append_grok_follow_up_context(uuid,uuid,uuid,text,jsonb,text,bigint,bigint,uuid)', 'authenticated', 'v', 1, '85c5597b6e80a6b39d09f29af04e629d'),
      ('public.list_grok_context_envelopes(uuid,uuid,integer)', 'authenticated', 's', 1, '0bcddcfe4ab8922e3b367dc63ea1fa18')
    ), state as (
      select expected.*,
             routine.oid,
             routine.prosecdef,
             routine.proconfig,
             routine.provolatile,
             routine.proparallel,
             routine.prokind,
             routine.prorettype,
             routine.pronargdefaults,
             routine.proleakproof,
             routine.proisstrict,
             routine.proacl,
             routine.proowner,
             (select role_row.oid from pg_catalog.pg_roles role_row
               where role_row.rolname = expected.execute_role) execute_role_oid,
             language_row.lanname,
             pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
               routine.prosrc, E'\r\n', E'\n'
             ), E'\r', E'\n')) actual_md5
        from expected
        left join pg_catalog.pg_proc routine
          on routine.oid = pg_catalog.to_regprocedure(expected.signature)
        left join pg_catalog.pg_language language_row
          on language_row.oid = routine.prolang
    )
    select pg_catalog.bool_and(
      state.oid is not null
      and pg_catalog.pg_get_userbyid(state.proowner) = 'postgres'
      and state.lanname = 'plpgsql'
      and state.prosecdef
      and state.proconfig = array['search_path=pg_catalog']::text[]
      and state.provolatile = state.volatility
      and state.proparallel = 'u'
      and state.prokind = 'f'
      and state.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
      and state.pronargdefaults = state.argument_defaults
      and not state.proleakproof
      and not state.proisstrict
      and state.actual_md5 = state.source_md5
      and state.proacl is not null
      and not pg_catalog.has_function_privilege('anon', state.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('authenticated', state.oid, 'EXECUTE')
        = (state.execute_role = 'authenticated')
      and pg_catalog.has_function_privilege('service_role', state.oid, 'EXECUTE')
        = (state.execute_role = 'service_role')
      and not exists (
        select 1 from pg_catalog.aclexplode(state.proacl) acl
         where acl.privilege_type <> 'EXECUTE'
            or acl.grantor <> state.proowner
            or (
              acl.grantee <> state.proowner
              and acl.grantee is distinct from state.execute_role_oid
            )
      )
      and (select pg_catalog.count(*) from pg_catalog.aclexplode(state.proacl) acl
            where acl.privilege_type = 'EXECUTE')
        = case when state.execute_role is null then 1 else 2 end
    ) from state
  ), false) then
    raise exception 'grok_context_postflight_function_identity_acl_or_hash_mismatch';
  end if;
end;
$grok_context_catalog_postflight$;

do $grok_context_runtime_postflight$
declare
  v_owner uuid := pg_catalog.gen_random_uuid();
  v_member uuid := pg_catalog.gen_random_uuid();
  v_rival_owner uuid := pg_catalog.gen_random_uuid();
  v_organization uuid := pg_catalog.gen_random_uuid();
  v_rival_organization uuid := pg_catalog.gen_random_uuid();
  v_project uuid := pg_catalog.gen_random_uuid();
  v_rival_project uuid := pg_catalog.gen_random_uuid();
  v_connection uuid := pg_catalog.gen_random_uuid();
  v_unlinked_connection uuid := pg_catalog.gen_random_uuid();
  v_session public.grok_sessions;
  v_message public.grok_messages;
  v_assistant public.grok_messages;
  v_initial jsonb;
  v_replay jsonb;
  v_follow_up jsonb;
  v_list jsonb;
  v_items jsonb;
  v_reference_items jsonb;
  v_text text := 'context release';
  v_blocked boolean;
begin
  insert into auth.users(id, email) values
    (v_owner, 'grok-context-owner-' || v_owner::text || '@example.org'),
    (v_member, 'grok-context-member-' || v_member::text || '@example.org'),
    (v_rival_owner, 'grok-context-rival-' || v_rival_owner::text || '@example.org');
  insert into public.organizations(id, name, slug, created_by) values
    (v_organization, 'Grok context release organization',
      'gctx-' || pg_catalog.replace(v_organization::text, '-', ''), v_owner),
    (v_rival_organization, 'Grok context rival organization',
      'gctx-' || pg_catalog.replace(v_rival_organization::text, '-', ''), v_rival_owner);
  insert into public.organization_members(organization_id, user_id, role, created_by)
  values (v_organization, v_member, 'member', v_owner);
  insert into public.projects(
    id, organization_id, name, status, github_repository, default_branch,
    production_url, created_by
  ) values
    (v_project, v_organization, 'Grok Context Release Project', 'active',
      'example/grok-context-release', 'main', 'https://context.example.org', v_owner),
    (v_rival_project, v_rival_organization, 'Grok Context Rival Project', 'active',
      'example/grok-context-rival', 'main', 'https://rival.example.org', v_rival_owner);
  insert into public.connections(
    id, organization_id, name, provider, status, secret_reference, created_by
  ) values
    (v_connection, v_organization, 'Linked release GitHub', 'github', 'connected',
      'env://GROK_CONTEXT_RELEASE_GITHUB', v_owner),
    (v_unlinked_connection, v_organization, 'Unlinked release GitHub', 'github', 'connected',
      'env://GROK_CONTEXT_UNLINKED_GITHUB', v_owner);
  insert into public.project_connections(
    organization_id, project_id, connection_id, is_primary, created_by
  ) values (v_organization, v_project, v_connection, true, v_owner);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  select * into strict v_session from public.create_grok_session(
    v_organization, v_project, 'Grok context release session',
    'grok-context-release-session'
  );
  select * into strict v_message from public.append_grok_user_message(
    v_organization, v_session.id, 'Review the bounded release context.',
    pg_catalog.jsonb_build_object('schemaVersion', 1, 'kind', 'grok.user_prompt'),
    'grok-context-release-message', 0, null
  );

  v_reference_items := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'kind', 'project', 'label', 'Grok Context Release Project',
      'media_type', null, 'source_url', 'https://context.example.org',
      'repository_path', null, 'integration_id', null, 'content_text', null,
      'byte_size', 0, 'state', 'reference_only'
    ),
    pg_catalog.jsonb_build_object(
      'kind', 'repository', 'label', 'example/grok-context-release',
      'media_type', null, 'source_url', null, 'repository_path', 'main',
      'integration_id', null, 'content_text', null, 'byte_size', 0,
      'state', 'reference_only'
    )
  );
  v_items := v_reference_items || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'kind', 'file', 'label', 'acceptance.md', 'media_type', 'text/markdown',
      'source_url', null, 'repository_path', null, 'integration_id', null,
      'content_text', v_text, 'byte_size', pg_catalog.octet_length(v_text),
      'state', 'captured'
    ),
    pg_catalog.jsonb_build_object(
      'kind', 'url', 'label', 'Public reference', 'media_type', null,
      'source_url', 'https://docs.example.org/context', 'repository_path', null,
      'integration_id', null, 'content_text', null, 'byte_size', 0,
      'state', 'reference_only'
    ),
    pg_catalog.jsonb_build_object(
      'kind', 'integration', 'label', 'Linked GitHub', 'media_type', null,
      'source_url', null, 'repository_path', null, 'integration_id', v_connection,
      'content_text', null, 'byte_size', 0, 'state', 'reference_only'
    )
  );

  v_initial := public.record_grok_context_envelope_as_server(
    v_organization, v_owner, v_project, v_session.id, v_message.id,
    v_items, 'grok-context-release-envelope', 2, false
  );
  v_replay := public.record_grok_context_envelope_as_server(
    v_organization, v_owner, v_project, v_session.id, v_message.id,
    v_items, 'grok-context-release-envelope', 2, false
  );
  if v_initial ->> 'replayed' is distinct from 'false'
      or v_replay ->> 'replayed' is distinct from 'true'
      or v_initial #>> '{envelope,id}' is distinct from v_replay #>> '{envelope,id}'
      or v_initial #>> '{envelope,item_count}' is distinct from '5'
      or v_initial #>> '{envelope,total_bytes}' is distinct from
        pg_catalog.octet_length(v_text)::text
  then
    raise exception 'grok_context_postflight_initial_record_or_replay_mismatch';
  end if;

  select * into strict v_assistant from public.append_grok_message_as_server(
    v_organization, v_session.id, 'assistant', 'The immutable plan is recorded.',
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'kind', 'grok.plan', 'plan', pg_catalog.jsonb_build_object()
    ), 'grok-context-release-plan', 1, v_message.id
  );
  v_follow_up := public.append_grok_follow_up_context(
    v_organization, v_project, v_session.id, 'Use the bounded follow-up context.',
    v_reference_items, 'grok-context-release-follow-up', 2, 4, v_assistant.id
  );
  if v_follow_up ->> 'plan_changed' is distinct from 'false'
      or v_follow_up ->> 'replan_required' is distinct from 'true'
      or v_follow_up #>> '{message,sequence_no}' is distinct from '3'
      or v_follow_up #>> '{envelope,replan_required}' is distinct from 'true'
  then
    raise exception 'grok_context_postflight_follow_up_mismatch';
  end if;

  v_list := public.list_grok_context_envelopes(v_organization, v_session.id, 64);
  if pg_catalog.jsonb_array_length(v_list) <> 2
      or (select pg_catalog.count(*) from public.grok_context_envelopes envelope
           where envelope.organization_id = v_organization
             and envelope.project_id = v_project
             and envelope.session_id = v_session.id) <> 2
      or (select pg_catalog.count(*) from public.grok_context_items item
           where item.organization_id = v_organization
             and item.project_id = v_project
             and item.session_id = v_session.id) <> 7
      or (select pg_catalog.count(*) from public.grok_events event
           where event.organization_id = v_organization
             and event.session_id = v_session.id
             and event.event_type = 'context.recorded'
             and event.payload ->> 'workerWoken' = 'false'
             and event.payload ->> 'executionStarted' = 'false'
             and not event.payload ?| array['content', 'content_text', 'items']) <> 2
  then
    raise exception 'grok_context_postflight_projection_or_audit_mismatch';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_member::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', v_member::text, 'role', 'authenticated')::text,
    true
  );
  v_blocked := false;
  begin
    perform public.list_grok_context_envelopes(v_organization, v_session.id, 64);
  exception when sqlstate 'P0002' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_non_owner_read_was_not_blocked';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );

  v_blocked := false;
  begin
    perform public.record_grok_context_envelope_as_server(
      v_organization, v_owner, v_project, v_session.id, v_message.id,
      v_reference_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'file', 'label', 'secret.txt', 'media_type', 'text/plain',
        'source_url', null, 'repository_path', null, 'integration_id', null,
        'content_text', 'API_KEY=' || 'sk-' || pg_catalog.repeat('a', 24),
        'byte_size', 35,
        'state', 'captured'
      )), 'grok-context-release-secret', 6, false
    );
  exception when sqlstate '22023' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_secret_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.record_grok_context_envelope_as_server(
      v_organization, v_owner, v_project, v_session.id, v_message.id,
      v_reference_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'integration', 'label', 'Unlinked GitHub', 'media_type', null,
        'source_url', null, 'repository_path', null,
        'integration_id', v_unlinked_connection, 'content_text', null,
        'byte_size', 0, 'state', 'reference_only'
      )), 'grok-context-release-unlinked', 6, false
    );
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_unlinked_integration_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.record_grok_context_envelope_as_server(
      v_organization, v_owner, v_project, v_session.id, v_message.id,
      v_reference_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'url', 'label', 'Private URL', 'media_type', null,
        'source_url', 'http://127.0.0.1/private', 'repository_path', null,
        'integration_id', null, 'content_text', null, 'byte_size', 0,
        'state', 'reference_only'
      )), 'grok-context-release-private-url', 6, false
    );
  exception when sqlstate '22023' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_private_url_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.record_grok_context_envelope_as_server(
      v_organization, v_owner, v_project, v_session.id, v_message.id,
      v_reference_items || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '1', 'media_type', null, 'source_url', 'https://1.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '2', 'media_type', null, 'source_url', 'https://2.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '3', 'media_type', null, 'source_url', 'https://3.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '4', 'media_type', null, 'source_url', 'https://4.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '5', 'media_type', null, 'source_url', 'https://5.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '6', 'media_type', null, 'source_url', 'https://6.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '7', 'media_type', null, 'source_url', 'https://7.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '8', 'media_type', null, 'source_url', 'https://8.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '9', 'media_type', null, 'source_url', 'https://9.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '10', 'media_type', null, 'source_url', 'https://10.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only'),
        pg_catalog.jsonb_build_object('kind', 'url', 'label', '11', 'media_type', null, 'source_url', 'https://11.example.org', 'repository_path', null, 'integration_id', null, 'content_text', null, 'byte_size', 0, 'state', 'reference_only')
      ), 'grok-context-release-overbound', 6, false
    );
  exception when sqlstate '22023' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_item_bound_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.record_grok_context_envelope_as_server(
      v_organization, v_owner, v_project, v_session.id, v_message.id,
      pg_catalog.jsonb_set(v_items, '{2,label}', '"changed.md"'::jsonb),
      'grok-context-release-envelope', 6, false
    );
  exception when sqlstate '22023' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_changed_replay_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.record_grok_context_envelope_as_server(
      v_rival_organization, v_rival_owner, v_rival_project, v_session.id,
      v_message.id, v_reference_items, 'grok-context-release-rival', 0, false
    );
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_cross_tenant_write_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    update public.grok_context_envelopes
       set replan_required = true
     where id = (v_initial #>> '{envelope,id}')::uuid;
  exception when sqlstate '55000' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_update_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    delete from public.grok_context_items
     where envelope_id = (v_initial #>> '{envelope,id}')::uuid;
  exception when sqlstate '55000' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_delete_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    truncate table public.grok_context_items, public.grok_context_envelopes;
  exception when sqlstate '55000' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_context_postflight_truncate_was_not_blocked';
  end if;

  if exists (
        select 1
          from public.graph_runs graph_run
          join public.graphs graph
            on graph.id = graph_run.graph_id
           and graph.organization_id = graph_run.organization_id
         where graph.project_id = v_project
      )
      or exists (
        select 1 from public.node_runs node_run
        join public.graph_runs graph_run
          on graph_run.id = node_run.graph_run_id
         and graph_run.organization_id = node_run.organization_id
        join public.graphs graph
          on graph.id = graph_run.graph_id
         and graph.organization_id = graph_run.organization_id
       where graph.project_id = v_project
      )
      or exists (select 1 from public.agent_runs agent_run where agent_run.project_id = v_project)
      or exists (
        select 1
          from public.provider_run_events provider_event
          join public.agent_runs agent_run
            on agent_run.id = provider_event.agent_run_id
           and agent_run.organization_id = provider_event.organization_id
         where agent_run.project_id = v_project
      )
      or exists (select 1 from public.graph_phase1c_bridges bridge where bridge.project_id = v_project)
  then
    raise exception 'grok_context_postflight_execution_must_remain_zero';
  end if;
end;
$grok_context_runtime_postflight$;

select 'grok-context-release-postflight-ok';
rollback;
