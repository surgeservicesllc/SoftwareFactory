begin;
do $probe$
declare
  v_org uuid;
  v_owner uuid;
  v_row record;
  v_count integer;
begin
  select a.organization_id, m.user_id
    into v_org, v_owner
    from public.ai_accounts a
    join public.organization_members m
      on m.organization_id = a.organization_id and m.role = 'owner'
   order by a.created_at
   limit 1;
  if v_org is null then
    raise notice 'no organization with accounts to test bot creation in';
    return;
  end if;

  select count(*) into v_count from public.bots b where b.organization_id = v_org;
  raise notice 'org % holds % bot rows', v_org, v_count;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    select * into v_row from public.register_bot(
      v_org, 'Probe Bot', 'anthropic'::public.bot_provider, 'claude-opus-5',
      'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN', null,
      'Probe row, rolled back with this transaction.'
    );
    raise notice 'register_bot as owner: created % (rolled back)', v_row.id;
  exception when others then
    raise notice 'register_bot as owner: % %', sqlstate, sqlerrm;
  end;
  reset role;
end
$probe$;
rollback;
