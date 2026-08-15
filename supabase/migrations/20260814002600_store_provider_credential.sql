-- Storing a credential that arrived through OAuth rather than a connect code.
--
-- `claim_provider_connect_session` exists for the CLI path, where a one-time
-- code is the authorization and the session row says which organization the
-- credential belongs to. An OAuth callback has neither: the browser arrives
-- from the provider, and the organization comes from the PKCE cookie the server
-- set when the flow began.
--
-- So this is the same write with a different gate. It is callable only by the
-- server's own identity, and the route that calls it has already checked the
-- state parameter against that cookie — which is what proves the callback
-- belongs to the person who started the sign-in.
--
-- Deliberately not callable by `authenticated`. A browser must never be able to
-- put a credential in this table directly; if it could, the seal would be
-- whatever the browser sent, and the whole point of sealing server-side is that
-- the browser never holds the key.

create or replace function public.store_provider_credential(
  p_organization_id uuid,
  p_purpose text,
  p_sealed_envelope text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_existing boolean;
begin
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception using errcode = '42704', message = 'organization not found';
  end if;

  select true into v_existing
  from public.provider_credentials c
  where c.organization_id = p_organization_id and c.purpose = p_purpose;

  insert into public.provider_credentials
    (organization_id, purpose, sealed_envelope, source, created_by)
  values (
    p_organization_id, p_purpose, p_sealed_envelope, 'connect_session',
    -- The OAuth callback has no `auth.uid()`: it is a top-level navigation from
    -- another site, so the session cookie is not guaranteed to travel. The
    -- organization's creator stands in as the recorded actor, and the activity
    -- event below names the mechanism so the trail is not misleading.
    (select o.created_by from public.organizations o where o.id = p_organization_id)
  )
  on conflict (organization_id, purpose) do update
    set sealed_envelope = excluded.sealed_envelope,
        rotated_at = now(),
        -- A replaced credential has not been verified yet.
        last_verified_at = null;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, null, 'connection.changed', 'provider_credential', null,
    format('%s %s through provider sign-in',
           case when v_existing then 'Replaced' else 'Connected' end, p_purpose),
    jsonb_build_object('purpose', p_purpose, 'mechanism', 'oauth')
  );

  return true;
end;
$function$;

comment on function public.store_provider_credential(uuid, text, text) is
  'Stores a sealed credential obtained through an OAuth callback. Server-only: a browser must never write this table directly, or the seal would be whatever the browser sent.';

revoke all on function public.store_provider_credential(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.store_provider_credential(uuid, text, text) to service_role;
