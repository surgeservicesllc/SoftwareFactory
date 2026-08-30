            select coalesce(
              (select array_to_string(proargnames, ', ')
                 from pg_proc
                where oid = to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)')),
              'delete_selected_pipelines absent (pre-20260823000200 database)'
            ) as selection_delete_arguments;
