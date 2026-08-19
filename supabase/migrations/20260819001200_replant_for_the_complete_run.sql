-- Re-plant the readiness graph one more time, for the complete run.
--
-- The 17:50Z window's drain (run 32283900970, graph run 4d3f44a7) was the
-- best production evidence yet: ALL FIVE inspectors completed in parallel
-- through the CLI and the deterministic reduce folded their findings — six
-- of seven nodes. The seventh, the report synthesis, was refused capacity:
-- the same fresh window had also just paid for the live canary's five nodes,
-- and the session limit tripped minutes after it opened. The run closed
-- PARTIAL — an answer, which retires its graph — so the owner's planned
-- report exists only as its inputs.
--
-- This copy exists to turn that 6/7 into 7/7 when the window reopens
-- (22:50Z), dispatched alone this time. Same discipline as 20260819000200
-- and 20260819000500: one copy ever (constant id, replays no-op), cloned
-- from the previous copy by its known id rather than by a state search —
-- the source is retired by a PARTIAL, which the exhausted-source criteria
-- of the earlier re-plants deliberately do not match, and widening those
-- criteria would let ordinary retired graphs re-enter the queue silently.
-- Attribution stays with the person who planned the original; no event is
-- created until a run exists, matching create_graph_from_plan.

do $$
declare
  -- Constant on purpose: the replay guard. Minted for this migration.
  v_new_graph_id constant uuid := 'c9d4f1e8-7a52-4b3c-9e16-4f8a2d5c7b91';
  -- The 20260819000500 copy, retired 2026-08-19 by PARTIAL run 4d3f44a7
  -- (6 of 7 succeeded; report refused capacity).
  v_source_graph_id constant uuid := 'b7e2a9d4-3c61-4f8e-9a05-2d84c1f6b730';
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
   where g.id = v_source_graph_id
     -- Only when the source really is retired the way the log says: at least
     -- one run exists and none is still open. A database where that copy is
     -- still claimable (this file replaying somewhere the drain never ran)
     -- must not get a second claimable twin.
     and exists (select 1 from public.graph_runs r where r.graph_id = g.id)
     and not exists (
       select 1 from public.graph_runs r
        where r.graph_id = g.id and r.state in ('PLANNED', 'RUNNING')
     );

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
      -- The source already carries the measured envelopes; copy verbatim.
      v_node.timeout_ms,
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
