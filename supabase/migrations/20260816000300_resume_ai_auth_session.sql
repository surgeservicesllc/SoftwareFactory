-- Resume, don't duplicate: the open session an account already has.
--
-- A page refresh in the middle of a sign-in must return the person to
-- "waiting for Claude" — the session that exists — rather than opening a new
-- one, which would revoke the one the worker may already be driving and
-- restart the human's progress. The connect route asks this first; only when
-- there is nothing to resume does it open a session.
--
-- Same projection discipline as read_ai_auth_session: the sealed relay code
-- is not in the returns clause, so no future edit can leak it without also
-- changing the signature.

create or replace function public.find_open_ai_auth_session(
  p_organization_id uuid,
  p_ai_account_id uuid
)
returns table (
  open_session_id uuid,
  open_status text,
  open_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select s.id, s.status, s.expires_at
  from public.ai_auth_sessions s
  where s.organization_id = p_organization_id
    and s.ai_account_id = p_ai_account_id
    and s.status in ('pending', 'initializing', 'awaiting_user', 'authenticated', 'verifying')
    and s.expires_at > now()
  limit 1;
end;
$function$;

revoke all on function public.find_open_ai_auth_session(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.find_open_ai_auth_session(uuid, uuid) to authenticated;
