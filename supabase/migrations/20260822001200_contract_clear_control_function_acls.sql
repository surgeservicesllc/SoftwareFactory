-- Take EXECUTE on the two clear controls back from service_role.
--
-- 20260822000800 created clear_backlog_tasks and clear_all_pipelines and
-- ended each with:
--
--   revoke all on function ... from public, anon;
--   grant execute on function ... to authenticated;
--
-- Naming only PUBLIC and anon is not enough on hosted Supabase, which carries
-- ALTER DEFAULT PRIVILEGES granting EXECUTE on new public functions to anon,
-- authenticated and service_role at CREATE FUNCTION time. Revoking the two
-- named roles left service_role's direct grant standing.
--
-- This is the second time the same omission has shipped: 20260822000500 did it
-- to apply_resume_extraction and 20260822001100 (ADR-118) contained that one.
-- Both were written the same way and both passed their own post-apply gate,
-- because the gate asked about the two roles the migration had thought of.
--
-- Hosted probe run 32590061431 measured the result, reading a role the apply
-- never asked about:
--
--    proname             | security_definer | owner    | member_may_execute | anon_may_execute | service_may_execute
--    clear_all_pipelines | t                | postgres | t                  | f                | t
--    clear_backlog_tasks | t                | postgres | t                  | f                | t
--
-- Why it matters. These are SECURITY DEFINER functions owned by postgres that
-- delete rows, and they take the organization as a parameter rather than
-- deriving it. Their only authority check is can_manage_organization, which
-- resolves through has_organization_role and requires `auth.uid() is not
-- null` — so a raw service_role connection carrying no JWT is refused by the
-- function body even with EXECUTE. The exposure is therefore not "service_role
-- can clear any workspace" today; it is that the sole thing standing between
-- an RLS-bypassing role and a cascading delete is one `auth.uid()` test inside
-- the body, when the intended design put a grant boundary there as well. The
-- migration's own comment says "callable by members only", and that was not
-- true of the database it produced.
--
-- A new version rather than an edit: 20260822000800 is recorded in the hosted
-- ledger, and re-running a file under a version the ledger already holds is
-- how this repository previously lost a migration entirely.
--
-- Unlike 20260822001100 this does not freeze the function source. That file
-- was containing one exact routine inside a protected release; these two are
-- ordinary application functions that may legitimately be replaced later, and
-- pinning their bodies here would make the next honest edit fail an ACL
-- migration for an unrelated reason. What is asserted is the ACL contract,
-- which is what actually drifted.

do $preflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  -- The known input: both functions present, definer, owned by postgres, and
  -- reachable by authenticated. service_role's grant may or may not be there —
  -- present on hosted, absent on a database with no Supabase default
  -- privileges — so this accepts either and the postflight settles it.
  select count(*) = 2
     and bool_and(
       routine.prosecdef
       and pg_get_userbyid(routine.proowner) = 'postgres'
       and has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and not has_function_privilege('anon', routine.oid, 'EXECUTE')
     )
    into ready
  from pg_proc routine
  join pg_namespace space on space.oid = routine.pronamespace
  where space.nspname = 'public'
    and routine.proname in ('clear_backlog_tasks', 'clear_all_pipelines')
    and routine.oid in (
      to_regprocedure('public.clear_backlog_tasks(uuid,text,boolean)'),
      to_regprocedure('public.clear_all_pipelines(uuid,text,boolean)')
    );

  if ready is distinct from true then
    raise exception
      '20260822001200 preflight: the clear controls are missing, not SECURITY DEFINER, not owned by postgres, unreachable by authenticated, or reachable by anon';
  end if;
end
$preflight$;

-- Revoke every direct grant, default or inherited, then rebuild the intended
-- ACL: the owner implicitly, authenticated explicitly, nobody else. Naming
-- `public` matters — a grant to PUBLIC reaches every role including future
-- ones, and revoking the named roles alone would leave it standing.
revoke all on function public.clear_backlog_tasks(uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_backlog_tasks(uuid, text, boolean)
  to authenticated;

revoke all on function public.clear_all_pipelines(uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_all_pipelines(uuid, text, boolean)
  to authenticated;

do $postflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  -- Two assertions, deliberately overlapping. has_function_privilege answers
  -- "can this role execute", which is what a caller experiences; aclexplode
  -- answers "what does the ACL literally say", which is what a later default
  -- privilege would show up in. The first alone would miss a grant to a role
  -- nobody thought to name — which is exactly the defect being contained.
  select count(*) = 2
     and bool_and(
       has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and not has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not has_function_privilege('service_role', routine.oid, 'EXECUTE')
       and routine.proacl is not null
       and (select count(*) from aclexplode(routine.proacl)) = 2
       and exists (
         select 1 from aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner
           and acl.grantee = routine.proowner
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
       and exists (
         select 1 from aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner
           and acl.grantee = to_regrole('authenticated')::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
       and not exists (
         select 1 from aclexplode(routine.proacl) acl
         where acl.grantor <> routine.proowner
            or acl.grantee not in (routine.proowner, to_regrole('authenticated')::oid)
            or acl.privilege_type <> 'EXECUTE'
            or acl.is_grantable
       )
     )
    into ready
  from pg_proc routine
  join pg_namespace space on space.oid = routine.pronamespace
  where space.nspname = 'public'
    and routine.oid in (
      to_regprocedure('public.clear_backlog_tasks(uuid,text,boolean)'),
      to_regprocedure('public.clear_all_pipelines(uuid,text,boolean)')
    );

  if ready is distinct from true then
    raise exception
      '20260822001200 postflight: the clear controls do not hold exactly owner plus authenticated EXECUTE';
  end if;
end
$postflight$;
