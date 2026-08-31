-- Project the immutable initial Grok context envelope into protocol-v3 claims.
--
-- This is a claim-time evidence projection only. It does not fetch URL/image
-- references, create work, enable a worker, change autonomy, or widen any
-- function ACL. A malformed or stale envelope raises in the claim RPC's own
-- transaction, so the lease/run mutation performed by the underlying claim is
-- rolled back with it. Legacy and non-Grok claims remain unchanged.

do $grok_claim_context_preflight$
declare
  v_expected record;
  v_routine oid;
begin
  if 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and relation.relkind = 'r'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) then
    raise exception using errcode = '55000',
      message = 'Grok claim context relation identity drifted';
  end if;

  for v_expected in
    select * from (values
      ('public.attach_current_grok_admissions_to_claim(jsonb)',
       '427294dac55a06b5ca1f9a1c89b0cdfa', false),
      ('public.attach_current_grok_admission_to_phase1c_claim(jsonb)',
       '48f84aba274b2e6316331de8e3fca796', false),
      ('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)',
       '4a6da8bed8d1fdda17f11df00d549817', true),
      ('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
       'f83873aa19703d2c61553026d4141a4c', true),
      ('public.claim_phase1c_run_v3(text,text,text,integer,integer)',
       'ef8803cb5ec809266b8fdf6f048b1a2f', true),
      ('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)',
       '14c204c6c9d8da1ed6038d0f56942be8', true)
    ) expected(signature, source_md5, service_role_execute)
  loop
    v_routine := pg_catalog.to_regprocedure(v_expected.signature);
    if v_routine is null or not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = v_routine
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
           = v_expected.service_role_execute
    ) then
      raise exception using errcode = '55000',
        message = 'Grok protocol-v3 claim source or authority drifted: ' || v_expected.signature;
    end if;
  end loop;
end;
$grok_claim_context_preflight$;

create function public.grok_initial_context_claim_projection(
  p_graph_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph public.graphs;
  v_launch public.grok_graph_launches;
  v_session public.grok_sessions;
  v_plan_message public.grok_messages;
  v_user_message public.grok_messages;
  v_envelope public.grok_context_envelopes;
  v_item_count integer;
  v_total_bytes bigint;
  v_input_items jsonb;
  v_projection_items jsonb;
  v_input_sha256 text;
begin
  if p_graph_id is null then
    raise exception using errcode = '22023',
      message = 'an exact Grok graph id is required for context projection';
  end if;

  select graph.* into v_graph
    from public.graphs graph
   where graph.id = p_graph_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Grok context graph not found';
  end if;

  select launch.* into v_launch
    from public.grok_graph_launches launch
   where launch.graph_id = v_graph.id
     and launch.organization_id = v_graph.organization_id
     and launch.project_id = v_graph.project_id;
  if not found or v_launch.message_id is null then
    raise exception using errcode = '55000',
      message = 'Grok context launch identity is incomplete';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = v_launch.session_id
     and session.organization_id = v_launch.organization_id
     and session.project_id = v_launch.project_id
     and session.created_by = v_launch.created_by;
  if not found then
    raise exception using errcode = '55000',
      message = 'Grok context tenant, project, or session identity changed';
  end if;

  select message.* into v_plan_message
    from public.grok_messages message
   where message.id = v_launch.message_id
     and message.organization_id = v_launch.organization_id
     and message.project_id = v_launch.project_id
     and message.session_id = v_launch.session_id
     and message.sequence_no = 2
     and message.role = 'assistant'
     and message.actor_user_id is null
     and message.reply_to_message_id is not null
     and message.metadata ->> 'kind' = 'grok.plan';
  if not found then
    raise exception using errcode = '55000',
      message = 'Grok context plan message identity changed';
  end if;

  select message.* into v_user_message
    from public.grok_messages message
   where message.id = v_plan_message.reply_to_message_id
     and message.organization_id = v_launch.organization_id
     and message.project_id = v_launch.project_id
     and message.session_id = v_launch.session_id
     and message.sequence_no = 1
     and message.role = 'user'
     and message.actor_user_id = v_launch.created_by;
  if not found then
    raise exception using errcode = '55000',
      message = 'Grok initial user message identity changed';
  end if;

  select envelope.* into v_envelope
    from public.grok_context_envelopes envelope
   where envelope.organization_id = v_launch.organization_id
     and envelope.project_id = v_launch.project_id
     and envelope.session_id = v_launch.session_id
     and envelope.message_id = v_user_message.id
     and envelope.created_by = v_launch.created_by
     and not envelope.replan_required;
  if not found then
    raise exception using errcode = '55000',
      message = 'Grok immutable initial context envelope is missing';
  end if;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(item.byte_size), 0),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind', item.kind,
      'label', item.label,
      'media_type', item.media_type,
      'source_url', item.source_url,
      'repository_path', item.repository_path,
      'integration_id', item.integration_id,
      'content_text', item.content_text,
      'byte_size', item.byte_size,
      'state', item.state
    ) order by item.ordinal), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'ordinal', item.ordinal,
      'kind', item.kind,
      'label', item.label,
      'state', item.state,
      'media_type', item.media_type,
      'source_url', item.source_url,
      'repository_path', item.repository_path,
      'integration_id', item.integration_id,
      'content_text', item.content_text,
      'content_sha256', item.content_sha256,
      'byte_size', item.byte_size
    ) order by item.ordinal), '[]'::jsonb)
    into v_item_count, v_total_bytes, v_input_items, v_projection_items
    from public.grok_context_items item
   where item.envelope_id = v_envelope.id
     and item.organization_id = v_envelope.organization_id
     and item.project_id = v_envelope.project_id
     and item.session_id = v_envelope.session_id
     and item.message_id = v_envelope.message_id;

  if v_item_count not between 2 and 12
      or v_item_count is distinct from v_envelope.item_count
      or v_total_bytes not between 0 and 49152
      or v_total_bytes is distinct from v_envelope.total_bytes
      or exists (
        select 1
          from public.grok_context_items item
         where item.envelope_id = v_envelope.id
           and (
             item.organization_id is distinct from v_envelope.organization_id
             or item.project_id is distinct from v_envelope.project_id
             or item.session_id is distinct from v_envelope.session_id
             or item.message_id is distinct from v_envelope.message_id
             or item.ordinal not between 1 and v_item_count
             or item.label is distinct from pg_catalog.btrim(item.label)
             or pg_catalog.char_length(item.label) not between 1 and 160
             or item.label ~ '[[:cntrl:]]'
             or public.text_has_likely_secret(
               item.label || E'\n' || coalesce(item.source_url, '') || E'\n'
               || coalesce(item.repository_path, '') || E'\n'
               || coalesce(item.content_text, '')
             )
             or not coalesce((
               case item.kind
                 when 'file' then
                   item.state = 'captured'
                   and item.media_type in (
                     'text/plain', 'text/markdown', 'application/json',
                     'application/yaml', 'application/x-yaml', 'text/csv'
                   )
                   and item.source_url is null
                   and item.repository_path is null
                   and item.integration_id is null
                   and item.content_text is not null
                 when 'image' then
                   item.state = 'reference_only'
                   and public.project_production_url_is_safe(item.source_url)
                   and (item.media_type is null
                     or item.media_type ~ '^image/[a-z0-9.+-]{1,80}$')
                   and item.repository_path is null
                   and item.integration_id is null
                   and item.content_text is null
                 when 'url' then
                   item.state = 'reference_only'
                   and public.project_production_url_is_safe(item.source_url)
                   and item.media_type is null
                   and item.repository_path is null
                   and item.integration_id is null
                   and item.content_text is null
                 when 'repository' then
                   item.state = 'reference_only'
                   and item.source_url is null
                   and item.media_type is null
                   and item.repository_path is not null
                   and pg_catalog.char_length(item.repository_path) between 1 and 300
                   and item.repository_path !~ '(^/|[\\]|(^|/)\.\.?(/|$)|[[:cntrl:]])'
                   and item.integration_id is null
                   and item.content_text is null
                 when 'project' then
                   item.state = 'reference_only'
                   and (item.source_url is null
                     or public.project_production_url_is_safe(item.source_url))
                   and item.media_type is null
                   and item.repository_path is null
                   and item.integration_id is null
                   and item.content_text is null
                 when 'integration' then
                   item.state = 'reference_only'
                   and item.source_url is null
                   and item.media_type is null
                   and item.repository_path is null
                   and item.integration_id is not null
                   and item.content_text is null
                 else false
               end
             ), false)
             or (item.content_text is not null and (
               item.byte_size is distinct from pg_catalog.octet_length(item.content_text)
               or item.content_sha256 is distinct from pg_catalog.encode(
                 pg_catalog.sha256(pg_catalog.convert_to(item.content_text, 'UTF8')), 'hex'
               )
             ))
             or (item.content_text is null and (
               item.byte_size is distinct from 0 or item.content_sha256 is not null
             ))
           )
      )
      or v_item_count is distinct from (
        select pg_catalog.count(distinct item.ordinal)::integer
          from public.grok_context_items item
         where item.envelope_id = v_envelope.id
      )
      or 1 is distinct from (
        select pg_catalog.min(item.ordinal)
          from public.grok_context_items item
         where item.envelope_id = v_envelope.id
      )
      or v_item_count is distinct from (
        select pg_catalog.max(item.ordinal)
          from public.grok_context_items item
         where item.envelope_id = v_envelope.id
      )
  then
    raise exception using errcode = '55000',
      message = 'Grok initial context item evidence changed';
  end if;

  v_input_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'items', v_input_items,
      'replanRequired', false
    )::text,
    'UTF8'
  )), 'hex');
  if v_envelope.input_sha256 is distinct from v_input_sha256 then
    raise exception using errcode = '55000',
      message = 'Grok initial context envelope digest changed';
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'envelope_id', v_envelope.id,
    'input_sha256', v_envelope.input_sha256,
    'session_id', v_envelope.session_id,
    'message_id', v_envelope.message_id,
    'item_count', v_envelope.item_count,
    'total_bytes', v_envelope.total_bytes,
    'items', v_projection_items
  );
end;
$function$;

revoke all on function public.grok_initial_context_claim_projection(uuid)
  from public, anon, authenticated, service_role;
comment on function public.grok_initial_context_claim_projection(uuid) is
  'Private, bounded, secret-rechecked projection of only the immutable initial Grok context envelope. Reference-only items are never fetched.';

create or replace function public.attach_current_grok_admissions_to_claim(
  p_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph_id uuid;
  v_nodes jsonb;
  v_context jsonb;
begin
  if p_claim is null then return null; end if;
  if coalesce(p_claim ->> 'graph_id', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(p_claim -> 'nodes') <> 'array'
  then
    raise exception using errcode = '55000', message = 'graph claim admission projection is invalid';
  end if;
  v_graph_id := (p_claim ->> 'graph_id')::uuid;
  if not public.assert_current_grok_execution_admissions(v_graph_id) then
    return p_claim || pg_catalog.jsonb_build_object('grok_admission_required', false);
  end if;
  v_context := public.grok_initial_context_claim_projection(v_graph_id);

  select coalesce(pg_catalog.jsonb_agg(
    case when admission.id is null then node.value else
      node.value || pg_catalog.jsonb_build_object(
        'execution_admission', public.grok_execution_admission_projection(admission)
      )
    end order by node.ordinality
  ), '[]'::jsonb)
    into v_nodes
    from pg_catalog.jsonb_array_elements(p_claim -> 'nodes')
      with ordinality node(value, ordinality)
    left join public.grok_execution_admissions admission
      on admission.graph_id = v_graph_id
     and admission.graph_node_id = (node.value ->> 'node_id')::uuid;

  return pg_catalog.jsonb_set(p_claim, '{nodes}', v_nodes, false)
    || pg_catalog.jsonb_build_object(
      'grok_admission_required', true,
      'initial_context', v_context
    );
end;
$function$;

revoke all on function public.attach_current_grok_admissions_to_claim(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.attach_current_grok_admission_to_phase1c_claim(
  p_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_bridge public.graph_phase1c_bridges;
  v_admission public.grok_execution_admissions;
  v_grok_admission_required boolean;
  v_context jsonb;
begin
  if p_claim is null then return null; end if;
  select bridge.* into v_bridge
    from public.graph_phase1c_bridges bridge
   where bridge.command_id = (p_claim ->> 'command_id')::uuid
     and bridge.organization_id = (p_claim ->> 'organization_id')::uuid;
  if not found then return p_claim; end if;

  v_grok_admission_required := public.assert_current_grok_execution_admissions(v_bridge.graph_id);
  if not v_grok_admission_required then
    return p_claim;
  end if;
  select admission.* into v_admission
    from public.grok_execution_admissions admission
   where admission.graph_id = v_bridge.graph_id
     and admission.organization_id = v_bridge.organization_id
     and admission.graph_node_id = v_bridge.implementation_node_id
     and admission.lane = 'phase1c';
  if not found
      or v_bridge.task_id is distinct from (p_claim ->> 'task_id')::uuid
      or v_admission.provider::text is distinct from p_claim ->> 'provider'
      or v_admission.model is distinct from p_claim ->> 'model'
  then
    raise exception using errcode = '55000',
      message = 'Phase 1C claim does not match its current Grok admission';
  end if;
  v_context := public.grok_initial_context_claim_projection(v_bridge.graph_id);
  return p_claim || pg_catalog.jsonb_build_object(
    'execution_admission', public.grok_execution_admission_projection(v_admission),
    'initial_context', v_context
  );
end;
$function$;

revoke all on function public.attach_current_grok_admission_to_phase1c_claim(jsonb)
  from public, anon, authenticated, service_role;

do $grok_claim_context_postflight$
declare
  v_projection regprocedure := pg_catalog.to_regprocedure(
    'public.grok_initial_context_claim_projection(uuid)'
  );
  v_graph_attach regprocedure := pg_catalog.to_regprocedure(
    'public.attach_current_grok_admissions_to_claim(jsonb)'
  );
  v_phase_attach regprocedure := pg_catalog.to_regprocedure(
    'public.attach_current_grok_admission_to_phase1c_claim(jsonb)'
  );
  v_expected record;
  v_routine oid;
  v_wrapper regprocedure;
begin
  if v_projection is null or v_graph_attach is null or v_phase_attach is null then
    raise exception using errcode = '55000',
      message = 'Grok claim context function identity postflight failed';
  end if;

  for v_expected in
    select * from (values
      ('public.grok_initial_context_claim_projection(uuid)',
       '06c7fb24b7c4b50bbf80aee57385ff57'),
      ('public.attach_current_grok_admissions_to_claim(jsonb)',
       'c1075dafaa5bc957d16ff2599382a811'),
      ('public.attach_current_grok_admission_to_phase1c_claim(jsonb)',
       '2562fa378097239ce4a3e47e9121d410'),
      ('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)',
       '4a6da8bed8d1fdda17f11df00d549817'),
      ('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
       'f83873aa19703d2c61553026d4141a4c'),
      ('public.claim_phase1c_run_v3(text,text,text,integer,integer)',
       'ef8803cb5ec809266b8fdf6f048b1a2f'),
      ('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)',
       '14c204c6c9d8da1ed6038d0f56942be8')
    ) expected(signature, source_md5)
  loop
    v_routine := pg_catalog.to_regprocedure(v_expected.signature);
    if v_routine is null or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = v_routine
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
    ) then
      raise exception using errcode = '55000',
        message = 'Grok claim context source identity postflight failed: ' || v_expected.signature;
    end if;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid in (v_projection::oid, v_graph_attach::oid, v_phase_attach::oid)
       and (
         not routine.prosecdef
         or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
         or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
         or pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
       )
  ) then
    raise exception using errcode = '55000',
      message = 'Grok claim context function authority postflight failed';
  end if;

  foreach v_wrapper in array array[
    pg_catalog.to_regprocedure('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)'),
    pg_catalog.to_regprocedure('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)'),
    pg_catalog.to_regprocedure('public.claim_phase1c_run_v3(text,text,text,integer,integer)'),
    pg_catalog.to_regprocedure('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)')
  ] loop
    if v_wrapper is null or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = v_wrapper::oid
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
    ) then
      raise exception using errcode = '55000',
        message = 'Grok protocol-v3 wrapper authority postflight failed';
    end if;
  end loop;

  if 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and relation.relkind = 'r'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or exists (
    select 1
      from information_schema.role_table_grants privilege
     where privilege.table_schema = 'public'
       and privilege.table_name in ('grok_context_envelopes', 'grok_context_items')
       and privilege.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) or 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and (
         (relation.relname = 'grok_context_envelopes'
           and policy.polname = 'grok_context_envelopes_select_member')
         or (relation.relname = 'grok_context_items'
           and policy.polname = 'grok_context_items_select_member')
       )
       and policy.polcmd = 'r'
       and policy.polroles = array[
         (select role.oid from pg_catalog.pg_roles role where role.rolname = 'authenticated')
       ]
       and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
         like '%is_organization_member(organization_id)%'
  ) or 4 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_trigger trigger
      join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and trigger.tgname in (
         'grok_context_envelopes_immutable', 'grok_context_envelopes_no_truncate',
         'grok_context_items_immutable', 'grok_context_items_no_truncate'
       )
       and not trigger.tgisinternal
       and trigger.tgfoid = pg_catalog.to_regprocedure(
         'public.reject_grok_evidence_mutation()'
       )
  ) then
    raise exception using errcode = '55000',
      message = 'Grok claim context evidence postflight failed';
  end if;
end;
$grok_claim_context_postflight$;
