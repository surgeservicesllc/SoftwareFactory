set search_path = pg_catalog;
with expected_functions(signature, source_md5, contract_md5, volatility, execute_role) as (values
  ('public.ai_account_bot_credential_ref(public.bot_provider,text)', 'afae78ba3750e372829dd50e1b48c5cb', '93243ca92614a4c2cd42045536de34cf', 'i', 'none'),
  ('public.assign_bot(uuid,uuid,uuid,uuid)', '80b547b7b722c57a9d2a262b67698be8', 'f6f66a20b1848121d45f08ffe716466e', 'v', 'none'),
  ('public.assign_bots_to_project(uuid,uuid,jsonb)', '23b260247a4be4f4a8d8aa2497e1b6a2', '509ff97d6dd6ccecfc6a0b559f6402ab', 'v', 'none'),
  ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)', '5ff06f065e241ad2baf5d7d5f576743a', '509ff97d6dd6ccecfc6a0b559f6402ab', 'v', 'authenticated'),
  ('public.enforce_bot_ai_account_binding()', '885b6c63c7f0b761d3ae99bdb416d6f4', 'c76d49585995381de4cd050f453488a7', 'v', 'none'),
  ('public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)', '3140ecd6b0d850732f96bdc5096b97e3', '3e616013f7f1aa22bc5b06c8babb29a6', 'v', 'authenticated'),
  ('public.increment_bot_assignment_revision()', '90320b19a6b41eb32b084a3b0db8ef21', 'c76d49585995381de4cd050f453488a7', 'v', 'none'),
  ('public.increment_bot_revision()', '154cf22e868e447c6f74aeb08508ad08', 'c76d49585995381de4cd050f453488a7', 'v', 'none'),
  ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)', 'daecfeb964d863373a2072cc62e1033e', 'f399bc01e734509765a9955d6ea12d3f', 'v', 'none'),
  ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)', '1132e6e0bed1697a7ccaa82006db35f5', '0fab1985ab6e7ca13e0c38d6302536f0', 'v', 'service_role'),
  ('public.set_bot_assignment_execution(uuid,uuid,text,text)', '55ec15132d903ace0300f2cbe32db6bd', '09868603f1251c9b3c0e714585c470a6', 'v', 'none'),
  ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)', 'd0c11a5c1e57878c9b1b5d8753ecb1fd', '47ed878441dae8b7a4e4c5292e1260ae', 'v', 'authenticated'),
  ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)', '0aaec47295f86adbeec784d288f24400', '15df08b5f10d11f2eb75939bd24ff471', 'v', 'none'),
  ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)', '5323b0adb327f3d3a19c9bdca220922e', 'caa9e8093054cac7ebb3571ee2a5ec98', 'v', 'authenticated'),
  ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)', '7f51999309b645832d471ccebea94a9c', '25a69b2727d3e8c038411fcdfa7f9ae3', 'v', 'none'),
  ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)', 'eabefae63edf3d957ed8a0ad5e10d1bd', 'a40abf44b52cd3bcaf55f6bad964626b', 'v', 'authenticated')
), function_state as (
  select expected.*,
         routine.oid,
         routine.proowner,
         routine.prokind,
         routine.provolatile,
         routine.prosecdef,
         routine.proconfig,
         routine.proacl,
         routine_schema.nspname,
         routine_language.lanname,
         md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as actual_source_md5,
         md5(jsonb_build_array(
           format_type(routine.prorettype, null), routine.proretset,
           routine.pronargs, routine.pronargdefaults,
           coalesce(array_to_string(routine.proargnames, ','), ''),
           coalesce(array_to_string(routine.proargmodes, ','), ''),
           coalesce((
             select string_agg(format_type(argument_type.type_oid, null), ',' order by argument_type.ordinality)
             from unnest(routine.proallargtypes)
               with ordinality argument_type(type_oid, ordinality)
           ), ''),
           coalesce(pg_get_expr(routine.proargdefaults, 0), ''),
           routine.proisstrict, routine.proleakproof, routine.proparallel::text,
           case when routine.provariadic = 0 then '' else format_type(routine.provariadic, null) end,
           routine.procost::text, routine.prorows::text,
           case when routine.prosupport = 0 then '' else routine.prosupport::regproc::text end,
           coalesce(routine.probin, ''), routine.prosqlbody is null,
           coalesce((
             select string_agg(format_type(transform_type.type_oid, null), ',' order by transform_type.ordinality)
             from unnest(routine.protrftypes)
               with ordinality transform_type(type_oid, ordinality)
           ), '')
         )::text) as actual_contract_md5
    from expected_functions expected
    left join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
    left join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
    left join pg_language routine_language on routine_language.oid = routine.prolang
)
select to_regrole('authenticated') is not null
   and to_regrole('anon') is not null
   and to_regrole('service_role') is not null
   and (select count(oid) = 16
          and bool_and(
            nspname = 'public'
             and lanname = 'plpgsql'
             and prokind = 'f'
             and provolatile::text = volatility
             and actual_source_md5 = source_md5
             and actual_contract_md5 = contract_md5
            and prosecdef
            and proconfig = array['search_path=pg_catalog']::text[]
            and pg_get_userbyid(proowner) = 'postgres'
            and proacl is not null
            and (select count(*) from aclexplode(proacl)) =
              case when execute_role = 'none' then 1 else 2 end
            and exists (
              select 1 from aclexplode(proacl) acl
               where acl.grantor = proowner
                 and acl.grantee = proowner
                 and acl.privilege_type = 'EXECUTE'
                 and not acl.is_grantable
            )
            and (
              execute_role = 'none'
              or exists (
                select 1 from aclexplode(proacl) acl
                 where acl.grantor = proowner
                   and acl.grantee = to_regrole(execute_role)::oid
                   and acl.privilege_type = 'EXECUTE'
                   and not acl.is_grantable
              )
            )
            and not exists (
              select 1 from aclexplode(proacl) acl
               where acl.grantee <> proowner
                 and (execute_role = 'none' or acl.grantee <> to_regrole(execute_role)::oid)
            )
            and not has_function_privilege('anon', signature, 'EXECUTE')
            and has_function_privilege('authenticated', signature, 'EXECUTE') =
              (execute_role = 'authenticated')
            and has_function_privilege('service_role', signature, 'EXECUTE') =
              (execute_role = 'service_role')
            and not exists (
              select 1 from aclexplode(proacl) acl
               where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
            )
          )
        from function_state)
   and (
     select count(*) = 16
       from pg_proc routine
       join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
      where routine_schema.nspname = 'public'
        and routine.proname in (
          'ai_account_bot_credential_ref', 'assign_bot',
          'assign_bots_to_project', 'assign_bots_to_project_checked',
          'enforce_bot_ai_account_binding', 'ensure_ai_account_bot',
          'increment_bot_assignment_revision', 'increment_bot_revision',
          'record_bot_readiness', 'record_bot_readiness_preserving_disabled',
          'set_bot_assignment_execution', 'set_bot_assignment_execution_checked',
          'update_bot_assignment', 'update_bot_assignment_checked',
          'update_bot_assignment_configuration',
          'update_bot_assignment_configuration_checked'
        )
   )
   and (
     select count(column_row.attnum) = 2
        and count(default_row.oid) = 2
        and count(constraint_row.oid) = 2
        and bool_and(
          column_row.atttypid = 'int8'::regtype
          and column_row.attnotnull
          and column_row.attidentity = ''
          and column_row.attgenerated = ''
          and coalesce(
            pg_get_expr(default_row.adbin, default_row.adrelid)
              in ('1', '1::bigint', '''1''::bigint'),
            false
          )
          and constraint_row.contype = 'c'
          and constraint_row.convalidated
          and not constraint_row.connoinherit
          and pg_get_constraintdef(constraint_row.oid) = 'CHECK ((revision > 0))'
        )
       from (values
         ('public.bot_assignments'::regclass, 'revision', 'bot_assignments_revision_positive'),
         ('public.bots'::regclass, 'revision', 'bots_revision_positive')
       ) expected(relation_id, column_name, constraint_name)
       left join pg_attribute column_row
         on column_row.attrelid = expected.relation_id
        and column_row.attname = expected.column_name
        and not column_row.attisdropped
       left join pg_attrdef default_row
         on default_row.adrelid = column_row.attrelid
        and default_row.adnum = column_row.attnum
       left join pg_constraint constraint_row
         on constraint_row.conrelid = expected.relation_id
        and constraint_row.conname = expected.constraint_name
   )
   and (
     select count(trigger_row.oid) = 3
        and bool_and(
          trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = expected.trigger_type
          and trigger_row.tgfoid = expected.function_id
          and trigger_row.tgconstraint = 0
          and trigger_row.tgparentid = 0
          and trigger_row.tgconstrrelid = 0
          and trigger_row.tgconstrindid = 0
          and not trigger_row.tgdeferrable
          and not trigger_row.tginitdeferred
          and trigger_row.tgqual is null
          and trigger_row.tgoldtable is null
          and trigger_row.tgnewtable is null
          and octet_length(trigger_row.tgargs) = 0
          and coalesce((
            select string_agg(column_row.attname, ',' order by update_column.ordinality)
              from unnest(trigger_row.tgattr::smallint[])
                with ordinality update_column(attnum, ordinality)
              join pg_attribute column_row
                on column_row.attrelid = trigger_row.tgrelid
               and column_row.attnum = update_column.attnum
               and not column_row.attisdropped
          ), '') = expected.update_columns
        )
       from (values
         ('public.bot_assignments'::regclass, 'bot_assignments_increment_revision', 19::smallint,
          'public.increment_bot_assignment_revision()'::regprocedure, ''),
         ('public.bots'::regclass, 'bots_ai_account_binding_coherent', 23::smallint,
          'public.enforce_bot_ai_account_binding()'::regprocedure,
          'organization_id,ai_account_id,provider,credential_ref'),
         ('public.bots'::regclass, 'bots_increment_revision', 19::smallint,
          'public.increment_bot_revision()'::regprocedure, '')
       ) expected(relation_id, trigger_name, trigger_type, function_id, update_columns)
       left join pg_trigger trigger_row
         on trigger_row.tgrelid = expected.relation_id
        and trigger_row.tgname = expected.trigger_name
        and not trigger_row.tgisinternal
   );
