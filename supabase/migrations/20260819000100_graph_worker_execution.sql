-- The graph executor's claim-and-persist boundary.
--
-- Everything a graph needs in order to RUN already exists: the console writes
-- graphs, nodes, contracts, edges, and budgets through
-- `create_graph_from_plan`; the engine compiles, schedules, retries, fans in,
-- and verifies; and the live canary proved real parallel Claude nodes through
-- the subscription transport. What did not exist was the wire between them —
-- the member-scoped run lifecycle (`start_graph_run`, `record_node_state`,
-- `complete_graph_run`, `record_graph_artifact`) requires `auth.uid()`, which
-- a service-role worker does not have, so every graph the console recorded
-- stayed PLANNED forever.
--
-- This adds the worker-facing half of that boundary, mirroring the Phase 1C
-- pattern: functions granted to `service_role` only, each attributed to a
-- named worker id in the event trail. The member-scoped functions are
-- untouched; the transition rules (terminal states are final, a partial-input
-- run may not call itself COMPLETED) are the same on both halves, because a
-- worker does not get a looser truth than a person.

-- One bounded shape for worker ids, shared by every function here.
create or replace function public.assert_graph_worker_id(p_worker_id text)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $function$
begin
  if p_worker_id is null
     or pg_catalog.btrim(p_worker_id) = ''
     or pg_catalog.char_length(p_worker_id) > 120
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' then
    raise exception using errcode = '22023', message = 'a bounded worker id is required';
  end if;
end;
$function$;

-- Reached only from the definer functions below, which execute it as their
-- owner: no browser or worker role needs (or gets) a direct grant.
revoke all on function public.assert_graph_worker_id(text) from public, anon, authenticated, service_role;

-- Claim the oldest runnable graph: one nobody has run yet, and one that does
-- not wait on owner approval. The claim IS the run creation, in one
-- transaction, so two workers cannot both start the same graph — the second
-- claimer's FOR UPDATE SKIP LOCKED simply finds the next graph or nothing.
-- Returns the complete execution projection: the run, the budget, every node
-- with its contract and its node_run id, and every edge. Edges are data; the
-- worker receives everything it needs in this one call and shares no hidden
-- context with the console.
create or replace function public.claim_planned_graph(p_worker_id text)
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

  /*
   * Reclaim abandonment first. A worker that died mid-run leaves its run
   * RUNNING forever, and an in-flight run keeps its graph out of the queue
   * — a permanent, silent loss. A run whose row and node rows have ALL been
   * silent for over two hours (the worker's own ceiling is one hour) did
   * not survive its worker: it closes FAILED with an event naming the
   * reclaim, its unfinished nodes close CANCELLED with the reason on the
   * row, and the graph re-enters the ordinary convergence rules — FAILED
   * counts toward the cap, so a graph that keeps killing workers still
   * retires.
   */
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
      continue; -- another claimer reclaimed it between the select and here
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

  /*
   * Claimable: never run, or every previous run FAILED or CANCELLED.
   * An infrastructure failure (a missing CLI, an unreachable provider)
   * should be retryable without a person re-planning the graph, and a
   * CANCELLED run — the worker's record that the provider withheld capacity
   * (a session or rate limit) and the run never truly executed — must not
   * spend the graph's chances. So the convergence bound counts only FAILED
   * runs: three genuine failed executions retire the graph to a durable
   * FAILED history. A hard ceiling on total runs keeps a long capacity
   * outage from accumulating unbounded CANCELLED rows. A COMPLETED,
   * PARTIAL, BUDGET_STOPPED, or in-flight run keeps its graph out of the
   * queue: those are answers, not infrastructure faults.
   */
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
    -- The repository this graph's project is bound to. A read-only analysis
    -- worker reads whatever tree it is checked out on, so without this the
    -- projection cannot tell it whether that tree is the right one — and a
    -- graph planned for another project would come back with confident
    -- findings about the wrong repository. Null when the project has no
    -- repository linked, which is a different situation from a mismatch.
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
        'from_node_key', nf.node_key,
        'to_node_key', nt.node_key,
        'reason', e.reason,
        'detail', e.detail
      )), '[]'::jsonb)
        from public.graph_edges e
        join public.graph_nodes nf on nf.id = e.from_node_id
        join public.graph_nodes nt on nt.id = e.to_node_id
       where e.graph_id = v_graph.id
    )
  );
end;
$$;

revoke all on function public.claim_planned_graph(text) from public, anon, authenticated;
grant execute on function public.claim_planned_graph(text) to service_role;

-- The worker's node transition. Identical rules to the member-scoped
-- `record_node_state` — terminal states are final — with the worker named in
-- the event instead of a member proven by auth.uid().
create or replace function public.record_node_state_as_worker(
  p_worker_id text,
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
  perform public.assert_graph_worker_id(p_worker_id);

  select * into v_run from public.node_runs where id = p_node_run_id;
  if v_run.id is null then
    raise exception 'node_run_not_found' using errcode = 'P0002';
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
    'node_' || lower(p_state::text),
    coalesce(p_detail, format('worker %s', p_worker_id))
  );

  return v_run;
end;
$$;

revoke all on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer
) to service_role;

-- The worker's artifact write: node outputs and reductions become durable,
-- org-scoped evidence exactly as the member-scoped path records them.
create or replace function public.record_graph_artifact_as_worker(
  p_worker_id text,
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
  perform public.assert_graph_worker_id(p_worker_id);

  select organization_id into v_organization_id
    from public.graph_runs where id = p_graph_run_id;
  if v_organization_id is null then
    raise exception 'graph_run_not_found' using errcode = 'P0002';
  end if;

  insert into public.graph_artifacts (
    organization_id, graph_run_id, node_run_id, kind, payload,
    item_count, reduced_from_count
  )
  values (
    v_organization_id, p_graph_run_id, p_node_run_id, p_kind,
    coalesce(p_payload, '{}'::jsonb), p_item_count, p_reduced_from_count
  )
  returning id into v_artifact_id;

  return v_artifact_id;
end;
$$;

revoke all on function public.record_graph_artifact_as_worker(
  text, uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_graph_artifact_as_worker(
  text, uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) to service_role;

-- The worker's run closure. The same silent-failure guard as the member
-- path: a run whose inputs were incomplete may not call itself COMPLETED.
create or replace function public.complete_graph_run_as_worker(
  p_worker_id text,
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
  perform public.assert_graph_worker_id(p_worker_id);

  select * into v_run from public.graph_runs where id = p_graph_run_id;
  if v_run.id is null then
    raise exception 'graph_run_not_found' using errcode = 'P0002';
  end if;
  if v_run.state in ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_STOPPED') then
    raise exception 'run_already_terminal' using errcode = '22023';
  end if;

  -- A closure must actually close: PLANNED or RUNNING is not an ending.
  if p_state not in ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_STOPPED') then
    raise exception 'not_a_terminal_state' using errcode = '22023';
  end if;

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
    format('Closed by worker %s.%s', p_worker_id,
      case when p_had_partial_input then ' Inputs were incomplete.' else '' end),
    jsonb_build_object('had_partial_input', p_had_partial_input)
  );

  return v_run;
end;
$$;

revoke all on function public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text
) to service_role;
