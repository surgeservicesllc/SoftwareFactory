-- Close direct authenticated mutation paths that bypass the audited workflows.
-- Organization onboarding remains available through its SECURITY DEFINER RPC;
-- GitHub disconnect remains available through its service-role-only RPC.

drop policy if exists connections_delete_owners on public.connections;
revoke delete on table public.connections from authenticated;

drop policy if exists organization_members_insert_managers on public.organization_members;
drop policy if exists organization_members_update_managers on public.organization_members;
drop policy if exists organization_members_delete_owners on public.organization_members;
revoke insert, update, delete on table public.organization_members from authenticated;

-- Fine-grained personal access tokens use the github_pat_ prefix, which is not
-- covered by the shorter gh[pousr]_ family. Keep the database detector aligned
-- with the server boundary so these values cannot enter control-plane rows.
create or replace function public.text_has_likely_secret(input_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(
    input_text ~ '(?i)(-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|vercel_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})',
    false
  );
$function$;

revoke all on function public.text_has_likely_secret(text)
  from public, anon, authenticated;
grant execute on function public.text_has_likely_secret(text)
  to authenticated;

-- Reassert the intentionally retained onboarding entry point. The function
-- derives its actor from auth.uid() and creates the owner membership and audit
-- evidence atomically; callers still receive no direct table-write privilege.
revoke all on function public.onboard_authenticated_organization(text, text)
  from public, anon;
grant execute on function public.onboard_authenticated_organization(text, text)
  to authenticated;

comment on function public.text_has_likely_secret(text) is
  'Detects common plaintext credential forms, including GitHub fine-grained personal access tokens (github_pat_).';
