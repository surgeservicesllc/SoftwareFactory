-- Postflight for scope=application-transitions (20260902001300): the
-- closure reason column and its check, the transitions ledger with RLS
-- enabled and forced and SELECT only for authenticated, the recording and
-- append-only triggers, and the two invoker functions executable by
-- authenticated only.
do $$
declare
  v_rls record;
  v_fn text;
  v_secdef boolean;
  v_oid oid;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'job_seeker_applications' and column_name = 'closed_reason'
  ) then
    raise exception 'postflight: job_seeker_applications.closed_reason is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_seeker_applications_closed_reason_only_when_closed') then
    raise exception 'postflight: the closed-reason check is missing';
  end if;
  select c.relrowsecurity, c.relforcerowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'job_seeker_application_transitions';
  if v_rls is null then
    raise exception 'postflight: job_seeker_application_transitions is missing';
  end if;
  if not v_rls.relrowsecurity or not v_rls.relforcerowsecurity then
    raise exception 'postflight: job_seeker_application_transitions must have RLS enabled and forced';
  end if;
  if not has_table_privilege('authenticated', 'public.job_seeker_application_transitions', 'select')
     or has_table_privilege('authenticated', 'public.job_seeker_application_transitions', 'insert')
     or has_table_privilege('service_role', 'public.job_seeker_application_transitions', 'select')
     or has_table_privilege('anon', 'public.job_seeker_application_transitions', 'select') then
    raise exception 'postflight: job_seeker_application_transitions grants are wrong';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'job_seeker_applications_record_transition')
     or not exists (select 1 from pg_trigger where tgname = 'job_seeker_application_transitions_immutable') then
    raise exception 'postflight: a transitions trigger is missing';
  end if;
  foreach v_fn in array array['job_seeker_application_replies', 'job_seeker_response_stats'] loop
    select p.oid, p.prosecdef into v_oid, v_secdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_oid is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if v_secdef then
      raise exception 'postflight: public.% must be SECURITY INVOKER', v_fn;
    end if;
    if has_function_privilege('anon', v_oid, 'execute')
       or has_function_privilege('service_role', v_oid, 'execute')
       or not has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception 'postflight: public.% grants are wrong', v_fn;
    end if;
  end loop;
  raise notice 'postflight application-transitions: closure reason checked; ledger forced-RLS, read-only, trigger-written, append-only; replies and stats invoker, authenticated-only';
end $$;
