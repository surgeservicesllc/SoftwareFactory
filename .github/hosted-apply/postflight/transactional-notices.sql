-- Postflight for hosted apply scope `transactional-notices` (ADR-217).
--
-- The claim this scope has to prove is a negative one: on hosted, with no
-- SMS or email provider connected, NOTHING can record that a notice was
-- sent. Hosted default privileges grant ALL on every new table, so the
-- absence this feature depends on is exactly the thing most likely to be
-- silently undone by the platform — which is why it is checked here rather
-- than assumed from the migration having run.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_write integer;
  v_secdef integer;
  v_sent integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_notices', 'crm_contact_preferences')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 2 then
    raise exception 'expected both notice tables RLS-enabled and forced; found %', v_rls;
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('crm_notices', 'crm_contact_preferences')
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'the notice tables carry % grant(s) outside authenticated', v_grants;
  end if;

  -- THE ONE THAT MATTERS. No UPDATE on crm_notices for anybody is what
  -- makes `sent` unreachable except through crm_notice_mark_dispatched,
  -- which asks whether a provider is really connected. A hosted default
  -- privilege restoring UPDATE here would quietly turn the guarantee off.
  select count(*) into v_write
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_notices'
     and privilege_type in ('UPDATE', 'DELETE')
     and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC');
  if v_write <> 0 then
    raise exception
      'crm_notices gained % update/delete grant(s); a notice could then claim it was sent', v_write;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'crm_notices_sent_evidence'
  ) then
    raise exception 'a notice could claim it was sent with nothing to check the claim against';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crm_contact_preferences_stop_forbids_everything'
  ) then
    raise exception 'a do-not-contact could coexist with permission to contact';
  end if;

  -- The deduplication lock, without which two people pressing Remind send
  -- the same customer two texts about the same visit.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_notices_org_kind_subject_day_key'
  ) then
    raise exception 'the notice deduplication index is missing';
  end if;

  -- The dispatch path must be definer (it is the only writer of `sent`),
  -- and the composer must NOT be (it would widen authority for nothing).
  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_notice_mark_dispatched';
  if v_secdef <> 1 then
    raise exception 'crm_notice_mark_dispatched is not SECURITY DEFINER, so it cannot write sent';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_notice_compose'
  ) then
    raise exception 'crm_notice_compose is SECURITY DEFINER; it has no need of that authority';
  end if;

  -- And the substantive check: nothing on hosted claims to have been sent,
  -- because nothing on hosted is connected.
  select count(*) into v_sent from public.crm_notices where state = 'sent';
  if v_sent <> 0 then
    raise exception
      '% notice(s) claim to have been sent, but no provider is connected', v_sent;
  end if;

  raise notice 'transactional notices: composed and suppressed are real, sent is unreachable';
end;
$$;
