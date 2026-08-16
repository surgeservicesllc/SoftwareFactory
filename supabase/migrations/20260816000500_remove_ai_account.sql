-- Removing an account is stronger than disconnecting, and says so.
--
-- Disconnect deletes the sealed credential and keeps the account row for
-- Reconnect. Remove deletes the account itself: its credential, its sessions
-- (by cascade), and the row. Bots that referenced it are kept — the spec's
-- rule is that removing an account must never delete bots — they detach and
-- read "no account attached" until another account is assigned.

create or replace function public.remove_ai_account(
  p_organization_id uuid,
  p_ai_account_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_account record;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to remove an AI account';
  end if;

  select * into v_account
  from public.ai_accounts a
  where a.id = p_ai_account_id and a.organization_id = p_organization_id
  for update;

  if not found then
    return false;
  end if;

  -- Bots survive removal by detaching; the FK would otherwise refuse.
  update public.bots b
  set ai_account_id = null, updated_at = now()
  where b.ai_account_id = p_ai_account_id;

  delete from public.provider_credentials c
  where c.organization_id = p_organization_id
    and c.purpose = v_account.credential_purpose;

  -- Sessions go with the account via the composite FK's cascade.
  delete from public.ai_accounts a where a.id = p_ai_account_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_account', p_ai_account_id,
    format('Removed %s', v_account.display_name),
    pg_catalog.jsonb_build_object('purpose', v_account.credential_purpose)
  );

  return true;
end;
$function$;

revoke all on function public.remove_ai_account(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.remove_ai_account(uuid, uuid) to authenticated;
