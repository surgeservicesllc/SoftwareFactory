\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'softwarefactory.grok_runtime_release.installed_through',
  :'installed_through', false
) as installed_through_setting \gset

do $grok_runtime_release_catalog_postflight$
declare
  v_installed_through text := pg_catalog.current_setting(
    'softwarefactory.grok_runtime_release.installed_through'
  );
  v_expected record;
  v_routine oid;
  v_execute_role text;
  v_execute_role_oid oid;
begin
  if v_installed_through not in (
    '20260831001800', '20260831001900',
    '20260831002000', '20260831002100'
  ) then
    raise exception 'grok_runtime_release_postflight_version_invalid';
  end if;
  if exists (
    select 1
      from (values
        ('20260831001800', '20260831001800'),
        ('20260831001900', '20260831001900'),
        ('20260831002000', '20260831002000'),
        ('20260831002100', '20260831002100')
      ) expected(version, introduced_at)
     where (select pg_catalog.count(*)
              from supabase_migrations.schema_migrations migration
             where migration.version = expected.version)
           <> case when expected.introduced_at <= v_installed_through then 1 else 0 end
  ) then
    raise exception 'grok_runtime_release_postflight_ledger_prefix_mismatch';
  end if;

  for v_expected in
    select * from (values
      ('public.grok_initial_context_claim_projection(uuid)',
       '06c7fb24b7c4b50bbf80aee57385ff57', '20260831001700', 1, 'jsonb', 'v', 'owner_only'),
      ('public.attach_current_grok_admissions_to_claim(jsonb)',
       'c1075dafaa5bc957d16ff2599382a811', '20260831001700', 1, 'jsonb', 'v', 'owner_only'),
      ('public.attach_current_grok_admission_to_phase1c_claim(jsonb)',
       '2562fa378097239ce4a3e47e9121d410', '20260831001700', 1, 'jsonb', 'v', 'owner_only'),
      ('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)',
       '4a6da8bed8d1fdda17f11df00d549817', '20260831001700', 5, 'jsonb', 'v', 'service_role'),
      ('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
       'f83873aa19703d2c61553026d4141a4c', '20260831001700', 6, 'jsonb', 'v', 'service_role'),
      ('public.claim_phase1c_run_v3(text,text,text,integer,integer)',
       'ef8803cb5ec809266b8fdf6f048b1a2f', '20260831001700', 5, 'jsonb', 'v', 'service_role'),
      ('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)',
       '14c204c6c9d8da1ed6038d0f56942be8', '20260831001700', 6, 'jsonb', 'v', 'service_role'),
      ('public.record_grok_specialist_roster_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)',
       '8c8276ef3a0d5bf27204a836788f736f', '20260831001700', 7, 'jsonb', 'v', 'service_before_019'),
      ('public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
       '4e41c8e312bca5fb13773dd0c9fbf19f', '20260831001700', 20, 'public.grok_graph_launches', 'v', 'service_before_019'),
      ('public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
       'e028c29915d50f0eb7773affa146fae7', '20260831001700', 16, 'public.grok_graph_launches', 'v', 'service_before_019'),
      ('public.launch_grok_deploy_readiness_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
       'e8c53d578a6c03a45239d1df531dafb1', '20260831001800', 16, 'public.grok_graph_launches', 'v', 'service_role'),
      ('public.record_grok_specialist_roster_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)',
       'f9b3b947feccfe16eec03916cb3330fb', '20260831001900', 7, 'jsonb', 'v', 'service_role'),
      ('public.launch_grok_full_lifecycle_v4_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
       '1f4e57b243466f21a67215712307eb76', '20260831001900', 20, 'public.grok_graph_launches', 'v', 'service_role'),
      ('public.launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
       '2cb5d0d85ecff30add9c7e21711bf434', '20260831001900', 16, 'public.grok_graph_launches', 'v', 'service_role'),
      ('public.resolve_graph_execution_target_as_worker(uuid,integer)',
       '07d1b171531f172882601ff3748c5830', '20260831002000', 2, 'jsonb', 's', 'service_role'),
      ('public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)',
       'e7747781fc873442b2d8204d7aac9366', '20260831002000', 4, 'jsonb', 'v', 'service_role'),
      ('public.launch_grok_read_only_research_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
       'ae7f04c8179e76599857905ac8ffb310', '20260831002000', 20, 'public.grok_graph_launches', 'v', 'service_role'),
      ('public.assert_current_grok_graph_wake_intent(public.grok_graph_wake_intents)',
       '77a19916949510d970da271d54fd051a', '20260831002100', 1, 'boolean', 'v', 'owner_only'),
      ('public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)',
       'ef92138092840861e8396b16f163462e', '20260831002100', 6, 'record', 'v', 'authenticated'),
      ('public.apply_grok_graph_control_v3_as_owner(uuid,uuid,uuid,text,text,text)',
       '1bf01dddd4f0cc34d424ca140e317060', '20260831002100', 6, 'record', 'v', 'authenticated'),
      ('public.record_grok_graph_wake_dispatch_as_server(uuid,uuid,bigint,text,text,text)',
       '99cb0a44a597c7837cf1545422564554', '20260831002100', 6, 'public.grok_graph_wake_dispatch_attempts', 'v', 'service_role'),
      ('public.assert_no_grok_graph_wake_payload_required_as_worker(text,uuid,uuid,integer,integer)',
       '4dff24999b2dc60901164b4ae3c9121b', '20260831002100', 5, 'boolean', 'v', 'service_role'),
      ('public.acknowledge_grok_graph_wake_as_worker(text,uuid,bigint,uuid,uuid,integer,integer)',
       'c0d97d5427c3ba6e6f214f9a7e43352b', '20260831002100', 7, 'public.grok_graph_wake_receipts', 'v', 'service_role'),
      ('public.read_grok_graph_wake_state_as_owner(uuid,uuid,uuid)',
       '3d9e625a675c88fd56e218b588b3f6a5', '20260831002100', 3, 'record', 'v', 'authenticated')
    ) expected(
      signature, source_md5, introduced_at, argument_count,
      return_type, volatility, execute_posture
    )
  loop
    if v_expected.introduced_at > v_installed_through then
      continue;
    end if;
    v_execute_role := case v_expected.execute_posture
      when 'service_before_019' then
        case when v_installed_through < '20260831001900' then 'service_role' else null end
      when 'owner_only' then null
      else v_expected.execute_posture
    end;
    v_execute_role_oid := case when v_execute_role is null then null else (
      select role.oid from pg_catalog.pg_roles role where role.rolname = v_execute_role
    ) end;
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
         and routine.provolatile = v_expected.volatility
         and routine.proparallel = 'u'
         and routine.prokind = 'f'
         and routine.prorettype = v_expected.return_type::pg_catalog.regtype
         and routine.pronargs = v_expected.argument_count
         and routine.pronargdefaults = 0
         and not routine.proleakproof
         and not routine.proisstrict
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and routine.proacl is not null
         and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
           = coalesce(v_execute_role = 'authenticated', false)
         and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
           = coalesce(v_execute_role = 'service_role', false)
         and not exists (
           select 1 from pg_catalog.aclexplode(routine.proacl) privilege
            where privilege.privilege_type <> 'EXECUTE'
               or privilege.grantor <> routine.proowner
               or (
                 privilege.grantee <> routine.proowner
                 and privilege.grantee is distinct from v_execute_role_oid
               )
         )
         and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)
               where privilege_type = 'EXECUTE')
             = case when v_execute_role is null then 1 else 2 end
    ) then
      raise exception 'grok_runtime_release_function_identity_or_acl_mismatch: %',
        v_expected.signature;
    end if;
  end loop;

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
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(coalesce(
        relation.relacl, pg_catalog.acldefault('r', relation.relowner)
      )) privilege
     where namespace.nspname = 'public'
       and relation.relname in (
          'grok_graph_launches', 'grok_execution_admissions',
          'grok_task_links', 'grok_events', 'grok_specialist_admissions'
        )
       and (
         privilege.grantor <> relation.relowner
         or privilege.grantee <> relation.relowner
       )
  ) then
    raise exception 'grok_runtime_release_evidence_rls_or_acl_mismatch';
  end if;
end;
$grok_runtime_release_catalog_postflight$;

do $grok_runtime_release_wake_postflight$
declare
  v_installed_through text := pg_catalog.current_setting(
    'softwarefactory.grok_runtime_release.installed_through'
  );
begin
  if v_installed_through < '20260831002100' then
    return;
  end if;
  if 3 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in (
         'grok_graph_wake_intents', 'grok_graph_wake_dispatch_attempts',
         'grok_graph_wake_receipts'
       )
       and relation.relkind = 'r'
       and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or exists (
    select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(coalesce(
        relation.relacl, pg_catalog.acldefault('r', relation.relowner)
      )) privilege
     where namespace.nspname = 'public'
       and relation.relname in (
         'grok_graph_wake_intents', 'grok_graph_wake_dispatch_attempts',
         'grok_graph_wake_receipts'
       )
       and privilege.grantee <> relation.relowner
  ) then
    raise exception 'grok_runtime_release_wake_table_rls_or_acl_mismatch';
  end if;
  if 3 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in (
         'grok_graph_wake_intents', 'grok_graph_wake_dispatch_attempts',
         'grok_graph_wake_receipts'
       )
       and policy.polname = relation.relname || '_select_member'
       and policy.polcmd = 'r'
       and policy.polpermissive
       and policy.polroles = array[(
         select role.oid from pg_catalog.pg_roles role
          where role.rolname = 'authenticated'
       )]::oid[]
       and pg_catalog.replace(
         pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), ' ', ''
       ) in (
         'is_organization_member(organization_id)',
         'public.is_organization_member(organization_id)'
       )
       and policy.polwithcheck is null
  ) or 3 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in (
         'grok_graph_wake_intents', 'grok_graph_wake_dispatch_attempts',
         'grok_graph_wake_receipts'
       )
  ) then
    raise exception 'grok_runtime_release_wake_policy_mismatch';
  end if;
  if exists (
    select 1
      from (values
        ('grok_graph_wake_intents_scope_unique', 'grok_graph_wake_intents', 'u'),
        ('grok_graph_wake_intents_control_unique', 'grok_graph_wake_intents', 'u'),
        ('grok_graph_wake_intents_revision_unique', 'grok_graph_wake_intents', 'u'),
        ('grok_graph_wake_intents_consecutive_revision', 'grok_graph_wake_intents', 'c'),
        ('grok_graph_wake_intents_session_fk', 'grok_graph_wake_intents', 'f'),
        ('grok_graph_wake_intents_graph_fk', 'grok_graph_wake_intents', 'f'),
        ('grok_graph_wake_intents_control_fk', 'grok_graph_wake_intents', 'f'),
        ('grok_graph_wake_dispatch_scope_unique', 'grok_graph_wake_dispatch_attempts', 'u'),
        ('grok_graph_wake_dispatch_attempt_unique', 'grok_graph_wake_dispatch_attempts', 'u'),
        ('grok_graph_wake_dispatch_idempotency_unique', 'grok_graph_wake_dispatch_attempts', 'u'),
        ('grok_graph_wake_dispatch_outcome_shape', 'grok_graph_wake_dispatch_attempts', 'c'),
        ('grok_graph_wake_dispatch_intent_fk', 'grok_graph_wake_dispatch_attempts', 'f'),
        ('grok_graph_wake_receipts_scope_unique', 'grok_graph_wake_receipts', 'u'),
        ('grok_graph_wake_receipts_intent_unique', 'grok_graph_wake_receipts', 'u'),
        ('grok_graph_wake_receipts_run_unique', 'grok_graph_wake_receipts', 'u'),
        ('grok_graph_wake_receipts_intent_fk', 'grok_graph_wake_receipts', 'f'),
        ('grok_graph_wake_receipts_run_fk', 'grok_graph_wake_receipts', 'f')
      ) expected(name, table_name, constraint_type)
     where not exists (
       select 1
         from pg_catalog.pg_constraint constraint_row
         join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
         join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = expected.table_name
          and constraint_row.conname = expected.name
          and constraint_row.contype = expected.constraint_type
          and constraint_row.convalidated
     )
  ) then
    raise exception 'grok_runtime_release_wake_constraint_mismatch';
  end if;
  if exists (
    select 1
      from (values
        ('grok_graph_wake_intents_graph_revision_idx', 'grok_graph_wake_intents', 3),
        ('grok_graph_wake_dispatch_intent_idx', 'grok_graph_wake_dispatch_attempts', 2),
        ('grok_graph_wake_receipts_session_idx', 'grok_graph_wake_receipts', 3)
      ) expected(name, table_name, key_count)
     where not exists (
       select 1
         from pg_catalog.pg_class index_relation
         join pg_catalog.pg_namespace namespace on namespace.oid = index_relation.relnamespace
         join pg_catalog.pg_index index_row on index_row.indexrelid = index_relation.oid
         join pg_catalog.pg_class table_relation on table_relation.oid = index_row.indrelid
        where namespace.nspname = 'public'
          and index_relation.relname = expected.name
          and table_relation.relname = expected.table_name
          and index_row.indisvalid
          and index_row.indisready
          and not index_row.indisunique
          and not index_row.indisprimary
          and index_row.indpred is null
          and index_row.indexprs is null
          and index_row.indnkeyatts = expected.key_count
          and index_row.indnatts = expected.key_count
     )
  ) then
    raise exception 'grok_runtime_release_wake_index_mismatch';
  end if;
  if 6 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in (
         'grok_graph_wake_intents', 'grok_graph_wake_dispatch_attempts',
         'grok_graph_wake_receipts'
       )
       and not trigger_row.tgisinternal
  ) or exists (
    select 1
      from (values ('_immutable', 27), ('_no_truncate', 34)) expected(suffix, trigger_type)
      cross join (values
        ('grok_graph_wake_intents'),
        ('grok_graph_wake_dispatch_attempts'),
        ('grok_graph_wake_receipts')
      ) expected_table(table_name)
     where not exists (
       select 1
         from pg_catalog.pg_trigger trigger_row
         join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
         join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = expected_table.table_name
          and trigger_row.tgname = expected_table.table_name || expected.suffix
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = expected.trigger_type
          and trigger_row.tgnargs = 0
          and trigger_row.tgqual is null
          and trigger_row.tgconstraint = 0
          and trigger_row.tgfoid =
            'public.reject_grok_evidence_mutation()'::regprocedure
     )
  ) then
    raise exception 'grok_runtime_release_wake_immutable_trigger_mismatch';
  end if;
end;
$grok_runtime_release_wake_postflight$;

do $grok_runtime_release_runtime_postflight$
declare
  v_installed_through text := pg_catalog.current_setting(
    'softwarefactory.grok_runtime_release.installed_through'
  );
  v_before jsonb;
  v_after jsonb;
  v_blocked boolean;
begin
  select pg_catalog.jsonb_build_object(
    'events', (select pg_catalog.count(*) from public.grok_events),
    'graphs', (select pg_catalog.count(*) from public.graphs),
    'graphRuns', (select pg_catalog.count(*) from public.graph_runs),
    'agentRuns', (select pg_catalog.count(*) from public.agent_runs),
    'launches', (select pg_catalog.count(*) from public.grok_graph_launches),
    'rosters', (select pg_catalog.count(*) from public.grok_specialist_admissions),
    'admissions', (select pg_catalog.count(*) from public.grok_execution_admissions),
    'submissionGuards', (select pg_catalog.count(*) from public.grok_phase1c_submission_guards)
  ) into v_before;

  v_blocked := false;
  begin
    perform public.launch_grok_deploy_readiness_v1_as_server(
      null::uuid, null::uuid, null::uuid, null::uuid, null::uuid,
      null::text, null::text, null::public.graph_topology, null::jsonb,
      null::public.risk_level, null::boolean, null::jsonb, null::jsonb,
      null::jsonb, null::text, null::jsonb
    );
  exception when sqlstate '22023' then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_runtime_release_018_invalid_input_was_not_blocked';
  end if;

  if v_installed_through >= '20260831002000' then
    v_blocked := false;
    begin
      perform public.resolve_graph_execution_target_as_worker(null::uuid, 1);
    exception when sqlstate '22023' then v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'grok_runtime_release_020_null_target_was_not_blocked';
    end if;
    v_blocked := false;
    begin
      perform public.claim_planned_graph_by_target_v4(
        'release-chain-check', array['MODEL']::text[], '{}'::jsonb, 4
      );
    exception when sqlstate '22023' then v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'grok_runtime_release_020_partial_target_was_not_blocked';
    end if;
    v_blocked := false;
    begin
      perform public.launch_grok_read_only_research_v3_as_server(
        null::uuid, null::uuid, null::uuid, null::uuid, null::uuid,
        null::text, null::text, null::public.graph_topology, null::jsonb,
        null::public.risk_level, null::boolean, null::jsonb, null::jsonb,
        null::jsonb, null::uuid, null::text, null::text, null::jsonb,
        null::text, null::jsonb
      );
    exception when sqlstate '22023' then v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'grok_runtime_release_020_invalid_launch_was_not_blocked';
    end if;
  end if;

  if v_installed_through >= '20260831002100' then
    v_before := v_before || pg_catalog.jsonb_build_object(
      'wakeIntents', (select pg_catalog.count(*) from public.grok_graph_wake_intents),
      'dispatchAttempts', (select pg_catalog.count(*) from public.grok_graph_wake_dispatch_attempts),
      'wakeReceipts', (select pg_catalog.count(*) from public.grok_graph_wake_receipts)
    );
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    v_blocked := false;
    begin
      perform public.apply_grok_graph_control_v3_as_owner(
        null::uuid, null::uuid, null::uuid, 'resume', 'release check',
        'runtime-release-check'
      );
    exception when sqlstate '42501' then v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'grok_runtime_release_021_unauthorized_resume_was_not_blocked';
    end if;
    v_blocked := false;
    begin
      perform public.record_grok_graph_wake_dispatch_as_server(
        null::uuid, null::uuid, null::bigint, null::text, null::text, null::text
      );
    exception when sqlstate '22023' then v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'grok_runtime_release_021_invalid_dispatch_was_not_blocked';
    end if;
    v_blocked := false;
    begin
      perform public.read_grok_graph_wake_state_as_owner(
        null::uuid, null::uuid, null::uuid
      );
    exception when sqlstate '42501' then v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'grok_runtime_release_021_unauthorized_read_was_not_blocked';
    end if;
  end if;

  select pg_catalog.jsonb_build_object(
    'events', (select pg_catalog.count(*) from public.grok_events),
    'graphs', (select pg_catalog.count(*) from public.graphs),
    'graphRuns', (select pg_catalog.count(*) from public.graph_runs),
    'agentRuns', (select pg_catalog.count(*) from public.agent_runs),
    'launches', (select pg_catalog.count(*) from public.grok_graph_launches),
    'rosters', (select pg_catalog.count(*) from public.grok_specialist_admissions),
    'admissions', (select pg_catalog.count(*) from public.grok_execution_admissions),
    'submissionGuards', (select pg_catalog.count(*) from public.grok_phase1c_submission_guards)
  ) into v_after;
  if v_installed_through >= '20260831002100' then
    v_after := v_after || pg_catalog.jsonb_build_object(
      'wakeIntents', (select pg_catalog.count(*) from public.grok_graph_wake_intents),
      'dispatchAttempts', (select pg_catalog.count(*) from public.grok_graph_wake_dispatch_attempts),
      'wakeReceipts', (select pg_catalog.count(*) from public.grok_graph_wake_receipts)
    );
  end if;
  if v_after is distinct from v_before then
    raise exception 'grok_runtime_release_runtime_probe_left_residue';
  end if;
end;
$grok_runtime_release_runtime_postflight$;

select 'grok-runtime-release-chain-postflight-ok';
