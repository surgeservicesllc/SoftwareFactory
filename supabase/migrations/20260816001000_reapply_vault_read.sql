-- Re-apply the vault read exactly as the repository defines it.
--
-- The hosted copy of read_provider_credential arrived through the unledgered
-- drift era and refuses the worker with 42501 (live evidence: run
-- 31964228761, "Verification sweep skipped: Reading the stored credential
-- failed (42501)"), so connected accounts can never re-verify. This restates
-- the current definition and its grants — create-or-replace plus grants,
-- idempotent, nothing else touched. What it returns is still sealed;
-- opening the envelope needs SOFTWAREFACTORY_CREDENTIAL_KEY, which lives
-- outside the database entirely.

create or replace function public.read_provider_credential(
  p_organization_id uuid,
  p_purpose text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_envelope text;
begin
  select c.sealed_envelope into v_envelope
  from public.provider_credentials c
  where c.organization_id = p_organization_id and c.purpose = p_purpose;

  return v_envelope;
end;
$function$;

revoke all on function public.read_provider_credential(uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_provider_credential(uuid, text) to service_role;
