do $probe$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations limit 1;
  if v_org is null then
    raise notice 'no organization to write a probe row against';
    return;
  end if;
  begin
    insert into public.activity_events
      (organization_id, event_type, entity_type, description)
    values (v_org, 'ai_account.changed', 'ai_account', 'probe row, deleted immediately');
    delete from public.activity_events where description = 'probe row, deleted immediately';
    raise notice 'activity_events insert as %: OK, probe row deleted', current_user;
  exception when others then
    raise notice 'activity_events insert as %: % %', current_user, sqlstate, sqlerrm;
  end;
end
$probe$;
