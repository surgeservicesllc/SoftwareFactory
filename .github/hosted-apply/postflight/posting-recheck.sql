-- Postflight for scope=posting-recheck (20260902001600): the five check
-- columns and four checks on the sightings table, the recorder as a
-- SECURITY DEFINER executable by authenticated only, and the reader
-- recreated as SECURITY INVOKER carrying the check columns.
do $$
declare
  v_columns integer;
  v_checks integer;
  v_oid oid;
  v_secdef boolean;
  v_result text;
begin
  select count(*) into v_columns from information_schema.columns
   where table_schema = 'public' and table_name = 'job_seeker_posting_sightings'
     and column_name in ('last_checked_at', 'last_check_status', 'last_check_http_status', 'last_check_note', 'checks');
  if v_columns <> 5 then
    raise exception 'postflight: job_seeker_posting_sightings has % of the 5 recheck columns', v_columns;
  end if;
  select count(*) into v_checks from pg_constraint
   where conname in (
     'job_seeker_posting_sightings_check_status_known', 'job_seeker_posting_sightings_check_http_status_range',
     'job_seeker_posting_sightings_check_note_length', 'job_seeker_posting_sightings_check_consistent'
   );
  if v_checks <> 4 then
    raise exception 'postflight: job_seeker_posting_sightings has % of the 4 recheck checks', v_checks;
  end if;
  select p.oid, p.prosecdef into v_oid, v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_posting_recheck';
  if v_oid is null or not v_secdef then
    raise exception 'postflight: public.record_posting_recheck must exist as SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('service_role', v_oid, 'execute')
     or not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'postflight: public.record_posting_recheck grants are wrong';
  end if;
  select p.oid, p.prosecdef, pg_get_function_result(p.oid) into v_oid, v_secdef, v_result
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'read_posting_sightings';
  if v_oid is null or v_secdef then
    raise exception 'postflight: public.read_posting_sightings must exist as SECURITY INVOKER';
  end if;
  if position('last_check_status' in v_result) = 0 then
    raise exception 'postflight: public.read_posting_sightings does not return the recheck columns';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('service_role', v_oid, 'execute')
     or not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'postflight: public.read_posting_sightings grants are wrong';
  end if;
  raise notice 'postflight posting-recheck: recheck columns and checks present, recorder definer, reader invoker with the check columns, both authenticated-only';
end $$;
