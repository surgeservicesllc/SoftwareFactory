-- Preserve provider deletion as a terminal state for a GitHub installation id.
-- GitHub issues a new installation id after a genuine reinstall; delayed events
-- or an ordinary synchronization for the deleted id must never reactivate it.

alter table public.github_installations
  add column last_provider_event_at timestamptz;

comment on column public.github_installations.last_provider_event_at is
  'Newest provider-supplied installation event timestamp applied to this row. Arrival time is not used as provider ordering evidence.';

-- Repair the exact inconsistent shape possible before this migration: a delayed
-- unsuspend could set status=active while retaining the terminal deleted_at marker.
insert into public.activity_events (
  organization_id,
  actor_user_id,
  event_type,
  entity_type,
  entity_id,
  description,
  metadata
)
select
  installation.organization_id,
  null,
  'connection.changed'::public.activity_event_type,
  'github_installation',
  installation.id,
  'Reconciled terminal GitHub installation deletion state',
  pg_catalog.jsonb_build_object(
    'connection_id', installation.connection_id,
    'installation_id', installation.external_installation_id,
    'status_from', installation.status,
    'status_to', 'deleted',
    'github_event_type', 'github.installation.deletion_reconciled'
  )
from public.github_installations installation
where installation.deleted_at is not null
  and installation.status <> 'deleted';

update public.github_installations
set status = 'deleted',
    suspended_at = null,
    last_provider_event_at = greatest(last_provider_event_at, deleted_at)
where deleted_at is not null;

update public.connections connection
set status = 'error'::public.connection_status,
    error_message = 'GitHub Connection Lost'
where connection.provider = 'github'::public.connection_provider
  and exists (
    select 1
    from public.github_installations installation
    where installation.connection_id = connection.id
      and installation.organization_id = connection.organization_id
      and installation.status = 'deleted'
      and installation.deleted_at is not null
  )
  and (
    connection.status <> 'error'::public.connection_status
    or connection.error_message is distinct from 'GitHub Connection Lost'
  );

update public.github_repositories repository
set selected = false,
    last_synced_at = now()
where repository.selected
  and exists (
    select 1
    from public.github_installations installation
    where installation.id = repository.installation_id
      and installation.organization_id = repository.organization_id
      and installation.status = 'deleted'
      and installation.deleted_at is not null
  );

alter table public.github_installations
  add constraint github_installations_deleted_marker_consistent
  check ((status = 'deleted') = (deleted_at is not null)) not valid;

alter table public.github_installations
  validate constraint github_installations_deleted_marker_consistent;

create or replace function public.enforce_github_installation_terminal_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if old.status = 'deleted' or old.deleted_at is not null then
    if new.status <> 'deleted'
      or new.deleted_at is distinct from old.deleted_at then
      raise exception using
        errcode = '55000',
        message = 'deleted GitHub installation ids are terminal; use a new provider installation';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_github_installation_terminal_deletion()
  from public, anon, authenticated, service_role;

create trigger github_installations_terminal_deletion
  before update on public.github_installations
  for each row execute function public.enforce_github_installation_terminal_deletion();

create or replace function public.process_github_webhook_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  delivery public.github_webhook_deliveries%rowtype;
  installation_status text;
  installation_deleted_at timestamptz;
  installation_provider_event_at timestamptz;
  provider_event_at timestamptz;
  project_record public.projects%rowtype;
  event_kind public.activity_event_type;
  event_description text;
  repository_full_name text;
  previous_repository_full_name text;
  actor_metadata jsonb;
  transition_outcome text := 'processed';
begin
  select * into delivery
  from public.github_webhook_deliveries
  where id = p_delivery_id
  for update;
  if not found then return false; end if;
  if delivery.status <> 'accepted' then return true; end if;

  select installation.status, installation.deleted_at, installation.last_provider_event_at
  into installation_status, installation_deleted_at, installation_provider_event_at
  from public.github_installations installation
  where installation.id = delivery.installation_id
    and installation.organization_id = delivery.organization_id
  for update;
  if not found then
    update public.github_webhook_deliveries
    set status = 'ignored',
        processed_at = now(),
        metadata = metadata || pg_catalog.jsonb_build_object('state_transition', 'ignored_missing_installation')
    where id = delivery.id;
    return true;
  end if;

  if nullif(delivery.payload ->> 'installation_updated_at', '') is not null then
    provider_event_at := (delivery.payload ->> 'installation_updated_at')::timestamptz;
  end if;

  repository_full_name := delivery.payload -> 'repository' ->> 'full_name';
  actor_metadata := case
    when delivery.payload -> 'sender' is null or delivery.payload -> 'sender' = 'null'::jsonb
      then '{}'::jsonb
    else pg_catalog.jsonb_build_object('github_actor', delivery.payload -> 'sender')
  end;

  -- Deleted is terminal for the same provider installation id. A genuine
  -- reinstall arrives with a new id and is synchronized as a new row.
  if (installation_status = 'deleted' or installation_deleted_at is not null)
    and not (delivery.event_name = 'installation' and delivery.action = 'deleted') then
    event_kind := 'connection.changed'::public.activity_event_type;
    event_description := 'Ignored GitHub event for deleted installation';
    transition_outcome := 'ignored_terminal_deleted';
  elsif delivery.event_name = 'installation' then
    if delivery.action = 'deleted' then
      update public.connections
      set status = 'error'::public.connection_status,
          error_message = 'GitHub Connection Lost',
          last_verified_at = now()
      where id = delivery.connection_id;
      update public.github_installations
      set status = 'deleted',
          suspended_at = null,
          deleted_at = coalesce(deleted_at, provider_event_at, delivery.received_at),
          last_provider_event_at = greatest(last_provider_event_at, provider_event_at),
          last_synced_at = now()
      where id = delivery.installation_id;
      update public.github_repositories
      set selected = false, last_synced_at = now()
      where installation_id = delivery.installation_id;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation deleted';
      transition_outcome := 'terminal_deleted';
    elsif provider_event_at is not null
      and installation_provider_event_at is not null
      and provider_event_at <= installation_provider_event_at then
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'Ignored stale GitHub installation event';
      transition_outcome := 'ignored_out_of_order';
    elsif delivery.action = 'suspend' then
      update public.connections
      set status = 'error'::public.connection_status,
          error_message = 'GitHub installation is suspended.',
          last_verified_at = now()
      where id = delivery.connection_id;
      update public.github_installations
      set status = 'suspended',
          suspended_at = coalesce(provider_event_at, delivery.received_at),
          deleted_at = null,
          last_provider_event_at = coalesce(provider_event_at, last_provider_event_at),
          last_synced_at = now()
      where id = delivery.installation_id;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation suspended';
      transition_outcome := 'applied';
    elsif delivery.action = 'unsuspend' then
      update public.connections
      set status = 'connected'::public.connection_status,
          error_message = null,
          last_verified_at = now()
      where id = delivery.connection_id;
      update public.github_installations
      set status = 'active',
          suspended_at = null,
          deleted_at = null,
          last_provider_event_at = coalesce(provider_event_at, last_provider_event_at),
          last_synced_at = now()
      where id = delivery.installation_id;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation unsuspended';
      transition_outcome := 'applied';
    else
      if provider_event_at is not null then
        update public.github_installations
        set last_provider_event_at = provider_event_at,
            last_synced_at = now()
        where id = delivery.installation_id;
      end if;
      event_kind := 'connection.changed'::public.activity_event_type;
      event_description := 'GitHub App installation changed';
      transition_outcome := 'observed';
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
      update public.github_repositories
      set selected = false, disabled = true, last_synced_at = now()
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
        and pg_catalog.lower(previous_repository_full_name) <> pg_catalog.lower(repository_full_name) then
        update public.projects project
        set github_repository = repository_full_name,
            default_branch = coalesce(delivery.payload -> 'repository' ->> 'default_branch', project.default_branch)
        where pg_catalog.lower(project.github_repository) = pg_catalog.lower(previous_repository_full_name)
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
    set status = 'ignored',
        processed_at = now(),
        metadata = metadata || pg_catalog.jsonb_build_object('state_transition', 'ignored_event')
    where id = delivery.id;
    return true;
  end if;

  for project_record in
    select project.*
    from public.projects project
    where project.organization_id = delivery.organization_id
      and repository_full_name is not null
      and pg_catalog.lower(project.github_repository) = pg_catalog.lower(repository_full_name)
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
        'repository', repository_full_name,
        'state_transition', transition_outcome
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
        'installation_id', delivery.external_installation_id,
        'state_transition', transition_outcome
      )
    );
  end if;

  update public.github_webhook_deliveries
  set status = 'processed',
      processed_at = now(),
      metadata = metadata || pg_catalog.jsonb_build_object('state_transition', transition_outcome)
  where id = delivery.id;
  return true;
end;
$function$;

revoke all on function public.process_github_webhook_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.process_github_webhook_delivery(uuid)
  to service_role;

comment on function public.process_github_webhook_delivery(uuid) is
  'Idempotently processes verified, redacted GitHub delivery metadata; provider timestamps reject stale installation transitions and deletion is terminal for an installation id.';
