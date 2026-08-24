-- ---------------------------------------------------------------------------
-- Resume reuses gate-halted work
-- ---------------------------------------------------------------------------
--
-- Found live within hours of 20260824000200 shipping. The test lifecycle's
-- 21:20 window executed its architecture node for real (run 6152cee2), the
-- run halted at the ARCHITECTURE human gate, and the gate was approved. The
-- very next claim then re-executed the node from scratch and spent the rest
-- of the window on work the database already held (run e3c4b582: session
-- limit, CANCELLED) — because a gate-halted node is recorded as VERIFYING,
-- and the resume read only offered COMPLETED node runs.
--
-- VERIFYING is precisely "the work is done and recorded; the decision is
-- not". Its artifact is written before the state transition, so reusing it
-- reuses real recorded work. And reuse cannot bypass the gate: the runner
-- checks the gate after the result exists, so a reused result still halts at
-- an OPEN gate (costing nothing this time), still fails on REJECTED, and
-- only passes through on APPROVED — the decision keeps governing
-- advancement; it just stops charging twice for the same work.
--
-- Everything else about the read is unchanged: lifecycle graphs only, only
-- runs that never delivered an answer (CANCELLED, PARTIAL, FAILED), only
-- node runs with a recorded artifact, service_role execute only.

create or replace function public.read_prior_node_results_as_worker(
  p_worker_id text,
  p_graph_id uuid
)
returns table (node_key text, payload jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_graph_worker_id(p_worker_id);

  return query
  select distinct on (node.node_key)
    node.node_key,
    artifact.payload
  from public.graphs graph
  join public.graph_nodes node on node.graph_id = graph.id
  join public.node_runs node_run
    on node_run.node_id = node.id
   -- VERIFYING included: a gate-halted node's work is recorded work.
   and node_run.state in ('COMPLETED', 'VERIFYING')
  join public.graph_runs run
    on run.id = node_run.graph_run_id
   and run.graph_id = graph.id
   and run.state in ('CANCELLED', 'PARTIAL', 'FAILED')
  join public.graph_artifacts artifact
    on artifact.node_run_id = node_run.id
  where graph.id = p_graph_id
    and graph.is_lifecycle
  order by node.node_key, node_run.completed_at desc nulls last, artifact.created_at desc;
end;
$$;

revoke all on function public.read_prior_node_results_as_worker(text, uuid)
  from public, anon, authenticated;
grant execute on function public.read_prior_node_results_as_worker(text, uuid) to service_role;

-- Postflight: the function stands, is a definer, service_role alone may
-- execute it, and its body carries the widened state filter.
do $$
declare
  v_oid oid;
  v_secdef boolean;
  v_body text;
begin
  select p.oid, p.prosecdef, pg_get_functiondef(p.oid) into v_oid, v_secdef, v_body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'read_prior_node_results_as_worker'
     and pg_get_function_identity_arguments(p.oid) = 'p_worker_id text, p_graph_id uuid';
  if v_oid is null then
    raise exception 'postflight: read_prior_node_results_as_worker(text, uuid) is missing';
  end if;
  if not v_secdef then
    raise exception 'postflight: read_prior_node_results_as_worker must be security definer';
  end if;
  if v_body not like '%VERIFYING%' then
    raise exception 'postflight: the resume read does not include gate-halted (VERIFYING) work';
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'postflight: service_role cannot execute read_prior_node_results_as_worker';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'postflight: API roles must not execute read_prior_node_results_as_worker';
  end if;
end $$;
