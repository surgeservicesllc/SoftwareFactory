begin;
do $guardcheck$
declare
  v_update_refused boolean := false;
  v_delete_refused boolean := false;
begin
  if to_regclass('public.factory_command_routes') is null then
    raise notice 'GUARD: routing table absent on this database; nothing to prove';
    return;
  end if;
  begin
    update public.factory_command_routes set pipeline_template_key = pipeline_template_key;
  exception when others then
    v_update_refused := (SQLERRM like '%routing evidence is immutable%');
  end;
  begin
    delete from public.factory_command_routes where false;
    -- A no-op delete touches no row, so the row trigger never fires;
    -- force one row through instead when any row exists.
    delete from public.factory_command_routes
     where ctid = (select ctid from public.factory_command_routes limit 1);
  exception when others then
    v_delete_refused := (SQLERRM like '%routing evidence is immutable%');
  end;
  raise notice 'GUARD: update refused=% delete refused=%', v_update_refused, v_delete_refused;
  if exists (select 1 from public.factory_command_routes)
    and not (v_update_refused and v_delete_refused) then
    raise exception using errcode = '55000',
      message = 'the routing guard no longer refuses ordinary mutation';
  end if;
end
$guardcheck$;
rollback;
