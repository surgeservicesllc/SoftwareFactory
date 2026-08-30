            set search_path = pg_catalog;
            with expected(signature, source_md5, execute_role) as (values
              ('public.list_factory_command_routing_candidates(uuid,uuid,text)', '203f54d969fbc699304e780c1ad68a85', 'authenticated'),
              ('public.list_factory_commands(uuid,integer,uuid)', 'ba62f4f5357cec647d3ff582107710a7', 'authenticated'),
              ('public.normalize_phase1c_command()', 'cd28d70a40e860660461700926e97830', 'none'),
              ('public.plan_phase1c_task_and_run()', '2de7070bb9359ce7ad45516da2956a4b', 'none'),
              ('public.queue_phase1c_run_for_task()', '4737eba3e8490632fdd89c6d06fece82', 'none'),
              ('public.submit_command_phase1c_normalized_internal(uuid,text,public.risk_level,jsonb,text)', 'adb50eb74e1721274f23d0d69b79e2e8', 'none'),
              ('public.submit_command(uuid,text,public.risk_level,jsonb,text)', '024c3aa1f74d976fb7a8a6d7138cd9fb', 'authenticated'),
              ('public.submit_factory_command_routing_internal(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)', '8418fd26e9b1783315a93ffbf4543838', 'none'),
              ('public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)', '6008476137a77db33d220be4b14a9c8d', 'authenticated'),
              ('public.record_provider_run_phase1c_compatibility_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)', 'c450eac6987cdd603d2d2511a9fa8833', 'none'),
              ('public.record_provider_run(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)', '9dfdfc57f4f8b0965a89fefd927beb26', 'authenticated'),
              ('public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)', '46cee8bec5e12fd4f087ecbeea0c9844', 'none')
            )
            select left(expected.signature, 60) as wrapper,
                   expected.execute_role as want_role,
                   routine.oid is not null as present,
                   md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = expected.source_md5 as source_ok,
                   routine.provolatile::text as vol, routine.prosecdef as secdef,
                   routine.proconfig = array['search_path=pg_catalog']::text[] as config_ok,
                   coalesce(routine.proacl::text, '<null>') as acl,
                   has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_x,
                   has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_x,
                   has_function_privilege('authenticated', routine.oid, 'EXECUTE') as auth_x
            from expected
            left join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
            order by expected.signature;
