set search_path = pg_catalog;
select routine.proname, coalesce(routine.proacl::text, '<null>') as proacl,
       has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_x,
       has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_x,
       has_function_privilege('authenticated', routine.oid, 'EXECUTE') as auth_x
  from pg_proc routine
 where routine.oid in (
   to_regprocedure('public.agentos_hosts_are_bare_hostnames(text[])'),
   to_regprocedure('public.agentos_resolved_agent_grants(uuid)'))
 order by routine.proname;
