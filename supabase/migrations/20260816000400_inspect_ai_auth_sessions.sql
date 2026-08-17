-- The worker's eyes: what sign-in sessions exist, in plain states.
--
-- Two live worker runs answered "no sessions pending" while the owner
-- watched a connect spinner. One of them is wrong, and nothing could say
-- which, because no service-role surface could describe session state
-- without claiming it. This is that surface: a bounded, read-only
-- projection of recent sessions — status, timing, and ownership linkage,
-- never the sealed relay code — so a worker run's log shows the queue it
-- actually saw and the diagnosis stops being an argument.

create or replace function public.inspect_ai_auth_sessions(
  p_limit integer default 20
)
returns table (
  inspected_session_id uuid,
  inspected_organization_id uuid,
  inspected_account_id uuid,
  inspected_provider public.bot_provider,
  inspected_status text,
  inspected_worker_id text,
  inspected_created_at timestamptz,
  inspected_expires_at timestamptz,
  inspected_heartbeat_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  return query
  select s.id, s.organization_id, s.ai_account_id, a.provider, s.status,
         s.worker_id, s.created_at, s.expires_at, s.heartbeat_at
  from public.ai_auth_sessions s
  join public.ai_accounts a on a.id = s.ai_account_id
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$function$;

revoke all on function public.inspect_ai_auth_sessions(integer)
  from public, anon, authenticated;
grant execute on function public.inspect_ai_auth_sessions(integer) to service_role;
