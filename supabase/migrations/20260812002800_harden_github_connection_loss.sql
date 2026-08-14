-- Make discovered GitHub connection loss truthful and terminal-safe.
--
-- `mark_github_connection_lost` records the loss a server discovers when GitHub
-- refuses an installation token: the App was revoked, or its permissions are no
-- longer sufficient. Three shapes were wrong.
--
-- 1. Moving the installation to `error` left `suspended_at` set, so surfaces
--    kept reporting "The GitHub App installation is suspended." after the real
--    latest evidence was a revocation or a permission loss.
-- 2. A terminally deleted installation tripped the terminal-deletion trigger,
--    aborting the whole call. Both callers swallow that failure, so the loss was
--    recorded nowhere even though the discovery was real.
-- 3. A GitHub connection with no installation row wrote an activity event
--    against `github_installation` with a null entity id.
--
-- The connection itself is always moved to the lost state, because that is the
-- fact the server actually observed. Prior installation state is preserved as
-- activity metadata rather than left behind as a misleading column value.

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
  installation_is_terminal boolean := false;
  previous_status text;
  previous_suspended_at timestamptz;
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
  from public.github_installations
  where connection_id = connection_record.id
  for update;

  if found then
    previous_status := installation_record.status;
    previous_suspended_at := installation_record.suspended_at;
    installation_is_terminal := installation_record.status = 'deleted'
      or installation_record.deleted_at is not null;
  end if;

  update public.connections
  set status = 'error'::public.connection_status,
      error_message = 'GitHub Connection Lost',
      last_verified_at = now()
  where id = connection_record.id;

  -- Provider deletion is terminal for an installation id. A later discovery
  -- cannot move it back to `error`, and it does not need to: `deleted` already
  -- refuses every new GitHub operation.
  if installation_record.id is not null and not installation_is_terminal then
    update public.github_installations
    set status = 'error',
        suspended_at = null,
        last_synced_at = now()
    where id = installation_record.id;

    update public.github_repositories
    set selected = false, last_synced_at = now()
    where installation_id = installation_record.id;
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    connection_record.organization_id,
    p_actor_user_id,
    'connection.changed'::public.activity_event_type,
    case when installation_record.id is null then 'connection' else 'github_installation' end,
    coalesce(installation_record.id, connection_record.id),
    'GitHub connection lost',
    pg_catalog.jsonb_build_object(
      'connection_id', connection_record.id,
      'installation_id', installation_record.external_installation_id,
      'reason', p_reason,
      'previous_installation_status', previous_status,
      'previous_suspended_at', previous_suspended_at,
      'installation_state_retained', installation_is_terminal,
      'github_event_type', 'github.connection_lost'
    )
  );
  return true;
end;
$function$;

revoke all on function public.mark_github_connection_lost(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_github_connection_lost(uuid, uuid, text)
  to service_role;

comment on function public.mark_github_connection_lost(uuid, uuid, text) is
  'Records server-discovered GitHub connection loss. Clears a stale suspension marker so the reported reason matches the latest evidence, leaves a terminally deleted installation untouched, and preserves prior installation state as activity metadata.';
