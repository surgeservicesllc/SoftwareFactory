-- The verification loop's two hands: what to check, and how to record a pass.
--
-- An account that says "connected" is making a claim about the vault: that a
-- sealed credential exists under its purpose, opens under the current master
-- key, and is shaped like the kind of credential it says it is. The worker's
-- sweep re-tests that claim on every run. What it cannot test — whether the
-- provider still honors the token — stays out of these semantics on purpose:
-- a passed sweep updates `last_verified_at` and clears the last error; only a
-- named failure (missing row, unopenable seal, wrong shape, or a provider
-- refusal observed during real use) demotes, through the existing
-- `mark_ai_account_needs_reauth`.

-- Which accounts are worth sweeping: subscription accounts currently claiming
-- to be connected. Pending accounts have no credential yet; disconnected and
-- revoked ones deliberately have none; needs_reauth already carries its
-- verdict and is repaired by a person reconnecting, not by a sweep that can
-- only prove the seal opens.
create or replace function public.list_ai_accounts_for_verification()
returns table (
  verifiable_organization_id uuid,
  verifiable_account_id uuid,
  verifiable_provider public.bot_provider,
  verifiable_purpose text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  return query
  select a.organization_id, a.id, a.provider, a.credential_purpose
  from public.ai_accounts a
  where a.auth_method = 'subscription' and a.status = 'connected'
  order by a.organization_id, a.created_at;
end;
$function$;

revoke all on function public.list_ai_accounts_for_verification()
  from public, anon, authenticated;
grant execute on function public.list_ai_accounts_for_verification() to service_role;

-- A routine pass is a timestamp, not a transition: no activity event, because
-- an hourly "still fine" row per account would bury the events that matter.
-- The demotion path (mark_ai_account_needs_reauth) writes one, as before.
create or replace function public.mark_ai_account_verified(
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
  v_updated integer;
begin
  update public.ai_accounts a
  set last_verified_at = now(), last_error = null, updated_at = now()
  where a.id = p_ai_account_id
    and a.organization_id = p_organization_id
    and a.status = 'connected';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

revoke all on function public.mark_ai_account_verified(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_ai_account_verified(uuid, uuid) to service_role;
