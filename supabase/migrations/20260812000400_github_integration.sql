-- Phase 1B GitHub App metadata, webhook idempotency, and safe draft-PR writes.
-- GitHub credentials and short-lived tokens remain in server-side secret/runtime
-- memory. These tables contain identifiers, repository metadata, and audit evidence.

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  external_installation_id bigint not null check (external_installation_id > 0),
  app_id bigint not null check (app_id > 0),
  app_slug text not null check (app_slug ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$'),
  account_id bigint not null check (account_id > 0),
  account_login text not null check (account_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$'),
  account_type text not null check (account_type in ('Organization', 'User')),
  account_avatar_url text check (account_avatar_url is null or account_avatar_url ~ '^https://'),
  target_type text not null check (target_type in ('Organization', 'User')),
  repository_selection text not null check (repository_selection in ('all', 'selected')),
  status text not null default 'active' check (status in ('active', 'suspended', 'disconnected', 'deleted', 'error')),
  permissions jsonb not null default '{}'::jsonb,
  subscribed_events text[] not null default '{}'::text[],
  suspended_at timestamptz,
  deleted_at timestamptz,
  installed_at timestamptz not null,
  last_synced_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_installations_id_organization_unique unique (id, organization_id),
  constraint github_installations_connection_fk foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete cascade,
  constraint github_installations_connection_unique unique (connection_id),
  constraint github_installations_external_unique unique (external_installation_id),
  constraint github_installations_permissions_object check (jsonb_typeof(permissions) = 'object'),
  constraint github_installations_permissions_no_sensitive_data check (not public.jsonb_has_sensitive_keys(permissions)),
  constraint github_installations_suspension_consistent check (
    (status = 'suspended' and suspended_at is not null)
    or status <> 'suspended'
  ),
  constraint github_installations_deletion_consistent check (
    (status = 'deleted' and deleted_at is not null)
    or status <> 'deleted'
  )
);

create table public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installation_id uuid not null,
  external_repository_id bigint not null check (external_repository_id > 0),
  node_id text,
  owner_login text not null check (owner_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$'),
  name text not null check (name ~ '^[A-Za-z0-9_.-]{1,100}$'),
  full_name text not null check (full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  default_branch text not null check (char_length(btrim(default_branch)) between 1 and 255),
  html_url text not null check (html_url ~ '^https://github\.com/'),
  private boolean not null default true,
  visibility text not null check (visibility in ('public', 'private', 'internal')),
  archived boolean not null default false,
  disabled boolean not null default false,
  selected boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  github_updated_at timestamptz not null,
  pushed_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_repositories_id_organization_unique unique (id, organization_id),
  constraint github_repositories_installation_fk foreign key (installation_id, organization_id)
    references public.github_installations(id, organization_id) on delete cascade,
  constraint github_repositories_external_unique unique (installation_id, external_repository_id),
  constraint github_repositories_full_name_unique unique (installation_id, full_name),
  constraint github_repositories_owner_matches check (lower(split_part(full_name, '/', 1)) = lower(owner_login)),
  constraint github_repositories_name_matches check (lower(split_part(full_name, '/', 2)) = lower(name)),
  constraint github_repositories_permissions_object check (jsonb_typeof(permissions) = 'object'),
  constraint github_repositories_permissions_no_sensitive_data check (not public.jsonb_has_sensitive_keys(permissions))
);

create table public.github_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  connection_id uuid,
  installation_id uuid,
  external_delivery_id text not null check (external_delivery_id ~ '^[A-Za-z0-9-]{16,128}$'),
  external_installation_id bigint check (external_installation_id is null or external_installation_id > 0),
  external_repository_id bigint check (external_repository_id is null or external_repository_id > 0),
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  action text check (action is null or action ~ '^[a-z][a-z0-9_]{0,62}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'accepted' check (status in ('accepted', 'processed', 'ignored', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,62}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint github_webhook_deliveries_external_unique unique (external_delivery_id),
  constraint github_webhook_deliveries_connection_fk foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint github_webhook_deliveries_installation_fk foreign key (installation_id, organization_id)
    references public.github_installations(id, organization_id) on delete restrict,
  constraint github_webhook_deliveries_tenant_consistent check (
    (organization_id is null and connection_id is null and installation_id is null)
    or (organization_id is not null and connection_id is not null and installation_id is not null)
  ),
  constraint github_webhook_deliveries_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint github_webhook_deliveries_metadata_no_sensitive_data check (not public.jsonb_has_sensitive_keys(metadata)),
  constraint github_webhook_deliveries_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint github_webhook_deliveries_payload_no_sensitive_data check (not public.jsonb_has_sensitive_keys(payload))
);

create table public.github_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  connection_id uuid not null,
  repository_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  execution_nonce uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  path text not null check (
    char_length(path) between 1 and 1024
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '^/'
    and path !~ '[[:cntrl:]]'
  ),
  expected_blob_sha text not null check (expected_blob_sha ~ '^[0-9a-f]{40,64}$'),
  base_branch text not null check (char_length(btrim(base_branch)) between 1 and 255),
  head_branch text check (head_branch is null or char_length(btrim(head_branch)) between 1 and 255),
  title text not null check (char_length(btrim(title)) between 1 and 256),
  commit_message text not null check (char_length(btrim(commit_message)) between 1 and 256),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40,64}$'),
  commit_url text check (commit_url is null or commit_url ~ '^https://github\.com/'),
  external_pull_request_id bigint check (external_pull_request_id is null or external_pull_request_id > 0),
  pull_request_number integer check (pull_request_number is null or pull_request_number > 0),
  pull_request_url text check (pull_request_url is null or pull_request_url ~ '^https://github\.com/'),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,62}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint github_change_requests_id_organization_unique unique (id, organization_id),
  constraint github_change_requests_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint github_change_requests_connection_fk foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint github_change_requests_repository_fk foreign key (repository_id, organization_id)
    references public.github_repositories(id, organization_id) on delete restrict,
  constraint github_change_requests_idempotency_unique unique (organization_id, idempotency_key),
  constraint github_change_requests_completion_consistent check (
    (status = 'completed'
      and head_branch is not null
      and commit_sha is not null
      and commit_url is not null
      and external_pull_request_id is not null
      and pull_request_number is not null
      and pull_request_url is not null
      and completed_at is not null)
    or status <> 'completed'
  )
);

create index github_installations_org_status_idx
  on public.github_installations (organization_id, status, last_synced_at desc);
create index github_repositories_org_selected_idx
  on public.github_repositories (organization_id, selected, full_name);
create index github_repositories_installation_selected_idx
  on public.github_repositories (installation_id, selected, full_name);
create index github_webhook_deliveries_installation_time_idx
  on public.github_webhook_deliveries (external_installation_id, received_at desc)
  where external_installation_id is not null;
create index github_webhook_deliveries_org_time_idx
  on public.github_webhook_deliveries (organization_id, received_at desc)
  where organization_id is not null;
create index github_change_requests_project_time_idx
  on public.github_change_requests (project_id, created_at desc);

create trigger github_installations_set_updated_at
  before update on public.github_installations
  for each row execute function public.set_updated_at();
create trigger github_repositories_set_updated_at
  before update on public.github_repositories
  for each row execute function public.set_updated_at();
create trigger github_change_requests_set_updated_at
  before update on public.github_change_requests
  for each row execute function public.set_updated_at();

create trigger github_installations_organization_immutable
  before update on public.github_installations
  for each row execute function public.prevent_organization_reassignment();
create trigger github_repositories_organization_immutable
  before update on public.github_repositories
  for each row execute function public.prevent_organization_reassignment();
create trigger github_change_requests_organization_immutable
  before update on public.github_change_requests
  for each row execute function public.prevent_organization_reassignment();

create trigger github_installations_reject_sensitive_data
  before insert or update on public.github_installations
  for each row execute function public.reject_sensitive_row_data();
create trigger github_repositories_reject_sensitive_data
  before insert or update on public.github_repositories
  for each row execute function public.reject_sensitive_row_data();
create trigger github_webhook_deliveries_reject_sensitive_data
  before insert or update on public.github_webhook_deliveries
  for each row execute function public.reject_sensitive_row_data();
create trigger github_change_requests_reject_sensitive_data
  before insert or update on public.github_change_requests
  for each row execute function public.reject_sensitive_row_data();

alter table public.github_installations enable row level security;
alter table public.github_installations force row level security;
alter table public.github_repositories enable row level security;
alter table public.github_repositories force row level security;
alter table public.github_webhook_deliveries enable row level security;
alter table public.github_webhook_deliveries force row level security;
alter table public.github_change_requests enable row level security;
alter table public.github_change_requests force row level security;

create policy github_installations_select_members
  on public.github_installations for select to authenticated
  using (public.is_organization_member(organization_id));
create policy github_repositories_select_members
  on public.github_repositories for select to authenticated
  using (public.is_organization_member(organization_id));
create policy github_webhook_deliveries_select_members
  on public.github_webhook_deliveries for select to authenticated
  using (organization_id is not null and public.is_organization_member(organization_id));
create policy github_change_requests_select_members
  on public.github_change_requests for select to authenticated
  using (public.is_organization_member(organization_id));
create policy github_change_requests_insert_managers
  on public.github_change_requests for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_manage_project(project_id)
    and public.can_manage_organization(organization_id)
  );

revoke all on table public.github_installations from public, anon, authenticated;
revoke all on table public.github_repositories from public, anon, authenticated;
revoke all on table public.github_webhook_deliveries from public, anon, authenticated;
revoke all on table public.github_change_requests from public, anon, authenticated;
grant select on table public.github_installations to authenticated;
grant select on table public.github_repositories to authenticated;
grant select on table public.github_webhook_deliveries to authenticated;
grant select, insert on table public.github_change_requests to authenticated;
grant select, insert, update on table public.github_installations to service_role;
grant select, insert, update on table public.github_repositories to service_role;
grant select, insert, update on table public.github_webhook_deliveries to service_role;
grant select, insert, update on table public.github_change_requests to service_role;

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

  update public.github_repositories
  set selected = false, last_synced_at = now()
  where installation_id = resolved_installation_id;

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
    on conflict (installation_id, external_repository_id) do update set
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

create or replace function public.complete_github_change_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_head_branch text,
  p_commit_sha text,
  p_commit_url text,
  p_pull_request_id bigint,
  p_pull_request_number integer,
  p_pull_request_title text,
  p_pull_request_url text
)
returns table (
  change_request_id uuid,
  pull_request_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := p_actor_user_id;
  change_record public.github_change_requests%rowtype;
  project_record public.projects%rowtype;
  repository_record public.github_repositories%rowtype;
  pull_request_record_id uuid;
begin
  select * into change_record
  from public.github_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'GitHub change request was not found';
  end if;
  if caller_id is null or not exists (
    select 1
    from public.projects project
    join public.organization_members member on member.organization_id = project.organization_id
    where project.id = change_record.project_id
      and member.user_id = caller_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'project owner or administrator access is required';
  end if;
  if change_record.status = 'completed' then
    select id into pull_request_record_id
    from public.pull_requests
    where project_id = change_record.project_id
      and external_number = change_record.pull_request_number;
    return query select change_record.id, pull_request_record_id;
    return;
  end if;
  if change_record.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'GitHub change request is not active';
  end if;

  select * into project_record from public.projects where id = change_record.project_id;
  select * into repository_record from public.github_repositories where id = change_record.repository_id;
  if repository_record.id is null
    or lower(project_record.github_repository) <> lower(repository_record.full_name)
    or change_record.connection_id <> (
      select installation.connection_id
      from public.github_installations installation
      where installation.id = repository_record.installation_id
    ) then
    raise exception using errcode = '23514', message = 'GitHub change request target is inconsistent';
  end if;

  update public.github_change_requests
  set status = 'completed',
      head_branch = p_head_branch,
      commit_sha = lower(p_commit_sha),
      commit_url = p_commit_url,
      external_pull_request_id = p_pull_request_id,
      pull_request_number = p_pull_request_number,
      pull_request_url = p_pull_request_url,
      completed_at = now(),
      error_code = null
  where id = change_record.id;

  insert into public.pull_requests (
    organization_id,
    project_id,
    repository,
    external_number,
    title,
    url,
    head_branch,
    base_branch,
    status,
    risk_level,
    opened_at
  ) values (
    change_record.organization_id,
    change_record.project_id,
    project_record.github_repository,
    p_pull_request_number,
    p_pull_request_title,
    p_pull_request_url,
    p_head_branch,
    change_record.base_branch,
    'draft'::public.pull_request_status,
    'yellow'::public.risk_level,
    now()
  )
  on conflict (project_id, repository, external_number) do update set
    title = excluded.title,
    url = excluded.url,
    head_branch = excluded.head_branch,
    base_branch = excluded.base_branch,
    status = 'draft'::public.pull_request_status,
    updated_at = now()
  returning id into pull_request_record_id;

  return query select change_record.id, pull_request_record_id;
end;
$function$;

create or replace function public.fail_github_change_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  change_record public.github_change_requests%rowtype;
begin
  if p_error_code !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception using errcode = '22023', message = 'error code is invalid';
  end if;
  select * into change_record from public.github_change_requests where id = p_request_id for update;
  if not found then
    return false;
  end if;
  if p_actor_user_id is null or not exists (
    select 1
    from public.projects project
    join public.organization_members member on member.organization_id = project.organization_id
    where project.id = change_record.project_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'project owner or administrator access is required';
  end if;
  if change_record.status = 'reserved' then
    update public.github_change_requests
    set status = 'failed', error_code = p_error_code
    where id = p_request_id;
  end if;
  return true;
end;
$function$;

create or replace function public.disconnect_github_connection(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_expected_installation_id bigint
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  connection_record public.connections%rowtype;
  installation_record public.github_installations%rowtype;
  affected_project_count integer;
begin
  select * into connection_record
  from public.connections
  where id = p_connection_id and provider = 'github'::public.connection_provider
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'GitHub connection was not found';
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = connection_record.organization_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  select * into installation_record
  from public.github_installations
  where connection_id = connection_record.id
  for update;
  if not found or installation_record.external_installation_id <> p_expected_installation_id then
    raise exception using errcode = '40001', message = 'GitHub installation changed; reload before disconnecting';
  end if;

  select count(*)::integer into affected_project_count
  from public.project_connections link
  where link.connection_id = connection_record.id;

  update public.connections
  set status = 'disabled'::public.connection_status,
      error_message = null,
      last_verified_at = now()
  where id = connection_record.id;
  update public.github_installations
  set status = 'disconnected', last_synced_at = now()
  where id = installation_record.id;
  update public.github_repositories
  set selected = false, last_synced_at = now()
  where installation_id = installation_record.id;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    connection_record.organization_id,
    p_actor_user_id,
    'connection.changed'::public.activity_event_type,
    'github_installation',
    installation_record.id,
    'GitHub connection disconnected by an organization manager',
    pg_catalog.jsonb_build_object(
      'connection_id', connection_record.id,
      'installation_id', installation_record.external_installation_id,
      'affected_project_count', affected_project_count,
      'history_preserved', true,
      'github_event_type', 'github.disconnected'
    )
  );
  return affected_project_count;
end;
$function$;

create or replace function public.mark_github_connection_lost(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  connection_record public.connections%rowtype;
  installation_record public.github_installations%rowtype;
begin
  if p_reason not in ('installation_revoked', 'insufficient_permission', 'provider_authorization_failed') then
    raise exception using errcode = '22023', message = 'GitHub connection loss reason is invalid';
  end if;
  select * into connection_record
  from public.connections
  where id = p_connection_id and provider = 'github'::public.connection_provider
  for update;
  if not found then return false; end if;
  if p_actor_user_id is not null and not exists (
    select 1 from public.organization_members member
    where member.organization_id = connection_record.organization_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  select * into installation_record
  from public.github_installations where connection_id = connection_record.id for update;

  update public.connections
  set status = 'error'::public.connection_status,
      error_message = 'GitHub Connection Lost',
      last_verified_at = now()
  where id = connection_record.id;
  update public.github_installations
  set status = 'error', last_synced_at = now()
  where connection_id = connection_record.id;
  update public.github_repositories
  set selected = false, last_synced_at = now()
  where installation_id = installation_record.id;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    connection_record.organization_id,
    p_actor_user_id,
    'connection.changed'::public.activity_event_type,
    'github_installation',
    installation_record.id,
    'GitHub connection lost',
    pg_catalog.jsonb_build_object(
      'connection_id', connection_record.id,
      'installation_id', installation_record.external_installation_id,
      'reason', p_reason,
      'github_event_type', 'github.connection_lost'
    )
  );
  return true;
end;
$function$;

create or replace function public.process_github_webhook_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  delivery public.github_webhook_deliveries%rowtype;
  project_record public.projects%rowtype;
  event_kind public.activity_event_type;
  event_description text;
  repository_full_name text;
  previous_repository_full_name text;
  actor_metadata jsonb;
begin
  select * into delivery
  from public.github_webhook_deliveries
  where id = p_delivery_id
  for update;
  if not found then return false; end if;
  if delivery.status <> 'accepted' then return true; end if;

  repository_full_name := delivery.payload -> 'repository' ->> 'full_name';
  actor_metadata := case
    when delivery.payload -> 'sender' is null or delivery.payload -> 'sender' = 'null'::jsonb
      then '{}'::jsonb
    else pg_catalog.jsonb_build_object('github_actor', delivery.payload -> 'sender')
  end;

  if delivery.event_name = 'installation' then
    if delivery.action = 'deleted' then
      update public.connections set status = 'error'::public.connection_status,
        error_message = 'GitHub Connection Lost', last_verified_at = now()
      where id = delivery.connection_id;
      update public.github_installations set status = 'deleted', deleted_at = now(), last_synced_at = now()
      where id = delivery.installation_id;
      update public.github_repositories set selected = false, last_synced_at = now()
      where installation_id = delivery.installation_id;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation deleted';
    elsif delivery.action = 'suspend' then
      update public.connections set status = 'error'::public.connection_status,
        error_message = 'GitHub installation is suspended.', last_verified_at = now()
      where id = delivery.connection_id;
      update public.github_installations set status = 'suspended', suspended_at = now(), last_synced_at = now()
      where id = delivery.installation_id;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation suspended';
    elsif delivery.action = 'unsuspend' then
      update public.connections set status = 'connected'::public.connection_status,
        error_message = null, last_verified_at = now()
      where id = delivery.connection_id;
      update public.github_installations set status = 'active', suspended_at = null, last_synced_at = now()
      where id = delivery.installation_id;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation unsuspended';
    else
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation changed';
    end if;
  elsif delivery.event_name = 'installation_repositories' then
    update public.github_repositories repository
    set selected = true, last_synced_at = now()
    where repository.installation_id = delivery.installation_id
      and repository.external_repository_id in (
        select (value #>> '{}')::bigint
        from pg_catalog.jsonb_array_elements(coalesce(delivery.payload -> 'added_repository_ids', '[]'::jsonb))
      );
    update public.github_repositories repository
    set selected = false, last_synced_at = now()
    where repository.installation_id = delivery.installation_id
      and repository.external_repository_id in (
        select (value #>> '{}')::bigint
        from pg_catalog.jsonb_array_elements(coalesce(delivery.payload -> 'removed_repository_ids', '[]'::jsonb))
      );
    event_kind := 'connection.changed'::public.activity_event_type;
    event_description := 'GitHub repository access selection changed';
  elsif delivery.event_name = 'repository' then
    select repository.full_name into previous_repository_full_name
    from public.github_repositories repository
    where repository.installation_id = delivery.installation_id
      and repository.external_repository_id = delivery.external_repository_id;
    if delivery.action = 'deleted' then
      update public.github_repositories set selected = false, disabled = true, last_synced_at = now()
      where installation_id = delivery.installation_id
        and external_repository_id = delivery.external_repository_id;
    else
      update public.github_repositories
      set full_name = coalesce(repository_full_name, full_name),
          owner_login = coalesce(delivery.payload -> 'repository' ->> 'owner_login', owner_login),
          name = coalesce(delivery.payload -> 'repository' ->> 'name', name),
          default_branch = coalesce(delivery.payload -> 'repository' ->> 'default_branch', default_branch),
          archived = coalesce((delivery.payload -> 'repository' ->> 'archived')::boolean, archived),
          disabled = coalesce((delivery.payload -> 'repository' ->> 'disabled')::boolean, disabled),
          visibility = coalesce(delivery.payload -> 'repository' ->> 'visibility', visibility),
          last_synced_at = now()
      where installation_id = delivery.installation_id
        and external_repository_id = delivery.external_repository_id;
      if previous_repository_full_name is not null
        and repository_full_name is not null
        and lower(previous_repository_full_name) <> lower(repository_full_name) then
        update public.projects project
        set github_repository = repository_full_name,
            default_branch = coalesce(delivery.payload -> 'repository' ->> 'default_branch', project.default_branch)
        where lower(project.github_repository) = lower(previous_repository_full_name)
          and exists (
            select 1 from public.project_connections link
            where link.project_id = project.id
              and link.connection_id = delivery.connection_id
          );
      end if;
    end if;
    event_kind := 'connection.changed'::public.activity_event_type;
    event_description := 'GitHub repository metadata changed';
  elsif delivery.event_name = 'push' then
    event_kind := 'project.updated'::public.activity_event_type;
    event_description := 'GitHub push received';
  elsif delivery.event_name = 'pull_request' then
    event_kind := 'project.updated'::public.activity_event_type;
    event_description := 'GitHub pull request changed';
  elsif delivery.event_name in ('check_run', 'check_suite', 'status', 'workflow_run') then
    event_kind := 'project.updated'::public.activity_event_type;
    event_description := 'GitHub check status changed';
  else
    update public.github_webhook_deliveries
    set status = 'ignored', processed_at = now()
    where id = delivery.id;
    return true;
  end if;

  for project_record in
    select project.*
    from public.projects project
    where project.organization_id = delivery.organization_id
      and repository_full_name is not null
      and lower(project.github_repository) = lower(repository_full_name)
  loop
    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type, entity_type,
      entity_id, description, metadata
    ) values (
      delivery.organization_id,
      project_record.id,
      null,
      event_kind,
      'github_webhook_delivery',
      delivery.id,
      event_description,
      actor_metadata || pg_catalog.jsonb_build_object(
        'source', 'github',
        'delivery_id', delivery.external_delivery_id,
        'event', delivery.event_name,
        'action', delivery.action,
        'github_event_type', 'github.' || delivery.event_name || coalesce('.' || delivery.action, ''),
        'repository', repository_full_name
      )
    );
  end loop;

  if delivery.event_name in ('installation', 'installation_repositories') then
    insert into public.activity_events (
      organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
    ) values (
      delivery.organization_id,
      null,
      event_kind,
      'github_webhook_delivery',
      delivery.id,
      event_description,
      actor_metadata || pg_catalog.jsonb_build_object(
        'source', 'github',
        'delivery_id', delivery.external_delivery_id,
        'event', delivery.event_name,
        'action', delivery.action,
        'github_event_type', 'github.' || delivery.event_name || coalesce('.' || delivery.action, ''),
        'installation_id', delivery.external_installation_id
      )
    );
  end if;

  update public.github_webhook_deliveries
  set status = 'processed', processed_at = now()
  where id = delivery.id;
  return true;
end;
$function$;

revoke all on function public.sync_github_installation(uuid, uuid, bigint, bigint, text, bigint, text, text, text, text, text, jsonb, text[], timestamptz, timestamptz, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.complete_github_change_request(uuid, uuid, text, text, text, bigint, integer, text, text) from public, anon, authenticated;
revoke all on function public.fail_github_change_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sync_github_installation(uuid, uuid, bigint, bigint, text, bigint, text, text, text, text, text, jsonb, text[], timestamptz, timestamptz, jsonb, uuid) to service_role;
grant execute on function public.complete_github_change_request(uuid, uuid, text, text, text, bigint, integer, text, text) to service_role;
grant execute on function public.fail_github_change_request(uuid, uuid, text) to service_role;
revoke all on function public.disconnect_github_connection(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.mark_github_connection_lost(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.process_github_webhook_delivery(uuid) from public, anon, authenticated;
grant execute on function public.disconnect_github_connection(uuid, uuid, bigint) to service_role;
grant execute on function public.mark_github_connection_lost(uuid, uuid, text) to service_role;
grant execute on function public.process_github_webhook_delivery(uuid) to service_role;

comment on function public.sync_github_installation(uuid, uuid, bigint, bigint, text, bigint, text, text, text, text, text, jsonb, text[], timestamptz, timestamptz, jsonb, uuid) is
  'Owner/admin-only GitHub App installation and selected-repository metadata sync. Stores no provider credential or installation token.';
comment on function public.complete_github_change_request(uuid, uuid, text, text, text, bigint, integer, text, text) is
  'Records an already-created isolated branch/commit/draft PR and emits the existing immutable pull-request audit event. It cannot merge.';
