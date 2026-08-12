-- Phase 1B additive repair for the hosted PostgreSQL lint failure in
-- sync_github_installation. Migration 004 is already shared/applied and remains
-- immutable. Keep this function signature, privilege boundary, and behavior
-- unchanged while removing PL/pgSQL output-column ambiguity.

create or replace function public.sync_github_installation(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_external_installation_id bigint,
  p_app_id bigint,
  p_app_slug text,
  p_account_id bigint,
  p_account_login text,
  p_account_type text,
  p_account_avatar_url text,
  p_target_type text,
  p_repository_selection text,
  p_permissions jsonb,
  p_subscribed_events text[],
  p_installed_at timestamptz,
  p_suspended_at timestamptz,
  p_repositories jsonb,
  p_connection_id uuid default null
)
returns table (
  connection_id uuid,
  installation_id uuid,
  repository_count integer,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := p_actor_user_id;
  resolved_connection_id uuid := p_connection_id;
  resolved_installation_id uuid;
  existing_organization_id uuid;
  created_connection boolean := false;
  repository_value jsonb;
  repository_total integer := 0;
  previous_full_name text;
begin
  if caller_id is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = caller_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if p_external_installation_id is null or p_external_installation_id <= 0
    or p_app_id is null or p_app_id <= 0
    or p_account_id is null or p_account_id <= 0 then
    raise exception using errcode = '22023', message = 'GitHub installation identifiers are invalid';
  end if;
  if p_account_type not in ('Organization', 'User')
    or p_target_type not in ('Organization', 'User')
    or p_repository_selection not in ('all', 'selected') then
    raise exception using errcode = '22023', message = 'GitHub installation metadata is invalid';
  end if;
  if jsonb_typeof(coalesce(p_permissions, '{}'::jsonb)) <> 'object'
    or public.jsonb_has_sensitive_keys(coalesce(p_permissions, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'GitHub permission metadata is invalid';
  end if;
  if jsonb_typeof(coalesce(p_repositories, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_repositories, '[]'::jsonb)) > 500
    or public.jsonb_has_sensitive_keys(coalesce(p_repositories, '[]'::jsonb)) then
    raise exception using errcode = '22023', message = 'GitHub repository metadata is invalid';
  end if;

  select installation.organization_id, installation.connection_id, installation.id
  into existing_organization_id, resolved_connection_id, resolved_installation_id
  from public.github_installations installation
  where installation.external_installation_id = p_external_installation_id
  for update;

  if existing_organization_id is not null and existing_organization_id <> p_organization_id then
    raise exception using errcode = '42501', message = 'GitHub installation is already bound to another organization';
  end if;

  if resolved_connection_id is not null then
    perform 1
    from public.connections connection
    where connection.id = resolved_connection_id
      and connection.organization_id = p_organization_id
      and connection.provider = 'github'::public.connection_provider;
    if not found then
      raise exception using errcode = 'P0002', message = 'GitHub connection was not found';
    end if;
  else
    insert into public.connections (
      organization_id,
      name,
      provider,
      status,
      external_account_label,
      secret_reference,
      settings,
      last_verified_at,
      created_by
    ) values (
      p_organization_id,
      left('GitHub · ' || btrim(p_account_login), 120),
      'github'::public.connection_provider,
      case when p_suspended_at is null then 'connected' else 'error' end::public.connection_status,
      left(btrim(p_account_login), 160),
      'env://GITHUB_APP',
      pg_catalog.jsonb_build_object(
        'app_slug', p_app_slug,
        'installation_id', p_external_installation_id,
        'repository_selection', p_repository_selection
      ),
      now(),
      caller_id
    )
    returning id into resolved_connection_id;
    created_connection := true;
  end if;

  update public.connections
  set name = left('GitHub · ' || btrim(p_account_login), 120),
      status = case when p_suspended_at is null then 'connected' else 'error' end::public.connection_status,
      external_account_label = left(btrim(p_account_login), 160),
      secret_reference = 'env://GITHUB_APP',
      settings = pg_catalog.jsonb_build_object(
        'app_slug', p_app_slug,
        'installation_id', p_external_installation_id,
        'repository_selection', p_repository_selection
      ),
      last_verified_at = now(),
      error_message = case when p_suspended_at is null then null else 'GitHub installation is suspended.' end
  where id = resolved_connection_id and organization_id = p_organization_id;

  insert into public.github_installations (
    organization_id,
    connection_id,
    external_installation_id,
    app_id,
    app_slug,
    account_id,
    account_login,
    account_type,
    account_avatar_url,
    target_type,
    repository_selection,
    status,
    permissions,
    subscribed_events,
    suspended_at,
    deleted_at,
    installed_at,
    last_synced_at,
    created_by
  ) values (
    p_organization_id,
    resolved_connection_id,
    p_external_installation_id,
    p_app_id,
    btrim(p_app_slug),
    p_account_id,
    btrim(p_account_login),
    p_account_type,
    p_account_avatar_url,
    p_target_type,
    p_repository_selection,
    case when p_suspended_at is null then 'active' else 'suspended' end,
    coalesce(p_permissions, '{}'::jsonb),
    coalesce(p_subscribed_events, '{}'::text[]),
    p_suspended_at,
    null,
    p_installed_at,
    now(),
    caller_id
  )
  on conflict (external_installation_id) do update set
    app_id = excluded.app_id,
    app_slug = excluded.app_slug,
    account_id = excluded.account_id,
    account_login = excluded.account_login,
    account_type = excluded.account_type,
    account_avatar_url = excluded.account_avatar_url,
    target_type = excluded.target_type,
    repository_selection = excluded.repository_selection,
    status = excluded.status,
    permissions = excluded.permissions,
    subscribed_events = excluded.subscribed_events,
    suspended_at = excluded.suspended_at,
    deleted_at = null,
    last_synced_at = now()
  returning id into resolved_installation_id;

  update public.github_repositories as synced_repository
  set selected = false, last_synced_at = now()
  where synced_repository.installation_id = resolved_installation_id;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(coalesce(p_repositories, '[]'::jsonb))
  loop
    select repository.full_name into previous_full_name
    from public.github_repositories repository
    where repository.installation_id = resolved_installation_id
      and repository.external_repository_id = (repository_value ->> 'id')::bigint;

    insert into public.github_repositories (
      organization_id,
      installation_id,
      external_repository_id,
      node_id,
      owner_login,
      name,
      full_name,
      default_branch,
      html_url,
      private,
      visibility,
      archived,
      disabled,
      selected,
      permissions,
      github_updated_at,
      pushed_at,
      last_synced_at
    ) values (
      p_organization_id,
      resolved_installation_id,
      (repository_value ->> 'id')::bigint,
      nullif(repository_value ->> 'node_id', ''),
      repository_value ->> 'owner_login',
      repository_value ->> 'name',
      repository_value ->> 'full_name',
      repository_value ->> 'default_branch',
      repository_value ->> 'html_url',
      coalesce((repository_value ->> 'private')::boolean, true),
      repository_value ->> 'visibility',
      coalesce((repository_value ->> 'archived')::boolean, false),
      coalesce((repository_value ->> 'disabled')::boolean, false),
      true,
      coalesce(repository_value -> 'permissions', '{}'::jsonb),
      (repository_value ->> 'github_updated_at')::timestamptz,
      nullif(repository_value ->> 'pushed_at', '')::timestamptz,
      now()
    )
    on conflict on constraint github_repositories_external_unique do update set
      node_id = excluded.node_id,
      owner_login = excluded.owner_login,
      name = excluded.name,
      full_name = excluded.full_name,
      default_branch = excluded.default_branch,
      html_url = excluded.html_url,
      private = excluded.private,
      visibility = excluded.visibility,
      archived = excluded.archived,
      disabled = excluded.disabled,
      selected = true,
      permissions = excluded.permissions,
      github_updated_at = excluded.github_updated_at,
      pushed_at = excluded.pushed_at,
      last_synced_at = now();

    if previous_full_name is not null
      and lower(previous_full_name) <> lower(repository_value ->> 'full_name') then
      update public.projects project
      set github_repository = repository_value ->> 'full_name',
          default_branch = repository_value ->> 'default_branch'
      where lower(project.github_repository) = lower(previous_full_name)
        and exists (
          select 1 from public.project_connections link
          where link.project_id = project.id
            and link.connection_id = resolved_connection_id
        );
    end if;
    repository_total := repository_total + 1;
  end loop;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'connection.changed'::public.activity_event_type,
    'github_installation',
    resolved_installation_id,
    'GitHub App installation synchronized',
    pg_catalog.jsonb_build_object(
      'connection_id', resolved_connection_id,
      'installation_id', p_external_installation_id,
      'account_login', p_account_login,
      'repository_count', repository_total,
      'status', case when p_suspended_at is null then 'active' else 'suspended' end,
      'github_event_type', case when created_connection then 'github.connected' else 'github.synchronized' end
    )
  );

  return query select resolved_connection_id, resolved_installation_id, repository_total, created_connection;
end;
$function$;

revoke all on function public.sync_github_installation(uuid, uuid, bigint, bigint, text, bigint, text, text, text, text, text, jsonb, text[], timestamptz, timestamptz, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.sync_github_installation(uuid, uuid, bigint, bigint, text, bigint, text, text, text, text, text, jsonb, text[], timestamptz, timestamptz, jsonb, uuid) to service_role;

comment on function public.sync_github_installation(uuid, uuid, bigint, bigint, text, bigint, text, text, text, text, text, jsonb, text[], timestamptz, timestamptz, jsonb, uuid) is
  'Owner/admin-only GitHub App installation and selected-repository metadata sync. Stores no provider credential or installation token.';
