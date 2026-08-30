select relation.relname,
       relation.relrowsecurity as rls_enabled,
       relation.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policy where polrelid = relation.oid) as policies,
       has_table_privilege('anon', relation.oid, 'SELECT') as anon_may_select,
       has_table_privilege('service_role', relation.oid, 'INSERT') as service_role_may_insert
  from pg_class relation
  join pg_namespace space on space.oid = relation.relnamespace
 where space.nspname = 'public'
   and relation.relname = 'graph_gates';
