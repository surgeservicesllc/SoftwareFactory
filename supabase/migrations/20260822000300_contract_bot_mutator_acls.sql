-- CONTRACT half of the bot-account-binding release.
--
-- The replacement application must be serving and accepted before this file
-- is applied. This migration deliberately changes no function body, signature,
-- owner, SECURITY DEFINER attribute, search path, table, trigger, row, or
-- policy. It removes only direct EXECUTE from the six legacy bot mutators that
-- the EXPAND migration temporarily kept callable during the rolling cutover.

do $contract$
declare
  v_bad text;
begin
  -- Pin name resolution, then compare version-stable stored bodies and every
  -- externally visible contract field. pg_get_functiondef deparser bytes are
  -- deliberately not a cross-PostgreSQL-major identity.
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  if pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception using errcode = '55000',
      message = 'bot mutator CONTRACT roles are not the exact expected catalog';
  end if;

  -- A ledger row is not catalog proof. Require the complete EXPAND function
  -- surface, exact frozen definitions, SECURITY DEFINER/search_path posture,
  -- and intended replacement ACL before removing any compatibility grant.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.ai_account_bot_credential_ref(public.bot_provider,text)',
     'afae78ba3750e372829dd50e1b48c5cb', 'i', 'none', 'pg_catalog.text', false,
     'p_provider,p_credential_purpose', '', null, true),
    ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)',
     '5ff06f065e241ad2baf5d7d5f576743a', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_project_id,p_assignments', '', null, false),
    ('public.enforce_bot_ai_account_binding()',
     '885b6c63c7f0b761d3ae99bdb416d6f4', 'v', 'none', 'pg_catalog.trigger', false,
     '', '', null, false),
    ('public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)',
     '3140ecd6b0d850732f96bdc5096b97e3', 'v', 'authenticated', 'pg_catalog.record', true,
     'p_organization_id,p_ai_account_id,p_provider,p_name,p_model,p_additional,p_base_url,p_notes,bot_id,provision_outcome',
     'i,i,i,i,i,i,i,i,t,t', 'false, NULL::text, NULL::text', false),
    ('public.increment_bot_assignment_revision()',
     '90320b19a6b41eb32b084a3b0db8ef21', 'v', 'none', 'pg_catalog.trigger', false,
     '', '', null, false),
    ('public.increment_bot_revision()',
     '154cf22e868e447c6f74aeb08508ad08', 'v', 'none', 'pg_catalog.trigger', false,
     '', '', null, false),
    ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
     '1132e6e0bed1697a7ccaa82006db35f5', 'v', 'service_role', 'public.bots', true,
     'p_organization_id,p_bot_id,p_actor_user_id,p_expected_revision,p_expected_ai_account_id,p_expected_provider,p_expected_model,p_expected_credential_ref,p_expected_base_url,p_readiness,p_detail',
     '', 'NULL::text', false),
    ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)',
     'd0c11a5c1e57878c9b1b5d8753ecb1fd', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_expected_project_id,p_expected_revision,p_model,p_work_effort',
     '', 'NULL::text, NULL::text', false),
    ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)',
     '5323b0adb327f3d3a19c9bdca220922e', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_expected_project_id,p_expected_revision,p_status',
     '', null, false),
    ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)',
     'eabefae63edf3d957ed8a0ad5e10d1bd', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_expected_project_id,p_expected_revision,p_configuration,p_role_id,p_status',
     '', 'NULL::uuid, NULL::public.bot_assignment_status', false)
  ) expected(
    signature, source_md5, volatility, execute_role, result_type, returns_set,
    argument_names, argument_modes, argument_defaults, is_strict
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
     or routine.provolatile is distinct from expected.volatility::"char"
     or pg_catalog.md5(routine.prosrc) is distinct from expected.source_md5
     or routine.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or routine.proretset is distinct from expected.returns_set
     or coalesce(pg_catalog.array_to_string(routine.proargnames, ','), '')
          is distinct from expected.argument_names
     or coalesce(pg_catalog.array_to_string(routine.proargmodes, ','), '')
          is distinct from expected.argument_modes
     or coalesce((
          select pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid, null),
            ',' order by argument_type.ordinality
          )
          from pg_catalog.unnest(routine.proallargtypes)
            with ordinality argument_type(type_oid, ordinality)
        ), '') is distinct from case expected.signature
          when 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'
            then 'uuid,uuid,public.bot_provider,text,text,boolean,text,text,uuid,text'
          else ''
        end
     or pg_catalog.pg_get_expr(routine.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or routine.proisstrict is distinct from expected.is_strict
     or routine.proleakproof is distinct from false
     or routine.proparallel is distinct from 'u'
     or routine.procost is distinct from 100::real
     or routine.prorows is distinct from
          case when expected.returns_set then 1000::real else 0::real end
     or routine.provariadic <> 0
     or routine.prosupport <> 0
     or routine.probin is not null
     or routine.prosqlbody is not null
     or routine.protrftypes is not null
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl))
          <> case when expected.execute_role = 'none' then 1 else 2 end
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or (
       expected.execute_role <> 'none'
       and not exists (
         select 1
         from pg_catalog.aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner
           and acl.grantee = pg_catalog.to_regrole(expected.execute_role)::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee <> routine.proowner
         and (
           expected.execute_role = 'none'
           or acl.grantee <> pg_catalog.to_regrole(expected.execute_role)::oid
         )
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or (
       pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       is distinct from (expected.execute_role = 'authenticated')
     )
     or (
       pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
       is distinct from (expected.execute_role = 'service_role')
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 function catalog is not the exact approved EXPAND state',
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
      'ai_account_bot_credential_ref',
      'assign_bots_to_project_checked',
      'enforce_bot_ai_account_binding',
      'ensure_ai_account_bot',
      'increment_bot_assignment_revision',
      'increment_bot_revision',
      'record_bot_readiness_preserving_disabled',
      'set_bot_assignment_execution_checked',
      'update_bot_assignment_checked',
      'update_bot_assignment_configuration_checked'
    )
    and routine.oid not in (
      'public.ai_account_bot_credential_ref(public.bot_provider,text)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.enforce_bot_ai_account_binding()'::pg_catalog.regprocedure,
      'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'::pg_catalog.regprocedure,
      'public.increment_bot_assignment_revision()'::pg_catalog.regprocedure,
      'public.increment_bot_revision()'::pg_catalog.regprocedure,
      'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 has an unexpected helper or checked-function overload',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.identity, ', ' order by expected.identity)
  into v_bad
  from (values
    ('public.bot_assignments.revision', 'public.bot_assignments'::pg_catalog.regclass,
     'revision', 'bot_assignments_revision_positive'),
    ('public.bots.revision', 'public.bots'::pg_catalog.regclass,
     'revision', 'bots_revision_positive')
  ) expected(identity, relation_id, column_name, constraint_name)
  left join pg_catalog.pg_attribute column_row
    on column_row.attrelid = expected.relation_id
   and column_row.attname = expected.column_name
   and not column_row.attisdropped
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = column_row.attrelid
   and default_row.adnum = column_row.attnum
  left join pg_catalog.pg_constraint constraint_row
    on constraint_row.conrelid = expected.relation_id
   and constraint_row.conname = expected.constraint_name
  where column_row.attnum is null
     or column_row.atttypid <> 'pg_catalog.int8'::pg_catalog.regtype
     or not column_row.attnotnull
     or column_row.attidentity <> ''
     or column_row.attgenerated <> ''
     or default_row.oid is null
     or pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
          not in ('1', '1::bigint', '''1''::bigint')
     or constraint_row.oid is null
     or constraint_row.contype <> 'c'
     or not constraint_row.convalidated
     or constraint_row.connoinherit
     or pg_catalog.pg_get_constraintdef(constraint_row.oid) <> 'CHECK ((revision > 0))';

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 revision column or constraint catalog is not exact',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.identity, ', ' order by expected.identity)
  into v_bad
  from (values
    ('public.bot_assignments.bot_assignments_increment_revision',
     'public.bot_assignments'::pg_catalog.regclass,
     'bot_assignments_increment_revision', 19::smallint,
     'public.increment_bot_assignment_revision()'::pg_catalog.regprocedure,
     ''),
    ('public.bots.bots_ai_account_binding_coherent',
     'public.bots'::pg_catalog.regclass,
     'bots_ai_account_binding_coherent', 23::smallint,
     'public.enforce_bot_ai_account_binding()'::pg_catalog.regprocedure,
     'organization_id,ai_account_id,provider,credential_ref'),
    ('public.bots.bots_increment_revision',
     'public.bots'::pg_catalog.regclass,
     'bots_increment_revision', 19::smallint,
     'public.increment_bot_revision()'::pg_catalog.regprocedure,
     '')
  ) expected(identity, relation_id, trigger_name, trigger_type, function_id, update_columns)
  left join pg_catalog.pg_trigger trigger_row
    on trigger_row.tgrelid = expected.relation_id
   and trigger_row.tgname = expected.trigger_name
   and not trigger_row.tgisinternal
  where trigger_row.oid is null
     or trigger_row.tgenabled <> 'O'
     or trigger_row.tgtype <> expected.trigger_type
     or trigger_row.tgfoid <> expected.function_id
     or trigger_row.tgconstraint <> 0
     or trigger_row.tgparentid <> 0
     or trigger_row.tgconstrrelid <> 0
     or trigger_row.tgconstrindid <> 0
     or trigger_row.tgdeferrable
     or trigger_row.tginitdeferred
     or trigger_row.tgqual is not null
     or trigger_row.tgoldtable is not null
     or trigger_row.tgnewtable is not null
     or pg_catalog.octet_length(trigger_row.tgargs) <> 0
     or coalesce((
       select pg_catalog.string_agg(column_row.attname, ',' order by update_column.ordinality)
       from pg_catalog.unnest(trigger_row.tgattr::smallint[])
         with ordinality update_column(attnum, ordinality)
       join pg_catalog.pg_attribute column_row
         on column_row.attrelid = trigger_row.tgrelid
        and column_row.attnum = update_column.attnum
        and not column_row.attisdropped
     ), '') is distinct from expected.update_columns;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 trigger catalog is not exact',
      detail = v_bad;
  end if;

  -- Refuse a missing, replaced, re-owned, reconfigured, or differently
  -- granted legacy routine using the same version-stable source and explicit
  -- contract projection as the EXPAND preflight.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '9e5dea25195823492e3326ed96fa0535', 'public.bot_assignments', true,
     'p_organization_id,p_bot_id,p_project_id,p_role_id', '', null),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '742fea5b0e8655f19399f2a3944ce2c9', 'public.bot_assignments', true,
     'p_organization_id,p_project_id,p_assignments', '', null),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     '81788757faa428efebfc8a8ee7f9b6e6', 'public.bots', true,
     'p_organization_id,p_bot_id,p_readiness,p_detail', '', 'NULL::text'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     'cd33f17d969464665066854ff7692a1c', 'pg_catalog.record', true,
     'p_organization_id,p_assignment_id,p_model,p_work_effort,assignment_id,model,work_effort',
     'i,i,i,i,t,t,t', 'NULL::text, NULL::text'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '3637e0869520ee9eae89efd426b0b5c5', 'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_status', '', null),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     'b39a3820c504f9dda9e84f73e1e4f065', 'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_configuration,p_role_id,p_status', '',
     'NULL::uuid, NULL::public.bot_assignment_status')
  ) expected(
    signature, source_md5, result_type, returns_set,
    argument_names, argument_modes, argument_defaults
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
     or coalesce(pg_catalog.array_to_string(routine.proargnames, ','), '')
          is distinct from expected.argument_names
     or coalesce(pg_catalog.array_to_string(routine.proargmodes, ','), '')
          is distinct from expected.argument_modes
     or coalesce((
          select pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid, null),
            ',' order by argument_type.ordinality
          )
          from pg_catalog.unnest(routine.proallargtypes)
            with ordinality argument_type(type_oid, ordinality)
        ), '') is distinct from case expected.signature
          when 'public.set_bot_assignment_execution(uuid,uuid,text,text)'
            then 'uuid,uuid,text,text,uuid,text,text'
          else ''
        end
     or pg_catalog.pg_get_expr(routine.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or routine.proisstrict is distinct from false
     or routine.proleakproof is distinct from false
     or routine.proparallel is distinct from 'u'
     or routine.procost is distinct from 100::real
     or routine.prorows is distinct from
          case when expected.returns_set then 1000::real else 0::real end
     or routine.provariadic <> 0
     or routine.prosupport <> 0
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
     or not pg_catalog.has_function_privilege(
       'authenticated', expected.signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot mutator catalog does not match the exact authenticated-only EXPAND contract',
      detail = v_bad;
  end if;

  -- An unexpected overload could remain a direct, unversioned mutation path
  -- after the six approved identities are closed. Stop instead of partially
  -- contracting a dirty catalog.
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
      'assign_bot',
      'assign_bots_to_project',
      'record_bot_readiness',
      'set_bot_assignment_execution',
      'update_bot_assignment',
      'update_bot_assignment_configuration'
    )
    and routine.oid not in (
      'public.assign_bot(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution(uuid,uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected legacy bot mutator overload exists before CONTRACT',
      detail = v_bad;
  end if;

  -- One DO statement keeps preflight, the six ACL edits, and verification
  -- atomic even if a caller omits psql --single-transaction.
  execute 'revoke all privileges on function public.assign_bot(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.assign_bots_to_project(uuid,uuid,jsonb) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.record_bot_readiness(uuid,uuid,public.bot_readiness,text) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.set_bot_assignment_execution(uuid,uuid,text,text) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.update_bot_assignment(uuid,uuid,public.bot_assignment_status) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status) from public, anon, authenticated, service_role';

  -- Re-read the complete definitions and exact ACL shape. The function owner
  -- remains the sole executor so SECURITY DEFINER checked wrappers can still
  -- delegate internally, while every direct client/worker path is closed.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '9e5dea25195823492e3326ed96fa0535'),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '742fea5b0e8655f19399f2a3944ce2c9'),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     '81788757faa428efebfc8a8ee7f9b6e6'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     'cd33f17d969464665066854ff7692a1c'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '3637e0869520ee9eae89efd426b0b5c5'),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     'b39a3820c504f9dda9e84f73e1e4f065')
  ) expected(signature, source_md5)
  join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  where pg_catalog.md5(routine.prosrc) is distinct from expected.source_md5
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) <> 1
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or pg_catalog.has_function_privilege(
       'authenticated', expected.signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot mutator CONTRACT verification failed',
      detail = v_bad;
  end if;
end;
$contract$;
