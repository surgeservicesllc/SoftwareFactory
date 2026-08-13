-- Serialize repository metadata webhooks by provider time so delayed rename,
-- archive, or delete events cannot restore stale state. Installation ordering
-- remains enforced by migration 016.

alter table public.github_repositories
  add column provider_deleted_at timestamptz;

comment on column public.github_repositories.provider_deleted_at is
  'Provider timestamp of the latest applied repository deletion. Only a newer explicit restored event can clear it.';

alter function public.process_github_webhook_delivery(uuid)
  rename to process_github_webhook_delivery_v016;

revoke all on function public.process_github_webhook_delivery_v016(uuid)
  from public, anon, authenticated, service_role;

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
  repository_record public.github_repositories%rowtype;
  repository_payload jsonb;
  provider_event_at timestamptz;
  transition_outcome text;
  event_description text;
begin
  select * into delivery
  from public.github_webhook_deliveries
  where id = p_delivery_id
  for update;
  if not found then return false; end if;
  if delivery.status <> 'accepted' then return true; end if;

  if delivery.event_name <> 'repository' then
    return public.process_github_webhook_delivery_v016(p_delivery_id);
  end if;

  select installation.status, installation.deleted_at
  into installation_status, installation_deleted_at
  from public.github_installations installation
  where installation.id = delivery.installation_id
    and installation.organization_id = delivery.organization_id
  for update;

  repository_payload := delivery.payload -> 'repository';
  begin
    provider_event_at := nullif(repository_payload ->> 'updated_at', '')::timestamptz;
  exception when others then
    provider_event_at := null;
  end;

  select * into repository_record
  from public.github_repositories repository
  where repository.installation_id = delivery.installation_id
    and repository.organization_id = delivery.organization_id
    and repository.external_repository_id = delivery.external_repository_id
  for update;

  if installation_status = 'deleted' or installation_deleted_at is not null then
    transition_outcome := 'ignored_terminal_installation';
    event_description := 'Ignored GitHub repository event for deleted installation';
  elsif repository_record.id is null then
    transition_outcome := 'ignored_missing_repository';
    event_description := 'Ignored GitHub event for unknown repository';
  elsif provider_event_at is null then
    transition_outcome := 'ignored_missing_provider_time';
    event_description := 'Ignored GitHub repository event without provider ordering evidence';
  elsif delivery.action = 'deleted' then
    if provider_event_at < repository_record.github_updated_at then
      transition_outcome := 'ignored_out_of_order';
      event_description := 'Ignored stale GitHub repository deletion';
    else
      update public.github_repositories
      set selected = false,
          disabled = true,
          provider_deleted_at = provider_event_at,
          github_updated_at = provider_event_at,
          last_synced_at = now()
      where id = repository_record.id;
      transition_outcome := 'terminal_deleted';
      event_description := 'GitHub repository deleted';
    end if;
  elsif repository_record.provider_deleted_at is not null
    and delivery.action <> 'restored' then
    transition_outcome := 'ignored_terminal_deleted';
    event_description := 'Ignored GitHub event for deleted repository';
  elsif provider_event_at <= repository_record.github_updated_at then
    transition_outcome := 'ignored_out_of_order';
    event_description := 'Ignored stale GitHub repository event';
  else
    update public.github_repositories
    set full_name = coalesce(repository_payload ->> 'full_name', full_name),
        owner_login = coalesce(repository_payload ->> 'owner_login', owner_login),
        name = coalesce(repository_payload ->> 'name', name),
        default_branch = coalesce(repository_payload ->> 'default_branch', default_branch),
        archived = coalesce((repository_payload ->> 'archived')::boolean, archived),
        disabled = case
          when delivery.action = 'restored' then false
          else coalesce((repository_payload ->> 'disabled')::boolean, disabled)
        end,
        selected = case when delivery.action = 'restored' then false else selected end,
        visibility = coalesce(repository_payload ->> 'visibility', visibility),
        provider_deleted_at = case when delivery.action = 'restored' then null else provider_deleted_at end,
        github_updated_at = provider_event_at,
        last_synced_at = now()
    where id = repository_record.id;
    transition_outcome := case when delivery.action = 'restored' then 'restored_unselected' else 'applied' end;
    event_description := case
      when delivery.action = 'restored' then 'GitHub repository restored pending access synchronization'
      else 'GitHub repository metadata changed'
    end;
  end if;

  insert into public.activity_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    delivery.organization_id,
    null,
    'connection.changed'::public.activity_event_type,
    'github_webhook_delivery',
    delivery.id,
    event_description,
    pg_catalog.jsonb_build_object(
      'source', 'github',
      'delivery_id', delivery.external_delivery_id,
      'event', delivery.event_name,
      'action', delivery.action,
      'installation_id', delivery.external_installation_id,
      'repository_id', delivery.external_repository_id,
      'state_transition', transition_outcome
    )
  );

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
  'Processes verified GitHub deliveries with terminal installation deletion and provider-ordered repository metadata transitions. It stores no provider credentials.';
comment on function public.process_github_webhook_delivery_v016(uuid) is
  'Private migration-016 processor used only by the current repository-ordering wrapper for non-repository events.';
