-- Phase 2B Stage 2: durable graph engineering.
--
-- The Stage 1 engine in lib/graph/ is pure and holds no state. This migration
-- gives it somewhere to live, so a graph run survives a restart: the scheduler
-- is a pure function of persisted node state, and replaying that state returns
-- it to exactly where it left off.
--
-- Three things this schema is deliberately strict about.
--
--   Every edge records WHY it exists. A graph whose edges are unexplained
--   cannot be audited for the fake dependencies that make it slow, so the
--   reason is a column rather than a convention.
--
--   Raw and reduced artifacts are separate rows. A reduction is a lossy view,
--   and the evidence behind a finding has to outlive it.
--
--   A work lock is only meaningful if an abandoned one can be recovered, so
--   locks carry a heartbeat and an expiry rather than just a holder.
--
-- Every table is tenant-scoped, RLS-forced, readable only by organization
-- members, and writable only through SECURITY DEFINER functions -- the same
-- boundary the rest of the control plane uses.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type public.graph_topology as enum (
  'SINGLE_AGENT', 'LOOP', 'SEQUENTIAL', 'DAG', 'DIAMOND', 'DISCOVERY_GRAPH'
);

create type public.graph_node_state as enum (
  'PENDING', 'READY', 'RUNNING', 'VERIFYING',
  'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'SKIPPED'
);

create type public.graph_edge_reason as enum (
  'DATA', 'RESOURCE_READ_AFTER_WRITE', 'RESOURCE_WRITE_CONFLICT',
  'VERIFICATION', 'POLICY'
);

create type public.graph_resource_kind as enum (
  'file', 'directory', 'migration', 'api', 'rate_limit',
  'external_service', 'deployment_environment', 'database_table'
);

create type public.graph_node_executor as enum ('DETERMINISTIC', 'MODEL', 'ANCHOR');

create type public.graph_run_state as enum (
  'PLANNED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'BUDGET_STOPPED'
);

create type public.verification_verdict as enum ('PASS', 'WARN', 'REJECT', 'BLOCK');

create type public.verification_lens as enum (
  'correctness', 'freshness', 'evidence', 'security', 'acceptance_criteria'
);

create type public.graph_work_lock_state as enum ('HELD', 'RELEASED', 'EXPIRED');

create type public.graph_artifact_kind as enum ('RAW', 'REDUCED', 'SYNTHESIS', 'ANCHOR');

-- ---------------------------------------------------------------------------
-- Templates and definitions
-- ---------------------------------------------------------------------------

create table public.graph_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (char_length(btrim(slug)) between 1 and 80),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text check (char_length(description) <= 2000),
  topology public.graph_topology not null,
  -- Node and edge shape, not provider accounts: a template says what work is
  -- done and in what order, never which credential does it.
  definition jsonb not null default '{}'::jsonb,
  default_budget jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version >= 1),
  is_archived boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graph_templates_slug_version_unique unique (organization_id, slug, version)
);

create table public.graphs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  template_id uuid references public.graph_templates(id) on delete set null,
  goal text not null check (char_length(btrim(goal)) between 1 and 4000),
  topology public.graph_topology not null,
  -- Why the planner chose this topology, kept so a reviewer can see whether
  -- the engine spent on parallelism and what it thought it was buying.
  topology_reasons jsonb not null default '[]'::jsonb,
  risk_level public.risk_level not null default 'green',
  requires_owner_approval boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graphs_id_organization_unique unique (id, organization_id),
  constraint graphs_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade
);

create table public.graph_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_id uuid not null,
  max_nodes integer not null default 50 check (max_nodes between 1 and 500),
  max_concurrent_nodes integer not null default 8 check (max_concurrent_nodes between 1 and 64),
  max_duration_ms bigint not null default 1800000 check (max_duration_ms > 0),
  max_retries integer not null default 10 check (max_retries >= 0),
  max_discovery_rounds integer not null default 5 check (max_discovery_rounds >= 0),
  -- Null means the provider does not report this, not "unlimited". Cost is
  -- only ever enforced against real declared pricing.
  max_tokens bigint check (max_tokens is null or max_tokens > 0),
  max_cost_micros bigint check (max_cost_micros is null or max_cost_micros > 0),
  created_at timestamptz not null default now(),
  constraint graph_budgets_graph_unique unique (graph_id),
  constraint graph_budgets_graph_fk foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete cascade
);

create table public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_id uuid not null,
  node_key text not null check (char_length(btrim(node_key)) between 1 and 120),
  job text not null check (char_length(btrim(job)) between 1 and 500),
  executor public.graph_node_executor not null,
  capability text not null check (char_length(btrim(capability)) between 1 and 60),
  -- Advisory tier. Routing still owns the final provider/model choice.
  model_tier text not null default 'STANDARD'
    check (model_tier in ('NONE', 'ECONOMY', 'STANDARD', 'STRONG')),
  agent_id uuid,
  risk_level public.risk_level not null default 'green',
  timeout_ms integer not null default 180000 check (timeout_ms between 1000 and 3600000),
  max_attempts integer not null default 2 check (max_attempts between 1 and 10),
  allow_provider_fallback boolean not null default true,
  created_at timestamptz not null default now(),
  constraint graph_nodes_id_organization_unique unique (id, organization_id),
  constraint graph_nodes_key_unique unique (graph_id, node_key),
  constraint graph_nodes_graph_fk foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete cascade
);

create table public.node_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  node_id uuid not null,
  input_schema jsonb not null,
  output_schema jsonb not null,
  -- Resources are typed because contention differs by kind: two nodes writing
  -- one file conflict, and two nodes sharing a rate limit also contend.
  reads jsonb not null default '[]'::jsonb,
  writes jsonb not null default '[]'::jsonb,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint node_contracts_node_unique unique (node_id),
  constraint node_contracts_node_fk foreign key (node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete cascade
);

create table public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_id uuid not null,
  from_node_id uuid not null,
  to_node_id uuid not null,
  reason public.graph_edge_reason not null,
  -- Not optional. An edge that cannot say why it exists is a fake edge, and
  -- fake edges are what turn a parallel graph into a queue.
  detail text not null check (char_length(btrim(detail)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint graph_edges_unique unique (graph_id, from_node_id, to_node_id),
  constraint graph_edges_no_self_loop check (from_node_id <> to_node_id),
  constraint graph_edges_graph_fk foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete cascade,
  constraint graph_edges_from_fk foreign key (from_node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete cascade,
  constraint graph_edges_to_fk foreign key (to_node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Execution
-- ---------------------------------------------------------------------------

create table public.graph_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_id uuid not null,
  state public.graph_run_state not null default 'PLANNED',
  -- Recorded so a run can report degradation honestly rather than silently
  -- finishing smaller than it started.
  nodes_started integer not null default 0 check (nodes_started >= 0),
  retries_used integer not null default 0 check (retries_used >= 0),
  discovery_rounds integer not null default 0 check (discovery_rounds >= 0),
  tokens_used bigint check (tokens_used is null or tokens_used >= 0),
  cost_micros bigint check (cost_micros is null or cost_micros >= 0),
  budget_action text check (
    budget_action is null or budget_action in
      ('CONTINUE', 'REDUCE_CONCURRENCY', 'PREFER_CHEAPER_MODEL', 'STOP_GRACEFULLY')
  ),
  -- A run that lost inputs must never present itself as whole.
  had_partial_input boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graph_runs_id_organization_unique unique (id, organization_id),
  constraint graph_runs_graph_fk foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete cascade
);

create table public.node_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_run_id uuid not null,
  node_id uuid not null,
  state public.graph_node_state not null default 'PENDING',
  attempt integer not null default 0 check (attempt >= 0),
  provider text check (provider is null or provider in ('anthropic', 'openai')),
  model text check (model is null or char_length(model) <= 128),
  routing_decision_id uuid,
  -- Why this node is not progressing, in the node's own row, so a stuck graph
  -- explains itself without cross-referencing an event log.
  blocked_reason text check (blocked_reason is null or char_length(blocked_reason) <= 1000),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint node_runs_id_organization_unique unique (id, organization_id),
  constraint node_runs_unique_attempt unique (graph_run_id, node_id, attempt),
  constraint node_runs_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade,
  constraint node_runs_node_fk foreign key (node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete cascade
);

create table public.graph_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_run_id uuid not null,
  node_run_id uuid,
  kind public.graph_artifact_kind not null,
  -- Raw and reduced are separate rows on purpose: a reduction is lossy, and the
  -- evidence behind a finding has to survive it.
  payload jsonb not null,
  item_count integer check (item_count is null or item_count >= 0),
  reduced_from_count integer check (reduced_from_count is null or reduced_from_count >= 0),
  created_at timestamptz not null default now(),
  constraint graph_artifacts_id_organization_unique unique (id, organization_id),
  constraint graph_artifacts_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade,
  constraint graph_artifacts_node_run_fk foreign key (node_run_id, organization_id)
    references public.node_runs(id, organization_id) on delete cascade
);

create table public.graph_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_run_id uuid not null,
  from_node_run_id uuid,
  to_node_id uuid not null,
  -- Validated against the RECEIVING node's input contract before it is stored,
  -- so a producer's idea of "done" cannot differ from the consumer's idea of
  -- "usable" without something noticing.
  contract_valid boolean not null,
  validation_issues jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  decisions jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  next_action text check (next_action is null or char_length(next_action) <= 1000),
  created_at timestamptz not null default now(),
  constraint graph_handoffs_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade,
  constraint graph_handoffs_from_fk foreign key (from_node_run_id, organization_id)
    references public.node_runs(id, organization_id) on delete cascade,
  constraint graph_handoffs_to_fk foreign key (to_node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete cascade
);

create table public.graph_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_run_id uuid not null,
  -- The node run being verified, and the agent doing the verifying. Keeping
  -- both means "an agent verified its own work" is a query, not a hope.
  subject_node_run_id uuid not null,
  verifier_agent_id uuid,
  verifier_provider text check (
    verifier_provider is null or verifier_provider in ('anthropic', 'openai')
  ),
  lens public.verification_lens not null,
  verdict public.verification_verdict not null,
  evidence jsonb not null default '[]'::jsonb,
  -- Recorded rather than assumed: a verifier handed the worker's context is
  -- checking coherence, not truth.
  shared_worker_context boolean not null default false,
  created_at timestamptz not null default now(),
  constraint graph_verifications_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade,
  constraint graph_verifications_subject_fk foreign key (subject_node_run_id, organization_id)
    references public.node_runs(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Locks
-- ---------------------------------------------------------------------------

create table public.graph_work_locks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  resource_kind public.graph_resource_kind not null,
  resource_id text not null check (char_length(btrim(resource_id)) between 1 and 500),
  graph_run_id uuid,
  node_run_id uuid,
  state public.graph_work_lock_state not null default 'HELD',
  acquired_at timestamptz not null default now(),
  -- A lock without a heartbeat is a deadlock waiting for a crashed holder.
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  constraint graph_work_locks_expiry_after_acquisition check (expires_at > acquired_at),
  constraint graph_work_locks_released_state check (
    (state = 'RELEASED') = (released_at is not null)
  ),
  constraint graph_work_locks_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint graph_work_locks_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade
);

-- One holder per resource per project, enforced by the database rather than by
-- the scheduler remembering to check. A partial index lets released and expired
-- rows accumulate as history without blocking the next acquisition.
create unique index graph_work_locks_one_active_holder
  on public.graph_work_locks (organization_id, project_id, resource_kind, resource_id)
  where state = 'HELD';

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table public.graph_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_run_id uuid not null,
  node_run_id uuid,
  event_type text not null check (char_length(btrim(event_type)) between 1 and 80),
  detail text check (detail is null or char_length(detail) <= 2000),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint graph_events_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade,
  constraint graph_events_node_run_fk foreign key (node_run_id, organization_id)
    references public.node_runs(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index graph_templates_organization_idx on public.graph_templates (organization_id, slug);
create index graphs_project_idx on public.graphs (organization_id, project_id, created_at desc);
create index graph_nodes_graph_idx on public.graph_nodes (graph_id);
create index graph_edges_graph_idx on public.graph_edges (graph_id);
create index graph_edges_to_idx on public.graph_edges (to_node_id);
create index graph_runs_graph_idx on public.graph_runs (organization_id, graph_id, created_at desc);
create index node_runs_run_idx on public.node_runs (graph_run_id, state);
create index node_runs_node_idx on public.node_runs (node_id);
create index graph_artifacts_run_idx on public.graph_artifacts (graph_run_id, kind);
create index graph_handoffs_run_idx on public.graph_handoffs (graph_run_id);
create index graph_verifications_subject_idx on public.graph_verifications (subject_node_run_id);
create index graph_work_locks_lookup_idx
  on public.graph_work_locks (organization_id, project_id, resource_kind, resource_id, state);
create index graph_work_locks_expiry_idx on public.graph_work_locks (state, expires_at);
create index graph_events_run_idx on public.graph_events (graph_run_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.graph_templates enable row level security;
alter table public.graph_templates force row level security;
alter table public.graphs enable row level security;
alter table public.graphs force row level security;
alter table public.graph_budgets enable row level security;
alter table public.graph_budgets force row level security;
alter table public.graph_nodes enable row level security;
alter table public.graph_nodes force row level security;
alter table public.node_contracts enable row level security;
alter table public.node_contracts force row level security;
alter table public.graph_edges enable row level security;
alter table public.graph_edges force row level security;
alter table public.graph_runs enable row level security;
alter table public.graph_runs force row level security;
alter table public.node_runs enable row level security;
alter table public.node_runs force row level security;
alter table public.graph_artifacts enable row level security;
alter table public.graph_artifacts force row level security;
alter table public.graph_handoffs enable row level security;
alter table public.graph_handoffs force row level security;
alter table public.graph_verifications enable row level security;
alter table public.graph_verifications force row level security;
alter table public.graph_work_locks enable row level security;
alter table public.graph_work_locks force row level security;
alter table public.graph_events enable row level security;
alter table public.graph_events force row level security;

create policy graph_templates_select_members on public.graph_templates
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graphs_select_members on public.graphs
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_budgets_select_members on public.graph_budgets
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_nodes_select_members on public.graph_nodes
  for select to authenticated using (public.is_organization_member(organization_id));
create policy node_contracts_select_members on public.node_contracts
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_edges_select_members on public.graph_edges
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_runs_select_members on public.graph_runs
  for select to authenticated using (public.is_organization_member(organization_id));
create policy node_runs_select_members on public.node_runs
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_artifacts_select_members on public.graph_artifacts
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_handoffs_select_members on public.graph_handoffs
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_verifications_select_members on public.graph_verifications
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_work_locks_select_members on public.graph_work_locks
  for select to authenticated using (public.is_organization_member(organization_id));
create policy graph_events_select_members on public.graph_events
  for select to authenticated using (public.is_organization_member(organization_id));

-- ---------------------------------------------------------------------------
-- Grants
--
-- Read through RLS; every write goes through a SECURITY DEFINER function, so a
-- compromised browser session cannot fabricate a verification verdict, release
-- another run's lock, or raise its own budget.
-- ---------------------------------------------------------------------------

revoke all on public.graph_templates from anon, authenticated;
revoke all on public.graphs from anon, authenticated;
revoke all on public.graph_budgets from anon, authenticated;
revoke all on public.graph_nodes from anon, authenticated;
revoke all on public.node_contracts from anon, authenticated;
revoke all on public.graph_edges from anon, authenticated;
revoke all on public.graph_runs from anon, authenticated;
revoke all on public.node_runs from anon, authenticated;
revoke all on public.graph_artifacts from anon, authenticated;
revoke all on public.graph_handoffs from anon, authenticated;
revoke all on public.graph_verifications from anon, authenticated;
revoke all on public.graph_work_locks from anon, authenticated;
revoke all on public.graph_events from anon, authenticated;

grant select on public.graph_templates to authenticated;
grant select on public.graphs to authenticated;
grant select on public.graph_budgets to authenticated;
grant select on public.graph_nodes to authenticated;
grant select on public.node_contracts to authenticated;
grant select on public.graph_edges to authenticated;
grant select on public.graph_runs to authenticated;
grant select on public.node_runs to authenticated;
grant select on public.graph_artifacts to authenticated;
grant select on public.graph_handoffs to authenticated;
grant select on public.graph_verifications to authenticated;
grant select on public.graph_work_locks to authenticated;
grant select on public.graph_events to authenticated;

-- ---------------------------------------------------------------------------
-- Lock acquisition and recovery
-- ---------------------------------------------------------------------------

-- Acquire a lock, reclaiming one whose holder died.
--
-- Expiry is evaluated inside the same statement that acquires, so a crashed
-- worker's lock cannot wedge a project forever and two callers cannot both
-- decide an expired lock is theirs.
create or replace function public.acquire_graph_work_lock(
  p_organization_id uuid,
  p_project_id uuid,
  p_resource_kind public.graph_resource_kind,
  p_resource_id text,
  p_graph_run_id uuid,
  p_node_run_id uuid,
  p_lease_seconds integer default 300
)
returns public.graph_work_locks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.graph_work_locks;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'invalid_lease' using errcode = '22023';
  end if;

  -- Retire anything whose lease ran out before contending for the resource.
  update public.graph_work_locks
     set state = 'EXPIRED'
   where organization_id = p_organization_id
     and project_id = p_project_id
     and resource_kind = p_resource_kind
     and resource_id = p_resource_id
     and state = 'HELD'
     and expires_at <= now();

  insert into public.graph_work_locks (
    organization_id, project_id, resource_kind, resource_id,
    graph_run_id, node_run_id, state, expires_at
  )
  values (
    p_organization_id, p_project_id, p_resource_kind, p_resource_id,
    p_graph_run_id, p_node_run_id, 'HELD',
    now() + make_interval(secs => p_lease_seconds)
  )
  returning * into v_lock;

  return v_lock;
exception
  when unique_violation then
    -- Someone else holds it. A refusal, not an error the caller must parse.
    raise exception 'resource_locked' using errcode = '55006';
end;
$$;

create or replace function public.heartbeat_graph_work_lock(
  p_lock_id uuid,
  p_lease_seconds integer default 300
)
returns public.graph_work_locks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.graph_work_locks;
begin
  update public.graph_work_locks
     set heartbeat_at = now(),
         expires_at = now() + make_interval(secs => greatest(1, least(3600, p_lease_seconds)))
   where id = p_lock_id
     and state = 'HELD'
     and public.is_organization_member(organization_id)
  returning * into v_lock;

  if v_lock.id is null then
    raise exception 'lock_not_held' using errcode = '55006';
  end if;

  return v_lock;
end;
$$;

create or replace function public.release_graph_work_lock(p_lock_id uuid)
returns public.graph_work_locks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.graph_work_locks;
begin
  update public.graph_work_locks
     set state = 'RELEASED', released_at = now()
   where id = p_lock_id
     and state = 'HELD'
     and public.is_organization_member(organization_id)
  returning * into v_lock;

  if v_lock.id is null then
    raise exception 'lock_not_held' using errcode = '55006';
  end if;

  return v_lock;
end;
$$;

-- Sweep abandoned locks. Safe to call repeatedly; returns how many it retired.
create or replace function public.expire_abandoned_graph_work_locks(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  update public.graph_work_locks
     set state = 'EXPIRED'
   where organization_id = p_organization_id
     and state = 'HELD'
     and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.acquire_graph_work_lock(
  uuid, uuid, public.graph_resource_kind, text, uuid, uuid, integer
) from public, anon;
revoke all on function public.heartbeat_graph_work_lock(uuid, integer) from public, anon;
revoke all on function public.release_graph_work_lock(uuid) from public, anon;
revoke all on function public.expire_abandoned_graph_work_locks(uuid) from public, anon;

grant execute on function public.acquire_graph_work_lock(
  uuid, uuid, public.graph_resource_kind, text, uuid, uuid, integer
) to authenticated;
grant execute on function public.heartbeat_graph_work_lock(uuid, integer) to authenticated;
grant execute on function public.release_graph_work_lock(uuid) to authenticated;
grant execute on function public.expire_abandoned_graph_work_locks(uuid) to authenticated;
