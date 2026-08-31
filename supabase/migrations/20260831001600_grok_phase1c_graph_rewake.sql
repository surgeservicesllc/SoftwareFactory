-- Close the admitted Grok Phase 1C -> canonical graph handoff.
--
-- The Phase 1C completion wrapper already advances an exact bridge to
-- PULL_REQUEST_RECORDED in the same transaction that closes its agent run.
-- Before this migration, nothing durable represented the worker wake needed
-- after that commit. The graph therefore waited for an unrelated schedule or
-- a person to drain it. This migration creates exactly one transactional wake
-- intent for that exact bridge transition and exposes only leased, target-
-- bound service-role functions to deliver it.
--
-- No function here performs network I/O, claims a graph, enables a worker,
-- changes autonomy/automatic actions, or disengages a kill switch. GitHub
-- dispatch remains in reviewed server-side TypeScript and the graph worker's
-- exact-id protocol-v3 claim remains the execution authority.

create table public.grok_graph_rewake_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  graph_id uuid not null,
  bridge_id uuid not null,
  phase1c_run_id uuid not null,
  command_id uuid not null,
  github_repository_id uuid not null,
  connection_id uuid not null,
  internal_installation_id uuid not null,
  external_installation_id bigint not null check (external_installation_id > 0),
  app_id bigint not null check (app_id > 0),
  external_repository_id bigint not null check (external_repository_id > 0),
  repository_full_name text not null
    check (repository_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  base_branch text not null
    check (pg_catalog.char_length(pg_catalog.btrim(base_branch)) between 1 and 255),
  head_sha text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'delivered')),
  lease_token uuid,
  lease_worker_id text,
  lease_expires_at timestamptz,
  delivery_attempts integer not null default 0
    check (delivery_attempts between 0 and 8),
  delivered_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  constraint grok_graph_rewake_intents_id_scope_unique
    unique (id, organization_id),
  constraint grok_graph_rewake_intents_bridge_unique unique (bridge_id),
  constraint grok_graph_rewake_intents_command_unique unique (command_id),
  constraint grok_graph_rewake_intents_run_unique unique (phase1c_run_id),
  constraint grok_graph_rewake_intents_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_bridge_fk
    foreign key (bridge_id, organization_id)
    references public.graph_phase1c_bridges(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_run_fk
    foreign key (phase1c_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_command_fk
    foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_repository_fk
    foreign key (github_repository_id, organization_id)
    references public.github_repositories(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_connection_fk
    foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_installation_fk
    foreign key (internal_installation_id, organization_id)
    references public.github_installations(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_intents_state_evidence check (
    case state
      when 'pending' then
        lease_token is null and lease_worker_id is null
        and lease_expires_at is null and delivered_at is null
      when 'leased' then
        lease_token is not null and lease_worker_id is not null
        and lease_expires_at is not null and delivered_at is null
      when 'delivered' then
        lease_token is null and lease_worker_id is null
        and lease_expires_at is null and delivered_at is not null
      else false
    end
  ),
  constraint grok_graph_rewake_intents_worker_shape check (
    lease_worker_id is null
    or lease_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
  ),
  constraint grok_graph_rewake_intents_time_order check (
    updated_at >= created_at and (delivered_at is null or delivered_at >= created_at)
  ),
  constraint grok_graph_rewake_intents_safe_text check (
    not public.text_has_likely_secret(repository_full_name)
    and not public.text_has_likely_secret(base_branch)
  )
);

create index grok_graph_rewake_intents_pending_idx
  on public.grok_graph_rewake_intents (state, created_at, id)
  where state <> 'delivered';
create index grok_graph_rewake_intents_graph_idx
  on public.grok_graph_rewake_intents (organization_id, graph_id, created_at);

create table public.grok_graph_rewake_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  intent_id uuid not null,
  graph_id uuid not null,
  bridge_id uuid not null,
  phase1c_run_id uuid not null,
  command_id uuid not null,
  worker_id text not null
    check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  attempt_number integer not null check (attempt_number between 1 and 8),
  outcome text not null check (outcome in ('accepted', 'failed', 'worker_disabled')),
  failure_code text check (
    failure_code is null
    or failure_code ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  occurred_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),

  constraint grok_graph_rewake_attempts_intent_unique
    unique (intent_id, attempt_number),
  constraint grok_graph_rewake_attempts_accepted_once
    exclude using btree (intent_id with =)
    where (outcome = 'accepted'),
  constraint grok_graph_rewake_attempts_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_attempts_intent_fk
    foreign key (intent_id, organization_id)
    references public.grok_graph_rewake_intents(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_attempts_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_attempts_bridge_fk
    foreign key (bridge_id, organization_id)
    references public.graph_phase1c_bridges(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_attempts_run_fk
    foreign key (phase1c_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_attempts_command_fk
    foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete restrict,
  constraint grok_graph_rewake_attempts_outcome_evidence check (
    (outcome = 'accepted' and failure_code is null)
    or (outcome <> 'accepted' and failure_code is not null)
  )
);

create index grok_graph_rewake_attempts_intent_idx
  on public.grok_graph_rewake_attempts (intent_id, attempt_number);

alter table public.grok_graph_rewake_intents enable row level security;
alter table public.grok_graph_rewake_intents force row level security;
alter table public.grok_graph_rewake_attempts enable row level security;
alter table public.grok_graph_rewake_attempts force row level security;

revoke all on table public.grok_graph_rewake_intents
  from public, anon, authenticated, service_role;
revoke all on table public.grok_graph_rewake_attempts
  from public, anon, authenticated, service_role;

create policy grok_graph_rewake_intents_owner_select
  on public.grok_graph_rewake_intents
  for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['owner'::public.organization_member_role]
  ));
create policy grok_graph_rewake_attempts_owner_select
  on public.grok_graph_rewake_attempts
  for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['owner'::public.organization_member_role]
  ));

grant select on table public.grok_graph_rewake_intents to authenticated;
grant select on table public.grok_graph_rewake_attempts to authenticated;

create function public.reject_grok_graph_rewake_attempt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000',
    message = 'grok graph re-wake attempts are append-only';
end;
$function$;

revoke all on function public.reject_grok_graph_rewake_attempt_mutation()
  from public, anon, authenticated, service_role;

create trigger grok_graph_rewake_attempts_append_only
  before update or delete on public.grok_graph_rewake_attempts
  for each row execute function public.reject_grok_graph_rewake_attempt_mutation();
create trigger grok_graph_rewake_attempts_no_truncate
  before truncate on public.grok_graph_rewake_attempts
  for each statement execute function public.reject_grok_graph_rewake_attempt_mutation();

create function public.enforce_grok_graph_rewake_intent_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake intents cannot be deleted';
  end if;

  if new.organization_id is distinct from old.organization_id
      or new.project_id is distinct from old.project_id
      or new.graph_id is distinct from old.graph_id
      or new.bridge_id is distinct from old.bridge_id
      or new.phase1c_run_id is distinct from old.phase1c_run_id
      or new.command_id is distinct from old.command_id
      or new.github_repository_id is distinct from old.github_repository_id
      or new.connection_id is distinct from old.connection_id
      or new.internal_installation_id is distinct from old.internal_installation_id
      or new.external_installation_id is distinct from old.external_installation_id
      or new.app_id is distinct from old.app_id
      or new.external_repository_id is distinct from old.external_repository_id
      or new.repository_full_name is distinct from old.repository_full_name
      or new.base_branch is distinct from old.base_branch
      or new.head_sha is distinct from old.head_sha
      or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake identity is immutable';
  end if;

  if old.state = 'pending' and new.state = 'leased' then
    if new.delivery_attempts is distinct from old.delivery_attempts
      or new.lease_token is null or new.lease_worker_id is null
      or new.lease_expires_at <= pg_catalog.now()
    then
      raise exception using errcode = '55000',
        message = 'invalid grok graph re-wake lease transition';
    end if;
  elsif old.state = 'leased' and new.state = 'leased' then
    if old.lease_expires_at > pg_catalog.now()
      or new.delivery_attempts is distinct from old.delivery_attempts
      or new.lease_token is null or new.lease_worker_id is null
      or new.lease_expires_at <= pg_catalog.now()
    then
      raise exception using errcode = '55000',
        message = 'active grok graph re-wake lease cannot be replaced';
    end if;
  elsif old.state = 'leased' and new.state in ('pending', 'delivered') then
    if new.delivery_attempts is distinct from old.delivery_attempts + 1
      or new.lease_token is not null or new.lease_worker_id is not null
      or new.lease_expires_at is not null
      or (new.state = 'pending' and new.delivered_at is not null)
      or (new.state = 'delivered' and new.delivered_at is null)
    then
      raise exception using errcode = '55000',
        message = 'invalid grok graph re-wake delivery transition';
    end if;
  else
    raise exception using errcode = '55000',
      message = 'invalid grok graph re-wake state transition';
  end if;

  if new.updated_at < old.updated_at then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake time cannot move backwards';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_grok_graph_rewake_intent_transition()
  from public, anon, authenticated, service_role;

create trigger grok_graph_rewake_intents_transition
  before update or delete on public.grok_graph_rewake_intents
  for each row execute function public.enforce_grok_graph_rewake_intent_transition();
create trigger grok_graph_rewake_intents_no_truncate
  before truncate on public.grok_graph_rewake_intents
  for each statement execute function public.reject_grok_graph_rewake_attempt_mutation();

create function public.assert_current_grok_graph_rewake_intent(
  p_intent public.grok_graph_rewake_intents
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph public.graphs;
  v_bridge public.graph_phase1c_bridges;
  v_run public.agent_runs;
  v_pull_request public.pull_requests;
  v_target record;
begin
  select graph.* into v_graph
    from public.graphs graph
   where graph.id = p_intent.graph_id
     and graph.organization_id = p_intent.organization_id
     and graph.project_id = p_intent.project_id;
  if not found
      or not v_graph.is_lifecycle
      or v_graph.template_key is distinct from 'full_lifecycle'
      or v_graph.template_version is distinct from 2
      or v_graph.github_repository_id is distinct from p_intent.github_repository_id
      or v_graph.base_branch is distinct from p_intent.base_branch
      or v_graph.withdrawn_at is not null
      or v_graph.pause_requested_at is not null
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake graph identity is stale or stopped';
  end if;

  if not exists (
    select 1
      from public.grok_graph_launches launch
      join public.grok_sessions session
        on session.id = launch.session_id
       and session.organization_id = launch.organization_id
       and session.project_id = launch.project_id
     where launch.graph_id = v_graph.id
       and launch.organization_id = v_graph.organization_id
       and launch.project_id = v_graph.project_id
       and session.status = 'active'
       and session.closed_at is null
  ) or not public.assert_current_grok_execution_admissions(v_graph.id) then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake admission is missing or stale';
  end if;

  select bridge.* into v_bridge
    from public.graph_phase1c_bridges bridge
   where bridge.id = p_intent.bridge_id
     and bridge.organization_id = p_intent.organization_id
     and bridge.project_id = p_intent.project_id
     and bridge.graph_id = p_intent.graph_id;
  if not found
      or public.graph_phase1c_bridge_state_rank(v_bridge.state) <
        public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED')
      or v_bridge.agent_run_id is distinct from p_intent.phase1c_run_id
      or v_bridge.command_id is distinct from p_intent.command_id
      or v_bridge.head_sha is distinct from p_intent.head_sha
      or v_bridge.pull_request_id is null
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake bridge identity is stale';
  end if;

  select run.* into v_run
    from public.agent_runs run
   where run.id = p_intent.phase1c_run_id
     and run.organization_id = p_intent.organization_id
     and run.project_id = p_intent.project_id
     and run.command_id = p_intent.command_id;
  if not found
      or v_run.status is distinct from 'succeeded'::public.run_status
      or v_run.completed_at is null
      or v_run.github_repository_id is distinct from p_intent.github_repository_id
      or v_run.connection_id is distinct from p_intent.connection_id
      or v_run.base_branch is distinct from p_intent.base_branch
      or v_run.head_sha is distinct from p_intent.head_sha
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake Phase 1C run identity is stale';
  end if;

  select pull_request.* into v_pull_request
    from public.pull_requests pull_request
   where pull_request.id = v_bridge.pull_request_id
     and pull_request.organization_id = p_intent.organization_id
     and pull_request.project_id = p_intent.project_id
     and pull_request.agent_run_id = p_intent.phase1c_run_id;
  if not found
      or v_pull_request.status not in (
        'draft'::public.pull_request_status,
        'open'::public.pull_request_status,
        'approved'::public.pull_request_status,
        'merged'::public.pull_request_status
      )
      or v_pull_request.head_sha is distinct from p_intent.head_sha
      or v_pull_request.base_branch is distinct from p_intent.base_branch
      or pg_catalog.lower(v_pull_request.repository) is distinct from
        pg_catalog.lower(p_intent.repository_full_name)
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake pull request identity is stale';
  end if;

  select connection.id as connection_id,
         repository.id as repository_id,
         installation.id as internal_installation_id,
         installation.external_installation_id,
         installation.app_id,
         repository.external_repository_id,
         repository.full_name as repository_full_name,
         repository.default_branch as base_branch
    into v_target
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
   where project.id = p_intent.project_id
     and project.organization_id = p_intent.organization_id
     and project.status = 'active'::public.project_status
     and project.github_repository = repository.full_name
     and project.default_branch = repository.default_branch
     and connection.provider = 'github'::public.connection_provider
     and connection.status = 'connected'::public.connection_status
     and installation.status = 'active'
     and installation.suspended_at is null
     and repository.selected
     and not repository.archived
     and not repository.disabled;
  if not found
      or v_target.connection_id is distinct from p_intent.connection_id
      or v_target.repository_id is distinct from p_intent.github_repository_id
      or v_target.internal_installation_id is distinct from p_intent.internal_installation_id
      or v_target.external_installation_id is distinct from p_intent.external_installation_id
      or v_target.app_id is distinct from p_intent.app_id
      or v_target.external_repository_id is distinct from p_intent.external_repository_id
      or v_target.repository_full_name is distinct from p_intent.repository_full_name
      or v_target.base_branch is distinct from p_intent.base_branch
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake repository binding is stale';
  end if;

  return true;
end;
$function$;

revoke all on function public.assert_current_grok_graph_rewake_intent(
  public.grok_graph_rewake_intents
) from public, anon, authenticated, service_role;

create function public.enqueue_grok_graph_rewake_after_phase1c()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph public.graphs;
  v_run public.agent_runs;
  v_target record;
  v_intent public.grok_graph_rewake_intents;
begin
  if old.state = new.state
      or new.state <> 'PULL_REQUEST_RECORDED'
      or old.state <> 'PHASE1C_BOUND'
  then
    return new;
  end if;

  -- Non-Grok lifecycle bridges retain the existing behavior unchanged.
  if not exists (
    select 1 from public.grok_graph_launches launch
     where launch.graph_id = new.graph_id
       and launch.organization_id = new.organization_id
       and launch.project_id = new.project_id
  ) then
    return new;
  end if;

  if not public.assert_current_grok_execution_admissions(new.graph_id) then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake requires current execution admissions';
  end if;

  select graph.* into v_graph
    from public.graphs graph
   where graph.id = new.graph_id
     and graph.organization_id = new.organization_id
     and graph.project_id = new.project_id;
  select run.* into v_run
    from public.agent_runs run
   where run.id = new.agent_run_id
     and run.organization_id = new.organization_id
     and run.project_id = new.project_id
     and run.command_id = new.command_id;
  if not found
      or v_graph.id is null
      or not v_graph.is_lifecycle
      or v_graph.template_key is distinct from 'full_lifecycle'
      or v_graph.template_version is distinct from 2
      or v_graph.github_repository_id is null
      or v_graph.base_branch is null
      or v_graph.withdrawn_at is not null
      or v_graph.pause_requested_at is not null
      or v_run.status is distinct from 'succeeded'::public.run_status
      or v_run.completed_at is null
      or v_run.github_repository_id is distinct from v_graph.github_repository_id
      or v_run.base_branch is distinct from v_graph.base_branch
      or v_run.base_sha is distinct from v_graph.base_sha
      or v_run.head_sha is distinct from new.head_sha
  then
    raise exception using errcode = '55000',
      message = 'grok Phase 1C completion does not match a resumable exact graph';
  end if;

  select connection.id as connection_id,
         repository.id as repository_id,
         installation.id as internal_installation_id,
         installation.external_installation_id,
         installation.app_id,
         repository.external_repository_id,
         repository.full_name as repository_full_name,
         repository.default_branch as base_branch
    into v_target
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
   where project.id = new.project_id
     and project.organization_id = new.organization_id
     and project.status = 'active'::public.project_status
     and project.github_repository = repository.full_name
     and project.default_branch = repository.default_branch
     and connection.provider = 'github'::public.connection_provider
     and connection.status = 'connected'::public.connection_status
     and installation.status = 'active'
     and installation.suspended_at is null
     and repository.id = v_graph.github_repository_id
     and repository.selected
     and not repository.archived
     and not repository.disabled;
  if not found or v_target.connection_id is distinct from v_run.connection_id then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake has no exact current repository target';
  end if;

  insert into public.grok_graph_rewake_intents (
    organization_id, project_id, graph_id, bridge_id, phase1c_run_id,
    command_id, github_repository_id, connection_id,
    internal_installation_id, external_installation_id, app_id,
    external_repository_id, repository_full_name, base_branch, head_sha
  ) values (
    new.organization_id, new.project_id, new.graph_id, new.id,
    new.agent_run_id, new.command_id, v_graph.github_repository_id,
    v_target.connection_id, v_target.internal_installation_id,
    v_target.external_installation_id, v_target.app_id,
    v_target.external_repository_id, v_target.repository_full_name,
    v_target.base_branch, new.head_sha
  )
  on conflict on constraint grok_graph_rewake_intents_bridge_unique do nothing;

  select intent.* into v_intent
    from public.grok_graph_rewake_intents intent
   where intent.bridge_id = new.id;
  if not found
      or v_intent.organization_id is distinct from new.organization_id
      or v_intent.project_id is distinct from new.project_id
      or v_intent.graph_id is distinct from new.graph_id
      or v_intent.phase1c_run_id is distinct from new.agent_run_id
      or v_intent.command_id is distinct from new.command_id
      or v_intent.head_sha is distinct from new.head_sha
      or not public.assert_current_grok_graph_rewake_intent(v_intent)
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake replay conflicts with exact identity';
  end if;

  return new;
end;
$function$;

revoke all on function public.enqueue_grok_graph_rewake_after_phase1c()
  from public, anon, authenticated, service_role;

create trigger graph_phase1c_bridge_enqueue_grok_rewake
  after update of state on public.graph_phase1c_bridges
  for each row execute function public.enqueue_grok_graph_rewake_after_phase1c();

create function public.claim_grok_graph_rewake_as_worker(
  p_worker_id text,
  p_command_id uuid,
  p_lease_seconds integer default 120
)
returns table (
  intent_id uuid,
  lease_token uuid,
  organization_id uuid,
  project_id uuid,
  graph_id uuid,
  bridge_id uuid,
  phase1c_run_id uuid,
  command_id uuid,
  github_repository_id uuid,
  connection_id uuid,
  internal_installation_id uuid,
  external_installation_id bigint,
  app_id bigint,
  external_repository_id bigint,
  repository_full_name text,
  base_branch text,
  head_sha text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_worker public.phase1c_workers;
  v_intent public.grok_graph_rewake_intents;
  v_lease uuid := gen_random_uuid();
begin
  if p_worker_id is null
      or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
      or p_command_id is null
      or p_lease_seconds not between 30 and 300
  then
    raise exception using errcode = '22023',
      message = 'bounded exact grok graph re-wake claim is required';
  end if;

  select worker.* into v_worker
    from public.phase1c_workers worker
   where worker.worker_id = p_worker_id
   for update;
  if not found
      or v_worker.status not in ('active', 'idle')
      or v_worker.current_run_id is not null
      or v_worker.last_heartbeat_at > pg_catalog.now() + interval '1 minute'
      or (
        (v_worker.status = 'active'
          and v_worker.last_heartbeat_at <= pg_catalog.now() - interval '5 minutes')
        or (v_worker.status = 'idle'
          and v_worker.last_heartbeat_at <= pg_catalog.now() - interval '10 minutes')
      )
  then
    raise exception using errcode = '42501',
      message = 'a fresh non-disabled idle Phase 1C worker is required for graph re-wake';
  end if;

  select intent.* into v_intent
    from public.grok_graph_rewake_intents intent
   where intent.command_id = p_command_id
   for update;
  if not found or v_intent.state = 'delivered' then
    return;
  end if;
  if v_intent.delivery_attempts >= 8 then
    raise exception using errcode = '54000',
      message = 'grok graph re-wake delivery budget is exhausted';
  end if;
  if v_intent.state = 'leased' and v_intent.lease_expires_at > pg_catalog.now() then
    raise exception using errcode = '55P03',
      message = 'grok graph re-wake is already leased';
  end if;
  perform public.assert_current_grok_graph_rewake_intent(v_intent);

  update public.grok_graph_rewake_intents
     set state = 'leased',
         lease_token = v_lease,
         lease_worker_id = p_worker_id,
         lease_expires_at = pg_catalog.now()
           + pg_catalog.make_interval(secs => p_lease_seconds),
         updated_at = pg_catalog.now()
   where id = v_intent.id
     and organization_id = v_intent.organization_id
  returning * into v_intent;

  return query select
    v_intent.id, v_intent.lease_token, v_intent.organization_id,
    v_intent.project_id, v_intent.graph_id, v_intent.bridge_id,
    v_intent.phase1c_run_id, v_intent.command_id,
    v_intent.github_repository_id, v_intent.connection_id,
    v_intent.internal_installation_id, v_intent.external_installation_id,
    v_intent.app_id, v_intent.external_repository_id,
    v_intent.repository_full_name, v_intent.base_branch, v_intent.head_sha;
end;
$function$;

revoke all on function public.claim_grok_graph_rewake_as_worker(
  text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_grok_graph_rewake_as_worker(
  text, uuid, integer
) to service_role;

create function public.record_grok_graph_rewake_delivery_as_worker(
  p_worker_id text,
  p_intent_id uuid,
  p_lease_token uuid,
  p_graph_id uuid,
  p_bridge_id uuid,
  p_phase1c_run_id uuid,
  p_command_id uuid,
  p_accepted boolean,
  p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_worker public.phase1c_workers;
  v_intent public.grok_graph_rewake_intents;
  v_outcome text;
  v_failure_code text;
begin
  if p_worker_id is null
      or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
      or p_intent_id is null or p_lease_token is null
      or p_graph_id is null or p_bridge_id is null
      or p_phase1c_run_id is null or p_command_id is null
      or p_accepted is null
  then
    raise exception using errcode = '22023',
      message = 'exact grok graph re-wake delivery evidence is required';
  end if;
  v_failure_code := nullif(pg_catalog.btrim(p_failure_code), '');
  if (p_accepted and v_failure_code is not null)
      or (not p_accepted and (
        v_failure_code is null
        or v_failure_code !~ '^[a-z][a-z0-9_]{1,62}$'
      ))
  then
    raise exception using errcode = '22023',
      message = 'grok graph re-wake outcome evidence is inconsistent';
  end if;

  select worker.* into v_worker
    from public.phase1c_workers worker
   where worker.worker_id = p_worker_id;
  if not found
      or v_worker.status not in ('active', 'idle')
      or v_worker.current_run_id is not null
      or v_worker.last_heartbeat_at > pg_catalog.now() + interval '1 minute'
      or (
        (v_worker.status = 'active'
          and v_worker.last_heartbeat_at <= pg_catalog.now() - interval '5 minutes')
        or (v_worker.status = 'idle'
          and v_worker.last_heartbeat_at <= pg_catalog.now() - interval '10 minutes')
      )
  then
    raise exception using errcode = '42501',
      message = 'a fresh non-disabled idle Phase 1C worker is required for graph re-wake';
  end if;

  select intent.* into v_intent
    from public.grok_graph_rewake_intents intent
   where intent.id = p_intent_id
     and intent.graph_id = p_graph_id
     and intent.bridge_id = p_bridge_id
     and intent.phase1c_run_id = p_phase1c_run_id
     and intent.command_id = p_command_id
   for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'grok graph re-wake delivery identity mismatch';
  end if;

  if v_intent.state = 'delivered' then
    if p_accepted then return true; end if;
    raise exception using errcode = '55000',
      message = 'delivered grok graph re-wake cannot become failed';
  end if;
  if v_intent.state <> 'leased'
      or v_intent.lease_worker_id is distinct from p_worker_id
      or v_intent.lease_token is distinct from p_lease_token
      or v_intent.lease_expires_at <= pg_catalog.now()
  then
    raise exception using errcode = '42501',
      message = 'active exact grok graph re-wake lease required';
  end if;
  perform public.assert_current_grok_graph_rewake_intent(v_intent);

  v_outcome := case
    when p_accepted then 'accepted'
    when v_failure_code = 'worker_disabled' then 'worker_disabled'
    else 'failed'
  end;
  insert into public.grok_graph_rewake_attempts (
    organization_id, project_id, intent_id, graph_id, bridge_id,
    phase1c_run_id, command_id, worker_id, attempt_number, outcome,
    failure_code
  ) values (
    v_intent.organization_id, v_intent.project_id, v_intent.id,
    v_intent.graph_id, v_intent.bridge_id, v_intent.phase1c_run_id,
    v_intent.command_id, p_worker_id, v_intent.delivery_attempts + 1,
    v_outcome, v_failure_code
  );

  update public.grok_graph_rewake_intents
     set state = case when p_accepted then 'delivered' else 'pending' end,
         lease_token = null,
         lease_worker_id = null,
         lease_expires_at = null,
         delivery_attempts = delivery_attempts + 1,
         delivered_at = case when p_accepted then pg_catalog.now() end,
         updated_at = pg_catalog.now()
   where id = v_intent.id
     and organization_id = v_intent.organization_id;
  return p_accepted;
end;
$function$;

revoke all on function public.record_grok_graph_rewake_delivery_as_worker(
  text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_graph_rewake_delivery_as_worker(
  text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text
) to service_role;

comment on table public.grok_graph_rewake_intents is
  'One durable, exact-identity graph-worker wake requested by an admitted Grok Phase 1C PULL_REQUEST_RECORDED transition. The row grants no execution authority.';
comment on table public.grok_graph_rewake_attempts is
  'grok_graph_rewake_attempts are append-only accepted/failed delivery evidence for an exact Grok graph re-wake intent; payload content and credentials are never stored.';
comment on function public.claim_grok_graph_rewake_as_worker(text, uuid, integer) is
  'Leases only the exact command-bound admitted Grok graph re-wake for a fresh non-disabled Phase 1C worker and returns its current verified GitHub target.';
comment on function public.record_grok_graph_rewake_delivery_as_worker(
  text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text
) is
  'Records an idempotent exact-identity graph re-wake delivery result; accepted delivery is terminal and failed delivery returns the intent to pending.';

do $postflight$
declare
  v_count integer;
begin
  select pg_catalog.count(*)::integer into v_count
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace space on space.oid = relation.relnamespace
   where space.nspname = 'public'
     and relation.relname in (
       'grok_graph_rewake_intents', 'grok_graph_rewake_attempts'
     )
     and relation.relkind = 'r'
     and relation.relrowsecurity
     and relation.relforcerowsecurity;
  if v_count <> 2 then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake tables are not forced-RLS exact';
  end if;

  select pg_catalog.count(*)::integer into v_count
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace space on space.oid = routine.pronamespace
   where space.nspname = 'public'
     and routine.proname in (
       'assert_current_grok_graph_rewake_intent',
       'enqueue_grok_graph_rewake_after_phase1c',
       'claim_grok_graph_rewake_as_worker',
       'record_grok_graph_rewake_delivery_as_worker'
     )
     and routine.prosecdef
     and routine.proconfig = array['search_path=pg_catalog'];
  if v_count <> 4 then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake definer catalog is incomplete';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_record
     where trigger_record.tgrelid = 'public.graph_phase1c_bridges'::pg_catalog.regclass
       and trigger_record.tgname = 'graph_phase1c_bridge_enqueue_grok_rewake'
       and not trigger_record.tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger trigger_record
     where trigger_record.tgrelid = 'public.grok_graph_rewake_attempts'::pg_catalog.regclass
       and trigger_record.tgname = 'grok_graph_rewake_attempts_append_only'
       and not trigger_record.tgisinternal
  ) then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake trigger catalog is incomplete';
  end if;

  if not has_function_privilege(
      'service_role',
      'public.claim_grok_graph_rewake_as_worker(text,uuid,integer)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.record_grok_graph_rewake_delivery_as_worker(text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake worker ACL is incomplete';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.claim_grok_graph_rewake_as_worker(text,uuid,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.claim_grok_graph_rewake_as_worker(text,uuid,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.record_grok_graph_rewake_delivery_as_worker(text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.record_grok_graph_rewake_delivery_as_worker(text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode = '55000',
      message = 'grok graph re-wake worker ACL leaked to a browser role';
  end if;
end;
$postflight$;
