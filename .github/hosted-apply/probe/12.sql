            set search_path = pg_catalog;
            with expected(signature, source_md5, volatility, contract_md5, execute_role) as (values
              ('public.agentos_apply_project_config(uuid,uuid,jsonb,boolean)', 'cfc8efe543fbebebda8a2e643f91e487', 'v', 'f75cd9cd32d176e36c7255f121387c97', 'authenticated'),
              ('public.agentos_export_project_config(uuid,uuid)', '863ca595c22d6e036032161e2b447315', 's', '49af7f5da1f63fbb12c52e89c81ae446', 'authenticated'),
              ('public.agentos_list_agent_grants(uuid,integer)', 'ad0721957db42e486c2dab484cc8260c', 's', 'c7bdcbf48e76a11da39b5dde14eba14f', 'authenticated'),
              ('public.agentos_record_trigger_delivery(uuid,text,jsonb,boolean)', '9aa2f2f83beb0b28e29f2b37e1a91d4e', 'v', 'c6f6df3c444a98bb57f77d0052da44cb', 'service_role'),
              ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)', '5ff06f065e241ad2baf5d7d5f576743a', 'v', '972ba462e06d56885860d179ad59706f', 'authenticated'),
              ('public.audit_factory_health(uuid)', '18bbb7f45cb5fe4b9d9d3b45f06076c2', 's', 'fda3d299611d1adf37527279f0ba6e1e', 'authenticated'),
              ('public.capture_improvement_baseline(uuid)', '2c7693b411e87f73433dcf0b5d117c9c', 's', 'fda3d299611d1adf37527279f0ba6e1e', 'authenticated'),
              ('public.claim_provider_connect_session(text,text)', '9961e16bbe95da08903caac340633bca', 'v', 'a7ca5a02b1faa50ebba452c4a4f46195', 'service_role'),
              ('public.list_factory_command_routing_candidates(uuid,uuid,text)', '20f9edba1651974ca0ef256293269d81', 's', '17919dac57b41b75fe0793ad660063cc', 'authenticated'),
              ('public.normalize_bot_assignment_configuration(jsonb)', '643e307fdd9f98479bbe54d6f29c3623', 'i', '451c6919550f1ebe87eb5ec83b50366b', 'none'),
              ('public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])', '5c78babb546ecec96e81878a3c02ac0f', 'v', '8d7877b6de24358edd3e75981eb5411f', 'authenticated'),
              ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)', 'd0c11a5c1e57878c9b1b5d8753ecb1fd', 'v', '813ab274df60a32d50ddeeb5b1d0ca01', 'authenticated'),
              ('public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)', 'aea5da3473dd612f066e0e6fa3a76dd0', 'v', 'b779f9c2f2c4d0cf086f6d67b85a457c', 'authenticated'),
              ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)', '5323b0adb327f3d3a19c9bdca220922e', 'v', '7aae20f9ed9251fe3e32530baaf32ddb', 'authenticated'),
              ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)', 'eabefae63edf3d957ed8a0ad5e10d1bd', 'v', '61cbc7ff7cb5a849b6021cdca5012449', 'authenticated'),
              ('public.validate_pipeline_template_areas(jsonb)', 'd10799c81d59269ae5cd6bcd2a5e5d27', 'i', '0d286e56441a0a9e377719309b75a912', 'none')
            ), state as (
              select expected.*, routine.oid, routine.proowner, routine.proacl,
                     routine.prokind, routine.provolatile, routine.prosecdef, routine.proconfig,
                     routine_schema.nspname, routine_language.lanname,
                     md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as actual_source_md5,
                     md5(jsonb_build_array(
                       routine_schema.nspname, routine_language.lanname,
                       pg_get_userbyid(routine.proowner), routine.prokind::text,
                       format_type(routine.prorettype, null), routine.proretset,
                       routine.pronargs, routine.pronargdefaults,
                       coalesce(array_to_string(routine.proargnames, ','), ''),
                       coalesce(array_to_string(routine.proargmodes, ','), ''),
                       coalesce((select string_agg(format_type(arg.type_oid, null), ',' order by arg.ordinality) from unnest(routine.proallargtypes) with ordinality arg(type_oid, ordinality)), ''),
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
            select signature, oid is not null as present,
                   actual_source_md5, source_md5 as expected_source_md5,
                   provolatile as actual_volatility, volatility as expected_volatility,
                   actual_contract_md5, contract_md5 as expected_contract_md5,
                   nspname, lanname, pg_get_userbyid(proowner) as owner,
                   prokind, prosecdef, proconfig,
                   (select count(*) from aclexplode(proacl)) as acl_entries,
                   has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_execute,
                   has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
                   has_function_privilege('service_role', oid, 'EXECUTE') as service_role_execute,
                   execute_role, proacl
              from state
             order by signature;
