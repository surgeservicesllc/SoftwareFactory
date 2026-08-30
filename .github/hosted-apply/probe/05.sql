select rolname, rolsuper, rolbypassrls
  from pg_roles
 where rolname in ('postgres', 'authenticated', 'service_role')
 order by rolname;
