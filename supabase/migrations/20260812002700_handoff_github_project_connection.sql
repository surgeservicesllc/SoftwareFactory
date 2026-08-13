-- Atomically move an existing project between two live installations of the
-- same GitHub account and repository. This preserves the project UUID and all
-- historical provider evidence while keeping the prior installation available
-- for an explicit reverse handoff during the observation window.

create table public.github_project_handoff_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  from_connection_id uuid not null,
  from_external_installation_id bigint not null check (from_external_installation_id > 0),
  to_connection_id uuid not null,
  to_external_installation_id bigint not null check (to_external_installation_id > 0),
  external_repository_id bigint not null check (external_repository_id > 0),
  risk_classification public.risk_level not null default 'red'::public.risk_level
    check (risk_classification = 'red'::public.risk_level),
  confirmation_text text not null check (confirmation_text = 'HANDOFF GITHUB PROJECT'),
  rationale text not null check (
    char_length(rationale) between 20 and 500
    and rationale = btrim(rationale)
    and not public.text_has_likely_secret(rationale)
  ),
  rollback_plan text not null check (
    char_length(rollback_plan) between 20 and 500
    and rollback_plan = btrim(rollback_plan)
    and not public.text_has_likely_secret(rollback_plan)
  ),
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  approver_user_id uuid not null references auth.users(id) on delete restrict,
  executor_user_id uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null,
  decided_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint github_project_handoff_approvals_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint github_project_handoff_approvals_from_connection_fk
    foreign key (from_connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint github_project_handoff_approvals_to_connection_fk
    foreign key (to_connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint github_project_handoff_approvals_distinct_connections
    check (from_connection_id <> to_connection_id),
  constraint github_project_handoff_approvals_distinct_installations
    check (from_external_installation_id <> to_external_installation_id),
  constraint github_project_handoff_approvals_same_owner
    check (requester_user_id = approver_user_id and approver_user_id = executor_user_id),
  constraint github_project_handoff_approvals_timing check (
    decided_at >= requested_at
    and expires_at > decided_at
    and expires_at <= requested_at + interval '15 minutes'
  )
);

create index github_project_handoff_approvals_org_time_idx
  on public.github_project_handoff_approvals (organization_id, requested_at desc);

create or replace function public.reject_github_project_handoff_approval_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $function$
begin
  raise exception using errcode = '55000', message = 'GitHub project handoff approvals are immutable';
end;
$function$;

revoke all on function public.reject_github_project_handoff_approval_mutation()
  from public, anon, authenticated, service_role;

create trigger github_project_handoff_approvals_append_only
before update or delete on public.github_project_handoff_approvals
for each row execute function public.reject_github_project_handoff_approval_mutation();

alter table public.github_project_handoff_approvals enable row level security;
alter table public.github_project_handoff_approvals force row level security;
create policy github_project_handoff_approvals_select_owners
  on public.github_project_handoff_approvals for select to authenticated
  using (public.is_organization_owner(organization_id));
revoke all on table public.github_project_handoff_approvals
  from public, anon, authenticated, service_role;
grant select on table public.github_project_handoff_approvals to authenticated;

create table public.github_project_handoff_executions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.github_project_handoff_approvals(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  executor_user_id uuid not null references auth.users(id) on delete restrict,
  outcome text not null check (outcome = 'succeeded'),
  executed_at timestamptz not null default now(),
  constraint github_project_handoff_executions_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict
);

create or replace function public.reject_github_project_handoff_execution_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $function$
begin
  raise exception using errcode = '55000', message = 'GitHub project handoff executions are immutable';
end;
$function$;
revoke all on function public.reject_github_project_handoff_execution_mutation()
  from public, anon, authenticated, service_role;
create trigger github_project_handoff_executions_append_only
before update or delete on public.github_project_handoff_executions
for each row execute function public.reject_github_project_handoff_execution_mutation();
alter table public.github_project_handoff_executions enable row level security;
alter table public.github_project_handoff_executions force row level security;
create policy github_project_handoff_executions_select_owners
  on public.github_project_handoff_executions for select to authenticated
  using (public.is_organization_owner(organization_id));
revoke all on table public.github_project_handoff_executions
  from public, anon, authenticated, service_role;
grant select on table public.github_project_handoff_executions to authenticated;

create or replace function public.normalize_github_connection_secret_reference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update public.connections connection
  set secret_reference = 'env://GITHUB_APP_CONFIGURATIONS',
      updated_at = statement_timestamp()
  where connection.id = new.connection_id
    and connection.organization_id = new.organization_id
    and connection.provider = 'github'::public.connection_provider
    and connection.secret_reference is distinct from 'env://GITHUB_APP_CONFIGURATIONS';
  return new;
end;
$function$;

revoke all on function public.normalize_github_connection_secret_reference()
  from public, anon, authenticated, service_role;

create trigger github_installations_normalize_secret_reference
after insert or update of app_id, connection_id on public.github_installations
for each row execute function public.normalize_github_connection_secret_reference();

update public.connections connection
set secret_reference = 'env://GITHUB_APP_CONFIGURATIONS',
    updated_at = statement_timestamp()
where connection.provider = 'github'::public.connection_provider
  and connection.secret_reference is distinct from 'env://GITHUB_APP_CONFIGURATIONS';

create or replace function public.approve_github_project_connection_handoff(
  p_organization_id uuid,
  p_project_id uuid,
  p_from_connection_id uuid,
  p_from_external_installation_id bigint,
  p_to_connection_id uuid,
  p_to_external_installation_id bigint,
  p_external_repository_id bigint,
  p_confirmation_text text,
  p_rationale text,
  p_rollback_plan text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  approval_id uuid;
  requested_at timestamptz := statement_timestamp();
begin
  if caller_id is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = caller_id
      and member.role = 'owner'::public.organization_member_role
  ) then
    raise exception using errcode = '42501', message = 'an active organization owner must authorize the GitHub installation handoff';
  end if;
  if p_confirmation_text is distinct from 'HANDOFF GITHUB PROJECT'
    or p_from_connection_id is null or p_to_connection_id is null
    or p_from_connection_id = p_to_connection_id
    or p_from_external_installation_id is null or p_from_external_installation_id <= 0
    or p_to_external_installation_id is null or p_to_external_installation_id <= 0
    or p_from_external_installation_id = p_to_external_installation_id
    or p_external_repository_id is null or p_external_repository_id <= 0
    or char_length(btrim(coalesce(p_rationale, ''))) not between 20 and 500
    or char_length(btrim(coalesce(p_rollback_plan, ''))) not between 20 and 500
    or public.text_has_likely_secret(p_rationale)
    or public.text_has_likely_secret(p_rollback_plan) then
    raise exception using errcode = '22023', message = 'GitHub handoff RED approval evidence is invalid';
  end if;
  if not exists (
    select 1
    from public.projects project
    join public.project_connections link
      on link.project_id = project.id
     and link.organization_id = project.organization_id
     and link.is_primary
    join public.github_repositories source_repository
      on source_repository.id = link.github_repository_id
     and source_repository.organization_id = link.organization_id
    join public.github_installations source_installation
      on source_installation.id = source_repository.installation_id
     and source_installation.organization_id = source_repository.organization_id
    join public.github_installations target_installation
      on target_installation.organization_id = project.organization_id
     and target_installation.connection_id = p_to_connection_id
     and target_installation.external_installation_id = p_to_external_installation_id
    join public.github_repositories target_repository
      on target_repository.installation_id = target_installation.id
     and target_repository.organization_id = target_installation.organization_id
     and target_repository.external_repository_id = p_external_repository_id
    where project.id = p_project_id
      and project.organization_id = p_organization_id
      and project.status <> 'archived'::public.project_status
      and link.connection_id = p_from_connection_id
      and source_installation.external_installation_id = p_from_external_installation_id
      and source_repository.external_repository_id = p_external_repository_id
      and source_installation.account_id = target_installation.account_id
      and pg_catalog.lower(source_installation.account_login)
        = pg_catalog.lower(target_installation.account_login)
  ) then
    raise exception using errcode = 'P0002', message = 'exact GitHub handoff target was not found';
  end if;

  insert into public.github_project_handoff_approvals (
    organization_id, project_id, from_connection_id,
    from_external_installation_id, to_connection_id,
    to_external_installation_id, external_repository_id, confirmation_text,
    rationale, rollback_plan, requester_user_id, approver_user_id,
    executor_user_id, requested_at, decided_at, expires_at
  ) values (
    p_organization_id, p_project_id, p_from_connection_id,
    p_from_external_installation_id, p_to_connection_id,
    p_to_external_installation_id, p_external_repository_id, p_confirmation_text,
    btrim(p_rationale), btrim(p_rollback_plan), caller_id, caller_id, caller_id,
    requested_at, requested_at, requested_at + interval '15 minutes'
  ) returning id into approval_id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values
  (p_organization_id, p_project_id, caller_id, 'approval.requested'::public.activity_event_type,
   'github_project_handoff_approval', approval_id,
   'RED GitHub project handoff approval requested',
   pg_catalog.jsonb_build_object('risk_classification','red','action','github.project_connection_handoff',
     'from_connection_id',p_from_connection_id,'connection_id',p_to_connection_id,
     'external_repository_id',p_external_repository_id,'expires_at',requested_at + interval '15 minutes')),
  (p_organization_id, p_project_id, caller_id, 'approval.decided'::public.activity_event_type,
   'github_project_handoff_approval', approval_id,
   'RED GitHub project handoff approval approved',
   pg_catalog.jsonb_build_object('risk_classification','red','decision','approved',
     'action','github.project_connection_handoff','from_connection_id',p_from_connection_id,
     'connection_id',p_to_connection_id,'external_repository_id',p_external_repository_id,
     'expires_at',requested_at + interval '15 minutes'));
  return approval_id;
end;
$function$;

revoke all on function public.approve_github_project_connection_handoff(
  uuid, uuid, uuid, bigint, uuid, bigint, bigint, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.approve_github_project_connection_handoff(
  uuid, uuid, uuid, bigint, uuid, bigint, bigint, text, text, text
) to authenticated;

-- Dual-App overlap gives one external repository a distinct internal UUID in
-- each installation. Reassert project creation on the provider-stable external
-- id so the candidate cannot be added as a duplicate project before handoff.
create or replace function public.connect_github_project(
  p_organization_id uuid,
  p_connection_id uuid,
  p_external_repository_id bigint,
  p_name text,
  p_description text default null,
  p_default_branch text default null
)
returns table (
  project_id uuid,
  project_name text,
  github_repository text,
  default_branch text,
  project_status public.project_status,
  connection_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  repository_record record;
  created_project public.projects%rowtype;
  resolved_branch text;
  expected_branch text := nullif(btrim(coalesce(p_default_branch, '')), '');
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if p_external_repository_id is null or p_external_repository_id <= 0 then
    raise exception using errcode = '22023', message = 'GitHub repository id is invalid';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'project name is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-repository-project:'
        || p_organization_id::text || ':' || p_external_repository_id::text,
      0
    )
  );

  select
    repository.id,
    repository.full_name,
    repository.default_branch,
    installation.status as installation_status,
    installation.suspended_at,
    installation.deleted_at,
    repository.archived,
    repository.disabled,
    repository.selected
  into repository_record
  from public.github_repositories repository
  join public.github_installations installation
    on installation.id = repository.installation_id
   and installation.organization_id = repository.organization_id
  join public.connections connection
    on connection.id = installation.connection_id
   and connection.organization_id = installation.organization_id
  where repository.organization_id = p_organization_id
    and installation.connection_id = p_connection_id
    and repository.external_repository_id = p_external_repository_id
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status;

  if not found then
    raise exception using errcode = 'P0002', message = 'selected GitHub repository was not found';
  end if;
  if repository_record.installation_status <> 'active'
    or repository_record.suspended_at is not null
    or repository_record.deleted_at is not null
    or not repository_record.selected
    or repository_record.archived
    or repository_record.disabled then
    raise exception using errcode = '55000', message = 'selected GitHub repository is not available';
  end if;

  if exists (
    select 1
    from public.project_connections link
    join public.projects project
      on project.id = link.project_id
     and project.organization_id = link.organization_id
    join public.github_repositories linked_repository
      on linked_repository.id = link.github_repository_id
     and linked_repository.organization_id = link.organization_id
    where link.organization_id = p_organization_id
      and linked_repository.external_repository_id = p_external_repository_id
      and project.status <> 'archived'::public.project_status
  ) then
    raise exception using
      errcode = '23505',
      message = 'GitHub repository is already linked to a non-archived project';
  end if;

  if expected_branch is not null
    and expected_branch is distinct from repository_record.default_branch then
    raise exception using errcode = '40001', message = 'repository default branch changed; reload before connecting the project';
  end if;
  resolved_branch := repository_record.default_branch;
  if char_length(resolved_branch) not between 1 and 255 or resolved_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'synchronized repository default branch is invalid';
  end if;

  insert into public.projects (
    organization_id, name, description, status, github_repository,
    default_branch, created_by
  ) values (
    p_organization_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    'active'::public.project_status, repository_record.full_name,
    resolved_branch, caller_id
  ) returning * into created_project;

  insert into public.project_connections (
    organization_id, project_id, connection_id, github_repository_id,
    is_primary, created_by
  ) values (
    p_organization_id, created_project.id, p_connection_id,
    repository_record.id, true, caller_id
  );

  return query select created_project.id, created_project.name,
    created_project.github_repository, created_project.default_branch,
    created_project.status, p_connection_id;
end;
$function$;

revoke all on function public.connect_github_project(uuid, uuid, bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_github_project(uuid, uuid, bigint, text, text, text)
  to authenticated;

comment on function public.connect_github_project(uuid, uuid, bigint, text, text, text) is
  'Serializes project creation by tenant plus immutable external GitHub repository id across App installations, permits relinking only after archival, and persists synchronized provider metadata.';

-- Serialize change reservations with project handoffs. The reservation RPC's
-- application-level precheck can race a handoff; this trigger is the final
-- database boundary and therefore takes the same transaction lock before it
-- validates the exact project/connection/repository tuple.
create or replace function public.validate_github_change_repository_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-project-handoff:'
        || new.organization_id::text || ':' || new.project_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.project_connections link
    where link.organization_id = new.organization_id
      and link.project_id = new.project_id
      and link.connection_id = new.connection_id
      and link.github_repository_id = new.repository_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'GitHub change request repository is not bound to the project connection';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_github_change_repository_binding()
  from public, anon, authenticated, service_role;

create or replace function public.handoff_github_project_connection(
  p_organization_id uuid,
  p_project_id uuid,
  p_from_connection_id uuid,
  p_from_external_installation_id bigint,
  p_to_connection_id uuid,
  p_to_external_installation_id bigint,
  p_external_repository_id bigint,
  p_approval_id uuid
)
returns table (
  project_id uuid,
  connection_id uuid,
  github_repository_id uuid,
  previous_connection_id uuid,
  previous_github_repository_id uuid,
  github_repository text,
  default_branch text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  link_record public.project_connections%rowtype;
  source_context record;
  target_context record;
  source_repository record;
  target_repository record;
  candidate_repository_id uuid;
  primary_link_count integer;
  approval_record public.github_project_handoff_approvals%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = caller_id
      and member.role = 'owner'::public.organization_member_role
  ) then
    raise exception using
      errcode = '42501',
      message = 'an active organization owner must authorize the GitHub installation handoff';
  end if;
  if p_project_id is null
    or p_from_connection_id is null
    or p_to_connection_id is null
    or p_from_external_installation_id is null
    or p_from_external_installation_id <= 0
    or p_to_external_installation_id is null
    or p_to_external_installation_id <= 0
    or p_external_repository_id is null
    or p_external_repository_id <= 0 then
    raise exception using errcode = '22023', message = 'GitHub handoff identifiers are invalid';
  end if;
  if p_from_connection_id = p_to_connection_id
    or p_from_external_installation_id = p_to_external_installation_id then
    raise exception using
      errcode = '22023',
      message = 'GitHub handoff requires distinct source and target installations';
  end if;

  select approval.* into strict approval_record
  from public.github_project_handoff_approvals approval
  where approval.id = p_approval_id
    and approval.organization_id = p_organization_id
    and approval.project_id = p_project_id
    and approval.from_connection_id = p_from_connection_id
    and approval.from_external_installation_id = p_from_external_installation_id
    and approval.to_connection_id = p_to_connection_id
    and approval.to_external_installation_id = p_to_external_installation_id
    and approval.external_repository_id = p_external_repository_id
    and approval.requester_user_id = caller_id
    and approval.approver_user_id = caller_id
    and approval.executor_user_id = caller_id
    and approval.expires_at > statement_timestamp()
  for update;
  if exists (
    select 1 from public.github_project_handoff_executions execution
    where execution.approval_id = approval_record.id
  ) then
    raise exception using errcode = '55000', message = 'GitHub handoff approval was already executed';
  end if;

  -- One lock serializes the project's binding with new change reservations.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-project-handoff:'
        || p_organization_id::text || ':' || p_project_id::text,
      0
    )
  );

  select project.*
  into project_record
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project was not found';
  end if;
  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '55000', message = 'an archived project cannot change GitHub installations';
  end if;

  select count(*)::integer
  into primary_link_count
  from public.project_connections link
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and link.is_primary;
  if primary_link_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'project must have exactly one primary connection before handoff';
  end if;

  select link.*
  into strict link_record
  from public.project_connections link
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and link.is_primary
  for update;
  if link_record.connection_id is distinct from p_from_connection_id
    or link_record.github_repository_id is null then
    raise exception using
      errcode = '40001',
      message = 'project GitHub binding changed; reload before handoff';
  end if;

  -- Resolve the candidate repository UUID only to acquire the same stable lock
  -- used by connect_github_project. Every mutable field is re-read after locks.
  select repository.id
  into candidate_repository_id
  from public.github_repositories repository
  join public.github_installations installation
    on installation.id = repository.installation_id
   and installation.organization_id = repository.organization_id
  where repository.organization_id = p_organization_id
    and installation.connection_id = p_to_connection_id
    and installation.external_installation_id = p_to_external_installation_id
    and repository.external_repository_id = p_external_repository_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'target GitHub repository was not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-repository-project:'
        || p_organization_id::text || ':' || p_external_repository_id::text,
      0
    )
  );

  -- Match provider sync/disconnect lock order and use deterministic ordering for
  -- the two rows so a concurrent reverse operation cannot deadlock this one.
  perform provider_connection.id
  from public.connections provider_connection
  where provider_connection.organization_id = p_organization_id
    and provider_connection.id in (p_from_connection_id, p_to_connection_id)
  order by provider_connection.id
  for update;

  perform installation.id
  from public.github_installations installation
  where installation.organization_id = p_organization_id
    and installation.connection_id in (p_from_connection_id, p_to_connection_id)
  order by installation.id
  for update;

  perform repository.id
  from public.github_repositories repository
  where repository.organization_id = p_organization_id
    and repository.id in (link_record.github_repository_id, candidate_repository_id)
  order by repository.id
  for update;

  select
    provider_connection.id as connection_id,
    provider_connection.status as connection_status,
    installation.id as installation_id,
    installation.external_installation_id,
    installation.account_id,
    installation.account_login,
    installation.account_type,
    installation.target_type,
    installation.app_id,
    installation.last_synced_at,
    installation.status as installation_status,
    installation.suspended_at,
    installation.deleted_at
  into source_context
  from public.connections provider_connection
  join public.github_installations installation
    on installation.connection_id = provider_connection.id
   and installation.organization_id = provider_connection.organization_id
  where provider_connection.organization_id = p_organization_id
    and provider_connection.id = p_from_connection_id
    and provider_connection.provider = 'github'::public.connection_provider
    and installation.external_installation_id = p_from_external_installation_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'source GitHub installation was not found';
  end if;

  select
    provider_connection.id as connection_id,
    provider_connection.status as connection_status,
    installation.id as installation_id,
    installation.external_installation_id,
    installation.account_id,
    installation.account_login,
    installation.account_type,
    installation.target_type,
    installation.app_id,
    installation.last_synced_at,
    installation.status as installation_status,
    installation.suspended_at,
    installation.deleted_at
  into target_context
  from public.connections provider_connection
  join public.github_installations installation
    on installation.connection_id = provider_connection.id
   and installation.organization_id = provider_connection.organization_id
  where provider_connection.organization_id = p_organization_id
    and provider_connection.id = p_to_connection_id
    and provider_connection.provider = 'github'::public.connection_provider
    and installation.external_installation_id = p_to_external_installation_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'target GitHub installation was not found';
  end if;

  if source_context.connection_status <> 'connected'::public.connection_status
    or source_context.installation_status <> 'active'
    or source_context.suspended_at is not null
    or source_context.deleted_at is not null
    or target_context.connection_status <> 'connected'::public.connection_status
    or target_context.installation_status <> 'active'
    or target_context.suspended_at is not null
    or target_context.deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'both GitHub installations must be active and connected for handoff';
  end if;
  if source_context.account_id is distinct from target_context.account_id
    or pg_catalog.lower(source_context.account_login)
      is distinct from pg_catalog.lower(target_context.account_login)
    or source_context.account_type is distinct from target_context.account_type
    or source_context.target_type is distinct from target_context.target_type then
    raise exception using
      errcode = '23514',
      message = 'GitHub installations do not belong to the same provider account';
  end if;

  -- A configured target App is not sufficient evidence for first cutover.
  -- Require a recent, HMAC-verified delivery for the exact target installation
  -- and exact stored App identity after its latest provider synchronization.
  if not exists (
    select 1
    from public.github_webhook_deliveries delivery
    where delivery.organization_id = p_organization_id
      and delivery.connection_id = p_to_connection_id
      and delivery.installation_id = target_context.installation_id
      and delivery.external_installation_id = p_to_external_installation_id
      and delivery.status = 'processed'
      and delivery.processed_at is not null
      and delivery.processed_at >= target_context.last_synced_at
      and delivery.processed_at >= statement_timestamp() - interval '24 hours'
      and delivery.metadata ->> 'app_id' = target_context.app_id::text
  ) and not exists (
    -- A reverse handoff may restore the immediately verified prior binding
    -- even when that legacy App's webhook was the reason for replacement.
    -- The immutable first-handoff event is the authorization evidence; an
    -- arbitrary caller cannot insert or mutate Activity rows directly.
    select 1
    from public.activity_events event
    where event.organization_id = p_organization_id
      and event.project_id = p_project_id
      and event.event_type = 'connection.changed'::public.activity_event_type
      and event.entity_type = 'project_connection_handoff'
      and event.metadata ->> 'previous_connection_id' = p_to_connection_id::text
      and event.metadata ->> 'connection_id' = p_from_connection_id::text
      and event.metadata ->> 'history_preserved' = 'true'
  ) then
    raise exception using
      errcode = '55000',
      message = 'target GitHub installation must process a signed webhook before first handoff';
  end if;

  select
    repository.id,
    repository.external_repository_id,
    repository.full_name,
    repository.default_branch,
    repository.selected,
    repository.archived,
    repository.disabled
  into source_repository
  from public.github_repositories repository
  where repository.organization_id = p_organization_id
    and repository.installation_id = source_context.installation_id
    and repository.id = link_record.github_repository_id
    and repository.external_repository_id = p_external_repository_id;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'project is not bound to the expected source GitHub repository';
  end if;

  select
    repository.id,
    repository.external_repository_id,
    repository.full_name,
    repository.default_branch,
    repository.selected,
    repository.archived,
    repository.disabled
  into target_repository
  from public.github_repositories repository
  where repository.organization_id = p_organization_id
    and repository.installation_id = target_context.installation_id
    and repository.id = candidate_repository_id
    and repository.external_repository_id = p_external_repository_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'target GitHub repository changed during handoff';
  end if;

  if not source_repository.selected
    or source_repository.archived
    or source_repository.disabled
    or not target_repository.selected
    or target_repository.archived
    or target_repository.disabled then
    raise exception using
      errcode = '55000',
      message = 'source and target GitHub repositories must be selected and enabled for handoff';
  end if;
  if pg_catalog.lower(source_repository.full_name)
      is distinct from pg_catalog.lower(target_repository.full_name)
    or pg_catalog.lower(project_record.github_repository)
      is distinct from pg_catalog.lower(source_repository.full_name) then
    raise exception using
      errcode = '23514',
      message = 'GitHub handoff repository identity does not match the current project';
  end if;

  if exists (
    select 1
    from public.project_connections other_link
    where other_link.organization_id = p_organization_id
      and other_link.project_id = p_project_id
      and other_link.id <> link_record.id
      and (
        other_link.connection_id = p_to_connection_id
        or other_link.github_repository_id = target_repository.id
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'project already has a conflicting target GitHub connection';
  end if;
  if exists (
    select 1
    from public.project_connections other_link
    join public.github_repositories other_repository
      on other_repository.id = other_link.github_repository_id
     and other_repository.organization_id = other_link.organization_id
    join public.projects other_project
      on other_project.id = other_link.project_id
     and other_project.organization_id = other_link.organization_id
    where other_link.organization_id = p_organization_id
      and other_repository.external_repository_id = p_external_repository_id
      and other_project.id <> p_project_id
      and other_project.status <> 'archived'::public.project_status
  ) then
    raise exception using
      errcode = '23505',
      message = 'target GitHub repository is already linked to a non-archived project';
  end if;

  -- Do not invalidate or strand an exact provider intent already in progress.
  -- The shared advisory lock prevents a new reservation from passing its final
  -- trigger validation until this handoff commits or rolls back.
  if exists (
    select 1
    from public.github_change_requests request
    where request.organization_id = p_organization_id
      and request.project_id = p_project_id
      and request.status = 'reserved'
  ) then
    raise exception using
      errcode = '55000',
      message = 'project has a pending GitHub change request; finish or fail it before handoff';
  end if;

  update public.project_connections link
  set connection_id = p_to_connection_id,
      github_repository_id = target_repository.id,
      updated_at = statement_timestamp()
  where link.id = link_record.id
    and link.organization_id = p_organization_id;

  update public.projects project
  set github_repository = target_repository.full_name,
      default_branch = target_repository.default_branch,
      updated_at = statement_timestamp()
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  -- Identifiers and transition labels are non-secret provider metadata. The
  -- activity table's append-only trigger makes this handoff evidence immutable.
  insert into public.activity_events (
    organization_id,
    project_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    p_organization_id,
    p_project_id,
    caller_id,
    'connection.changed'::public.activity_event_type,
    'project_connection_handoff',
    link_record.id,
    'GitHub project connection handed off between verified installations',
    pg_catalog.jsonb_build_object(
      'github_event_type', 'github.project_connection_handed_off',
      'state_transition', 'rebound',
      'previous_connection_id', p_from_connection_id,
      'connection_id', p_to_connection_id,
      'previous_installation_id', p_from_external_installation_id,
      'installation_id', p_to_external_installation_id,
      'previous_github_repository_id', source_repository.id,
      'github_repository_id', target_repository.id,
      'external_repository_id', p_external_repository_id,
      'history_preserved', true,
      'rollback_requires_both_installations_active', true,
      'approval_id', approval_record.id
    )
  );

  -- Store a single-use immutable execution row plus bounded outcome activity
  -- in the same transaction as the handoff.
  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    p_organization_id, p_project_id, caller_id,
    'connection.changed'::public.activity_event_type,
    'github_project_handoff_approval', approval_record.id,
    'RED GitHub project handoff completed',
    pg_catalog.jsonb_build_object(
      'risk_classification', 'red', 'outcome', 'succeeded',
      'action', 'github.project_connection_handoff',
      'connection_id', p_to_connection_id,
      'external_repository_id', p_external_repository_id
    )
  );

  insert into public.github_project_handoff_executions (
    approval_id, organization_id, project_id, executor_user_id, outcome
  ) values (
    approval_record.id, p_organization_id, p_project_id, caller_id, 'succeeded'
  );

  return query
  select
    project_record.id,
    p_to_connection_id,
    target_repository.id::uuid,
    p_from_connection_id,
    source_repository.id::uuid,
    target_repository.full_name::text,
    target_repository.default_branch::text;
end;
$function$;

revoke all on function public.handoff_github_project_connection(
  uuid, uuid, uuid, bigint, uuid, bigint, bigint, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.handoff_github_project_connection(
  uuid, uuid, uuid, bigint, uuid, bigint, bigint, uuid
) to authenticated;

comment on function public.handoff_github_project_connection(
  uuid, uuid, uuid, bigint, uuid, bigint, bigint, uuid
) is
  'Owner-only audited atomic handoff of an existing project between two active installations of the same GitHub account and repository. Preserves project/change history, blocks pending changes and duplicate active links, and supports an explicit reverse handoff while both installations remain active.';
