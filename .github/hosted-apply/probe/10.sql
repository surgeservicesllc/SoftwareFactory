            select
              (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'job_seeker_resume_extractions') as rls_enabled,
              (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'job_seeker_resume_extractions') as rls_forced,
              (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                where c.relname = 'job_seeker_resume_extractions') as policies,
              has_table_privilege('authenticated', 'public.job_seeker_resume_extractions', 'SELECT') as auth_select,
              has_table_privilege('authenticated', 'public.job_seeker_resume_extractions', 'UPDATE') as auth_update,
              has_table_privilege('anon', 'public.job_seeker_resume_extractions', 'SELECT') as anon_select,
              has_table_privilege('service_role', 'public.job_seeker_resume_extractions', 'UPDATE') as service_update,
              (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'apply_resume_extraction') as definer,
              has_function_privilege('authenticated', 'public.apply_resume_extraction(uuid,text[])', 'EXECUTE') as auth_execute,
              has_function_privilege('anon', 'public.apply_resume_extraction(uuid,text[])', 'EXECUTE') as anon_execute,
              has_function_privilege('service_role', 'public.apply_resume_extraction(uuid,text[])', 'EXECUTE') as service_execute,
              (select p.proacl::text from pg_proc p
                where p.oid = to_regprocedure('public.apply_resume_extraction(uuid,text[])')) as function_acl;
