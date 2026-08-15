-- Name the rule the schema already enforces: projects cannot be deleted.
--
-- Portfolio goal 29 asks that project deletion be protected and unable to
-- silently destroy anything. The audit scored it UNPROVEN, and inspection
-- found the schema answers it more absolutely than a guard could: every
-- project is born with a 'project.created' activity event (the
-- projects_audit_change trigger), activity_events references projects with
-- ON DELETE RESTRICT, and the activity_events_append_only trigger makes that
-- birth record permanent. A project's audit trail is literally what makes it
-- undeletable, from its first moment, forever. The supported end of a
-- project's life is archive_project.
--
-- What was missing is the *statement* of that rule. Today a deletion attempt
-- fails with a foreign-key violation naming activity_events — true, cryptic,
-- and discovered only after the attempt. This trigger fires first and says
-- what is actually going on, so a definer bug, a dashboard mistake, or a
-- future migration draft meets an explanation instead of a puzzle.
--
-- Deliberately no escape hatch. Nothing can pass the RESTRICT behind this
-- trigger anyway, so an acknowledgement mechanism would be theater; a future
-- phase that truly needs data surgery must drop the trigger explicitly and
-- say so in its own migration.

create or replace function public.refuse_project_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501', message =
    'projects cannot be deleted: every project''s append-only activity trail '
    'restricts deletion from its first recorded moment. The supported end of a '
    'project''s life is archive_project.';
  return old;
end;
$function$;

drop trigger if exists projects_guarded_deletion on public.projects;
create trigger projects_guarded_deletion
  before delete on public.projects
  for each row execute function public.refuse_project_deletion();

-- A trigger fires without its function being executable by the caller, so
-- nothing may call this directly. The schema-security invariants pin the
-- anonymous and service_role execute surfaces, and this function joins
-- neither.
revoke all on function public.refuse_project_deletion() from public, anon, authenticated, service_role;
