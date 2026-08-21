-- ---------------------------------------------------------------------------
-- The Agentic SDLC lifecycle, on the worker that already exists
--
-- The graph engine runs: `claim_planned_graph` hands a worker a graph and
-- `runClaimedGraph` drives it to a persisted conclusion. What it cannot say is
-- *where in a software lifecycle a node sits*, and so it cannot hold one stage
-- until a person allows the next to begin.
--
-- This adds that, and nothing else:
--
--   1. A stage on a node, so GOAL, PRD, ARCHITECTURE, IMPLEMENTATION, REVIEW,
--      TEST, DEPLOYMENT and MONITORING are recorded rather than implied.
--   2. A gate a node waits at. Automatic gates are decided by anchored
--      evidence; human gates by an owner or admin, and by nobody else.
--   3. A bounded feedback loop, so MONITORING can route back to GOAL a fixed
--      number of times instead of forever.
--
-- ## Why a gate belongs to the graph node, not the node run
--
-- The worker re-runs a claimed graph from the beginning: every claim inserts a
-- fresh set of `node_runs` at PENDING. A gate keyed to a node *run* would
-- therefore be a new, undecided gate on every claim — a lifecycle that could
-- never get past its first human decision however many times it was approved.
-- Keyed to the graph node, an approval is a fact about the work rather than
-- about one attempt at it, so the next run reads it and proceeds. That is what
-- makes progress monotonic under a re-running worker.
--
-- Every existing graph keeps working: `lifecycle_stage` is nullable, and a
-- graph that names no stage behaves exactly as it did before.
-- ---------------------------------------------------------------------------

do $agentic_sdlc_types$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sdlc_stage'
  ) then
    create type public.sdlc_stage as enum (
      'GOAL', 'PRD', 'ARCHITECTURE', 'IMPLEMENTATION',
      'REVIEW', 'TEST', 'DEPLOYMENT', 'MONITORING'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'gate_kind'
  ) then
    create type public.gate_kind as enum ('AUTOMATIC', 'HUMAN');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'gate_state'
  ) then
    create type public.gate_state as enum ('OPEN', 'APPROVED', 'REJECTED');
  end if;
end
$agentic_sdlc_types$;

alter table public.graph_nodes
  add column if not exists lifecycle_stage public.sdlc_stage,
  add column if not exists gate_kind public.gate_kind;

alter table public.graphs
  add column if not exists is_lifecycle boolean not null default false,
  add column if not exists iteration integer not null default 1,
  add column if not exists max_iterations integer not null default 3;

-- A feedback edge points backwards on purpose. It is excluded from the claim
-- projection entirely — no node ever waits on one — and exists so the console
-- and the orchestrator can see which stage a later stage reports back to.
alter table public.graph_edges
  add column if not exists is_feedback boolean not null default false;

alter table public.node_runs
  add column if not exists confidence numeric(4, 3)
    check (confidence is null or (confidence >= 0 and confidence <= 1));

-- Guarded the way 20260817000700 guards its constraints: PostgreSQL has no
-- `add constraint if not exists`, and the apply runbook's method is to tell
-- live-but-unledgered DDL apart from a migration that never ran. A file that
-- dies on `duplicate_object` makes that distinction cost an incident.
do $agentic_sdlc_graph_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'graphs_iteration_positive'
  ) then
    alter table public.graphs
      add constraint graphs_iteration_positive check (iteration >= 1);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'graphs_max_iterations_bounded'
  ) then
    alter table public.graphs
      add constraint graphs_max_iterations_bounded check (max_iterations between 1 and 20);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'graphs_iteration_within_cap'
  ) then
    alter table public.graphs
      add constraint graphs_iteration_within_cap check (iteration <= max_iterations);
  end if;
end
$agentic_sdlc_graph_constraints$;

create index if not exists graph_nodes_stage_idx
  on public.graph_nodes (graph_id, lifecycle_stage);

-- ---------------------------------------------------------------------------
-- Gates
-- ---------------------------------------------------------------------------

create table if not exists public.graph_gates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_id uuid not null,
  node_id uuid not null,
  stage public.sdlc_stage not null,
  kind public.gate_kind not null,
  state public.gate_state not null default 'OPEN',
  -- The count of non-model observations backing the claim this gate guards.
  -- An automatic gate with zero anchors may not approve: that is the rule that
  -- generated output is not a completed task, put where it cannot be forgotten.
  anchor_count integer not null default 0 check (anchor_count >= 0),
  -- The run that opened it, kept for the audit trail. Not part of the key: an
  -- approval outlives the run that asked for it.
  opened_by_run_id uuid,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  opened_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  constraint graph_gates_id_organization_unique unique (id, organization_id),
  -- One gate per node of a graph. A second would let a rejected decision be
  -- replaced by an approving one on the next claim.
  constraint graph_gates_node_unique unique (node_id),
  constraint graph_gates_graph_fk foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete cascade,
  constraint graph_gates_node_fk foreign key (node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete cascade,
  constraint graph_gates_decided_together check (
    (state in ('APPROVED', 'REJECTED')) = (decided_at is not null)
  )
);

create index if not exists graph_gates_graph_idx on public.graph_gates (graph_id, state);
create index if not exists graph_gates_open_idx
  on public.graph_gates (organization_id, state, opened_at desc)
  where state = 'OPEN';

alter table public.graph_gates enable row level security;
alter table public.graph_gates force row level security;

drop policy if exists graph_gates_select_members on public.graph_gates;
create policy graph_gates_select_members on public.graph_gates
  for select to authenticated using (public.is_organization_member(organization_id));

revoke all on public.graph_gates from anon, authenticated;
grant select on public.graph_gates to authenticated;

-- ---------------------------------------------------------------------------
-- Node output is written by the worker, so it needs the same guard as the rest
-- ---------------------------------------------------------------------------

-- `graph_artifacts.payload` holds the output of a model that was given
-- repository context. A model asked to summarise a configuration file can echo
-- what it read, and AGENTS.md is unconditional about where that must not land.
-- The same predicate that protects `activity_events.metadata` protects this: it
-- checks key names and secret-shaped string values at any depth.
--
-- `not valid` so the migration cannot fail on a row written before the rule
-- existed. New rows are checked either way, which is the point.
do $agentic_sdlc_artifact_guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'graph_artifacts_payload_no_sensitive_data'
  ) then
    alter table public.graph_artifacts
      add constraint graph_artifacts_payload_no_sensitive_data
        check (not public.jsonb_has_sensitive_keys(payload)) not valid;
  end if;
end
$agentic_sdlc_artifact_guard$;

-- ---------------------------------------------------------------------------
-- Planning: stages, gates and feedback edges reach the database
-- ---------------------------------------------------------------------------

-- `create_graph_from_plan` gains stage, gate and feedback awareness. The
-- signature is unchanged: the new fields ride in the node and edge JSON, so
-- every existing caller keeps working and a plan that names no stage produces
-- exactly the graph it produced before.
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

  -- A graph is a lifecycle when its plan stages its nodes. Nothing else marks
  -- it, so a caller cannot claim the label without the structure.
  select coalesce(bool_or((n ->> 'lifecycle_stage') is not null), false)
    into v_is_lifecycle
    from jsonb_array_elements(p_nodes) as n;

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

-- ---------------------------------------------------------------------------
-- The gate lifecycle
-- ---------------------------------------------------------------------------

-- Open the gate a finished node waits at.
--
-- Called by the worker when a node whose plan named a gate reaches the end of
-- its work. Idempotent across runs by construction: the gate is keyed to the
-- graph node, so a second claim finds the existing row — and if a person has
-- already decided it, that decision is returned untouched rather than reopened.
create or replace function public.open_node_gate_as_worker(
  p_worker_id text,
  p_node_id uuid,
  p_graph_run_id uuid,
  p_anchor_count integer default 0
)
returns public.graph_gates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate public.graph_gates;
  v_node public.graph_nodes;
  v_project uuid;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  select * into v_node from public.graph_nodes where id = p_node_id;
  if v_node.id is null then
    raise exception 'node_not_found' using errcode = 'P0002';
  end if;
  if v_node.gate_kind is null or v_node.lifecycle_stage is null then
    raise exception 'node_has_no_gate' using errcode = '22023';
  end if;

  select * into v_gate from public.graph_gates where node_id = p_node_id;
  if v_gate.id is not null then
    -- An approval outlives the run that asked for it. Re-opening here would
    -- make a decided gate undecidable, which is the whole failure this
    -- key exists to prevent.
    return v_gate;
  end if;

  insert into public.graph_gates (
    organization_id, graph_id, node_id, stage, kind, state, anchor_count, opened_by_run_id
  )
  values (
    v_node.organization_id, v_node.graph_id, p_node_id,
    v_node.lifecycle_stage, v_node.gate_kind, 'OPEN',
    greatest(0, coalesce(p_anchor_count, 0)), p_graph_run_id
  )
  returning * into v_gate;

  insert into public.graph_events (
    organization_id, graph_run_id, event_type, detail, payload
  )
  values (
    v_node.organization_id, p_graph_run_id, 'gate_opened',
    v_node.lifecycle_stage::text || ' gate awaiting a '
      || lower(v_node.gate_kind::text) || ' decision',
    jsonb_build_object('anchor_count', v_gate.anchor_count, 'node_key', v_node.node_key)
  );

  select g.project_id into v_project from public.graphs g where g.id = v_node.graph_id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  )
  values (
    v_node.organization_id, v_project, null, 'lifecycle.gate_opened',
    'graph_gate', v_gate.id,
    v_node.lifecycle_stage::text || ' gate opened',
    jsonb_build_object('kind', v_node.gate_kind, 'anchor_count', v_gate.anchor_count)
  );

  return v_gate;
end;
$$;

-- Decide a gate.
--
-- Two refusals are the substance of this function.
--
--   A HUMAN gate is decided by an owner or admin. Membership is not enough,
--   because a human gate exists precisely to put a named person behind a
--   decision.
--
--   An AUTOMATIC gate may not approve with zero anchors. The rule this
--   repository works to is that generated output is not a completed task, and
--   an automatic approval backed by no observation is exactly that mistake
--   written into the database.
create or replace function public.decide_node_gate(
  p_gate_id uuid,
  p_approved boolean,
  p_reason text default null
)
returns public.graph_gates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate public.graph_gates;
  v_project uuid;
begin
  select * into v_gate from public.graph_gates where id = p_gate_id;
  if v_gate.id is null or not public.is_organization_member(v_gate.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if v_gate.state <> 'OPEN' then
    raise exception 'gate_already_decided' using errcode = '22023';
  end if;

  if v_gate.kind = 'HUMAN' and not public.can_manage_organization(v_gate.organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to decide a human gate';
  end if;

  if v_gate.kind = 'AUTOMATIC' and p_approved and v_gate.anchor_count = 0 then
    raise exception using errcode = '22023',
      message = 'an automatic gate cannot approve without anchored evidence';
  end if;

  update public.graph_gates
     set state = case when p_approved then 'APPROVED' else 'REJECTED' end::public.gate_state,
         reason = nullif(btrim(coalesce(p_reason, '')), ''),
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_gate_id
  returning * into v_gate;

  select g.project_id into v_project from public.graphs g where g.id = v_gate.graph_id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  )
  values (
    v_gate.organization_id, v_project, auth.uid(),
    -- Cast spelled out: a CASE expression is `text`, and the enum does not
    -- accept one implicitly the way a bare literal does.
    (case when p_approved then 'lifecycle.gate_approved' else 'lifecycle.gate_rejected' end)
      ::public.activity_event_type,
    'graph_gate', v_gate.id,
    v_gate.stage::text || ' gate ' || case when p_approved then 'approved' else 'rejected' end,
    jsonb_build_object('kind', v_gate.kind, 'anchor_count', v_gate.anchor_count)
  );

  return v_gate;
end;
$$;

-- Advance the lifecycle by one iteration, or report that it cannot.
--
-- Deliberately does not raise when the cap is reached. An exception rolls back
-- its own transaction, which would discard the `lifecycle.iteration_exhausted`
-- row written to record the very thing that happened — a loop that ended
-- without meeting its goal, leaving no trace it ever ran.
create or replace function public.advance_graph_iteration(p_graph_id uuid)
returns table (
  graph_id uuid,
  iteration integer,
  max_iterations integer,
  advanced boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_graph public.graphs;
begin
  select * into v_graph from public.graphs where id = p_graph_id;
  if v_graph.id is null or not public.is_organization_member(v_graph.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if not v_graph.is_lifecycle then
    raise exception 'not_a_lifecycle_graph' using errcode = '22023';
  end if;

  if v_graph.iteration >= v_graph.max_iterations then
    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    )
    values (
      v_graph.organization_id, v_graph.project_id, auth.uid(),
      'lifecycle.iteration_exhausted', 'graph', v_graph.id,
      'Lifecycle reached its iteration cap without meeting its acceptance criteria',
      jsonb_build_object('iteration', v_graph.iteration, 'max_iterations', v_graph.max_iterations)
    );
    return query select v_graph.id, v_graph.iteration, v_graph.max_iterations, false;
    return;
  end if;

  -- Aliased because `iteration` and `max_iterations` are OUT parameters here:
  -- an unqualified reference on the right-hand side would resolve to the
  -- parameter rather than the column and count from null.
  update public.graphs g
     set iteration = g.iteration + 1,
         updated_at = now()
   where g.id = p_graph_id
  returning g.* into v_graph;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  )
  values (
    v_graph.organization_id, v_graph.project_id, auth.uid(),
    'lifecycle.iteration_advanced', 'graph', v_graph.id,
    'Lifecycle advanced to iteration ' || v_graph.iteration,
    jsonb_build_object('iteration', v_graph.iteration, 'max_iterations', v_graph.max_iterations)
  );

  return query select v_graph.id, v_graph.iteration, v_graph.max_iterations, true;
end;
$$;

revoke all on function public.open_node_gate_as_worker(text, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.open_node_gate_as_worker(text, uuid, uuid, integer) to service_role;

revoke all on function public.decide_node_gate(uuid, boolean, text) from public, anon;
grant execute on function public.decide_node_gate(uuid, boolean, text) to authenticated;

revoke all on function public.advance_graph_iteration(uuid) from public, anon;
grant execute on function public.advance_graph_iteration(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The claim, made lifecycle-aware
-- ---------------------------------------------------------------------------

-- `claim_planned_graph` gains three things and keeps everything else.
--
--   1. The node projection carries `lifecycle_stage` and `gate_kind`, and the
--      gate's decision if one has been made, so the worker can tell a node that
--      must wait from one that may proceed.
--   2. Feedback edges are excluded from the projection. They point backwards;
--      the compiler rejects every cycle and is right to, so a lifecycle whose
--      feedback edges reached it would fail to compile and never run at all.
--   3. A graph whose last run ended PARTIAL becomes claimable again once a gate
--      on it has been decided. Without this the lifecycle stops at its first
--      gate forever: PARTIAL is "an answer, not an infrastructure fault", so
--      the original predicate — correct for every other graph — keeps it out of
--      the queue permanently. A decision is new information, and it is the only
--      thing that reopens the graph.
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

  select g.* into v_graph
    from public.graphs g
   where g.requires_owner_approval = false
     and (
       -- The original rule: never run, or every previous run FAILED/CANCELLED.
       not exists (
         select 1 from public.graph_runs r
          where r.graph_id = g.id and r.state not in ('FAILED', 'CANCELLED')
       )
       -- Or: a lifecycle that stopped at a gate, and the gate has since been
       -- decided. Nothing is in flight, and a decision has arrived that the
       -- last run did not have.
       or (
         g.is_lifecycle
         and not exists (
           select 1 from public.graph_runs r
            where r.graph_id = g.id and r.state = 'RUNNING'
         )
         and exists (
           select 1 from public.graph_gates gate
            where gate.graph_id = g.id
              and gate.state = 'APPROVED'
              and gate.decided_at > coalesce(
                (select max(r.completed_at) from public.graph_runs r where r.graph_id = g.id),
                gate.opened_at
              )
         )
       )
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
    'is_lifecycle', v_graph.is_lifecycle,
    'iteration', v_graph.iteration,
    'max_iterations', v_graph.max_iterations,
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
        'node_id', n.id,
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
        'lifecycle_stage', n.lifecycle_stage,
        'gate_kind', n.gate_kind,
        -- Null when no gate has ever been opened on this node. The worker
        -- reads it to tell "stop here and ask" from "a person already said
        -- yes, carry on".
        'gate_state', gate.state,
        'input_schema', c.input_schema,
        'output_schema', c.output_schema,
        'reads', c.reads,
        'writes', c.writes,
        'acceptance_criteria', c.acceptance_criteria
      ) order by n.node_key), '[]'::jsonb)
        from public.graph_nodes n
        join public.node_runs nr on nr.node_id = n.id and nr.graph_run_id = v_run_id
        left join public.node_contracts c on c.node_id = n.id
        left join public.graph_gates gate on gate.node_id = n.id
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
         and e.is_feedback = false
    )
  );
end;
$$;

revoke all on function public.claim_planned_graph(text) from public, anon, authenticated;
grant execute on function public.claim_planned_graph(text) to service_role;
