-- The worker can ask whether its in-flight session is still worth driving.
--
-- A person who cancels mid-sign-in revokes the session in the database, but
-- the worker driving that login had no way to see it — it kept waiting out
-- the full relay window on a dead session while every new Connect click
-- queued behind the blindness. Status only, never the sealed code.
--
-- Idempotent: this file is on the surgical apply path and may be replayed.

create or replace function public.read_ai_auth_session_status(p_session_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_status text;
begin
  select s.status into v_status
  from public.ai_auth_sessions s
  where s.id = p_session_id;
  return v_status;
end;
$function$;

revoke all on function public.read_ai_auth_session_status(uuid)
  from public, anon, authenticated;
grant execute on function public.read_ai_auth_session_status(uuid) to service_role;
