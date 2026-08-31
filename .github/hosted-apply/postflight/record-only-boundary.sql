set search_path = pg_catalog;
select exists (
  select 1 from pg_class relation
  where relation.oid = 'public.factory_record_only_submission_guards'::regclass
    and relation.relkind = 'r' and relation.relrowsecurity and relation.relforcerowsecurity
    and relation.relowner = (select relowner from pg_class where oid = 'public.projects'::regclass)
    and relation.relacl is not null
    and not has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('authenticated', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('service_role', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
)
and (select count(*) = 7 and bool_and(attribute.attacl is null)
       from pg_attribute attribute
      where attribute.attrelid = 'public.factory_record_only_submission_guards'::regclass
        and attribute.attnum > 0 and not attribute.attisdropped)
and (select count(*) = 4 from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.factory_record_only_submission_guards'::regclass
        and constraint_row.contype in ('p','c'))
and not exists (select 1 from pg_policy policy where policy.polrelid = 'public.factory_record_only_submission_guards'::regclass)
and not exists (select 1 from pg_trigger trigger_row where trigger_row.tgrelid = 'public.factory_record_only_submission_guards'::regclass and not trigger_row.tgisinternal)
and not exists (select 1 from pg_rewrite rule_row where rule_row.ev_class = 'public.factory_record_only_submission_guards'::regclass and rule_row.rulename <> '_RETURN')
and (select count(*) = 2 from pg_proc routine join pg_namespace space on space.oid = routine.pronamespace
      where space.nspname = 'public' and strpos(lower(routine.prosrc), 'insert into public.agent_runs') > 0
        and routine.oid in (
          'public.queue_phase1c_run_for_task()'::regprocedure,
          'public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)'::regprocedure))
and (select count(*) = 2 from pg_proc routine join pg_namespace space on space.oid = routine.pronamespace
      where space.nspname = 'public' and strpos(lower(routine.prosrc), 'insert into public.agent_runs') > 0)
and (select count(*) = 20 from pg_trigger trigger_row
      where trigger_row.tgrelid in ('public.commands'::regclass, 'public.tasks'::regclass, 'public.agent_runs'::regclass)
        and not trigger_row.tgisinternal)
and not exists (select 1 from pg_rewrite rule_row
      where rule_row.ev_class in ('public.commands'::regclass, 'public.tasks'::regclass, 'public.agent_runs'::regclass)
        and rule_row.rulename <> '_RETURN')
and not exists (
  select 1 from public.agent_runs run
  join public.tasks task on task.id = run.task_id
  join public.commands command on command.id = task.command_id
  where command.parameters ->> 'executionMode' = 'record_only'
);
