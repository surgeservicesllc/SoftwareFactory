-- Atomic owner-scoped Grok graph control.
--
-- The session row is the serialization lock. Intent creation/replay,
-- control.requested ordering, graph mutation, intent resolution, and the
-- immutable control.applied event all commit or roll back together. Worker
-- dispatch remains a guarded post-commit operation in the application route.

create function public.apply_grok_graph_control_as_owner(
  p_organization_id uuid,
  p_session_id uuid,
  p_graph_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text
)
returns table (
  intent_id uuid,
  organization_id uuid,
  project_id uuid,
  session_id uuid,
  graph_id uuid,
  action text,
  state text,
  idempotency_key text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_session public.grok_sessions;
  v_graph public.graphs;
  v_intent public.grok_control_intents;
  v_replayed boolean := false;
  v_request_event_count bigint;
  v_request_sequence bigint;
  v_state_reflects_action boolean;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501', message = 'organization owner access is required';
  end if;
  if p_graph_id is null
      or p_action not in ('pause', 'resume', 'withdraw')
      or p_idempotency_key is null
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception using errcode = '22023', message = 'invalid grok graph control input';
  end if;

  select session.*
    into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  -- A session-scoped owner control may act only on the exact graph durably
  -- launched from that Grok session. Project membership alone is insufficient.
  if not exists (
    select 1
      from public.grok_graph_launches launch
     where launch.organization_id = p_organization_id
       and launch.project_id = v_session.project_id
       and launch.session_id = p_session_id
       and launch.graph_id = p_graph_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_control_target_not_found';
  end if;

  select intent.*
    into v_intent
    from public.grok_control_intents intent
   where intent.organization_id = p_organization_id
     and intent.session_id = p_session_id
     and intent.idempotency_key = p_idempotency_key;
  v_replayed := found;

  -- The existing request function owns exact-input replay validation and the
  -- append-only control.requested event. The session lock above makes its
  -- nested lock re-entrant and serializes every competing control request.
  select requested.*
    into v_intent
    from public.request_grok_control_intent(
      p_organization_id,
      p_session_id,
      'graph',
      p_graph_id,
      p_action,
      p_reason,
      p_idempotency_key
    ) requested;

  select pg_catalog.count(*), pg_catalog.min(event.sequence_no)
    into v_request_event_count, v_request_sequence
    from public.grok_events event
   where event.organization_id = p_organization_id
     and event.session_id = p_session_id
     and event.event_type = 'control.requested'
     and event.correlation_id = v_intent.id;
  if v_request_event_count <> 1 or v_request_sequence is null then
    raise exception using errcode = '55000', message = 'grok_control_ordering_evidence_invalid';
  end if;

  if exists (
    select 1
      from public.grok_events later_event
      join public.grok_control_intents later_intent
        on later_intent.id = later_event.correlation_id
       and later_intent.organization_id = later_event.organization_id
       and later_intent.session_id = later_event.session_id
     where later_event.organization_id = p_organization_id
       and later_event.session_id = p_session_id
       and later_event.event_type = 'control.requested'
       and later_event.sequence_no > v_request_sequence
       and later_intent.target_kind = 'graph'
       and later_intent.graph_id = p_graph_id
  ) then
    raise exception using errcode = '55000', message = 'grok_control_superseded';
  end if;

  select graph.*
    into v_graph
    from public.graphs graph
   where graph.id = p_graph_id
     and graph.organization_id = p_organization_id
     and graph.project_id = v_session.project_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_control_target_not_found';
  end if;

  v_state_reflects_action := case p_action
    when 'pause' then v_graph.pause_requested_at is not null and v_graph.withdrawn_at is null
    when 'resume' then v_graph.pause_requested_at is null and v_graph.withdrawn_at is null
    when 'withdraw' then v_graph.withdrawn_at is not null
    else false
  end;

  -- Applied replay is valid only while the durable graph state still reflects
  -- that exact action. A later generic graph control has superseded the key.
  if v_intent.state = 'applied' then
    if not v_state_reflects_action then
      raise exception using errcode = '55000', message = 'grok_control_superseded';
    end if;
    return query select
      v_intent.id, v_intent.organization_id, v_intent.project_id,
      v_intent.session_id, v_intent.graph_id, v_intent.action, v_intent.state,
      v_intent.idempotency_key, true;
    return;
  end if;
  if v_intent.state <> 'requested' then
    raise exception using errcode = '55000', message = 'grok_control_not_requested';
  end if;

  -- Requested replay recovery is resolution-only. It is safe only when the
  -- action already committed and durable graph state still proves that fact.
  if v_replayed then
    if not v_state_reflects_action then
      raise exception using errcode = '55000', message = 'grok_control_recovery_ambiguous';
    end if;
  else
    if v_graph.withdrawn_at is not null
        or (p_action = 'pause' and v_graph.pause_requested_at is not null)
        or (p_action = 'resume' and v_graph.pause_requested_at is null) then
      raise exception using errcode = '55000', message = 'grok_control_not_available';
    end if;

    if p_action = 'pause' then
      perform public.set_graph_pause_as_member(p_organization_id, p_graph_id, true);
    elsif p_action = 'resume' then
      perform public.set_graph_pause_as_member(p_organization_id, p_graph_id, false);
    else
      perform public.withdraw_graph_as_member(p_organization_id, p_graph_id, p_reason);
    end if;
  end if;

  select resolved.*
    into v_intent
    from public.resolve_grok_control_intent_as_server(
      p_organization_id,
      v_intent.id,
      'applied',
      null,
      null
    ) resolved;

  return query select
    v_intent.id, v_intent.organization_id, v_intent.project_id,
    v_intent.session_id, v_intent.graph_id, v_intent.action, v_intent.state,
    v_intent.idempotency_key, v_replayed;
end;
$function$;

revoke all on function public.apply_grok_graph_control_as_owner(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_grok_graph_control_as_owner(
  uuid, uuid, uuid, text, text, text
) to authenticated;
