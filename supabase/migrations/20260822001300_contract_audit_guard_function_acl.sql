-- Forward-only containment for the hosted Supabase function default ACL on
-- the append-only audit guard.
--
-- 20260812000300 created reject_activity_event_mutation() and revoked EXECUTE
-- from PUBLIC, anon, and authenticated — but not from service_role, because
-- locally no such grant ever existed. Hosted Supabase grants EXECUTE on new
-- functions to anon, authenticated, and service_role through ALTER DEFAULT
-- PRIVILEGES, so the revoke left service_role holding a live grant. Probe run
-- 32599284961 measured exactly that: reject_mutation_function_posture f, the
-- one containment clause still refusing the protected record-only chain after
-- every state, census, worker, and event clause read green.
--
-- Keep the immutable 20260812000300 history intact and remove the one known
-- overgrant in a new version, exactly as 20260822001100 did for the resume
-- extraction function. A trigger function is never called directly, so no
-- role needs EXECUTE at all; the trigger fires it as the table's owner.

do $preflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  select count(*) = 1
     and bool_and(
       routine_schema.nspname = 'public'
       and routine_language.lanname = 'plpgsql'
       and pg_get_userbyid(routine.proowner) = 'postgres'
       and routine.prokind = 'f'
       and routine.provolatile = 'v'
       and not routine.prosecdef
       and routine.prorettype = 'trigger'::regtype
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and btrim(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'), E' \n') =
         E'begin\n  raise exception using errcode = ''55000'', message = ''activity events are append-only'';\nend;'
       and routine.proacl is not null
       and (select count(*) from aclexplode(routine.proacl)) in (1, 2)
       and exists (
         select 1 from aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner and acl.grantee = routine.proowner
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and not exists (
         select 1 from aclexplode(routine.proacl) acl
         where acl.grantor <> routine.proowner
            or acl.grantee not in (
              routine.proowner,
              to_regrole('service_role')::oid
            )
            or acl.privilege_type <> 'EXECUTE'
            or acl.is_grantable
       )
       and not has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and has_function_privilege('service_role', routine.oid, 'EXECUTE')
           is not distinct from ((select count(*) from aclexplode(routine.proacl)) = 2)
     )
     and (
       select count(*) = 1
       from pg_proc routine
       join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname = 'reject_activity_event_mutation'
     )
    into ready
  from pg_proc routine
  join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
  join pg_language routine_language on routine_language.oid = routine.prolang
  where routine.oid = to_regprocedure('public.reject_activity_event_mutation()');

  if ready is distinct from true then
    raise exception
      '20260822001300 preflight: reject_activity_event_mutation identity or known ACL input drifted';
  end if;
end
$preflight$;

-- Revoke every default or inherited direct grant, leaving the owner's
-- implicit entry alone. Idempotent on the already-clean replay.
revoke all on function public.reject_activity_event_mutation()
  from public, anon, authenticated, service_role;

do $postflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  select count(*) = 1
     and bool_and(
       routine_schema.nspname = 'public'
       and routine_language.lanname = 'plpgsql'
       and pg_get_userbyid(routine.proowner) = 'postgres'
       and routine.prokind = 'f'
       and routine.provolatile = 'v'
       and not routine.prosecdef
       and routine.prorettype = 'trigger'::regtype
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and btrim(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'), E' \n') =
         E'begin\n  raise exception using errcode = ''55000'', message = ''activity events are append-only'';\nend;'
       and routine.proacl is not null
       and (select count(*) from aclexplode(routine.proacl)) = 1
       and exists (
         select 1 from aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner and acl.grantee = routine.proowner
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and not has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and not has_function_privilege('service_role', routine.oid, 'EXECUTE')
     )
    into ready
  from pg_proc routine
  join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
  join pg_language routine_language on routine_language.oid = routine.prolang
  where routine.oid = to_regprocedure('public.reject_activity_event_mutation()');

  if ready is distinct from true then
    raise exception
      '20260822001300 postflight: reject_activity_event_mutation ACL contraction failed';
  end if;
end
$postflight$;
