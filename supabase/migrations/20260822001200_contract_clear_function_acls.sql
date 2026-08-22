-- Forward-only containment for the hosted Supabase function default ACL.
--
-- 20260822000800 created the two destructive clear controls and revoked
-- EXECUTE from PUBLIC and anon. Hosted Supabase also grants EXECUTE directly
-- to service_role through ALTER DEFAULT PRIVILEGES, so that one direct grant
-- survived. Keep the immutable 00800 history intact and contract only the two
-- known ACL inputs in this new version.

do $preflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  with expected(signature, source_md5, contract_md5) as (values
    ('public.clear_all_pipelines(uuid,text,boolean)',
     'bec3779775db79ea9150725a9e5d087f', 'cd91f464350f968f5b11a52f10d127bd'),
    ('public.clear_backlog_tasks(uuid,text,boolean)',
     'dcb23b5217f03e5f74da437fe0c3393f', '295424372a8549485dcc9f7b66dfe025')
  ), function_state as (
    select expected.*, routine.oid, routine.proowner, routine.proacl,
           routine.prokind, routine.provolatile, routine.prosecdef,
           routine.proconfig, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as actual_source_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(format_type(argument.type_oid, null), ',' order by argument.ordinality)
               from unnest(routine.proallargtypes) with ordinality argument(type_oid, ordinality)
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
  )
  select count(oid) = 2
     and count(distinct oid) = 2
     and bool_and(
       nspname = 'public'
       and lanname = 'plpgsql'
       and pg_get_userbyid(proowner) = 'postgres'
       and prokind = 'f'
       and provolatile = 'v'
       and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       and actual_source_md5 = source_md5
       and actual_contract_md5 = contract_md5
       and proacl is not null
       and (select count(*) from aclexplode(proacl)) in (2, 3)
       and exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor = proowner and acl.grantee = proowner
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor = proowner
           and acl.grantee = to_regrole('authenticated')::oid
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and not exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor <> proowner
            or acl.grantee not in (
              proowner,
              to_regrole('authenticated')::oid,
              to_regrole('service_role')::oid
            )
            or acl.privilege_type <> 'EXECUTE'
            or acl.is_grantable
       )
       and not has_function_privilege('anon', oid, 'EXECUTE')
       and has_function_privilege('authenticated', oid, 'EXECUTE')
       and has_function_privilege('service_role', oid, 'EXECUTE')
           is not distinct from ((select count(*) from aclexplode(proacl)) = 3)
     )
     and (
       select count(*) = 2
       from pg_proc routine
       join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname in ('clear_all_pipelines', 'clear_backlog_tasks')
     )
    into ready
  from function_state;

  if ready is distinct from true then
    raise exception '20260822001200 preflight: clear function identity, catalog, or known ACL input drifted';
  end if;
end
$preflight$;

-- Revoke every default or inherited direct grant first, then rebuild the exact
-- intended ACL: owner implicitly plus authenticated explicitly.
revoke all on function public.clear_backlog_tasks(uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.clear_all_pipelines(uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_backlog_tasks(uuid, text, boolean)
  to authenticated;
grant execute on function public.clear_all_pipelines(uuid, text, boolean)
  to authenticated;

do $postflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  with expected(signature, source_md5, contract_md5) as (values
    ('public.clear_all_pipelines(uuid,text,boolean)',
     'bec3779775db79ea9150725a9e5d087f', 'cd91f464350f968f5b11a52f10d127bd'),
    ('public.clear_backlog_tasks(uuid,text,boolean)',
     'dcb23b5217f03e5f74da437fe0c3393f', '295424372a8549485dcc9f7b66dfe025')
  ), function_state as (
    select expected.*, routine.oid, routine.proowner, routine.proacl,
           routine.prokind, routine.provolatile, routine.prosecdef,
           routine.proconfig, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as actual_source_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(format_type(argument.type_oid, null), ',' order by argument.ordinality)
               from unnest(routine.proallargtypes) with ordinality argument(type_oid, ordinality)
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
  )
  select count(oid) = 2
     and count(distinct oid) = 2
     and bool_and(
       nspname = 'public'
       and lanname = 'plpgsql'
       and pg_get_userbyid(proowner) = 'postgres'
       and prokind = 'f'
       and provolatile = 'v'
       and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       and actual_source_md5 = source_md5
       and actual_contract_md5 = contract_md5
       and proacl is not null
       and (select count(*) from aclexplode(proacl)) = 2
       and exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor = proowner and acl.grantee = proowner
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor = proowner
           and acl.grantee = to_regrole('authenticated')::oid
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and not exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor <> proowner
            or acl.grantee not in (proowner, to_regrole('authenticated')::oid)
            or acl.privilege_type <> 'EXECUTE'
            or acl.is_grantable
       )
       and has_function_privilege('authenticated', oid, 'EXECUTE')
       and not has_function_privilege('anon', oid, 'EXECUTE')
       and not has_function_privilege('service_role', oid, 'EXECUTE')
     )
     and (
       select count(*) = 2
       from pg_proc routine
       join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname in ('clear_all_pipelines', 'clear_backlog_tasks')
     )
    into ready
  from function_state;

  if ready is distinct from true then
    raise exception '20260822001200 postflight: clear function ACL contraction failed';
  end if;
end
$postflight$;
