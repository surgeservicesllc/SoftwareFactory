-- Phase 1B additive hardening for GitHub installation synchronization and
-- project linking. Existing migration history remains immutable.

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

  -- A row lock cannot protect the first synchronization because no installation
  -- row exists yet. Serialize every first-or-existing sync by the external id
  -- before reading or creating its connection. The transaction-scoped lock is
  -- automatically released on commit or rollback.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:github-installation:' || p_external_installation_id::text,
      0
    )
  );

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

  -- Always use the installation row as the authority after the upsert. If a
  -- future code path changes the conflict behavior, an inconsistent tenant
  -- binding aborts the transaction (including any just-created connection).
  select installation.organization_id, installation.connection_id
  into existing_organization_id, resolved_connection_id
  from public.github_installations installation
  where installation.id = resolved_installation_id
  for update;

  if existing_organization_id is distinct from p_organization_id
    or resolved_connection_id is null then
    raise exception using errcode = '42501', message = 'GitHub installation binding is inconsistent';
  end if;

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
  'Serialized owner/admin-only GitHub App installation sync. Uses the installation row as the authoritative tenant/connection binding and stores no provider credential or installation token.';

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

  -- Keep the existing RPC signature as an optimistic-concurrency expectation,
  -- never as an authority. The synchronized GitHub repository record is the
  -- only source used for the persisted project branch.
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
  'Atomically creates a safe-default project from the synchronized GitHub repository default branch; a supplied branch is only a freshness expectation.';
