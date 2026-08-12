-- Keep linked projects aligned with the provider-authoritative repository name
-- and default branch. This closes the default-branch-only gap in the existing
-- installation sync while preserving exact tenant and connection boundaries.

create or replace function public.sync_linked_project_repository_metadata()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  resolved_connection_id uuid;
  linked_project record;
begin
  if new.full_name is not distinct from old.full_name
    and new.default_branch is not distinct from old.default_branch then
    return new;
  end if;

  select installation.connection_id
  into resolved_connection_id
  from public.github_installations installation
  where installation.id = new.installation_id
    and installation.organization_id = new.organization_id;

  if resolved_connection_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'GitHub installation connection was not found';
  end if;

  for linked_project in
    update public.projects as project
    set github_repository = new.full_name,
        default_branch = new.default_branch
    from public.project_connections as link
    where project.id = link.project_id
      and project.organization_id = new.organization_id
      and link.organization_id = new.organization_id
      and link.connection_id = resolved_connection_id
      and (
        pg_catalog.lower(project.github_repository) = pg_catalog.lower(old.full_name)
        or pg_catalog.lower(project.github_repository) = pg_catalog.lower(new.full_name)
      )
      and (
        project.github_repository is distinct from new.full_name
        or project.default_branch is distinct from new.default_branch
      )
    returning project.id
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
        'connection_id', resolved_connection_id,
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

comment on function public.sync_linked_project_repository_metadata() is
  'Trigger-only propagation of provider-authoritative repository names and default branches to exact tenant/connection-linked projects, with redacted immutable audit evidence.';
