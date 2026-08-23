-- ---------------------------------------------------------------------------
-- The node explains itself
-- ---------------------------------------------------------------------------
--
-- Round 7 recorded the gap and the rounds after it left it standing: "clicking a node
-- still reveals nothing." The goal document asks a node for its job, inputs,
-- dependencies, attempts, artifacts, timing and output. `list_graph_runs`
-- projected eight fields, none of which answer any of those, so the panel
-- could say a node FAILED but not what it had been asked to do, how long it
-- ran, what it was waiting on, or what it produced. This closes all of those
-- except the retry count, which no writer records — see the note on
-- `max_attempts` below.
--
-- Every column added here already existed. `node_runs` has stored `queued_at`,
-- `started_at`, `completed_at` and `blocked_reason` since 20260814000100, and
-- `record_node_state_as_worker` writes all four; `graph_nodes` has stored
-- `job` and `max_attempts`;
-- `graph_artifacts` has carried `node_run_id` all along; `graph_edges` has
-- always known which node feeds which. Nothing was missing but the read. That
-- is the whole change: no new table, no new column, no backfill, no writer
-- touched.
--
-- `create or replace`, deliberately, unlike 20260821000200's drop-and-create:
-- the return signature is unchanged and only the `nodes` jsonb grows. New keys
-- in a jsonb payload are additive for every existing reader, so a browser
-- running last release's bundle keeps working against this function.
--
-- Dependencies are projected *into each node* rather than as a run-level edge
-- list, which is why the signature could stay fixed. It is also the better
-- shape for the question being asked: a reader looking at one node wants to
-- know what that node waited for, and answering it from the node's own row
-- means the panel never has to join two arrays in the browser and cannot get
-- that join wrong.

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
  started_at timestamptz,
  completed_at timestamptz,
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
    r.started_at,
    r.completed_at,
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

-- Re-asserted rather than assumed. `create or replace` preserves the existing
-- grants, but a function whose privileges depend on a previous migration
-- having run correctly is a function whose privileges nobody can read off the
-- page. Both statements are idempotent.
revoke all on function public.list_graph_runs(uuid, integer) from public, anon, service_role;
grant execute on function public.list_graph_runs(uuid, integer) to authenticated;
