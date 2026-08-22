-- Normalize the seven legacy bot RPCs before the bot-account-binding EXPAND.
--
-- Some Supabase projects grant service_role EXECUTE through ALTER DEFAULT
-- PRIVILEGES. The original migrations deliberately removed PUBLIC and anon but
-- did not name service_role, so those projects can carry one extra direct ACL
-- entry even though the function definitions are otherwise exact. This
-- forward-only migration accepts only that one known difference and removes
-- only that grant. It changes no function body, signature, owner, setting,
-- table, row, policy, trigger, or default-privilege configuration.

do $normalize_legacy_bot_function_acls$
declare
  v_bad text;
  v_service_direct_count integer;
  v_service_effective_count integer;
begin
  -- Keep name and type rendering deterministic. pg_get_functiondef is not
  -- hashed because its deparser output is not stable across PostgreSQL majors;
  -- prosrc plus every explicit contract field below is the portable identity.
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  if pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception using errcode = '55000',
      message = 'legacy bot function ACL normalization roles are not exact';
  end if;

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.register_bot(uuid,text,public.bot_provider,text,text,text,text)',
     '87f577c2ecba24836e54b4ad5e7f383a', 'public.bots', true, 7, 3,
     'p_organization_id,p_name,p_provider,p_model,p_credential_ref,p_base_url,p_notes',
     '', null::oid[], 'NULL::text, NULL::text, NULL::text'),
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '9e5dea25195823492e3326ed96fa0535', 'public.bot_assignments', true, 4, 0,
     'p_organization_id,p_bot_id,p_project_id,p_role_id',
     '', null::oid[], null),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '742fea5b0e8655f19399f2a3944ce2c9', 'public.bot_assignments', true, 3, 0,
     'p_organization_id,p_project_id,p_assignments',
     '', null::oid[], null),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     '81788757faa428efebfc8a8ee7f9b6e6', 'public.bots', true, 4, 1,
     'p_organization_id,p_bot_id,p_readiness,p_detail',
     '', null::oid[], 'NULL::text'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     'cd33f17d969464665066854ff7692a1c', 'pg_catalog.record', true, 4, 2,
     'p_organization_id,p_assignment_id,p_model,p_work_effort,assignment_id,model,work_effort',
     'i,i,i,i,t,t,t', array[
       pg_catalog.to_regtype('pg_catalog.uuid')::oid,
       pg_catalog.to_regtype('pg_catalog.uuid')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid,
       pg_catalog.to_regtype('pg_catalog.uuid')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid
     ]::oid[], 'NULL::text, NULL::text'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '3637e0869520ee9eae89efd426b0b5c5', 'public.bot_assignments', true, 3, 0,
     'p_organization_id,p_assignment_id,p_status',
     '', null::oid[], null),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     'b39a3820c504f9dda9e84f73e1e4f065', 'public.bot_assignments', true, 5, 2,
     'p_organization_id,p_assignment_id,p_configuration,p_role_id,p_status',
     '', null::oid[], 'NULL::uuid, NULL::public.bot_assignment_status')
  ) expected(
    signature, source_md5, result_type, returns_set, argument_count,
    default_count, argument_names, argument_modes, all_argument_types,
    argument_defaults
  )
  left join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  left join pg_catalog.pg_language routine_language
    on routine_language.oid = routine.prolang
  where routine.oid is null
     or routine_schema.nspname is distinct from 'public'
     or routine_language.lanname is distinct from 'plpgsql'
     or routine.prokind is distinct from 'f'
     or routine.provolatile is distinct from 'v'
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or pg_catalog.md5(routine.prosrc) is distinct from expected.source_md5
     or routine.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or routine.proretset is distinct from expected.returns_set
     or routine.pronargs is distinct from expected.argument_count
     or routine.pronargdefaults is distinct from expected.default_count
     or pg_catalog.array_to_string(routine.proargnames, ',')
          is distinct from expected.argument_names
     or coalesce(pg_catalog.array_to_string(routine.proargmodes, ','), '')
          is distinct from expected.argument_modes
     or routine.proallargtypes is distinct from expected.all_argument_types
     or pg_catalog.pg_get_expr(routine.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or routine.proisstrict is distinct from false
     or routine.proleakproof is distinct from false
     or routine.proparallel is distinct from 'u'
     or routine.provariadic is distinct from 0::oid
     or routine.procost is distinct from 100::real
     or routine.prorows is distinct from 1000::real
     or routine.prosupport is distinct from 0::pg_catalog.regproc
     or routine.probin is not null
     or routine.prosqlbody is not null
     or routine.protrftypes is not null
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl))
          not in (2, 3)
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = pg_catalog.to_regrole('authenticated')::oid
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor <> routine.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            routine.proowner,
            pg_catalog.to_regrole('authenticated')::oid,
            pg_catalog.to_regrole('service_role')::oid
          )
     )
     or (
       (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) = 3
       and not exists (
         select 1
         from pg_catalog.aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner
           and acl.grantee = pg_catalog.to_regrole('service_role')::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     )
     or (
       (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) = 2
       and exists (
         select 1
         from pg_catalog.aclexplode(routine.proacl) acl
         where acl.grantee = pg_catalog.to_regrole('service_role')::oid
       )
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', expected.signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'service_role', expected.signature, 'EXECUTE'
     ) is distinct from (
       (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) = 3
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot function ACL normalization preflight failed',
      detail = v_bad;
  end if;

  -- The hosted default-privilege difference is catalog-wide, not a license to
  -- repair an arbitrary partial state. All seven functions must either carry
  -- the direct/effective service_role grant or all seven must already be
  -- normalized before this migration changes anything.
  select
    pg_catalog.count(*) filter (where exists (
      select 1
      from pg_catalog.aclexplode(routine.proacl) acl
      where acl.grantor = routine.proowner
        and acl.grantee = pg_catalog.to_regrole('service_role')::oid
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ))::integer,
    pg_catalog.count(*) filter (where pg_catalog.has_function_privilege(
      'service_role', expected.signature, 'EXECUTE'
    ))::integer
  into v_service_direct_count, v_service_effective_count
  from (values
    ('public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'),
    ('public.assign_bot(uuid,uuid,uuid,uuid)'),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)'),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)')
  ) expected(signature)
  join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature);

  if v_service_direct_count not in (0, 7)
    or v_service_effective_count not in (0, 7)
    or v_service_effective_count is distinct from v_service_direct_count then
    raise exception using errcode = '55000',
      message = 'legacy bot function ACL normalization refuses a mixed service_role state',
      detail = pg_catalog.format(
        'direct service_role EXECUTE on %s of 7; effective on %s of 7',
        v_service_direct_count,
        v_service_effective_count
      );
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine_schema.nspname = 'public'
    and routine.proname in (
      'register_bot', 'assign_bot', 'assign_bots_to_project',
      'record_bot_readiness', 'set_bot_assignment_execution',
      'update_bot_assignment', 'update_bot_assignment_configuration'
    )
    and routine.oid not in (
      'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'::pg_catalog.regprocedure,
      'public.assign_bot(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution(uuid,uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected legacy bot function overload before ACL normalization',
      detail = v_bad;
  end if;

  -- A single DO statement makes all seven edits and the postflight one atomic
  -- unit even when a caller does not add psql --single-transaction.
  execute 'revoke execute on function public.register_bot(uuid,text,public.bot_provider,text,text,text,text) from service_role';
  execute 'revoke execute on function public.assign_bot(uuid,uuid,uuid,uuid) from service_role';
  execute 'revoke execute on function public.assign_bots_to_project(uuid,uuid,jsonb) from service_role';
  execute 'revoke execute on function public.record_bot_readiness(uuid,uuid,public.bot_readiness,text) from service_role';
  execute 'revoke execute on function public.set_bot_assignment_execution(uuid,uuid,text,text) from service_role';
  execute 'revoke execute on function public.update_bot_assignment(uuid,uuid,public.bot_assignment_status) from service_role';
  execute 'revoke execute on function public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status) from service_role';

  -- Re-prove the full catalog after the ACL edit, then require exactly the
  -- owner and authenticated direct non-grantable EXECUTE entries.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.register_bot(uuid,text,public.bot_provider,text,text,text,text)',
     '87f577c2ecba24836e54b4ad5e7f383a', 'public.bots', true, 7, 3,
     'p_organization_id,p_name,p_provider,p_model,p_credential_ref,p_base_url,p_notes',
     '', null::oid[], 'NULL::text, NULL::text, NULL::text'),
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '9e5dea25195823492e3326ed96fa0535', 'public.bot_assignments', true, 4, 0,
     'p_organization_id,p_bot_id,p_project_id,p_role_id',
     '', null::oid[], null),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '742fea5b0e8655f19399f2a3944ce2c9', 'public.bot_assignments', true, 3, 0,
     'p_organization_id,p_project_id,p_assignments',
     '', null::oid[], null),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     '81788757faa428efebfc8a8ee7f9b6e6', 'public.bots', true, 4, 1,
     'p_organization_id,p_bot_id,p_readiness,p_detail',
     '', null::oid[], 'NULL::text'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     'cd33f17d969464665066854ff7692a1c', 'pg_catalog.record', true, 4, 2,
     'p_organization_id,p_assignment_id,p_model,p_work_effort,assignment_id,model,work_effort',
     'i,i,i,i,t,t,t', array[
       pg_catalog.to_regtype('pg_catalog.uuid')::oid,
       pg_catalog.to_regtype('pg_catalog.uuid')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid,
       pg_catalog.to_regtype('pg_catalog.uuid')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid,
       pg_catalog.to_regtype('pg_catalog.text')::oid
     ]::oid[], 'NULL::text, NULL::text'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '3637e0869520ee9eae89efd426b0b5c5', 'public.bot_assignments', true, 3, 0,
     'p_organization_id,p_assignment_id,p_status',
     '', null::oid[], null),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     'b39a3820c504f9dda9e84f73e1e4f065', 'public.bot_assignments', true, 5, 2,
     'p_organization_id,p_assignment_id,p_configuration,p_role_id,p_status',
     '', null::oid[], 'NULL::uuid, NULL::public.bot_assignment_status')
  ) expected(
    signature, source_md5, result_type, returns_set, argument_count,
    default_count, argument_names, argument_modes, all_argument_types,
    argument_defaults
  )
  left join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  left join pg_catalog.pg_language routine_language
    on routine_language.oid = routine.prolang
  where routine.oid is null
     or routine_schema.nspname is distinct from 'public'
     or routine_language.lanname is distinct from 'plpgsql'
     or routine.prokind is distinct from 'f'
     or routine.provolatile is distinct from 'v'
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or pg_catalog.md5(routine.prosrc) is distinct from expected.source_md5
     or routine.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or routine.proretset is distinct from expected.returns_set
     or routine.pronargs is distinct from expected.argument_count
     or routine.pronargdefaults is distinct from expected.default_count
     or pg_catalog.array_to_string(routine.proargnames, ',')
          is distinct from expected.argument_names
     or coalesce(pg_catalog.array_to_string(routine.proargmodes, ','), '')
          is distinct from expected.argument_modes
     or routine.proallargtypes is distinct from expected.all_argument_types
     or pg_catalog.pg_get_expr(routine.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or routine.proisstrict is distinct from false
     or routine.proleakproof is distinct from false
     or routine.proparallel is distinct from 'u'
     or routine.provariadic is distinct from 0::oid
     or routine.procost is distinct from 100::real
     or routine.prorows is distinct from 1000::real
     or routine.prosupport is distinct from 0::pg_catalog.regproc
     or routine.probin is not null
     or routine.prosqlbody is not null
     or routine.protrftypes is not null
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) <> 2
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = pg_catalog.to_regrole('authenticated')::oid
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor <> routine.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            routine.proowner,
            pg_catalog.to_regrole('authenticated')::oid
          )
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', expected.signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE');

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot function ACL normalization postflight failed',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine_schema.nspname = 'public'
    and routine.proname in (
      'register_bot', 'assign_bot', 'assign_bots_to_project',
      'record_bot_readiness', 'set_bot_assignment_execution',
      'update_bot_assignment', 'update_bot_assignment_configuration'
    )
    and routine.oid not in (
      'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'::pg_catalog.regprocedure,
      'public.assign_bot(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution(uuid,uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected legacy bot function overload after ACL normalization',
      detail = v_bad;
  end if;
end;
$normalize_legacy_bot_function_acls$;
