select
  exists (
    select 1 from pg_proc routine
     where routine.oid = 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'::regprocedure
       and routine.prosecdef
       and routine.proconfig @> array['search_path=pg_catalog']::text[]
  )
  and has_function_privilege('authenticated', 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)', 'EXECUTE')
  and exists (
    select 1 from pg_proc routine
     where routine.oid = 'public.ai_account_bot_credential_ref(public.bot_provider,text)'::regprocedure
       and routine.prosecdef
       and routine.proconfig @> array['search_path=pg_catalog']::text[]
  )
  and not has_function_privilege('public', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE')
  and exists (
    select 1 from pg_proc routine
     where routine.oid = 'public.enforce_bot_ai_account_binding()'::regprocedure
       and routine.prosecdef
       and routine.proconfig @> array['search_path=pg_catalog']::text[]
  )
  and not has_function_privilege('public', 'public.enforce_bot_ai_account_binding()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enforce_bot_ai_account_binding()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enforce_bot_ai_account_binding()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.enforce_bot_ai_account_binding()', 'EXECUTE')
  and exists (
    select 1 from pg_trigger trigger_row
     where trigger_row.tgrelid = 'public.bots'::regclass
       and trigger_row.tgname = 'bots_ai_account_binding_coherent'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 23
       and trigger_row.tgfoid = 'public.enforce_bot_ai_account_binding()'::regprocedure
       and trigger_row.tgconstraint = 0
       and trigger_row.tgparentid = 0
       and trigger_row.tgconstrrelid = 0
       and trigger_row.tgconstrindid = 0
       and not trigger_row.tgdeferrable
       and not trigger_row.tginitdeferred
       and trigger_row.tgqual is null
       and trigger_row.tgoldtable is null
       and trigger_row.tgnewtable is null
       and octet_length(trigger_row.tgargs) = 0
       and (
         select string_agg(column_row.attname, ',' order by update_column.ordinality)
           from unnest(trigger_row.tgattr::smallint[])
             with ordinality update_column(attnum, ordinality)
           join pg_attribute column_row
             on column_row.attrelid = trigger_row.tgrelid
            and column_row.attnum = update_column.attnum
            and not column_row.attisdropped
       ) = 'organization_id,ai_account_id,provider,credential_ref'
  )
  and exists (
    select 1
      from pg_attribute column_row
      join pg_attrdef default_row
        on default_row.adrelid = column_row.attrelid
       and default_row.adnum = column_row.attnum
     where column_row.attrelid = 'public.bots'::regclass
       and column_row.attname = 'revision'
       and not column_row.attisdropped
       and column_row.attnotnull
       and column_row.atttypid = 'pg_catalog.int8'::regtype
       and pg_get_expr(default_row.adbin, default_row.adrelid)
         in ('1', '1::bigint', '''1''::bigint')
  )
  and exists (
    select 1 from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.bots'::regclass
       and constraint_row.conname = 'bots_revision_positive'
       and constraint_row.contype = 'c'
       and pg_get_constraintdef(constraint_row.oid) like '%revision > 0%'
  )
  and exists (
    select 1 from pg_proc routine
     where routine.oid = 'public.increment_bot_revision()'::regprocedure
       and routine.prosecdef
       and routine.proconfig @> array['search_path=pg_catalog']::text[]
  )
  and not has_function_privilege('public', 'public.increment_bot_revision()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.increment_bot_revision()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.increment_bot_revision()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.increment_bot_revision()', 'EXECUTE')
  and exists (
    select 1 from pg_trigger trigger_row
     where trigger_row.tgrelid = 'public.bots'::regclass
       and trigger_row.tgname = 'bots_increment_revision'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 19
       and trigger_row.tgfoid = 'public.increment_bot_revision()'::regprocedure
  )
  and exists (
    select 1
      from pg_attribute column_row
      join pg_attrdef default_row
        on default_row.adrelid = column_row.attrelid
       and default_row.adnum = column_row.attnum
     where column_row.attrelid = 'public.bot_assignments'::regclass
       and column_row.attname = 'revision'
       and not column_row.attisdropped
       and column_row.attnotnull
       and column_row.atttypid = 'pg_catalog.int8'::regtype
       and pg_get_expr(default_row.adbin, default_row.adrelid)
         in ('1', '1::bigint', '''1''::bigint')
  )
  and exists (
    select 1 from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.bot_assignments'::regclass
       and constraint_row.conname = 'bot_assignments_revision_positive'
       and constraint_row.contype = 'c'
       and pg_get_constraintdef(constraint_row.oid) like '%revision > 0%'
  )
  and exists (
    select 1 from pg_proc routine
     where routine.oid = 'public.increment_bot_assignment_revision()'::regprocedure
       and routine.prosecdef
       and routine.proconfig @> array['search_path=pg_catalog']::text[]
  )
  and not has_function_privilege('public', 'public.increment_bot_assignment_revision()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.increment_bot_assignment_revision()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.increment_bot_assignment_revision()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.increment_bot_assignment_revision()', 'EXECUTE')
  and exists (
    select 1 from pg_trigger trigger_row
     where trigger_row.tgrelid = 'public.bot_assignments'::regclass
       and trigger_row.tgname = 'bot_assignments_increment_revision'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 19
       and trigger_row.tgfoid = 'public.increment_bot_assignment_revision()'::regprocedure
  )
  and (
    select count(*) = 5
      from pg_proc routine
     where routine.oid in (
        'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'::regprocedure,
        'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'::regprocedure,
        'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'::regprocedure,
        'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'::regprocedure,
        'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)'::regprocedure
     )
       and routine.prosecdef
       and routine.proconfig @> array['search_path=pg_catalog']::text[]
  )
  and not exists (
    select 1
      from (values
        ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)'),
        ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'),
        ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'),
        ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)')
      ) expected(signature)
     where not has_function_privilege('authenticated', expected.signature, 'EXECUTE')
        or has_function_privilege('anon', expected.signature, 'EXECUTE')
        or has_function_privilege('public', expected.signature, 'EXECUTE')
         or has_function_privilege('service_role', expected.signature, 'EXECUTE')
  )
  and has_function_privilege(
    'service_role',
    'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
    'EXECUTE'
  )
  and not exists (
    select 1
      from (values
        ('public.assign_bot(uuid,uuid,uuid,uuid)'),
        ('public.assign_bots_to_project(uuid,uuid,jsonb)'),
        ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'),
        ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'),
        ('public.set_bot_assignment_execution(uuid,uuid,text,text)'),
        ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)')
      ) legacy(signature)
     where not has_function_privilege('authenticated', legacy.signature, 'EXECUTE')
        or has_function_privilege('anon', legacy.signature, 'EXECUTE')
        or has_function_privilege('public', legacy.signature, 'EXECUTE')
        or has_function_privilege('service_role', legacy.signature, 'EXECUTE')
  );
