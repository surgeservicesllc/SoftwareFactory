-- Archive as an operation, not just a status value.
--
-- `project_status` has included 'archived' since the control-plane schema, and
-- nothing could set it: no function, no route, no surface. Portfolio goal 28
-- ("project archive preserves history") was therefore unfalsifiable — there was
-- no archive whose history-preservation could be tested.
--
-- Two functions close it, shaped like the Phase 2E owner controls beside them:
-- owner-only, reason recorded, an immutable activity event per transition, and
-- nothing already running is touched. Archiving deliberately deletes nothing —
-- every run, task, command, change request and activity row keeps its project
-- foreign key, and the claim path's `project.status = 'active'` filter is what
-- stops new work, exactly as it already does for 'paused'.

alter type public.activity_event_type add value if not exists 'project.archived';
alter type public.activity_event_type add value if not exists 'project.unarchived';

create or replace function public.archive_project(
  p_project_id uuid,
  p_reason text default null
)
returns table (project_id uuid, status public.project_status, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- An archive with no reason is the pause problem again: the one transition
  -- nobody can explain later. Refused at the boundary.
  if trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'an archive reason is required';
  end if;

  select project.* into project_record
  from public.projects project where project.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may archive a project';
  end if;
  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '22023', message = 'project is already archived';
  end if;

  update public.projects project
  set status = 'archived'::public.project_status, updated_at = now()
  where project.id = p_project_id
  returning project.* into project_record;

  perform public.record_activity_event(
    project_record.organization_id, project_record.id,
    'project.archived'::public.activity_event_type,
    'project', project_record.id,
    'Project archived',
    jsonb_build_object('reason', trimmed_reason)
  );

  return query select project_record.id, project_record.status, project_record.updated_at;
end;
$function$;

create or replace function public.unarchive_project(
  p_project_id uuid,
  p_reason text default null
)
returns table (project_id uuid, status public.project_status, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select project.* into project_record
  from public.projects project where project.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may unarchive a project';
  end if;
  if project_record.status <> 'archived'::public.project_status then
    raise exception using errcode = '22023', message = 'project is not archived';
  end if;

  -- Restores to 'active' rather than remembering the prior status. An archived
  -- project's pre-archive state is history, not a promise; an owner who wants
  -- it paused pauses it, and that choice is then recorded as its own event.
  update public.projects project
  set status = 'active'::public.project_status, updated_at = now()
  where project.id = p_project_id
  returning project.* into project_record;

  perform public.record_activity_event(
    project_record.organization_id, project_record.id,
    'project.unarchived'::public.activity_event_type,
    'project', project_record.id,
    'Project unarchived',
    jsonb_build_object('reason', coalesce(trimmed_reason, ''))
  );

  return query select project_record.id, project_record.status, project_record.updated_at;
end;
$function$;

revoke all on function public.archive_project(uuid, text) from public;
revoke all on function public.unarchive_project(uuid, text) from public;
grant execute on function public.archive_project(uuid, text) to authenticated;
grant execute on function public.unarchive_project(uuid, text) to authenticated;
