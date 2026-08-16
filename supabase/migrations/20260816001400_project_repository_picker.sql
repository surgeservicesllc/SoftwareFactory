-- Let an owner or administrator choose which GitHub repository an existing
-- project connects to, change that choice, and unlink it — through the same
-- serialized, audited boundary that project creation and handoff already use.
--
-- connect_github_project creates a project bound to a repository at birth and
-- is untouched. These functions manage the binding of a project that already
-- exists. Both take the same advisory locks as handoff_github_project_connection
-- and validate_github_change_repository_binding, so a relink or unlink cannot
-- race a pending change reservation, a handoff, or a concurrent link of the
-- same repository. The organization-scoped uniqueness rule is unchanged: one
-- non-archived project per repository, with the conflicting project named in
-- the refusal so the caller is told what actually holds the repository.

create or replace function public.set_project_github_repository(
  p_organization_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_external_repository_id bigint
)
returns table (
  project_id uuid,
  project_name text,
  github_repository text,
  default_branch text,
  connection_id uuid,
  github_repository_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  repository_record record;
  conflicting_project_name text;
  link_record public.project_connections%rowtype;
  previous_repository_id uuid;
  previous_connection_id uuid;
  previous_repository_name text;
  link_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if p_project_id is null or p_connection_id is null
    or p_external_repository_id is null or p_external_repository_id <= 0 then
    raise exception using errcode = '22023', message = 'GitHub repository link identifiers are invalid';
  end if;

  -- Same lock the change-reservation trigger and handoff take, so the binding
  -- cannot move underneath a reservation that is validating against it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-project-handoff:'
        || p_organization_id::text || ':' || p_project_id::text,
      0
    )
  );

  select project.* into project_record
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project was not found';
  end if;
  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '55000', message = 'an archived project cannot change its GitHub repository';
  end if;

  -- Do not invalidate a provider intent already in progress.
  if exists (
    select 1
    from public.github_change_requests request
    where request.organization_id = p_organization_id
      and request.project_id = p_project_id
      and request.status = 'reserved'
  ) then
    raise exception using
      errcode = '55000',
      message = 'project has a pending GitHub change request; finish or fail it before changing the repository';
  end if;

  -- Same repository-uniqueness lock connect_github_project and handoff take.
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

  -- One non-archived project per repository, organization-wide. Name the
  -- holder: a bare constraint code tells the caller nothing actionable, and
  -- project names are tenant-visible non-secret metadata.
  select other_project.name into conflicting_project_name
  from public.projects other_project
  left join public.project_connections other_link
    on other_link.project_id = other_project.id
   and other_link.organization_id = other_project.organization_id
  left join public.github_repositories other_repository
    on other_repository.id = other_link.github_repository_id
   and other_repository.organization_id = other_link.organization_id
  where other_project.organization_id = p_organization_id
    and other_project.id <> p_project_id
    and other_project.status <> 'archived'::public.project_status
    and (
      other_repository.external_repository_id = p_external_repository_id
      or pg_catalog.lower(other_project.github_repository)
        = pg_catalog.lower(repository_record.full_name)
    )
  limit 1;
  if conflicting_project_name is not null then
    raise exception using
      errcode = '55000',
      message = pg_catalog.format(
        'that repository is already linked to project "%s"',
        conflicting_project_name
      );
  end if;

  if char_length(repository_record.default_branch) not between 1 and 255
    or repository_record.default_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'synchronized repository default branch is invalid';
  end if;

  select link.* into link_record
  from public.project_connections link
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and link.is_primary
  order by link.created_at
  limit 1
  for update;

  previous_connection_id := link_record.connection_id;
  previous_repository_id := link_record.github_repository_id;
  previous_repository_name := project_record.github_repository;

  if link_record.id is not null then
    update public.project_connections link
    set connection_id = p_connection_id,
        github_repository_id = repository_record.id,
        updated_at = statement_timestamp()
    where link.id = link_record.id
      and link.organization_id = p_organization_id;
    link_id := link_record.id;
  else
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id,
      is_primary, created_by
    ) values (
      p_organization_id, p_project_id, p_connection_id,
      repository_record.id, true, caller_id
    ) returning id into link_id;
  end if;

  update public.projects project
  set github_repository = repository_record.full_name,
      default_branch = repository_record.default_branch,
      updated_at = statement_timestamp()
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  -- Identifiers and names are non-secret provider metadata; the activity
  -- table's append-only trigger makes this transition evidence immutable.
  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    p_organization_id, p_project_id, caller_id,
    'connection.changed'::public.activity_event_type,
    'project_repository_link', link_id,
    case
      when previous_repository_id is null then 'Project linked to a GitHub repository'
      else 'Project GitHub repository link changed'
    end,
    pg_catalog.jsonb_build_object(
      'github_event_type', 'github.project_repository_link_set',
      'state_transition',
        case when previous_repository_id is null then 'linked' else 'relinked' end,
      'connection_id', p_connection_id,
      'previous_connection_id', previous_connection_id,
      'github_repository_id', repository_record.id,
      'previous_github_repository_id', previous_repository_id,
      'external_repository_id', p_external_repository_id,
      'github_repository', repository_record.full_name,
      'previous_github_repository', previous_repository_name
    )
  );

  return query
  select
    project_record.id,
    project_record.name,
    repository_record.full_name::text,
    repository_record.default_branch::text,
    p_connection_id,
    repository_record.id::uuid;
end;
$function$;

revoke all on function public.set_project_github_repository(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.set_project_github_repository(uuid, uuid, uuid, bigint)
  to authenticated;

comment on function public.set_project_github_repository(uuid, uuid, uuid, bigint) is
  'Owner/administrator choice of which GitHub repository an existing project connects to. Serialized with change reservations, handoff, and concurrent links; enforces one non-archived project per repository and names the conflicting project; appends immutable activity evidence.';

create or replace function public.unlink_project_github_repository(
  p_organization_id uuid,
  p_project_id uuid
)
returns table (
  project_id uuid,
  project_name text,
  previous_github_repository text,
  previous_connection_id uuid,
  previous_github_repository_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  link_record public.project_connections%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if p_project_id is null then
    raise exception using errcode = '22023', message = 'project id is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-project-handoff:'
        || p_organization_id::text || ':' || p_project_id::text,
      0
    )
  );

  select project.* into project_record
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project was not found';
  end if;
  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '55000', message = 'an archived project cannot change its GitHub repository';
  end if;

  if exists (
    select 1
    from public.github_change_requests request
    where request.organization_id = p_organization_id
      and request.project_id = p_project_id
      and request.status = 'reserved'
  ) then
    raise exception using
      errcode = '55000',
      message = 'project has a pending GitHub change request; finish or fail it before unlinking the repository';
  end if;

  select link.* into link_record
  from public.project_connections link
  join public.connections connection
    on connection.id = link.connection_id
   and connection.organization_id = link.organization_id
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and link.is_primary
    and connection.provider = 'github'::public.connection_provider
  order by link.created_at
  limit 1
  for update of link;

  if link_record.id is null and project_record.github_repository is null then
    raise exception using errcode = '55000', message = 'project has no linked GitHub repository';
  end if;

  if link_record.id is not null then
    delete from public.project_connections link
    where link.id = link_record.id
      and link.organization_id = p_organization_id;
  end if;

  update public.projects project
  set github_repository = null,
      updated_at = statement_timestamp()
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    p_organization_id, p_project_id, caller_id,
    'connection.changed'::public.activity_event_type,
    'project_repository_link', coalesce(link_record.id, p_project_id),
    'Project GitHub repository unlinked',
    pg_catalog.jsonb_build_object(
      'github_event_type', 'github.project_repository_link_removed',
      'state_transition', 'unlinked',
      'previous_connection_id', link_record.connection_id,
      'previous_github_repository_id', link_record.github_repository_id,
      'previous_github_repository', project_record.github_repository,
      'history_preserved', true
    )
  );

  return query
  select
    project_record.id,
    project_record.name,
    project_record.github_repository,
    link_record.connection_id,
    link_record.github_repository_id;
end;
$function$;

revoke all on function public.unlink_project_github_repository(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.unlink_project_github_repository(uuid, uuid)
  to authenticated;

comment on function public.unlink_project_github_repository(uuid, uuid) is
  'Owner/administrator removal of a project''s GitHub repository link. Serialized with change reservations and handoff; blocks while a change reservation is pending; preserves project and change history and appends immutable activity evidence.';
