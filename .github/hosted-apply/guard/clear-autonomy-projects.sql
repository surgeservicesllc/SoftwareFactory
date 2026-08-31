begin;
do $guardcheck$
declare
  v_project uuid;
  v_refused boolean := false;
begin
  select id into v_project from public.projects limit 1;
  if v_project is null then
    raise notice 'GUARD: no project to test against';
    return;
  end if;
  begin
    delete from public.projects where id = v_project;
  exception when others then
    -- Either message is a pass. 20260815000900's trigger explains the
    -- refusal; without it the activity_events RESTRICT refuses just
    -- as absolutely, only less legibly.
    v_refused := (SQLERRM like '%projects cannot be deleted%')
              or (SQLSTATE = '23503');
  end;
  if not v_refused then
    raise exception using errcode = '55000',
      message = 'a project could be deleted; the protection is gone';
  end if;
  raise notice 'GUARD: project deletion still refused';
end
$guardcheck$;
rollback;
