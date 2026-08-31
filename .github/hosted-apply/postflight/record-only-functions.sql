set search_path = pg_catalog;
with expected(signature, source_md5, contract_md5, volatility, execute_role) as (values
  ('public.list_factory_command_routing_candidates(uuid,uuid,text)',
   '203f54d969fbc699304e780c1ad68a85', '17919dac57b41b75fe0793ad660063cc', 's', 'authenticated'),
  ('public.list_factory_commands(uuid,integer,uuid)',
   'ba62f4f5357cec647d3ff582107710a7', '162d47956f98e7b005c7abe1df680ee9', 's', 'authenticated'),
  ('public.normalize_phase1c_command()',
   'cd28d70a40e860660461700926e97830', '32b955c1d25380d6e075024ee98f8530', 'v', 'none'),
  ('public.plan_phase1c_task_and_run()',
   '2de7070bb9359ce7ad45516da2956a4b', '32b955c1d25380d6e075024ee98f8530', 'v', 'none'),
  ('public.queue_phase1c_run_for_task()',
   '4737eba3e8490632fdd89c6d06fece82', '32b955c1d25380d6e075024ee98f8530', 'v', 'none'),
  ('public.submit_command_phase1c_normalized_internal(uuid,text,public.risk_level,jsonb,text)',
   'adb50eb74e1721274f23d0d69b79e2e8', 'b725d8bc77d8d0b2f34a69c900c16d1f', 'v', 'none'),
  ('public.submit_command(uuid,text,public.risk_level,jsonb,text)',
   '024c3aa1f74d976fb7a8a6d7138cd9fb', 'b725d8bc77d8d0b2f34a69c900c16d1f', 'v', 'authenticated'),
  ('public.submit_factory_command_routing_internal(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
   '8418fd26e9b1783315a93ffbf4543838', 'b779f9c2f2c4d0cf086f6d67b85a457c', 'v', 'none'),
  ('public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
   '6008476137a77db33d220be4b14a9c8d', 'b779f9c2f2c4d0cf086f6d67b85a457c', 'v', 'authenticated'),
  ('public.record_provider_run_phase1c_compatibility_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   'c450eac6987cdd603d2d2511a9fa8833', 'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'none'),
  ('public.record_provider_run(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   '9dfdfc57f4f8b0965a89fefd927beb26', 'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'authenticated'),
  ('public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   '46cee8bec5e12fd4f087ecbeea0c9844', 'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'none')
), state as (
  select expected.*, routine.oid, routine.proowner, routine.proacl,
         routine.provolatile, routine.prosecdef, routine.proconfig,
         routine_schema.nspname, routine_language.lanname,
         md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as actual_source_md5,
         md5(jsonb_build_array(
           routine_schema.nspname, routine_language.lanname,
           pg_get_userbyid(routine.proowner), routine.prokind::text,
           format_type(routine.prorettype, null), routine.proretset,
           routine.pronargs, routine.pronargdefaults,
           coalesce(array_to_string(routine.proargnames, ','), ''),
           coalesce(array_to_string(routine.proargmodes, ','), ''),
           coalesce((select string_agg(format_type(arg.type_oid, null), ',' order by arg.ordinality)
                     from unnest(routine.proallargtypes) with ordinality arg(type_oid, ordinality)), ''),
           coalesce(pg_get_expr(routine.proargdefaults, 0), ''),
           routine.proisstrict, routine.proleakproof, routine.prosecdef,
           routine.proparallel::text, routine.provariadic = 0,
           routine.procost::text, routine.prorows::text,
           routine.prosupport = 0, routine.probin is null,
           routine.prosqlbody is null, routine.protrftypes is null,
           routine.proconfig, routine.proacl is null
         )::text) as actual_contract_md5
  from expected
  left join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
  left join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
  left join pg_language routine_language on routine_language.oid = routine.prolang
)
select count(oid) = 12 and count(distinct oid) = 12
   and bool_and(
     nspname = 'public' and lanname = 'plpgsql'
     and proowner = (select relowner from pg_class where oid = 'public.projects'::regclass)
     and actual_source_md5 = source_md5
     and actual_contract_md5 = contract_md5
     and provolatile::text = volatility and prosecdef
     and proconfig = array['search_path=pg_catalog']::text[]
     and proacl is not null
     and (select count(*) from aclexplode(proacl)) =
           case when execute_role = 'authenticated' then 2 else 1 end
     and exists (select 1 from aclexplode(proacl) acl where acl.grantor = proowner and acl.grantee = proowner and acl.privilege_type = 'EXECUTE' and not acl.is_grantable)
     and (execute_role = 'none' or exists (select 1 from aclexplode(proacl) acl where acl.grantor = proowner and acl.grantee = to_regrole('authenticated')::oid and acl.privilege_type = 'EXECUTE' and not acl.is_grantable))
     and not exists (select 1 from aclexplode(proacl) acl where acl.grantor <> proowner or acl.privilege_type <> 'EXECUTE' or acl.is_grantable or acl.grantee not in (proowner, case when execute_role = 'authenticated' then to_regrole('authenticated')::oid else proowner end))
     and not has_function_privilege('anon', signature, 'EXECUTE')
     and not has_function_privilege('service_role', signature, 'EXECUTE')
     and has_function_privilege('authenticated', signature, 'EXECUTE') is not distinct from (execute_role = 'authenticated')
   )
   and (select count(*) = 12 from pg_proc routine join pg_namespace space on space.oid = routine.pronamespace where space.nspname = 'public' and routine.proname in (
     'list_factory_command_routing_candidates', 'list_factory_commands', 'normalize_phase1c_command',
     'plan_phase1c_task_and_run', 'queue_phase1c_run_for_task',
     'submit_command', 'submit_command_phase1c_normalized_internal',
     'submit_factory_command', 'submit_factory_command_routing_internal',
     'record_provider_run', 'record_provider_run_phase1c_compatibility_internal',
     'record_provider_run_phase2a_internal'))
from state;
