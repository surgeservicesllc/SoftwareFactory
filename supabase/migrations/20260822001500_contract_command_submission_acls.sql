-- Forward-only ACL contraction for the command-submission functions.
--
-- Applying 20260815001000 on hosted recreates submit_command and creates
-- declare/release_cross_project_dependency, and hosted Supabase default
-- privileges have repeatedly attached direct EXECUTE grants that no local
-- replay reproduces (the resume function, the clear controls, and the audit
-- guard were all caught the same way today). The protected 20260822001000
-- chain requires submit_command's ACL to be exactly owner plus
-- authenticated. This file converges all three functions to that exact
-- state, whatever known-shape input hosted presents, and no-ops on the
-- already-clean replay.
--
-- Source-agnostic on purpose: submit_command legitimately has two eras
-- (the 20260815001000 carry and the protected chain's rewrite), and an ACL
-- contraction has no business freezing either body. Identity is enforced
-- as: the function exists exactly once per signature, and every ACL entry
-- is an owner-granted, non-grantable EXECUTE for a known role.

do $preflight$
declare
  bad text;
begin
  set local search_path = pg_catalog;

  select string_agg(signature, ', ' order by signature)
    into bad
  from (values
    ('public.submit_command(uuid,text,public.risk_level,jsonb,text)'),
    ('public.declare_cross_project_dependency(uuid,uuid,text)'),
    ('public.release_cross_project_dependency(uuid,uuid,text)')
  ) expected(signature)
  left join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
  where routine.oid is null
     or routine.proacl is null
     or exists (
       select 1 from aclexplode(routine.proacl) acl
       where acl.grantor <> routine.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            routine.proowner,
            to_regrole('authenticated')::oid,
            to_regrole('anon')::oid,
            to_regrole('service_role')::oid
          )
     );

  if bad is not null then
    raise exception using errcode = '55000',
      message = '20260822001500 preflight: a command-submission function is absent or carries an unknown ACL shape',
      detail = bad;
  end if;
end
$preflight$;

revoke all on function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  from public, anon, service_role;
grant execute on function public.submit_command(uuid, text, public.risk_level, jsonb, text)
  to authenticated;

revoke all on function public.declare_cross_project_dependency(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.declare_cross_project_dependency(uuid, uuid, text)
  to authenticated;

revoke all on function public.release_cross_project_dependency(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.release_cross_project_dependency(uuid, uuid, text)
  to authenticated;

do $postflight$
declare
  bad text;
begin
  set local search_path = pg_catalog;

  select string_agg(expected.signature, ', ' order by expected.signature)
    into bad
  from (values
    ('public.submit_command(uuid,text,public.risk_level,jsonb,text)'),
    ('public.declare_cross_project_dependency(uuid,uuid,text)'),
    ('public.release_cross_project_dependency(uuid,uuid,text)')
  ) expected(signature)
  join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
  where routine.proacl is null
     or (select count(*) from aclexplode(routine.proacl)) <> 2
     or not exists (
       select 1 from aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
     )
     or not exists (
       select 1 from aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = to_regrole('authenticated')::oid
         and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
     )
     or has_function_privilege('anon', routine.oid, 'EXECUTE')
     or has_function_privilege('service_role', routine.oid, 'EXECUTE')
     or not has_function_privilege('authenticated', routine.oid, 'EXECUTE');

  if bad is not null then
    raise exception using errcode = '55000',
      message = '20260822001500 postflight: a command-submission function did not converge to owner plus authenticated',
      detail = bad;
  end if;
end
$postflight$;
