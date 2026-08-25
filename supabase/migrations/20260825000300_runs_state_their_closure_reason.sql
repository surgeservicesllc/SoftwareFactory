-- ---------------------------------------------------------------------------
-- A run states why it ended
-- ---------------------------------------------------------------------------
--
-- `lib/worker/graph-run.ts` composes a run-level explanation before it closes
-- a run: whether the fan-in was whole, that a capacity-voided run is void
-- rather than failed, and the correction that matters most to a reader --
-- "N of the nodes counted above did not fail: they halted at an open
-- lifecycle gate and continue once the gate is decided." Its own comment says
-- the record should carry that "rather than leaving the correction to whoever
-- happens to know the distinction".
--
-- It was left to whoever happens to know. The message reached
-- `GraphRunStore.completeRun`, whose parameter is named `_detail` because
-- nothing reads it: `complete_graph_run_as_worker` had no parameter to carry
-- it and `graph_runs` had no column to hold it. Every run-level explanation
-- this engine has ever produced was computed and discarded. The live queue
-- shows the cost -- ten CANCELLED runs, none of which states a reason.
--
-- `node_runs.blocked_reason` has existed since 20260814000100 for exactly this
-- purpose one level down, described there as letting "a stuck graph explain
-- itself without cross-referencing an event log". This is the same column for
-- the run.
--
-- Drop-and-create rather than `create or replace`, on both functions and for
-- the same reason 20260821000200 did it: a new parameter and a new column in
-- a `returns table` are both signature changes, which `create or replace`
-- refuses. DDL is transactional, so the window in which the function does not
-- exist closes with the migration.
--
-- No backfill. Runs closed before this column existed have no note because
-- none was ever stored, and writing a plausible one now would put invented
-- text under a heading that reads like a record.

alter table public.graph_runs
  add column if not exists closure_note text
    check (closure_note is null or char_length(closure_note) <= 2000);

comment on column public.graph_runs.closure_note is
  'Why the run ended in the state it did, in the run''s own row. Written by '
  'complete_graph_run_as_worker from the engine''s fan-in assessment. Null for '
  'runs closed before 20260825000300, and for runs that ended whole with '
  'nothing to explain.';

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------

drop function if exists public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text
);

create function public.complete_graph_run_as_worker(
  p_worker_id text,
  p_graph_run_id uuid,
  p_state public.graph_run_state,
  p_had_partial_input boolean default false,
  p_tokens_used bigint default null,
  p_cost_micros bigint default null,
  p_budget_action text default null,
  p_closure_note text default null
)
returns public.graph_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.graph_runs;
  v_note text;
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

  -- Trimmed to nothing means nothing: an empty note reads as "a reason was
  -- recorded and it was blank", which is worse than the column being null.
  v_note := nullif(btrim(coalesce(p_closure_note, '')), '');
  if v_note is not null and char_length(v_note) > 2000 then
    v_note := left(v_note, 1997) || '...';
  end if;

  update public.graph_runs
     set state = p_state,
         had_partial_input = p_had_partial_input,
         tokens_used = coalesce(p_tokens_used, tokens_used),
         cost_micros = coalesce(p_cost_micros, cost_micros),
         budget_action = coalesce(p_budget_action, budget_action),
         closure_note = v_note,
         completed_at = now(),
         updated_at = now()
   where id = p_graph_run_id
  returning * into v_run;

  insert into public.graph_events (organization_id, graph_run_id, event_type, detail, payload)
  values (
    v_run.organization_id, p_graph_run_id, 'run_' || lower(p_state::text),
    format('Closed by worker %s.%s%s', p_worker_id,
      case when p_had_partial_input then ' Inputs were incomplete.' else '' end,
      case when v_note is not null then ' ' || v_note else '' end),
    jsonb_build_object('had_partial_input', p_had_partial_input, 'closure_note', v_note)
  );

  return v_run;
end;
$$;

revoke all on function public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- The read
-- ---------------------------------------------------------------------------
--
-- Restated from 20260825000200 (run cost and budget) with `closure_note`
-- added, rather than from the older 20260823001000: that file landed on main
-- while this change was in flight, and rebuilding from the stale version
-- would silently revert the cost columns it had just added.

drop function if exists public.list_graph_runs(uuid, integer);

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
        -- The ceiling only, and `node_runs.attempt` deliberately NOT projected.
        -- The column exists and is never written: `claim_planned_graph` inserts
        -- one row per node at its default of 0, `record_node_state_as_worker`
        -- updates state, provider, model and timing but never `attempt`, and
        -- the runner counts attempts in memory. Projecting it would put a
        -- permanent 0 on every node under a heading that reads like data, which
        -- is worse than the field being absent. `max_attempts` is real — it is
        -- the node's configured ceiling — so a reader learns what the node is
        -- allowed, without being told a retry count nobody records.
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

comment on function public.list_graph_runs(uuid, integer) is
  'Every graph run for an organization, newest first, with its nodes, artifact counts, verifications, what it spent, and why it ended. Fails closed for a non-member.';

-- Re-asserted rather than assumed: a function whose privileges depend on an
-- earlier migration having run correctly is one nobody can read off the page.
revoke all on function public.list_graph_runs(uuid, integer) from public, anon, service_role;
grant execute on function public.list_graph_runs(uuid, integer) to authenticated;
