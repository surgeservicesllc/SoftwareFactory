-- Take EXECUTE on the two project lifecycle mutators back from anon.
--
-- The third instance of one omission. 20260815000700 ended with:
--
--   revoke all on function public.archive_project(uuid, text) from public;
--   revoke all on function public.unarchive_project(uuid, text) from public;
--   grant execute ... to authenticated;
--
-- `from public` revokes the implicit grant to PUBLIC. It does not touch the
-- direct grants hosted Supabase hands out through ALTER DEFAULT PRIVILEGES at
-- CREATE FUNCTION time, which include `anon`. So both functions stayed
-- reachable by an unauthenticated caller.
--
-- 20260822000500 made the same omission on apply_resume_extraction (contained
-- by 20260822001100, ADR-118) and 20260822000800 made it on the two clear
-- controls (contained by 20260822001200, ADR-120). This one predates both and
-- was found by sweeping rather than by an incident: the whole migration chain
-- was replayed on a PostgreSQL server configured with Supabase's default
-- privileges, and every volatile SECURITY DEFINER function reachable by anon
-- was listed. Two were not meant to be.
--
-- Severity, stated exactly. Both functions call can_manage_project, which
-- resolves through has_organization_role and requires `auth.uid() is not
-- null`, so an anon caller is refused inside the body. Measured, not assumed:
-- calling archive_project as anon raises "only an organization owner may
-- archive a project" and leaves the row untouched. There is no data exposure.
-- What is wrong is that the grant boundary the migration's own revoke was
-- reaching for was never actually placed, leaving one in-body check as the
-- only thing between an unauthenticated caller and a state change.
--
-- A new version rather than an edit: 20260815000700 is in the hosted ledger.

revoke all on function public.archive_project(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.archive_project(uuid, text) to authenticated;

revoke all on function public.unarchive_project(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.unarchive_project(uuid, text) to authenticated;

do $postflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  select count(*) = 2
     and bool_and(
       has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and not has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not has_function_privilege('service_role', routine.oid, 'EXECUTE')
       -- Counted rather than named: a grant to a role nobody thought of is the
       -- entire failure mode, and asking about one role by name is how this
       -- was missed three times.
       and routine.proacl is not null
       and (select count(*) from aclexplode(routine.proacl)) = 2
     )
    into ready
  from pg_proc routine
  where routine.oid in (
    to_regprocedure('public.archive_project(uuid,text)'),
    to_regprocedure('public.unarchive_project(uuid,text)')
  );

  if ready is distinct from true then
    raise exception
      '20260822001300 postflight: the project lifecycle mutators do not hold exactly owner plus authenticated EXECUTE';
  end if;
end
$postflight$;
