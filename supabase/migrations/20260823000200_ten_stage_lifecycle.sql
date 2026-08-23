-- ---------------------------------------------------------------------------
-- The lifecycle widens from eight stages to ten, and a run learns to describe
-- itself well enough to draw.
--
-- ## Why the enum is rebuilt rather than extended
--
-- The eight-stage vocabulary folded four questions into two. GOAL and PRD were
-- both "what is being asked for", split at a document boundary rather than a
-- decision boundary. And the three questions that decide how much work there
-- actually is — does this already exist, which candidate is worth having, do we
-- use it or build it — had no stage at all, so they happened inside
-- ARCHITECTURE if they happened, unrecorded either way.
--
-- Ten stages puts the boundaries where the decisions are:
--
--   GOAL, PRD    -> REQUIREMENT
--   (new)        -> DISCOVER, EVALUATE, DECIDE
--   ARCHITECTURE -> ARCHITECT
--   IMPLEMENTATION -> BUILD
--   REVIEW, TEST -> unchanged
--   DEPLOYMENT   -> DEPLOY
--   MONITORING   -> MONITOR
--
-- `alter type ... rename value` would carry five of those, but not the two that
-- matter: PRD has to *merge* into REQUIREMENT, and a merge is not a rename. The
-- alternative — renaming five, adding three, and leaving PRD in the type
-- forever as a value the application no longer knows — would leave the database
-- accepting a stage `isSdlcStage()` rejects. So the type is rebuilt, which is
-- also the only way to get the ten values in lifecycle order rather than in the
-- order they were added.
--
-- Both columns are carried through `text` and mapped on the way back, so an
-- existing row keeps its meaning. Nothing references the type in a function
-- signature — the casts in `create_graph_from_plan` and
-- `open_node_gate_as_worker` are inside bodies, which plpgsql resolves at
-- execution — so the drop has no dependency to fight.
--
-- ## Why list_graph_runs is rewritten
--
-- The stage pages ask questions the old projection could not answer: how many
-- observations back this node, what it depends on, how many attempts it has
-- had, how long it took, and what the graph's shape is. Each was reachable only
-- by a second query the browser is not allowed to make — every graph table
-- revokes SELECT from `authenticated` except `graph_gates` — so the projection
-- is where they belong.
--
-- Two behavioural changes come with it, both deliberate:
--
--   1. One row per node, not one per attempt. The old body joined `node_runs`
--      unfiltered, so a node retried three times appeared three times and a
--      reader counting nodes counted attempts. The latest attempt is the one
--      that describes the node now; `attempt` and `attempts` are both reported
--      so nothing is hidden by the collapse.
--   2. `anchor_count` per node, counted from ANCHOR artifacts rather than read
--      off the gate. A stage may require anchored evidence and have no gate at
--      all — MONITOR is exactly that — and reading anchors off the gate made
--      such a stage permanently unsatisfiable. Anchors are evidence about the
--      work, not about the decision.
--
-- Forward-only and replay-safe: the enum rebuild is guarded on whether it has
-- already happened, and the function is dropped before it is created because
-- its return type changes and `create or replace` refuses that (ADR-103).
-- ---------------------------------------------------------------------------

do $ten_stage_lifecycle$
begin
  -- Already the ten-stage vocabulary? Then this file has run here before.
  if exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where n.nspname = 'public' and t.typname = 'sdlc_stage' and e.enumlabel = 'REQUIREMENT'
  ) then
    return;
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sdlc_stage'
  ) then
    -- No type at all, which a forward chain cannot produce — 20260821000200
    -- creates it and runs first. Handled anyway so a database assembled out of
    -- order gets the ten-value type rather than a cryptic failure two
    -- statements later.
    create type public.sdlc_stage as enum (
      'REQUIREMENT', 'DISCOVER', 'EVALUATE', 'DECIDE', 'ARCHITECT',
      'BUILD', 'REVIEW', 'TEST', 'DEPLOY', 'MONITOR'
    );
    return;
  end if;

  alter table public.graph_nodes alter column lifecycle_stage type text
    using lifecycle_stage::text;
  alter table public.graph_gates alter column stage type text
    using stage::text;

  drop type public.sdlc_stage;

  create type public.sdlc_stage as enum (
    'REQUIREMENT', 'DISCOVER', 'EVALUATE', 'DECIDE', 'ARCHITECT',
    'BUILD', 'REVIEW', 'TEST', 'DEPLOY', 'MONITOR'
  );

  -- The map, applied to both columns. REVIEW and TEST are unchanged and are
  -- listed anyway, because a mapping that silently passes some values through
  -- is a mapping nobody can check by reading.
  update public.graph_nodes set lifecycle_stage = case lifecycle_stage
    when 'GOAL' then 'REQUIREMENT'
    when 'PRD' then 'REQUIREMENT'
    when 'ARCHITECTURE' then 'ARCHITECT'
    when 'IMPLEMENTATION' then 'BUILD'
    when 'REVIEW' then 'REVIEW'
    when 'TEST' then 'TEST'
    when 'DEPLOYMENT' then 'DEPLOY'
    when 'MONITORING' then 'MONITOR'
    else lifecycle_stage
  end
  where lifecycle_stage is not null;

  update public.graph_gates set stage = case stage
    when 'GOAL' then 'REQUIREMENT'
    when 'PRD' then 'REQUIREMENT'
    when 'ARCHITECTURE' then 'ARCHITECT'
    when 'IMPLEMENTATION' then 'BUILD'
    when 'REVIEW' then 'REVIEW'
    when 'TEST' then 'TEST'
    when 'DEPLOYMENT' then 'DEPLOY'
    when 'MONITORING' then 'MONITOR'
    else stage
  end;

  -- Anything the map did not recognise would silently become a cast failure
  -- below, which reports a value and not a cause. Say the cause here.
  if exists (
    select 1 from public.graph_nodes
     where lifecycle_stage is not null
       and lifecycle_stage not in (
         'REQUIREMENT', 'DISCOVER', 'EVALUATE', 'DECIDE', 'ARCHITECT',
         'BUILD', 'REVIEW', 'TEST', 'DEPLOY', 'MONITOR')
  ) then
    raise exception 'graph_nodes holds a lifecycle stage the ten-stage map does not cover';
  end if;

  alter table public.graph_nodes alter column lifecycle_stage type public.sdlc_stage
    using lifecycle_stage::public.sdlc_stage;
  alter table public.graph_gates alter column stage type public.sdlc_stage
    using stage::public.sdlc_stage;
end
$ten_stage_lifecycle$;

-- ---------------------------------------------------------------------------
-- The run projection the stage pages read
-- ---------------------------------------------------------------------------

-- Dropped, not replaced: the return type gains columns, and `create or replace`
-- refuses a changed return type with `42P13`. The drop takes the grants with
-- it, so they are restated below.
drop function if exists public.list_graph_runs(uuid, integer);

create function public.list_graph_runs(
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
  edges jsonb,
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
      select coalesce(jsonb_agg(latest.node_row order by latest.node_key), '[]'::jsonb)
        from (
          select distinct on (n.id)
                 n.node_key,
                 jsonb_build_object(
                   'node_id', n.id,
                   'node_key', n.node_key,
                   'job', n.job,
                   'executor', n.executor::text,
                   'capability', n.capability,
                   'state', nr.state::text,
                   'provider', nr.provider,
                   'model', nr.model,
                   'latency_ms', nr.latency_ms,
                   'error_message', nr.error_message,
                   'blocked_reason', nr.blocked_reason,
                   'lifecycle_stage', n.lifecycle_stage,
                   'gate_kind', n.gate_kind,
                   -- The gate as it stands, so a reader can tell a node that
                   -- finished from one whose work is done and whose decision is not.
                   'gate_id', gate.id,
                   'gate_state', gate.state,
                   'gate_anchor_count', gate.anchor_count,
                   'gate_reason', gate.reason,
                   -- This attempt, and how many there have been. The projection
                   -- collapses to the latest; it does not hide that it did.
                   'attempt', nr.attempt,
                   'attempts', (
                     select count(*) from public.node_runs prior
                      where prior.graph_run_id = r.id and prior.node_id = n.id
                   ),
                   'max_attempts', n.max_attempts,
                   'timeout_ms', n.timeout_ms,
                   'confidence', nr.confidence,
                   'queued_at', nr.queued_at,
                   'started_at', nr.started_at,
                   'completed_at', nr.completed_at,
                   -- Evidence about the work, counted from what an ANCHOR node
                   -- actually recorded rather than read off a gate the stage may
                   -- not have.
                   'anchor_count', (
                     select count(*)
                       from public.graph_artifacts a
                       join public.node_runs anr on anr.id = a.node_run_id
                      where a.graph_run_id = r.id and anr.node_id = n.id and a.kind = 'ANCHOR'
                   ),
                   'artifact_count', (
                     select count(*)
                       from public.graph_artifacts a
                       join public.node_runs anr on anr.id = a.node_run_id
                      where a.graph_run_id = r.id and anr.node_id = n.id
                   ),
                   -- Forward dependencies only. A feedback edge points backwards
                   -- and nothing ever waits on one, so listing it here would draw
                   -- a dependency the scheduler does not honour.
                   'depends_on', (
                     select coalesce(jsonb_agg(upstream.node_key order by upstream.node_key), '[]'::jsonb)
                       from public.graph_edges e
                       join public.graph_nodes upstream on upstream.id = e.from_node_id
                      where e.to_node_id = n.id and e.is_feedback = false
                   )
                 ) as node_row
            from public.node_runs nr
            join public.graph_nodes n on n.id = nr.node_id
            left join public.graph_gates gate on gate.node_id = n.id
           where nr.graph_run_id = r.id
           order by n.id, nr.attempt desc, nr.created_at desc
        ) latest
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'from_node_key', from_node.node_key,
        'to_node_key', to_node.node_key,
        'reason', e.reason::text,
        'detail', e.detail,
        'is_feedback', e.is_feedback
      ) order by from_node.node_key, to_node.node_key), '[]'::jsonb)
        from public.graph_edges e
        join public.graph_nodes from_node on from_node.id = e.from_node_id
        join public.graph_nodes to_node on to_node.id = e.to_node_id
       where e.graph_id = g.id
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

revoke all on function public.list_graph_runs(uuid, integer) from public, anon, service_role;
grant execute on function public.list_graph_runs(uuid, integer) to authenticated;
