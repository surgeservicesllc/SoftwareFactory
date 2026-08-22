-- Forward-only normalization for the four hosted function ACLs that precede
-- the catalog/lint repair in 20260822000900.
--
-- The hosted database has one frozen legacy RETURNS TABLE contract for
-- claim_provider_connect_session plus three Supabase default-privilege grants.
-- This migration changes ACLs only.  A clean replay, whose four ACLs are
-- already normalized and whose claim result uses the canonical output names,
-- is an exact no-op.

do $normalize_hosted_pre_repair_function_acls$
declare
  v_common_ready boolean;
  v_hosted_input boolean;
  v_target_input boolean;
  v_before_oids oid[];
  v_before_sources text[];
  v_before_contracts text[];
  v_after_oids oid[];
  v_after_sources text[];
  v_after_contracts text[];
begin
  set local search_path = pg_catalog;

  with expected(
    signature, source_md5, volatility, security_definer, config,
    arguments_md5, result_md5, contract_md5,
    alternate_result_md5, alternate_contract_md5
  ) as (values
    ('public.claim_provider_connect_session(text,text)',
     '9961e16bbe95da08903caac340633bca', 'v', true,
     array['search_path=pg_catalog']::text[],
     '6c4654f1612525e6c5b714ddea7050f1',
     '3b2b93799687f2d2de6b154376542759',
     'a7ca5a02b1faa50ebba452c4a4f46195',
     'd39f7431a65f34513eed0e6ad46e5ab0',
     '8992610aa5f3749a013a3bdf9f7d4fef'),
    ('public.normalize_bot_assignment_configuration(jsonb)',
     '643e307fdd9f98479bbe54d6f29c3623', 'i', false,
     array['search_path=pg_catalog']::text[],
     '1772e507ebf1500556561fe25ca48b3c',
     'cd8a1292080b231b3e9a85d440b02023',
     '451c6919550f1ebe87eb5ec83b50366b', null, null),
    ('public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])',
     '5c78babb546ecec96e81878a3c02ac0f', 'v', true,
     array['search_path=public, pg_temp']::text[],
     '1c7bb9c86f02507a76d24fc2911387a2',
     'dca150e997a47d6e579413ace8b530be',
     '8d7877b6de24358edd3e75981eb5411f', null, null),
    ('public.validate_pipeline_template_areas(jsonb)',
     'd10799c81d59269ae5cd6bcd2a5e5d27', 'i', false,
     array['search_path=pg_catalog']::text[],
     'cbf9bd42cf404b21da0c0fd554aed7bd',
     'cab8111fd0b710a336c898e539090e34',
     '0d286e56441a0a9e377719309b75a912', null, null)
  ), raw_state as (
    select expected.*, routine.oid, routine.proowner, routine.proacl,
           routine.prokind, routine.provolatile, routine.prosecdef,
           routine.proconfig, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
             as actual_source_md5,
           md5(pg_get_function_identity_arguments(routine.oid))
             as actual_arguments_md5,
           md5(pg_get_function_result(routine.oid)) as actual_result_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(
                 format_type(argument.type_oid, null), ',' order by argument.ordinality
               )
               from unnest(routine.proallargtypes) with ordinality
                    argument(type_oid, ordinality)
             ), ''),
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
  ), state as (
    select raw_state.*,
           (select count(*) from aclexplode(proacl)) as acl_entries,
           exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor = proowner and acl.grantee = proowner
               and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
           ) as owner_direct,
           exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor = proowner
               and acl.grantee = to_regrole('authenticated')::oid
               and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
           ) as authenticated_direct,
           exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor = proowner
               and acl.grantee = to_regrole('service_role')::oid
               and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
           ) as service_role_direct,
           not exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor <> proowner
                or acl.grantee not in (
                  proowner,
                  to_regrole('authenticated')::oid,
                  to_regrole('service_role')::oid
                )
                or acl.privilege_type <> 'EXECUTE'
                or acl.is_grantable
           ) as acl_shape_exact
      from raw_state
  )
  select
    count(oid) = 4
      and count(distinct oid) = 4
      and bool_and(
        nspname = 'public'
        and lanname = 'plpgsql'
        and proowner = to_regrole('postgres')::oid
        and pg_get_userbyid(proowner) = 'postgres'
        and prokind = 'f'
        and provolatile = volatility::"char"
        and prosecdef = security_definer
        and proconfig is not distinct from config
        and actual_source_md5 = source_md5
        and actual_arguments_md5 = arguments_md5
        and (
          (actual_result_md5 = result_md5 and actual_contract_md5 = contract_md5)
          or (
            alternate_result_md5 is not null
            and actual_result_md5 = alternate_result_md5
            and actual_contract_md5 = alternate_contract_md5
          )
        )
        and proacl is not null
        and owner_direct
        and acl_shape_exact
        and not has_function_privilege('anon', oid, 'EXECUTE')
      )
      and (
        select count(*) = 4
        from pg_proc candidate
        join pg_namespace space on space.oid = candidate.pronamespace
        where space.nspname = 'public'
          and candidate.proname in (
            'claim_provider_connect_session',
            'normalize_bot_assignment_configuration',
            'record_claim_anchoring',
            'validate_pipeline_template_areas'
          )
      ),
    bool_and(case signature
      when 'public.claim_provider_connect_session(text,text)' then
        actual_result_md5 = result_md5
        and actual_contract_md5 = contract_md5
        and acl_entries = 1
        and not authenticated_direct and not service_role_direct
        and not has_function_privilege('authenticated', oid, 'EXECUTE')
        and not has_function_privilege('service_role', oid, 'EXECUTE')
      when 'public.normalize_bot_assignment_configuration(jsonb)' then
        acl_entries = 2
        and not authenticated_direct and service_role_direct
        and not has_function_privilege('authenticated', oid, 'EXECUTE')
        and has_function_privilege('service_role', oid, 'EXECUTE')
      when 'public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])' then
        acl_entries = 3
        and authenticated_direct and service_role_direct
        and has_function_privilege('authenticated', oid, 'EXECUTE')
        and has_function_privilege('service_role', oid, 'EXECUTE')
      when 'public.validate_pipeline_template_areas(jsonb)' then
        acl_entries = 2
        and not authenticated_direct and service_role_direct
        and not has_function_privilege('authenticated', oid, 'EXECUTE')
        and has_function_privilege('service_role', oid, 'EXECUTE')
      else false
    end),
    bool_and(case signature
      when 'public.claim_provider_connect_session(text,text)' then
        acl_entries = 2
        and not authenticated_direct and service_role_direct
        and not has_function_privilege('authenticated', oid, 'EXECUTE')
        and has_function_privilege('service_role', oid, 'EXECUTE')
      when 'public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])' then
        acl_entries = 2
        and authenticated_direct and not service_role_direct
        and has_function_privilege('authenticated', oid, 'EXECUTE')
        and not has_function_privilege('service_role', oid, 'EXECUTE')
      when 'public.normalize_bot_assignment_configuration(jsonb)' then
        acl_entries = 1
        and not authenticated_direct and not service_role_direct
        and not has_function_privilege('authenticated', oid, 'EXECUTE')
        and not has_function_privilege('service_role', oid, 'EXECUTE')
      when 'public.validate_pipeline_template_areas(jsonb)' then
        acl_entries = 1
        and not authenticated_direct and not service_role_direct
        and not has_function_privilege('authenticated', oid, 'EXECUTE')
        and not has_function_privilege('service_role', oid, 'EXECUTE')
      else false
    end),
    array_agg(oid order by signature),
    array_agg(actual_source_md5 order by signature),
    array_agg(actual_contract_md5 order by signature)
  into v_common_ready, v_hosted_input, v_target_input,
       v_before_oids, v_before_sources, v_before_contracts
  from state;

  if v_common_ready is distinct from true
     or not coalesce(v_hosted_input, false)
        and not coalesce(v_target_input, false)
  then
    raise exception using errcode = '55000',
      message = '20260822000850 preflight: hosted function identity, catalog, ACL cohort, or overload drifted';
  end if;

  if v_hosted_input then
    execute 'revoke all on function public.claim_provider_connect_session(text,text) from public, anon, authenticated, service_role';
    execute 'grant execute on function public.claim_provider_connect_session(text,text) to service_role';

    execute 'revoke all on function public.normalize_bot_assignment_configuration(jsonb) from public, anon, authenticated, service_role';

    execute 'revoke all on function public.record_claim_anchoring(uuid,public.anchored_claim,uuid[]) from public, anon, authenticated, service_role';
    execute 'grant execute on function public.record_claim_anchoring(uuid,public.anchored_claim,uuid[]) to authenticated';

    execute 'revoke all on function public.validate_pipeline_template_areas(jsonb) from public, anon, authenticated, service_role';
  end if;

  with expected(
    signature, source_md5, volatility, security_definer, config,
    arguments_md5, result_md5, contract_md5,
    alternate_result_md5, alternate_contract_md5,
    authenticated_execute, service_role_execute, acl_entries
  ) as (values
    ('public.claim_provider_connect_session(text,text)',
     '9961e16bbe95da08903caac340633bca', 'v', true,
     array['search_path=pg_catalog']::text[],
     '6c4654f1612525e6c5b714ddea7050f1',
     '3b2b93799687f2d2de6b154376542759',
     'a7ca5a02b1faa50ebba452c4a4f46195',
     'd39f7431a65f34513eed0e6ad46e5ab0',
     '8992610aa5f3749a013a3bdf9f7d4fef', false, true, 2),
    ('public.normalize_bot_assignment_configuration(jsonb)',
     '643e307fdd9f98479bbe54d6f29c3623', 'i', false,
     array['search_path=pg_catalog']::text[],
     '1772e507ebf1500556561fe25ca48b3c',
     'cd8a1292080b231b3e9a85d440b02023',
     '451c6919550f1ebe87eb5ec83b50366b', null, null, false, false, 1),
    ('public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])',
     '5c78babb546ecec96e81878a3c02ac0f', 'v', true,
     array['search_path=public, pg_temp']::text[],
     '1c7bb9c86f02507a76d24fc2911387a2',
     'dca150e997a47d6e579413ace8b530be',
     '8d7877b6de24358edd3e75981eb5411f', null, null, true, false, 2),
    ('public.validate_pipeline_template_areas(jsonb)',
     'd10799c81d59269ae5cd6bcd2a5e5d27', 'i', false,
     array['search_path=pg_catalog']::text[],
     'cbf9bd42cf404b21da0c0fd554aed7bd',
     'cab8111fd0b710a336c898e539090e34',
     '0d286e56441a0a9e377719309b75a912', null, null, false, false, 1)
  ), raw_state as (
    select expected.*, routine.oid, routine.proowner, routine.proacl,
           routine.prokind, routine.provolatile, routine.prosecdef,
           routine.proconfig, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
             as actual_source_md5,
           md5(pg_get_function_identity_arguments(routine.oid))
             as actual_arguments_md5,
           md5(pg_get_function_result(routine.oid)) as actual_result_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(
                 format_type(argument.type_oid, null), ',' order by argument.ordinality
               )
               from unnest(routine.proallargtypes) with ordinality
                    argument(type_oid, ordinality)
             ), ''),
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
  ), state as (
    select raw_state.*,
           (select count(*) from aclexplode(proacl)) as actual_acl_entries,
           exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor = proowner and acl.grantee = proowner
               and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
           ) as owner_direct,
           exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor = proowner
               and acl.grantee = to_regrole('authenticated')::oid
               and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
           ) as authenticated_direct,
           exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor = proowner
               and acl.grantee = to_regrole('service_role')::oid
               and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
           ) as service_role_direct,
           not exists (
             select 1 from aclexplode(proacl) acl
             where acl.grantor <> proowner
                or acl.grantee not in (
                  proowner,
                  to_regrole('authenticated')::oid,
                  to_regrole('service_role')::oid
                )
                or acl.privilege_type <> 'EXECUTE'
                or acl.is_grantable
           ) as acl_shape_exact
      from raw_state
  )
  select array_agg(oid order by signature),
         array_agg(actual_source_md5 order by signature),
         array_agg(actual_contract_md5 order by signature),
         count(oid) = 4
           and count(distinct oid) = 4
           and bool_and(
             nspname = 'public'
             and lanname = 'plpgsql'
             and proowner = to_regrole('postgres')::oid
             and pg_get_userbyid(proowner) = 'postgres'
             and prokind = 'f'
             and provolatile = volatility::"char"
             and prosecdef = security_definer
             and proconfig is not distinct from config
             and actual_source_md5 = source_md5
             and actual_arguments_md5 = arguments_md5
             and (
               (actual_result_md5 = result_md5 and actual_contract_md5 = contract_md5)
               or (
                 alternate_result_md5 is not null
                 and actual_result_md5 = alternate_result_md5
                 and actual_contract_md5 = alternate_contract_md5
               )
             )
             and proacl is not null
             and actual_acl_entries = acl_entries
             and owner_direct
             and authenticated_direct = authenticated_execute
             and service_role_direct = service_role_execute
             and acl_shape_exact
             and has_function_privilege('authenticated', oid, 'EXECUTE')
                   is not distinct from authenticated_execute
             and not has_function_privilege('anon', oid, 'EXECUTE')
             and has_function_privilege('service_role', oid, 'EXECUTE')
                   is not distinct from service_role_execute
           )
           and (
             select count(*) = 4
             from pg_proc candidate
             join pg_namespace space on space.oid = candidate.pronamespace
             where space.nspname = 'public'
               and candidate.proname in (
                 'claim_provider_connect_session',
                 'normalize_bot_assignment_configuration',
                 'record_claim_anchoring',
                 'validate_pipeline_template_areas'
               )
           )
  into v_after_oids, v_after_sources, v_after_contracts, v_target_input
  from state;

  if v_target_input is distinct from true
     or v_after_oids is distinct from v_before_oids
     or v_after_sources is distinct from v_before_sources
     or v_after_contracts is distinct from v_before_contracts
  then
    raise exception using errcode = '55000',
      message = '20260822000850 postflight: ACL normalization changed function identity or catalog';
  end if;
end
$normalize_hosted_pre_repair_function_acls$;
