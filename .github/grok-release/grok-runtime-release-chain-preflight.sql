\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'softwarefactory.grok_runtime_release.operation', :'operation', false
) as operation_setting \gset
select pg_catalog.set_config(
  'softwarefactory.grok_runtime_release.expected_next_version',
  :'expected_next_version', false
) as expected_next_setting \gset
select pg_catalog.set_config(
  'softwarefactory.grok_runtime_release.unrelated_ledger_sha256',
  :'unrelated_ledger_sha256', false
) as unrelated_ledger_setting \gset

do $grok_runtime_release_preflight$
declare
  v_operation text := pg_catalog.current_setting(
    'softwarefactory.grok_runtime_release.operation'
  );
  v_expected_next text := pg_catalog.current_setting(
    'softwarefactory.grok_runtime_release.expected_next_version'
  );
  v_unrelated_ledger_sha256 text;
  v_counts integer[];
  v_prefix text;
  v_next_version text;
  v_old_control oid;
  v_expected record;
  v_routine oid;
  v_service_execute boolean;
begin
  if v_operation not in ('probe', 'apply-one', 'verify') then
    raise exception 'grok_runtime_release_operation_invalid';
  end if;
  if pg_catalog.current_database() is distinct from 'postgres'
      or current_user is distinct from 'postgres'
      or pg_catalog.to_regnamespace('supabase_migrations') is null
  then
    raise exception 'grok_runtime_release_database_identity_mismatch';
  end if;

  if exists (
    select 1
      from (values
        ('20260831000100'), ('20260831000200'), ('20260831000300'),
        ('20260831000400'), ('20260831000500'), ('20260831000600'),
        ('20260831000700'), ('20260831000800'), ('20260831000900'),
        ('20260831001000'), ('20260831001100'), ('20260831001200'),
        ('20260831001300'), ('20260831001400'), ('20260831001500'),
        ('20260831001600'), ('20260831001700')
      ) expected(version)
     where (select pg_catalog.count(*)
              from supabase_migrations.schema_migrations migration
             where migration.version = expected.version) <> 1
  ) then
    raise exception 'grok_runtime_release_prerequisite_ledger_mismatch';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations migration
     where migration.version > '20260831002100'
  ) then
    raise exception 'grok_runtime_release_later_version_present';
  end if;

  select array[
    pg_catalog.count(*) filter (where version = '20260831001800')::integer,
    pg_catalog.count(*) filter (where version = '20260831001900')::integer,
    pg_catalog.count(*) filter (where version = '20260831002000')::integer,
    pg_catalog.count(*) filter (where version = '20260831002100')::integer
  ] into v_counts
    from supabase_migrations.schema_migrations;
  v_prefix := pg_catalog.array_to_string(v_counts, '');
  if v_prefix not in ('0000', '1000', '1100', '1110', '1111') then
    raise exception 'grok_runtime_release_ledger_is_not_one_exact_prefix: %', v_prefix;
  end if;
  v_next_version := case v_prefix
    when '0000' then '20260831001800'
    when '1000' then '20260831001900'
    when '1100' then '20260831002000'
    when '1110' then '20260831002100'
    when '1111' then 'complete'
  end;
  if v_operation = 'verify' and v_prefix <> '1111' then
    raise exception 'grok_runtime_release_verify_requires_complete_prefix: %', v_prefix;
  end if;
  if v_operation = 'apply-one' and v_next_version = 'complete' then
    raise exception 'grok_runtime_release_has_no_next_forward_migration';
  end if;
  if v_expected_next <> 'auto' and v_expected_next is distinct from v_next_version then
    raise exception 'grok_runtime_release_next_version_changed: expected %, found %',
      v_expected_next, v_next_version;
  end if;

  if 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and relation.relkind = 'r'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or pg_catalog.to_regprocedure(
    'public.assert_current_grok_execution_admissions(uuid)'
  ) is null then
    raise exception 'grok_runtime_release_prerequisite_catalog_mismatch';
  end if;

  for v_expected in
    select * from (values
      ('public.grok_initial_context_claim_projection(uuid)',
       '06c7fb24b7c4b50bbf80aee57385ff57', 1, 'jsonb', 'owner_only'),
      ('public.attach_current_grok_admissions_to_claim(jsonb)',
       'c1075dafaa5bc957d16ff2599382a811', 1, 'jsonb', 'owner_only'),
      ('public.attach_current_grok_admission_to_phase1c_claim(jsonb)',
       '2562fa378097239ce4a3e47e9121d410', 1, 'jsonb', 'owner_only'),
      ('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)',
       '4a6da8bed8d1fdda17f11df00d549817', 5, 'jsonb', 'service_role'),
      ('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
       'f83873aa19703d2c61553026d4141a4c', 6, 'jsonb', 'service_role'),
      ('public.claim_phase1c_run_v3(text,text,text,integer,integer)',
       'ef8803cb5ec809266b8fdf6f048b1a2f', 5, 'jsonb', 'service_role'),
      ('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)',
       '14c204c6c9d8da1ed6038d0f56942be8', 6, 'jsonb', 'service_role'),
      ('public.record_grok_specialist_roster_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)',
       '8c8276ef3a0d5bf27204a836788f736f', 7, 'jsonb', 'service_before_019'),
      ('public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
       '4e41c8e312bca5fb13773dd0c9fbf19f', 20, 'public.grok_graph_launches', 'service_before_019'),
      ('public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
       'e028c29915d50f0eb7773affa146fae7', 16, 'public.grok_graph_launches', 'service_before_019')
    ) expected(signature, source_md5, argument_count, return_type, execute_posture)
  loop
    v_service_execute := case v_expected.execute_posture
      when 'service_role' then true
      when 'service_before_019' then v_prefix in ('0000', '1000')
      else false
    end;
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
         and routine.prorettype = v_expected.return_type::pg_catalog.regtype
         and routine.pronargs = v_expected.argument_count
         and routine.pronargdefaults = 0
         and not routine.proleakproof
         and not routine.proisstrict
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
           = v_service_execute
         and routine.proacl is not null
         and not exists (
           select 1 from pg_catalog.aclexplode(routine.proacl) privilege
            where privilege.privilege_type <> 'EXECUTE'
               or privilege.grantor <> routine.proowner
               or (
                 privilege.grantee <> routine.proowner
                 and privilege.grantee is distinct from case
                   when v_service_execute then (
                     select role.oid from pg_catalog.pg_roles role
                      where role.rolname = 'service_role'
                   ) else null end
               )
         )
         and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)
               where privilege_type = 'EXECUTE')
             = case when v_service_execute then 2 else 1 end
    ) then
      raise exception 'grok_runtime_release_prerequisite_function_mismatch: %',
        v_expected.signature;
    end if;
  end loop;

  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(migration)
             order by migration.version), '[]'::jsonb)::text,
           'UTF8'
         )), 'hex')
    into v_unrelated_ledger_sha256
    from supabase_migrations.schema_migrations migration
   where migration.version not in (
     '20260831001800', '20260831001900',
     '20260831002000', '20260831002100'
   );
  if v_unrelated_ledger_sha256 is distinct from pg_catalog.current_setting(
    'softwarefactory.grok_runtime_release.unrelated_ledger_sha256'
  ) then
    raise exception 'grok_runtime_release_unrelated_ledger_changed';
  end if;

  if v_counts[1] = 0 and pg_catalog.to_regprocedure(
    'public.launch_grok_deploy_readiness_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
  ) is not null then
    raise exception 'grok_runtime_release_018_catalog_exists_without_ledger';
  end if;
  if v_counts[2] = 0 and (
    pg_catalog.to_regprocedure(
      'public.record_grok_specialist_roster_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.launch_grok_full_lifecycle_v4_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
    ) is not null
  ) then
    raise exception 'grok_runtime_release_019_catalog_exists_without_ledger';
  end if;
  if v_counts[3] = 0 and (
    pg_catalog.to_regprocedure(
      'public.resolve_graph_execution_target_as_worker(uuid,integer)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.launch_grok_read_only_research_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
    ) is not null
  ) then
    raise exception 'grok_runtime_release_020_catalog_exists_without_ledger';
  end if;
  if v_counts[4] = 0 then
    if pg_catalog.to_regclass('public.grok_graph_wake_intents') is not null
        or pg_catalog.to_regclass('public.grok_graph_wake_dispatch_attempts') is not null
        or pg_catalog.to_regclass('public.grok_graph_wake_receipts') is not null
        or pg_catalog.to_regprocedure(
          'public.assert_current_grok_graph_wake_intent(public.grok_graph_wake_intents)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.apply_grok_graph_control_v3_as_owner(uuid,uuid,uuid,text,text,text)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.record_grok_graph_wake_dispatch_as_server(uuid,uuid,bigint,text,text,text)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.assert_no_grok_graph_wake_payload_required_as_worker(text,uuid,uuid,integer,integer)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.acknowledge_grok_graph_wake_as_worker(text,uuid,bigint,uuid,uuid,integer,integer)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.read_grok_graph_wake_state_as_owner(uuid,uuid,uuid)'
        ) is not null
    then
      raise exception 'grok_runtime_release_021_catalog_exists_without_ledger';
    end if;
    v_old_control := pg_catalog.to_regprocedure(
      'public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)'
    );
    if v_old_control is null or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = v_old_control
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = '33742a47dbacb81f9d18d5381b78287d'
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
    ) then
      raise exception 'grok_runtime_release_021_predecessor_control_mismatch';
    end if;
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
        or worker.current_run_id is not null
  ) or exists (
    select 1 from public.graph_runs run
     where run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs run
     where run.status = 'running'::public.run_status
  ) or exists (
    select 1 from public.grok_phase1c_submission_guards
  ) then
    raise exception 'grok_runtime_release_safety_state_not_stopped';
  end if;
end;
$grok_runtime_release_preflight$;

with counts as (
  select
    pg_catalog.count(*) filter (where version = '20260831001800')::integer c018,
    pg_catalog.count(*) filter (where version = '20260831001900')::integer c019,
    pg_catalog.count(*) filter (where version = '20260831002000')::integer c020,
    pg_catalog.count(*) filter (where version = '20260831002100')::integer c021
    from supabase_migrations.schema_migrations
), state as (
  select (c018::text || c019::text || c020::text || c021::text) prefix
    from counts
)
select 'grok-runtime-release-chain-preflight-ok|' || prefix || '|' || case prefix
  when '0000' then '20260831001800'
  when '1000' then '20260831001900'
  when '1100' then '20260831002000'
  when '1110' then '20260831002100'
  when '1111' then 'complete'
end
from state;
