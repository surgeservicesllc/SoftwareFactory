-- Bind each GitHub project connection to the provider repository's immutable
-- database identity. Repository names remain display metadata and can change;
-- they are no longer an authorization key.

alter table public.project_connections
  add column github_repository_id uuid;

with candidate as (
  select
    link.id as link_id,
    repository.id as repository_id
  from public.project_connections link
  join public.projects project
    on project.id = link.project_id
   and project.organization_id = link.organization_id
  join public.connections connection
    on connection.id = link.connection_id
   and connection.organization_id = link.organization_id
   and connection.provider = 'github'::public.connection_provider
  join public.github_installations installation
    on installation.connection_id = connection.id
   and installation.organization_id = link.organization_id
  join public.github_repositories repository
    on repository.installation_id = installation.id
   and repository.organization_id = link.organization_id
   and pg_catalog.lower(repository.full_name) = pg_catalog.lower(project.github_repository)
), unique_candidate as (
  select
    candidate.link_id,
    pg_catalog.min(candidate.repository_id::text)::uuid as repository_id
  from candidate
  group by candidate.link_id
  having pg_catalog.count(*) = 1
)
update public.project_connections link
set github_repository_id = unique_candidate.repository_id
from unique_candidate
where link.id = unique_candidate.link_id;

alter table public.project_connections
  add constraint project_connections_github_repository_fk
  foreign key (github_repository_id, organization_id)
  references public.github_repositories(id, organization_id)
  on delete restrict;

create index project_connections_github_repository_idx
  on public.project_connections (github_repository_id)
  where github_repository_id is not null;

create or replace function public.validate_github_change_repository_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
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

create trigger github_change_requests_validate_repository_binding
  before insert or update of organization_id, project_id, connection_id, repository_id
  on public.github_change_requests
  for each row execute function public.validate_github_change_repository_binding();

drop trigger if exists github_repositories_sync_linked_project_metadata
  on public.github_repositories;

create or replace function public.sync_linked_project_repository_metadata()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  linked_project record;
begin
  if new.full_name is not distinct from old.full_name
    and new.default_branch is not distinct from old.default_branch then
    return new;
  end if;

  for linked_project in
    update public.projects as project
    set github_repository = new.full_name,
        default_branch = new.default_branch
    from public.project_connections as link
    where project.id = link.project_id
      and project.organization_id = new.organization_id
      and link.organization_id = new.organization_id
      and link.github_repository_id = new.id
      and (
        project.github_repository is distinct from new.full_name
        or project.default_branch is distinct from new.default_branch
      )
    returning project.id, link.connection_id
  loop
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
      new.organization_id,
      linked_project.id,
      null,
      'project.updated'::public.activity_event_type,
      'project',
      linked_project.id,
      'GitHub repository metadata synchronized',
      pg_catalog.jsonb_build_object(
        'source', 'github_repository_sync',
        'connection_id', linked_project.connection_id,
        'installation_id', new.installation_id,
        'github_repository_id', new.id,
        'external_repository_id', new.external_repository_id,
        'repository_name_changed', new.full_name is distinct from old.full_name,
        'default_branch_changed', new.default_branch is distinct from old.default_branch
      )
    );
  end loop;

  return new;
end;
$function$;

revoke all on function public.sync_linked_project_repository_metadata()
  from public, anon, authenticated, service_role;

create trigger github_repositories_sync_linked_project_metadata
  after update of full_name, default_branch on public.github_repositories
  for each row execute function public.sync_linked_project_repository_metadata();

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
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'project name is invalid';
  end if;

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

  if expected_branch is not null
    and expected_branch is distinct from repository_record.default_branch then
    raise exception using errcode = '40001', message = 'repository default branch changed; reload before connecting the project';
  end if;
  resolved_branch := repository_record.default_branch;
  if char_length(resolved_branch) not between 1 and 255 or resolved_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'synchronized repository default branch is invalid';
  end if;

  insert into public.projects (
    organization_id,
    name,
    description,
    status,
    github_repository,
    default_branch,
    created_by
  ) values (
    p_organization_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    'active'::public.project_status,
    repository_record.full_name,
    resolved_branch,
    caller_id
  )
  returning * into created_project;

  insert into public.project_connections (
    organization_id,
    project_id,
    connection_id,
    github_repository_id,
    is_primary,
    created_by
  ) values (
    p_organization_id,
    created_project.id,
    p_connection_id,
    repository_record.id,
    true,
    caller_id
  );

  return query
  select
    created_project.id,
    created_project.name,
    created_project.github_repository,
    created_project.default_branch,
    created_project.status,
    p_connection_id;
end;
$function$;

revoke all on function public.connect_github_project(uuid, uuid, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.connect_github_project(uuid, uuid, bigint, text, text, text)
  to authenticated;

comment on column public.project_connections.github_repository_id is
  'Stable tenant-scoped GitHub repository identity for this project connection; repository names are display metadata only.';
comment on function public.validate_github_change_repository_binding() is
  'Trigger-only authorization invariant requiring every change request to target the repository ID bound to its exact project connection.';
