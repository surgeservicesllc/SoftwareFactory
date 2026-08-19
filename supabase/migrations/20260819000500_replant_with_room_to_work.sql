-- Re-plant the first-day readiness graph once more, with room to work.
--
-- The first re-plant (20260819000200) was spent by two more infrastructure
-- faults, not by the work: a capacity-refused run (CANCELLED, uncounted), a
-- FAILED run in which every inspector exhausted the worker's old 8-turn
-- ceiling, and finally a PARTIAL run — the first real production node
-- success (run 32228988434: the rollback inspector completed through the
-- CLI) — which is an answer, and answers retire their graph. The owner's
-- planned report still does not exist.
--
-- The worker's turn ceiling is fixed in code (24 turns, measured from that
-- drain), and this copy is planned with the matching execution envelope:
-- MODEL nodes get an eight-minute timeout instead of inheriting the
-- three-minute default that boxed the old ceiling in. Everything else about
-- 20260819000200 holds here: one copy ever (constant id, replays no-op
-- forever), the same exhausted-source criteria, attribution to the person
-- who planned the original, and plan-time semantics identical to
-- `create_graph_from_plan` (no event until a run exists).

do $$
declare
  -- Constant on purpose: the replay guard. Minted for this migration.
  v_new_graph_id constant uuid := 'b7e2a9d4-3c61-4f8e-9a05-2d84c1f6b730';
  v_source public.graphs;
  v_node record;
  v_new_node_id uuid;
  v_node_id_map jsonb := '{}'::jsonb;
begin
  if exists (select 1 from public.graphs where id = v_new_graph_id) then
    return;
  end if;

  select g.* into v_source
    from public.graphs g
   where g.requires_owner_approval = false
     and exists (select 1 from public.graph_runs r where r.graph_id = g.id)
     and not exists (
       select 1 from public.graph_runs r
        where r.graph_id = g.id and r.state <> 'FAILED'
     )
     and (select count(*) from public.graph_runs r where r.graph_id = g.id) >= 3
   order by g.created_at desc
   limit 1;

  if v_source.id is null then
    return;
  end if;

  insert into public.graphs (
    id, organization_id, project_id, template_id, goal, topology,
    topology_reasons, risk_level, requires_owner_approval, created_by
  )
  values (
    v_new_graph_id, v_source.organization_id, v_source.project_id,
    v_source.template_id, v_source.goal, v_source.topology,
    v_source.topology_reasons, v_source.risk_level, false, v_source.created_by
  );

  insert into public.graph_budgets (
    organization_id, graph_id, max_nodes, max_concurrent_nodes,
    max_duration_ms, max_retries, max_discovery_rounds, max_tokens, max_cost_micros
  )
  select b.organization_id, v_new_graph_id, b.max_nodes, b.max_concurrent_nodes,
         b.max_duration_ms, b.max_retries, b.max_discovery_rounds, b.max_tokens, b.max_cost_micros
    from public.graph_budgets b
   where b.graph_id = v_source.id;

  for v_node in
    select * from public.graph_nodes where graph_id = v_source.id
  loop
    v_new_node_id := gen_random_uuid();
    v_node_id_map := v_node_id_map
      || jsonb_build_object(v_node.id::text, v_new_node_id::text);

    insert into public.graph_nodes (
      id, organization_id, graph_id, node_key, job, executor, capability,
      model_tier, agent_id, risk_level, timeout_ms, max_attempts,
      allow_provider_fallback, tolerates_partial_inputs
    )
    values (
      v_new_node_id, v_node.organization_id, v_new_graph_id, v_node.node_key,
      v_node.job, v_node.executor, v_node.capability, v_node.model_tier,
      v_node.agent_id, v_node.risk_level,
      -- The one deliberate difference from the source: a MODEL inspector
      -- gets the measured eight-minute envelope.
      case when v_node.executor = 'MODEL' then 480000 else v_node.timeout_ms end,
      v_node.max_attempts, v_node.allow_provider_fallback,
      v_node.tolerates_partial_inputs
    );

    insert into public.node_contracts (
      organization_id, node_id, input_schema, output_schema, reads, writes, acceptance_criteria
    )
    select c.organization_id, v_new_node_id, c.input_schema, c.output_schema,
           c.reads, c.writes, c.acceptance_criteria
      from public.node_contracts c
     where c.node_id = v_node.id;
  end loop;

  insert into public.graph_edges (
    organization_id, graph_id, from_node_id, to_node_id, reason, detail
  )
  select e.organization_id, v_new_graph_id,
         (v_node_id_map ->> e.from_node_id::text)::uuid,
         (v_node_id_map ->> e.to_node_id::text)::uuid,
         e.reason, e.detail
    from public.graph_edges e
   where e.graph_id = v_source.id;
end;
$$;
