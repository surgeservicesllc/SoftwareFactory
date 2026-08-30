            select routine.proname,
                   routine.prosecdef as security_definer,
                   pg_get_userbyid(routine.proowner) as owner,
                   has_function_privilege('authenticated', routine.oid, 'EXECUTE') as member_may_execute,
                   has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_may_execute,
                   has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_may_execute
              from pg_proc routine
              join pg_namespace space on space.oid = routine.pronamespace
             where space.nspname = 'public'
               and routine.proname in ('clear_backlog_tasks', 'clear_all_pipelines')
             order by routine.proname;
