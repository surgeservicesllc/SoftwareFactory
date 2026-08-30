-- Project the measured attempt (follow-up to ADR-174; task #61).
--
-- 20260825000300's projection deliberately omitted `node_runs.attempt`
-- because nothing wrote it - a permanent 0 under a data-shaped heading
-- would have read as measurement. 20260830000100 added the writer, so
-- the omission is now the dishonesty: a run whose node really took two
-- attempts shows nothing. The function below is the 20260825000300
-- definition verbatim with one projection change: attempt >= 1 projects
-- as itself, and the pre-writer insert default of 0 projects as null.

create or replace function public.list_graph_runs(
  p_organization_id uuid,
  p_limit integer default 20
)
returns table (
  graph_run_id uuid,
  graph_id uuid,
  goal text,
  topology text,
  risk_level text,
  project_id uuid,
  state text,
  had_partial_input boolean,
  -- Why the run ended as it did, in the run's own row.
  closure_note text,
  started_at timestamptz,
  completed_at timestamptz,
  -- Accumulated across the run's nodes by the worker. Null until one reports.
  tokens_used bigint,
  cost_micros bigint,
  -- CONTINUE, REDUCE_CONCURRENCY, PREFER_CHEAPER_MODEL or STOP_GRACEFULLY.
  budget_action text,
  discovery_rounds integer,
  nodes jsonb,
  artifact_counts jsonb,
  verifications jsonb,
  is_lifecycle boolean,
  iteration integer,
  max_iterations integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select
    r.id,
    g.id,
    g.goal,
    g.topology::text,
    g.risk_level::text,
    g.project_id,
    r.state::text,
    r.had_partial_input,
    -- A CANCELLED run whose reason is invisible sends the reader to the
    -- event log to learn something the row already knew -- the same
    -- argument `blocked_reason` makes for a node, one level up.
    r.closure_note,
    r.started_at,
    r.completed_at,
    r.tokens_used,
    r.cost_micros,
    r.budget_action,
    r.discovery_rounds,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'node_key', n.node_key,
        'executor', n.executor::text,
        'capability', n.capability,
        'state', nr.state::text,
        'provider', nr.provider,
        'model', nr.model,
        'latency_ms', nr.latency_ms,
        'error_message', nr.error_message,
        'lifecycle_stage', n.lifecycle_stage,
        'gate_kind', n.gate_kind,
        -- The gate as it stands, so a reader can tell a node that finished from
        -- one whose work is done and whose decision is not.
        'gate_id', gate.id,
        'gate_state', gate.state,
        'gate_anchor_count', gate.anchor_count,
        'gate_reason', gate.reason,
        -- What the node was asked to do. Stored since the first graph
        -- migration and never once shown to the person reading the run.
        'job', n.job,
        -- The measured attempt, projected honestly: 20260830000100 gave the
        -- column its writer (the worker records every dispatch's attempt and
        -- a retry re-enters RUNNING with a higher one), so a value >= 1 is
        -- real measurement. Rows from before the writer keep their insert
        -- default of 0, and 0 is not a measurement - it projects as null so
        -- no heading ever reads an unmeasured default as data.
        'attempt', case when nr.attempt >= 1 then nr.attempt end,
        -- `max_attempts` is the node's configured ceiling.
        'max_attempts', n.max_attempts,
        -- The three timestamps, projected raw. The caller derives durations,
        -- because a duration computed here would have to pick a clock for a
        -- node that never finished, and any pick would be a guess presented
        -- as a measurement.
        'queued_at', nr.queued_at,
        'node_started_at', nr.started_at,
        'node_completed_at', nr.completed_at,
        -- Why a node is not progressing, in the node's own row. A BLOCKED
        -- node whose reason is invisible sends the reader to the event log to
        -- learn something the row already knew.
        'blocked_reason', nr.blocked_reason,
        -- What this node waited for, by key, in a stable order.
        'depends_on', (
          select coalesce(jsonb_agg(src.node_key order by src.node_key), '[]'::jsonb)
            from public.graph_edges e
            join public.graph_nodes src on src.id = e.from_node_id
           where e.to_node_id = n.id
        ),
        -- What this node produced, counted by kind. Counts rather than
        -- payloads: an artifact body can be large, and a reader deciding
        -- whether to open one only needs to know it exists.
        'artifact_counts', (
          select coalesce(jsonb_object_agg(counts.kind, counts.total), '{}'::jsonb)
            from (
              select a.kind::text as kind, count(*)::int as total
                from public.graph_artifacts a
               where a.node_run_id = nr.id
               group by a.kind
            ) counts
        )
      ) order by n.node_key), '[]'::jsonb)
        from public.node_runs nr
        join public.graph_nodes n on n.id = nr.node_id
        left join public.graph_gates gate on gate.node_id = n.id
       where nr.graph_run_id = r.id
    ),
    (
      select coalesce(jsonb_object_agg(counts.kind, counts.total), '{}'::jsonb)
        from (
          select a.kind::text as kind, count(*)::int as total
            from public.graph_artifacts a
           where a.graph_run_id = r.id
           group by a.kind
        ) counts
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'subject_node_key', n.node_key,
        'lens', v.lens::text,
        'verdict', v.verdict::text,
        'evidence', v.evidence,
        'verifier_provider', v.verifier_provider,
        -- Recorded, not assumed: a verifier that shared the subject's
        -- context is a weaker verification, and hiding that would make
        -- every row here look equally strong.
        'shared_worker_context', v.shared_worker_context
      ) order by n.node_key), '[]'::jsonb)
        from public.graph_verifications v
        join public.node_runs nr on nr.id = v.subject_node_run_id
        join public.graph_nodes n on n.id = nr.node_id
       where v.graph_run_id = r.id
    ),
    g.is_lifecycle,
    g.iteration,
    g.max_iterations
  from public.graph_runs r
  join public.graphs g on g.id = r.graph_id
  where r.organization_id = p_organization_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

-- Re-asserted rather than assumed.
revoke all on function public.list_graph_runs(uuid, integer) from public, anon, service_role;
grant execute on function public.list_graph_runs(uuid, integer) to authenticated;
