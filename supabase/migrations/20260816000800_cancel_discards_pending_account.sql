-- Cancelling a sign-in discards an account that was only ever provisional.
--
-- Connect provisions the account row before the person has signed in; a
-- cancel used to revoke the session and leave that never-connected row
-- behind as clutter the owner then had to Remove by hand. The rule the
-- owner set: cancel stores nothing. An account still in 'pending' — never
-- connected, never holding a credential — is deleted with its sessions when
-- its sign-in is cancelled. An account that has ever connected (Reconnect
-- flows: connected, needs_reauth, disconnected) is never touched by cancel.
--
-- Idempotent: this file is on the surgical apply path and may be replayed.

create or replace function public.cancel_ai_auth_session(
  p_organization_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_session record;
  v_account record;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to cancel a sign-in';
  end if;

  select * into v_session
  from public.ai_auth_sessions s
  where s.id = p_session_id and s.organization_id = p_organization_id
  for update;

  if not found or v_session.status in ('connected', 'failed', 'expired', 'revoked') then
    return false;
  end if;

  update public.ai_auth_sessions
  set status = 'revoked', updated_at = now()
  where id = p_session_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_auth_session', p_session_id,
    'Sign-in cancelled',
    pg_catalog.jsonb_build_object('ai_account_id', v_session.ai_account_id)
  );

  -- The discard: a pending account has never connected and holds no
  -- credential — cancelling its sign-in deletes it whole (sessions cascade,
  -- bots detach by the same rule Remove enforces). Any other status means
  -- the account predates this attempt and stays.
  select * into v_account
  from public.ai_accounts a
  where a.id = v_session.ai_account_id
    and a.organization_id = p_organization_id
  for update;

  if found and v_account.status = 'pending' then
    update public.bots b
    set ai_account_id = null, updated_at = now()
    where b.ai_account_id = v_account.id;

    delete from public.provider_credentials c
    where c.organization_id = p_organization_id
      and c.purpose = v_account.credential_purpose;

    delete from public.ai_accounts a where a.id = v_account.id;

    insert into public.activity_events
      (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
    values (
      p_organization_id, v_actor, 'ai_account.changed', 'ai_account', v_account.id,
      pg_catalog.format('Discarded %s — sign-in cancelled before it ever connected', v_account.display_name),
      pg_catalog.jsonb_build_object('purpose', v_account.credential_purpose)
    );
  end if;

  return true;
end;
$function$;

revoke all on function public.cancel_ai_auth_session(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.cancel_ai_auth_session(uuid, uuid) to authenticated;
