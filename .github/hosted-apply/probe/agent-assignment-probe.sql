begin;
do $probe$
declare
  v_org uuid;
  v_owner uuid;
  v_agent uuid;
  v_model text;
  v_row record;
  v_counts record;
begin
  for v_counts in
    select o.id,
           (select count(*) from public.agents a where a.organization_id = o.id) as agents,
           (select count(*) from public.provider_model_configurations c
             where c.organization_id = o.id and c.enabled) as enabled_models
      from public.organizations o
     order by o.created_at
  loop
    raise notice 'org % holds % agents, % enabled model configurations',
      v_counts.id, v_counts.agents, v_counts.enabled_models;
  end loop;

  select a.organization_id, a.id, m.user_id
    into v_org, v_agent, v_owner
    from public.agents a
    join public.organization_members m
      on m.organization_id = a.organization_id and m.role = 'owner'
   order by a.created_at
   limit 1;
  if v_agent is null then
    raise notice 'no agent with an owner membership anywhere - nothing to test';
    return;
  end if;
  select c.model into v_model
    from public.provider_model_configurations c
   where c.organization_id = v_org
     and c.provider = 'anthropic'::public.connection_provider
     and c.enabled
   order by c.model
   limit 1;
  if v_model is null then
    raise notice 'org % has no enabled anthropic model to assign', v_org;
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select * into v_row from public.set_agent_provider_assignment(v_agent, 'anthropic', v_model);
    raise notice 'set_agent_provider_assignment as owner: agent % now % / % (rolled back)',
      v_row.id, v_row.provider, v_row.model;
  exception when others then
    raise notice 'set_agent_provider_assignment as owner: % %', sqlstate, sqlerrm;
  end;
  reset role;
end
$probe$;
rollback;
