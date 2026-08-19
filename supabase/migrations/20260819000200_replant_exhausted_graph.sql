-- Re-plant the owner's exhausted analysis graph, once.
--
-- The first-day readiness graphs the owner planned through the console spent
-- all three of their convergence attempts on infrastructure faults that are
-- now fixed: a worker that could not import its modules (PR #237), a runner
-- without the Claude CLI installed (PR #238), and a provider session limit
-- that burned the remaining attempts in seconds (the capacity-aware worker
-- now stops instead). None of those runs ever executed a node to an answer,
-- yet under the rules of the time each closed FAILED and consumed a chance.
--
-- This migration copies the most recently planned of those exhausted graphs
-- — same goal, nodes, contracts, edges and budget, attributed to the person
-- who planned it — as one fresh, unrun graph the fixed worker can claim.
-- It follows the member planning path's own semantics (`create_graph_from_plan`
-- records no event at plan time; events begin with the run), and it is
-- strictly bounded:
--
--   * The new graph's id is a constant, so replays — including the hosted
--     apply's deliberate re-runs of this file — are no-ops forever.
--   * Exactly one graph is re-planted, ever. Future exhausted graphs retire
--     normally; re-planning them is a person's decision in the console.
--   * The copy keeps requires_owner_approval = false only because the source
--     graph the owner planned had it false; approval-gated graphs are not
--     eligible sources at all.
--
-- If no graph matches (a fresh database, or every run history holds a real
-- answer), this does nothing.

do $$
declare
  -- Constant on purpose: the replay guard. Minted for this migration.
  v_new_graph_id constant uuid := 'ad0e5f2c-9b1d-4e3a-8c47-51b06f7d3e91';
  v_source public.graphs;
  v_node record;
  v_new_node_id uuid;
  v_node_id_map jsonb := '{}'::jsonb;
begin
  if exists (select 1 from public.graphs where id = v_new_graph_id) then
    return;
  end if;

  /*
   * An exhausted graph: it ran, every run FAILED, and it has spent the
   * convergence bound (three or more failed runs), so the claim queue will
   * never offer it again. The most recently planned one is the copy source.
   */
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
      model_tier, agent_id, risk_level, timeout_ms, max_attempts, allow_provider_fallback
    )
    values (
      v_new_node_id, v_node.organization_id, v_new_graph_id, v_node.node_key,
      v_node.job, v_node.executor, v_node.capability, v_node.model_tier,
      v_node.agent_id, v_node.risk_level, v_node.timeout_ms, v_node.max_attempts,
      v_node.allow_provider_fallback
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
