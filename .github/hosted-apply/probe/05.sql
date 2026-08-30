            select 'function' as kind,
                   routine.proname as name,
                   pg_get_userbyid(routine.proowner) as owner,
                   routine.prosecdef as security_definer,
                   has_function_privilege('authenticated', routine.oid, 'EXECUTE') as authenticated_may_execute
              from pg_proc routine
              join pg_namespace space on space.oid = routine.pronamespace
             where space.nspname = 'public'
               and routine.proname in (
                 'remove_ai_account','disconnect_ai_account','rename_ai_account',
                 'create_ai_account','can_manage_organization','has_organization_role')
            union all
            select 'table',
                   relation.relname,
                   pg_get_userbyid(relation.relowner),
                   relation.relrowsecurity and relation.relforcerowsecurity,
                   null
              from pg_class relation
              join pg_namespace space on space.oid = relation.relnamespace
             where space.nspname = 'public'
               and relation.relkind = 'r'
               and relation.relname in (
                 'ai_accounts','ai_auth_sessions','provider_credentials',
                 'activity_events','bots')
            order by 1, 2;
