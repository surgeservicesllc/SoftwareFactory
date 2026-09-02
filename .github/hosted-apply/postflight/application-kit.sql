-- Postflight for scope=application-kit (20260902001400): the screening
-- answers table exists with RLS enabled and forced, the four own-row
-- policies, authenticated CRUD, and nothing for anon or service_role.
do $$
declare
  v_rls record;
  v_policies integer;
begin
  select c.relrowsecurity, c.relforcerowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'job_seeker_screening_answers';
  if v_rls is null then
    raise exception 'postflight: job_seeker_screening_answers is missing';
  end if;
  if not v_rls.relrowsecurity or not v_rls.relforcerowsecurity then
    raise exception 'postflight: job_seeker_screening_answers must have RLS enabled and forced';
  end if;
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'job_seeker_screening_answers';
  if v_policies <> 4 then
    raise exception 'postflight: job_seeker_screening_answers has % policies, expected 4', v_policies;
  end if;
  if not has_table_privilege('authenticated', 'public.job_seeker_screening_answers', 'insert')
     or has_table_privilege('anon', 'public.job_seeker_screening_answers', 'select')
     or has_table_privilege('service_role', 'public.job_seeker_screening_answers', 'select') then
    raise exception 'postflight: job_seeker_screening_answers grants are wrong';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_seeker_screening_answers_one_per_question') then
    raise exception 'postflight: the one-answer-per-question key is missing';
  end if;
  raise notice 'postflight application-kit: screening answers forced-RLS, four own-row policies, authenticated only';
end $$;
