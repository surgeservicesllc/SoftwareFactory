-- Truthful, tenant-scoped lineage from an Agentic SDLC graph through the
-- existing Phase 1C and release evidence. This is a storage and RPC boundary;
-- it does not claim, dispatch, merge, deploy, monitor, or enable a worker.

-- This cutover replaces legacy worker completion signatures with atomic graph
-- bridge wrappers. It is deliberately maintenance-window-only: fail before
-- any DDL unless execution is globally off and every old worker has drained.
do $graph_phase1c_worker_drain_preflight$
declare
  signature text;
  routine regprocedure;
begin
  -- 00150 commits the authority revocation first. Refuse a bundled apply if
  -- an old call that began before that commit is still active or still owns a
  -- lock on a claim source; a retry after it drains is safe and forward-only.
  foreach signature in array array[
    'start_graph_run(uuid)',
    'claim_planned_graph(text,text[])',
    'claim_phase1c_run(text,text,text,integer)',
    'decide_node_gate(uuid,boolean,text)',
    'record_node_state(uuid,public.graph_node_state,text,text,text,integer)',
    'complete_graph_run(uuid,public.graph_run_state,boolean,bigint,bigint,text)',
    'record_handoff(uuid,uuid,jsonb,boolean,jsonb,uuid,jsonb,jsonb,jsonb,text)',
    'record_graph_artifact(uuid,public.graph_artifact_kind,jsonb,uuid,integer,integer)',
    'record_verification(uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)'
  ]
  loop
    routine := pg_catalog.to_regprocedure('public.' || signature);
    if routine is null
      or pg_catalog.has_function_privilege('anon', routine, 'execute')
      or pg_catalog.has_function_privilege('authenticated', routine, 'execute')
      or pg_catalog.has_function_privilege('service_role', routine, 'execute')
    then
      raise exception using errcode = '55000',
        message = 'legacy graph protocol authority fence is not committed';
    end if;
  end loop;
  if exists (
    select 1
    from pg_catalog.pg_stat_activity activity
    where activity.pid <> pg_catalog.pg_backend_pid()
      and activity.datid = (select database.oid from pg_catalog.pg_database database
                            where database.datname = pg_catalog.current_database())
      and activity.state <> 'idle'
      and activity.query ~* '(start_graph_run|claim_planned_graph|claim_phase1c_run|decide_node_gate|record_node_state|complete_graph_run|record_handoff|record_graph_artifact|record_verification)'
  ) or exists (
    select 1
    from pg_catalog.pg_locks held_lock
    where held_lock.pid <> pg_catalog.pg_backend_pid()
      and held_lock.granted
      and held_lock.relation in (
        'public.graphs'::regclass,
        'public.graph_runs'::regclass,
        'public.agent_runs'::regclass,
        'public.node_runs'::regclass,
        'public.graph_gates'::regclass,
        'public.graph_artifacts'::regclass,
        'public.graph_handoffs'::regclass,
        'public.graph_verifications'::regclass
      )
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph protocol call is still draining; retry the forward migration after it exits';
  end if;

  -- Held to transaction commit. Freeze the execution switches first, then
  -- fence claim sources at their entry tables. graph_runs comes before graphs
  -- because the legacy graph claim first takes ROW SHARE there while scanning
  -- stale runs and only later locks a graph; reversing that order can deadlock
  -- with an already-entered claimer. EXCLUSIVE deliberately conflicts with
  -- SELECT ... FOR UPDATE: old claimers must finish before these locks are
  -- granted and no new old claimer can cross the checked protocol cutover.
  lock table public.organizations in share mode;
  lock table public.projects in share mode;
  lock table public.graph_runs in exclusive mode;
  lock table public.graphs in exclusive mode;
  lock table public.node_runs in exclusive mode;
  lock table public.graph_gates in exclusive mode;
  lock table public.graph_artifacts in exclusive mode;
  lock table public.graph_handoffs in exclusive mode;
  lock table public.graph_verifications in exclusive mode;
  lock table public.agent_runs in exclusive mode;

  if exists (
    select 1 from public.organizations organization
    where organization.autonomous_mode
      or not organization.autonomy_kill_switch_active
  ) or exists (
    select 1 from public.projects project
    where project.autonomous_mode
  ) then
    raise exception using errcode = '55000',
      message = 'graph Phase 1C cutover requires autonomy off and the global kill switch on';
  end if;

  if exists (
    select 1 from public.graph_runs run
    where run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs run
    where run.status = 'running'::public.run_status
  ) then
    raise exception using errcode = '55000',
      message = 'graph Phase 1C cutover requires a drained worker fleet with no in-flight runs';
  end if;
end;
$graph_phase1c_worker_drain_preflight$;

-- A lifecycle graph must name the exact template and repository snapshot that
-- it was launched from before it can be bridged to Phase 1C.
alter table public.graphs
  add column if not exists template_key text,
  add column if not exists template_version integer,
  add column if not exists template_plan_sha256 text,
  add column if not exists github_repository_id uuid,
  add column if not exists base_branch text,
  add column if not exists base_sha text,
  add column if not exists required_check_names jsonb,
  add column if not exists required_checks_sha256 text;

create or replace function public.graph_required_check_policy_is_safe(input_value jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $function$
declare
  check_name jsonb;
begin
  if input_value is null or pg_catalog.jsonb_typeof(input_value) <> 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(input_value) not between 1 and 20 then
    return false;
  end if;
  for check_name in
    select element.value
    from pg_catalog.jsonb_array_elements(input_value) element(value)
  loop
    if pg_catalog.jsonb_typeof(check_name) <> 'string'
      or check_name #>> '{}' is distinct from pg_catalog.btrim(check_name #>> '{}')
      or pg_catalog.char_length(check_name #>> '{}') not between 1 and 160
      or pg_catalog.strpos(check_name #>> '{}', '|') > 0
      or public.text_has_likely_secret(check_name #>> '{}')
    then
      return false;
    end if;
  end loop;
  return (
    select pg_catalog.count(distinct element.value #>> '{}')
    from pg_catalog.jsonb_array_elements(input_value) element(value)
  ) = pg_catalog.jsonb_array_length(input_value);
end;
$function$;

revoke all on function public.graph_required_check_policy_is_safe(jsonb)
  from public, anon, authenticated, service_role;

-- A release policy is repository-owned evidence at the graph's exact base
-- commit. Guessing one for an older graph would make a global application
-- default look like that repository's rule, so legacy release graphs without
-- an already-persisted exact policy stop the cutover for forward repair.
do $graph_required_check_policy_preflight$
begin
  if exists (
    select 1
    from public.graphs graph
    where graph.template_key = 'full_lifecycle'
      and graph.template_version = 2
      and (
        graph.required_check_names is null
        or graph.required_checks_sha256 is null
        or not public.graph_required_check_policy_is_safe(graph.required_check_names)
      )
  ) then
    raise exception using errcode = '55000',
      message = 'legacy full_lifecycle v2 graph lacks an exact repository release policy';
  end if;
end;
$graph_required_check_policy_preflight$;

do $graph_release_identity_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_template_key_format'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_template_key_format check (
      template_key is null or template_key ~ '^[a-z][a-z0-9_]{0,79}$'
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_template_version_positive'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_template_version_positive
      check (template_version is null or template_version > 0);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_template_identity_together'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_template_identity_together check (
      (template_key is null and template_version is null and template_plan_sha256 is null)
      or (template_key is not null and template_version is not null
        and template_plan_sha256 is not null)
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_template_plan_sha256_exact'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_template_plan_sha256_exact check (
      template_plan_sha256 is null or template_plan_sha256 ~ '^[0-9a-f]{64}$'
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_base_branch_bounded'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_base_branch_bounded check (
      base_branch is null or char_length(btrim(base_branch)) between 1 and 255
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_base_sha_exact'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_base_sha_exact check (
      base_sha is null or base_sha ~ '^[0-9a-f]{40}$'
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_repository_snapshot_together'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_repository_snapshot_together check (
      (github_repository_id is null and base_branch is null and base_sha is null)
      or (github_repository_id is not null and base_branch is not null and base_sha is not null)
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_github_repository_fk'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_github_repository_fk
      foreign key (github_repository_id, organization_id)
      references public.github_repositories(id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_required_check_policy_safe'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_required_check_policy_safe check (
      (required_check_names is null and required_checks_sha256 is null)
      or (
        public.graph_required_check_policy_is_safe(required_check_names)
        and required_checks_sha256 = pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(required_check_names::text, 'UTF8')
        ), 'hex')
      )
    );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graphs_full_lifecycle_requires_check_policy'
      and conrelid = 'public.graphs'::regclass
  ) then
    alter table public.graphs add constraint graphs_full_lifecycle_requires_check_policy check (
      template_key is distinct from 'full_lifecycle'
      or template_version is distinct from 2
      or (required_check_names is not null and required_checks_sha256 is not null)
    );
  end if;
end;
$graph_release_identity_constraints$;

create index if not exists graphs_repository_snapshot_idx
  on public.graphs (organization_id, github_repository_id, base_sha)
  where github_repository_id is not null;

-- PR rows previously recorded only branch names. The nullable additions keep
-- old rows truthful while allowing new release lineage to require exact SHAs.
alter table public.pull_requests
  add column if not exists head_sha text,
  add column if not exists merge_commit_sha text;

do $pull_request_commit_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'pull_requests_head_sha_exact'
      and conrelid = 'public.pull_requests'::regclass
  ) then
    alter table public.pull_requests add constraint pull_requests_head_sha_exact
      check (head_sha is null or head_sha ~ '^[0-9a-f]{40}$');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'pull_requests_merge_commit_sha_exact'
      and conrelid = 'public.pull_requests'::regclass
  ) then
    alter table public.pull_requests add constraint pull_requests_merge_commit_sha_exact
      check (merge_commit_sha is null or merge_commit_sha ~ '^[0-9a-f]{40}$');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'pull_requests_merge_commit_evidence'
      and conrelid = 'public.pull_requests'::regclass
  ) then
    alter table public.pull_requests add constraint pull_requests_merge_commit_evidence check (
      merge_commit_sha is null
      or (head_sha is not null and status = 'merged'::public.pull_request_status and merged_at is not null)
    );
  end if;
end;
$pull_request_commit_constraints$;

create index if not exists pull_requests_head_sha_idx
  on public.pull_requests (organization_id, head_sha)
  where head_sha is not null;
create index if not exists pull_requests_merge_commit_sha_idx
  on public.pull_requests (organization_id, merge_commit_sha)
  where merge_commit_sha is not null;

-- GitHub's deployment id is provider-global within one tenant. Refuse to add
-- the arbiter until legacy history is unambiguous; otherwise an ON CONFLICT
-- retry could silently choose one of two contradictory release observations.
do $github_deployment_identity_preflight$
begin
  if exists (
    select 1 from public.graph_gates gate
    where gate.opened_by_run_id is null
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph gates without exact opener identity must be contained before release lineage can be installed';
  end if;

  if exists (
    select 1
    from public.deployments deployment
    where deployment.provider = 'github'
      and deployment.external_reference is not null
    group by deployment.organization_id, deployment.provider,
      deployment.external_reference
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '55000',
      message = 'duplicate GitHub deployment identities must be contained before release lineage can be installed';
  end if;

  if pg_catalog.to_regclass(
      'public.deployments_github_external_identity_unique'
    ) is not null
    and not exists (
      select 1
      from pg_catalog.pg_index index_catalog
      where index_catalog.indexrelid = pg_catalog.to_regclass(
          'public.deployments_github_external_identity_unique'
        )
        and index_catalog.indrelid = 'public.deployments'::regclass
        and index_catalog.indisunique
        and index_catalog.indisvalid
        and index_catalog.indnkeyatts = 3
        and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true)
          = 'organization_id'
        and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true)
          = 'provider'
        and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 3, true)
          = 'external_reference'
        and pg_catalog.pg_get_expr(index_catalog.indpred, index_catalog.indrelid)
          = '((provider = ''github''::text) AND (external_reference IS NOT NULL))'
    )
  then
    raise exception using errcode = '55000',
      message = 'GitHub deployment identity arbiter name has incompatible semantics';
  end if;
end;
$github_deployment_identity_preflight$;

create unique index if not exists deployments_github_external_identity_unique
  on public.deployments (organization_id, provider, external_reference)
  where provider = 'github' and external_reference is not null;

-- A monitor observation may identify the exact deployment it observed. The
-- composite FK prevents a cross-tenant link; the trigger below also requires
-- the deployment and observation to belong to the same project.
alter table public.monitor_observations
  add column if not exists deployment_id uuid;

do $monitor_deployment_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'monitor_observations_deployment_fk'
      and conrelid = 'public.monitor_observations'::regclass
  ) then
    alter table public.monitor_observations add constraint monitor_observations_deployment_fk
      foreign key (deployment_id, organization_id)
      references public.deployments(id, organization_id) on delete restrict;
  end if;
end;
$monitor_deployment_constraint$;

create index if not exists monitor_observations_deployment_idx
  on public.monitor_observations (organization_id, deployment_id, observed_at desc)
  where deployment_id is not null;

-- Gate approvals below treat opened_by_run_id as evidence identity. Repairing
-- that old nullable/non-FK column starts by refusing any already-dangling or
-- cross-graph value, then makes the tenant-scoped run link durable.
do $graph_gate_opened_run_preflight$
begin
  if exists (
    select 1
    from public.graph_gates gate
    where gate.opened_by_run_id is not null
      and not exists (
        select 1
        from public.graph_runs run
        join public.graph_nodes node
          on node.id = gate.node_id
         and node.organization_id = gate.organization_id
         and node.graph_id = gate.graph_id
        join public.node_runs node_run
          on node_run.graph_run_id = run.id
         and node_run.organization_id = run.organization_id
         and node_run.node_id = node.id
        where run.id = gate.opened_by_run_id
          and run.organization_id = gate.organization_id
          and run.graph_id = gate.graph_id
      )
  ) then
    raise exception using errcode = '55000',
      message = 'graph gate opener history is dangling or cross-graph';
  end if;

  if exists (
      select 1 from pg_catalog.pg_constraint constraint_catalog
      where constraint_catalog.conname = 'graph_gates_opened_run_fk'
        and constraint_catalog.conrelid = 'public.graph_gates'::regclass
    ) and not exists (
      select 1
      from pg_catalog.pg_constraint constraint_catalog
      where constraint_catalog.conname = 'graph_gates_opened_run_fk'
        and constraint_catalog.conrelid = 'public.graph_gates'::regclass
        and constraint_catalog.contype = 'f'
        and constraint_catalog.convalidated
        and constraint_catalog.confrelid = 'public.graph_runs'::regclass
        and constraint_catalog.confdeltype = 'r'
        and constraint_catalog.conkey = array[
          (
            select attribute.attnum from pg_catalog.pg_attribute attribute
            where attribute.attrelid = 'public.graph_gates'::regclass
              and attribute.attname = 'opened_by_run_id'
          ),
          (
            select attribute.attnum from pg_catalog.pg_attribute attribute
            where attribute.attrelid = 'public.graph_gates'::regclass
              and attribute.attname = 'organization_id'
          )
        ]::smallint[]
        and constraint_catalog.confkey = array[
          (
            select attribute.attnum from pg_catalog.pg_attribute attribute
            where attribute.attrelid = 'public.graph_runs'::regclass
              and attribute.attname = 'id'
          ),
          (
            select attribute.attnum from pg_catalog.pg_attribute attribute
            where attribute.attrelid = 'public.graph_runs'::regclass
              and attribute.attname = 'organization_id'
          )
        ]::smallint[]
    )
  then
    raise exception using errcode = '55000',
      message = 'graph gate opener constraint name has incompatible semantics';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_gates_opened_run_fk'
      and conrelid = 'public.graph_gates'::regclass
  ) then
    alter table public.graph_gates add constraint graph_gates_opened_run_fk
      foreign key (opened_by_run_id, organization_id)
      references public.graph_runs(id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_runs_id_organization_graph_unique'
      and conrelid = 'public.graph_runs'::regclass
  ) then
    alter table public.graph_runs
      add constraint graph_runs_id_organization_graph_unique
      unique (id, organization_id, graph_id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_nodes_id_organization_graph_unique'
      and conrelid = 'public.graph_nodes'::regclass
  ) then
    alter table public.graph_nodes
      add constraint graph_nodes_id_organization_graph_unique
      unique (id, organization_id, graph_id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_gates_opened_run_graph_fk'
      and conrelid = 'public.graph_gates'::regclass
  ) then
    alter table public.graph_gates
      add constraint graph_gates_opened_run_graph_fk
      foreign key (opened_by_run_id, organization_id, graph_id)
      references public.graph_runs(id, organization_id, graph_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_gates_node_graph_fk'
      and conrelid = 'public.graph_gates'::regclass
  ) then
    alter table public.graph_gates
      add constraint graph_gates_node_graph_fk
      foreign key (node_id, organization_id, graph_id)
      references public.graph_nodes(id, organization_id, graph_id)
      on delete cascade;
  end if;

  alter table public.graph_gates alter column opened_by_run_id set not null;
end;
$graph_gate_opened_run_preflight$;

create or replace function public.enforce_graph_gate_opened_run_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.graph_id is distinct from old.graph_id
    or new.node_id is distinct from old.node_id
  ) then
    raise exception using errcode = '55000',
      message = 'graph gate tenant, graph, and node identity are immutable';
  end if;

  if new.opened_by_run_id is null or not exists (
    select 1
    from public.graph_runs run
    join public.node_runs node_run
      on node_run.graph_run_id = run.id
     and node_run.organization_id = run.organization_id
     and node_run.node_id = new.node_id
    where run.id = new.opened_by_run_id
      and run.organization_id = new.organization_id
      and run.graph_id = new.graph_id
      and run.state = 'RUNNING'::public.graph_run_state
      and node_run.state in (
        'VERIFYING'::public.graph_node_state,
        'COMPLETED'::public.graph_node_state
      )
  ) then
    raise exception using errcode = '23514',
      message = 'gate opener must be the running exact graph and node run';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_graph_gate_opened_run_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists graph_gates_opened_run_identity on public.graph_gates;
create trigger graph_gates_opened_run_identity
  before insert or update of organization_id, graph_id, node_id, opened_by_run_id
  on public.graph_gates
  for each row execute function public.enforce_graph_gate_opened_run_identity();

-- This table postdates the repository-wide hosted grant normalization. It is
-- never a service-role DML surface: every worker/server transition goes through
-- a fail-closed SECURITY DEFINER RPC.
revoke all on table public.graph_gates from service_role;

create or replace function public.enforce_graph_release_identity_write_once()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  -- The launch wrapper establishes these NULL fields before its transaction
  -- commits. Once any identity value exists, it can never be changed or
  -- cleared; no separately callable retrofit RPC is exposed.
  if (old.template_key is not null and new.template_key is distinct from old.template_key)
    or (old.template_version is not null and new.template_version is distinct from old.template_version)
    or (old.template_plan_sha256 is not null
      and new.template_plan_sha256 is distinct from old.template_plan_sha256)
    or (old.github_repository_id is not null and new.github_repository_id is distinct from old.github_repository_id)
    or (old.base_branch is not null and new.base_branch is distinct from old.base_branch)
    or (old.base_sha is not null and new.base_sha is distinct from old.base_sha)
    or (old.required_check_names is not null
      and new.required_check_names is distinct from old.required_check_names)
    or (old.required_checks_sha256 is not null
      and new.required_checks_sha256 is distinct from old.required_checks_sha256)
  then
    raise exception using errcode = '55000',
      message = 'graph release identity is write-once';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_graph_release_identity_write_once()
  from public, anon, authenticated, service_role;

drop trigger if exists graphs_release_identity_write_once on public.graphs;
create trigger graphs_release_identity_write_once
  before update of template_key, template_version, template_plan_sha256,
    github_repository_id, base_branch, base_sha, required_check_names,
    required_checks_sha256
  on public.graphs
  for each row execute function public.enforce_graph_release_identity_write_once();

-- Launch the one built-in graph that crosses into Phase 1C and persist its
-- exact repository snapshot in the same transaction. There is deliberately no
-- RPC that can add or change this identity on an already-created graph.
create or replace function public.create_graph_from_plan_with_release_identity_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb,
  p_template_key text,
  p_template_version integer,
  p_github_repository_id uuid,
  p_base_branch text,
  p_base_sha text,
  p_required_check_names jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  graph_record public.graphs%rowtype;
  created_graph_id uuid;
  node_keys text[];
  edge_keys text[];
  feedback_edge_keys text[];
  valid_anchor_nodes integer;
  canonical_template_sha256 text;
  required_check_names_value jsonb;
  required_checks_sha256_value text;
  expected_template_sha256 constant text :=
    'ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09';
  expected_node_keys constant text[] := array[
    'architecture', 'consolidate', 'decide', 'deploy', 'evaluate', 'goal',
    'implement', 'monitor', 'recall_ecosystem', 'requirements', 'review',
    'scan_dependencies', 'scan_internal', 'test'
  ];
  expected_edge_keys constant text[] := array[
    'architecture>implement', 'consolidate>evaluate', 'decide>architecture',
    'deploy>monitor', 'evaluate>decide', 'goal>requirements',
    'implement>review', 'recall_ecosystem>consolidate',
    'requirements>recall_ecosystem', 'requirements>scan_dependencies',
    'requirements>scan_internal', 'review>test',
    'scan_dependencies>consolidate', 'scan_internal>consolidate', 'test>deploy'
  ];
  expected_feedback_edge_keys constant text[] := array[
    'architecture>decide', 'decide>evaluate', 'monitor>goal', 'review>implement', 'test>implement'
  ];
begin
  required_check_names_value := p_required_check_names;
  if not public.graph_required_check_policy_is_safe(required_check_names_value) then
    raise exception using errcode = '22023',
      message = 'an exact repository-owned required-check policy is required';
  end if;
  required_checks_sha256_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(required_check_names_value::text, 'UTF8')
  ), 'hex');
  if p_requested_by is null or not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_requested_by
      and member.role = 'owner'
  ) then
    raise exception using errcode = '42501',
      message = 'an exact organization owner request identity is required';
  end if;
  -- The generic graph builder records auth.uid() as immutable provenance.
  -- This server-only boundary has already proven the exact owner, so expose
  -- only that identity to the nested builder for this transaction.
  perform pg_catalog.set_config('request.jwt.claim.sub', p_requested_by::text, true);

  if p_template_key is distinct from 'full_lifecycle'
    or p_template_version is distinct from 2
    or p_topology is distinct from 'DAG'::public.graph_topology
    or p_risk_level is distinct from 'yellow'::public.risk_level
    or p_github_repository_id is null
    or p_base_branch is null or char_length(btrim(p_base_branch)) not between 1 and 255
    or p_base_sha is null or p_base_sha !~ '^[0-9a-f]{40}$'
  then
    raise exception using errcode = '22023',
      message = 'exact built-in full_lifecycle v2 launch identity is required';
  end if;

  canonical_template_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'topology', p_topology::text,
        'topologyReasons', p_topology_reasons,
        'riskLevel', p_risk_level::text,
        'requiresOwnerApproval', p_requires_owner_approval,
        'nodes', p_nodes,
        'edges', p_edges,
        'budget', p_budget
      )::text,
      'UTF8'
    )),
    'hex'
  );
  if canonical_template_sha256 is distinct from expected_template_sha256 then
    raise exception using errcode = '23514',
      message = 'full_lifecycle v2 plan does not match its canonical digest';
  end if;

  select * into project_record
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = project_record.organization_id
      and member.user_id = p_requested_by
      and member.role = 'owner'
  ) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required for full lifecycle launch';
  end if;
  if project_record.default_branch is distinct from btrim(p_base_branch) then
    raise exception using errcode = '23514',
      message = 'base branch does not match the project default branch';
  end if;

  if not exists (
    select 1
    from public.project_connections link
    join public.connections connection
      on connection.id = link.connection_id
     and connection.organization_id = link.organization_id
    join public.github_repositories repository
      on repository.id = link.github_repository_id
     and repository.organization_id = link.organization_id
    join public.github_installations installation
      on installation.id = repository.installation_id
     and installation.organization_id = repository.organization_id
    where link.organization_id = project_record.organization_id
      and link.project_id = project_record.id
      and link.is_primary
      and link.github_repository_id = p_github_repository_id
      and connection.provider = 'github'::public.connection_provider
      and connection.status = 'connected'::public.connection_status
      and repository.selected
      and not repository.archived
      and not repository.disabled
      and repository.default_branch = btrim(p_base_branch)
      and installation.status = 'active'
      and installation.suspended_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'connected selected GitHub default-branch identity is required';
  end if;

  created_graph_id := public.create_graph_from_plan(
    p_organization_id,
    p_project_id,
    p_goal,
    p_topology,
    p_topology_reasons,
    p_risk_level,
    p_requires_owner_approval,
    p_nodes,
    p_edges,
    p_budget
  );

  select * into graph_record
  from public.graphs graph
  where graph.id = created_graph_id
    and graph.organization_id = project_record.organization_id
    and graph.project_id = project_record.id
  for update;

  if not found or not graph_record.is_lifecycle then
    raise exception using errcode = '55000',
      message = 'full lifecycle launch did not create a lifecycle graph';
  end if;

  select array_agg(node.node_key order by node.node_key),
         count(*) filter (where
           (node.node_key = 'architecture'
             and node.executor = 'MODEL'::public.graph_node_executor
             and node.lifecycle_stage = 'ARCHITECTURE'::public.sdlc_stage
             and node.gate_kind = 'HUMAN'::public.gate_kind)
           or (node.node_key = 'implement'
             and node.executor = 'ANCHOR'::public.graph_node_executor
             and node.lifecycle_stage = 'IMPLEMENTATION'::public.sdlc_stage
             and node.gate_kind is null)
           or (node.node_key = 'review'
             and node.executor = 'ANCHOR'::public.graph_node_executor
             and node.lifecycle_stage = 'REVIEW'::public.sdlc_stage
             and node.gate_kind is null)
           or (node.node_key = 'test'
             and node.executor = 'ANCHOR'::public.graph_node_executor
             and node.lifecycle_stage = 'TEST'::public.sdlc_stage
             and node.gate_kind = 'HUMAN'::public.gate_kind)
           or (node.node_key = 'deploy'
             and node.executor = 'ANCHOR'::public.graph_node_executor
             and node.lifecycle_stage = 'DEPLOYMENT'::public.sdlc_stage
             and node.gate_kind = 'HUMAN'::public.gate_kind)
           or (node.node_key = 'monitor'
             and node.executor = 'ANCHOR'::public.graph_node_executor
             and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage
             and node.gate_kind is null)
         )::integer
    into node_keys, valid_anchor_nodes
  from public.graph_nodes node
  where node.graph_id = graph_record.id
    and node.organization_id = graph_record.organization_id;

  if node_keys is distinct from expected_node_keys or valid_anchor_nodes <> 6 then
    raise exception using errcode = '23514',
      message = 'graph does not match the built-in full_lifecycle v2 structural contract';
  end if;

  select
    array_agg(source.node_key || '>' || target.node_key
      order by source.node_key || '>' || target.node_key)
      filter (where not edge.is_feedback),
    array_agg(source.node_key || '>' || target.node_key
      order by source.node_key || '>' || target.node_key)
      filter (where edge.is_feedback)
    into edge_keys, feedback_edge_keys
  from public.graph_edges edge
  join public.graph_nodes source on source.id = edge.from_node_id
  join public.graph_nodes target on target.id = edge.to_node_id
  where edge.graph_id = graph_record.id
    and edge.organization_id = graph_record.organization_id;

  if edge_keys is distinct from expected_edge_keys
    or feedback_edge_keys is distinct from expected_feedback_edge_keys
  then
    raise exception using errcode = '23514',
      message = 'graph edges do not match the built-in full_lifecycle v2 structural contract';
  end if;

  update public.graphs
  set template_key = p_template_key,
      template_version = p_template_version,
      template_plan_sha256 = canonical_template_sha256,
      github_repository_id = p_github_repository_id,
      base_branch = btrim(p_base_branch),
      base_sha = p_base_sha,
      required_check_names = required_check_names_value,
      required_checks_sha256 = required_checks_sha256_value,
      updated_at = now()
  where id = graph_record.id
    and template_key is null
    and template_version is null
    and template_plan_sha256 is null
    and github_repository_id is null
    and base_branch is null
    and base_sha is null
    and required_check_names is null
    and required_checks_sha256 is null;

  if not found then
    raise exception using errcode = '55000',
      message = 'graph launch identity was not empty';
  end if;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    graph_record.organization_id,
    graph_record.project_id,
    p_requested_by,
    'lifecycle.graph_created'::public.activity_event_type,
    'graph',
    graph_record.id,
    'Full lifecycle launch identity recorded.',
    jsonb_build_object(
      'template_key', p_template_key,
      'template_version', p_template_version,
      'template_plan_sha256', canonical_template_sha256,
      'github_repository_id', p_github_repository_id,
      'base_branch', btrim(p_base_branch),
      'base_sha', p_base_sha
    )
  );

  return graph_record.id;
end;
$function$;

revoke all on function public.create_graph_from_plan_with_release_identity_as_server(
  uuid, uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean,
  jsonb, jsonb, jsonb, text, integer, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_graph_from_plan_with_release_identity_as_server(
  uuid, uuid, uuid, text, public.graph_topology, jsonb, public.risk_level, boolean,
  jsonb, jsonb, jsonb, text, integer, uuid, text, text, jsonb
) to service_role;

create or replace function public.enforce_pull_request_commit_identity_write_once()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if (old.head_sha is not null and new.head_sha is distinct from old.head_sha)
    or (old.merge_commit_sha is not null and new.merge_commit_sha is distinct from old.merge_commit_sha)
  then
    raise exception using errcode = '55000',
      message = 'pull request commit identity is write-once';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_pull_request_commit_identity_write_once()
  from public, anon, authenticated, service_role;

drop trigger if exists pull_requests_commit_identity_write_once on public.pull_requests;
create trigger pull_requests_commit_identity_write_once
  before update of head_sha, merge_commit_sha on public.pull_requests
  for each row execute function public.enforce_pull_request_commit_identity_write_once();

create or replace function public.validate_monitor_observation_deployment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.deployment_id is not null and not exists (
    select 1
    from public.deployments deployment
    where deployment.id = new.deployment_id
      and deployment.organization_id = new.organization_id
      and deployment.project_id = new.project_id
  ) then
    raise exception using errcode = '23514',
      message = 'monitor observation deployment must belong to the same tenant project';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_monitor_observation_deployment()
  from public, anon, authenticated, service_role;

drop trigger if exists monitor_observations_validate_deployment on public.monitor_observations;
create trigger monitor_observations_validate_deployment
  before insert or update of organization_id, project_id, deployment_id
  on public.monitor_observations
  for each row execute function public.validate_monitor_observation_deployment();

create table public.graph_phase1c_bridges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  graph_id uuid not null,
  graph_run_id uuid not null,
  implementation_node_id uuid not null,
  architecture_gate_id uuid not null,
  architecture_artifact_id uuid not null,
  architecture_intent_sha256 text not null check (
    architecture_intent_sha256 ~ '^[0-9a-f]{64}$'
  ),
  command_id uuid,
  task_id uuid,
  agent_run_id uuid,
  pull_request_id uuid,
  head_sha text,
  merge_commit_sha text,
  deployment_id uuid,
  monitor_observation_id uuid,
  deployment_validation_id uuid,
  state text not null default 'GRAPH_READY' check (
    state in (
      'GRAPH_READY', 'COMMAND_RECORDED', 'PHASE1C_BOUND', 'PULL_REQUEST_RECORDED',
      'MERGE_RECORDED', 'DEPLOYMENT_RECORDED',
      'MONITORING_RECORDED', 'VALIDATED'
    )
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graph_phase1c_bridges_id_organization_unique unique (id, organization_id),
  constraint graph_phase1c_bridges_graph_run_unique unique (graph_run_id),
  constraint graph_phase1c_bridges_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_graph_fk foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_graph_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_implementation_node_fk
    foreign key (implementation_node_id, organization_id)
    references public.graph_nodes(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_architecture_gate_fk
    foreign key (architecture_gate_id, organization_id)
    references public.graph_gates(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_architecture_artifact_fk
    foreign key (architecture_artifact_id, organization_id)
    references public.graph_artifacts(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_command_fk foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_agent_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_pull_request_fk foreign key (pull_request_id, organization_id)
    references public.pull_requests(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_deployment_fk foreign key (deployment_id, organization_id)
    references public.deployments(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_monitor_observation_fk
    foreign key (monitor_observation_id, organization_id)
    references public.monitor_observations(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_deployment_validation_fk
    foreign key (deployment_validation_id, organization_id)
    references public.deployment_validations(id, organization_id) on delete restrict,
  constraint graph_phase1c_bridges_head_sha_exact check (
    head_sha is null or head_sha ~ '^[0-9a-f]{40}$'
  ),
  constraint graph_phase1c_bridges_merge_sha_exact check (
    merge_commit_sha is null or merge_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  constraint graph_phase1c_bridges_state_evidence check (
    case state
      when 'GRAPH_READY' then
        command_id is null and task_id is null and agent_run_id is null
        and pull_request_id is null and head_sha is null and merge_commit_sha is null
        and deployment_id is null and monitor_observation_id is null
        and deployment_validation_id is null
      when 'COMMAND_RECORDED' then
        command_id is not null and task_id is not null and agent_run_id is null
        and pull_request_id is null and head_sha is null and merge_commit_sha is null
        and deployment_id is null and monitor_observation_id is null
        and deployment_validation_id is null
      when 'PHASE1C_BOUND' then
        command_id is not null and task_id is not null and agent_run_id is not null
        and pull_request_id is null and head_sha is null and merge_commit_sha is null
        and deployment_id is null and monitor_observation_id is null
        and deployment_validation_id is null
      when 'PULL_REQUEST_RECORDED' then
        command_id is not null and task_id is not null and agent_run_id is not null
        and pull_request_id is not null and head_sha is not null and merge_commit_sha is null
        and deployment_id is null and monitor_observation_id is null
        and deployment_validation_id is null
      when 'MERGE_RECORDED' then
        command_id is not null and task_id is not null and agent_run_id is not null
        and pull_request_id is not null and head_sha is not null and merge_commit_sha is not null
        and deployment_id is null and monitor_observation_id is null
        and deployment_validation_id is null
      when 'DEPLOYMENT_RECORDED' then
        command_id is not null and task_id is not null and agent_run_id is not null
        and pull_request_id is not null and head_sha is not null and merge_commit_sha is not null
        and deployment_id is not null and monitor_observation_id is null
        and deployment_validation_id is null
      when 'MONITORING_RECORDED' then
        command_id is not null and task_id is not null and agent_run_id is not null
        and pull_request_id is not null and head_sha is not null and merge_commit_sha is not null
        and deployment_id is not null and monitor_observation_id is not null
        and deployment_validation_id is null
      when 'VALIDATED' then
        command_id is not null and task_id is not null and agent_run_id is not null
        and pull_request_id is not null and head_sha is not null and merge_commit_sha is not null
        and deployment_id is not null and monitor_observation_id is not null
        and deployment_validation_id is not null
      else false
    end
  )
);

create index graph_phase1c_bridges_graph_idx
  on public.graph_phase1c_bridges (organization_id, graph_id, created_at desc);
create index graph_phase1c_bridges_project_state_idx
  on public.graph_phase1c_bridges (project_id, state, updated_at desc);
create unique index graph_phase1c_bridges_command_unique
  on public.graph_phase1c_bridges (command_id) where command_id is not null;
create unique index graph_phase1c_bridges_task_unique
  on public.graph_phase1c_bridges (task_id) where task_id is not null;
create unique index graph_phase1c_bridges_agent_run_unique
  on public.graph_phase1c_bridges (agent_run_id) where agent_run_id is not null;
create unique index graph_phase1c_bridges_pull_request_unique
  on public.graph_phase1c_bridges (pull_request_id) where pull_request_id is not null;
create unique index graph_phase1c_bridges_deployment_unique
  on public.graph_phase1c_bridges (deployment_id) where deployment_id is not null;
create unique index graph_phase1c_bridges_monitor_observation_unique
  on public.graph_phase1c_bridges (monitor_observation_id) where monitor_observation_id is not null;
create unique index graph_phase1c_bridges_validation_unique
  on public.graph_phase1c_bridges (deployment_validation_id)
  where deployment_validation_id is not null;

comment on table public.graph_phase1c_bridges is
  'Immutable-identity, monotonic evidence linking one lifecycle graph run to its exact Phase 1C and release records. This table never dispatches work.';

-- Graph artifacts are durable execution evidence. Changing a payload rewrites
-- history; deletion remains available only to existing parent-row cascades so
-- project/tenant cleanup keeps its established semantics. App roles have no
-- DELETE authority, and an approval intent's RESTRICT FK protects evidence it
-- names. All ordinary writes cross the worker insert boundary.
create or replace function public.enforce_graph_artifact_update_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000',
    message = 'graph artifacts are immutable audit evidence';
end;
$function$;

revoke all on function public.enforce_graph_artifact_update_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists graph_artifacts_update_immutable on public.graph_artifacts;
create trigger graph_artifacts_update_immutable
  before update on public.graph_artifacts
  for each row execute function public.enforce_graph_artifact_update_immutable();

revoke all on table public.graph_artifacts from public, anon, service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.graph_artifacts from authenticated;

-- Hosted Supabase default privileges may grant service_role broad access to
-- tables created after the original normalization migration. Normalize the
-- complete graph surface explicitly: app members may read through RLS, while
-- every mutation and every service read crosses a bounded definer RPC.
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
alter table public.work_locks enable row level security;
alter table public.work_locks force row level security;
alter table public.graph_events enable row level security;
alter table public.graph_events force row level security;
alter table public.graph_gates enable row level security;
alter table public.graph_gates force row level security;
alter table public.graph_phase1c_bridges enable row level security;
alter table public.graph_phase1c_bridges force row level security;

revoke all on table
  public.graph_templates,
  public.graphs,
  public.graph_budgets,
  public.graph_nodes,
  public.node_contracts,
  public.graph_edges,
  public.graph_runs,
  public.node_runs,
  public.graph_artifacts,
  public.graph_handoffs,
  public.graph_verifications,
  public.work_locks,
  public.graph_events,
  public.graph_gates,
  public.graph_phase1c_bridges
from public, anon, service_role;

revoke insert, update, delete, truncate, references, trigger on table
  public.graph_templates,
  public.graphs,
  public.graph_budgets,
  public.graph_nodes,
  public.node_contracts,
  public.graph_edges,
  public.graph_runs,
  public.node_runs,
  public.graph_artifacts,
  public.graph_handoffs,
  public.graph_verifications,
  public.work_locks,
  public.graph_events,
  public.graph_gates,
  public.graph_phase1c_bridges
from authenticated;

grant select on table
  public.graph_templates,
  public.graphs,
  public.graph_budgets,
  public.graph_nodes,
  public.node_contracts,
  public.graph_edges,
  public.graph_runs,
  public.node_runs,
  public.graph_artifacts,
  public.graph_handoffs,
  public.graph_verifications,
  public.work_locks,
  public.graph_events,
  public.graph_gates,
  public.graph_phase1c_bridges
to authenticated;

-- A TEST or DEPLOYMENT approval has two independently trusted halves: the
-- signed-in owner's exact intent and the server's read-only provider evidence.
-- Only a SHA-256 digest of the one-use nonce is stored; no app role can read or
-- write the table directly.
create table public.graph_release_gate_approval_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  graph_id uuid not null,
  gate_id uuid not null,
  bridge_id uuid not null,
  evidence_artifact_id uuid,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  required_checks_sha256 text not null check (
    required_checks_sha256 ~ '^[0-9a-f]{64}$'
  ),
  stage public.sdlc_stage not null check (
    stage in ('TEST'::public.sdlc_stage, 'DEPLOYMENT'::public.sdlc_stage)
  ),
  pull_request_id uuid not null,
  head_sha text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  merge_commit_sha text check (
    merge_commit_sha is null or merge_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  reason text check (reason is null or pg_catalog.char_length(reason) between 1 and 1000),
  requested_by uuid not null references auth.users(id) on delete restrict,
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  consumption_sha256 text check (
    consumption_sha256 is null or consumption_sha256 ~ '^[0-9a-f]{64}$'
  ),
  state text not null default 'PENDING' check (
    state in ('PENDING', 'CONSUMED', 'SUPERSEDED')
  ),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  superseded_at timestamptz,
  constraint graph_release_gate_intents_id_organization_unique
    unique (id, organization_id),
  constraint graph_release_gate_intents_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint graph_release_gate_intents_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint graph_release_gate_intents_gate_fk
    foreign key (gate_id, organization_id)
    references public.graph_gates(id, organization_id) on delete restrict,
  constraint graph_release_gate_intents_bridge_fk
    foreign key (bridge_id, organization_id)
    references public.graph_phase1c_bridges(id, organization_id) on delete restrict,
  constraint graph_release_gate_intents_artifact_fk
    foreign key (evidence_artifact_id, organization_id)
    references public.graph_artifacts(id, organization_id) on delete restrict,
  constraint graph_release_gate_intents_pull_request_fk
    foreign key (pull_request_id, organization_id)
    references public.pull_requests(id, organization_id) on delete restrict,
  constraint graph_release_gate_intents_stage_evidence check (
    (stage = 'TEST'::public.sdlc_stage
      and evidence_artifact_id is not null
      and merge_commit_sha is null)
    or
    (stage = 'DEPLOYMENT'::public.sdlc_stage
      and evidence_artifact_id is not null
      and merge_commit_sha is not null)
  ),
  constraint graph_release_gate_intents_state_time check (
    expires_at > requested_at
    and (
      (state = 'PENDING' and consumed_at is null and superseded_at is null
        and consumption_sha256 is null)
      or (state = 'CONSUMED' and consumed_at is not null and superseded_at is null)
      or (state = 'SUPERSEDED' and consumed_at is null and superseded_at is not null)
    )
  )
);

create index graph_release_gate_intents_pending_idx
  on public.graph_release_gate_approval_intents
    (organization_id, state, requested_at desc);
create unique index graph_release_gate_intents_one_pending_gate
  on public.graph_release_gate_approval_intents (gate_id)
  where state = 'PENDING';

alter table public.graph_release_gate_approval_intents enable row level security;
alter table public.graph_release_gate_approval_intents force row level security;
revoke all on table public.graph_release_gate_approval_intents
  from public, anon, authenticated, service_role;

create or replace function public.enforce_graph_release_gate_intent_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'release gate approval intents are immutable audit evidence';
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.graph_id is distinct from old.graph_id
    or new.gate_id is distinct from old.gate_id
    or new.bridge_id is distinct from old.bridge_id
    or new.evidence_artifact_id is distinct from old.evidence_artifact_id
    or new.evidence_sha256 is distinct from old.evidence_sha256
    or new.required_checks_sha256 is distinct from old.required_checks_sha256
    or new.stage is distinct from old.stage
    or new.pull_request_id is distinct from old.pull_request_id
    or new.head_sha is distinct from old.head_sha
    or new.merge_commit_sha is distinct from old.merge_commit_sha
    or new.reason is distinct from old.reason
    or new.requested_by is distinct from old.requested_by
  then
    raise exception using errcode = '55000',
      message = 'release gate approval intent identity is immutable';
  end if;

  if old.state = 'PENDING' and new.state = 'PENDING' then
    if new.consumed_at is not null
      or new.superseded_at is not null
      or new.consumption_sha256 is not null
      or new.requested_at < old.requested_at
      or new.expires_at <= new.requested_at
    then
      raise exception using errcode = '55000',
        message = 'release gate approval intent reissue is invalid';
    end if;
    return new;
  end if;

  if old.state = 'PENDING' and new.state = 'CONSUMED' then
    if new.token_sha256 is distinct from old.token_sha256
      or new.requested_at is distinct from old.requested_at
      or new.expires_at is distinct from old.expires_at
      or new.consumed_at is null
      or new.superseded_at is not null
      or new.consumption_sha256 is null
    then
      raise exception using errcode = '55000',
        message = 'release gate approval intent consumption is invalid';
    end if;
    return new;
  end if;

  if old.state = 'PENDING' and new.state = 'SUPERSEDED' then
    if new.token_sha256 is distinct from old.token_sha256
      or new.requested_at is distinct from old.requested_at
      or new.expires_at is distinct from old.expires_at
      or new.consumed_at is not null
      or new.superseded_at is null
      or new.consumption_sha256 is not null
    then
      raise exception using errcode = '55000',
        message = 'release gate approval intent supersession is invalid';
    end if;
    return new;
  end if;

  raise exception using errcode = '55000',
    message = 'release gate approval intent cannot transition again';
end;
$function$;

revoke all on function public.enforce_graph_release_gate_intent_transition()
  from public, anon, authenticated, service_role;

create trigger graph_release_gate_intents_immutable
  before update or delete on public.graph_release_gate_approval_intents
  for each row execute function public.enforce_graph_release_gate_intent_transition();

-- Every resumed graph run carries the exact bridge chosen from its immediate
-- predecessor. The bridge's graph_run_id remains the immutable ARCHITECTURE
-- origin; this reference continues that lineage across later gate resumes.
alter table public.graph_runs
  add column if not exists phase1c_bridge_id uuid;

alter table public.graph_runs
  add constraint graph_runs_phase1c_bridge_fk
  foreign key (phase1c_bridge_id, organization_id)
  references public.graph_phase1c_bridges(id, organization_id) on delete restrict;

create index graph_runs_phase1c_bridge_idx
  on public.graph_runs (organization_id, phase1c_bridge_id, created_at desc)
  where phase1c_bridge_id is not null;

create or replace function public.enforce_graph_run_phase1c_bridge_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE'
    and new.phase1c_bridge_id is distinct from old.phase1c_bridge_id
  then
    raise exception using errcode = '55000',
      message = 'graph run Phase 1C bridge identity is write-once';
  end if;
  if new.phase1c_bridge_id is not null and not exists (
    select 1
    from public.graph_phase1c_bridges bridge
    where bridge.id = new.phase1c_bridge_id
      and bridge.organization_id = new.organization_id
      and bridge.project_id = (
        select graph.project_id from public.graphs graph
        where graph.id = new.graph_id
          and graph.organization_id = new.organization_id
      )
      and bridge.graph_id = new.graph_id
  ) then
    raise exception using errcode = '23514',
      message = 'graph run Phase 1C bridge must belong to the same tenant graph project';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_graph_run_phase1c_bridge_identity()
  from public, anon, authenticated, service_role;

create trigger graph_runs_phase1c_bridge_identity
  before insert or update of organization_id, graph_id, phase1c_bridge_id
  on public.graph_runs
  for each row execute function public.enforce_graph_run_phase1c_bridge_identity();

alter table public.graph_phase1c_bridges enable row level security;
alter table public.graph_phase1c_bridges force row level security;

create policy graph_phase1c_bridges_select_members
  on public.graph_phase1c_bridges for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.graph_phase1c_bridges
  from public, anon, authenticated, service_role;
grant select on table public.graph_phase1c_bridges to authenticated;

create or replace function public.graph_phase1c_bridge_state_rank(p_state text)
returns integer
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select case p_state
    when 'GRAPH_READY' then 1
    when 'COMMAND_RECORDED' then 2
    when 'PHASE1C_BOUND' then 3
    when 'PULL_REQUEST_RECORDED' then 4
    when 'MERGE_RECORDED' then 5
    when 'DEPLOYMENT_RECORDED' then 6
    when 'MONITORING_RECORDED' then 7
    when 'VALIDATED' then 8
    else null
  end
$function$;

revoke all on function public.graph_phase1c_bridge_state_rank(text)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_graph_phase1c_bridge_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.graph_id is distinct from old.graph_id
    or new.graph_run_id is distinct from old.graph_run_id
    or new.implementation_node_id is distinct from old.implementation_node_id
    or new.architecture_gate_id is distinct from old.architecture_gate_id
    or new.architecture_artifact_id is distinct from old.architecture_artifact_id
    or new.architecture_intent_sha256 is distinct from old.architecture_intent_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000',
      message = 'graph Phase 1C bridge origin identity is immutable';
  end if;

  if (old.command_id is not null and new.command_id is distinct from old.command_id)
    or (old.task_id is not null and new.task_id is distinct from old.task_id)
    or (old.agent_run_id is not null and new.agent_run_id is distinct from old.agent_run_id)
    or (old.pull_request_id is not null and new.pull_request_id is distinct from old.pull_request_id)
    or (old.head_sha is not null and new.head_sha is distinct from old.head_sha)
    or (old.merge_commit_sha is not null and new.merge_commit_sha is distinct from old.merge_commit_sha)
    or (old.deployment_id is not null and new.deployment_id is distinct from old.deployment_id)
    or (old.monitor_observation_id is not null and new.monitor_observation_id is distinct from old.monitor_observation_id)
    or (old.deployment_validation_id is not null and new.deployment_validation_id is distinct from old.deployment_validation_id)
  then
    raise exception using errcode = '55000',
      message = 'graph Phase 1C bridge evidence identity is write-once';
  end if;

  if public.graph_phase1c_bridge_state_rank(new.state)
      <> public.graph_phase1c_bridge_state_rank(old.state) + 1
  then
    raise exception using errcode = '55000',
      message = 'graph Phase 1C bridge state must advance exactly one step';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

revoke all on function public.enforce_graph_phase1c_bridge_transition()
  from public, anon, authenticated, service_role;

create trigger graph_phase1c_bridges_monotonic
  before update on public.graph_phase1c_bridges
  for each row execute function public.enforce_graph_phase1c_bridge_transition();

create or replace function public.audit_graph_phase1c_bridge_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  previous_state text;
  audit_type public.activity_event_type;
begin
  if tg_op = 'INSERT' then
    previous_state := null;
  else
    previous_state := old.state;
  end if;

  audit_type := case new.state
    when 'GRAPH_READY' then 'lifecycle.graph_created'::public.activity_event_type
    when 'COMMAND_RECORDED' then 'command.submitted'::public.activity_event_type
    when 'PHASE1C_BOUND' then 'agent.started'::public.activity_event_type
    when 'PULL_REQUEST_RECORDED' then 'pull_request.created'::public.activity_event_type
    when 'DEPLOYMENT_RECORDED' then 'deployment.started'::public.activity_event_type
    else 'lifecycle.iteration_advanced'::public.activity_event_type
  end;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    new.organization_id,
    new.project_id,
    auth.uid(),
    audit_type,
    'graph_phase1c_bridge',
    new.id,
    'Graph delivery lineage advanced to ' || new.state || '.',
    jsonb_strip_nulls(jsonb_build_object(
      'previous_state', previous_state,
      'state', new.state,
      'graph_id', new.graph_id,
      'graph_run_id', new.graph_run_id,
      'command_id', new.command_id,
      'agent_run_id', new.agent_run_id,
      'pull_request_id', new.pull_request_id,
      'deployment_id', new.deployment_id,
      'monitor_observation_id', new.monitor_observation_id,
      'deployment_validation_id', new.deployment_validation_id
    ))
  );

  return new;
end;
$function$;

revoke all on function public.audit_graph_phase1c_bridge_transition()
  from public, anon, authenticated, service_role;

create trigger graph_phase1c_bridges_audit
  after insert or update of state on public.graph_phase1c_bridges
  for each row execute function public.audit_graph_phase1c_bridge_transition();

create or replace function public.canonical_digest_timestamp(input_value timestamptz)
returns text
language sql
immutable
strict
security definer
set search_path = pg_catalog
as $function$
  select pg_catalog.to_char(
    pg_catalog.timezone('UTC', input_value),
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  )
$function$;

revoke all on function public.canonical_digest_timestamp(timestamptz)
  from public, anon, authenticated, service_role;

-- TEST approval is a release boundary, so it cannot trust that an ANCHOR row
-- merely came from today's JavaScript worker. Validate the durable payload as
-- exact-head, all-green CI evidence again inside the database transaction.
create or replace function public.assert_canonical_graph_test_anchor(
  p_payload jsonb,
  p_expected_head_sha text,
  p_expected_repository text,
  p_expected_check_names jsonb,
  p_node_started_at timestamptz,
  p_artifact_created_at timestamptz,
  p_gate_opened_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  check_item jsonb;
  observed_at timestamptz;
  latency_ms numeric;
  total_value integer;
begin
  if p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or not public.graph_required_check_policy_is_safe(p_expected_check_names)
  then
    raise exception using errcode = '23514',
      message = 'TEST gate requires canonical exact-head successful CI evidence';
  end if;

  if (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(p_payload)
    ) <> 8
    or not (p_payload ?& array[
      'observation', 'sha', 'repository', 'total', 'checks', 'failing',
      'observedAt', 'latencyMs'
    ])
    or p_payload->>'observation' is distinct from 'ci_check_runs'
    or pg_catalog.jsonb_typeof(p_payload->'sha') <> 'string'
    or p_payload->>'sha' is distinct from p_expected_head_sha
    or p_payload->>'sha' !~ '^[0-9a-f]{40}$'
    or pg_catalog.jsonb_typeof(p_payload->'repository') <> 'string'
    or p_payload->>'repository' is distinct from p_expected_repository
    or pg_catalog.jsonb_typeof(p_payload->'total') <> 'number'
    or (p_payload->>'total') !~ '^[0-9]+$'
    or pg_catalog.jsonb_typeof(p_payload->'checks') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'failing') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'observedAt') <> 'string'
    or (p_payload->>'observedAt') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    or pg_catalog.jsonb_typeof(p_payload->'latencyMs') <> 'number'
    or (p_payload->>'latencyMs') !~ '^[0-9]+(\.[0-9]+)?$'
    or p_node_started_at is null
    or p_artifact_created_at is null
    or p_gate_opened_at is null
    or p_artifact_created_at > p_gate_opened_at
  then
    raise exception using errcode = '23514',
      message = 'TEST gate requires canonical exact-head successful CI evidence';
  end if;

  if pg_catalog.jsonb_array_length(p_payload->'checks') not between 1 and 100
    or pg_catalog.jsonb_array_length(p_payload->'failing') <> 0
  then
    raise exception using errcode = '23514',
      message = 'TEST gate requires canonical exact-head successful CI evidence';
  end if;

  begin
    total_value := (p_payload->>'total')::integer;
    latency_ms := (p_payload->>'latencyMs')::numeric;
    observed_at := (p_payload->>'observedAt')::timestamptz;
  exception when others then
    raise exception using errcode = '23514',
      message = 'TEST gate requires canonical exact-head successful CI evidence';
  end;

  if total_value <> pg_catalog.jsonb_array_length(p_payload->'checks')
    or total_value <> pg_catalog.jsonb_array_length(p_expected_check_names)
    or total_value not between 1 and 100
    or latency_ms < 0
    or latency_ms > 3600000
    or observed_at < p_node_started_at - interval '5 minutes'
    or observed_at > p_artifact_created_at + interval '5 minutes'
  then
    raise exception using errcode = '23514',
      message = 'TEST gate requires canonical exact-head successful CI evidence';
  end if;

  for check_item in
    select element.value
    from pg_catalog.jsonb_array_elements(p_payload->'checks') element(value)
  loop
    if pg_catalog.jsonb_typeof(check_item) <> 'object' then
      raise exception using errcode = '23514',
        message = 'TEST gate requires canonical exact-head successful CI evidence';
    end if;
    if (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(check_item)
      ) <> 3
      or not (check_item ?& array['name', 'conclusion', 'url'])
      or pg_catalog.jsonb_typeof(check_item->'name') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(check_item->>'name')) not between 1 and 160
      or pg_catalog.strpos(check_item->>'name', '|') > 0
      or public.text_has_likely_secret(check_item->>'name')
      or check_item->>'conclusion' is distinct from 'success'
      or pg_catalog.jsonb_typeof(check_item->'url') <> 'string'
      or pg_catalog.char_length(check_item->>'url') not between 1 and 2048
      or check_item->>'url' !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
      or pg_catalog.strpos(check_item->>'url', '@') > 0
      or public.text_has_likely_secret(check_item->>'url')
    then
      raise exception using errcode = '23514',
        message = 'TEST gate requires canonical exact-head successful CI evidence';
    end if;
  end loop;

  if (
    select pg_catalog.count(distinct element.value->>'name')
    from pg_catalog.jsonb_array_elements(p_payload->'checks') element(value)
  ) <> total_value then
    raise exception using errcode = '23514',
      message = 'TEST gate requires canonical exact-head successful CI evidence';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(p_expected_check_names) expected(name)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_payload->'checks') actual(value)
      where actual.value->>'name' = expected.name
    )
  ) then
    raise exception using errcode = '23514',
      message = 'TEST gate requires the exact persisted required-check policy';
  end if;
end;
$function$;

revoke all on function public.assert_canonical_graph_test_anchor(
  jsonb, text, text, jsonb, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

-- Record a one-use, owner-authenticated intent for the exact TEST or
-- DEPLOYMENT artifact visible at the gate. The nonce is returned only to the
-- server handling this request; the database stores its SHA-256 digest.
create or replace function public.request_graph_release_gate_approval(
  p_gate_id uuid,
  p_bridge_id uuid,
  p_evidence_artifact_id uuid,
  p_reason text default null
)
returns table (intent_id uuid, consume_nonce uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_id uuid := auth.uid();
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  bridge_record public.graph_phase1c_bridges%rowtype;
  intent_record public.graph_release_gate_approval_intents%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  nonce_value uuid := pg_catalog.gen_random_uuid();
  nonce_sha256 text;
  artifact_sha256 text;
  repository_full_name text;
  evidence_node_started_at timestamptz;
  normalized_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  was_reissued boolean := false;
  superseded_intent_id uuid;
begin
  if actor_id is null or p_evidence_artifact_id is null then
    raise exception using errcode = '42501',
      message = 'authenticated owner approval of exact gate evidence is required';
  end if;
  if (normalized_reason is not null and pg_catalog.char_length(normalized_reason) > 1000)
    or public.text_has_likely_secret(normalized_reason)
  then
    raise exception using errcode = '22023',
      message = 'release gate approval reason is invalid';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = p_gate_id
  for update;
  if not found
    or gate_record.kind <> 'HUMAN'::public.gate_kind
    or gate_record.stage not in (
      'TEST'::public.sdlc_stage,
      'DEPLOYMENT'::public.sdlc_stage
    )
    or gate_record.state <> 'OPEN'::public.gate_state
    or gate_record.opened_by_run_id is null
  then
    raise exception using errcode = '55000',
      message = 'an open human TEST or DEPLOYMENT gate is required';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;
  if not found
    or not graph_record.is_lifecycle
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or not public.is_organization_owner(graph_record.organization_id)
  then
    raise exception using errcode = '42501',
      message = 'organization owner access to an exact full lifecycle is required';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = p_bridge_id
    and bridge.organization_id = graph_record.organization_id
    and bridge.project_id = graph_record.project_id
    and bridge.graph_id = graph_record.id
  for update;
  if not found
    or bridge_record.pull_request_id is null
    or bridge_record.head_sha is null
    or (gate_record.stage = 'TEST'::public.sdlc_stage
      and bridge_record.state <> 'PULL_REQUEST_RECORDED')
    or (gate_record.stage = 'DEPLOYMENT'::public.sdlc_stage
      and (bridge_record.state <> 'MERGE_RECORDED'
        or bridge_record.merge_commit_sha is null))
  then
    raise exception using errcode = '23514',
      message = 'release gate does not match the exact bridge evidence stage';
  end if;

  if not exists (
    select 1
    from public.graph_runs run
    join public.node_runs node_run
      on node_run.graph_run_id = run.id
     and node_run.organization_id = run.organization_id
     and node_run.node_id = gate_record.node_id
    where run.id = gate_record.opened_by_run_id
      and run.organization_id = graph_record.organization_id
      and run.graph_id = graph_record.id
      and run.phase1c_bridge_id = bridge_record.id
      and run.state in (
        'PARTIAL'::public.graph_run_state,
        'COMPLETED'::public.graph_run_state
      )
      and run.completed_at is not null
      and (
        (node_run.state = 'VERIFYING'::public.graph_node_state
          and node_run.completed_at is null)
        or (node_run.state = 'COMPLETED'::public.graph_node_state
          and node_run.completed_at is not null)
      )
  ) then
    raise exception using errcode = '23514',
      message = 'release gate run is not closed on exact gate-node evidence';
  end if;

  select artifact.* into artifact_record
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  where artifact.id = p_evidence_artifact_id
    and artifact.organization_id = graph_record.organization_id
    and artifact.graph_run_id = gate_record.opened_by_run_id
    and artifact.kind = 'ANCHOR'::public.graph_artifact_kind
    and node_run.node_id = gate_record.node_id;
  if not found or public.jsonb_has_sensitive_keys(artifact_record.payload) then
    raise exception using errcode = '23514',
      message = 'selected release gate artifact is not exact safe ANCHOR evidence';
  end if;

  if gate_record.stage = 'TEST'::public.sdlc_stage then
    select repository.full_name into repository_full_name
    from public.github_repositories repository
    where repository.id = graph_record.github_repository_id
      and repository.organization_id = graph_record.organization_id;
    select node_run.started_at into evidence_node_started_at
    from public.node_runs node_run
    where node_run.id = artifact_record.node_run_id
      and node_run.organization_id = artifact_record.organization_id
      and node_run.graph_run_id = artifact_record.graph_run_id;
    perform public.assert_canonical_graph_test_anchor(
      artifact_record.payload,
      bridge_record.head_sha,
      repository_full_name,
      graph_record.required_check_names,
      evidence_node_started_at,
      artifact_record.created_at,
      gate_record.opened_at
    );
  end if;

  artifact_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'id', artifact_record.id,
      'organizationId', artifact_record.organization_id,
      'graphRunId', artifact_record.graph_run_id,
      'nodeRunId', artifact_record.node_run_id,
      'kind', artifact_record.kind,
      'payload', artifact_record.payload,
      'createdAt', public.canonical_digest_timestamp(artifact_record.created_at)
    )::text,
    'UTF8'
  )), 'hex');

  nonce_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(nonce_value::text, 'UTF8')),
    'hex'
  );

  select * into intent_record
  from public.graph_release_gate_approval_intents intent
  where intent.gate_id = gate_record.id
    and intent.state = 'PENDING'
  for update;
  if found
    and intent_record.expires_at >= pg_catalog.clock_timestamp()
    and intent_record.organization_id is not distinct from graph_record.organization_id
    and intent_record.project_id is not distinct from graph_record.project_id
    and intent_record.graph_id is not distinct from graph_record.id
    and intent_record.bridge_id is not distinct from bridge_record.id
    and intent_record.evidence_artifact_id is not distinct from artifact_record.id
    and intent_record.evidence_sha256 is not distinct from artifact_sha256
    and intent_record.required_checks_sha256 is not distinct from graph_record.required_checks_sha256
    and intent_record.stage is not distinct from gate_record.stage
    and intent_record.pull_request_id is not distinct from bridge_record.pull_request_id
    and intent_record.head_sha is not distinct from bridge_record.head_sha
    and intent_record.merge_commit_sha is not distinct from bridge_record.merge_commit_sha
    and intent_record.reason is not distinct from normalized_reason
    and intent_record.requested_by is not distinct from actor_id
  then
    update public.graph_release_gate_approval_intents
    set token_sha256 = nonce_sha256,
        requested_at = pg_catalog.clock_timestamp(),
        expires_at = pg_catalog.clock_timestamp() + interval '5 minutes'
    where id = intent_record.id
    returning * into intent_record;
    was_reissued := true;
  else
    if found then
      update public.graph_release_gate_approval_intents
      set state = 'SUPERSEDED', superseded_at = pg_catalog.clock_timestamp()
      where id = intent_record.id;
      superseded_intent_id := intent_record.id;
    end if;

    insert into public.graph_release_gate_approval_intents (
      organization_id, project_id, graph_id, gate_id, bridge_id,
      evidence_artifact_id, evidence_sha256, required_checks_sha256,
      stage, pull_request_id, head_sha,
      merge_commit_sha, reason, requested_by, token_sha256, expires_at
    ) values (
      graph_record.organization_id, graph_record.project_id, graph_record.id,
      gate_record.id, bridge_record.id, artifact_record.id, artifact_sha256,
      graph_record.required_checks_sha256,
      gate_record.stage,
      bridge_record.pull_request_id, bridge_record.head_sha,
      bridge_record.merge_commit_sha, normalized_reason, actor_id, nonce_sha256,
      pg_catalog.clock_timestamp() + interval '5 minutes'
    ) returning * into intent_record;
  end if;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    intent_record.organization_id,
    intent_record.project_id,
    actor_id,
    'approval.requested'::public.activity_event_type,
    'graph_release_gate_approval_intent',
    intent_record.id,
    intent_record.stage::text || ' release gate approval intent recorded.',
    pg_catalog.jsonb_build_object(
      'gate_id', intent_record.gate_id,
      'bridge_id', intent_record.bridge_id,
      'evidence_artifact_id', intent_record.evidence_artifact_id,
      'reissued', was_reissued,
      'superseded_intent_id', superseded_intent_id
    )
  );

  return query select intent_record.id, nonce_value;
end;
$function$;

revoke all on function public.request_graph_release_gate_approval(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_graph_release_gate_approval(uuid, uuid, uuid, text)
  to authenticated;

-- Bind a gate only to the exact live node run that produced its evidence. An
-- undecided gate whose opener was killed by stale-claim recovery may be rebound
-- to a fresh run, but a live owner intent or any decided gate is never moved.
create or replace function public.open_node_gate_as_worker(
  p_worker_id text,
  p_node_id uuid,
  p_graph_run_id uuid,
  p_anchor_count integer default 0
)
returns public.graph_gates
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  gate_record public.graph_gates%rowtype;
  node_record public.graph_nodes%rowtype;
  run_record public.graph_runs%rowtype;
  node_run_record public.node_runs%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  expected_artifact_kind public.graph_artifact_kind;
  derived_anchor_count integer;
  old_run_state public.graph_run_state;
  project_id_value uuid;
  expired_intent_count integer := 0;
  rebound boolean := false;
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_anchor_count is null or p_anchor_count < 0 then
    raise exception using errcode = '22023', message = 'anchor_count_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_node_id::text, 0)
  );
  select * into node_record
  from public.graph_nodes node
  where node.id = p_node_id;
  if not found or node_record.gate_kind is null or node_record.lifecycle_stage is null then
    raise exception using errcode = '22023', message = 'node_has_no_gate';
  end if;

  select * into run_record
  from public.graph_runs run
  where run.id = p_graph_run_id
    and run.organization_id = node_record.organization_id
    and run.graph_id = node_record.graph_id
  for update;
  if not found or run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000',
      message = 'gate may only be opened by its exact running graph run';
  end if;

  select * into node_run_record
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id
    and node_run.node_id = node_record.id
    and node_run.state in (
      'VERIFYING'::public.graph_node_state,
      'COMPLETED'::public.graph_node_state
    )
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'gate may only open on exact verifying node evidence';
  end if;

  expected_artifact_kind := case
    when node_record.executor = 'ANCHOR'::public.graph_node_executor
      then 'ANCHOR'::public.graph_artifact_kind
    when node_record.capability in ('synthesis', 'reporting')
      then 'SYNTHESIS'::public.graph_artifact_kind
    when node_record.executor = 'DETERMINISTIC'::public.graph_node_executor
      and node_record.capability = 'extraction'
      then 'REDUCED'::public.graph_artifact_kind
    else 'RAW'::public.graph_artifact_kind
  end;
  select * into artifact_record
  from public.graph_artifacts artifact
  where artifact.node_run_id = node_run_record.id
    and artifact.organization_id = node_run_record.organization_id
    and artifact.graph_run_id = node_run_record.graph_run_id
    and artifact.kind = expected_artifact_kind
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'gate may only open on its exact persisted node artifact';
  end if;
  derived_anchor_count := case
    when node_record.executor <> 'ANCHOR'::public.graph_node_executor then 0
    when pg_catalog.jsonb_typeof(artifact_record.payload) = 'array'
      then pg_catalog.jsonb_array_length(artifact_record.payload)
    when artifact_record.payload is null or artifact_record.payload = 'null'::jsonb then 0
    else 1
  end;
  if p_anchor_count is distinct from derived_anchor_count then
    raise exception using errcode = '22023',
      message = 'gate anchor count does not match its exact persisted artifact';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.node_id = node_record.id
  for update;
  if found then
    if gate_record.organization_id is distinct from node_record.organization_id
      or gate_record.graph_id is distinct from node_record.graph_id
      or gate_record.node_id is distinct from node_record.id
      or gate_record.stage is distinct from node_record.lifecycle_stage
      or gate_record.kind is distinct from node_record.gate_kind
    then
      raise exception using errcode = '55000',
        message = 'gate replay identity does not match the durable gate';
    end if;
    if gate_record.state <> 'OPEN'::public.gate_state then
      return gate_record;
    end if;
    if gate_record.opened_by_run_id = run_record.id then
      if gate_record.anchor_count is distinct from derived_anchor_count
        or gate_record.opened_at is null
      then
        raise exception using errcode = '22023',
          message = 'same-run gate replay does not match durable evidence';
      end if;
      return gate_record;
    end if;

    if gate_record.opened_by_run_id is not null then
      select run.state into old_run_state
      from public.graph_runs run
      where run.id = gate_record.opened_by_run_id
        and run.organization_id = gate_record.organization_id;
    end if;

    if gate_record.opened_by_run_id is null
      or old_run_state in (
        'FAILED'::public.graph_run_state,
        'CANCELLED'::public.graph_run_state,
        'BUDGET_STOPPED'::public.graph_run_state
      )
    then
      update public.graph_release_gate_approval_intents intent
      set state = 'SUPERSEDED', superseded_at = pg_catalog.clock_timestamp()
      where intent.gate_id = gate_record.id
        and intent.state = 'PENDING'
        and intent.expires_at < pg_catalog.clock_timestamp();
      get diagnostics expired_intent_count = row_count;

      if exists (
        select 1
        from public.graph_release_gate_approval_intents intent
        where intent.gate_id = gate_record.id
          and intent.state in ('PENDING', 'CONSUMED')
      ) then
        return gate_record;
      end if;

      update public.graph_gates
      set opened_by_run_id = run_record.id,
          anchor_count = p_anchor_count,
          opened_at = pg_catalog.clock_timestamp()
      where id = gate_record.id
      returning * into gate_record;
      rebound := true;
    else
      return gate_record;
    end if;
  else
    insert into public.graph_gates (
      organization_id, graph_id, node_id, stage, kind, state,
      anchor_count, opened_by_run_id
    ) values (
      node_record.organization_id, node_record.graph_id, node_record.id,
      node_record.lifecycle_stage, node_record.gate_kind,
      'OPEN'::public.gate_state, p_anchor_count, run_record.id
    ) returning * into gate_record;
  end if;

  insert into public.graph_events (
    organization_id, graph_run_id, node_run_id, event_type, detail, payload
  ) values (
    node_record.organization_id,
    run_record.id,
    node_run_record.id,
    case when rebound then 'gate_rebound' else 'gate_opened' end,
    node_record.lifecycle_stage::text || case when rebound
      then ' gate rebound after its prior opener terminated'
      else ' gate awaiting a ' || pg_catalog.lower(node_record.gate_kind::text) || ' decision'
    end,
    pg_catalog.jsonb_build_object(
      'anchor_count', gate_record.anchor_count,
      'node_key', node_record.node_key,
      'rebound', rebound,
      'expired_intents_superseded', expired_intent_count
    )
  );

  select graph.project_id into project_id_value
  from public.graphs graph
  where graph.id = node_record.graph_id
    and graph.organization_id = node_record.organization_id;
  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    node_record.organization_id,
    project_id_value,
    null,
    'lifecycle.gate_opened'::public.activity_event_type,
    'graph_gate',
    gate_record.id,
    node_record.lifecycle_stage::text || case when rebound
      then ' gate rebound to fresh exact evidence'
      else ' gate opened'
    end,
    pg_catalog.jsonb_build_object(
      'kind', node_record.gate_kind,
      'anchor_count', gate_record.anchor_count,
      'graph_run_id', run_record.id,
      'node_run_id', node_run_record.id,
      'rebound', rebound,
      'expired_intents_superseded', expired_intent_count
    )
  );
  return gate_record;
end;
$function$;

revoke all on function public.open_node_gate_as_worker(text, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.open_node_gate_as_worker(text, uuid, uuid, integer)
  to service_role;

-- Decide an automatic gate only against the exact closed run that opened it.
-- Parent-run then gate is the canonical lock order shared with gate rebinding;
-- a delayed worker can therefore never approve evidence from an old opener
-- after the gate has moved to a fresh run.
create or replace function public.decide_automatic_gate_as_worker(
  p_worker_id text,
  p_node_id uuid
)
returns public.graph_gates
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  node_record public.graph_nodes%rowtype;
  peek_gate public.graph_gates%rowtype;
  gate_record public.graph_gates%rowtype;
  opener_record public.graph_runs%rowtype;
  project_id_value uuid;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  select * into node_record
  from public.graph_nodes node
  where node.id = p_node_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'node_not_found';
  end if;

  select * into peek_gate
  from public.graph_gates gate
  where gate.node_id = node_record.id;
  if not found or peek_gate.opened_by_run_id is null then
    raise exception using errcode = 'P0002', message = 'gate_not_found';
  end if;

  select * into opener_record
  from public.graph_runs run
  where run.id = peek_gate.opened_by_run_id
    and run.organization_id = peek_gate.organization_id
    and run.graph_id = peek_gate.graph_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'automatic gate opener identity is invalid';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = peek_gate.id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'gate_not_found';
  end if;
  if gate_record.opened_by_run_id is distinct from opener_record.id then
    raise exception using errcode = '55000',
      message = 'automatic gate opener identity changed';
  end if;
  if gate_record.organization_id <> opener_record.organization_id
    or gate_record.graph_id <> opener_record.graph_id
    or gate_record.node_id <> node_record.id
  then
    raise exception using errcode = '55000',
      message = 'automatic gate tenant or graph identity changed';
  end if;
  if gate_record.kind <> 'AUTOMATIC'::public.gate_kind then
    raise exception using errcode = '42501',
      message = 'a worker may never decide a human gate';
  end if;
  if gate_record.state <> 'OPEN'::public.gate_state then
    return gate_record;
  end if;
  if gate_record.anchor_count <= 0 then
    raise exception using errcode = '22023',
      message = 'an automatic gate cannot approve without anchored evidence';
  end if;
  if opener_record.state not in (
      'PARTIAL'::public.graph_run_state,
      'COMPLETED'::public.graph_run_state
    )
    or opener_record.completed_at is null
  then
    raise exception using errcode = '55000',
      message = 'automatic gate opener run must be terminal with exact completion evidence';
  end if;

  update public.graph_gates gate
  set state = 'APPROVED'::public.gate_state,
      reason = 'Approved on anchored evidence: ' || gate_record.anchor_count
        || ' recorded observation(s) back this stage.',
      decided_at = pg_catalog.clock_timestamp(),
      decided_by = null
  where gate.id = gate_record.id
    and gate.state = 'OPEN'::public.gate_state
    and gate.kind = 'AUTOMATIC'::public.gate_kind
    and gate.opened_by_run_id = opener_record.id
    and gate.anchor_count > 0
  returning * into gate_record;
  if not found then
    raise exception using errcode = '40001',
      message = 'automatic gate decision lost exact evidence identity';
  end if;

  select graph.project_id into project_id_value
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;
  if not found then
    raise exception using errcode = '55000',
      message = 'automatic gate project identity is invalid';
  end if;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    gate_record.organization_id,
    project_id_value,
    null,
    'lifecycle.gate_approved'::public.activity_event_type,
    'graph_gate',
    gate_record.id,
    gate_record.stage::text || ' gate approved on anchored evidence',
    pg_catalog.jsonb_build_object(
      'kind', gate_record.kind,
      'anchor_count', gate_record.anchor_count,
      'opened_by_run_id', opener_record.id,
      'decided_by_worker', p_worker_id
    )
  );

  return gate_record;
end;
$function$;

revoke all on function public.decide_automatic_gate_as_worker(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_automatic_gate_as_worker(text, uuid)
  to service_role;

-- A reclaimed worker must lose write authority immediately. Every worker write
-- path below locks the parent run first, matching reclaim ordering, and accepts
-- only a still-RUNNING exact tenant/run relationship.
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
set search_path = pg_catalog
as $function$
declare
  peek_node_run public.node_runs%rowtype;
  node_run_record public.node_runs%rowtype;
  graph_run_record public.graph_runs%rowtype;
  node_capability text;
  node_executor public.graph_node_executor;
  normalized_detail text := coalesce(
    p_detail,
    pg_catalog.format('worker %s', p_worker_id)
  );
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_state is null or p_state in (
    'PENDING'::public.graph_node_state,
    'READY'::public.graph_node_state,
    'BLOCKED'::public.graph_node_state
  ) then
    raise exception using errcode = '22023',
      message = 'worker_node_state_target_forbidden';
  end if;
  if public.text_has_likely_secret(p_detail) then
    raise exception using errcode = '22023',
      message = 'node transition detail contains secret-shaped material';
  end if;
  select * into peek_node_run from public.node_runs where id = p_node_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'node_run_not_found';
  end if;

  select * into graph_run_record
  from public.graph_runs run
  where run.id = peek_node_run.graph_run_id
    and run.organization_id = peek_node_run.organization_id
  for update;
  if not found or graph_run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000', message = 'parent_graph_run_not_running';
  end if;

  select * into node_run_record
  from public.node_runs node_run
  where node_run.id = p_node_run_id
    and node_run.graph_run_id = graph_run_record.id
    and node_run.organization_id = graph_run_record.organization_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'node_run_identity_changed';
  end if;

  select node.capability, node.executor into node_capability, node_executor
  from public.graph_nodes node
  where node.id = node_run_record.node_id
    and node.organization_id = node_run_record.organization_id
    and node.graph_id = graph_run_record.graph_id;
  if not found then
    raise exception using errcode = '55000', message = 'graph_node_identity_changed';
  end if;
  if p_state = 'COMPLETED'::public.graph_node_state
    and node_capability in ('review', 'security_review', 'qa')
    and node_executor = 'MODEL'::public.graph_node_executor
  then
    raise exception using errcode = '55000',
      message = 'reviewer_completion_requires_atomic_verifications';
  end if;

  -- A transport can lose the response after the transaction commits. An
  -- exact replay returns the durable row and does not append a second event;
  -- any changed evidence is a conflicting rewrite, including on terminal
  -- states. This also prevents timestamp regression on retries.
  if node_run_record.state = p_state then
    if (p_provider is not null and p_provider is distinct from node_run_record.provider)
      or (p_model is not null and p_model is distinct from node_run_record.model)
      or (p_latency_ms is not null and p_latency_ms is distinct from node_run_record.latency_ms)
      or (p_state = 'RUNNING'::public.graph_node_state and node_run_record.started_at is null)
      or (
        p_state in (
          'COMPLETED'::public.graph_node_state,
          'FAILED'::public.graph_node_state,
          'CANCELLED'::public.graph_node_state,
          'SKIPPED'::public.graph_node_state
        )
        and node_run_record.completed_at is null
      )
      or not exists (
        select 1
        from public.graph_events event
        where event.organization_id = node_run_record.organization_id
          and event.graph_run_id = node_run_record.graph_run_id
          and event.node_run_id = node_run_record.id
          and event.event_type = 'node_' || pg_catalog.lower(p_state::text)
          and event.detail is not distinct from normalized_detail
      )
    then
      raise exception using errcode = '22023', message = 'node_state_replay_mismatch';
    end if;
    return node_run_record;
  end if;

  if not (
    (
      node_run_record.state in (
        'PENDING'::public.graph_node_state,
        'READY'::public.graph_node_state,
        'BLOCKED'::public.graph_node_state
      )
      and p_state in (
        'RUNNING'::public.graph_node_state,
        'SKIPPED'::public.graph_node_state
      )
    )
    or (
      node_run_record.state = 'RUNNING'::public.graph_node_state
      and p_state in (
        'VERIFYING'::public.graph_node_state,
        'COMPLETED'::public.graph_node_state,
        'FAILED'::public.graph_node_state,
        'CANCELLED'::public.graph_node_state,
        'SKIPPED'::public.graph_node_state
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_worker_node_state_transition';
  end if;

  update public.node_runs
  set state = p_state,
      provider = coalesce(p_provider, provider),
      model = coalesce(p_model, model),
      latency_ms = coalesce(p_latency_ms, latency_ms),
      error_message = case when p_state = 'FAILED' then p_detail else error_message end,
      started_at = case
        when p_state = 'RUNNING' and started_at is null then pg_catalog.now()
        else started_at
      end,
      completed_at = case
        when p_state in ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED')
          then coalesce(completed_at, pg_catalog.now())
        else completed_at
      end,
      updated_at = pg_catalog.now()
  where id = node_run_record.id
  returning * into node_run_record;

  update public.graph_runs
  set updated_at = pg_catalog.now()
  where id = graph_run_record.id
    and state = 'RUNNING'::public.graph_run_state;

  insert into public.graph_events (
    organization_id, graph_run_id, node_run_id, event_type, detail
  ) values (
    node_run_record.organization_id,
    node_run_record.graph_run_id,
    node_run_record.id,
    'node_' || pg_catalog.lower(p_state::text),
    normalized_detail
  );
  return node_run_record;
end;
$function$;

revoke all on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer
) to service_role;

-- Model output can contain repository secrets or be large enough to exhaust
-- the control-plane database. Existing rows must already satisfy both bounds
-- before the rule is validated; incompatible history requires an explicit
-- forward repair rather than silently exempting member-readable evidence.
do $graph_artifact_payload_preflight$
begin
  if exists (
    select 1
    from public.graph_artifacts artifact
    where public.jsonb_has_sensitive_keys(artifact.payload)
      or pg_catalog.octet_length(artifact.payload::text) > 1048576
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph artifact payload is sensitive or oversized; contain with a forward repair';
  end if;
end;
$graph_artifact_payload_preflight$;

do $graph_artifact_payload_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_artifacts_payload_size_bounded'
      and conrelid = 'public.graph_artifacts'::regclass
  ) then
    alter table public.graph_artifacts
      add constraint graph_artifacts_payload_size_bounded
      check (pg_catalog.octet_length(payload::text) <= 1048576) not valid;
  end if;
end;
$graph_artifact_payload_constraints$;

alter table public.graph_artifacts
  validate constraint graph_artifacts_payload_no_sensitive_data;
alter table public.graph_artifacts
  validate constraint graph_artifacts_payload_size_bounded;

-- One node attempt has one product slot per artifact kind. This turns a lost
-- response into an exact replay instead of an append, and the triple FK makes
-- contradictory run/node evidence impossible even for maintenance paths that
-- do not use the worker RPC.
do $graph_artifact_identity_preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'node_runs_id_organization_graph_run_unique'
      and conrelid = 'public.node_runs'::regclass
  ) then
    alter table public.node_runs
      add constraint node_runs_id_organization_graph_run_unique
      unique (id, organization_id, graph_run_id);
  end if;

  if exists (
    select 1
    from public.graph_artifacts artifact
    join public.node_runs node_run
      on node_run.id = artifact.node_run_id
     and node_run.organization_id = artifact.organization_id
    where artifact.node_run_id is not null
      and artifact.graph_run_id is distinct from node_run.graph_run_id
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph artifact has contradictory node/run identity';
  end if;
  if exists (
    select 1
    from public.graph_artifacts artifact
    where artifact.node_run_id is not null
    group by artifact.node_run_id, artifact.kind
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph artifact product slot is ambiguous';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_artifacts_id_organization_graph_run_unique'
      and conrelid = 'public.graph_artifacts'::regclass
  ) then
    alter table public.graph_artifacts
      add constraint graph_artifacts_id_organization_graph_run_unique
      unique (id, organization_id, graph_run_id);
  end if;

  alter table public.graph_artifacts
    drop constraint if exists graph_artifacts_node_run_fk;
  alter table public.graph_artifacts
    add constraint graph_artifacts_node_run_fk
    foreign key (node_run_id, organization_id, graph_run_id)
    references public.node_runs(id, organization_id, graph_run_id)
    on delete cascade;
end;
$graph_artifact_identity_preflight$;

create unique index graph_artifacts_node_run_kind_unique
  on public.graph_artifacts (node_run_id, kind)
  where node_run_id is not null;

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
set search_path = pg_catalog
as $function$
declare
  graph_run_record public.graph_runs%rowtype;
  node_run_record public.node_runs%rowtype;
  existing_artifact public.graph_artifacts%rowtype;
  artifact_id uuid;
  normalized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if public.jsonb_has_sensitive_keys(normalized_payload)
    or pg_catalog.octet_length(normalized_payload::text) > 1048576
  then
    raise exception using errcode = '22023',
      message = 'graph artifact payload is sensitive or oversized';
  end if;
  select * into graph_run_record
  from public.graph_runs run
  where run.id = p_graph_run_id
  for update;
  if not found or graph_run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000', message = 'parent_graph_run_not_running';
  end if;

  if p_node_run_id is not null then
    select * into node_run_record
    from public.node_runs node_run
    where node_run.id = p_node_run_id
      and node_run.graph_run_id = graph_run_record.id
      and node_run.organization_id = graph_run_record.organization_id
    for update;
    if not found or node_run_record.state <> 'RUNNING'::public.graph_node_state then
      raise exception using errcode = '55000',
        message = 'artifact requires its exact running node run';
    end if;
    if exists (
      select 1
      from public.graph_nodes node
      where node.id = node_run_record.node_id
        and node.organization_id = node_run_record.organization_id
        and node.graph_id = graph_run_record.graph_id
        and node.executor = 'MODEL'::public.graph_node_executor
        and node.capability in ('review', 'security_review', 'qa')
    ) then
      raise exception using errcode = '55000',
        message = 'reviewer artifact requires atomic completion with verifications';
    end if;

    select * into existing_artifact
    from public.graph_artifacts artifact
    where artifact.node_run_id = node_run_record.id
      and artifact.kind = p_kind
    for update;
    if found then
      if existing_artifact.organization_id is distinct from graph_run_record.organization_id
        or existing_artifact.graph_run_id is distinct from graph_run_record.id
        or existing_artifact.payload is distinct from normalized_payload
        or existing_artifact.item_count is distinct from p_item_count
        or existing_artifact.reduced_from_count is distinct from p_reduced_from_count
      then
        raise exception using errcode = '22023',
          message = 'graph artifact replay does not match the durable product slot';
      end if;
      return existing_artifact.id;
    end if;
  end if;

  update public.graph_runs
  set updated_at = pg_catalog.now()
  where id = graph_run_record.id
    and state = 'RUNNING'::public.graph_run_state;

  insert into public.graph_artifacts (
    organization_id, graph_run_id, node_run_id, kind, payload,
    item_count, reduced_from_count
  ) values (
    graph_run_record.organization_id,
    graph_run_record.id,
    p_node_run_id,
    p_kind,
    normalized_payload,
    p_item_count,
    p_reduced_from_count
  ) returning id into artifact_id;
  return artifact_id;
end;
$function$;

revoke all on function public.record_graph_artifact_as_worker(
  text, uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.record_graph_artifact_as_worker(
  text, uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) to service_role;

create or replace function public.graph_verification_evidence_is_safe(
  input_value jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $function$
declare
  evidence_item jsonb;
begin
  if input_value is null
    or pg_catalog.jsonb_typeof(input_value) <> 'array'
    or pg_catalog.pg_column_size(input_value) > 32768
    or pg_catalog.jsonb_array_length(input_value) > 64
    or public.jsonb_has_sensitive_keys(input_value)
  then
    return false;
  end if;

  for evidence_item in
    select element.value
    from pg_catalog.jsonb_array_elements(input_value) element(value)
  loop
    if pg_catalog.jsonb_typeof(evidence_item) <> 'string'
      or pg_catalog.char_length(evidence_item #>> '{}') > 1000
    then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function public.graph_verification_evidence_is_safe(jsonb)
  from public, anon, authenticated, service_role;

alter table public.graph_verifications
  add column if not exists verifier_node_run_id uuid,
  add column if not exists source_artifact_id uuid,
  add column if not exists source_artifact_sha256 text;

do $graph_verification_node_run_identity_fks$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'node_runs_id_organization_graph_run_unique'
      and conrelid = 'public.node_runs'::regclass
  ) then
    alter table public.node_runs
      add constraint node_runs_id_organization_graph_run_unique
      unique (id, organization_id, graph_run_id);
  end if;

  alter table public.graph_verifications
    drop constraint if exists graph_verifications_verifier_node_run_fk;
  alter table public.graph_verifications
    add constraint graph_verifications_verifier_node_run_fk
    foreign key (verifier_node_run_id, organization_id, graph_run_id)
    references public.node_runs(id, organization_id, graph_run_id)
    on delete cascade;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_verifications_source_artifact_fk'
      and conrelid = 'public.graph_verifications'::regclass
  ) then
    alter table public.graph_verifications
      add constraint graph_verifications_source_artifact_fk
      foreign key (source_artifact_id, organization_id, graph_run_id)
      references public.graph_artifacts(id, organization_id, graph_run_id)
      on delete restrict;
  end if;

  -- Replace the legacy tenant-only subject FK with the exact run identity.
  -- A verification cannot name a subject from another run even when both
  -- rows belong to the same organization.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_verifications_subject_run_fk'
      and conrelid = 'public.graph_verifications'::regclass
  ) then
    alter table public.graph_verifications
      add constraint graph_verifications_subject_run_fk
      foreign key (subject_node_run_id, organization_id, graph_run_id)
      references public.node_runs(id, organization_id, graph_run_id)
      on delete cascade;
  end if;
end;
$graph_verification_node_run_identity_fks$;

do $graph_verification_source_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_verifications_source_artifact_together'
      and conrelid = 'public.graph_verifications'::regclass
  ) then
    alter table public.graph_verifications
      add constraint graph_verifications_source_artifact_together check (
        (source_artifact_id is null and source_artifact_sha256 is null)
        or (source_artifact_id is not null and source_artifact_sha256 ~ '^[0-9a-f]{64}$')
      );
  end if;
end;
$graph_verification_source_constraints$;

create index graph_verifications_source_artifact_idx
  on public.graph_verifications (source_artifact_id)
  where source_artifact_id is not null;

create unique index if not exists graph_verifications_verifier_subject_lens_unique
  on public.graph_verifications (
    verifier_node_run_id,
    subject_node_run_id,
    lens
  )
  where verifier_node_run_id is not null;

do $graph_verification_legacy_evidence_preflight$
begin
  if exists (
    select 1
    from public.graph_verifications verification
    where not public.graph_verification_evidence_is_safe(verification.evidence)
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph verification evidence is unsafe; contain with a new forward repair before retrying';
  end if;
end;
$graph_verification_legacy_evidence_preflight$;

do $graph_verification_evidence_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'graph_verifications_evidence_safe'
      and conrelid = 'public.graph_verifications'::regclass
  ) then
    alter table public.graph_verifications
      add constraint graph_verifications_evidence_safe
      check (public.graph_verification_evidence_is_safe(evidence)) not valid;
  end if;
end;
$graph_verification_evidence_constraint$;

alter table public.graph_verifications
  validate constraint graph_verifications_evidence_safe;

create or replace function public.record_graph_verification_internal(
  p_worker_id text,
  p_verifier_node_run_id uuid,
  p_subject_node_run_id uuid,
  p_lens public.verification_lens,
  p_verdict public.verification_verdict,
  p_evidence jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  peek_subject public.node_runs%rowtype;
  subject_record public.node_runs%rowtype;
  verifier_record public.node_runs%rowtype;
  locked_record public.node_runs%rowtype;
  graph_run_record public.graph_runs%rowtype;
  subject_agent_id uuid;
  verifier_agent_id uuid;
  verifier_capability text;
  verifier_executor public.graph_node_executor;
  expected_lens public.verification_lens;
  existing_verification public.graph_verifications%rowtype;
  locked_count integer := 0;
  verification_id uuid;
  normalized_evidence jsonb := coalesce(p_evidence, '[]'::jsonb);
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_verifier_node_run_id is null
    or p_subject_node_run_id is null
    or p_lens is null
    or p_verdict is null
  then
    raise exception using errcode = '22023', message = 'verification identity is incomplete';
  end if;
  if p_verifier_node_run_id = p_subject_node_run_id then
    raise exception using errcode = '42501', message = 'self_verification_forbidden';
  end if;
  if not public.graph_verification_evidence_is_safe(normalized_evidence) then
    raise exception using errcode = '22023',
      message = 'verification evidence is invalid, oversized, or sensitive';
  end if;

  -- Peek only to discover the parent. The authoritative subject read happens
  -- after the parent lock, so reclaim and every worker write share one lock
  -- order and a losing worker cannot append late evidence.
  select * into peek_subject
  from public.node_runs node_run
  where node_run.id = p_subject_node_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'node_run_not_found';
  end if;

  select * into graph_run_record
  from public.graph_runs run
  where run.id = peek_subject.graph_run_id
    and run.organization_id = peek_subject.organization_id
  for update;
  if not found or graph_run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000', message = 'parent_graph_run_not_running';
  end if;

  -- Lock both nodes in UUID order so two concurrent inverse attempts cannot
  -- deadlock. Their exact parent/tenant predicates make cross-run or
  -- cross-tenant verification impossible even with forged UUIDs.
  for locked_record in
    select node_run.*
    from public.node_runs node_run
    where node_run.id in (p_verifier_node_run_id, p_subject_node_run_id)
      and node_run.graph_run_id = graph_run_record.id
      and node_run.organization_id = graph_run_record.organization_id
    order by node_run.id
    for update
  loop
    locked_count := locked_count + 1;
    if locked_record.id = p_verifier_node_run_id then
      verifier_record := locked_record;
    elsif locked_record.id = p_subject_node_run_id then
      subject_record := locked_record;
    end if;
  end loop;
  if locked_count <> 2
    or verifier_record.id is null
    or subject_record.id is null
  then
    raise exception using errcode = '55000', message = 'verification node identity changed';
  end if;
  if subject_record.state <> 'COMPLETED'::public.graph_node_state
    or subject_record.completed_at is null
  then
    raise exception using errcode = '55000',
      message = 'verification subject must be completed';
  end if;
  if verifier_record.state <> 'COMPLETED'::public.graph_node_state
    or verifier_record.completed_at is null
  then
    raise exception using errcode = '55000',
      message = 'verification author must be completed';
  end if;

  select node.agent_id into subject_agent_id
  from public.graph_nodes node
  where node.id = subject_record.node_id
    and node.graph_id = graph_run_record.graph_id
    and node.organization_id = graph_run_record.organization_id;
  if not found then
    raise exception using errcode = '55000', message = 'verification subject identity changed';
  end if;

  select node.agent_id, node.capability, node.executor
  into verifier_agent_id, verifier_capability, verifier_executor
  from public.graph_nodes node
  where node.id = verifier_record.node_id
    and node.graph_id = graph_run_record.graph_id
    and node.organization_id = graph_run_record.organization_id;
  if not found then
    raise exception using errcode = '55000', message = 'verification author identity changed';
  end if;

  if verifier_agent_id is not null
    and subject_agent_id is not null
    and verifier_agent_id = subject_agent_id
  then
    raise exception using errcode = '42501', message = 'self_verification_forbidden';
  end if;
  expected_lens := case when verifier_executor = 'MODEL'::public.graph_node_executor then case verifier_capability
    when 'review' then 'correctness'::public.verification_lens
    when 'security_review' then 'security'::public.verification_lens
    when 'qa' then 'acceptance_criteria'::public.verification_lens
    else null::public.verification_lens
  end else null::public.verification_lens end;
  if expected_lens is distinct from p_lens then
    raise exception using errcode = '22023',
      message = 'verification lens does not match verifier capability';
  end if;
  if verifier_record.provider is null then
    raise exception using errcode = '55000',
      message = 'verification author provider is missing';
  end if;

  select * into existing_verification
  from public.graph_verifications verification
  where verification.verifier_node_run_id = verifier_record.id
    and verification.subject_node_run_id = subject_record.id
    and verification.lens = p_lens
  for update;
  if found then
    if existing_verification.organization_id is distinct from graph_run_record.organization_id
      or existing_verification.graph_run_id is distinct from graph_run_record.id
      or existing_verification.verifier_agent_id is distinct from verifier_agent_id
      or existing_verification.verifier_provider is distinct from verifier_record.provider
      or existing_verification.verdict is distinct from p_verdict
      or existing_verification.evidence is distinct from normalized_evidence
      or existing_verification.shared_worker_context
    then
      raise exception using errcode = '22023',
        message = 'verification replay does not match durable evidence';
    end if;
    return existing_verification.id;
  end if;

  update public.graph_runs
  set updated_at = pg_catalog.now()
  where id = graph_run_record.id
    and state = 'RUNNING'::public.graph_run_state;

  insert into public.graph_verifications (
    organization_id, graph_run_id, verifier_node_run_id,
    subject_node_run_id, verifier_agent_id,
    verifier_provider, lens, verdict, evidence, shared_worker_context
  ) values (
    subject_record.organization_id,
    subject_record.graph_run_id,
    verifier_record.id,
    subject_record.id,
    verifier_agent_id,
    verifier_record.provider,
    p_lens,
    p_verdict,
    normalized_evidence,
    false
  ) returning id into verification_id;

  insert into public.graph_events (
    organization_id, graph_run_id, node_run_id, event_type, detail, payload
  ) values (
    subject_record.organization_id,
    subject_record.graph_run_id,
    subject_record.id,
    'verification_recorded',
    pg_catalog.format(
      'Worker %s recorded a %s verdict under the %s lens.',
      p_worker_id,
      p_verdict,
      p_lens
    ),
    pg_catalog.jsonb_build_object(
      'verdict', p_verdict,
      'lens', p_lens,
      'verifier_node_run_id', verifier_record.id
    )
  );

  return verification_id;
end;
$function$;

revoke all on function public.record_verification_as_worker(
  text, uuid, public.verification_lens, public.verification_verdict,
  jsonb, uuid, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.record_graph_verification_internal(
  text, uuid, uuid, public.verification_lens, public.verification_verdict, jsonb
) from public, anon, authenticated, service_role;

-- A reviewer completion and every verdict derived from that one model answer
-- commit as one statement. A crash can therefore leave either the still-
-- RUNNING reviewer (safe to retry) or the complete, exact evidence set; it
-- can never strand a terminal reviewer with missing/partial verifications.
create or replace function public.complete_reviewer_with_verifications_as_worker(
  p_worker_id text,
  p_verifier_node_run_id uuid,
  p_artifact_payload jsonb,
  p_provider text,
  p_model text,
  p_latency_ms integer,
  p_verifications jsonb
)
returns public.node_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  peek_verifier public.node_runs%rowtype;
  verifier_record public.node_runs%rowtype;
  graph_run_record public.graph_runs%rowtype;
  verification_item jsonb;
  normalized_verifications jsonb := coalesce(p_verifications, '[]'::jsonb);
  verifier_capability text;
  verifier_executor public.graph_node_executor;
  expected_lens public.verification_lens;
  subject_id uuid;
  item_verdict public.verification_verdict;
  item_evidence jsonb;
  expected_subject_count integer;
  source_artifact public.graph_artifacts%rowtype;
  source_artifact_sha256_value text;
  verification_id uuid;
  normalized_artifact_payload jsonb := coalesce(p_artifact_payload, '{}'::jsonb);
  normalized_detail text := pg_catalog.format('worker %s', p_worker_id);
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if public.jsonb_has_sensitive_keys(normalized_artifact_payload)
    or pg_catalog.octet_length(normalized_artifact_payload::text) > 1048576
  then
    raise exception using errcode = '22023',
      message = 'reviewer artifact payload is sensitive or oversized';
  end if;
  if p_verifier_node_run_id is null
    or p_provider not in ('anthropic', 'openai')
    or p_model is null
    or p_model is distinct from pg_catalog.btrim(p_model)
    or pg_catalog.char_length(p_model) not between 1 and 128
    or p_latency_ms is null
    or p_latency_ms < 0
  then
    raise exception using errcode = '22023',
      message = 'reviewer execution identity is incomplete or invalid';
  end if;
  if pg_catalog.jsonb_typeof(normalized_verifications) <> 'array'
    or pg_catalog.jsonb_array_length(normalized_verifications) not between 1 and 64
    or pg_catalog.pg_column_size(normalized_verifications) > 131072
  then
    raise exception using errcode = '22023',
      message = 'reviewer verification batch is invalid or oversized';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(normalized_verifications) item(value)
  ) is distinct from (
    select pg_catalog.count(distinct item.value ->> 'subjectNodeRunId')
    from pg_catalog.jsonb_array_elements(normalized_verifications) item(value)
  ) then
    raise exception using errcode = '22023',
      message = 'reviewer verification subjects must be unique';
  end if;

  select * into peek_verifier
  from public.node_runs node_run
  where node_run.id = p_verifier_node_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'node_run_not_found';
  end if;

  select * into graph_run_record
  from public.graph_runs run
  where run.id = peek_verifier.graph_run_id
    and run.organization_id = peek_verifier.organization_id
  for update;
  if not found or graph_run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000', message = 'parent_graph_run_not_running';
  end if;

  select * into verifier_record
  from public.node_runs node_run
  where node_run.id = p_verifier_node_run_id
    and node_run.graph_run_id = graph_run_record.id
    and node_run.organization_id = graph_run_record.organization_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'node_run_identity_changed';
  end if;

  select node.capability, node.executor into verifier_capability, verifier_executor
  from public.graph_nodes node
  where node.id = verifier_record.node_id
    and node.organization_id = verifier_record.organization_id
    and node.graph_id = graph_run_record.graph_id;
  expected_lens := case when verifier_executor = 'MODEL'::public.graph_node_executor then case verifier_capability
    when 'review' then 'correctness'::public.verification_lens
    when 'security_review' then 'security'::public.verification_lens
    when 'qa' then 'acceptance_criteria'::public.verification_lens
    else null::public.verification_lens
  end else null::public.verification_lens end;
  if expected_lens is null then
    raise exception using errcode = '22023',
      message = 'node capability is not a reviewer';
  end if;

  -- Validate the complete batch before changing terminal state. Any cast or
  -- evidence failure aborts this RPC statement and therefore rolls back all
  -- changes, but validating first also gives the caller the useful refusal.
  for verification_item in
    select item.value
    from pg_catalog.jsonb_array_elements(normalized_verifications) item(value)
  loop
    if pg_catalog.jsonb_typeof(verification_item) <> 'object'
      or not (verification_item ? 'subjectNodeRunId')
      or not (verification_item ? 'verdict')
      or not (verification_item ? 'evidence')
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(verification_item)
      ) <> 3
    then
      raise exception using errcode = '22023',
        message = 'reviewer verification item has an invalid shape';
    end if;
    begin
      subject_id := (verification_item ->> 'subjectNodeRunId')::uuid;
      item_verdict := (verification_item ->> 'verdict')::public.verification_verdict;
    exception when others then
      raise exception using errcode = '22023',
        message = 'reviewer verification item has an invalid identity or verdict';
    end;
    item_evidence := verification_item -> 'evidence';
    if subject_id = verifier_record.id
      or not public.graph_verification_evidence_is_safe(item_evidence)
    then
      raise exception using errcode = '22023',
        message = 'reviewer verification item is unsafe or self-referential';
    end if;
  end loop;

  select pg_catalog.count(*)::integer into expected_subject_count
  from public.graph_edges edge
  join public.node_runs subject
    on subject.node_id = edge.from_node_id
   and subject.organization_id = verifier_record.organization_id
   and subject.graph_run_id = verifier_record.graph_run_id
   and subject.state = 'COMPLETED'::public.graph_node_state
  where edge.graph_id = graph_run_record.graph_id
    and edge.organization_id = graph_run_record.organization_id
    and edge.to_node_id = verifier_record.node_id
    and not edge.is_feedback;
  if expected_subject_count < 1
    or expected_subject_count <> pg_catalog.jsonb_array_length(normalized_verifications)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(normalized_verifications) item(value)
      where not exists (
        select 1
        from public.graph_edges edge
        join public.node_runs subject
          on subject.node_id = edge.from_node_id
         and subject.organization_id = verifier_record.organization_id
         and subject.graph_run_id = verifier_record.graph_run_id
         and subject.state = 'COMPLETED'::public.graph_node_state
        where edge.graph_id = graph_run_record.graph_id
          and edge.organization_id = graph_run_record.organization_id
          and edge.to_node_id = verifier_record.node_id
          and not edge.is_feedback
          and subject.id = (item.value ->> 'subjectNodeRunId')::uuid
      )
    )
  then
    raise exception using errcode = '22023',
      message = 'reviewer verification batch must exactly match completed incoming subjects';
  end if;

  select * into source_artifact
  from public.graph_artifacts artifact
  where artifact.node_run_id = verifier_record.id
    and artifact.kind = 'RAW'::public.graph_artifact_kind
  for update;
  if found then
    if source_artifact.organization_id is distinct from verifier_record.organization_id
      or source_artifact.graph_run_id is distinct from verifier_record.graph_run_id
      or source_artifact.payload is distinct from normalized_artifact_payload
      or source_artifact.item_count is not null
      or source_artifact.reduced_from_count is not null
    then
      raise exception using errcode = '22023',
        message = 'reviewer artifact replay does not match the durable product slot';
    end if;
  elsif verifier_record.state = 'RUNNING'::public.graph_node_state then
    insert into public.graph_artifacts (
      organization_id, graph_run_id, node_run_id, kind, payload
    ) values (
      verifier_record.organization_id,
      verifier_record.graph_run_id,
      verifier_record.id,
      'RAW'::public.graph_artifact_kind,
      normalized_artifact_payload
    ) returning * into source_artifact;
  else
    raise exception using errcode = '22023',
      message = 'completed reviewer has no exact source artifact';
  end if;
  source_artifact_sha256_value := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(source_artifact.payload::text, 'UTF8')
  ), 'hex');

  if verifier_record.state = 'COMPLETED'::public.graph_node_state then
    if verifier_record.completed_at is null
      or verifier_record.provider is distinct from p_provider
      or verifier_record.model is distinct from p_model
      or verifier_record.latency_ms is distinct from p_latency_ms
      or not exists (
        select 1
        from public.graph_events event
        where event.organization_id = verifier_record.organization_id
          and event.graph_run_id = verifier_record.graph_run_id
          and event.node_run_id = verifier_record.id
          and event.event_type = 'node_completed'
          and event.detail is not distinct from normalized_detail
      )
    then
      raise exception using errcode = '22023',
        message = 'reviewer completion replay does not match durable evidence';
    end if;
    if (
      select pg_catalog.count(*)
      from public.graph_verifications verification
      where verification.verifier_node_run_id = verifier_record.id
        and verification.organization_id = verifier_record.organization_id
        and verification.graph_run_id = verifier_record.graph_run_id
    ) <> pg_catalog.jsonb_array_length(normalized_verifications)
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(normalized_verifications) item(value)
        where not exists (
          select 1
          from public.graph_verifications verification
          where verification.verifier_node_run_id = verifier_record.id
            and verification.organization_id = verifier_record.organization_id
            and verification.graph_run_id = verifier_record.graph_run_id
            and verification.subject_node_run_id =
              (item.value ->> 'subjectNodeRunId')::uuid
            and verification.lens = expected_lens
            and verification.verdict =
              (item.value ->> 'verdict')::public.verification_verdict
            and verification.evidence = item.value -> 'evidence'
            and not verification.shared_worker_context
            and verification.source_artifact_id = source_artifact.id
            and verification.source_artifact_sha256 = source_artifact_sha256_value
        )
      )
    then
      raise exception using errcode = '22023',
        message = 'reviewer verification replay does not match the durable exact set';
    end if;
    return verifier_record;
  elsif verifier_record.state = 'RUNNING'::public.graph_node_state then
    update public.node_runs
    set state = 'COMPLETED'::public.graph_node_state,
        provider = p_provider,
        model = p_model,
        latency_ms = p_latency_ms,
        completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where id = verifier_record.id
    returning * into verifier_record;

    insert into public.graph_events (
      organization_id, graph_run_id, node_run_id, event_type, detail
    ) values (
      verifier_record.organization_id,
      verifier_record.graph_run_id,
      verifier_record.id,
      'node_completed',
      normalized_detail
    );
  else
    raise exception using errcode = '22023',
      message = 'reviewer must be running before atomic completion';
  end if;

  for verification_item in
    select item.value
    from pg_catalog.jsonb_array_elements(normalized_verifications) item(value)
  loop
    verification_id := public.record_graph_verification_internal(
      p_worker_id,
      verifier_record.id,
      (verification_item ->> 'subjectNodeRunId')::uuid,
      expected_lens,
      (verification_item ->> 'verdict')::public.verification_verdict,
      verification_item -> 'evidence'
    );
    update public.graph_verifications verification
    set source_artifact_id = source_artifact.id,
        source_artifact_sha256 = source_artifact_sha256_value
    where verification.id = verification_id
      and verification.organization_id = verifier_record.organization_id
      and verification.graph_run_id = verifier_record.graph_run_id
      and (
        (verification.source_artifact_id is null
          and verification.source_artifact_sha256 is null)
        or (
          verification.source_artifact_id = source_artifact.id
          and verification.source_artifact_sha256 = source_artifact_sha256_value
        )
      );
    if not found then
      raise exception using errcode = '22023',
        message = 'reviewer verification source artifact replay mismatch';
    end if;
  end loop;

  select * into verifier_record
  from public.node_runs node_run
  where node_run.id = p_verifier_node_run_id;
  return verifier_record;
end;
$function$;

revoke all on function public.complete_reviewer_with_verifications_as_worker(
  text, uuid, jsonb, text, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_reviewer_with_verifications_as_worker(
  text, uuid, jsonb, text, text, integer, jsonb
) to service_role;

-- Retire the repository-agnostic diagnostic. A global oldest-first sample can
-- disagree with a protocol-v2 claim because it knows neither the worker's
-- repository nor its exact repository-owned check policy.
create or replace function public.diagnose_graph_queue_as_worker(
  p_worker_id text
)
returns table (
  id uuid,
  requires_owner_approval boolean,
  is_lifecycle boolean,
  created_at timestamptz,
  graph_nodes jsonb,
  graph_runs jsonb,
  graph_gates jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.assert_graph_worker_id(p_worker_id);
  return query
  select
    graph.id,
    graph.requires_owner_approval,
    graph.is_lifecycle,
    graph.created_at,
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('executor', node.executor)
        order by node.node_key, node.id
      )
      from public.graph_nodes node
      where node.graph_id = graph.id
        and node.organization_id = graph.organization_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'state', run.state,
          'completed_at', run.completed_at
        ) order by run.created_at, run.id
      )
      from public.graph_runs run
      where run.graph_id = graph.id
        and run.organization_id = graph.organization_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'state', gate.state,
          'opened_at', gate.opened_at,
          'decided_at', gate.decided_at
        ) order by gate.opened_at, gate.id
      )
      from public.graph_gates gate
      where gate.graph_id = graph.id
        and gate.organization_id = graph.organization_id
    ), '[]'::jsonb)
  from public.graphs graph
  order by graph.created_at, graph.id
  limit 25;
end;
$function$;

revoke all on function public.diagnose_graph_queue_as_worker(text)
  from public, anon, authenticated, service_role;

-- Diagnose the same repository, required-check, and post-ARCH bridge filters
-- used by claim_planned_graph. A repository_dispatch may name one graph for a
-- precise answer; schedule/manual drains receive the newest bounded sample.
-- The payload remains metadata-only: no goal, artifact body, or credential is
-- returned, and this routine confers no execution authority.
create or replace function public.diagnose_graph_queue_as_worker_v2(
  p_worker_id text,
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_target_graph_id uuid,
  p_protocol_version integer
)
returns table (
  id uuid,
  requires_owner_approval boolean,
  is_lifecycle boolean,
  created_at timestamptz,
  repository_scope_matches boolean,
  required_check_policy_matches boolean,
  phase1c_resume_ready boolean,
  graph_nodes jsonb,
  graph_runs jsonb,
  graph_gates jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '22023',
      message = 'graph queue diagnosis protocol version 2 is required';
  end if;
  if p_repository_full_name is null
    or p_repository_full_name is distinct from pg_catalog.btrim(p_repository_full_name)
    or pg_catalog.char_length(p_repository_full_name) not between 3 and 201
    or p_repository_full_name !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    or not public.graph_required_check_policy_is_safe(p_required_check_names)
  then
    raise exception using errcode = '22023',
      message = 'a worker must declare its exact repository and required-check policy';
  end if;

  return query
  select
    graph.id,
    graph.requires_owner_approval,
    graph.is_lifecycle,
    graph.created_at,
    exists (
      select 1
      from public.projects project
      join public.project_connections link
        on link.project_id = project.id
       and link.organization_id = project.organization_id
       and link.is_primary
      join public.connections connection
        on connection.id = link.connection_id
       and connection.organization_id = link.organization_id
      join public.github_installations installation
        on installation.connection_id = connection.id
       and installation.organization_id = connection.organization_id
      join public.github_repositories repository
        on repository.id = link.github_repository_id
       and repository.installation_id = installation.id
       and repository.organization_id = link.organization_id
      where project.id = graph.project_id
        and project.organization_id = graph.organization_id
        and project.status = 'active'::public.project_status
        and connection.provider = 'github'::public.connection_provider
        and connection.status = 'connected'::public.connection_status
        and installation.status = 'active'
        and installation.suspended_at is null
        and installation.deleted_at is null
        and repository.selected
        and not repository.archived
        and not repository.disabled
        and project.github_repository = repository.full_name
        and project.default_branch = repository.default_branch
        and pg_catalog.lower(repository.full_name) =
          pg_catalog.lower(p_repository_full_name)
        and (graph.github_repository_id is null
          or graph.github_repository_id = repository.id)
    ),
    (
      graph.template_key is distinct from 'full_lifecycle'
      or graph.template_version is distinct from 2
      or graph.required_check_names = p_required_check_names
    ),
    (
      not graph.is_lifecycle
      or graph.template_key is distinct from 'full_lifecycle'
      or graph.template_version is distinct from 2
      or not exists (
        select 1
        from public.graph_gates architecture_gate
        where architecture_gate.graph_id = graph.id
          and architecture_gate.organization_id = graph.organization_id
          and architecture_gate.stage = 'ARCHITECTURE'::public.sdlc_stage
          and architecture_gate.state = 'APPROVED'::public.gate_state
      )
      or exists (
        select 1
        from public.graph_runs predecessor
        join public.graph_phase1c_bridges bridge
          on bridge.organization_id = predecessor.organization_id
         and bridge.graph_id = predecessor.graph_id
         and (
           bridge.id = predecessor.phase1c_bridge_id
           or (
             predecessor.phase1c_bridge_id is null
             and bridge.graph_run_id = predecessor.id
           )
         )
        where predecessor.id = (
          select prior.id
          from public.graph_runs prior
          where prior.graph_id = graph.id
            and prior.organization_id = graph.organization_id
            and prior.state not in ('FAILED', 'CANCELLED')
            and prior.completed_at is not null
          order by prior.completed_at desc, prior.id desc
          limit 1
        )
          and public.graph_phase1c_bridge_state_rank(bridge.state) >=
            public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED')
      )
    ),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('executor', node.executor)
        order by node.node_key, node.id
      )
      from public.graph_nodes node
      where node.graph_id = graph.id
        and node.organization_id = graph.organization_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'state', run.state,
          'completed_at', run.completed_at
        ) order by run.created_at, run.id
      )
      from public.graph_runs run
      where run.graph_id = graph.id
        and run.organization_id = graph.organization_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'state', gate.state,
          'opened_at', gate.opened_at,
          'decided_at', gate.decided_at
        ) order by gate.opened_at, gate.id
      )
      from public.graph_gates gate
      where gate.graph_id = graph.id
        and gate.organization_id = graph.organization_id
    ), '[]'::jsonb)
  from public.graphs graph
  where (p_target_graph_id is null or graph.id = p_target_graph_id)
    and exists (
      select 1
      from public.projects project
      join public.project_connections link
        on link.project_id = project.id
       and link.organization_id = project.organization_id
       and link.is_primary
      join public.connections connection
        on connection.id = link.connection_id
       and connection.organization_id = link.organization_id
      join public.github_installations installation
        on installation.connection_id = connection.id
       and installation.organization_id = connection.organization_id
      join public.github_repositories repository
        on repository.id = link.github_repository_id
       and repository.installation_id = installation.id
       and repository.organization_id = link.organization_id
      where project.id = graph.project_id
        and project.organization_id = graph.organization_id
        and project.status = 'active'::public.project_status
        and connection.provider = 'github'::public.connection_provider
        and connection.status = 'connected'::public.connection_status
        and installation.status = 'active'
        and installation.suspended_at is null
        and installation.deleted_at is null
        and repository.selected
        and not repository.archived
        and not repository.disabled
        and project.github_repository = repository.full_name
        and project.default_branch = repository.default_branch
        and pg_catalog.lower(repository.full_name) =
          pg_catalog.lower(p_repository_full_name)
        and (graph.github_repository_id is null
          or graph.github_repository_id = repository.id)
    )
  order by graph.created_at desc, graph.id desc
  limit 50;
end;
$function$;

revoke all on function public.diagnose_graph_queue_as_worker_v2(
  text, text, jsonb, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.diagnose_graph_queue_as_worker_v2(
  text, text, jsonb, uuid, integer
) to service_role;

-- Bridge one exact graph run after its architecture gate has been approved.
-- Launch must already have stored the exact release identity; this function
-- compares it and can never relabel a graph after seeing its output.
create or replace function public.create_graph_phase1c_bridge_as_worker(
  p_graph_id uuid,
  p_graph_run_id uuid,
  p_implementation_node_id uuid,
  p_architecture_gate_id uuid,
  p_architecture_artifact_id uuid,
  p_template_key text,
  p_template_version integer,
  p_github_repository_id uuid,
  p_base_branch text,
  p_base_sha text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  graph_record public.graphs%rowtype;
  gate_record public.graph_gates%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  existing_record public.graph_phase1c_bridges%rowtype;
  architecture_intent_sha256 text;
  bridge_id uuid;
begin
  if p_template_key is null or p_template_key !~ '^[a-z][a-z0-9_]{0,79}$'
    or p_template_version is null or p_template_version <= 0
    or p_base_branch is null or char_length(btrim(p_base_branch)) not between 1 and 255
    or p_base_sha is null or p_base_sha !~ '^[0-9a-f]{40}$'
    or p_github_repository_id is null
  then
    raise exception using errcode = '22023',
      message = 'exact template and repository snapshot identity is required';
  end if;

  select * into graph_record
  from public.graphs
  where id = p_graph_id
  for update;

  if not found or not graph_record.is_lifecycle then
    raise exception using errcode = '22023',
      message = 'a lifecycle graph is required';
  end if;

  if graph_record.template_id is not null and not exists (
    select 1 from public.graph_templates template
    where template.id = graph_record.template_id
      and template.organization_id = graph_record.organization_id
      and template.slug = p_template_key
      and template.version = p_template_version
  ) then
    raise exception using errcode = '23514',
      message = 'graph template identity does not match its stored template';
  end if;

  if graph_record.template_key is null
    or graph_record.template_version is null
    or graph_record.github_repository_id is null
    or graph_record.base_branch is null
    or graph_record.base_sha is null
    or graph_record.template_key is distinct from p_template_key
    or graph_record.template_version is distinct from p_template_version
    or graph_record.github_repository_id is distinct from p_github_repository_id
    or graph_record.base_branch is distinct from btrim(p_base_branch)
    or graph_record.base_sha is distinct from p_base_sha
  then
    raise exception using errcode = '55000',
      message = 'persisted graph launch identity does not match the requested bridge';
  end if;

  if not exists (
    select 1
    from public.project_connections link
    join public.connections connection
      on connection.id = link.connection_id
     and connection.organization_id = link.organization_id
    join public.github_repositories repository
      on repository.id = link.github_repository_id
     and repository.organization_id = link.organization_id
    join public.github_installations installation
      on installation.id = repository.installation_id
     and installation.organization_id = repository.organization_id
    where link.organization_id = graph_record.organization_id
      and link.project_id = graph_record.project_id
      and link.github_repository_id = p_github_repository_id
      and link.is_primary
      and connection.provider = 'github'::public.connection_provider
      and connection.status = 'connected'::public.connection_status
      and repository.selected
      and not repository.archived
      and not repository.disabled
      and installation.status = 'active'
      and installation.suspended_at is null
      and installation.deleted_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'repository identity is not connected to the graph project';
  end if;

  select * into existing_record
  from public.graph_phase1c_bridges bridge
  where bridge.graph_run_id = p_graph_run_id
  for update;

  if found then
    if existing_record.graph_id is distinct from p_graph_id
      or existing_record.implementation_node_id is distinct from p_implementation_node_id
      or existing_record.architecture_gate_id is distinct from p_architecture_gate_id
      or existing_record.architecture_artifact_id is distinct from p_architecture_artifact_id
    then
      raise exception using errcode = '55000',
        message = 'graph run already has different Phase 1C lineage';
    end if;
    return existing_record.id;
  end if;

  if not exists (
    select 1 from public.graph_runs run
    where run.id = p_graph_run_id
      and run.organization_id = graph_record.organization_id
      and run.graph_id = graph_record.id
  ) then
    raise exception using errcode = '23514',
      message = 'graph run does not belong to the lifecycle graph';
  end if;

  if not exists (
    select 1 from public.graph_nodes node
    where node.id = p_implementation_node_id
      and node.organization_id = graph_record.organization_id
      and node.graph_id = graph_record.id
      and node.lifecycle_stage = 'IMPLEMENTATION'::public.sdlc_stage
  ) then
    raise exception using errcode = '23514',
      message = 'implementation node does not belong to the lifecycle graph';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = p_architecture_gate_id
    and gate.organization_id = graph_record.organization_id;

  if not found
    or gate_record.graph_id is distinct from graph_record.id
    or gate_record.stage <> 'ARCHITECTURE'::public.sdlc_stage
    or gate_record.state <> 'APPROVED'::public.gate_state
    or gate_record.decided_at is null
    or gate_record.opened_by_run_id is distinct from p_graph_run_id
  then
    raise exception using errcode = '55000',
      message = 'an approved architecture gate is required';
  end if;

  select artifact.* into artifact_record
    from public.graph_artifacts artifact
    join public.node_runs node_run
      on node_run.id = artifact.node_run_id
     and node_run.organization_id = artifact.organization_id
    join public.graph_runs graph_run
      on graph_run.id = node_run.graph_run_id
     and graph_run.organization_id = node_run.organization_id
     and graph_run.graph_id = graph_record.id
    where artifact.id = p_architecture_artifact_id
      and artifact.organization_id = graph_record.organization_id
      and artifact.graph_run_id = p_graph_run_id
      and node_run.graph_run_id = p_graph_run_id
      and node_run.node_id = gate_record.node_id
      and (
        (node_run.state = 'VERIFYING'::public.graph_node_state
          and node_run.completed_at is null)
        or (node_run.state = 'COMPLETED'::public.graph_node_state
          and node_run.completed_at is not null)
      )
      and graph_run.state in (
        'PARTIAL'::public.graph_run_state,
        'COMPLETED'::public.graph_run_state
      )
      and graph_run.completed_at is not null
      and artifact.kind = 'RAW'::public.graph_artifact_kind
      and artifact.created_at <= gate_record.decided_at
  ;
  if not found then
    raise exception using errcode = '23514',
      message = 'architecture artifact is not evidence from the approved gate node and graph run';
  end if;

  architecture_intent_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'version', 1,
        'goal', graph_record.goal,
        'architecture', artifact_record.payload
      )::text,
      'UTF8'
    )),
    'hex'
  );

  insert into public.graph_phase1c_bridges (
    organization_id, project_id, graph_id, graph_run_id,
    implementation_node_id, architecture_gate_id, architecture_artifact_id,
    architecture_intent_sha256, created_by
  ) values (
    graph_record.organization_id, graph_record.project_id, graph_record.id,
    p_graph_run_id, p_implementation_node_id, p_architecture_gate_id,
    p_architecture_artifact_id, architecture_intent_sha256, graph_record.created_by
  )
  returning id into bridge_id;

  return bridge_id;
end;
$function$;

-- Browser-safe doorway used immediately after an owner approves the
-- full_lifecycle ARCHITECTURE gate. The caller supplies no graph run, node, or
-- artifact identity: all three are derived from the approved gate so a browser
-- cannot splice unrelated evidence into a bridge.
create or replace function public.create_graph_phase1c_bridge_for_approved_gate(
  p_gate_id uuid,
  p_template_key text,
  p_template_version integer,
  p_github_repository_id uuid,
  p_base_branch text,
  p_base_sha text
)
returns table (
  bridge_id uuid,
  organization_id uuid,
  project_id uuid,
  graph_id uuid,
  graph_run_id uuid,
  implementation_node_id uuid,
  architecture_artifact_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  derived_graph_run_id uuid;
  derived_implementation_node_id uuid;
  derived_architecture_artifact_id uuid;
  implementation_node_count integer;
  created_bridge_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = p_gate_id
  for update;

  if not found
    or gate_record.stage <> 'ARCHITECTURE'::public.sdlc_stage
    or gate_record.kind <> 'HUMAN'::public.gate_kind
    or gate_record.state <> 'APPROVED'::public.gate_state
    or gate_record.decided_at is null
    or gate_record.opened_by_run_id is null
  then
    raise exception using errcode = '55000',
      message = 'an approved human architecture gate is required';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;

  if not found or not graph_record.is_lifecycle
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or p_template_key is distinct from 'full_lifecycle'
    or p_template_version is distinct from 2
  then
    raise exception using errcode = '22023',
      message = 'the approved gate must belong to an exact persisted full_lifecycle v2 graph';
  end if;

  if not public.is_organization_owner(graph_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required';
  end if;

  select count(*), min(node.id::text)::uuid
    into implementation_node_count, derived_implementation_node_id
  from public.graph_nodes node
  where node.organization_id = graph_record.organization_id
    and node.graph_id = graph_record.id
    and node.lifecycle_stage = 'IMPLEMENTATION'::public.sdlc_stage;

  if implementation_node_count <> 1 then
    raise exception using errcode = '55000',
      message = 'full_lifecycle graph must have exactly one implementation node';
  end if;

  select node_run.graph_run_id, artifact.id
    into derived_graph_run_id, derived_architecture_artifact_id
  from public.node_runs node_run
  join public.graph_runs graph_run
    on graph_run.id = node_run.graph_run_id
   and graph_run.organization_id = node_run.organization_id
   and graph_run.graph_id = graph_record.id
  join public.graph_artifacts artifact
    on artifact.node_run_id = node_run.id
   and artifact.organization_id = node_run.organization_id
   and artifact.graph_run_id = node_run.graph_run_id
  where node_run.organization_id = graph_record.organization_id
    and node_run.node_id = gate_record.node_id
    and node_run.graph_run_id = gate_record.opened_by_run_id
    and (
      (node_run.state = 'VERIFYING'::public.graph_node_state
        and node_run.completed_at is null)
      or (node_run.state = 'COMPLETED'::public.graph_node_state
        and node_run.completed_at is not null)
    )
    and graph_run.state in ('PARTIAL', 'COMPLETED')
    and graph_run.completed_at is not null
    and artifact.kind = 'RAW'::public.graph_artifact_kind
    and artifact.created_at <= gate_record.decided_at
  order by artifact.created_at desc, artifact.id desc
  limit 1;

  if derived_graph_run_id is null or derived_architecture_artifact_id is null then
    raise exception using errcode = '55000',
      message = 'approved gate has no completed architecture answer artifact';
  end if;

  created_bridge_id := public.create_graph_phase1c_bridge_as_worker(
    graph_record.id,
    derived_graph_run_id,
    derived_implementation_node_id,
    gate_record.id,
    derived_architecture_artifact_id,
    p_template_key,
    p_template_version,
    p_github_repository_id,
    p_base_branch,
    p_base_sha
  );

  return query
  select bridge.id, bridge.organization_id, bridge.project_id, bridge.graph_id,
         bridge.graph_run_id, bridge.implementation_node_id,
         bridge.architecture_artifact_id
  from public.graph_phase1c_bridges bridge
  where bridge.id = created_bridge_id;
end;
$function$;

-- Persist the normalized command/task mapping before any Phase 1C dispatch.
-- This is an owner-authenticated server boundary: the mapping is not inferred
-- later from a prompt, project, or caller-supplied graph context.
create or replace function public.attach_graph_phase1c_command_for_approved_gate(
  p_bridge_id uuid,
  p_command_id uuid,
  p_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  command_record public.commands%rowtype;
  task_record public.tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = p_bridge_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;
  if not public.is_organization_owner(bridge_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('COMMAND_RECORDED') then
    if bridge_record.command_id = p_command_id and bridge_record.task_id = p_task_id then
      return bridge_record.id;
    end if;
    raise exception using errcode = '55000',
      message = 'bridge command and task identity is already fixed';
  end if;
  if bridge_record.state <> 'GRAPH_READY' then
    raise exception using errcode = '55000',
      message = 'bridge is not ready for command attachment';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = bridge_record.graph_id
    and graph.organization_id = bridge_record.organization_id
    and graph.project_id = bridge_record.project_id;
  if not found
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or graph_record.github_repository_id is null
    or graph_record.base_branch is null
    or graph_record.base_sha is null
  then
    raise exception using errcode = '55000',
      message = 'exact persisted full_lifecycle v2 release identity is required';
  end if;

  select * into command_record
  from public.commands command
  where command.id = p_command_id
    and command.organization_id = bridge_record.organization_id
    and command.project_id = bridge_record.project_id
  for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'command does not belong to the bridge tenant project';
  end if;

  select * into task_record
  from public.tasks task
  where task.id = p_task_id
    and task.organization_id = bridge_record.organization_id
    and task.project_id = bridge_record.project_id
  for update;
  if not found or task_record.command_id is distinct from command_record.id then
    raise exception using errcode = '23514',
      message = 'task does not belong to the bridge command';
  end if;

  if command_record.submitted_by is distinct from auth.uid()
    or command_record.idempotency_key is distinct from
      ('graph-phase1c:' || bridge_record.id::text)
    or command_record.command_type is distinct from 'build_feature'
    or command_record.requested_risk is distinct from graph_record.risk_level
    or command_record.parameters #>> '{executionMode}' is distinct from 'manual'
    or command_record.parameters #>> '{repositoryBinding,repositoryId}' is distinct from
      graph_record.github_repository_id::text
    or command_record.parameters #>> '{repositoryBinding,baseBranch}' is distinct from
      graph_record.base_branch
    or command_record.parameters #>> '{repositoryBinding,baseSha}' is distinct from
      graph_record.base_sha
    or command_record.status not in (
      'submitted'::public.command_status,
      'awaiting_approval'::public.command_status,
      'queued'::public.command_status
    )
    or task_record.created_by is distinct from command_record.submitted_by
    or task_record.risk_level is distinct from command_record.requested_risk
    or task_record.status not in (
      'backlog'::public.task_status,
      'awaiting_approval'::public.task_status,
      'queued'::public.task_status
    )
  then
    raise exception using errcode = '23514',
      message = 'command and task do not match the approved graph release contract';
  end if;

  update public.graph_phase1c_bridges
  set command_id = command_record.id,
      task_id = task_record.id,
      state = 'COMMAND_RECORDED'
  where id = bridge_record.id;

  return bridge_record.id;
end;
$function$;

-- Submit the exact approved architecture and attach its command before either
-- row becomes visible to a worker. The database derives the prompt and its
-- immutable digest from the stored graph/artifact; callers cannot substitute
-- an unrelated prompt or lower risk while reusing the bridge idempotency key.
create or replace function public.submit_and_attach_graph_phase1c_command(
  p_bridge_id uuid,
  p_parameters jsonb
)
returns table (
  bridge_id uuid,
  command_id uuid,
  task_id uuid,
  command_state public.command_status,
  task_state public.task_status,
  requires_owner_approval boolean,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  submission_record record;
  canonical_prompt text;
  expected_intent_sha256 text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = p_bridge_id
  for update;
  if not found or not public.is_organization_owner(bridge_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = bridge_record.graph_id
    and graph.organization_id = bridge_record.organization_id
    and graph.project_id = bridge_record.project_id;
  if not found
    or not graph_record.is_lifecycle
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or graph_record.risk_level is distinct from 'yellow'::public.risk_level
    or graph_record.github_repository_id is null
    or graph_record.base_branch is null
    or graph_record.base_sha is null
  then
    raise exception using errcode = '23514',
      message = 'exact persisted full lifecycle release identity is required';
  end if;

  select * into artifact_record
  from public.graph_artifacts artifact
  where artifact.id = bridge_record.architecture_artifact_id
    and artifact.organization_id = bridge_record.organization_id
    and artifact.graph_run_id = bridge_record.graph_run_id
    and artifact.kind = 'RAW'::public.graph_artifact_kind;
  if not found then
    raise exception using errcode = '23514',
      message = 'approved architecture artifact identity is missing';
  end if;

  expected_intent_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'version', 1,
        'goal', graph_record.goal,
        'architecture', artifact_record.payload
      )::text,
      'UTF8'
    )),
    'hex'
  );
  if bridge_record.architecture_intent_sha256 is distinct from expected_intent_sha256 then
    raise exception using errcode = '55000',
      message = 'approved architecture intent digest does not match stored evidence';
  end if;

  canonical_prompt :=
    'Implement the exact architecture approved by the owner in this full lifecycle.' || E'\n' ||
    'Work only in the connected repository snapshot recorded below. Produce a validated draft pull request; do not merge or deploy.' || E'\n\n' ||
    'Goal:' || E'\n' || pg_catalog.btrim(graph_record.goal) || E'\n\n' ||
    'Approved architecture:' || E'\n' || artifact_record.payload::text || E'\n\n' ||
    'Architecture intent SHA-256: ' || expected_intent_sha256 || E'\n' ||
    'Preserve unrelated behavior and report validation evidence.';
  if pg_catalog.char_length(canonical_prompt) not between 1 and 4000
    or public.text_has_likely_secret(canonical_prompt)
    or public.jsonb_has_sensitive_keys(artifact_record.payload)
  then
    raise exception using errcode = '22023',
      message = 'approved architecture cannot be represented as a safe bounded Phase 1C command';
  end if;

  select * into submission_record
  from public.submit_command(
    graph_record.project_id,
    canonical_prompt,
    graph_record.risk_level,
    p_parameters,
    'graph-phase1c:' || bridge_record.id::text
  );
  if not found then
    raise exception using errcode = '55000',
      message = 'Phase 1C command submission returned no identity';
  end if;

  perform public.attach_graph_phase1c_command_for_approved_gate(
    bridge_record.id,
    submission_record.command_id,
    submission_record.task_id
  );

  return query select
    bridge_record.id,
    submission_record.command_id,
    submission_record.task_id,
    submission_record.command_state,
    submission_record.task_state,
    submission_record.requires_owner_approval,
    submission_record.was_created;
end;
$function$;

create or replace function public.bind_graph_phase1c_run_as_worker(
  p_bridge_id uuid,
  p_command_id uuid,
  p_task_id uuid,
  p_agent_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  task_record public.tasks%rowtype;
  run_record public.agent_runs%rowtype;
begin
  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('PHASE1C_BOUND') then
    if bridge_record.command_id = p_command_id
      and bridge_record.task_id = p_task_id
      and bridge_record.agent_run_id = p_agent_run_id
    then
      return bridge_record.id;
    end if;
    raise exception using errcode = '55000', message = 'Phase 1C run identity is already fixed';
  end if;
  if bridge_record.state <> 'COMMAND_RECORDED' then
    raise exception using errcode = '55000', message = 'bridge is not ready for Phase 1C binding';
  end if;

  if bridge_record.command_id is distinct from p_command_id
    or bridge_record.task_id is distinct from p_task_id
  then
    raise exception using errcode = '55000',
      message = 'Phase 1C run does not match the attached command and task';
  end if;

  select * into graph_record from public.graphs where id = bridge_record.graph_id;
  if graph_record.template_key is null or graph_record.github_repository_id is null
    or graph_record.base_branch is null or graph_record.base_sha is null
  then
    raise exception using errcode = '55000', message = 'graph release identity is incomplete';
  end if;

  if not exists (
    select 1 from public.commands command
    where command.id = p_command_id
      and command.organization_id = bridge_record.organization_id
      and command.project_id = bridge_record.project_id
  ) then
    raise exception using errcode = '23514', message = 'command does not belong to the bridge project';
  end if;

  select * into task_record from public.tasks task
  where task.id = p_task_id and task.organization_id = bridge_record.organization_id;
  if not found or task_record.project_id <> bridge_record.project_id
    or task_record.command_id is distinct from p_command_id
  then
    raise exception using errcode = '23514', message = 'task does not belong to the bridge command';
  end if;

  select * into run_record from public.agent_runs run
  where run.id = p_agent_run_id and run.organization_id = bridge_record.organization_id;
  if not found or run_record.project_id <> bridge_record.project_id
    or run_record.task_id <> p_task_id
    or run_record.command_id is distinct from p_command_id
    or task_record.assigned_agent_id is distinct from run_record.agent_id
    or run_record.github_repository_id is distinct from graph_record.github_repository_id
    or run_record.base_branch is distinct from graph_record.base_branch
    or run_record.base_sha is distinct from graph_record.base_sha
  then
    raise exception using errcode = '23514',
      message = 'agent run does not match the graph command, task, repository, and base snapshot';
  end if;

  update public.graph_phase1c_bridges
  set command_id = p_command_id,
      task_id = p_task_id,
      agent_run_id = p_agent_run_id,
      state = 'PHASE1C_BOUND'
  where id = bridge_record.id;

  return bridge_record.id;
end;
$function$;

-- The claimed Phase 1C job already carries the exact command, task, and run.
-- Resolve only their unique pre-dispatch mapping; never infer a bridge from a
-- project, prompt, or graph id.
create or replace function public.bind_graph_phase1c_run_by_command_as_worker(
  p_command_id uuid,
  p_task_id uuid,
  p_agent_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
begin
  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.command_id = p_command_id
    and bridge.task_id = p_task_id
  for update;

  if not found then
    -- Ordinary Phase 1C jobs have no graph bridge and remain unchanged.
    return null;
  end if;

  return public.bind_graph_phase1c_run_as_worker(
    bridge_record.id,
    p_command_id,
    p_task_id,
    p_agent_run_id
  );
end;
$function$;

create or replace function public.record_graph_phase1c_pull_request_as_worker(
  p_bridge_id uuid,
  p_pull_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  run_record public.agent_runs%rowtype;
  pull_request_record public.pull_requests%rowtype;
  repository_name text;
  latest_validation_round integer;
begin
  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED') then
    if bridge_record.pull_request_id = p_pull_request_id then
      return bridge_record.id;
    end if;
    raise exception using errcode = '55000', message = 'pull request identity is already fixed';
  end if;
  if bridge_record.state <> 'PHASE1C_BOUND' then
    raise exception using errcode = '55000', message = 'Phase 1C run must be bound before its pull request';
  end if;

  select * into graph_record from public.graphs where id = bridge_record.graph_id;
  select * into run_record from public.agent_runs where id = bridge_record.agent_run_id;
  select full_name into repository_name from public.github_repositories
  where id = graph_record.github_repository_id
    and organization_id = bridge_record.organization_id;

  select * into pull_request_record from public.pull_requests pull_request
  where pull_request.id = p_pull_request_id
    and pull_request.organization_id = bridge_record.organization_id;

  if not found or pull_request_record.project_id <> bridge_record.project_id
    or pull_request_record.agent_run_id is distinct from bridge_record.agent_run_id
    or run_record.status <> 'succeeded'::public.run_status
    or run_record.completed_at is null
    or pull_request_record.head_sha is null
    or pull_request_record.head_sha is distinct from run_record.head_sha
    or pull_request_record.head_branch is distinct from run_record.head_branch
    or pull_request_record.base_branch is distinct from graph_record.base_branch
    or lower(pull_request_record.repository) <> lower(repository_name)
  then
    raise exception using errcode = '23514',
      message = 'pull request does not match the Phase 1C run and exact repository head';
  end if;

  select max(validation.validation_round) into latest_validation_round
  from public.phase1c_run_validations validation
  where validation.organization_id = bridge_record.organization_id
    and validation.run_id = bridge_record.agent_run_id
    and validation.attempt_number = run_record.attempt_number;

  if latest_validation_round is null
    or not exists (
      select 1 from public.phase1c_run_validations validation
      where validation.organization_id = bridge_record.organization_id
        and validation.run_id = bridge_record.agent_run_id
        and validation.attempt_number = run_record.attempt_number
        and validation.validation_round = latest_validation_round
        and validation.status = 'passed'
    )
    or exists (
      select 1 from public.phase1c_run_validations validation
      where validation.organization_id = bridge_record.organization_id
        and validation.run_id = bridge_record.agent_run_id
        and validation.attempt_number = run_record.attempt_number
        and validation.validation_round = latest_validation_round
        and validation.status = 'failed'
    )
  then
    raise exception using errcode = '55000',
      message = 'passing latest-round Phase 1C validation evidence is required';
  end if;

  update public.graph_phase1c_bridges
  set pull_request_id = pull_request_record.id,
      head_sha = pull_request_record.head_sha,
      state = 'PULL_REQUEST_RECORDED'
  where id = bridge_record.id;

  return bridge_record.id;
end;
$function$;

-- Complete one Phase 1C run and, when its command/task has a bridge mapping,
-- persist the exact PR head and advance the bridge in the same transaction.
-- Raising anywhere after the delegated completion rolls that completion back;
-- ordinary runs with no attached bridge retain the existing behavior.
create or replace function public.complete_phase1c_run_with_graph_bridge_as_worker(
  p_worker_id text,
  p_run_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_summary text default null,
  p_provider_run_reference text default null,
  p_usage jsonb default '{}'::jsonb,
  p_changed_files jsonb default '[]'::jsonb,
  p_checks jsonb default '[]'::jsonb,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default false
)
returns table (run_id uuid, status public.run_status, completed_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  completed_record record;
  run_record public.agent_runs%rowtype;
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  pull_request_id uuid;
  pull_request_count integer;
  normalized_usage jsonb;
  command_budget jsonb;
  expected_retryable boolean;
begin
  -- A worker can lose its response after the transaction commits. Lock and
  -- recognize only an exact terminal replay; any differing evidence remains a
  -- hard failure and no cleared lease is treated as reusable authority.
  select * into run_record
  from public.agent_runs run
  where run.id = p_run_id
  for update;
  if found and run_record.status in (
    'succeeded'::public.run_status,
    'failed'::public.run_status,
    'cancelled'::public.run_status
  ) then
    normalized_usage := public.canonical_phase1c_usage(p_usage);
    select command.parameters -> 'budget' into command_budget
    from public.commands command
    where command.id = run_record.command_id
      and command.organization_id = run_record.organization_id;
    expected_retryable := p_outcome = 'failed'
      and coalesce(p_retryable, false)
      and run_record.attempt_number < run_record.max_attempts;
    if command_budget is not null and (
      (normalized_usage ->> 'turns')::integer >=
        (command_budget ->> 'maximumTurns')::integer
      or (normalized_usage ->> 'inputTokens')::integer >=
        (command_budget ->> 'maximumInputTokens')::integer
      or (normalized_usage ->> 'outputTokens')::integer >=
        (command_budget ->> 'maximumOutputTokens')::integer
    ) then
      expected_retryable := false;
    end if;

    if run_record.status::text is distinct from p_outcome
      or run_record.completed_at is null
      or run_record.lease_worker_id is not null
      or run_record.lease_token is not null
      or run_record.lease_expires_at is not null
      or run_record.provider_run_reference is distinct from
        nullif(pg_catalog.btrim(coalesce(p_provider_run_reference, '')), '')
      or run_record.output is distinct from pg_catalog.jsonb_build_object(
        'outcome', p_outcome,
        'summary', p_summary
      )
      or run_record.result_summary is distinct from
        nullif(pg_catalog.btrim(coalesce(p_summary, '')), '')
      or run_record.usage is distinct from normalized_usage
      or run_record.changed_files is distinct from coalesce(p_changed_files, '[]'::jsonb)
      or run_record.checks is distinct from coalesce(p_checks, '[]'::jsonb)
      or run_record.error_code is distinct from p_error_code
      or run_record.error_message is distinct from
        nullif(pg_catalog.btrim(coalesce(p_error_message, '')), '')
      or run_record.retryable is distinct from expected_retryable
    then
      raise exception using errcode = '55000',
        message = 'terminal Phase 1C completion evidence does not match exact replay';
    end if;

    select * into bridge_record
    from public.graph_phase1c_bridges bridge
    where bridge.command_id = run_record.command_id
      and bridge.task_id = run_record.task_id
    for update;
    if found then
      if bridge_record.agent_run_id is distinct from run_record.id then
        raise exception using errcode = '55000',
          message = 'terminal Phase 1C run conflicts with its attached graph bridge';
      end if;
      if p_outcome = 'succeeded' then
        if public.graph_phase1c_bridge_state_rank(bridge_record.state) <
            public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED')
          or bridge_record.head_sha is distinct from run_record.head_sha
          or bridge_record.pull_request_id is null
          or not exists (
            select 1 from public.pull_requests pull_request
            where pull_request.id = bridge_record.pull_request_id
              and pull_request.organization_id = bridge_record.organization_id
              and pull_request.project_id = bridge_record.project_id
              and pull_request.agent_run_id = run_record.id
              and pull_request.head_sha = run_record.head_sha
              and pull_request.head_branch = run_record.head_branch
              and pull_request.base_branch = run_record.base_branch
          )
        then
          raise exception using errcode = '55000',
            message = 'terminal Phase 1C replay has incomplete pull request lineage';
        end if;
      elsif bridge_record.state <> 'PHASE1C_BOUND' then
        raise exception using errcode = '55000',
          message = 'terminal unsuccessful Phase 1C replay conflicts with bridge state';
      end if;
    end if;

    return query select run_record.id, run_record.status, run_record.completed_at;
    return;
  end if;

  select * into completed_record
  from public.complete_phase1c_run(
    p_worker_id,
    p_run_id,
    p_lease_token,
    p_outcome,
    p_summary,
    p_provider_run_reference,
    p_usage,
    p_changed_files,
    p_checks,
    p_error_code,
    p_error_message,
    p_retryable
  );
  if not found then
    raise exception using errcode = '55000',
      message = 'Phase 1C completion returned no run identity';
  end if;

  select * into run_record
  from public.agent_runs run
  where run.id = completed_record.run_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'completed Phase 1C run identity is missing';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.command_id = run_record.command_id
    and bridge.task_id = run_record.task_id
  for update;

  if not found then
    return query select completed_record.run_id, completed_record.status,
      completed_record.completed_at;
    return;
  end if;

  if bridge_record.agent_run_id is distinct from run_record.id
    or bridge_record.state <> 'PHASE1C_BOUND'
  then
    raise exception using errcode = '55000',
      message = 'attached graph bridge is not bound to the completing Phase 1C run';
  end if;

  if p_outcome <> 'succeeded' then
    return query select completed_record.run_id, completed_record.status,
      completed_record.completed_at;
    return;
  end if;

  if run_record.status <> 'succeeded'::public.run_status
    or run_record.completed_at is null
    or run_record.head_branch is null
    or run_record.head_sha is null
    or run_record.head_sha !~ '^[0-9a-f]{40}$'
  then
    raise exception using errcode = '55000',
      message = 'successful Phase 1C completion has no exact produced commit';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = bridge_record.graph_id
    and graph.organization_id = bridge_record.organization_id
    and graph.project_id = bridge_record.project_id;
  if not found
    or run_record.github_repository_id is distinct from graph_record.github_repository_id
    or run_record.base_branch is distinct from graph_record.base_branch
    or run_record.base_sha is distinct from graph_record.base_sha
  then
    raise exception using errcode = '23514',
      message = 'completed Phase 1C run no longer matches the graph repository snapshot';
  end if;

  select pg_catalog.count(*)::integer, min(pull_request.id::text)::uuid
    into pull_request_count, pull_request_id
  from public.pull_requests pull_request
  join public.github_repositories repository
    on repository.id = graph_record.github_repository_id
   and repository.organization_id = graph_record.organization_id
  where pull_request.organization_id = bridge_record.organization_id
    and pull_request.project_id = bridge_record.project_id
    and pull_request.agent_run_id = run_record.id
    and pg_catalog.lower(pull_request.repository) = pg_catalog.lower(repository.full_name)
    and pull_request.head_branch = run_record.head_branch
    and pull_request.base_branch = graph_record.base_branch;

  if pull_request_count <> 1 or pull_request_id is null then
    raise exception using errcode = '55000',
      message = 'completion must produce exactly one pull request for the bound run head';
  end if;

  update public.pull_requests
  set head_sha = run_record.head_sha,
      updated_at = pg_catalog.now()
  where id = pull_request_id
    and organization_id = bridge_record.organization_id
    and (head_sha is null or head_sha = run_record.head_sha);
  if not found then
    raise exception using errcode = '55000',
      message = 'pull request head conflicts with the completed Phase 1C run';
  end if;

  perform public.record_graph_phase1c_pull_request_as_worker(
    bridge_record.id,
    pull_request_id
  );

  return query select completed_record.run_id, completed_record.status,
    completed_record.completed_at;
end;
$function$;

create or replace function public.record_graph_phase1c_merge_as_worker(p_bridge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  pull_request_record public.pull_requests%rowtype;
begin
  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('MERGE_RECORDED') then
    return bridge_record.id;
  end if;
  if bridge_record.state <> 'PULL_REQUEST_RECORDED' then
    raise exception using errcode = '55000', message = 'pull request must be recorded before merge';
  end if;

  select * into pull_request_record from public.pull_requests pull_request
  where pull_request.id = bridge_record.pull_request_id
    and pull_request.organization_id = bridge_record.organization_id;
  if not found
    or pull_request_record.status <> 'merged'::public.pull_request_status
    or pull_request_record.merged_at is null
    or pull_request_record.merge_commit_sha is null
    or pull_request_record.created_at > pull_request_record.merged_at
    or (pull_request_record.opened_at is not null
      and pull_request_record.opened_at > pull_request_record.merged_at)
  then
    raise exception using errcode = '55000', message = 'authoritative merged pull request evidence is required';
  end if;

  update public.graph_phase1c_bridges
  set merge_commit_sha = pull_request_record.merge_commit_sha,
      state = 'MERGE_RECORDED'
  where id = bridge_record.id;
  return bridge_record.id;
end;
$function$;

-- Persist an authoritative GitHub merge observation and advance the bridge in
-- one transaction. The caller has already read GitHub; this function proves
-- that response still names the exact recorded PR and head before accepting it.
create or replace function public.record_graph_phase1c_github_merge_as_worker(
  p_bridge_id uuid,
  p_external_number integer,
  p_head_sha text,
  p_head_branch text,
  p_base_branch text,
  p_merge_commit_sha text,
  p_merged_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  pull_request_record public.pull_requests%rowtype;
begin
  if p_external_number is null or p_external_number <= 0
    or p_head_sha is null or p_head_sha !~ '^[0-9a-f]{40}$'
    or p_merge_commit_sha is null or p_merge_commit_sha !~ '^[0-9a-f]{40}$'
    or p_head_branch is null or char_length(btrim(p_head_branch)) not between 1 and 255
    or p_base_branch is null or char_length(btrim(p_base_branch)) not between 1 and 255
    or p_merged_at is null or p_merged_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using errcode = '22023',
      message = 'bounded exact GitHub merge evidence is required';
  end if;

  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  select * into pull_request_record from public.pull_requests pull_request
  where pull_request.id = bridge_record.pull_request_id
    and pull_request.organization_id = bridge_record.organization_id
  for update;

  if not found
    or pull_request_record.external_number <> p_external_number
    or pull_request_record.head_sha is distinct from p_head_sha
    or bridge_record.head_sha is distinct from p_head_sha
    or pull_request_record.head_branch is distinct from btrim(p_head_branch)
    or pull_request_record.base_branch is distinct from btrim(p_base_branch)
    or pull_request_record.created_at > p_merged_at
    or (pull_request_record.opened_at is not null
      and pull_request_record.opened_at > p_merged_at)
  then
    raise exception using errcode = '23514',
      message = 'GitHub merge evidence does not match the bridged pull request head';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('MERGE_RECORDED') then
    if bridge_record.merge_commit_sha = p_merge_commit_sha
      and pull_request_record.status = 'merged'::public.pull_request_status
      and pull_request_record.merge_commit_sha = p_merge_commit_sha
      and pull_request_record.merged_at = p_merged_at
    then
      return bridge_record.id;
    end if;
    raise exception using errcode = '55000', message = 'merge identity is already fixed';
  end if;

  if bridge_record.state <> 'PULL_REQUEST_RECORDED' then
    raise exception using errcode = '55000',
      message = 'pull request must be recorded before its GitHub merge';
  end if;

  update public.pull_requests
  set status = 'merged'::public.pull_request_status,
      merged_at = p_merged_at,
      merge_commit_sha = p_merge_commit_sha,
      updated_at = now()
  where id = pull_request_record.id
    and organization_id = bridge_record.organization_id;

  update public.graph_phase1c_bridges
  set merge_commit_sha = p_merge_commit_sha,
      state = 'MERGE_RECORDED'
  where id = bridge_record.id;

  return bridge_record.id;
end;
$function$;

create or replace function public.record_graph_phase1c_deployment_as_worker(
  p_bridge_id uuid,
  p_deployment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  deployment_record public.deployments%rowtype;
begin
  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('DEPLOYMENT_RECORDED') then
    if bridge_record.deployment_id = p_deployment_id then return bridge_record.id; end if;
    raise exception using errcode = '55000', message = 'deployment identity is already fixed';
  end if;
  if bridge_record.state <> 'MERGE_RECORDED' then
    raise exception using errcode = '55000', message = 'merge must be recorded before deployment';
  end if;

  select * into deployment_record from public.deployments deployment
  where deployment.id = p_deployment_id
    and deployment.organization_id = bridge_record.organization_id;
  if not found or deployment_record.project_id <> bridge_record.project_id
    or deployment_record.agent_run_id is distinct from bridge_record.agent_run_id
    or deployment_record.status <> 'succeeded'::public.deployment_status
    or deployment_record.completed_at is null
    or deployment_record.started_at is null
    or deployment_record.started_at > deployment_record.completed_at
    or lower(deployment_record.commit_sha) is distinct from bridge_record.merge_commit_sha
    or not exists (
      select 1
      from public.pull_requests pull_request
      where pull_request.id = bridge_record.pull_request_id
        and pull_request.organization_id = bridge_record.organization_id
        and pull_request.status = 'merged'::public.pull_request_status
        and pull_request.merge_commit_sha = bridge_record.merge_commit_sha
        and pull_request.merged_at is not null
        and deployment_record.started_at >= pull_request.merged_at
    )
  then
    raise exception using errcode = '23514',
      message = 'successful deployment does not match the merged Phase 1C commit';
  end if;

  update public.graph_phase1c_bridges
  set deployment_id = deployment_record.id,
      state = 'DEPLOYMENT_RECORDED'
  where id = bridge_record.id;
  return bridge_record.id;
end;
$function$;

-- Record a deployment already observed through GitHub's read-only API. This
-- never creates an external deployment; it atomically canonicalizes the exact
-- successful Production observation and advances only its matching bridge.
create or replace function public.record_graph_phase1c_github_deployment_as_worker(
  p_bridge_id uuid,
  p_github_repository_id uuid,
  p_external_deployment_id bigint,
  p_environment text,
  p_commit_sha text,
  p_status text,
  p_url text,
  p_started_at timestamptz,
  p_completed_at timestamptz
)
returns table (bridge_id uuid, deployment_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  pull_request_record public.pull_requests%rowtype;
  deployment_record public.deployments%rowtype;
begin
  if p_external_deployment_id is null or p_external_deployment_id <= 0
    or pg_catalog.lower(pg_catalog.btrim(coalesce(p_environment, ''))) <> 'production'
    or p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$'
    or pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, ''))) <> 'success'
    or p_url is null or pg_catalog.char_length(pg_catalog.btrim(p_url)) not between 9 and 2048
    or p_url is distinct from pg_catalog.btrim(p_url)
    or p_url !~ '^https://[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]{3,200}$'
    or pg_catalog.btrim(p_url) !~ '^https://[^/@?#[:space:]]+(?::[0-9]+)?(?:/[^?#[:cntrl:]\\]*)?$'
    or pg_catalog.strpos(p_url, '?') > 0
    or pg_catalog.strpos(p_url, '#') > 0
    or public.text_has_likely_secret(p_url)
    or p_started_at is null or p_completed_at is null
    or p_started_at > p_completed_at
    or p_completed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using errcode = '22023',
      message = 'exact successful GitHub Production deployment evidence is required';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = p_bridge_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = bridge_record.graph_id
    and graph.organization_id = bridge_record.organization_id
    and graph.project_id = bridge_record.project_id;
  if not found
    or graph_record.github_repository_id is distinct from p_github_repository_id
    or bridge_record.merge_commit_sha is distinct from p_commit_sha
  then
    raise exception using errcode = '23514',
      message = 'GitHub deployment does not match the graph repository and merge commit';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('DEPLOYMENT_RECORDED') then
    select * into deployment_record
    from public.deployments deployment
    where deployment.id = bridge_record.deployment_id
      and deployment.organization_id = bridge_record.organization_id;
    if found
      and deployment_record.project_id = bridge_record.project_id
      and deployment_record.agent_run_id = bridge_record.agent_run_id
      and pg_catalog.lower(deployment_record.environment) = 'production'
      and deployment_record.provider = 'github'
      and deployment_record.external_reference = p_external_deployment_id::text
      and pg_catalog.lower(deployment_record.commit_sha) = p_commit_sha
      and deployment_record.url = pg_catalog.btrim(p_url)
      and deployment_record.status = 'succeeded'::public.deployment_status
      and deployment_record.started_at = p_started_at
      and deployment_record.completed_at = p_completed_at
    then
      return query select bridge_record.id, deployment_record.id;
      return;
    end if;
    raise exception using errcode = '55000',
      message = 'deployment identity is already fixed';
  end if;
  if bridge_record.state <> 'MERGE_RECORDED' then
    raise exception using errcode = '55000',
      message = 'merge must be recorded before deployment';
  end if;

  select * into pull_request_record
  from public.pull_requests pull_request
  where pull_request.id = bridge_record.pull_request_id
    and pull_request.organization_id = bridge_record.organization_id
  for share;
  if not found
    or pull_request_record.status <> 'merged'::public.pull_request_status
    or pull_request_record.merge_commit_sha is distinct from p_commit_sha
    or pull_request_record.merged_at is null
    or p_started_at < pull_request_record.merged_at
  then
    raise exception using errcode = '23514',
      message = 'GitHub deployment must follow the exact recorded merge';
  end if;

  insert into public.deployments (
    organization_id, project_id, agent_run_id, environment, provider,
    external_reference, commit_sha, url, status, started_at, completed_at
  ) values (
    bridge_record.organization_id,
    bridge_record.project_id,
    bridge_record.agent_run_id,
    'Production',
    'github',
    p_external_deployment_id::text,
    p_commit_sha,
    pg_catalog.btrim(p_url),
    'succeeded'::public.deployment_status,
    p_started_at,
    p_completed_at
  )
  on conflict (organization_id, provider, external_reference)
    where provider = 'github' and external_reference is not null
  do nothing
  returning * into deployment_record;

  if not found then
    select * into deployment_record
    from public.deployments deployment
    where deployment.organization_id = bridge_record.organization_id
      and deployment.provider = 'github'
      and deployment.external_reference = p_external_deployment_id::text
    for update;
  end if;

  if not found
    or deployment_record.project_id <> bridge_record.project_id
    or deployment_record.agent_run_id is distinct from bridge_record.agent_run_id
    or pg_catalog.lower(deployment_record.environment) <> 'production'
    or pg_catalog.lower(deployment_record.commit_sha) is distinct from p_commit_sha
    or deployment_record.url is distinct from pg_catalog.btrim(p_url)
    or deployment_record.status <> 'succeeded'::public.deployment_status
    or deployment_record.started_at is distinct from p_started_at
    or deployment_record.completed_at is distinct from p_completed_at
  then
    raise exception using errcode = '55000',
      message = 'stored GitHub deployment conflicts with authoritative evidence';
  end if;

  perform public.record_graph_phase1c_deployment_as_worker(
    bridge_record.id,
    deployment_record.id
  );
  return query select bridge_record.id, deployment_record.id;
end;
$function$;

create or replace function public.record_graph_phase1c_monitor_as_worker(
  p_bridge_id uuid,
  p_monitor_observation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  observation_record public.monitor_observations%rowtype;
begin
  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('MONITORING_RECORDED') then
    if bridge_record.monitor_observation_id = p_monitor_observation_id then return bridge_record.id; end if;
    raise exception using errcode = '55000', message = 'monitor observation identity is already fixed';
  end if;
  if bridge_record.state <> 'DEPLOYMENT_RECORDED' then
    raise exception using errcode = '55000', message = 'deployment must be recorded before monitoring';
  end if;

  select * into observation_record from public.monitor_observations observation
  where observation.id = p_monitor_observation_id
    and observation.organization_id = bridge_record.organization_id;
  if not found or observation_record.project_id <> bridge_record.project_id
    or observation_record.deployment_id is distinct from bridge_record.deployment_id
  then
    raise exception using errcode = '23514',
      message = 'monitor observation does not identify the bridged deployment';
  end if;

  update public.graph_phase1c_bridges
  set monitor_observation_id = observation_record.id,
      state = 'MONITORING_RECORDED'
  where id = bridge_record.id;
  return bridge_record.id;
end;
$function$;

create or replace function public.record_graph_phase1c_validation_as_worker(
  p_bridge_id uuid,
  p_deployment_validation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  validation_record public.deployment_validations%rowtype;
begin
  select * into bridge_record from public.graph_phase1c_bridges
  where id = p_bridge_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;

  if bridge_record.state = 'VALIDATED' then
    if bridge_record.deployment_validation_id = p_deployment_validation_id then return bridge_record.id; end if;
    raise exception using errcode = '55000', message = 'deployment validation identity is already fixed';
  end if;
  if bridge_record.state <> 'MONITORING_RECORDED' then
    raise exception using errcode = '55000', message = 'monitoring must be recorded before validation';
  end if;

  select * into validation_record from public.deployment_validations validation
  where validation.id = p_deployment_validation_id
    and validation.organization_id = bridge_record.organization_id;
  if not found or validation_record.project_id <> bridge_record.project_id
    or validation_record.deployment_id <> bridge_record.deployment_id
    or validation_record.state <> 'passed'::public.deployment_validation_state
    or validation_record.completed_at is null
  then
    raise exception using errcode = '23514',
      message = 'passing validation for the bridged deployment is required';
  end if;

  update public.graph_phase1c_bridges
  set deployment_validation_id = validation_record.id,
      state = 'VALIDATED'
  where id = bridge_record.id;
  return bridge_record.id;
end;
$function$;

-- Full Lifecycle v2 release gates are not ordinary human gates. Approval must
-- be coupled to the immutable evidence recorded for that exact gate in the
-- same transaction. Keep the generic decision RPC for ordinary gates and for
-- explicit rejections, but make direct approval of a release gate impossible.
create or replace function public.decide_node_gate(
  p_gate_id uuid,
  p_approved boolean,
  p_reason text default null
)
returns public.graph_gates
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  normalized_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  select * into gate_record
  from public.graph_gates gate
  where gate.id = p_gate_id
  for update;
  if not found or not public.is_organization_member(gate_record.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;
  if not found then
    raise exception using errcode = '55000', message = 'gate graph identity is missing';
  end if;

  if (normalized_reason is not null and pg_catalog.char_length(normalized_reason) > 1000)
    or public.text_has_likely_secret(normalized_reason)
  then
    raise exception using errcode = '22023', message = 'gate reason is invalid or sensitive';
  end if;

  if p_approved
    and graph_record.is_lifecycle
    and graph_record.template_key = 'full_lifecycle'
    and graph_record.template_version = 2
    and gate_record.kind = 'HUMAN'::public.gate_kind
    and gate_record.stage in (
      'ARCHITECTURE'::public.sdlc_stage,
      'TEST'::public.sdlc_stage,
      'DEPLOYMENT'::public.sdlc_stage
    )
  then
    raise exception using errcode = '42501',
      message = 'full lifecycle release gates require evidence-bound approval';
  end if;

  if gate_record.state <> 'OPEN'::public.gate_state then
    raise exception 'gate_already_decided' using errcode = '22023';
  end if;
  if not public.can_manage_organization(gate_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to decide a gate';
  end if;
  if gate_record.kind = 'AUTOMATIC'::public.gate_kind and p_approved then
    raise exception using errcode = '42501',
      message = 'automatic gate approval is worker-only and evidence-bound';
  end if;

  update public.graph_gates
  set state = case when p_approved then 'APPROVED' else 'REJECTED' end::public.gate_state,
      reason = normalized_reason,
      decided_at = pg_catalog.now(),
      decided_by = auth.uid()
  where id = gate_record.id
  returning * into gate_record;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    gate_record.organization_id,
    graph_record.project_id,
    auth.uid(),
    (case when p_approved then 'lifecycle.gate_approved' else 'lifecycle.gate_rejected' end)
      ::public.activity_event_type,
    'graph_gate',
    gate_record.id,
    gate_record.stage::text || ' gate ' || case when p_approved then 'approved' else 'rejected' end,
    pg_catalog.jsonb_build_object(
      'kind', gate_record.kind,
      'anchor_count', gate_record.anchor_count,
      'evidence_bound', false
    )
  );
  return gate_record;
end;
$function$;

revoke all on function public.decide_node_gate(uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_node_gate(uuid, boolean, text)
  to authenticated;

-- Private monotonic decision primitive. Its callers first prove the exact
-- architecture, merge, or deployment evidence; this helper locks and records
-- the matching owner decision without exposing an evidence-free doorway.
create or replace function public.approve_full_lifecycle_gate_internal(
  p_gate_id uuid,
  p_expected_stage public.sdlc_stage,
  p_decided_by uuid,
  p_reason text default null
)
returns public.graph_gates
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  normalized_reason text := nullif(
    pg_catalog.btrim(coalesce(p_reason, '')),
    ''
  );
begin
  if p_decided_by is null
    or p_expected_stage not in (
      'ARCHITECTURE'::public.sdlc_stage,
      'TEST'::public.sdlc_stage,
      'DEPLOYMENT'::public.sdlc_stage
    )
  then
    raise exception using errcode = '22023',
      message = 'an exact owner and release gate stage are required';
  end if;
  if (normalized_reason is not null and pg_catalog.char_length(normalized_reason) > 1000)
    or public.text_has_likely_secret(normalized_reason)
  then
    raise exception using errcode = '22023', message = 'gate reason is invalid or sensitive';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = p_gate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'release gate not found';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;
  if not found
    or not graph_record.is_lifecycle
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or gate_record.kind <> 'HUMAN'::public.gate_kind
    or gate_record.stage <> p_expected_stage
  then
    raise exception using errcode = '23514',
      message = 'gate is not the expected full lifecycle release gate';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = gate_record.organization_id
      and member.user_id = p_decided_by
      and member.role = 'owner'
  ) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required';
  end if;

  if gate_record.state = 'APPROVED'::public.gate_state then
    if gate_record.decided_by is distinct from p_decided_by
      or gate_record.reason is distinct from normalized_reason
      or gate_record.decided_at is null
    then
      raise exception using errcode = '55000',
        message = 'release gate approval identity is already fixed';
    end if;
    return gate_record;
  end if;
  if gate_record.state <> 'OPEN'::public.gate_state then
    raise exception using errcode = '55000', message = 'release gate was already rejected';
  end if;

  update public.graph_gates
  set state = 'APPROVED'::public.gate_state,
      reason = normalized_reason,
      decided_at = pg_catalog.now(),
      decided_by = p_decided_by
  where id = gate_record.id
  returning * into gate_record;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    gate_record.organization_id,
    graph_record.project_id,
    p_decided_by,
    'lifecycle.gate_approved'::public.activity_event_type,
    'graph_gate',
    gate_record.id,
    gate_record.stage::text || ' gate approved with exact release evidence',
    pg_catalog.jsonb_build_object(
      'kind', gate_record.kind,
      'anchor_count', gate_record.anchor_count,
      'evidence_bound', true
    )
  );
  return gate_record;
end;
$function$;

-- The owner approves the exact RAW architecture artifact that was visible in
-- the UI. Artifact validation, gate approval, and bridge creation share one
-- transaction and one gate lock, so a later artifact can never replace what
-- the owner reviewed.
create or replace function public.approve_graph_phase1c_architecture_gate(
  p_gate_id uuid,
  p_architecture_artifact_id uuid,
  p_reason text default null
)
returns table (
  bridge_id uuid,
  organization_id uuid,
  project_id uuid,
  graph_id uuid,
  graph_run_id uuid,
  implementation_node_id uuid,
  architecture_artifact_id uuid,
  gate_state public.gate_state,
  gate_reason text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_id uuid := auth.uid();
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  approved_gate public.graph_gates%rowtype;
  derived_implementation_node_id uuid;
  implementation_node_count integer;
  created_bridge_id uuid;
begin
  if actor_id is null or p_architecture_artifact_id is null then
    raise exception using errcode = '42501',
      message = 'authenticated owner approval of an exact architecture artifact is required';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = p_gate_id
  for update;
  if not found or gate_record.opened_by_run_id is null then
    raise exception using errcode = '55000',
      message = 'an opened architecture gate with exact run identity is required';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id
  for update;
  if not found
    or not graph_record.is_lifecycle
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or graph_record.github_repository_id is null
    or graph_record.base_branch is null
    or graph_record.base_sha is null
  then
    raise exception using errcode = '23514',
      message = 'exact persisted full lifecycle release identity is required';
  end if;

  select artifact.* into artifact_record
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  join public.graph_runs graph_run
    on graph_run.id = artifact.graph_run_id
   and graph_run.organization_id = artifact.organization_id
   and graph_run.graph_id = graph_record.id
  where artifact.id = p_architecture_artifact_id
    and artifact.organization_id = graph_record.organization_id
    and artifact.graph_run_id = gate_record.opened_by_run_id
    and artifact.kind = 'RAW'::public.graph_artifact_kind
    and node_run.node_id = gate_record.node_id
    and (
      (node_run.state = 'VERIFYING'::public.graph_node_state
        and node_run.completed_at is null)
      or (node_run.state = 'COMPLETED'::public.graph_node_state
        and node_run.completed_at is not null)
    )
    and graph_run.state in (
      'PARTIAL'::public.graph_run_state,
      'COMPLETED'::public.graph_run_state
    )
    and graph_run.completed_at is not null;
  if not found then
    raise exception using errcode = '23514',
      message = 'selected architecture artifact is not exact completed evidence for this gate';
  end if;

  select pg_catalog.count(*)::integer, min(node.id::text)::uuid
    into implementation_node_count, derived_implementation_node_id
  from public.graph_nodes node
  where node.organization_id = graph_record.organization_id
    and node.graph_id = graph_record.id
    and node.lifecycle_stage = 'IMPLEMENTATION'::public.sdlc_stage;
  if implementation_node_count <> 1 or derived_implementation_node_id is null then
    raise exception using errcode = '55000',
      message = 'full lifecycle graph must have exactly one implementation node';
  end if;

  approved_gate := public.approve_full_lifecycle_gate_internal(
    gate_record.id,
    'ARCHITECTURE'::public.sdlc_stage,
    actor_id,
    p_reason
  );

  created_bridge_id := public.create_graph_phase1c_bridge_as_worker(
    graph_record.id,
    gate_record.opened_by_run_id,
    derived_implementation_node_id,
    gate_record.id,
    artifact_record.id,
    graph_record.template_key,
    graph_record.template_version,
    graph_record.github_repository_id,
    graph_record.base_branch,
    graph_record.base_sha
  );

  return query
  select bridge.id, bridge.organization_id, bridge.project_id, bridge.graph_id,
         bridge.graph_run_id, bridge.implementation_node_id,
         bridge.architecture_artifact_id, approved_gate.state,
         approved_gate.reason
  from public.graph_phase1c_bridges bridge
  where bridge.id = created_bridge_id;
end;
$function$;

-- GitHub merge evidence is supplied only by the server-side provider reader.
-- Recording it and approving TEST are atomic; authenticated clients cannot
-- call this service-only boundary or the generic approval RPC.
create or replace function public.approve_graph_phase1c_test_gate_as_worker(
  p_intent_id uuid,
  p_consume_nonce uuid,
  p_external_number integer,
  p_head_sha text,
  p_head_branch text,
  p_base_branch text,
  p_merge_commit_sha text,
  p_merged_at timestamptz
)
returns table (
  bridge_id uuid,
  gate_state public.gate_state,
  gate_reason text,
  head_sha text,
  merge_commit_sha text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  peek_intent public.graph_release_gate_approval_intents%rowtype;
  intent_record public.graph_release_gate_approval_intents%rowtype;
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  bridge_record public.graph_phase1c_bridges%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  approved_gate public.graph_gates%rowtype;
  consumption_digest text;
  artifact_sha256 text;
  repository_full_name text;
  evidence_node_started_at timestamptz;
begin
  consumption_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'stage', 'TEST',
      'externalNumber', p_external_number,
      'headSha', p_head_sha,
      'headBranch', p_head_branch,
      'baseBranch', p_base_branch,
      'mergeCommitSha', p_merge_commit_sha,
      'mergedAt', public.canonical_digest_timestamp(p_merged_at)
    )::text,
    'UTF8'
  )), 'hex');

  select * into peek_intent
  from public.graph_release_gate_approval_intents intent
  where intent.id = p_intent_id;
  if not found or p_consume_nonce is null then
    raise exception using errcode = '42501',
      message = 'exact pending owner TEST approval intent is required';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = peek_intent.gate_id
    and gate.organization_id = peek_intent.organization_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'the intended TEST gate no longer exists';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;
  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = peek_intent.bridge_id
    and bridge.organization_id = gate_record.organization_id
    and bridge.graph_id = gate_record.graph_id
  for update;

  select * into intent_record
  from public.graph_release_gate_approval_intents intent
  where intent.id = p_intent_id
    and intent.gate_id = gate_record.id
    and intent.bridge_id = bridge_record.id
  for update;
  if not found
    or intent_record.stage <> 'TEST'::public.sdlc_stage
    or intent_record.token_sha256 is distinct from pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_consume_nonce::text, 'UTF8')),
      'hex'
    )
  then
    raise exception using errcode = '42501',
      message = 'exact owner TEST approval intent is required';
  end if;

  select artifact.* into artifact_record
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  where artifact.id = intent_record.evidence_artifact_id
    and artifact.organization_id = intent_record.organization_id
    and artifact.graph_run_id = gate_record.opened_by_run_id
    and artifact.kind = 'ANCHOR'::public.graph_artifact_kind
    and node_run.node_id = gate_record.node_id
  for share of artifact;
  if not found then
    raise exception using errcode = '55000',
      message = 'TEST approval artifact identity no longer matches the intent';
  end if;
  artifact_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'id', artifact_record.id,
      'organizationId', artifact_record.organization_id,
      'graphRunId', artifact_record.graph_run_id,
      'nodeRunId', artifact_record.node_run_id,
      'kind', artifact_record.kind,
      'payload', artifact_record.payload,
      'createdAt', public.canonical_digest_timestamp(artifact_record.created_at)
    )::text,
    'UTF8'
  )), 'hex');
  if intent_record.evidence_sha256 is distinct from artifact_sha256
    or public.jsonb_has_sensitive_keys(artifact_record.payload)
  then
    raise exception using errcode = '55000',
      message = 'TEST approval artifact digest no longer matches the owner intent';
  end if;

  select repository.full_name into repository_full_name
  from public.github_repositories repository
  where repository.id = graph_record.github_repository_id
    and repository.organization_id = graph_record.organization_id;
  select node_run.started_at into evidence_node_started_at
  from public.node_runs node_run
  where node_run.id = artifact_record.node_run_id
    and node_run.organization_id = artifact_record.organization_id
    and node_run.graph_run_id = artifact_record.graph_run_id;
  perform public.assert_canonical_graph_test_anchor(
    artifact_record.payload,
    bridge_record.head_sha,
    repository_full_name,
    graph_record.required_check_names,
    evidence_node_started_at,
    artifact_record.created_at,
    gate_record.opened_at
  );

  if intent_record.required_checks_sha256 is distinct from graph_record.required_checks_sha256
  then
    raise exception using errcode = '55000',
      message = 'TEST approval required-check policy no longer matches the graph identity';
  end if;
  consumption_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'stage', 'TEST',
      'requiredChecksSha256', intent_record.required_checks_sha256,
      'externalNumber', p_external_number,
      'headSha', p_head_sha,
      'headBranch', p_head_branch,
      'baseBranch', p_base_branch,
      'mergeCommitSha', p_merge_commit_sha,
      'mergedAt', public.canonical_digest_timestamp(p_merged_at)
    )::text,
    'UTF8'
  )), 'hex');

  if intent_record.state = 'CONSUMED' then
    if intent_record.consumption_sha256 is distinct from consumption_digest
      or gate_record.state <> 'APPROVED'::public.gate_state
      or bridge_record.merge_commit_sha is distinct from p_merge_commit_sha
      or not exists (
        select 1 from public.pull_requests pull_request
        where pull_request.id = bridge_record.pull_request_id
          and pull_request.organization_id = bridge_record.organization_id
          and pull_request.external_number = p_external_number
          and pull_request.head_sha = p_head_sha
          and pull_request.head_branch = pg_catalog.btrim(p_head_branch)
          and pull_request.base_branch = pg_catalog.btrim(p_base_branch)
          and pull_request.status = 'merged'::public.pull_request_status
          and pull_request.merge_commit_sha = p_merge_commit_sha
          and pull_request.merged_at = p_merged_at
      )
    then
      raise exception using errcode = '55000',
        message = 'consumed TEST approval does not match exact replay evidence';
    end if;
    return query select bridge_record.id, gate_record.state, gate_record.reason,
      bridge_record.head_sha, bridge_record.merge_commit_sha;
    return;
  end if;

  if intent_record.state <> 'PENDING'
    or intent_record.expires_at < pg_catalog.clock_timestamp()
    or gate_record.state <> 'OPEN'::public.gate_state
    or gate_record.opened_by_run_id is null
  then
    raise exception using errcode = '42501',
      message = 'exact pending owner TEST approval intent is required';
  end if;

  if not found
    or bridge_record.project_id is distinct from graph_record.project_id
    or intent_record.graph_id is distinct from graph_record.id
    or intent_record.project_id is distinct from graph_record.project_id
    or intent_record.pull_request_id is distinct from bridge_record.pull_request_id
    or intent_record.head_sha is distinct from bridge_record.head_sha
    or intent_record.merge_commit_sha is not null
    or not exists (
      select 1
      from public.graph_runs run
      where run.id = gate_record.opened_by_run_id
        and run.organization_id = gate_record.organization_id
        and run.graph_id = gate_record.graph_id
        and run.phase1c_bridge_id = bridge_record.id
        and run.state in (
          'PARTIAL'::public.graph_run_state,
          'COMPLETED'::public.graph_run_state
        )
        and run.completed_at is not null
    )
  then
    raise exception using errcode = '23514',
      message = 'TEST gate does not belong to the exact bridged graph run';
  end if;

  perform public.record_graph_phase1c_github_merge_as_worker(
    bridge_record.id,
    p_external_number,
    p_head_sha,
    p_head_branch,
    p_base_branch,
    p_merge_commit_sha,
    p_merged_at
  );
  approved_gate := public.approve_full_lifecycle_gate_internal(
    gate_record.id,
    'TEST'::public.sdlc_stage,
    intent_record.requested_by,
    intent_record.reason
  );

  update public.graph_release_gate_approval_intents
  set state = 'CONSUMED', consumed_at = pg_catalog.clock_timestamp(),
      consumption_sha256 = consumption_digest
  where id = intent_record.id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    intent_record.organization_id,
    intent_record.project_id,
    intent_record.requested_by,
    'approval.decided'::public.activity_event_type,
    'graph_release_gate_approval_intent',
    intent_record.id,
    'TEST release gate owner intent consumed with exact merge evidence.',
    pg_catalog.jsonb_build_object(
      'gate_id', intent_record.gate_id,
      'bridge_id', intent_record.bridge_id,
      'merge_commit_sha', p_merge_commit_sha
    )
  );

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = intent_record.bridge_id;
  return query select bridge_record.id, approved_gate.state,
    approved_gate.reason, bridge_record.head_sha, bridge_record.merge_commit_sha;
end;
$function$;

-- The exact ANCHOR artifact, GitHub deployment observation, canonical stored
-- deployment, and DEPLOYMENT owner decision are one transaction. A lost HTTP
-- response can therefore be replayed without consulting mutable later GitHub
-- statuses and without stranding an OPEN gate behind durable evidence.
create or replace function public.approve_graph_phase1c_deployment_gate_as_worker(
  p_intent_id uuid,
  p_consume_nonce uuid,
  p_github_repository_id uuid,
  p_external_deployment_id bigint,
  p_environment text,
  p_commit_sha text,
  p_status text,
  p_url text,
  p_started_at timestamptz,
  p_completed_at timestamptz
)
returns table (
  bridge_id uuid,
  deployment_id uuid,
  gate_state public.gate_state,
  gate_reason text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  peek_intent public.graph_release_gate_approval_intents%rowtype;
  intent_record public.graph_release_gate_approval_intents%rowtype;
  gate_record public.graph_gates%rowtype;
  graph_record public.graphs%rowtype;
  bridge_record public.graph_phase1c_bridges%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  deployment_record public.deployments%rowtype;
  approved_gate public.graph_gates%rowtype;
  repository_name text;
  recorded_bridge_id uuid;
  recorded_deployment_id uuid;
  consumption_digest text;
  artifact_sha256 text;
begin
  consumption_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'stage', 'DEPLOYMENT',
      'githubRepositoryId', p_github_repository_id,
      'externalDeploymentId', p_external_deployment_id,
      'environment', p_environment,
      'commitSha', p_commit_sha,
      'status', p_status,
      'url', p_url,
      'startedAt', public.canonical_digest_timestamp(p_started_at),
      'completedAt', public.canonical_digest_timestamp(p_completed_at)
    )::text,
    'UTF8'
  )), 'hex');

  select * into peek_intent
  from public.graph_release_gate_approval_intents intent
  where intent.id = p_intent_id;
  if not found or p_consume_nonce is null then
    raise exception using errcode = '42501',
      message = 'exact pending owner DEPLOYMENT approval intent is required';
  end if;

  select * into gate_record
  from public.graph_gates gate
  where gate.id = peek_intent.gate_id
    and gate.organization_id = peek_intent.organization_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'the intended DEPLOYMENT gate no longer exists';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = gate_record.graph_id
    and graph.organization_id = gate_record.organization_id;
  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = peek_intent.bridge_id
    and bridge.organization_id = gate_record.organization_id
    and bridge.graph_id = gate_record.graph_id
  for update;

  select * into intent_record
  from public.graph_release_gate_approval_intents intent
  where intent.id = p_intent_id
    and intent.gate_id = gate_record.id
    and intent.bridge_id = bridge_record.id
  for update;
  if not found
    or intent_record.stage <> 'DEPLOYMENT'::public.sdlc_stage
    or intent_record.token_sha256 is distinct from pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_consume_nonce::text, 'UTF8')),
      'hex'
    )
  then
    raise exception using errcode = '42501',
      message = 'exact owner DEPLOYMENT approval intent is required';
  end if;

  select * into artifact_record
  from public.graph_artifacts artifact
  where artifact.id = intent_record.evidence_artifact_id
    and artifact.organization_id = intent_record.organization_id
  for share;
  if not found then
    raise exception using errcode = '55000',
      message = 'DEPLOYMENT approval artifact identity no longer matches the intent';
  end if;
  artifact_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'id', artifact_record.id,
      'organizationId', artifact_record.organization_id,
      'graphRunId', artifact_record.graph_run_id,
      'nodeRunId', artifact_record.node_run_id,
      'kind', artifact_record.kind,
      'payload', artifact_record.payload,
      'createdAt', public.canonical_digest_timestamp(artifact_record.created_at)
    )::text,
    'UTF8'
  )), 'hex');
  if intent_record.evidence_sha256 is distinct from artifact_sha256
    or public.jsonb_has_sensitive_keys(artifact_record.payload)
  then
    raise exception using errcode = '55000',
      message = 'DEPLOYMENT approval artifact digest no longer matches the owner intent';
  end if;

  if intent_record.required_checks_sha256 is distinct from graph_record.required_checks_sha256
  then
    raise exception using errcode = '55000',
      message = 'DEPLOYMENT approval required-check policy no longer matches the graph identity';
  end if;
  consumption_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'stage', 'DEPLOYMENT',
      'requiredChecksSha256', intent_record.required_checks_sha256,
      'githubRepositoryId', p_github_repository_id,
      'externalDeploymentId', p_external_deployment_id,
      'environment', p_environment,
      'commitSha', p_commit_sha,
      'status', p_status,
      'url', p_url,
      'startedAt', public.canonical_digest_timestamp(p_started_at),
      'completedAt', public.canonical_digest_timestamp(p_completed_at)
    )::text,
    'UTF8'
  )), 'hex');

  if intent_record.state = 'CONSUMED' then
    select * into deployment_record
    from public.deployments deployment
    where deployment.id = bridge_record.deployment_id
      and deployment.organization_id = bridge_record.organization_id;
    if intent_record.consumption_sha256 is distinct from consumption_digest
      or gate_record.state <> 'APPROVED'::public.gate_state
      or not found
      or deployment_record.provider <> 'github'
      or deployment_record.external_reference is distinct from p_external_deployment_id::text
      or pg_catalog.lower(deployment_record.environment) is distinct from
        pg_catalog.lower(pg_catalog.btrim(p_environment))
      or deployment_record.commit_sha is distinct from p_commit_sha
      or deployment_record.url is distinct from pg_catalog.btrim(p_url)
      or deployment_record.status <> 'succeeded'::public.deployment_status
      or deployment_record.started_at is distinct from p_started_at
      or deployment_record.completed_at is distinct from p_completed_at
    then
      raise exception using errcode = '55000',
        message = 'consumed DEPLOYMENT approval does not match exact replay evidence';
    end if;
    return query select bridge_record.id, deployment_record.id,
      gate_record.state, gate_record.reason;
    return;
  end if;

  if intent_record.state <> 'PENDING'
    or intent_record.expires_at < pg_catalog.clock_timestamp()
    or gate_record.state <> 'OPEN'::public.gate_state
    or gate_record.opened_by_run_id is null
  then
    raise exception using errcode = '42501',
      message = 'exact pending owner DEPLOYMENT approval intent is required';
  end if;

  if not found
    or bridge_record.project_id is distinct from graph_record.project_id
    or bridge_record.merge_commit_sha is null
    or intent_record.graph_id is distinct from graph_record.id
    or intent_record.project_id is distinct from graph_record.project_id
    or intent_record.pull_request_id is distinct from bridge_record.pull_request_id
    or intent_record.head_sha is distinct from bridge_record.head_sha
    or intent_record.merge_commit_sha is distinct from bridge_record.merge_commit_sha
    or intent_record.evidence_artifact_id is null
    or not exists (
      select 1
      from public.graph_runs run
      where run.id = gate_record.opened_by_run_id
        and run.organization_id = gate_record.organization_id
        and run.graph_id = gate_record.graph_id
        and run.phase1c_bridge_id = bridge_record.id
        and run.state in (
          'PARTIAL'::public.graph_run_state,
          'COMPLETED'::public.graph_run_state
        )
        and run.completed_at is not null
    )
  then
    raise exception using errcode = '23514',
      message = 'DEPLOYMENT gate does not belong to the exact bridged graph run';
  end if;

  select repository.full_name into repository_name
  from public.github_repositories repository
  where repository.id = graph_record.github_repository_id
    and repository.organization_id = graph_record.organization_id;
  if repository_name is null then
    raise exception using errcode = '55000',
      message = 'graph repository identity is unavailable';
  end if;

  select artifact.* into artifact_record
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  join public.graph_runs graph_run
    on graph_run.id = artifact.graph_run_id
   and graph_run.organization_id = artifact.organization_id
   and graph_run.graph_id = graph_record.id
  where artifact.id = intent_record.evidence_artifact_id
    and artifact.organization_id = gate_record.organization_id
    and artifact.graph_run_id = gate_record.opened_by_run_id
    and artifact.kind = 'ANCHOR'::public.graph_artifact_kind
    and node_run.node_id = gate_record.node_id
    and (
      (node_run.state = 'VERIFYING'::public.graph_node_state
        and node_run.completed_at is null)
      or (node_run.state = 'COMPLETED'::public.graph_node_state
        and node_run.completed_at is not null)
    )
    and graph_run.state in (
      'PARTIAL'::public.graph_run_state,
      'COMPLETED'::public.graph_run_state
    )
    and graph_run.completed_at is not null
  for share of artifact;
  if not found
    or artifact_record.payload ->> 'observation' is distinct from
      'github_production_deployment'
    or artifact_record.payload ->> 'deploymentId' is distinct from
      p_external_deployment_id::text
    or pg_catalog.lower(artifact_record.payload ->> 'repository') is distinct from
      pg_catalog.lower(repository_name)
    or artifact_record.payload ->> 'sha' is distinct from p_commit_sha
    or artifact_record.payload ->> 'ref' is distinct from graph_record.base_branch
    or artifact_record.payload ->> 'environment' is distinct from 'Production'
    or artifact_record.payload ->> 'state' is distinct from 'success'
    or artifact_record.payload ->> 'environmentUrl' is distinct from
      pg_catalog.btrim(p_url)
  then
    raise exception using errcode = '23514',
      message = 'selected deployment artifact does not match the exact provider evidence';
  end if;

  select result.bridge_id, result.deployment_id
    into recorded_bridge_id, recorded_deployment_id
  from public.record_graph_phase1c_github_deployment_as_worker(
    bridge_record.id,
    p_github_repository_id,
    p_external_deployment_id,
    p_environment,
    p_commit_sha,
    p_status,
    p_url,
    p_started_at,
    p_completed_at
  ) result;
  if recorded_bridge_id is distinct from bridge_record.id
    or recorded_deployment_id is null
  then
    raise exception using errcode = '55000',
      message = 'deployment recording returned conflicting bridge identity';
  end if;

  approved_gate := public.approve_full_lifecycle_gate_internal(
    gate_record.id,
    'DEPLOYMENT'::public.sdlc_stage,
    intent_record.requested_by,
    intent_record.reason
  );

  update public.graph_release_gate_approval_intents
  set state = 'CONSUMED', consumed_at = pg_catalog.clock_timestamp(),
      consumption_sha256 = consumption_digest
  where id = intent_record.id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    intent_record.organization_id,
    intent_record.project_id,
    intent_record.requested_by,
    'approval.decided'::public.activity_event_type,
    'graph_release_gate_approval_intent',
    intent_record.id,
    'DEPLOYMENT release gate owner intent consumed with exact provider evidence.',
    pg_catalog.jsonb_build_object(
      'gate_id', intent_record.gate_id,
      'bridge_id', intent_record.bridge_id,
      'deployment_id', recorded_deployment_id
    )
  );
  return query select recorded_bridge_id, recorded_deployment_id,
    approved_gate.state, approved_gate.reason;
end;
$function$;

revoke all on function public.create_graph_phase1c_bridge_as_worker(
  uuid, uuid, uuid, uuid, uuid, text, integer, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_graph_phase1c_bridge_for_approved_gate(
  uuid, text, integer, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.attach_graph_phase1c_command_for_approved_gate(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bind_graph_phase1c_run_as_worker(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bind_graph_phase1c_run_by_command_as_worker(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_pull_request_as_worker(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run_with_graph_bridge_as_worker(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_merge_as_worker(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_github_merge_as_worker(
  uuid, integer, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_deployment_as_worker(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_github_deployment_as_worker(
  uuid, uuid, bigint, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_monitor_as_worker(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_graph_phase1c_validation_as_worker(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_full_lifecycle_gate_internal(
  uuid, public.sdlc_stage, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.approve_graph_phase1c_architecture_gate(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_and_attach_graph_phase1c_command(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_graph_phase1c_test_gate_as_worker(
  uuid, uuid, integer, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.approve_graph_phase1c_deployment_gate_as_worker(
  uuid, uuid, uuid, bigint, text, text, text, text,
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;
-- Superseded completion entry points stay callable by their owner from inside
-- the atomic wrappers, but are no longer worker authority on their own.
-- The original authenticated graph mutation surface is also retired: those
-- functions predate worker leases and let an organization member forge or
-- terminalize worker-owned evidence. Production has no caller for them; all
-- execution writes now cross the exact service-role worker RPCs above.
revoke all on function public.start_graph_run(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_node_state(
  uuid, public.graph_node_state, text, text, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.complete_graph_run(
  uuid, public.graph_run_state, boolean, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_handoff(
  uuid, uuid, jsonb, boolean, jsonb, uuid, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_graph_artifact(
  uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.record_verification(
  uuid, public.verification_lens, public.verification_verdict,
  jsonb, uuid, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.complete_phase1c_run(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) from public, anon, authenticated, service_role;
alter function public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) set search_path = pg_catalog;
revoke all on function public.complete_graph_run_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.approve_graph_phase1c_architecture_gate(uuid, uuid, text)
  to authenticated;
grant execute on function public.submit_and_attach_graph_phase1c_command(uuid, jsonb)
  to authenticated;
grant execute on function public.bind_graph_phase1c_run_by_command_as_worker(uuid, uuid, uuid)
  to service_role;
grant execute on function public.complete_phase1c_run_with_graph_bridge_as_worker(
  text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, boolean
) to service_role;
grant execute on function public.approve_graph_phase1c_test_gate_as_worker(
  uuid, uuid, integer, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.approve_graph_phase1c_deployment_gate_as_worker(
  uuid, uuid, uuid, bigint, text, text, text, text,
  timestamptz, timestamptz
) to service_role;

-- Forward replacement of the final claim implementation. Its reclaim,
-- ordering, retry caps, executor filtering, node projection, and edge
-- projection remain the same. Only an exact full_lifecycle v2 graph that has
-- crossed its approved ARCHITECTURE gate is held for the external Phase 1C
-- bridge, and only until the exact PR head plus validation is recorded.
create or replace function public.claim_planned_graph_internal(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_graph record;
  v_run_id uuid;
  v_stale record;
  v_bridge public.graph_phase1c_bridges;
  v_predecessor public.graph_runs;
  v_bridge_count integer;
  v_bridge_id uuid;
  v_claim jsonb;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  if p_supported_executors is null
    or pg_catalog.array_ndims(p_supported_executors) is distinct from 1
    or pg_catalog.cardinality(p_supported_executors) not between 1 and 3
    or pg_catalog.array_position(p_supported_executors, null) is not null
    or exists (
      select 1
      from pg_catalog.unnest(p_supported_executors) declared(executor)
      where declared.executor not in ('DETERMINISTIC', 'MODEL', 'ANCHOR')
    )
    or (
      select pg_catalog.count(distinct declared.executor)
      from pg_catalog.unnest(p_supported_executors) declared(executor)
    ) <> pg_catalog.cardinality(p_supported_executors)
  then
    raise exception using
      errcode = '22023',
      message = 'a worker must declare a unique, bounded set of supported executors';
  end if;
  if p_repository_full_name is null
    or p_repository_full_name is distinct from pg_catalog.btrim(p_repository_full_name)
    or pg_catalog.char_length(p_repository_full_name) not between 3 and 201
    or p_repository_full_name !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    or not public.graph_required_check_policy_is_safe(p_required_check_names)
  then
    raise exception using errcode = '22023',
      message = 'a worker must declare its exact repository and required-check policy';
  end if;

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
     for update of r skip locked
  loop
    update public.graph_runs
       set state = 'FAILED', completed_at = now(), updated_at = now()
     where id = v_stale.id
       and state = 'RUNNING'
       and updated_at < now() - interval '2 hours'
       and not exists (
         select 1
         from public.node_runs nr
         where nr.graph_run_id = v_stale.id
           and nr.updated_at >= now() - interval '2 hours'
       );
    if not found then
      continue;
    end if;

    with cancelled as (
      update public.node_runs
         set state = 'CANCELLED',
             blocked_reason = 'The worker running this graph stopped reporting; the run was reclaimed.',
             completed_at = now(),
             updated_at = now()
       where graph_run_id = v_stale.id
         and state in ('PENDING', 'READY', 'RUNNING', 'VERIFYING', 'BLOCKED')
      returning id, organization_id, graph_run_id
    )
    insert into public.graph_events (
      organization_id, graph_run_id, node_run_id, event_type, detail
    )
    select
      cancelled.organization_id,
      cancelled.graph_run_id,
      cancelled.id,
      'node_cancelled',
      pg_catalog.format('Reclaimed by worker %s after the prior worker stopped reporting.', p_worker_id)
    from cancelled;

    insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
    values (
      v_stale.organization_id, v_stale.id, 'run_failed',
      format('Reclaimed by worker %s: the run had been silent for over two hours and its worker is presumed dead.', p_worker_id)
    );
  end loop;

  select
    g.*,
    project.name as project_name,
    repository.full_name as project_repository,
    repository.default_branch as project_default_branch
    into v_graph
    from public.graphs g
    join public.projects project
      on project.id = g.project_id
     and project.organization_id = g.organization_id
    join public.project_connections link
      on link.organization_id = g.organization_id
     and link.project_id = g.project_id
     and link.is_primary
    join public.connections connection
      on connection.id = link.connection_id
     and connection.organization_id = link.organization_id
    join public.github_installations installation
      on installation.connection_id = connection.id
     and installation.organization_id = connection.organization_id
    join public.github_repositories repository
      on repository.id = link.github_repository_id
     and repository.installation_id = installation.id
     and repository.organization_id = link.organization_id
   where g.requires_owner_approval = false
     and project.status = 'active'::public.project_status
     and connection.provider = 'github'::public.connection_provider
     and connection.status = 'connected'::public.connection_status
     and installation.status = 'active'
     and installation.suspended_at is null
     and installation.deleted_at is null
     and repository.selected
     and not repository.archived
     and not repository.disabled
     and project.github_repository = repository.full_name
     and project.default_branch = repository.default_branch
     and pg_catalog.lower(repository.full_name) =
       pg_catalog.lower(p_repository_full_name)
     and (g.github_repository_id is null
       or g.github_repository_id = repository.id)
     and (
       not exists (
         select 1 from public.graph_runs r
          where r.graph_id = g.id and r.state not in ('FAILED', 'CANCELLED')
       )
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
                (select max(r.completed_at) from public.graph_runs r
                  where r.graph_id = g.id
                    and r.state not in ('FAILED', 'CANCELLED')),
                gate.opened_at
              )
         )
       )
     )
     and (
       not g.is_lifecycle
       or g.template_key is distinct from 'full_lifecycle'
       or g.template_version is distinct from 2
       or not exists (
         select 1 from public.graph_gates architecture_gate
         where architecture_gate.graph_id = g.id
           and architecture_gate.stage = 'ARCHITECTURE'::public.sdlc_stage
           and architecture_gate.state = 'APPROVED'::public.gate_state
       )
       or exists (
         select 1
         from public.graph_runs predecessor
         join public.graph_phase1c_bridges bridge
           on bridge.organization_id = predecessor.organization_id
          and bridge.graph_id = predecessor.graph_id
          and (
            bridge.id = predecessor.phase1c_bridge_id
            or (
              predecessor.phase1c_bridge_id is null
              and bridge.graph_run_id = predecessor.id
            )
          )
         where predecessor.id = (
           select prior.id
           from public.graph_runs prior
           where prior.graph_id = g.id
             and prior.organization_id = g.organization_id
             and prior.state not in ('FAILED', 'CANCELLED')
             and prior.completed_at is not null
           order by prior.completed_at desc, prior.id desc
           limit 1
         )
           and public.graph_phase1c_bridge_state_rank(bridge.state) >=
             public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED')
       )
     )
     and (select count(*) from public.graph_runs r
           where r.graph_id = g.id and r.state = 'FAILED') < 3
     and (select count(*) from public.graph_runs r where r.graph_id = g.id) < 10
     and not exists (
       select 1 from public.graph_nodes n
        where n.graph_id = g.id
          and not (n.executor::text = any (p_supported_executors))
     )
     and (
       g.template_key is distinct from 'full_lifecycle'
       or g.template_version is distinct from 2
       or g.required_check_names = p_required_check_names
     )
   order by g.created_at
   for update of g, project, link, connection, installation, repository skip locked
   limit 1;

  if v_graph.id is null then
    return null;
  end if;

  if v_graph.is_lifecycle
    and v_graph.template_key = 'full_lifecycle'
    and v_graph.template_version = 2
    and exists (
      select 1
      from public.graph_gates architecture_gate
      where architecture_gate.organization_id = v_graph.organization_id
        and architecture_gate.graph_id = v_graph.id
        and architecture_gate.stage = 'ARCHITECTURE'::public.sdlc_stage
        and architecture_gate.state = 'APPROVED'::public.gate_state
    )
  then
    select * into v_predecessor
    from public.graph_runs prior
    where prior.graph_id = v_graph.id
      and prior.organization_id = v_graph.organization_id
      and prior.state not in ('FAILED', 'CANCELLED')
      and prior.completed_at is not null
    order by prior.completed_at desc, prior.id desc
    limit 1;
    if not found then
      raise exception using errcode = '55000',
        message = 'full lifecycle resume has no exact predecessor run';
    end if;

    select pg_catalog.count(*)::integer, min(bridge.id::text)::uuid
      into v_bridge_count, v_bridge_id
    from public.graph_phase1c_bridges bridge
    where bridge.organization_id = v_graph.organization_id
      and bridge.graph_id = v_graph.id
      and (
        bridge.id = v_predecessor.phase1c_bridge_id
        or (
          v_predecessor.phase1c_bridge_id is null
          and bridge.graph_run_id = v_predecessor.id
        )
      );
    if v_bridge_count <> 1 or v_bridge_id is null then
      raise exception using errcode = '55000',
        message = 'full lifecycle resume bridge identity is missing or ambiguous';
    end if;

    select * into v_bridge
    from public.graph_phase1c_bridges bridge
    where bridge.id = v_bridge_id
      and bridge.organization_id = v_graph.organization_id
      and bridge.graph_id = v_graph.id;
    if public.graph_phase1c_bridge_state_rank(v_bridge.state) <
        public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED') then
      raise exception using errcode = '55000',
        message = 'full lifecycle resume bridge lacks exact pull request evidence';
    end if;
  end if;

  insert into public.graph_runs (
    organization_id, graph_id, phase1c_bridge_id, state, started_at, created_by
  ) values (
    v_graph.organization_id, v_graph.id, v_bridge.id, 'RUNNING', now(), v_graph.created_by
  )
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

  v_claim := jsonb_build_object(
    'graph_run_id', v_run_id,
    'graph_id', v_graph.id,
    'organization_id', v_graph.organization_id,
    'project_id', v_graph.project_id,
    'project_name', v_graph.project_name,
    'goal', v_graph.goal,
    'topology', v_graph.topology,
    'risk_level', v_graph.risk_level,
    'required_check_names', v_graph.required_check_names,
    'required_checks_sha256', v_graph.required_checks_sha256,
    'is_lifecycle', v_graph.is_lifecycle,
    'iteration', v_graph.iteration,
    'max_iterations', v_graph.max_iterations,
    'project_repository', v_graph.project_repository,
    'project_default_branch', v_graph.project_default_branch,
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
        'node_id', n.id,
        'lifecycle_stage', n.lifecycle_stage,
        'gate_kind', n.gate_kind,
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
        'from_node_key', src.node_key,
        'to_node_key', dst.node_key,
        'reason', e.reason,
        'detail', e.detail
      ) order by src.node_key, dst.node_key), '[]'::jsonb)
        from public.graph_edges e
        join public.graph_nodes src on src.id = e.from_node_id
        join public.graph_nodes dst on dst.id = e.to_node_id
       where e.graph_id = v_graph.id
         and e.is_feedback = false
    )
  );

  if v_graph.is_lifecycle
    and v_graph.template_key = 'full_lifecycle'
    and v_graph.template_version = 2
  then
    v_claim := v_claim || jsonb_build_object(
      'template_key', v_graph.template_key,
      'template_version', v_graph.template_version,
      'base_branch', v_graph.base_branch,
      'base_sha', v_graph.base_sha,
      'phase1c_state', v_bridge.state,
      'phase1c_head_sha', v_bridge.head_sha,
      'pull_request_number', (
        select pull_request.external_number
        from public.pull_requests pull_request
        where pull_request.id = v_bridge.pull_request_id
          and pull_request.organization_id = v_bridge.organization_id
      ),
      'pull_request_url', (
        select pull_request.url
        from public.pull_requests pull_request
        where pull_request.id = v_bridge.pull_request_id
          and pull_request.organization_id = v_bridge.organization_id
      ),
      'validation_evidence', case when v_bridge.agent_run_id is null then null else
        jsonb_build_object(
          'agent_run_id', v_bridge.agent_run_id,
          'head_sha', v_bridge.head_sha,
          'validation_round', (
            select max(validation.validation_round)
            from public.phase1c_run_validations validation
            join public.agent_runs run
              on run.id = validation.run_id
             and run.organization_id = validation.organization_id
             and run.attempt_number = validation.attempt_number
            where validation.run_id = v_bridge.agent_run_id
              and validation.organization_id = v_bridge.organization_id
          ),
          'validations', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'name', bounded.name,
              'status', bounded.status,
              'duration_ms', bounded.duration_ms
            ) order by bounded.name), '[]'::jsonb)
            from (
              select validation.name, validation.status, validation.duration_ms
              from public.phase1c_run_validations validation
              join public.agent_runs run
                on run.id = validation.run_id
               and run.organization_id = validation.organization_id
               and run.attempt_number = validation.attempt_number
              where validation.run_id = v_bridge.agent_run_id
                and validation.organization_id = v_bridge.organization_id
                and validation.validation_round = (
                  select max(latest.validation_round)
                  from public.phase1c_run_validations latest
                  where latest.run_id = v_bridge.agent_run_id
                    and latest.organization_id = v_bridge.organization_id
                    and latest.attempt_number = run.attempt_number
                )
              order by validation.name
              limit 50
            ) bounded
          )
        )
      end,
      'merge_commit_sha', v_bridge.merge_commit_sha,
      'deployment_id', v_bridge.deployment_id,
      'deployment_url', (
        select deployment.url
        from public.deployments deployment
        where deployment.id = v_bridge.deployment_id
          and deployment.organization_id = v_bridge.organization_id
      )
    );
  end if;

  return v_claim;
end;
$$;

revoke all on function public.claim_planned_graph_internal(text, text[], text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.claim_planned_graph_v2(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '0A000',
      message = 'graph worker protocol version 2 is required';
  end if;
  return public.claim_planned_graph_internal(
    p_worker_id,
    p_supported_executors,
    p_repository_full_name,
    p_required_check_names
  );
end;
$function$;

revoke all on function public.claim_planned_graph_v2(text, text[], text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_planned_graph_v2(text, text[], text, jsonb, integer)
  to service_role;

revoke all on function public.claim_phase1c_run(text, text, text, integer)
  from public, anon, authenticated, service_role;

create or replace function public.claim_phase1c_run_v2(
  p_worker_id text,
  p_provider text,
  p_model text,
  p_lease_seconds integer,
  p_protocol_version integer
)
returns table (
  run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
  command_id uuid, agent_id uuid, prompt text, command_type text,
  requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
  connection_id uuid, repository_id uuid, internal_installation_id uuid,
  external_installation_id bigint, app_id bigint, external_repository_id bigint,
  repository_full_name text, base_branch text, base_sha text,
  lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
  cancellation_requested boolean, logical_agent_role text, provider text, model text,
  maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
  maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
  owner_approval_id uuid, owner_approval_expires_at timestamptz,
  recovery_head_branch text, recovery_head_sha text,
  recovery_pull_request_number integer, recovery_pull_request_url text,
  recovery_provider_run_reference text, recovery_usage jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '0A000',
      message = 'Phase 1C worker protocol version 2 is required';
  end if;
  return query
  select * from public.claim_phase1c_run(
    p_worker_id, p_provider, p_model, p_lease_seconds
  );
end;
$function$;

revoke all on function public.claim_phase1c_run_v2(
  text, text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_phase1c_run_v2(
  text, text, text, integer, integer
) to service_role;

-- Preserve lifecycle result reuse while hardening the older definer's search
-- path and tenant joins. This remains a bounded service-role read only.
create or replace function public.read_prior_node_results_as_worker(
  p_worker_id text,
  p_graph_id uuid
)
returns table (node_key text, payload jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.assert_graph_worker_id(p_worker_id);
  return query
  select distinct on (node.node_key)
    node.node_key,
    artifact.payload
  from public.graphs graph
  join public.graph_nodes node
    on node.graph_id = graph.id
   and node.organization_id = graph.organization_id
  join public.node_runs node_run
    on node_run.node_id = node.id
   and node_run.organization_id = node.organization_id
   and node_run.state in (
     'COMPLETED'::public.graph_node_state,
     'VERIFYING'::public.graph_node_state
   )
  join public.graph_runs run
    on run.id = node_run.graph_run_id
   and run.organization_id = graph.organization_id
   and run.graph_id = graph.id
   and run.state in (
     'CANCELLED'::public.graph_run_state,
     'PARTIAL'::public.graph_run_state,
     'FAILED'::public.graph_run_state
   )
  join public.graph_artifacts artifact
    on artifact.node_run_id = node_run.id
   and artifact.organization_id = graph.organization_id
   and artifact.graph_run_id = run.id
  where graph.id = p_graph_id
    and graph.is_lifecycle
    and not (
      node.executor = 'MODEL'::public.graph_node_executor
      and node.capability in ('review', 'security_review', 'qa')
    )
  order by node.node_key, node_run.completed_at desc nulls last,
    artifact.created_at desc, artifact.id desc;
end;
$function$;

revoke all on function public.read_prior_node_results_as_worker(text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.read_prior_node_results_as_worker_v2(
  p_worker_id text,
  p_graph_id uuid,
  p_protocol_version integer
)
returns table (
  node_key text,
  payload jsonb,
  provider text,
  model text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '0A000',
      message = 'graph worker protocol version 2 is required';
  end if;
  return query
  select distinct on (node.node_key)
    node.node_key,
    artifact.payload,
    node_run.provider,
    node_run.model
  from public.graphs graph
  join public.graph_nodes node
    on node.graph_id = graph.id
   and node.organization_id = graph.organization_id
  join public.node_runs node_run
    on node_run.node_id = node.id
   and node_run.organization_id = node.organization_id
   and node_run.state in (
     'COMPLETED'::public.graph_node_state,
     'VERIFYING'::public.graph_node_state
   )
  join public.graph_runs run
    on run.id = node_run.graph_run_id
   and run.organization_id = graph.organization_id
   and run.graph_id = graph.id
   and run.state in (
     'CANCELLED'::public.graph_run_state,
     'PARTIAL'::public.graph_run_state,
     'FAILED'::public.graph_run_state
   )
  join public.graph_artifacts artifact
    on artifact.node_run_id = node_run.id
   and artifact.organization_id = graph.organization_id
   and artifact.graph_run_id = run.id
  where graph.id = p_graph_id
    and graph.is_lifecycle
    and not (
      node.executor = 'MODEL'::public.graph_node_executor
      and node.capability in ('review', 'security_review', 'qa')
    )
  order by node.node_key, node_run.completed_at desc nulls last,
    artifact.created_at desc, artifact.id desc;
end;
$function$;

revoke all on function public.read_prior_node_results_as_worker_v2(text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.read_prior_node_results_as_worker_v2(text, uuid, integer)
  to service_role;

-- Close a graph run and durably bind its successful one-shot MONITOR probe to
-- the exact deployment in the same transaction. A disabled evidence-only
-- monitor definition is created when needed; it is never enabled or scheduled,
-- so this records what the graph worker already observed without adding an
-- automatic action.
create or replace function public.complete_graph_run_with_phase1c_bridge_as_worker(
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
set search_path = pg_catalog
as $function$
declare
  run_record public.graph_runs%rowtype;
  graph_record public.graphs%rowtype;
  bridge_record public.graph_phase1c_bridges%rowtype;
  deployment_record public.deployments%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  monitor_record public.production_monitors%rowtype;
  observation_id uuid;
  validation_id uuid;
  monitor_id uuid;
  monitor_count integer;
  monitor_node_count integer;
  monitor_artifact_count integer;
  monitor_node_started_at timestamptz;
  target_reference_value text;
  normalized_deployment_url text;
  observed_at timestamptz;
  observed_status integer;
  observed_latency integer;
  graph_node_count integer;
  node_run_count integer;
  derived_had_partial_input boolean;
  normalized_closure_note text := nullif(
    pg_catalog.btrim(coalesce(p_closure_note, '')),
    ''
  );
  correlation_id uuid := gen_random_uuid();
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_state not in (
    'COMPLETED'::public.graph_run_state,
    'PARTIAL'::public.graph_run_state,
    'FAILED'::public.graph_run_state,
    'CANCELLED'::public.graph_run_state,
    'BUDGET_STOPPED'::public.graph_run_state
  ) then
    raise exception using errcode = '22023',
      message = 'graph run completion requires a terminal state';
  end if;
  if normalized_closure_note is not null
    and pg_catalog.char_length(normalized_closure_note) > 2000
  then
    normalized_closure_note := pg_catalog.left(normalized_closure_note, 1997) || '...';
  end if;

  select * into run_record
  from public.graph_runs run
  where run.id = p_graph_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph_run_not_found';
  end if;

  -- Lock and reconcile the full child set before terminalizing the parent.
  -- Once the parent is terminal every child writer is fenced, so accepting a
  -- pending/running orphan here would create an irreparable contradiction.
  perform 1
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id
  order by node_run.id
  for update;

  select pg_catalog.count(*)::integer into graph_node_count
  from public.graph_nodes node
  where node.graph_id = run_record.graph_id
    and node.organization_id = run_record.organization_id;
  select pg_catalog.count(*)::integer into node_run_count
  from public.node_runs node_run
  join public.graph_nodes node
    on node.id = node_run.node_id
   and node.organization_id = node_run.organization_id
   and node.graph_id = run_record.graph_id
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id;
  if graph_node_count < 1 or node_run_count <> graph_node_count or exists (
    select 1
    from public.node_runs node_run
    where node_run.graph_run_id = run_record.id
      and node_run.organization_id = run_record.organization_id
      and not exists (
        select 1 from public.graph_nodes node
        where node.id = node_run.node_id
          and node.organization_id = node_run.organization_id
          and node.graph_id = run_record.graph_id
      )
  ) then
    raise exception using errcode = '55000',
      message = 'graph run child identity is incomplete or inconsistent';
  end if;

  select pg_catalog.bool_or(
    node_run.state <> 'COMPLETED'::public.graph_node_state
  ) into derived_had_partial_input
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id;
  if p_had_partial_input is distinct from derived_had_partial_input then
    raise exception using errcode = '55000',
      message = 'graph partial-input claim does not match the locked child set';
  end if;

  if p_state = 'COMPLETED'::public.graph_run_state and exists (
    select 1 from public.node_runs node_run
    where node_run.graph_run_id = run_record.id
      and node_run.organization_id = run_record.organization_id
      and node_run.state <> 'COMPLETED'::public.graph_node_state
  ) then
    raise exception using errcode = '55000',
      message = 'completed graph run requires every child to be terminal and successful';
  elsif p_state = 'PARTIAL'::public.graph_run_state then
    if exists (
      select 1 from public.node_runs node_run
      where node_run.graph_run_id = run_record.id
        and node_run.organization_id = run_record.organization_id
        and node_run.state in (
          'PENDING'::public.graph_node_state,
          'READY'::public.graph_node_state,
          'RUNNING'::public.graph_node_state,
          'BLOCKED'::public.graph_node_state
        )
    ) or exists (
      select 1 from public.node_runs node_run
      where node_run.graph_run_id = run_record.id
        and node_run.organization_id = run_record.organization_id
        and node_run.state = 'VERIFYING'::public.graph_node_state
        and not exists (
          select 1 from public.graph_gates gate
          where gate.organization_id = run_record.organization_id
            and gate.graph_id = run_record.graph_id
            and gate.node_id = node_run.node_id
            and gate.opened_by_run_id = run_record.id
            and gate.state = 'OPEN'::public.gate_state
        )
    ) then
      raise exception using errcode = '55000',
        message = 'partial graph run has an unaccounted nonterminal child';
    end if;
  elsif exists (
    select 1 from public.node_runs node_run
    where node_run.graph_run_id = run_record.id
      and node_run.organization_id = run_record.organization_id
      and node_run.state in (
        'PENDING'::public.graph_node_state,
        'READY'::public.graph_node_state,
        'RUNNING'::public.graph_node_state,
        'VERIFYING'::public.graph_node_state,
        'BLOCKED'::public.graph_node_state
      )
  ) then
    raise exception using errcode = '55000',
      message = 'terminal graph run has a nonterminal child';
  end if;

  -- Exact retry after a lost response is safe. Null optional measurements keep
  -- their original "leave unchanged" meaning; supplied measurements must be
  -- byte-for-byte the values already committed.
  if run_record.state in (
    'COMPLETED'::public.graph_run_state,
    'PARTIAL'::public.graph_run_state,
    'FAILED'::public.graph_run_state,
    'CANCELLED'::public.graph_run_state,
    'BUDGET_STOPPED'::public.graph_run_state
  ) then
    if run_record.state is distinct from p_state
      or run_record.had_partial_input is distinct from p_had_partial_input
      or (p_tokens_used is not null and run_record.tokens_used is distinct from p_tokens_used)
      or (p_cost_micros is not null and run_record.cost_micros is distinct from p_cost_micros)
      or (p_budget_action is not null and run_record.budget_action is distinct from p_budget_action)
      or run_record.closure_note is distinct from normalized_closure_note
      or run_record.completed_at is null
    then
      raise exception using errcode = '55000',
        message = 'terminal graph run does not match exact completion replay';
    end if;

    select * into graph_record
    from public.graphs graph
    where graph.id = run_record.graph_id
      and graph.organization_id = run_record.organization_id;
    if p_state = 'COMPLETED'::public.graph_run_state
      and graph_record.template_key = 'full_lifecycle'
      and graph_record.template_version = 2
    then
      select * into bridge_record
      from public.graph_phase1c_bridges bridge
      where bridge.id = run_record.phase1c_bridge_id
        and bridge.organization_id = graph_record.organization_id
        and bridge.graph_id = graph_record.id
        and bridge.project_id = graph_record.project_id
      for update;
      if not found or bridge_record.state <> 'MONITORING_RECORDED'
        or bridge_record.monitor_observation_id is null
        or bridge_record.deployment_validation_id is not null
        or not exists (
          select 1
          from public.monitor_observations observation
          join public.deployment_validations validation
            on validation.organization_id = observation.organization_id
           and validation.project_id = observation.project_id
           and validation.deployment_id = observation.deployment_id
           and validation.correlation_id = observation.correlation_id
          where observation.id = bridge_record.monitor_observation_id
            and observation.organization_id = bridge_record.organization_id
            and observation.project_id = bridge_record.project_id
            and observation.deployment_id = bridge_record.deployment_id
            and observation.outcome = 'pass'::public.signal_outcome
            and validation.state = 'inconclusive'::public.deployment_validation_state
            and validation.completed_at is not null
            and validation.validator_version = 'graph-http-probe-v2'
            and validation.policy_version = 'post-deploy-v1'
        )
      then
        raise exception using errcode = '55000',
          message = 'terminal full lifecycle replay has incomplete monitor observation lineage';
      end if;
    end if;
    return run_record;
  end if;

  run_record := public.complete_graph_run_as_worker(
    p_worker_id,
    p_graph_run_id,
    p_state,
    p_had_partial_input,
    p_tokens_used,
    p_cost_micros,
    p_budget_action,
    normalized_closure_note
  );

  if p_state <> 'COMPLETED'::public.graph_run_state then
    return run_record;
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = run_record.graph_id
    and graph.organization_id = run_record.organization_id;
  if not found
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
  then
    return run_record;
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = run_record.phase1c_bridge_id
    and bridge.organization_id = graph_record.organization_id
    and bridge.graph_id = graph_record.id
    and bridge.project_id = graph_record.project_id
  for update;
  if not found or bridge_record.state <> 'DEPLOYMENT_RECORDED' then
    raise exception using errcode = '55000',
      message = 'completed full lifecycle requires an exact recorded deployment bridge';
  end if;

  select * into deployment_record
  from public.deployments deployment
  where deployment.id = bridge_record.deployment_id
    and deployment.organization_id = bridge_record.organization_id
    and deployment.project_id = bridge_record.project_id;
  if not found
    or deployment_record.status <> 'succeeded'::public.deployment_status
    or deployment_record.completed_at is null
    or deployment_record.url is null
    or deployment_record.url !~ '^https://[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]{3,200}$'
    or deployment_record.url !~ '^https://[^/@?#[:space:]]+(?::[0-9]+)?(?:/[^?#[:cntrl:]\\]*)?$'
    or pg_catalog.strpos(deployment_record.url, '?') > 0
    or pg_catalog.strpos(deployment_record.url, '#') > 0
    or public.text_has_likely_secret(deployment_record.url)
    or pg_catalog.lower(deployment_record.commit_sha) is distinct from
      bridge_record.merge_commit_sha
  then
    raise exception using errcode = '55000',
      message = 'bridge deployment has no exact successful production identity';
  end if;
  normalized_deployment_url := pg_catalog.rtrim(deployment_record.url, '/');

  select pg_catalog.count(*)::integer into monitor_node_count
  from public.graph_nodes node
  where node.organization_id = graph_record.organization_id
    and node.graph_id = graph_record.id
    and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage;
  if monitor_node_count <> 1 then
    raise exception using errcode = '55000',
      message = 'full lifecycle must contain exactly one monitor node';
  end if;

  select pg_catalog.count(*)::integer into monitor_artifact_count
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  join public.graph_nodes node
    on node.id = node_run.node_id
   and node.organization_id = node_run.organization_id
   and node.graph_id = graph_record.id
  where artifact.organization_id = graph_record.organization_id
    and artifact.graph_run_id = run_record.id
    and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage
    and node_run.state = 'COMPLETED'::public.graph_node_state;
  if monitor_artifact_count <> 1 then
    raise exception using errcode = '55000',
      message = 'completed monitor node must have exactly one terminal evidence artifact';
  end if;

  select artifact.* into artifact_record
  from public.graph_artifacts artifact
  join public.node_runs node_run
    on node_run.id = artifact.node_run_id
   and node_run.organization_id = artifact.organization_id
   and node_run.graph_run_id = artifact.graph_run_id
  join public.graph_nodes node
    on node.id = node_run.node_id
   and node.organization_id = node_run.organization_id
   and node.graph_id = graph_record.id
  where artifact.organization_id = graph_record.organization_id
    and artifact.graph_run_id = run_record.id
    and artifact.kind = 'ANCHOR'::public.graph_artifact_kind
    and node.lifecycle_stage = 'MONITORING'::public.sdlc_stage
    and node_run.state = 'COMPLETED'::public.graph_node_state
  limit 1;
  if not found
    or pg_catalog.octet_length(artifact_record.payload::text) > 32768
    or public.jsonb_has_sensitive_keys(artifact_record.payload)
    or artifact_record.payload ->> 'observation' is distinct from 'production_http_probe'
    or artifact_record.payload ->> 'deploymentId' is distinct from
      bridge_record.deployment_id::text
    or pg_catalog.rtrim(coalesce(artifact_record.payload ->> 'url', ''), '/') is distinct from
      normalized_deployment_url
    or pg_catalog.jsonb_typeof(artifact_record.payload -> 'healthy') <> 'boolean'
    or artifact_record.payload -> 'healthy' <> 'true'::jsonb
    or artifact_record.payload ->> 'postDeployValidation' is distinct from 'inconclusive'
    or artifact_record.payload -> 'observationWindowComplete' <> 'false'::jsonb
    or coalesce(artifact_record.payload ->> 'status', '') !~ '^[1-5][0-9]{2}$'
    or coalesce(artifact_record.payload ->> 'latencyMs', '') !~ '^[0-9]{1,6}$'
    or coalesce(artifact_record.payload ->> 'observedAt', '') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
  then
    raise exception using errcode = '55000',
      message = 'completed monitor node has no bounded exact healthy HTTP evidence';
  end if;

  select node_run.started_at into monitor_node_started_at
  from public.node_runs node_run
  where node_run.id = artifact_record.node_run_id
    and node_run.organization_id = artifact_record.organization_id
    and node_run.graph_run_id = artifact_record.graph_run_id;
  if monitor_node_started_at is null then
    raise exception using errcode = '55000',
      message = 'completed monitor evidence has no exact node start time';
  end if;

  observed_status := (artifact_record.payload ->> 'status')::integer;
  observed_latency := (artifact_record.payload ->> 'latencyMs')::integer;
  observed_at := (artifact_record.payload ->> 'observedAt')::timestamptz;
  if observed_status not between 200 and 299
    or observed_latency > 600000
    or observed_at < deployment_record.completed_at
    or observed_at < monitor_node_started_at
    or artifact_record.created_at < monitor_node_started_at
    or artifact_record.created_at < observed_at - interval '5 minutes'
    or artifact_record.created_at > observed_at + interval '10 minutes'
    or observed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
    or artifact_record.created_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  then
    raise exception using errcode = '55000',
      message = 'monitor HTTP evidence does not follow the recorded deployment';
  end if;

  target_reference_value := 'graph_phase1c_bridge:' || bridge_record.id::text;
  select pg_catalog.count(*)::integer, min(monitor.id::text)::uuid
    into monitor_count, monitor_id
  from public.production_monitors monitor
  where monitor.organization_id = bridge_record.organization_id
    and monitor.project_id = bridge_record.project_id
    and monitor.target_reference = target_reference_value;
  if monitor_count > 1 then
    raise exception using errcode = '55000',
      message = 'graph HTTP probe monitor identity is ambiguous';
  end if;
  if monitor_count = 1 then
    select * into monitor_record
    from public.production_monitors monitor
    where monitor.id = monitor_id
    for update;
    if monitor_record.signal_kind <> 'uptime'::public.production_signal_kind
      or monitor_record.provider <> 'http'
      or pg_catalog.rtrim(monitor_record.target_url, '/') is distinct from
        normalized_deployment_url
      or monitor_record.connection_state <> 'connected'::public.monitor_connection_state
      or monitor_record.enabled
    then
      raise exception using errcode = '55000',
        message = 'stored graph HTTP probe monitor conflicts with exact evidence';
    end if;
  else
    insert into public.production_monitors (
      organization_id, project_id, name, signal_kind, provider, target_url,
      target_reference, connection_state, enabled, expected_status_code,
      last_observed_at, last_outcome, created_by
    ) values (
      bridge_record.organization_id,
      bridge_record.project_id,
      'Full lifecycle probe ' || bridge_record.deployment_id::text,
      'uptime'::public.production_signal_kind,
      'http',
      normalized_deployment_url,
      target_reference_value,
      'connected'::public.monitor_connection_state,
      false,
      observed_status,
      observed_at,
      'pass'::public.signal_outcome,
      bridge_record.created_by
    )
    returning * into monitor_record;
  end if;

  insert into public.monitor_observations (
    organization_id, project_id, monitor_id, deployment_id, signal_kind,
    outcome, latency_ms, status_code, evidence, correlation_id, observed_at
  ) values (
    bridge_record.organization_id,
    bridge_record.project_id,
    monitor_record.id,
    bridge_record.deployment_id,
    'uptime'::public.production_signal_kind,
    'pass'::public.signal_outcome,
    observed_latency,
    observed_status,
    artifact_record.payload || pg_catalog.jsonb_build_object(
      'graphId', graph_record.id,
      'graphRunId', run_record.id,
      'artifactId', artifact_record.id
    ),
    correlation_id,
    observed_at
  )
  returning id into observation_id;

  insert into public.deployment_validations (
    organization_id, project_id, deployment_id, state, checks,
    validator_version, policy_version, summary, correlation_id,
    started_at, completed_at
  ) values (
    bridge_record.organization_id,
    bridge_record.project_id,
    bridge_record.deployment_id,
    'inconclusive'::public.deployment_validation_state,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'stage', 'identity', 'name', 'exact_deployment_identity',
        'required', true, 'result', 'pass'
      ),
      pg_catalog.jsonb_build_object(
        'stage', 'availability', 'name', 'production_http_probe',
        'required', true, 'result', 'pass', 'statusCode', observed_status,
        'latencyMs', observed_latency, 'observationId', observation_id
      ),
      pg_catalog.jsonb_build_object(
        'stage', 'data_integration', 'name', 'data_and_integration_safety',
        'required', true, 'result', 'unknown',
        'detail', 'No data or integration validation was performed by this one-shot probe.'
      ),
      pg_catalog.jsonb_build_object(
        'stage', 'quality_security', 'name', 'quality_and_security_signals',
        'required', true, 'result', 'unknown',
        'detail', 'No post-deploy quality or security validation was performed by this one-shot probe.'
      ),
      pg_catalog.jsonb_build_object(
        'stage', 'observation', 'name', 'observation_window',
        'required', true, 'result', 'unknown',
        'observationWindowComplete', false,
        'detail', 'A single observation does not complete the required observation window.'
      )
    ),
    'graph-http-probe-v2',
    'post-deploy-v1',
    'Probe passed; post-deploy validation is inconclusive because required stages and the observation window are incomplete.',
    correlation_id,
    observed_at,
    observed_at
  )
  returning id into validation_id;

  perform public.record_graph_phase1c_monitor_as_worker(
    bridge_record.id,
    observation_id
  );

  return run_record;
end;
$function$;

revoke all on function public.complete_graph_run_with_phase1c_bridge_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_graph_run_with_phase1c_bridge_as_worker(
  text, uuid, public.graph_run_state, boolean, bigint, bigint, text, text
) to service_role;

-- A claim creates the RUNNING parent and every PENDING child before returning
-- its projection. If that projection cannot be parsed or compiled, closing the
-- parent directly would either strand nonterminal children or lie about the
-- partial-input flag. Abort the exact run as one transaction: parent lock
-- first, then the complete child set, one cancellation event per changed
-- child, and finally the ordinary audited terminal wrapper. The digest makes a
-- lost-response retry exact without appending a second set of audit events.
create or replace function public.abort_graph_run_as_worker(
  p_worker_id text,
  p_graph_run_id uuid,
  p_state public.graph_run_state,
  p_detail text default null
)
returns public.graph_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.graph_runs%rowtype;
  normalized_detail text := coalesce(
    nullif(pg_catalog.btrim(p_detail), ''),
    'The claimed graph could not enter execution.'
  );
  abort_sha256 text;
  cancelled_count integer := 0;
  derived_had_partial_input boolean;
  abort_event_count integer := 0;
  replay_event_count integer := 0;
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_state not in (
    'FAILED'::public.graph_run_state,
    'CANCELLED'::public.graph_run_state
  ) then
    raise exception using errcode = '22023',
      message = 'graph abort requires FAILED or CANCELLED';
  end if;
  if pg_catalog.char_length(normalized_detail) > 1000
    or public.text_has_likely_secret(normalized_detail)
  then
    raise exception using errcode = '22023',
      message = 'graph abort detail is unsafe or oversized';
  end if;

  abort_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'version', 1,
      'workerId', p_worker_id,
      'graphRunId', p_graph_run_id,
      'state', p_state,
      'detail', normalized_detail
    )::text,
    'UTF8'
  )), 'hex');

  select * into run_record
  from public.graph_runs run
  where run.id = p_graph_run_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph_run_not_found';
  end if;

  perform 1
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id
  order by node_run.id
  for update;

  select pg_catalog.bool_or(
    node_run.state <> 'COMPLETED'::public.graph_node_state
  ) into derived_had_partial_input
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id;
  if derived_had_partial_input is null then
    raise exception using errcode = '55000',
      message = 'graph abort requires the exact nonempty child set';
  end if;

  if run_record.state in (
    'COMPLETED'::public.graph_run_state,
    'PARTIAL'::public.graph_run_state,
    'FAILED'::public.graph_run_state,
    'CANCELLED'::public.graph_run_state,
    'BUDGET_STOPPED'::public.graph_run_state
  ) then
    select
      pg_catalog.count(*)::integer,
      pg_catalog.count(*) filter (
        where event.payload ->> 'abort_sha256' = abort_sha256
      )::integer
      into abort_event_count, replay_event_count
    from public.graph_events event
    where event.organization_id = run_record.organization_id
      and event.graph_run_id = run_record.id
      and event.event_type = 'run_abort_requested';
    if run_record.state is distinct from p_state
      or run_record.had_partial_input is distinct from derived_had_partial_input
      or run_record.closure_note is distinct from normalized_detail
      or run_record.completed_at is null
      or abort_event_count <> 1
      or replay_event_count <> 1
      or exists (
        select 1
        from public.node_runs node_run
        where node_run.graph_run_id = run_record.id
          and node_run.organization_id = run_record.organization_id
          and node_run.state in (
            'PENDING'::public.graph_node_state,
            'READY'::public.graph_node_state,
            'RUNNING'::public.graph_node_state,
            'VERIFYING'::public.graph_node_state,
            'BLOCKED'::public.graph_node_state
          )
      )
    then
      raise exception using errcode = '55000',
        message = 'graph abort replay does not match durable evidence';
    end if;
    return run_record;
  end if;
  if run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000',
      message = 'only an exact running graph may be aborted';
  end if;
  if exists (
    select 1
    from public.node_runs node_run
    where node_run.graph_run_id = run_record.id
      and node_run.organization_id = run_record.organization_id
      and (
        node_run.state <> 'PENDING'::public.graph_node_state
        or node_run.started_at is not null
        or node_run.completed_at is not null
      )
  ) then
    raise exception using errcode = '55000',
      message = 'graph abort requires an unstarted all-PENDING child set';
  end if;

  with cancelled as (
    update public.node_runs node_run
    set state = 'CANCELLED'::public.graph_node_state,
        blocked_reason = normalized_detail,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where node_run.graph_run_id = run_record.id
      and node_run.organization_id = run_record.organization_id
      and node_run.state in (
        'PENDING'::public.graph_node_state,
        'READY'::public.graph_node_state,
        'RUNNING'::public.graph_node_state,
        'VERIFYING'::public.graph_node_state,
        'BLOCKED'::public.graph_node_state
      )
    returning node_run.id, node_run.organization_id, node_run.graph_run_id
  ), audited as (
    insert into public.graph_events (
      organization_id, graph_run_id, node_run_id, event_type, detail, payload
    )
    select
      cancelled.organization_id,
      cancelled.graph_run_id,
      cancelled.id,
      'node_cancelled',
      normalized_detail,
      pg_catalog.jsonb_build_object(
        'abort_sha256', abort_sha256,
        'worker_id', p_worker_id
      )
    from cancelled
    returning 1
  )
  select pg_catalog.count(*)::integer into cancelled_count from audited;

  select pg_catalog.bool_or(
    node_run.state <> 'COMPLETED'::public.graph_node_state
  ) into derived_had_partial_input
  from public.node_runs node_run
  where node_run.graph_run_id = run_record.id
    and node_run.organization_id = run_record.organization_id;

  insert into public.graph_events (
    organization_id, graph_run_id, event_type, detail, payload
  ) values (
    run_record.organization_id,
    run_record.id,
    'run_abort_requested',
    normalized_detail,
    pg_catalog.jsonb_build_object(
      'abort_sha256', abort_sha256,
      'worker_id', p_worker_id,
      'terminal_state', p_state,
      'cancelled_node_count', cancelled_count,
      'had_partial_input', derived_had_partial_input
    )
  );

  return public.complete_graph_run_with_phase1c_bridge_as_worker(
    p_worker_id,
    run_record.id,
    p_state,
    derived_had_partial_input,
    null,
    null,
    null,
    normalized_detail
  );
end;
$function$;

revoke all on function public.abort_graph_run_as_worker(
  text, uuid, public.graph_run_state, text
) from public, anon, authenticated, service_role;
grant execute on function public.abort_graph_run_as_worker(
  text, uuid, public.graph_run_state, text
) to service_role;

-- Fail the migration rather than silently exposing an incomplete claim or an
-- accidentally callable bridge surface.
do $graph_phase1c_lineage_postflight$
declare
  claim_definition text;
  private_routine_name text;
  privilege_name text;
  role_name text;
  routine_name text;
  routine_oid regprocedure;
  table_name text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid) into claim_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'claim_planned_graph_internal'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      = 'p_worker_id text, p_supported_executors text[], p_repository_full_name text, p_required_check_names jsonb';

  if claim_definition is null
    or pg_catalog.strpos(claim_definition, 'PULL_REQUEST_RECORDED') = 0
    or pg_catalog.strpos(claim_definition, '''validation_evidence''') = 0
    or pg_catalog.strpos(claim_definition, '''merge_commit_sha''') = 0
    or pg_catalog.strpos(claim_definition, '''deployment_id''') = 0
    or pg_catalog.strpos(claim_definition, 'repository.full_name as project_repository') = 0
    or pg_catalog.strpos(claim_definition, '''project_repository''') = 0
    or pg_catalog.strpos(claim_definition, '''project_default_branch''') = 0
    or pg_catalog.strpos(claim_definition, 'connection.status = ''connected''') = 0
    or pg_catalog.strpos(claim_definition, 'repository.selected') = 0
  then
    raise exception 'claim_planned_graph lineage projection is incomplete';
  end if;

  foreach routine_name in array array[
    'claim_planned_graph_v2(text,text[],text,jsonb,integer)',
    'claim_phase1c_run_v2(text,text,text,integer,integer)',
    'read_prior_node_results_as_worker_v2(text,uuid,integer)',
    'open_node_gate_as_worker(text,uuid,uuid,integer)',
    'decide_automatic_gate_as_worker(text,uuid)',
    'record_node_state_as_worker(text,uuid,public.graph_node_state,text,text,text,integer)',
    'record_graph_artifact_as_worker(text,uuid,public.graph_artifact_kind,jsonb,uuid,integer,integer)',
    'complete_reviewer_with_verifications_as_worker(text,uuid,jsonb,text,text,integer,jsonb)',
    'diagnose_graph_queue_as_worker_v2(text,text,jsonb,uuid,integer)',
    'abort_graph_run_as_worker(text,uuid,public.graph_run_state,text)',
    'create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)',
    'bind_graph_phase1c_run_by_command_as_worker(uuid,uuid,uuid)',
    'complete_phase1c_run_with_graph_bridge_as_worker(text,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,text,boolean)',
    'approve_graph_phase1c_test_gate_as_worker(uuid,uuid,integer,text,text,text,text,timestamp with time zone)',
    'approve_graph_phase1c_deployment_gate_as_worker(uuid,uuid,uuid,bigint,text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'complete_graph_run_with_phase1c_bridge_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)'
  ]
  loop
    routine_oid := pg_catalog.to_regprocedure('public.' || routine_name);
    if routine_oid is null
      or not pg_catalog.has_function_privilege('service_role', routine_oid, 'execute')
      or pg_catalog.has_function_privilege('anon', routine_oid, 'execute')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'execute')
      or not exists (
        select 1 from pg_catalog.pg_proc procedure
        where procedure.oid = routine_oid
          and procedure.prosecdef
          and procedure.proconfig @> array['search_path=pg_catalog']::text[]
      )
    then
      raise exception 'graph Phase 1C RPC ACL is not fail-closed: %', routine_name;
    end if;
  end loop;

  foreach private_routine_name in array array[
    'graph_required_check_policy_is_safe(jsonb)',
    'graph_verification_evidence_is_safe(jsonb)',
    'enforce_graph_artifact_update_immutable()',
    'canonical_digest_timestamp(timestamp with time zone)',
    'assert_canonical_graph_test_anchor(jsonb,text,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'record_verification_as_worker(text,uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)',
    'record_graph_verification_internal(text,uuid,uuid,public.verification_lens,public.verification_verdict,jsonb)',
    'read_prior_node_results_as_worker(text,uuid)',
    'diagnose_graph_queue_as_worker(text)',
    'claim_planned_graph(text,text[])',
    'claim_planned_graph_internal(text,text[],text,jsonb)',
    'claim_phase1c_run(text,text,text,integer)',
    'start_graph_run(uuid)',
    'record_node_state(uuid,public.graph_node_state,text,text,text,integer)',
    'complete_graph_run(uuid,public.graph_run_state,boolean,bigint,bigint,text)',
    'record_handoff(uuid,uuid,jsonb,boolean,jsonb,uuid,jsonb,jsonb,jsonb,text)',
    'record_graph_artifact(uuid,public.graph_artifact_kind,jsonb,uuid,integer,integer)',
    'record_verification(uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)',
    'create_graph_phase1c_bridge_as_worker(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,text,text)',
    'create_graph_phase1c_bridge_for_approved_gate(uuid,text,integer,uuid,text,text)',
    'attach_graph_phase1c_command_for_approved_gate(uuid,uuid,uuid)',
    'bind_graph_phase1c_run_as_worker(uuid,uuid,uuid,uuid)',
    'record_graph_phase1c_pull_request_as_worker(uuid,uuid)',
    'record_graph_phase1c_merge_as_worker(uuid)',
    'record_graph_phase1c_github_merge_as_worker(uuid,integer,text,text,text,text,timestamp with time zone)',
    'record_graph_phase1c_deployment_as_worker(uuid,uuid)',
    'record_graph_phase1c_github_deployment_as_worker(uuid,uuid,bigint,text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'record_graph_phase1c_monitor_as_worker(uuid,uuid)',
    'record_graph_phase1c_validation_as_worker(uuid,uuid)',
    'approve_full_lifecycle_gate_internal(uuid,public.sdlc_stage,uuid,text)',
    'complete_phase1c_run(text,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,text,boolean)',
    'complete_graph_run_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)'
  ]
  loop
    routine_oid := pg_catalog.to_regprocedure('public.' || private_routine_name);
    if routine_oid is null
      or pg_catalog.has_function_privilege('service_role', routine_oid, 'execute')
      or pg_catalog.has_function_privilege('anon', routine_oid, 'execute')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'execute')
    then
      raise exception 'graph Phase 1C internal RPC is externally executable: %',
        private_routine_name;
    end if;
  end loop;

  routine_oid := pg_catalog.to_regprocedure(
    'public.complete_graph_run_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)'
  );
  if routine_oid is null or not exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid = routine_oid
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'private graph completion primitive has an unsafe execution context';
  end if;

  routine_oid := pg_catalog.to_regprocedure(
    'public.approve_graph_phase1c_architecture_gate(uuid,uuid,text)'
  );
  if routine_oid is null
    or not pg_catalog.has_function_privilege('authenticated', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('anon', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('service_role', routine_oid, 'execute')
  then
    raise exception 'architecture approval RPC ACL is not owner-browser-only';
  end if;

  routine_oid := pg_catalog.to_regprocedure(
    'public.submit_and_attach_graph_phase1c_command(uuid,jsonb)'
  );
  if routine_oid is null
    or not pg_catalog.has_function_privilege('authenticated', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('anon', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('service_role', routine_oid, 'execute')
  then
    raise exception 'atomic approved-architecture command RPC ACL is not owner-browser-only';
  end if;

  routine_oid := pg_catalog.to_regprocedure(
    'public.request_graph_release_gate_approval(uuid,uuid,uuid,text)'
  );
  if routine_oid is null
    or not pg_catalog.has_function_privilege('authenticated', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('anon', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('service_role', routine_oid, 'execute')
  then
    raise exception 'release gate owner-intent RPC ACL is not owner-browser-only';
  end if;

  routine_oid := pg_catalog.to_regprocedure(
    'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)'
  );
  if routine_oid is null
    or not pg_catalog.has_function_privilege('service_role', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('anon', routine_oid, 'execute')
    or pg_catalog.has_function_privilege('authenticated', routine_oid, 'execute')
  then
    raise exception 'release-identity graph launch RPC ACL is not server-only';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'graph_release_gate_approval_intents'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  )
  then
    raise exception 'release gate approval intents are not RLS/FORCE/no-privilege';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    foreach privilege_name in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if pg_catalog.has_table_privilege(
        role_name,
        'public.graph_release_gate_approval_intents',
        privilege_name
      ) then
        raise exception 'release gate approval intents expose % to %',
          privilege_name, role_name;
      end if;
    end loop;
  end loop;

  foreach table_name in array array[
    'graph_templates', 'graphs', 'graph_budgets', 'graph_nodes',
    'node_contracts', 'graph_edges', 'graph_runs', 'node_runs',
    'graph_artifacts', 'graph_handoffs', 'graph_verifications',
    'work_locks', 'graph_events', 'graph_gates', 'graph_phase1c_bridges'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = pg_catalog.to_regclass('public.' || table_name)
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) or not pg_catalog.has_table_privilege(
      'authenticated', 'public.' || table_name, 'SELECT'
    ) then
      raise exception 'graph table lacks RLS/FORCE/member read: %', table_name;
    end if;
    foreach role_name in array array['anon', 'service_role']
    loop
      foreach privilege_name in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]
      loop
        if pg_catalog.has_table_privilege(
          role_name, 'public.' || table_name, privilege_name
        ) then
          raise exception 'graph table % exposes % to %',
            table_name, privilege_name, role_name;
        end if;
      end loop;
    end loop;
    foreach privilege_name in array array[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if pg_catalog.has_table_privilege(
        'authenticated', 'public.' || table_name, privilege_name
      ) then
        raise exception 'graph table % exposes authenticated %',
          table_name, privilege_name;
      end if;
    end loop;
  end loop;

  foreach privilege_name in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if pg_catalog.has_table_privilege(
      'service_role', 'public.graph_gates', privilege_name
    ) then
      raise exception 'graph gates expose direct service-role % authority',
        privilege_name;
    end if;
  end loop;

  foreach role_name in array array['anon', 'service_role']
  loop
    foreach privilege_name in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if pg_catalog.has_table_privilege(
        role_name, 'public.graph_artifacts', privilege_name
      ) then
        raise exception 'graph artifacts expose % to %', privilege_name, role_name;
      end if;
    end loop;
  end loop;

  foreach privilege_name in array array[
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if pg_catalog.has_table_privilege(
      'authenticated', 'public.graph_artifacts', privilege_name
    ) then
      raise exception 'graph artifacts expose authenticated % authority',
        privilege_name;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege(
      'authenticated', 'public.graph_artifacts', 'SELECT'
    ) or not exists (
      select 1
      from pg_catalog.pg_trigger trigger_catalog
      join pg_catalog.pg_proc procedure
        on procedure.oid = trigger_catalog.tgfoid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where trigger_catalog.tgrelid = 'public.graph_artifacts'::regclass
        and trigger_catalog.tgname = 'graph_artifacts_update_immutable'
        and not trigger_catalog.tgisinternal
        and trigger_catalog.tgenabled = 'O'
        and namespace.nspname = 'public'
        and procedure.proname = 'enforce_graph_artifact_update_immutable'
    ) or not exists (
      select 1
      from pg_catalog.pg_constraint constraint_catalog
      where constraint_catalog.conname = 'graph_artifacts_payload_no_sensitive_data'
        and constraint_catalog.conrelid = 'public.graph_artifacts'::regclass
        and constraint_catalog.contype = 'c'
        and constraint_catalog.convalidated
        and pg_catalog.strpos(
          pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true),
          'jsonb_has_sensitive_keys(payload)'
        ) > 0
    ) or not exists (
      select 1
      from pg_catalog.pg_constraint constraint_catalog
      where constraint_catalog.conname = 'graph_artifacts_payload_size_bounded'
        and constraint_catalog.conrelid = 'public.graph_artifacts'::regclass
        and constraint_catalog.contype = 'c'
        and constraint_catalog.convalidated
        and pg_catalog.strpos(
          pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true),
          'octet_length'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true),
          'payload'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true),
          '1048576'
        ) > 0
    )
  then
    raise exception 'graph artifacts are not readable-member/immutable-payload evidence';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_artifacts_id_organization_graph_run_unique'
      and constraint_catalog.conrelid = 'public.graph_artifacts'::regclass
      and constraint_catalog.contype = 'u'
      and constraint_catalog.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'UNIQUE (id, organization_id, graph_run_id)'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_artifacts_node_run_fk'
      and constraint_catalog.conrelid = 'public.graph_artifacts'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.node_runs'::regclass
      and constraint_catalog.confdeltype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'FOREIGN KEY (node_run_id, organization_id, graph_run_id) REFERENCES node_runs(id, organization_id, graph_run_id) ON DELETE CASCADE'
  ) or not exists (
    select 1 from pg_catalog.pg_index index_catalog
    where index_catalog.indexrelid = pg_catalog.to_regclass(
        'public.graph_artifacts_node_run_kind_unique'
      )
      and index_catalog.indrelid = 'public.graph_artifacts'::regclass
      and index_catalog.indisunique
      and index_catalog.indisvalid
      and index_catalog.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true) = 'node_run_id'
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true) = 'kind'
      and pg_catalog.pg_get_expr(index_catalog.indpred, index_catalog.indrelid)
        = '(node_run_id IS NOT NULL)'
  ) then
    raise exception 'graph artifact product identity constraints are incomplete';
  end if;

  if exists (
    select 1
    from (
      values
        ('graph_release_gate_approval_intents', 'graph_release_gate_intents_immutable',
          'enforce_graph_release_gate_intent_transition'),
        ('graph_runs', 'graph_runs_phase1c_bridge_identity',
          'enforce_graph_run_phase1c_bridge_identity'),
        ('graph_phase1c_bridges', 'graph_phase1c_bridges_monotonic',
          'enforce_graph_phase1c_bridge_transition'),
        ('graph_phase1c_bridges', 'graph_phase1c_bridges_audit',
          'audit_graph_phase1c_bridge_transition')
    ) expected(table_name, trigger_name, procedure_name)
    where not exists (
      select 1
      from pg_catalog.pg_trigger trigger_catalog
      join pg_catalog.pg_proc procedure on procedure.oid = trigger_catalog.tgfoid
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where trigger_catalog.tgrelid =
          pg_catalog.to_regclass('public.' || expected.table_name)
        and trigger_catalog.tgname = expected.trigger_name
        and not trigger_catalog.tgisinternal
        and trigger_catalog.tgenabled = 'O'
        and namespace.nspname = 'public'
        and procedure.proname = expected.procedure_name
    )
  ) then
    raise exception 'graph release lineage monotonic/audit triggers are incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'monitor_observations_deployment_fk'
      and constraint_catalog.conrelid = 'public.monitor_observations'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.deployments'::regclass
      and constraint_catalog.confdeltype = 'r'
      and constraint_catalog.conkey = array[
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.monitor_observations'::regclass
            and attribute.attname = 'deployment_id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.monitor_observations'::regclass
            and attribute.attname = 'organization_id'
        )
      ]::smallint[]
      and constraint_catalog.confkey = array[
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.deployments'::regclass
            and attribute.attname = 'id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.deployments'::regclass
            and attribute.attname = 'organization_id'
        )
      ]::smallint[]
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_catalog
    join pg_catalog.pg_proc procedure on procedure.oid = trigger_catalog.tgfoid
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where trigger_catalog.tgrelid = 'public.monitor_observations'::regclass
      and trigger_catalog.tgname = 'monitor_observations_validate_deployment'
      and not trigger_catalog.tgisinternal
      and trigger_catalog.tgenabled = 'O'
      and namespace.nspname = 'public'
      and procedure.proname = 'validate_monitor_observation_deployment'
  ) then
    raise exception 'monitor deployment identity is not fail-closed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.graph_verifications'::regclass
      and attribute.attname = 'verifier_node_run_id'
      and attribute.atttypid = 'uuid'::regtype
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_verifications_verifier_node_run_fk'
      and constraint_catalog.conrelid = 'public.graph_verifications'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.node_runs'::regclass
      and constraint_catalog.confdeltype = 'c'
      and constraint_catalog.conkey = array[
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_verifications'::regclass
            and attribute.attname = 'verifier_node_run_id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_verifications'::regclass
            and attribute.attname = 'organization_id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_verifications'::regclass
            and attribute.attname = 'graph_run_id'
        )
      ]::smallint[]
      and constraint_catalog.confkey = array[
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.node_runs'::regclass
            and attribute.attname = 'id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.node_runs'::regclass
            and attribute.attname = 'organization_id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.node_runs'::regclass
            and attribute.attname = 'graph_run_id'
        )
      ]::smallint[]
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'node_runs_id_organization_graph_run_unique'
      and constraint_catalog.conrelid = 'public.node_runs'::regclass
      and constraint_catalog.contype = 'u'
      and constraint_catalog.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'UNIQUE (id, organization_id, graph_run_id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_verifications_subject_run_fk'
      and constraint_catalog.conrelid = 'public.graph_verifications'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.node_runs'::regclass
      and constraint_catalog.confdeltype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'FOREIGN KEY (subject_node_run_id, organization_id, graph_run_id) REFERENCES node_runs(id, organization_id, graph_run_id) ON DELETE CASCADE'
  ) or not exists (
    select 1
    from pg_catalog.pg_index index_catalog
    where index_catalog.indexrelid = pg_catalog.to_regclass(
        'public.graph_verifications_verifier_subject_lens_unique'
      )
      and index_catalog.indrelid = 'public.graph_verifications'::regclass
      and index_catalog.indisunique
      and index_catalog.indisvalid
      and index_catalog.indnkeyatts = 3
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true)
        = 'verifier_node_run_id'
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true)
        = 'subject_node_run_id'
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 3, true)
        = 'lens'
      and pg_catalog.pg_get_expr(index_catalog.indpred, index_catalog.indrelid)
        = '(verifier_node_run_id IS NOT NULL)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_verifications_evidence_safe'
      and constraint_catalog.conrelid = 'public.graph_verifications'::regclass
      and constraint_catalog.contype = 'c'
      and constraint_catalog.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'CHECK (graph_verification_evidence_is_safe(evidence))'
  ) or not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.graph_verifications'::regclass
      and attribute.attname = 'source_artifact_id'
      and attribute.atttypid = 'uuid'::regtype
      and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.graph_verifications'::regclass
      and attribute.attname = 'source_artifact_sha256'
      and attribute.atttypid = 'text'::regtype
      and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_verifications_source_artifact_fk'
      and constraint_catalog.conrelid = 'public.graph_verifications'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.graph_artifacts'::regclass
      and constraint_catalog.confdeltype = 'r'
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'FOREIGN KEY (source_artifact_id, organization_id, graph_run_id) REFERENCES graph_artifacts(id, organization_id, graph_run_id) ON DELETE RESTRICT'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_verifications_source_artifact_together'
      and constraint_catalog.conrelid = 'public.graph_verifications'::regclass
      and constraint_catalog.contype = 'c'
      and constraint_catalog.convalidated
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true),
        'source_artifact_sha256'
      ) > 0
  ) or not exists (
    select 1 from pg_catalog.pg_index index_catalog
    where index_catalog.indexrelid = pg_catalog.to_regclass(
        'public.graph_verifications_source_artifact_idx'
      )
      and index_catalog.indrelid = 'public.graph_verifications'::regclass
      and index_catalog.indisvalid
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true)
        = 'source_artifact_id'
      and pg_catalog.pg_get_expr(index_catalog.indpred, index_catalog.indrelid)
        = '(source_artifact_id IS NOT NULL)'
  ) then
    raise exception 'graph verification identity/evidence constraints are incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_gates_opened_run_fk'
      and constraint_catalog.conrelid = 'public.graph_gates'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.graph_runs'::regclass
      and constraint_catalog.confdeltype = 'r'
      and constraint_catalog.conkey = array[
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_gates'::regclass
            and attribute.attname = 'opened_by_run_id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_gates'::regclass
            and attribute.attname = 'organization_id'
        )
      ]::smallint[]
      and constraint_catalog.confkey = array[
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_runs'::regclass
            and attribute.attname = 'id'
        ),
        (
          select attribute.attnum from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.graph_runs'::regclass
            and attribute.attname = 'organization_id'
        )
      ]::smallint[]
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_runs_id_organization_graph_unique'
      and constraint_catalog.conrelid = 'public.graph_runs'::regclass
      and constraint_catalog.contype = 'u'
      and constraint_catalog.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'UNIQUE (id, organization_id, graph_id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_nodes_id_organization_graph_unique'
      and constraint_catalog.conrelid = 'public.graph_nodes'::regclass
      and constraint_catalog.contype = 'u'
      and constraint_catalog.convalidated
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'UNIQUE (id, organization_id, graph_id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_gates_opened_run_graph_fk'
      and constraint_catalog.conrelid = 'public.graph_gates'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.graph_runs'::regclass
      and constraint_catalog.confdeltype = 'r'
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'FOREIGN KEY (opened_by_run_id, organization_id, graph_id) REFERENCES graph_runs(id, organization_id, graph_id) ON DELETE RESTRICT'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_gates_node_graph_fk'
      and constraint_catalog.conrelid = 'public.graph_gates'::regclass
      and constraint_catalog.contype = 'f'
      and constraint_catalog.convalidated
      and constraint_catalog.confrelid = 'public.graph_nodes'::regclass
      and constraint_catalog.confdeltype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_catalog.oid, true)
        = 'FOREIGN KEY (node_id, organization_id, graph_id) REFERENCES graph_nodes(id, organization_id, graph_id) ON DELETE CASCADE'
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.graph_gates'::regclass
      and attribute.attname = 'opened_by_run_id'
      and attribute.attnotnull
  ) or not exists (
    select 1
    from pg_catalog.pg_index index_catalog
    where index_catalog.indexrelid = pg_catalog.to_regclass(
        'public.deployments_github_external_identity_unique'
      )
      and index_catalog.indrelid = 'public.deployments'::regclass
      and index_catalog.indisunique
      and index_catalog.indisvalid
      and index_catalog.indnkeyatts = 3
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true)
        = 'organization_id'
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true)
        = 'provider'
      and pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 3, true)
        = 'external_reference'
      and pg_catalog.pg_get_expr(index_catalog.indpred, index_catalog.indrelid)
        = '((provider = ''github''::text) AND (external_reference IS NOT NULL))'
  ) then
    raise exception 'release lineage identity arbiters are missing';
  end if;
end;
$graph_phase1c_lineage_postflight$;
