-- ---------------------------------------------------------------------------
-- Anchored automatic gates decide themselves
-- ---------------------------------------------------------------------------
--
-- The first live lifecycle run (graph 91959362, run 6ac300ae) exposed the
-- deadlock 20260821000200 shipped: an AUTOMATIC gate exists so a stage can
-- advance on evidence rather than on a person, but nothing in the system ever
-- decides one. `decide_node_gate` (correctly) refuses automatic approval with
-- zero anchors, no worker path decides a gate at all, and the claim's
-- gate-reopen rule requires a decision newer than the run's close. The result:
-- every lifecycle halted at its first automatic gate forever, and the five
-- PARTIAL agentic_sdlc graphs in the queue diagnosis all died exactly there.
--
-- The rule stands untouched: approval without anchored evidence remains
-- impossible for every caller, this function included. What this adds is the
-- missing decider for the one case the rule always intended to allow — a gate
-- whose node IS an anchor, holding the observation it just recorded. The
-- worker calls this after the run has closed, so `decided_at` lands after
-- `completed_at` and the reopen rule sees the answer.
--
-- A HUMAN gate is refused here unconditionally. A worker approving a human
-- gate would be an automated system approving its own guardrail, which
-- policies/AUTO_MERGE_POLICY.md exists to prevent.

create or replace function public.decide_automatic_gate_as_worker(
  p_worker_id text,
  p_node_id uuid
)
returns public.graph_gates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate public.graph_gates;
  v_node public.graph_nodes;
  v_project uuid;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  select * into v_node from public.graph_nodes where id = p_node_id;
  if v_node.id is null then
    raise exception 'node_not_found' using errcode = 'P0002';
  end if;

  select * into v_gate from public.graph_gates where node_id = p_node_id;
  if v_gate.id is null then
    raise exception 'gate_not_found' using errcode = 'P0002';
  end if;

  if v_gate.kind <> 'AUTOMATIC' then
    raise exception using errcode = '42501',
      message = 'a worker may never decide a human gate';
  end if;

  if v_gate.state <> 'OPEN' then
    -- A person may already have answered; their answer outlives this call.
    return v_gate;
  end if;

  if v_gate.anchor_count = 0 then
    raise exception using errcode = '22023',
      message = 'an automatic gate cannot approve without anchored evidence';
  end if;

  update public.graph_gates
     set state = 'APPROVED'::public.gate_state,
         reason = 'Approved on anchored evidence: ' || v_gate.anchor_count
           || ' recorded observation(s) back this stage.',
         decided_at = now(),
         decided_by = null
   where id = v_gate.id
  returning * into v_gate;

  select g.project_id into v_project from public.graphs g where g.id = v_gate.graph_id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  )
  values (
    v_gate.organization_id, v_project, null,
    'lifecycle.gate_approved'::public.activity_event_type,
    'graph_gate', v_gate.id,
    v_gate.stage::text || ' gate approved on anchored evidence',
    jsonb_build_object(
      'kind', v_gate.kind, 'anchor_count', v_gate.anchor_count,
      'decided_by_worker', p_worker_id
    )
  );

  return v_gate;
end;
$$;

revoke all on function public.decide_automatic_gate_as_worker(text, uuid)
  from public, anon, authenticated;
grant execute on function public.decide_automatic_gate_as_worker(text, uuid) to service_role;

-- Postflight: the function must exist with exactly this signature, be a
-- security definer, and be executable by service_role alone among the API
-- roles. A migration that applied halfway would leave the deadlock standing
-- while the ledger claims it fixed.
do $$
declare
  v_oid oid;
  v_secdef boolean;
begin
  select p.oid, p.prosecdef into v_oid, v_secdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'decide_automatic_gate_as_worker'
     and pg_get_function_identity_arguments(p.oid) = 'p_worker_id text, p_node_id uuid';
  if v_oid is null then
    raise exception 'postflight: decide_automatic_gate_as_worker(text, uuid) is missing';
  end if;
  if not v_secdef then
    raise exception 'postflight: decide_automatic_gate_as_worker must be security definer';
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'postflight: service_role cannot execute decide_automatic_gate_as_worker';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'postflight: API roles must not execute decide_automatic_gate_as_worker';
  end if;
end $$;
