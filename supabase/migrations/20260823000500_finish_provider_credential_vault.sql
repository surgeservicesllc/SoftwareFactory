-- Finishing 20260814002500, which died one function short and has been
-- costing a user path ever since.
--
-- The vault migration was applied to hosted but never recorded in the ledger,
-- and it stopped partway: probe run 32652393423 measured the live database and
-- found both tables complete, the expiry index present, RLS and FORCE RLS on
-- with no client grants, five of its six functions created -- and exactly one
-- missing, `resolve_provider_connect_session(text)`.
--
-- That single gap has two visible costs:
--
--   1. `POST /api/bots/connect/claim` calls it first, so every CORRECT sign-in
--      code was answered "connect_session_invalid", and each retry minted
--      another code that failed the same way. todo.md has described this since
--      2026-08-20; this is the missing piece it names.
--   2. Supabase's preview branch replays every migration the ledger does not
--      record. It replays 20260814002500, hits the table that already exists,
--      and fails with 42P07 -- which is the red `Supabase Preview` check on
--      every recent commit to main.
--
-- The function below is byte-for-byte the one 20260814002500 declares, with
-- the same STABLE/SECURITY DEFINER posture, the same search_path, and the same
-- service_role-only grant. Nothing else in that file is touched, because
-- nothing else in it is missing.
--
-- Once this is applied, 20260814002500's effects are all present, so the apply
-- scope records it in the ledger. That is what stops the preview replay.

do $preflight$
begin
  -- Every prerequisite the function reads must already be there. If this
  -- database is missing more of 20260814002500 than the probe found, this
  -- file is the wrong instrument and says so rather than papering over it.
  if to_regclass('public.provider_connect_sessions') is null then
    raise exception using errcode = '55000',
      message = '20260823000500 preflight: provider_connect_sessions is absent; 20260814002500 must be applied in full instead';
  end if;
  if to_regclass('public.provider_credentials') is null then
    raise exception using errcode = '55000',
      message = '20260823000500 preflight: provider_credentials is absent; 20260814002500 must be applied in full instead';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'provider_connect_sessions'
       and column_name in ('code_digest', 'claimed_at', 'expires_at', 'organization_id', 'purpose')
     group by table_name having count(*) = 5
  ) then
    raise exception using errcode = '55000',
      message = '20260823000500 preflight: provider_connect_sessions is missing a column this function reads';
  end if;
end;
$preflight$;

-- Exactly the declaration from 20260814002500. Resolving a pending sign-in
-- without claiming it: never returns the digest, never mutates, and applies
-- the same validity rules the claim does, so an expired or spent code is
-- refused here too.
create or replace function public.resolve_provider_connect_session(
  p_code_digest text
)
returns table (session_organization_id uuid, session_purpose text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  return query
  select s.organization_id, s.purpose
  from public.provider_connect_sessions s
  where s.code_digest = p_code_digest
    and s.claimed_at is null
    and s.expires_at > now();
end;
$function$;

revoke all on function public.resolve_provider_connect_session(text)
  from public, anon, authenticated;
grant execute on function public.resolve_provider_connect_session(text) to service_role;

do $postflight$
begin
  if to_regprocedure('public.resolve_provider_connect_session(text)') is null then
    raise exception using errcode = '55000',
      message = '20260823000500 postflight: the function was not created';
  end if;
  if not (select prosecdef from pg_proc
           where oid = to_regprocedure('public.resolve_provider_connect_session(text)')) then
    raise exception using errcode = '55000',
      message = '20260823000500 postflight: the function is not SECURITY DEFINER';
  end if;
  -- The browser must never reach it; only the server, as service_role.
  if has_function_privilege('anon', to_regprocedure('public.resolve_provider_connect_session(text)'), 'EXECUTE')
    or has_function_privilege('authenticated', to_regprocedure('public.resolve_provider_connect_session(text)'), 'EXECUTE')
    or not has_function_privilege('service_role', to_regprocedure('public.resolve_provider_connect_session(text)'), 'EXECUTE') then
    raise exception using errcode = '55000',
      message = '20260823000500 postflight: the execute grants are not service_role only';
  end if;
  -- And the vault tables must still be unreachable from any client role.
  if has_table_privilege('authenticated', 'public.provider_credentials', 'SELECT')
    or has_table_privilege('anon', 'public.provider_credentials', 'SELECT')
    or has_table_privilege('service_role', 'public.provider_credentials', 'SELECT') then
    raise exception using errcode = '55000',
      message = '20260823000500 postflight: a role can read the sealed envelope table directly';
  end if;
end;
$postflight$;
