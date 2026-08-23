-- Tolerant fan-in: a synthesis that states incompleteness beats no synthesis.
--
-- Until now a fan-in node lost everything when any one input failed: the
-- scheduler blocked it, the worker closed it SKIPPED, and the surviving
-- branches' work was never brought together. The engine rule the graph goal
-- demands — fan-ins must tolerate missing or failed inputs, stating
-- incompleteness explicitly — needs one durable bit per node: whether this
-- node may run with whatever inputs actually completed.
--
-- Off by default, on purpose. An implementation step genuinely needs its
-- inputs; tolerance is declared where a partial view stated as partial is
-- better than no view — synthesis and reporting. A tolerant node still never
-- runs on nothing: with zero completed inputs it is blocked like any other,
-- because a synthesis with no inputs would be invented, not synthesised.
--
-- The claim projection in 20260819000100 already carries the column; the
-- worker treats its absence as false. Replay-safe: the ALTER is guarded and
-- the function replacement is idempotent, preserving the existing grants
-- (same signature).

alter table public.graph_nodes
  add column if not exists tolerates_partial_inputs boolean not null default false;

-- p_nodes:  [{ node_key, job, executor, capability, model_tier, risk_level,
--              timeout_ms, max_attempts, allow_provider_fallback,
--              tolerates_partial_inputs, input_schema, output_schema,
--              reads, writes }]
-- p_edges:  [{ from_node_key, to_node_key, reason, detail }]
-- Dropped before it is created because the hosted apply workflow replays whole
-- files, and three of them define this function. `create or replace` cannot
-- change an existing function's return type, so the day one of these versions
-- widens the signature, every replay of an older one dies halfway through and
-- leaves the migrations behind it unapplied — apply run 32272188607, exactly.
-- Dropping first makes a replay in any order structurally safe.
--
-- It does NOT make the ORDER harmless, and that is a separate hazard worth
-- naming: whichever replayed file runs last wins the body. Running
-- `scope=broker-functions` after `scope=lifecycle` reinstates the pre-lifecycle
-- body, which ignores lifecycle_stage, gate_kind and is_feedback and would
-- silently plant lifecycle graphs with no gates. Nothing is corrupted by that —
-- the newer body is a strict superset — but `scope=lifecycle` has to be re-run
-- afterwards. AI/HOSTED_APPLY_RUNBOOK.md says so where an owner will read it.
drop function if exists public.create_graph_from_plan(
  uuid, uuid, text, public.graph_topology, jsonb, public.risk_level,
  boolean, jsonb, jsonb, jsonb);

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
      model_tier, risk_level, timeout_ms, max_attempts, allow_provider_fallback,
      tolerates_partial_inputs
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
      coalesce((v_node ->> 'allow_provider_fallback')::boolean, true),
      coalesce((v_node ->> 'tolerates_partial_inputs')::boolean, false)
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

-- Re-granted rather than inherited. `create or replace` preserves a function's
-- grants; the `drop` above does not, and this file no longer uses the former.
-- Without these two statements the console's launch button answers 42501 with
-- no other symptom — the function exists, and `authenticated` may not call it.
revoke all on function public.create_graph_from_plan(
  uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.create_graph_from_plan(
  uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean, jsonb, jsonb, jsonb
) to authenticated;
