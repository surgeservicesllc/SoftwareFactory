-- Forward-only containment for the hosted Supabase function default ACL.
--
-- 20260822000400 created apply_resume_extraction and 20260822000500
-- contracted the table grants. The latter revoked function EXECUTE from
-- PUBLIC and anon, but hosted Supabase had also granted EXECUTE directly to
-- service_role through ALTER DEFAULT PRIVILEGES. Keep the immutable 00400 and
-- 00500 history intact and remove that one known overgrant in a new version.

do $preflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  with function_state as (
    select routine.*, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
           md5(jsonb_build_array(
             pg_get_userbyid(routine.proowner), routine_language.lanname,
             routine.prokind::text,
             routine.provolatile::text, format_type(routine.prorettype, null),
             routine.proretset, routine.pronargs, routine.pronargdefaults,
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
           )::text) as contract_md5
    from pg_proc routine
    join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
    join pg_language routine_language on routine_language.oid = routine.prolang
    where routine.oid = to_regprocedure('public.apply_resume_extraction(uuid,text[])')
  )
  select count(*) = 1
     and bool_and(
       nspname = 'public'
       and lanname = 'plpgsql'
       and pg_get_userbyid(proowner) = 'postgres'
       and prokind = 'f'
       and provolatile = 'v'
       and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       and source_md5 = '2bc4b362facbea54d3fd0b67c2545682'
       and contract_md5 = 'f0b1bd6c32a55077dd010d420cd324ab'
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
       select count(*) = 1
       from pg_proc routine
       join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname = 'apply_resume_extraction'
     )
    into ready
  from function_state;

  if ready is distinct from true then
    raise exception '20260822001100 preflight: apply_resume_extraction identity or known ACL input drifted';
  end if;
end
$preflight$;

-- Revoke every default or inherited direct grant first, then rebuild the exact
-- intended ACL: owner implicitly plus authenticated explicitly.
revoke all on function public.apply_resume_extraction(uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.apply_resume_extraction(uuid, text[])
  to authenticated;

do $postflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  with function_state as (
    select routine.*, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
           md5(jsonb_build_array(
             pg_get_userbyid(routine.proowner), routine_language.lanname,
             routine.prokind::text,
             routine.provolatile::text, format_type(routine.prorettype, null),
             routine.proretset, routine.pronargs, routine.pronargdefaults,
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
           )::text) as contract_md5
    from pg_proc routine
    join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
    join pg_language routine_language on routine_language.oid = routine.prolang
    where routine.oid = to_regprocedure('public.apply_resume_extraction(uuid,text[])')
  )
  select count(*) = 1
     and bool_and(
       nspname = 'public'
       and lanname = 'plpgsql'
       and pg_get_userbyid(proowner) = 'postgres'
       and prokind = 'f'
       and provolatile = 'v'
       and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       and source_md5 = '2bc4b362facbea54d3fd0b67c2545682'
       and contract_md5 = 'f0b1bd6c32a55077dd010d420cd324ab'
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
    into ready
  from function_state;

  if ready is distinct from true then
    raise exception '20260822001100 postflight: apply_resume_extraction ACL contraction failed';
  end if;
end
$postflight$;
