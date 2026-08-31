\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'softwarefactory.grok_admission_fence_release.operation', :'operation', false
) as operation_setting \gset
select pg_catalog.set_config(
  'softwarefactory.grok_admission_fence_release.unrelated_ledger_sha256',
  :'unrelated_ledger_sha256', false
) as unrelated_ledger_setting \gset

do $grok_admission_fence_release_preflight$
declare
  v_operation text := pg_catalog.current_setting(
    'softwarefactory.grok_admission_fence_release.operation'
  );
  v_ledger_count integer;
  v_unrelated_ledger_sha256 text;
  v_expected record;
  v_routine oid;
begin
  if v_operation not in ('probe', 'apply', 'verify') then
    raise exception 'grok_admission_fence_release_operation_invalid';
  end if;
  if pg_catalog.current_database() is distinct from 'postgres'
      or current_user is distinct from 'postgres'
      or pg_catalog.to_regnamespace('supabase_migrations') is null
  then
    raise exception 'grok_admission_fence_release_database_identity_mismatch';
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
  )
      or 2 is distinct from (
        select pg_catalog.count(*)::integer
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname in ('grok_context_envelopes', 'grok_context_items')
           and relation.relkind = 'r'
           and relation.relrowsecurity
           and relation.relforcerowsecurity
      )
      or pg_catalog.to_regprocedure(
        'public.record_grok_specialist_roster_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.assert_current_grok_execution_admissions(uuid)'
      ) is null
  then
    raise exception 'grok_admission_fence_release_prerequisite_ledger_or_catalog_mismatch';
  end if;

  for v_expected in
    select * from (values
      ('public.record_grok_specialist_roster_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)',
       '8c8276ef3a0d5bf27204a836788f736f', 7, 'jsonb'),
      ('public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
       '4e41c8e312bca5fb13773dd0c9fbf19f', 20, 'public.grok_graph_launches'),
      ('public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
       'e028c29915d50f0eb7773affa146fae7', 16, 'public.grok_graph_launches')
    ) expected(signature, source_md5, argument_count, return_type)
  loop
    v_routine := pg_catalog.to_regprocedure(v_expected.signature);
    if v_routine is null or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = v_routine
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and routine.provolatile = 'v'
         and routine.proparallel = 'u'
         and routine.prokind = 'f'
         and not routine.proleakproof
         and not routine.proisstrict
         and routine.pronargs = v_expected.argument_count
         and routine.pronargdefaults = 0
         and routine.prorettype = v_expected.return_type::pg_catalog.regtype
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
           = (v_operation in ('probe', 'apply'))
         and not exists (
           select 1 from pg_catalog.aclexplode(routine.proacl) acl
            where acl.privilege_type <> 'EXECUTE'
               or acl.grantor <> routine.proowner
               or (
                 acl.grantee <> routine.proowner
                 and (
                   v_operation = 'verify'
                   or acl.grantee <> (
                     select role.oid from pg_catalog.pg_roles role
                      where role.rolname = 'service_role'
                   )
                 )
               )
         )
         and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl) acl
               where acl.privilege_type = 'EXECUTE')
             = case when v_operation in ('probe', 'apply') then 2 else 1 end
    ) then
      raise exception 'grok_admission_fence_release_prerequisite_function_mismatch: %', v_expected.signature;
    end if;
  end loop;

  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(migration)
             order by migration.version), '[]'::jsonb)::text,
           'UTF8'
         )), 'hex')
    into v_unrelated_ledger_sha256
    from supabase_migrations.schema_migrations migration
   where migration.version <> '20260831001900';
  if v_unrelated_ledger_sha256 is distinct from pg_catalog.current_setting(
    'softwarefactory.grok_admission_fence_release.unrelated_ledger_sha256'
  ) then
    raise exception 'grok_admission_fence_release_unrelated_ledger_changed';
  end if;

  select pg_catalog.count(*)::integer
    into v_ledger_count
    from supabase_migrations.schema_migrations
   where version = '20260831001900';
  if v_operation in ('probe', 'apply') then
    if v_ledger_count <> 0 or exists (
      select 1
        from (values
          ('public.record_grok_specialist_roster_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)'),
          ('public.launch_grok_full_lifecycle_v4_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'),
          ('public.launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)')
        ) candidate(signature)
       where pg_catalog.to_regprocedure(candidate.signature) is not null
    ) or exists (
      select 1 from supabase_migrations.schema_migrations migration
       where migration.version > '20260831001900'
    ) then
      raise exception 'grok_admission_fence_release_absent_ledger_or_catalog_mismatch';
    end if;
  elsif v_ledger_count <> 1 then
    raise exception 'grok_admission_fence_release_verify_ledger_or_function_mismatch';
  end if;

  if v_operation = 'verify' then
    for v_expected in
      select * from (values
        ('public.record_grok_specialist_roster_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)',
         'f9b3b947feccfe16eec03916cb3330fb', 7, 'jsonb'),
        ('public.launch_grok_full_lifecycle_v4_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
         '1f4e57b243466f21a67215712307eb76', 20, 'public.grok_graph_launches'),
        ('public.launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
         '2cb5d0d85ecff30add9c7e21711bf434', 16, 'public.grok_graph_launches')
      ) expected(signature, source_md5, argument_count, return_type)
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
           and not routine.proleakproof
           and not routine.proisstrict
           and routine.pronargs = v_expected.argument_count
           and routine.pronargdefaults = 0
           and routine.prorettype = v_expected.return_type::pg_catalog.regtype
           and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
             routine.prosrc, E'\r\n', E'\n'
           ), E'\r', E'\n')) = v_expected.source_md5
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
        raise exception 'grok_admission_fence_release_verify_function_mismatch: %',
          v_expected.signature;
      end if;
    end loop;
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
    select 1 from public.graph_runs graph_run
     where graph_run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs agent_run
     where agent_run.status = 'running'::public.run_status
  ) or exists (
    select 1 from public.grok_phase1c_submission_guards
  ) then
    raise exception 'grok_admission_fence_release_safety_state_not_stopped';
  end if;
end;
$grok_admission_fence_release_preflight$;

select 'grok-admission-version-null-fence-release-preflight-ok';
