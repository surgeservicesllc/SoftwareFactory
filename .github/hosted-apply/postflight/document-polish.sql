-- Postflight for scope=document-polish (20260902001500): the three
-- provenance columns exist on job_seeker_documents with the five checks,
-- and the table's RLS and grants are as they were.
do $$
declare
  v_columns integer;
  v_checks integer;
  v_rls record;
begin
  select count(*) into v_columns from information_schema.columns
   where table_schema = 'public' and table_name = 'job_seeker_documents'
     and column_name in ('origin', 'model', 'polish_check');
  if v_columns <> 3 then
    raise exception 'postflight: job_seeker_documents has % of the 3 provenance columns', v_columns;
  end if;
  select count(*) into v_checks from pg_constraint
   where conname in (
     'job_seeker_documents_origin_known', 'job_seeker_documents_model_shape',
     'job_seeker_documents_polish_check_shape', 'job_seeker_documents_origin_consistent',
     'job_seeker_documents_polish_passed'
   );
  if v_checks <> 5 then
    raise exception 'postflight: job_seeker_documents has % of the 5 polish checks', v_checks;
  end if;
  select c.relrowsecurity, c.relforcerowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'job_seeker_documents';
  if not v_rls.relrowsecurity or not v_rls.relforcerowsecurity then
    raise exception 'postflight: job_seeker_documents must keep RLS enabled and forced';
  end if;
  if has_table_privilege('anon', 'public.job_seeker_documents', 'select')
     or has_table_privilege('service_role', 'public.job_seeker_documents', 'select') then
    raise exception 'postflight: job_seeker_documents grants are wrong';
  end if;
  raise notice 'postflight document-polish: provenance columns and checks present, RLS forced, grants unchanged';
end $$;
