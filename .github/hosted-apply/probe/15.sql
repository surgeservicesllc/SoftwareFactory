            set search_path = pg_catalog;
            select
              (select count(*) from public.projects
                where name in (
                  'SoftwareFactory', 'SoftwareFactory_08.17.2026',
                  'SoftwareFactory_08.21.2026'
                )) as named_projects_total_gate_requires_exactly_4,
              (select relation.relrowsecurity and relation.relforcerowsecurity
                      and pg_get_userbyid(relation.relowner) = 'postgres'
                      and not has_table_privilege('anon', relation.oid, 'UPDATE,DELETE,TRUNCATE')
                      and not has_table_privilege('authenticated', relation.oid, 'UPDATE,DELETE,TRUNCATE')
                      and not has_table_privilege('service_role', relation.oid, 'UPDATE,DELETE,TRUNCATE')
                 from pg_class relation
                where relation.oid = 'public.activity_events'::regclass)
                as activity_events_table_posture,
              (select routine_language.lanname = 'plpgsql'
                      and routine.prokind = 'f' and routine.provolatile = 'v'
                      and routine.prorettype = 'trigger'::regtype
                      and not routine.prosecdef
                      and routine.proconfig = array['search_path=pg_catalog']::text[]
                      and pg_get_userbyid(routine.proowner) = 'postgres'
                      and btrim(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'), E' \n') =
                        E'begin\n  raise exception using errcode = ''55000'', message = ''activity events are append-only'';\nend;'
                      and not has_function_privilege('anon', routine.oid, 'EXECUTE')
                      and not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
                      and not has_function_privilege('service_role', routine.oid, 'EXECUTE')
                 from pg_proc routine
                 join pg_language routine_language on routine_language.oid = routine.prolang
                where routine.oid = 'public.reject_activity_event_mutation()'::regprocedure)
                as reject_mutation_function_posture,
              (select (select count(*) from aclexplode(routine.proacl))
                 from pg_proc routine
                where routine.oid = 'public.reject_activity_event_mutation()'::regprocedure)
                as reject_mutation_acl_entries,
              has_function_privilege('service_role',
                'public.reject_activity_event_mutation()'::regprocedure, 'EXECUTE')
                as reject_mutation_service_role_execute,
              has_function_privilege('authenticated',
                'public.reject_activity_event_mutation()'::regprocedure, 'EXECUTE')
                as reject_mutation_authenticated_execute,
              has_function_privilege('anon',
                'public.reject_activity_event_mutation()'::regprocedure, 'EXECUTE')
                as reject_mutation_anon_execute,
              exists (
                select 1 from pg_trigger trigger_row
                where trigger_row.tgrelid = 'public.activity_events'::regclass
                  and trigger_row.tgname = 'activity_events_append_only'
                  and not trigger_row.tgisinternal and trigger_row.tgenabled = 'O'
                  and trigger_row.tgtype = 27
                  and trigger_row.tgfoid = 'public.reject_activity_event_mutation()'::regprocedure
                  and trigger_row.tgconstraint = 0 and trigger_row.tgparentid = 0
                  and trigger_row.tgqual is null
              ) as append_only_trigger_posture;
