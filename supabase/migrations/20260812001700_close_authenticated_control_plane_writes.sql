-- Remove authenticated table-write privileges that bypass the audited control-
-- plane workflows. The application already creates and updates these records
-- through narrow SECURITY DEFINER functions. GitHub change reservations are
-- moved behind an equally narrow authenticated RPC below.

drop policy if exists connections_insert_managers on public.connections;
drop policy if exists connections_update_managers on public.connections;
revoke insert, update, delete on table public.connections from authenticated;

drop policy if exists projects_insert_managers on public.projects;
drop policy if exists projects_update_managers on public.projects;
revoke insert, update, delete on table public.projects from authenticated;

drop policy if exists project_connections_insert_managers on public.project_connections;
drop policy if exists project_connections_update_managers on public.project_connections;
drop policy if exists project_connections_delete_managers on public.project_connections;
revoke insert, update, delete on table public.project_connections from authenticated;

drop policy if exists github_change_requests_insert_managers on public.github_change_requests;
revoke insert, update, delete on table public.github_change_requests from authenticated;

create or replace function public.reserve_github_change_request(
  p_organization_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_repository_id uuid,
  p_idempotency_key text,
  p_execution_nonce uuid,
  p_content_sha256 text,
  p_path text,
  p_expected_blob_sha text,
  p_base_branch text,
  p_title text,
  p_commit_message text
)
returns setof public.github_change_requests
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  change_record public.github_change_requests%rowtype;
  created_new boolean := false;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  if p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'invalid idempotency key';
  end if;
  if p_execution_nonce is null then
    raise exception using errcode = '22023', message = 'execution nonce is required';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'content digest is invalid';
  end if;
  if p_expected_blob_sha is null or p_expected_blob_sha !~ '^[0-9a-f]{40,64}$' then
    raise exception using errcode = '22023', message = 'expected blob digest is invalid';
  end if;
  if p_path is null
    or char_length(p_path) not between 1 and 1024
    or p_path <> btrim(p_path)
    or p_path ~ '(^|/)\.\.(/|$)'
    or p_path ~ '^/|/$|//|[[:cntrl:]]'
    or pg_catalog.strpos(p_path, E'\\') > 0 then
    raise exception using errcode = '22023', message = 'repository path is invalid';
  end if;
  if p_base_branch is null
    or char_length(btrim(p_base_branch)) not between 1 and 255
    or p_base_branch <> btrim(p_base_branch)
    or p_base_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'base branch is invalid';
  end if;
  if p_title is null
    or char_length(btrim(p_title)) not between 1 and 256
    or p_title <> btrim(p_title)
    or p_commit_message is null
    or char_length(btrim(p_commit_message)) not between 1 and 256
    or p_commit_message <> btrim(p_commit_message) then
    raise exception using errcode = '22023', message = 'change title or commit message is invalid';
  end if;
  if public.text_has_likely_secret(p_title)
    or public.text_has_likely_secret(p_commit_message) then
    raise exception using errcode = '22023', message = 'change metadata contains sensitive data';
  end if;

  -- Revalidate the complete live tenant binding inside the trusted write
  -- boundary. Browser/server prechecks remain useful UX, not authorization.
  if not exists (
    select 1
    from public.projects project
    join public.project_connections link
      on link.organization_id = project.organization_id
     and link.project_id = project.id
     and link.connection_id = p_connection_id
    join public.connections connection
      on connection.organization_id = link.organization_id
     and connection.id = link.connection_id
    join public.github_installations installation
      on installation.organization_id = connection.organization_id
     and installation.connection_id = connection.id
    join public.github_repositories repository
      on repository.organization_id = installation.organization_id
     and repository.installation_id = installation.id
     and repository.id = p_repository_id
    where project.organization_id = p_organization_id
      and project.id = p_project_id
      and project.status <> 'archived'::public.project_status
      and project.default_branch = p_base_branch
      and lower(project.github_repository) = lower(repository.full_name)
      and connection.provider = 'github'::public.connection_provider
      and connection.status = 'connected'::public.connection_status
      and installation.status = 'active'
      and installation.suspended_at is null
      and installation.deleted_at is null
      and repository.selected
      and not repository.archived
      and not repository.disabled
  ) then
    raise exception using errcode = '23514', message = 'GitHub change request target is not an active linked repository';
  end if;

  insert into public.github_change_requests (
    organization_id,
    project_id,
    connection_id,
    repository_id,
    idempotency_key,
    execution_nonce,
    content_sha256,
    path,
    expected_blob_sha,
    base_branch,
    title,
    commit_message,
    created_by
  ) values (
    p_organization_id,
    p_project_id,
    p_connection_id,
    p_repository_id,
    p_idempotency_key,
    p_execution_nonce,
    p_content_sha256,
    p_path,
    p_expected_blob_sha,
    p_base_branch,
    p_title,
    p_commit_message,
    caller_id
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into change_record;

  created_new := found;
  if not created_new then
    select request.*
    into change_record
    from public.github_change_requests request
    where request.organization_id = p_organization_id
      and request.idempotency_key = p_idempotency_key;

    if not found then
      raise exception using errcode = '40001', message = 'GitHub change reservation conflicted; retry with the same idempotency key';
    end if;
  end if;

  if created_new then
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
      'project.updated'::public.activity_event_type,
      'github_change_request',
      change_record.id,
      'GitHub change request reserved',
      pg_catalog.jsonb_build_object(
        'connection_id', p_connection_id,
        'repository_id', p_repository_id,
        'status', 'reserved',
        'github_event_type', 'github.change_reserved'
      )
    );
  end if;

  return next change_record;
  return;
end;
$function$;

revoke all on function public.reserve_github_change_request(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.reserve_github_change_request(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text
) to authenticated;

comment on function public.reserve_github_change_request(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text
) is
  'Owner/admin reservation boundary for an exact live tenant/project/connection/repository binding. It records immutable intent only and cannot call GitHub, merge, or deploy.';
