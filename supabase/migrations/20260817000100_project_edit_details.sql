-- Editing a project's identity as an operation.
--
-- Projects could be created, archived, re-pointed at repositories, and given
-- controls — but a typo in a name or description was permanent: authenticated
-- table writes are closed by design and no function updated those columns.
-- This closes that gap the same way the operations beside it work: owner or
-- administrator only, trimmed and bounded exactly like the create path
-- (connect_github_project), archived projects refused as records, and the
-- existing `audit_project_change` trigger records the update as an immutable
-- `project.updated` activity event. Deliberately absent: any hard-delete —
-- archiving is the delete that keeps every run, task, command, and audit row.

create or replace function public.update_project_details(
  p_project_id uuid,
  p_name text,
  p_description text default null
)
returns table (project_id uuid, name text, description text, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  trimmed_name text := nullif(btrim(coalesce(p_name, '')), '');
  trimmed_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if trimmed_name is null or char_length(trimmed_name) > 160 then
    raise exception using errcode = '22023',
      message = 'a project name of 1 to 160 characters is required';
  end if;
  if trimmed_description is not null and char_length(trimmed_description) > 2000 then
    raise exception using errcode = '22023',
      message = 'a project description may not exceed 2000 characters';
  end if;

  select project.* into project_record
  from public.projects project where project.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not public.can_manage_organization(project_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '22023',
      message = 'an archived project is a record; unarchive it before editing';
  end if;

  update public.projects project
  set name = trimmed_name,
      description = trimmed_description,
      updated_at = now()
  where project.id = p_project_id
  returning project.* into project_record;

  return query select project_record.id, project_record.name,
    project_record.description, project_record.updated_at;
end;
$function$;

revoke all on function public.update_project_details(uuid, text, text) from public, anon;
grant execute on function public.update_project_details(uuid, text, text) to authenticated;
