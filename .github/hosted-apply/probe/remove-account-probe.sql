begin;
do $probe$
declare
  v_org uuid;
  v_owner uuid;
  v_account uuid;
  v_result boolean;
  v_uid uuid;
  v_can boolean;
  v_member record;
begin
  /*
   * The first attempt picked the earliest owner membership and found
   * an organization with no accounts at all — the definitive call
   * never ran. Start from the accounts instead: the organization that
   * holds one, joined to an owner OF THAT organization, is the exact
   * shape the console's failing request has.
   */
  select a.organization_id, m.user_id, a.id
    into v_org, v_owner, v_account
    from public.ai_accounts a
    join public.organization_members m
      on m.organization_id = a.organization_id and m.role = 'owner'
   order by a.created_at
   limit 1;
  if v_account is null then
    raise notice 'no AI account with an owner membership anywhere — nothing to test';
    return;
  end if;
  raise notice 'testing org % account % as user %', v_org, v_account, v_owner;

  for v_member in
    select m.user_id, m.role from public.organization_members m
     where m.organization_id = v_org order by m.created_at
  loop
    raise notice '  member % role %', v_member.user_id, v_member.role;
  end loop;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  /* Whether the identity plumbing itself resolves under this role is
     half the diagnosis: a NULL here means the probe's JWT emulation
     (not production) is what any refusal below is measuring. */
  begin
    select auth.uid() into v_uid;
    raise notice 'auth.uid() under authenticated: %', coalesce(v_uid::text, 'NULL');
  exception when others then
    raise notice 'auth.uid() raised: % %', sqlstate, sqlerrm;
  end;
  begin
    select public.can_manage_organization(v_org) into v_can;
    raise notice 'can_manage_organization: %', v_can;
  exception when others then
    raise notice 'can_manage_organization raised: % %', sqlstate, sqlerrm;
  end;

  begin
    select public.remove_ai_account(v_org, v_account) into v_result;
    raise notice 'remove_ai_account as owner: returned % (rolled back)', v_result;
  exception when others then
    raise notice 'remove_ai_account as owner: % %', sqlstate, sqlerrm;
  end;
  reset role;
end
$probe$;
rollback;
