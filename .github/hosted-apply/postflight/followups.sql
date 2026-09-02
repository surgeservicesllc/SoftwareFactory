-- Postflight for hosted apply scope `followups` (ADR-228).
--
-- A suggestion becomes a task only when a person accepts it, and the same
-- suggestion cannot be accepted twice while open. Each check here is one way
-- that promise breaks: a browser role holding a grant it should not, a task
-- deletable so a dropped follow-up leaves no trace, the one-open-per-key
-- index missing, the stamping trigger gone so "done" can arrive without a
-- moment, or the rules function running as somebody other than the caller.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_contradictions integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_tasks', 'crm_followup_dismissals')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 2 then
    raise exception 'expected both follow-up tables RLS-enabled and forced; found %', v_rls;
  end if;

  -- Hosted default privileges grant ALL on every new table, so this is
  -- checked on every apply rather than assumed from the migration.
  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('crm_tasks', 'crm_followup_dismissals')
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'the follow-up tables carry % grant(s) outside authenticated', v_grants;
  end if;

  -- A follow-up that was agreed and then dropped is a fact; cancelling is a
  -- status. Scoped to the browser roles: role_table_grants also reports the
  -- owner's own privileges, which always include delete.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'crm_tasks'
       and privilege_type = 'DELETE'
       and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC')
  ) then
    raise exception 'crm_tasks gained a delete grant; a dropped follow-up must stay readable';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_tasks_open_suggestion_key'
  ) then
    raise exception 'the same suggestion could be accepted twice while open';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'crm_tasks_stamp_moments') then
    raise exception 'the stamping trigger is missing; "done" could arrive without a moment';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_tasks_record_done') then
    raise exception 'a finished follow-up would leave no line on the account history';
  end if;

  -- The rules read as the caller. A DEFINER here would suggest follow-ups
  -- about rows the caller could not open.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_suggest_followups'
  ) then
    raise exception 'crm_suggest_followups is SECURITY DEFINER; it must read as the caller';
  end if;
  if not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'crm_suggest_followups'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute crm_suggest_followups';
  end if;

  -- And the substantive one: no task claims a terminal moment it is not in.
  select count(*) into v_contradictions
    from public.crm_tasks t
   where (t.done_at is not null) <> (t.status = 'done')
      or (t.cancelled_at is not null) <> (t.status = 'cancelled')
      or (t.origin = 'suggested') <> (t.suggestion_key is not null);
  if v_contradictions <> 0 then
    raise exception '% task(s) contradict their own status or origin', v_contradictions;
  end if;

  raise notice 'follow-ups: one open task per suggestion, moments stamped by the row, rules read as the caller';
end;
$$;
