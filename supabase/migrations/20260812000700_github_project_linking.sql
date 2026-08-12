-- Phase 1B transactional project linking. A project can only be created from a
-- repository that belongs to an active GitHub App installation in the caller's
-- organization. Safe execution defaults remain unchanged.

create unique index projects_active_github_repository_unique
  on public.projects (organization_id, lower(github_repository))
  where github_repository is not null and status <> 'archived'::public.project_status;

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
    repository.full_name,
    repository.default_branch,
    installation.status as installation_status,
    repository.archived,
    repository.disabled,
    repository.selected
  into repository_record
  from public.github_repositories repository
  join public.github_installations installation
    on installation.id = repository.installation_id
   and installation.organization_id = repository.organization_id
  where repository.organization_id = p_organization_id
    and installation.connection_id = p_connection_id
    and repository.external_repository_id = p_external_repository_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'selected GitHub repository was not found';
  end if;
  if repository_record.installation_status <> 'active'
    or not repository_record.selected
    or repository_record.archived
    or repository_record.disabled then
    raise exception using errcode = '55000', message = 'selected GitHub repository is not available';
  end if;

  resolved_branch := btrim(coalesce(nullif(p_default_branch, ''), repository_record.default_branch));
  if char_length(resolved_branch) not between 1 and 255 or resolved_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'default branch is invalid';
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
    is_primary,
    created_by
  ) values (
    p_organization_id,
    created_project.id,
    p_connection_id,
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

revoke all on function public.connect_github_project(uuid, uuid, bigint, text, text, text) from public, anon;
grant execute on function public.connect_github_project(uuid, uuid, bigint, text, text, text) to authenticated;

comment on function public.connect_github_project(uuid, uuid, bigint, text, text, text) is
  'Atomically creates a safe-default project and its primary GitHub App connection after tenant and repository verification.';
