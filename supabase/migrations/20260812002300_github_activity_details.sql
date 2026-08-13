-- Persist bounded, provider-authenticated GitHub activity evidence. The raw
-- webhook body is never copied into activity_events: only the explicitly
-- allowlisted identifiers and state fields retained by the webhook route are
-- projected here. Project attribution uses the immutable repository binding
-- introduced in migration 021, never a mutable repository name.

create or replace function public.enrich_github_webhook_activity_details()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  delivery public.github_webhook_deliveries%rowtype;
  repository_id uuid;
  actor_details jsonb := '{}'::jsonb;
  activity_details jsonb;
  transition_outcome text;
begin
  if new.entity_type <> 'github_webhook_delivery' or new.entity_id is null then
    return new;
  end if;

  select * into delivery
  from public.github_webhook_deliveries
  where id = new.entity_id;
  if not found then
    return new;
  end if;
  if delivery.organization_id is distinct from new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'GitHub webhook activity organization does not match its delivery';
  end if;

  select repository.id into repository_id
  from public.github_repositories repository
  where repository.organization_id = delivery.organization_id
    and repository.installation_id = delivery.installation_id
    and repository.external_repository_id = delivery.external_repository_id;

  -- Older processors selected projects by mutable repository name. Suppress a
  -- mismatched project event; the delivery transition trigger below inserts
  -- the event for every exact stable binding after processing completes.
  if new.project_id is not null
    and delivery.event_name in (
      'push', 'pull_request', 'check_run', 'check_suite', 'status', 'workflow_run'
    )
    and (
      repository_id is null
      or not exists (
        select 1
        from public.project_connections link
        where link.organization_id = delivery.organization_id
          and link.project_id = new.project_id
          and link.connection_id = delivery.connection_id
          and link.github_repository_id = repository_id
      )
    ) then
    return null;
  end if;

  if delivery.payload -> 'sender' is not null
    and delivery.payload -> 'sender' <> 'null'::jsonb then
    actor_details := pg_catalog.jsonb_build_object(
      'github_actor',
      pg_catalog.jsonb_build_object(
        'id', delivery.payload -> 'sender' -> 'id',
        'login', pg_catalog.left(delivery.payload -> 'sender' ->> 'login', 100)
      )
    );
  end if;

  transition_outcome := coalesce(
    nullif(new.metadata ->> 'state_transition', ''),
    nullif(delivery.metadata ->> 'state_transition', ''),
    'processed'
  );
  activity_details := actor_details || pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'source', 'github',
      'delivery_id', delivery.external_delivery_id,
      'event', delivery.event_name,
      'action', delivery.action,
      'github_event_type', 'github.' || delivery.event_name
        || coalesce('.' || delivery.action, ''),
      'installation_id', delivery.external_installation_id,
      'github_repository_id', repository_id,
      'repository_id', delivery.external_repository_id,
      'repository', pg_catalog.left(delivery.payload -> 'repository' ->> 'full_name', 201),
      'state_transition', transition_outcome
    )
  );

  if delivery.event_name = 'pull_request' then
    activity_details := activity_details || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'resource_type', 'pull_request',
        'external_resource_id', delivery.payload -> 'pull_request' -> 'id',
        'resource_number', delivery.payload -> 'pull_request' -> 'number',
        'status', pg_catalog.left(delivery.payload -> 'pull_request' ->> 'state', 32),
        'draft', delivery.payload -> 'pull_request' -> 'draft'
      )
    );
  elsif delivery.event_name in ('check_run', 'check_suite', 'workflow_run') then
    activity_details := activity_details || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'resource_type', delivery.event_name,
        'external_resource_id', delivery.payload -> delivery.event_name -> 'id',
        'status', pg_catalog.left(delivery.payload -> delivery.event_name ->> 'status', 32),
        'conclusion', pg_catalog.left(delivery.payload -> delivery.event_name ->> 'conclusion', 32)
      )
    );
  elsif delivery.event_name = 'status' then
    activity_details := activity_details || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'resource_type', 'commit',
        'external_resource_id', pg_catalog.left(delivery.payload -> 'commit_status' ->> 'sha', 64),
        'commit_sha', pg_catalog.left(delivery.payload -> 'commit_status' ->> 'sha', 64),
        'status', pg_catalog.left(delivery.payload -> 'commit_status' ->> 'state', 32)
      )
    );
  elsif delivery.event_name = 'push' then
    activity_details := activity_details || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'resource_type', 'commit',
        'external_resource_id', pg_catalog.left(delivery.payload ->> 'after', 64),
        'commit_sha', pg_catalog.left(delivery.payload ->> 'after', 64),
        'git_ref', pg_catalog.left(delivery.payload ->> 'ref', 512)
      )
    );
  elsif delivery.event_name = 'repository' then
    activity_details := activity_details || pg_catalog.jsonb_build_object(
      'resource_type', 'repository',
      'external_resource_id', delivery.external_repository_id
    );
  elsif delivery.event_name in ('installation', 'installation_repositories') then
    activity_details := activity_details || pg_catalog.jsonb_build_object(
      'resource_type', 'installation',
      'external_resource_id', delivery.external_installation_id
    );
  end if;

  new.metadata := activity_details;
  return new;
end;
$function$;

revoke all on function public.enrich_github_webhook_activity_details()
  from public, anon, authenticated, service_role;

create trigger activity_events_github_webhook_details
  before insert on public.activity_events
  for each row execute function public.enrich_github_webhook_activity_details();

create or replace function public.record_stably_bound_github_project_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  repository_id uuid;
  linked_project record;
  event_description text;
begin
  if new.organization_id is null
    or new.connection_id is null
    or new.installation_id is null
    or new.external_repository_id is null
    or new.event_name not in (
      'push', 'pull_request', 'check_run', 'check_suite', 'status', 'workflow_run'
    ) then
    return new;
  end if;

  select repository.id into repository_id
  from public.github_repositories repository
  where repository.organization_id = new.organization_id
    and repository.installation_id = new.installation_id
    and repository.external_repository_id = new.external_repository_id;
  if repository_id is null then
    return new;
  end if;

  event_description := case
    when new.event_name = 'push' then 'GitHub push received'
    when new.event_name = 'pull_request' then 'GitHub pull request changed'
    else 'GitHub check status changed'
  end;

  for linked_project in
    select project.id
    from public.project_connections link
    join public.projects project
      on project.id = link.project_id
     and project.organization_id = link.organization_id
    where link.organization_id = new.organization_id
      and link.connection_id = new.connection_id
      and link.github_repository_id = repository_id
  loop
    if not exists (
      select 1
      from public.activity_events activity
      where activity.organization_id = new.organization_id
        and activity.project_id = linked_project.id
        and activity.entity_type = 'github_webhook_delivery'
        and activity.entity_id = new.id
    ) then
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
        'github_webhook_delivery',
        new.id,
        event_description,
        pg_catalog.jsonb_build_object(
          'state_transition', coalesce(nullif(new.metadata ->> 'state_transition', ''), 'processed')
        )
      );
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function public.record_stably_bound_github_project_activity()
  from public, anon, authenticated, service_role;

create trigger github_webhook_deliveries_record_project_activity
  after update of status on public.github_webhook_deliveries
  for each row
  when (old.status = 'accepted' and new.status = 'processed')
  execute function public.record_stably_bound_github_project_activity();

comment on function public.enrich_github_webhook_activity_details() is
  'Trigger-only allowlist projection of verified GitHub delivery identity and state into immutable activity evidence.';
comment on function public.record_stably_bound_github_project_activity() is
  'Trigger-only activity attribution for projects bound to the exact immutable GitHub repository identity.';
