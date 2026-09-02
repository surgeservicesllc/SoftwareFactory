-- Postflight for scope=job-seeker-service-role-contract (20260902001700):
-- on every job_seeker table, anon and service_role hold nothing, RLS is
-- enabled and forced, and authenticated still holds at least SELECT.
do $$
declare
  v_row record;
  v_bad text := '';
begin
  for v_row in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'job\_seeker\_%'
     order by c.relname
  loop
    if not v_row.relrowsecurity or not v_row.relforcerowsecurity then
      v_bad := v_bad || format(' %s:rls', v_row.relname);
    end if;
    if has_table_privilege('anon', format('public.%I', v_row.relname), 'select')
       or has_table_privilege('anon', format('public.%I', v_row.relname), 'insert') then
      v_bad := v_bad || format(' %s:anon', v_row.relname);
    end if;
    if has_table_privilege('service_role', format('public.%I', v_row.relname), 'select')
       or has_table_privilege('service_role', format('public.%I', v_row.relname), 'insert')
       or has_table_privilege('service_role', format('public.%I', v_row.relname), 'update')
       or has_table_privilege('service_role', format('public.%I', v_row.relname), 'delete') then
      v_bad := v_bad || format(' %s:service_role', v_row.relname);
    end if;
    if not has_table_privilege('authenticated', format('public.%I', v_row.relname), 'select') then
      v_bad := v_bad || format(' %s:authenticated-lost', v_row.relname);
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'postflight: job_seeker grants are wrong on%', v_bad;
  end if;
  raise notice 'postflight job-seeker-service-role-contract: every job_seeker table forced-RLS, nothing for anon or service_role, authenticated reads';
end $$;
