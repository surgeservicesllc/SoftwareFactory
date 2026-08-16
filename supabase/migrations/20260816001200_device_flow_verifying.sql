-- A device-flow sign-in reaches verifying without a pasted code.
--
-- The paste route was the only path that ever set 'authenticated', so the
-- worker's mark-verifying guard — which demands it — silently refused the
-- device flow's transition, and completion was then structurally rejected:
-- the session sat in awaiting_user while the person had already approved on
-- the provider's page ("Completing the sign-in failed", live 2026-08-16
-- 19:01Z, and the true cause of the 18:44Z failure beneath the envelope
-- cap). The worker owns the claimed session either way; awaiting_user →
-- verifying is a legitimate transition when the provider itself completed
-- the authentication.
--
-- Idempotent: this file is on the surgical apply path and may be replayed.

create or replace function public.mark_ai_auth_session_verifying(p_session_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_updated integer;
begin
  update public.ai_auth_sessions
  set status = 'verifying', heartbeat_at = now(), updated_at = now()
  where id = p_session_id
    and status in ('authenticated', 'awaiting_user')
    and expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

revoke all on function public.mark_ai_auth_session_verifying(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_ai_auth_session_verifying(uuid) to service_role;
