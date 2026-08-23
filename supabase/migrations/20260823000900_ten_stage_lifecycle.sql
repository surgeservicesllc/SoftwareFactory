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
-- ## Why this file's version must stay above 20260823000700
--
-- That migration backfills `graph_nodes.lifecycle_stage` for every row recorded
-- before the capability rule existed, and it writes the *eight-stage*
-- vocabulary: `'IMPLEMENTATION'::public.sdlc_stage`, `'ARCHITECTURE'`, `'PRD'`.
-- Three of those labels do not survive this file.
--
-- Run in this order the two compose exactly: the backfill fills the old
-- vocabulary, and the map below carries every one of its rows forward.
-- Reversed, the backfill dies on `invalid input value for enum sdlc_stage` and
-- takes the rest of the chain with it. The version numbers are the only thing
-- enforcing that, which is why it is written here rather than left to be
-- rediscovered — and why renumbering this file below 000700 would be a silent
-- production break rather than a merge tidy-up.
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
  --
  -- IMPLEMENTATION, ARCHITECTURE and PRD are the three 20260823000700's
  -- backfill writes, so these lines are what carry that migration's work
  -- across rather than stranding it.
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

-- ---------------------------------------------------------------------------
-- A graph is a lifecycle because its plan says so, not because it has stages
--
-- `create_graph_from_plan` decided `is_lifecycle` by asking whether any node
-- carried a `lifecycle_stage`. That was a sound inference while the Agentic
-- SDLC template was the only one that staged anything.
--
-- It stopped being sound when `stageForCapability` gave every node of every
-- template a stage — deliberately, so the graph-runs Stage column reads as
-- something for an audit instead of an em dash. The application separated the
-- two ideas at that point: a stage is a label, and `GraphTemplate.isLifecycle`
-- is a separate declaration that only `agentic_sdlc` makes. The database was
-- not told, and the database is the authority — so every graph created since
-- has been recorded `is_lifecycle = true`.
--
-- What that costs is not cosmetic. `lib/sdlc/orchestrator.ts` iterates a
-- lifecycle whose acceptance criteria are unmet, and an audit's never are in
-- the sense the orchestrator means. Every read-only analysis became a graph
-- that re-runs itself.
--
-- `create or replace` with the identical signature, so no grant is disturbed
-- and no overload is created.
-- ---------------------------------------------------------------------------

create or replace function public.create_graph_from_plan(
  p_organization_id uuid,
  p_project_id uuid,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_graph_id uuid;
  v_node jsonb;
  v_edge jsonb;
  v_node_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_keys jsonb := '{}'::jsonb;
  v_is_lifecycle boolean := false;
  v_max_iterations integer;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) = 0 then
    raise exception 'empty_graph' using errcode = '22023';
  end if;

  -- Whether a graph may ITERATE, taken from the plan when the plan says, and
  -- inferred only when it does not.
  --
  -- The inference alone used to be safe because only the Agentic SDLC template
  -- staged its nodes. That stopped being true when every template began
  -- labelling every node so the Stage column could show something for an audit
  -- as well as a lifecycle. The application decoupled the two — a stage became
  -- a label, and `GraphTemplate.isLifecycle` became a declaration — but this
  -- function is the authority, and it still inferred. The result was that every
  -- read-only analysis was recorded as a lifecycle, and the orchestrator
  -- iterates a lifecycle whose acceptance is unmet: audits re-running
  -- themselves, spending subscription turns on passes nobody asked for.
  --
  -- The flag rides in `p_budget` rather than a new parameter because that is
  -- already this function's options bag — `max_iterations` is read from it
  -- three lines below, and whether a graph may loop belongs beside how many
  -- times it may. A caller that sends nothing keeps the old behaviour, so no
  -- existing caller changes meaning.
  if (p_budget ? 'is_lifecycle') then
    v_is_lifecycle := coalesce((p_budget ->> 'is_lifecycle')::boolean, false);
  else
    select coalesce(bool_or((n ->> 'lifecycle_stage') is not null), false)
      into v_is_lifecycle
      from jsonb_array_elements(p_nodes) as n;
  end if;

  v_max_iterations := greatest(1, least(20, coalesce((p_budget ->> 'max_iterations')::integer, 3)));

  insert into public.graphs (
    organization_id, project_id, goal, topology, topology_reasons,
    risk_level, requires_owner_approval, created_by, is_lifecycle, max_iterations
  )
  values (
    p_organization_id, p_project_id, p_goal, p_topology,
    coalesce(p_topology_reasons, '[]'::jsonb),
    p_risk_level, coalesce(p_requires_owner_approval, false), auth.uid(),
    v_is_lifecycle, v_max_iterations
  )
  returning id into v_graph_id;

  insert into public.graph_budgets (
    organization_id, graph_id, max_nodes, max_concurrent_nodes,
    max_duration_ms, max_retries, max_discovery_rounds, max_tokens, max_cost_micros
  )
  values (
    p_organization_id, v_graph_id,
    coalesce((p_budget ->> 'max_nodes')::integer, 50),
    coalesce((p_budget ->> 'max_concurrent_nodes')::integer, 8),
    coalesce((p_budget ->> 'max_duration_ms')::bigint, 1800000),
    coalesce((p_budget ->> 'max_retries')::integer, 10),
    coalesce((p_budget ->> 'max_discovery_rounds')::integer, 5),
    (p_budget ->> 'max_tokens')::bigint,
    (p_budget ->> 'max_cost_micros')::bigint
  );

  for v_node in select * from jsonb_array_elements(p_nodes)
  loop
    insert into public.graph_nodes (
      organization_id, graph_id, node_key, job, executor, capability,
      model_tier, risk_level, timeout_ms, max_attempts, allow_provider_fallback,
      tolerates_partial_inputs, lifecycle_stage, gate_kind
    )
    values (
      p_organization_id, v_graph_id,
      v_node ->> 'node_key',
      v_node ->> 'job',
      (v_node ->> 'executor')::public.graph_node_executor,
      v_node ->> 'capability',
      coalesce(v_node ->> 'model_tier', 'STANDARD'),
      coalesce((v_node ->> 'risk_level')::public.risk_level, 'green'),
      coalesce((v_node ->> 'timeout_ms')::integer, 180000),
      coalesce((v_node ->> 'max_attempts')::integer, 2),
      coalesce((v_node ->> 'allow_provider_fallback')::boolean, true),
      coalesce((v_node ->> 'tolerates_partial_inputs')::boolean, false),
      (v_node ->> 'lifecycle_stage')::public.sdlc_stage,
      (v_node ->> 'gate_kind')::public.gate_kind
    )
    returning id into v_node_id;

    v_keys := v_keys || jsonb_build_object(v_node ->> 'node_key', v_node_id::text);

    insert into public.node_contracts (
      organization_id, node_id, input_schema, output_schema, reads, writes, acceptance_criteria
    )
    values (
      p_organization_id, v_node_id,
      coalesce(v_node -> 'input_schema', '{}'::jsonb),
      coalesce(v_node -> 'output_schema', '{}'::jsonb),
      coalesce(v_node -> 'reads', '[]'::jsonb),
      coalesce(v_node -> 'writes', '[]'::jsonb),
      coalesce(v_node -> 'acceptance_criteria', '[]'::jsonb)
    );
  end loop;

  for v_edge in select * from jsonb_array_elements(coalesce(p_edges, '[]'::jsonb))
  loop
    v_from_id := (v_keys ->> (v_edge ->> 'from_node_key'))::uuid;
    v_to_id := (v_keys ->> (v_edge ->> 'to_node_key'))::uuid;

    if v_from_id is null or v_to_id is null then
      raise exception 'unknown_edge_node' using errcode = '22023';
    end if;

    insert into public.graph_edges (
      organization_id, graph_id, from_node_id, to_node_id, reason, detail, is_feedback
    )
    values (
      p_organization_id, v_graph_id, v_from_id, v_to_id,
      (v_edge ->> 'reason')::public.graph_edge_reason,
      v_edge ->> 'detail',
      coalesce((v_edge ->> 'is_feedback')::boolean, false)
    );
  end loop;

  if v_is_lifecycle then
    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    )
    values (
      p_organization_id, p_project_id, auth.uid(), 'lifecycle.graph_created',
      'graph', v_graph_id,
      'Agentic SDLC graph planned',
      jsonb_build_object('max_iterations', v_max_iterations)
    );
  end if;

  return v_graph_id;
end;
$$;
