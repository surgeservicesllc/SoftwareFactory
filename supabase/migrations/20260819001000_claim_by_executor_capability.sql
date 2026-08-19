-- A worker must not claim work it cannot perform.
--
-- Two shipped templates (feature_build, and the incident graph) contain ANCHOR
-- nodes: "run the tests and record the result as evidence", "attempt a
-- reproduction and record the observation". The graph worker is a read-only
-- analysis lane — it has no workspace, no checkout it may mutate, and no
-- command execution — so it fails those nodes honestly and non-retryably. That
-- is the right answer for a node it has already claimed, but the wrong place to
-- discover it: the run is created, every node below the anchor is BLOCKED, and
-- the graph spends one of its three chances producing a PARTIAL that says only
-- what was already knowable before the claim. Ten runs later the graph retires
-- having never had a chance.
--
-- The claim now matches the graph against the caller's declared executors. A
-- graph containing a node this worker cannot run is not claimed at all: it
-- stays PLANNED, keeps its full budget, and is waiting when a worker that CAN
-- run anchors asks for work. No run is created, so nothing is recorded as a
-- failure that never executed.
--
-- The parameter is required rather than defaulted. A default would let a
-- caller that forgot to declare its executors silently claim anchor work
-- again, which is exactly the failure this removes.

-- The one-argument form is replaced, not overloaded: leaving it in place would
-- let an old caller keep claiming anchor graphs, and PostgREST would have two
-- candidates for a one-argument call. This file is replayed, and
-- 20260819000100 recreates the one-argument form each time it replays, so the
-- drop has to run here every time too.
drop function if exists public.claim_planned_graph(text);
drop function if exists public.claim_planned_graph(text, text[]);

create function public.claim_planned_graph(
  p_worker_id text,
  p_supported_executors text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_graph public.graphs;
  v_run_id uuid;
  v_stale record;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  if p_supported_executors is null or array_length(p_supported_executors, 1) is null then
    raise exception using
      errcode = '22023',
      message = 'a worker must declare at least one executor it can run';
  end if;

  -- Reclaim abandonment first; unchanged from 20260819000100. A worker that
  -- died mid-run leaves its run RUNNING forever, and an in-flight run keeps its
  -- graph out of the queue — a permanent, silent loss.
  for v_stale in
    select r.id, r.organization_id
      from public.graph_runs r
     where r.state = 'RUNNING'
       and r.updated_at < now() - interval '2 hours'
       and not exists (
         select 1 from public.node_runs nr
          where nr.graph_run_id = r.id
            and nr.updated_at >= now() - interval '2 hours'
       )
  loop
    update public.graph_runs
       set state = 'FAILED', completed_at = now(), updated_at = now()
     where id = v_stale.id and state = 'RUNNING';
    if not found then
      continue;
    end if;

    update public.node_runs
       set state = 'CANCELLED',
           blocked_reason = 'The worker running this graph stopped reporting; the run was reclaimed.',
           completed_at = now(),
           updated_at = now()
     where graph_run_id = v_stale.id
       and state in ('PENDING', 'READY', 'RUNNING', 'VERIFYING', 'BLOCKED');

    insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
    values (
      v_stale.organization_id, v_stale.id, 'run_failed',
      format('Reclaimed by worker %s: the run had been silent for over two hours and its worker is presumed dead.', p_worker_id)
    );
  end loop;

  -- Claimable: never run, or every previous run FAILED or CANCELLED; under
  -- three genuine failures and ten total runs; and — new here — every node's
  -- executor is one this worker actually provides.
  select g.* into v_graph
    from public.graphs g
   where g.requires_owner_approval = false
     and not exists (
       select 1 from public.graph_runs r
        where r.graph_id = g.id and r.state not in ('FAILED', 'CANCELLED')
     )
     and (select count(*) from public.graph_runs r
           where r.graph_id = g.id and r.state = 'FAILED') < 3
     and (select count(*) from public.graph_runs r where r.graph_id = g.id) < 10
     and not exists (
       select 1 from public.graph_nodes n
        where n.graph_id = g.id
          and n.executor::text <> all (p_supported_executors)
     )
   order by g.created_at
   for update skip locked
   limit 1;

  if v_graph.id is null then
    return null;
  end if;

  insert into public.graph_runs (organization_id, graph_id, state, started_at, created_by)
  values (v_graph.organization_id, v_graph.id, 'RUNNING', now(), v_graph.created_by)
  returning id into v_run_id;

  insert into public.node_runs (organization_id, graph_run_id, node_id, state, queued_at)
  select v_graph.organization_id, v_run_id, n.id, 'PENDING', now()
    from public.graph_nodes n
   where n.graph_id = v_graph.id;

  insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
  values (
    v_graph.organization_id, v_run_id, 'run_started',
    format('Claimed by worker %s; nodes queued.', p_worker_id)
  );

  return jsonb_build_object(
    'graph_run_id', v_run_id,
    'graph_id', v_graph.id,
    'organization_id', v_graph.organization_id,
    'project_id', v_graph.project_id,
    'goal', v_graph.goal,
    'topology', v_graph.topology,
    'risk_level', v_graph.risk_level,
    'project_repository', (
      select p.github_repository
        from public.projects p
       where p.id = v_graph.project_id
         and p.organization_id = v_graph.organization_id
    ),
    'budget', (
      select to_jsonb(b) - 'id' - 'organization_id' - 'graph_id'
        from public.graph_budgets b
       where b.graph_id = v_graph.id
    ),
    'nodes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'node_run_id', nr.id,
        'node_key', n.node_key,
        'job', n.job,
        'executor', n.executor,
        'capability', n.capability,
        'model_tier', n.model_tier,
        'risk_level', n.risk_level,
        'timeout_ms', n.timeout_ms,
        'max_attempts', n.max_attempts,
        'allow_provider_fallback', n.allow_provider_fallback,
        'tolerates_partial_inputs', n.tolerates_partial_inputs,
        'input_schema', c.input_schema,
        'output_schema', c.output_schema,
        'reads', c.reads,
        'writes', c.writes,
        'acceptance_criteria', c.acceptance_criteria
      ) order by n.node_key), '[]'::jsonb)
        from public.graph_nodes n
        join public.node_runs nr on nr.node_id = n.id and nr.graph_run_id = v_run_id
        left join public.node_contracts c on c.node_id = n.id
       where n.graph_id = v_graph.id
    ),
    'edges', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'from_node_key', src.node_key,
        'to_node_key', dst.node_key,
        'reason', e.reason,
        'detail', e.detail
      ) order by src.node_key, dst.node_key), '[]'::jsonb)
        from public.graph_edges e
        join public.graph_nodes src on src.id = e.from_node_id
        join public.graph_nodes dst on dst.id = e.to_node_id
       where e.graph_id = v_graph.id
    )
  );
end;
$$;

revoke all on function public.claim_planned_graph(text, text[]) from public, anon, authenticated;
grant execute on function public.claim_planned_graph(text, text[]) to service_role;
