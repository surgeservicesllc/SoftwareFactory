-- Give the browser back the readiness call that Connect Bots depends on.
--
-- 20260822000200 ended with:
--
--   revoke all on function public.record_bot_readiness_preserving_disabled(...)
--     from public, anon, authenticated, service_role;
--   grant execute on function ... to service_role;
--
-- Correct in shape — this is the pattern ADR-118 and ADR-120 argue for — but
-- wrong in who was left holding it. Nothing in the application runs as
-- service_role: lib/supabase reads only NEXT_PUBLIC_SUPABASE_URL and the
-- anon/publishable key, and both callers of synchronizeBotReadiness
-- (/api/bots/connect/provision and /api/bots/[botId]/check) pass the caller's
-- own authenticated client. Its optional rawRecorderClient seam is never
-- supplied.
--
-- So every readiness sync raised 42501, and step 5 of the AI Factory journey
-- could not be completed by anyone. Measured in a browser against a local
-- Supabase stack: the bot is created, the panel reports "The bot was saved,
-- but readiness could not be verified. Try again.", and retrying cannot
-- succeed. Because Connect Bots is done only when a ready linked bot exists,
-- steps 5, 6, 7, 8 and 9 were all unreachable.
--
-- Proven directly:
--   set role authenticated;
--   select public.record_bot_readiness_preserving_disabled(...);
--   ERROR:  permission denied for function record_bot_readiness_preserving_disabled
--
-- Granting `authenticated` is safe and is what the function was written for.
-- It is SECURITY DEFINER and authorizes its own caller before touching a row:
--
--   if not exists (... member.role in ('owner','admin') ...) then
--     raise exception using errcode = '42501',
--       message = 'organization owner or administrator access is required';
--
-- That is the same shape as every other person-facing definer function here.
-- The grant boundary is not what protects this function; its body is.
--
-- service_role keeps its grant. This migration restores what was lost rather
-- than re-litigating what a worker may call.

grant execute on function public.record_bot_readiness_preserving_disabled(
  uuid, uuid, uuid, bigint, uuid, public.bot_provider,
  text, text, text, public.bot_readiness, text
) to authenticated;

do $postflight$
declare
  target oid;
begin
  set local search_path = pg_catalog;

  select p.oid into target
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'record_bot_readiness_preserving_disabled';

  if target is null then
    raise exception '20260822001400 postflight: the readiness function is missing';
  end if;

  -- The browser role must reach it, and anon must not. anon is asserted
  -- because a grant handed back too broadly is the failure this repository
  -- keeps making in the other direction.
  if not has_function_privilege('authenticated', target, 'EXECUTE') then
    raise exception '20260822001400 postflight: authenticated still cannot execute the readiness function';
  end if;
  if has_function_privilege('anon', target, 'EXECUTE') then
    raise exception '20260822001400 postflight: anon must not reach the readiness function';
  end if;
end
$postflight$;
