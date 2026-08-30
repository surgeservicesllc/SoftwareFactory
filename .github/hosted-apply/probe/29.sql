            select relation.relname,
                   relation.relrowsecurity as rls,
                   relation.relforcerowsecurity as force_rls,
                   (select count(*) from pg_policy policy where policy.polrelid = relation.oid) as policies,
                   has_table_privilege('authenticated', relation.oid, 'SELECT') as authenticated_select,
                   has_table_privilege('service_role', relation.oid, 'SELECT') as service_role_select
              from pg_class relation
              join pg_namespace space on space.oid = relation.relnamespace
             where space.nspname = 'public'
               and relation.relname in ('provider_credentials', 'provider_connect_sessions')
             order by relation.relname;
