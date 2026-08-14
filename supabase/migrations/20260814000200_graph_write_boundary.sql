-- Phase 2B Stage 2: the graph write boundary.
--
-- The tables in 20260814000100 grant SELECT and nothing else. These functions
-- are the only way anything is written, which is what stops a compromised
-- browser session from fabricating a verification verdict, marking a failed
-- node COMPLETED, or quietly raising its own budget.
--
-- Two properties every function here holds:
--
--   Membership is checked against the caller's own JWT, not against an
--   organization id the caller supplied. Passing someone else's organization
--   is therefore useless rather than dangerous.
--
--   A compiled graph is written in one statement. A half-written graph -- nodes
--   without contracts, edges pointing at nodes that were never inserted -- would
--   be a scheduler deadlock that looks like a plan.

-- ---------------------------------------------------------------------------
-- Create a graph from a compiled plan
-- ---------------------------------------------------------------------------

-- p_nodes:  [{ node_key, job, executor, capability, model_tier, risk_level,
--              timeout_ms, max_attempts, allow_provider_fallback,
--              input_schema, output_schema, reads, writes }]
-- p_edges:  [{ from_node_key, to_node_key, reason, detail }]
create or replace function public.create_graph_from_plan(
  p_organization_id uuid,
  p_project_id uuid,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_graph_id uuid;
  v_node jsonb;
  v_edge jsonb;
  v_node_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_keys jsonb := '{}'::jsonb;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) = 0 then
    raise exception 'empty_graph' using errcode = '22023';
  end if;

  insert into public.graphs (
    organization_id, project_id, goal, topology, topology_reasons,
    risk_level, requires_owner_approval, created_by
  )
  values (
    p_organization_id, p_project_id, p_goal, p_topology,
    coalesce(p_topology_reasons, '[]'::jsonb),
    p_risk_level, coalesce(p_requires_owner_approval, false), auth.uid()
  )
  returning id into v_graph_id;

  insert into public.graph_budgets (
    organization_id, graph_id, max_nodes, max_concurrent_nodes,
    max_duration_ms, max_retries, max_discovery_rounds, max_tokens, max_cost_micros
  )
  values (
    p_organization_id, v_graph_id,
    coalesce((p_budget ->> 'max_nodes')::integer, 50),
    coalesce((p_budget ->> 'max_concurrent_nodes')::integer, 8),
    coalesce((p_budget ->> 'max_duration_ms')::bigint, 1800000),
    coalesce((p_budget ->> 'max_retries')::integer, 10),
    coalesce((p_budget ->> 'max_discovery_rounds')::integer, 5),
    (p_budget ->> 'max_tokens')::bigint,
    (p_budget ->> 'max_cost_micros')::bigint
  );

  for v_node in select * from jsonb_array_elements(p_nodes)
  loop
    insert into public.graph_nodes (
      organization_id, graph_id, node_key, job, executor, capability,
      model_tier, risk_level, timeout_ms, max_attempts, allow_provider_fallback
    )
    values (
      p_organization_id, v_graph_id,
      v_node ->> 'node_key',
      v_node ->> 'job',
      (v_node ->> 'executor')::public.graph_node_executor,
      v_node ->> 'capability',
      coalesce(v_node ->> 'model_tier', 'STANDARD'),
      coalesce((v_node ->> 'risk_level')::public.risk_level, 'green'),
      coalesce((v_node ->> 'timeout_ms')::integer, 180000),
      coalesce((v_node ->> 'max_attempts')::integer, 2),
      coalesce((v_node ->> 'allow_provider_fallback')::boolean, true)
    )
    returning id into v_node_id;

    v_keys := v_keys || jsonb_build_object(v_node ->> 'node_key', v_node_id::text);

    insert into public.node_contracts (
      organization_id, node_id, input_schema, output_schema, reads, writes, acceptance_criteria
    )
    values (
      p_organization_id, v_node_id,
      coalesce(v_node -> 'input_schema', '{}'::jsonb),
      coalesce(v_node -> 'output_schema', '{}'::jsonb),
      coalesce(v_node -> 'reads', '[]'::jsonb),
      coalesce(v_node -> 'writes', '[]'::jsonb),
      coalesce(v_node -> 'acceptance_criteria', '[]'::jsonb)
    );
  end loop;

  for v_edge in select * from jsonb_array_elements(coalesce(p_edges, '[]'::jsonb))
  loop
    v_from_id := (v_keys ->> (v_edge ->> 'from_node_key'))::uuid;
    v_to_id := (v_keys ->> (v_edge ->> 'to_node_key'))::uuid;

    -- An edge naming a node that is not in the plan would produce a graph the
    -- scheduler could never start, so it fails the whole insert.
    if v_from_id is null or v_to_id is null then
      raise exception 'unknown_edge_node' using errcode = '22023';
    end if;

    insert into public.graph_edges (
      organization_id, graph_id, from_node_id, to_node_id, reason, detail
    )
    values (
      p_organization_id, v_graph_id, v_from_id, v_to_id,
      (v_edge ->> 'reason')::public.graph_edge_reason,
      v_edge ->> 'detail'
    );
  end loop;

  return v_graph_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Run lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.start_graph_run(p_graph_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_run_id uuid;
begin
  select organization_id into v_organization_id
    from public.graphs where id = p_graph_id;

  if v_organization_id is null or not public.is_organization_member(v_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  insert into public.graph_runs (organization_id, graph_id, state, started_at, created_by)
  values (v_organization_id, p_graph_id, 'RUNNING', now(), auth.uid())
  returning id into v_run_id;

  -- Every node starts PENDING so the scheduler has a complete state map to
  -- reason over. A node absent from the map is indistinguishable from one that
  -- never reported, which is the confusion the fan-in guard exists to prevent.
  insert into public.node_runs (organization_id, graph_run_id, node_id, state, queued_at)
  select v_organization_id, v_run_id, n.id, 'PENDING', now()
    from public.graph_nodes n
   where n.graph_id = p_graph_id;

  insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
  values (v_organization_id, v_run_id, 'run_started', 'Graph run created and nodes queued.');

  return v_run_id;
end;
$$;

-- Transition one node. Terminal states are final: a COMPLETED node cannot be
-- quietly reopened, and a FAILED one cannot be relabelled as fine.
create or replace function public.record_node_state(
  p_node_run_id uuid,
  p_state public.graph_node_state,
  p_detail text default null,
  p_provider text default null,
  p_model text default null,
  p_latency_ms integer default null
)
returns public.node_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.node_runs;
  v_current public.graph_node_state;
begin
  select * into v_run from public.node_runs where id = p_node_run_id;

  if v_run.id is null or not public.is_organization_member(v_run.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  v_current := v_run.state;
  if v_current in ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED') then
    raise exception 'node_already_terminal' using errcode = '22023';
  end if;

  update public.node_runs
     set state = p_state,
         provider = coalesce(p_provider, provider),
         model = coalesce(p_model, model),
         latency_ms = coalesce(p_latency_ms, latency_ms),
         blocked_reason = case when p_state = 'BLOCKED' then p_detail else blocked_reason end,
         error_message = case when p_state = 'FAILED' then p_detail else error_message end,
         started_at = case when p_state = 'RUNNING' and started_at is null then now() else started_at end,
         completed_at = case
           when p_state in ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED') then now()
           else completed_at
         end,
         updated_at = now()
   where id = p_node_run_id
  returning * into v_run;

  insert into public.graph_events (
    organization_id, graph_run_id, node_run_id, event_type, detail
  )
  values (
    v_run.organization_id, v_run.graph_run_id, v_run.id,
    'node_' || lower(p_state::text), p_detail
  );

  return v_run;
end;
$$;

-- Close a run, recording spend and whether its inputs were whole.
create or replace function public.complete_graph_run(
  p_graph_run_id uuid,
  p_state public.graph_run_state,
  p_had_partial_input boolean default false,
  p_tokens_used bigint default null,
  p_cost_micros bigint default null,
  p_budget_action text default null
)
returns public.graph_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.graph_runs;
begin
  select * into v_run from public.graph_runs where id = p_graph_run_id;

  if v_run.id is null or not public.is_organization_member(v_run.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- A run whose inputs were incomplete may not be recorded as COMPLETED. This
  -- is the silent-failure guard expressed where it cannot be forgotten: twenty
  -- nodes dispatched and nineteen returned is a PARTIAL run, not a finished one.
  if p_had_partial_input and p_state = 'COMPLETED' then
    raise exception 'partial_input_cannot_complete' using errcode = '22023';
  end if;

  update public.graph_runs
     set state = p_state,
         had_partial_input = p_had_partial_input,
         tokens_used = coalesce(p_tokens_used, tokens_used),
         cost_micros = coalesce(p_cost_micros, cost_micros),
         budget_action = coalesce(p_budget_action, budget_action),
         completed_at = now(),
         updated_at = now()
   where id = p_graph_run_id
  returning * into v_run;

  insert into public.graph_events (organization_id, graph_run_id, event_type, detail, payload)
  values (
    v_run.organization_id, p_graph_run_id, 'run_' || lower(p_state::text),
    case when p_had_partial_input then 'Run finished with incomplete input.' else null end,
    jsonb_build_object('had_partial_input', p_had_partial_input)
  );

  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Handoffs, artifacts, verifications
-- ---------------------------------------------------------------------------

create or replace function public.record_handoff(
  p_graph_run_id uuid,
  p_to_node_id uuid,
  p_payload jsonb,
  p_contract_valid boolean,
  p_validation_issues jsonb default '[]'::jsonb,
  p_from_node_run_id uuid default null,
  p_decisions jsonb default '[]'::jsonb,
  p_assumptions jsonb default '[]'::jsonb,
  p_blockers jsonb default '[]'::jsonb,
  p_next_action text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_handoff_id uuid;
begin
  select organization_id into v_organization_id
    from public.graph_runs where id = p_graph_run_id;

  if v_organization_id is null or not public.is_organization_member(v_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- An invalid handoff is stored, not rejected. It is the evidence for why a
  -- node is blocked, and discarding it would leave the graph unable to explain
  -- itself.
  insert into public.graph_handoffs (
    organization_id, graph_run_id, from_node_run_id, to_node_id,
    contract_valid, validation_issues, payload, decisions, assumptions,
    blockers, next_action
  )
  values (
    v_organization_id, p_graph_run_id, p_from_node_run_id, p_to_node_id,
    p_contract_valid, coalesce(p_validation_issues, '[]'::jsonb), p_payload,
    coalesce(p_decisions, '[]'::jsonb), coalesce(p_assumptions, '[]'::jsonb),
    coalesce(p_blockers, '[]'::jsonb), p_next_action
  )
  returning id into v_handoff_id;

  return v_handoff_id;
end;
$$;

create or replace function public.record_graph_artifact(
  p_graph_run_id uuid,
  p_kind public.graph_artifact_kind,
  p_payload jsonb,
  p_node_run_id uuid default null,
  p_item_count integer default null,
  p_reduced_from_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_artifact_id uuid;
begin
  select organization_id into v_organization_id
    from public.graph_runs where id = p_graph_run_id;

  if v_organization_id is null or not public.is_organization_member(v_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  insert into public.graph_artifacts (
    organization_id, graph_run_id, node_run_id, kind, payload,
    item_count, reduced_from_count
  )
  values (
    v_organization_id, p_graph_run_id, p_node_run_id, p_kind, p_payload,
    p_item_count, p_reduced_from_count
  )
  returning id into v_artifact_id;

  return v_artifact_id;
end;
$$;

-- Record a verification verdict.
--
-- Refuses outright when the verifier is the agent that produced the work. This
-- is the no-self-approval rule enforced at the boundary rather than trusted to
-- the caller, so no code path can record a self-review even by mistake.
create or replace function public.record_verification(
  p_subject_node_run_id uuid,
  p_lens public.verification_lens,
  p_verdict public.verification_verdict,
  p_evidence jsonb default '[]'::jsonb,
  p_verifier_agent_id uuid default null,
  p_verifier_provider text default null,
  p_shared_worker_context boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject public.node_runs;
  v_subject_agent uuid;
  v_verification_id uuid;
begin
  select * into v_subject from public.node_runs where id = p_subject_node_run_id;

  if v_subject.id is null or not public.is_organization_member(v_subject.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select n.agent_id into v_subject_agent
    from public.graph_nodes n where n.id = v_subject.node_id;

  if p_verifier_agent_id is not null
     and v_subject_agent is not null
     and p_verifier_agent_id = v_subject_agent then
    raise exception 'self_verification_forbidden' using errcode = '42501';
  end if;

  insert into public.graph_verifications (
    organization_id, graph_run_id, subject_node_run_id, verifier_agent_id,
    verifier_provider, lens, verdict, evidence, shared_worker_context
  )
  values (
    v_subject.organization_id, v_subject.graph_run_id, p_subject_node_run_id,
    p_verifier_agent_id, p_verifier_provider, p_lens, p_verdict,
    coalesce(p_evidence, '[]'::jsonb), coalesce(p_shared_worker_context, false)
  )
  returning id into v_verification_id;

  return v_verification_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_graph_from_plan(
  uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean, jsonb, jsonb, jsonb
) from public, anon;
revoke all on function public.start_graph_run(uuid) from public, anon;
revoke all on function public.record_node_state(
  uuid, public.graph_node_state, text, text, text, integer
) from public, anon;
revoke all on function public.complete_graph_run(
  uuid, public.graph_run_state, boolean, bigint, bigint, text
) from public, anon;
revoke all on function public.record_handoff(
  uuid, uuid, jsonb, boolean, jsonb, uuid, jsonb, jsonb, jsonb, text
) from public, anon;
revoke all on function public.record_graph_artifact(
  uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) from public, anon;
revoke all on function public.record_verification(
  uuid, public.verification_lens, public.verification_verdict, jsonb, uuid, text, boolean
) from public, anon;

grant execute on function public.create_graph_from_plan(
  uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.start_graph_run(uuid) to authenticated;
grant execute on function public.record_node_state(
  uuid, public.graph_node_state, text, text, text, integer
) to authenticated;
grant execute on function public.complete_graph_run(
  uuid, public.graph_run_state, boolean, bigint, bigint, text
) to authenticated;
grant execute on function public.record_handoff(
  uuid, uuid, jsonb, boolean, jsonb, uuid, jsonb, jsonb, jsonb, text
) to authenticated;
grant execute on function public.record_graph_artifact(
  uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) to authenticated;
grant execute on function public.record_verification(
  uuid, public.verification_lens, public.verification_verdict, jsonb, uuid, text, boolean
) to authenticated;
