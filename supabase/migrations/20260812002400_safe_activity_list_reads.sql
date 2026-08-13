-- Close direct browser access to raw immutable activity metadata. The only
-- authenticated read surface is a caller-bound, tenant-member RPC whose
-- evidence JSON is rebuilt from bounded allowlisted scalar fields.

revoke select on table public.activity_events from authenticated;
revoke select on table public.github_webhook_deliveries from authenticated;

create or replace function public.activity_safe_scalar(
  p_value jsonb,
  p_maximum_length integer
)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_maximum_length between 1 and 1024
      and pg_catalog.jsonb_typeof(p_value) in ('string', 'number', 'boolean')
      and pg_catalog.char_length(pg_catalog.btrim(p_value #>> '{}'))
        between 1 and p_maximum_length
      and pg_catalog.btrim(p_value #>> '{}') !~ '[[:cntrl:]]'
    then pg_catalog.btrim(p_value #>> '{}')
    else null
  end;
$function$;

create or replace function public.safe_activity_evidence(p_metadata jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog
as $function$
  with safe as (
    select
      public.activity_safe_scalar(p_metadata -> 'action', 160) as action,
      public.activity_safe_scalar(p_metadata -> 'operation', 160) as operation,
      public.activity_safe_scalar(p_metadata -> 'conclusion', 160) as conclusion,
      public.activity_safe_scalar(p_metadata -> 'source', 64) as source,
      public.activity_safe_scalar(p_metadata -> 'provider', 64) as provider,
      public.activity_safe_scalar(p_metadata -> 'github_event_type', 160) as github_event_type,
      public.activity_safe_scalar(p_metadata -> 'state_transition', 160) as state_transition,
      public.activity_safe_scalar(p_metadata -> 'from', 80) as state_from,
      public.activity_safe_scalar(p_metadata -> 'to', 80) as state_to,
      public.activity_safe_scalar(p_metadata -> 'status', 160) as status,
      public.activity_safe_scalar(p_metadata -> 'decision', 160) as decision,
      public.activity_safe_scalar(p_metadata -> 'repository', 160) as repository,
      public.activity_safe_scalar(p_metadata -> 'repository_id', 160) as repository_id,
      public.activity_safe_scalar(p_metadata -> 'github_repository_id', 160) as github_repository_id,
      public.activity_safe_scalar(p_metadata -> 'installation_id', 160) as installation_id,
      public.activity_safe_scalar(p_metadata -> 'connection_id', 160) as connection_id,
      public.activity_safe_scalar(p_metadata -> 'delivery_id', 160) as delivery_id,
      public.activity_safe_scalar(p_metadata -> 'pull_request_number', 160) as pull_request_number,
      public.activity_safe_scalar(p_metadata -> 'number', 160) as number,
      public.activity_safe_scalar(p_metadata -> 'command_id', 160) as command_id,
      public.activity_safe_scalar(p_metadata -> 'task_id', 160) as task_id,
      public.activity_safe_scalar(p_metadata -> 'agent_id', 160) as agent_id,
      public.activity_safe_scalar(p_metadata -> 'rollback_of_deployment_id', 160) as rollback_of_deployment_id,
      public.activity_safe_scalar(p_metadata -> 'commit_sha', 160) as commit_sha,
      public.activity_safe_scalar(p_metadata -> 'head_branch', 160) as head_branch,
      public.activity_safe_scalar(p_metadata -> 'resource_type', 64) as resource_type,
      public.activity_safe_scalar(p_metadata -> 'external_resource_id', 160) as external_resource_id,
      public.activity_safe_scalar(p_metadata -> 'resource_number', 32) as resource_number,
      public.activity_safe_scalar(p_metadata -> 'github_actor' -> 'login', 39) as github_actor_login
  )
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'action', coalesce(safe.action, safe.operation),
    'conclusion', safe.conclusion,
    'source', case
      when pg_catalog.lower(safe.source) in ('github', 'github_repository_sync')
        or pg_catalog.lower(safe.provider) = 'github'
        or pg_catalog.lower(safe.github_event_type) like 'github.%'
      then 'github'
      else 'softwarefactory'
    end,
    'state_transition', coalesce(
      safe.state_transition,
      case
        when safe.state_from is not null and safe.state_to is not null
        then safe.state_from || ' -> ' || safe.state_to
        else null
      end
    ),
    'status', coalesce(safe.status, safe.decision),
    'repository', safe.repository,
    'repository_id', safe.repository_id,
    'github_repository_id', safe.github_repository_id,
    'installation_id', safe.installation_id,
    'connection_id', safe.connection_id,
    'delivery_id', safe.delivery_id,
    'pull_request_number', safe.pull_request_number,
    'number', safe.number,
    'command_id', safe.command_id,
    'task_id', safe.task_id,
    'agent_id', safe.agent_id,
    'rollback_of_deployment_id', safe.rollback_of_deployment_id,
    'commit_sha', safe.commit_sha,
    'head_branch', safe.head_branch,
    'resource_type', safe.resource_type,
    'external_resource_id', safe.external_resource_id,
    'resource_number', safe.resource_number,
    'github_actor', case
      when safe.github_actor_login ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
      then pg_catalog.jsonb_build_object('login', safe.github_actor_login)
      else null
    end
  ))
  from safe;
$function$;

create or replace function public.list_activity(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  actor_user_id uuid,
  actor_display_name text,
  event_type public.activity_event_type,
  entity_type text,
  entity_id uuid,
  description text,
  evidence jsonb,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    activity.id,
    activity.project_id,
    pg_catalog.left(project.name, 160),
    activity.actor_user_id,
    pg_catalog.left(profile.display_name, 120),
    activity.event_type,
    pg_catalog.left(activity.entity_type, 63),
    activity.entity_id,
    pg_catalog.left(activity.description, 500),
    public.safe_activity_evidence(activity.metadata),
    activity.occurred_at
  from public.activity_events activity
  left join public.projects project
    on project.id = activity.project_id
   and project.organization_id = activity.organization_id
  left join public.organization_members actor_membership
    on actor_membership.organization_id = activity.organization_id
   and actor_membership.user_id = activity.actor_user_id
  left join public.profiles profile
    on profile.id = actor_membership.user_id
  where activity.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by activity.occurred_at desc, activity.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

revoke all on function public.activity_safe_scalar(jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.safe_activity_evidence(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.list_activity(uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.list_activity(uuid, integer) to authenticated;

comment on function public.list_activity(uuid, integer) is
  'Caller-bound, tenant-member activity list. Raw metadata remains inaccessible; evidence is rebuilt from bounded allowlisted scalar fields.';
comment on function public.safe_activity_evidence(jsonb) is
  'Internal projection helper that discards unknown, nested, control-character, and oversized activity metadata values.';
