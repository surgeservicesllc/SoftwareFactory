-- Postflight for scope=posting-sightings (20260902001200): the sightings
-- table exists with RLS enabled and forced, authenticated may only SELECT it,
-- service_role and anon hold nothing, the recorder is SECURITY DEFINER and
-- the reader SECURITY INVOKER, and both are executable by authenticated only.
do $$
declare
  v_rls record;
  v_fn text;
  v_secdef boolean;
  v_oid oid;
begin
  select c.relrowsecurity, c.relforcerowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'job_seeker_posting_sightings';
  if v_rls is null then
    raise exception 'postflight: job_seeker_posting_sightings is missing';
  end if;
  if not v_rls.relrowsecurity or not v_rls.relforcerowsecurity then
    raise exception 'postflight: job_seeker_posting_sightings must have RLS enabled and forced';
  end if;
  if not has_table_privilege('authenticated', 'public.job_seeker_posting_sightings', 'select')
     or has_table_privilege('authenticated', 'public.job_seeker_posting_sightings', 'insert')
     or has_table_privilege('authenticated', 'public.job_seeker_posting_sightings', 'update')
     or has_table_privilege('authenticated', 'public.job_seeker_posting_sightings', 'delete') then
    raise exception 'postflight: authenticated must hold SELECT only on job_seeker_posting_sightings';
  end if;
  if has_table_privilege('anon', 'public.job_seeker_posting_sightings', 'select')
     or has_table_privilege('service_role', 'public.job_seeker_posting_sightings', 'select') then
    raise exception 'postflight: anon and service_role must hold nothing on job_seeker_posting_sightings';
  end if;
  foreach v_fn in array array['record_posting_sightings', 'read_posting_sightings'] loop
    select p.oid, p.prosecdef into v_oid, v_secdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_oid is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if (v_fn = 'record_posting_sightings') <> v_secdef then
      raise exception 'postflight: public.% has the wrong security mode', v_fn;
    end if;
    if has_function_privilege('anon', v_oid, 'execute')
       or has_function_privilege('service_role', v_oid, 'execute')
       or not has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception 'postflight: public.% grants are wrong', v_fn;
    end if;
  end loop;
  raise notice 'postflight posting-sightings: table forced-RLS and read-only to authenticated; recorder definer, reader invoker, both authenticated-only';
end $$;
