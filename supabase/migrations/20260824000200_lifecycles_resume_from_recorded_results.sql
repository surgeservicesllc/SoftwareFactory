-- ---------------------------------------------------------------------------
-- Lifecycles resume from recorded results
-- ---------------------------------------------------------------------------
--
-- Three consecutive live windows proved the gap this closes. The worker
-- re-executes a claimed graph from the beginning — the right shape for an
-- analysis graph, whose findings should be fresh — but a lifecycle re-claimed
-- after a capacity CANCELLED or a gate-halt PARTIAL spends its whole
-- provider window re-proving stages it already completed, and caps before
-- reaching new ground (runs 2469db25: 8 nodes then the limit; 6a8d5121: 7
-- nodes then the limit — the second window never even reached where the
-- first had been).
--
-- This function is the read the resume needs: for one lifecycle graph, the
-- most recently completed recorded result per node from that graph's own
-- earlier runs. The worker substitutes those results instead of re-executing
-- the nodes — real recorded work from this same graph, reused with its
-- provenance stated in the drain log, never fabricated.
--
-- Deliberate bounds:
--   * Lifecycle graphs only. An analysis graph's value is fresh findings;
--     the join to graphs.is_lifecycle makes the scope a property of the
--     function rather than worker etiquette.
--   * Only runs that did not deliver an answer contribute (CANCELLED,
--     PARTIAL, FAILED). A COMPLETED run's graph never re-claims at all.
--   * Only node runs with a recorded artifact count: a completion without
--     its artifact has nothing to reuse.
--   * service_role execute only, worker id asserted — the same boundary as
--     every other *_as_worker read.

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
   and node_run.state = 'COMPLETED'
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

-- Postflight: the function exists with this signature, is a definer, and is
-- executable by service_role alone among the API roles.
do $$
declare
  v_oid oid;
  v_secdef boolean;
begin
  select p.oid, p.prosecdef into v_oid, v_secdef
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
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'postflight: service_role cannot execute read_prior_node_results_as_worker';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'postflight: API roles must not execute read_prior_node_results_as_worker';
  end if;
end $$;
