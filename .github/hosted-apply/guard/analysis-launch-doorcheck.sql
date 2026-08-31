begin;
do $doorcheck$
declare
  v_cmd public.commands%rowtype;
  v_actor uuid;
  v_graph uuid;
begin
  select command.* into v_cmd
    from public.commands command
   where command.parameters ->> 'executionMode' = 'record_only'
     and command.parameters ->> 'provider' = 'anthropic'
   order by command.created_at desc
   limit 1;
  if not found then
    raise notice 'DOORCHECK: no record-only Claude command exists to rehearse';
    return;
  end if;
  raise notice 'DOORCHECK: rehearsing command % (type %)', v_cmd.id, v_cmd.command_type;

  select member.user_id into v_actor
    from public.organization_members member
   where member.organization_id = v_cmd.organization_id
     and member.role = 'owner'
   order by member.created_at
   limit 1;
  if v_actor is null then
    raise notice 'DOORCHECK: the organization has no owner member row';
    return;
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text,
    true
  );

  begin
    v_graph := public.launch_command_analysis_graph(
      v_cmd.organization_id, v_cmd.project_id, v_cmd.id,
      'DAG'::public.graph_topology, '[]'::jsonb,
      'green'::public.risk_level, false,
      '[{"node_key":"doorcheck","job":"Doorcheck rehearsal only","executor":"MODEL","capability":"analysis"}]'::jsonb,
      '[]'::jsonb, '{}'::jsonb
    );
    raise notice 'DOORCHECK: launch returned graph % — the database layer is healthy (rolled back)', v_graph;
  exception when others then
    raise notice 'DOORCHECK: launch raised % — %', SQLSTATE, SQLERRM;
  end;
end
$doorcheck$;
rollback;
