\set ON_ERROR_STOP on

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';

do $grok_graph_rewake_catalog_postflight$
declare
  v_table text;
  v_relation oid;
begin
  if (select pg_catalog.count(*) from supabase_migrations.schema_migrations
       where version = '20260831001600') <> 1 then
    raise exception 'grok_graph_rewake_postflight_ledger_mismatch';
  end if;

  foreach v_table in array array[
    'grok_graph_rewake_intents', 'grok_graph_rewake_attempts'
  ] loop
    select relation.oid
      into v_relation
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = v_table
       and relation.relkind = 'r'
       and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
       and relation.relrowsecurity
       and relation.relforcerowsecurity;
    if v_relation is null
        or pg_catalog.has_table_privilege(
          'anon', v_relation,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        or pg_catalog.has_table_privilege(
          'service_role', v_relation,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        or not pg_catalog.has_table_privilege('authenticated', v_relation, 'SELECT')
        or pg_catalog.has_table_privilege(
          'authenticated', v_relation,
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
    then
      raise exception 'grok_graph_rewake_postflight_table_rls_or_acl_mismatch: %',
        v_table;
    end if;

    if (select pg_catalog.count(*) from pg_catalog.pg_policy policy
         where policy.polrelid = v_relation) <> 1
        or not exists (
          select 1
            from pg_catalog.pg_policy policy
           where policy.polrelid = v_relation
             and policy.polname = v_table || '_owner_select'
             and policy.polcmd = 'r'
             and policy.polpermissive
             and policy.polroles = array[(
               select role_row.oid from pg_catalog.pg_roles role_row
                where role_row.rolname = 'authenticated'
             )]
             and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
               like '%has_organization_role%owner%'
             and policy.polwithcheck is null
        )
    then
      raise exception 'grok_graph_rewake_postflight_policy_mismatch: %', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'public.grok_graph_rewake_intents'::pg_catalog.regclass
       and constraint_row.conname = 'grok_graph_rewake_intents_bridge_unique'
       and constraint_row.contype = 'u'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'public.grok_graph_rewake_intents'::pg_catalog.regclass
       and constraint_row.conname = 'grok_graph_rewake_intents_command_unique'
       and constraint_row.contype = 'u'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'public.grok_graph_rewake_intents'::pg_catalog.regclass
       and constraint_row.conname = 'grok_graph_rewake_intents_run_unique'
       and constraint_row.contype = 'u'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'public.grok_graph_rewake_attempts'::pg_catalog.regclass
       and constraint_row.conname = 'grok_graph_rewake_attempts_accepted_once'
       and constraint_row.contype = 'x'
  ) then
    raise exception 'grok_graph_rewake_postflight_identity_or_replay_constraint_mismatch';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
           'public.graph_phase1c_bridges'::pg_catalog.regclass
       and trigger_row.tgname = 'graph_phase1c_bridge_enqueue_grok_rewake'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 17
       and trigger_row.tgfoid =
         'public.enqueue_grok_graph_rewake_after_phase1c()'::pg_catalog.regprocedure
  ) or not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
           'public.grok_graph_rewake_intents'::pg_catalog.regclass
       and trigger_row.tgname = 'grok_graph_rewake_intents_transition'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 27
       and trigger_row.tgfoid =
         'public.enforce_grok_graph_rewake_intent_transition()'::pg_catalog.regprocedure
  ) or not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
           'public.grok_graph_rewake_attempts'::pg_catalog.regclass
       and trigger_row.tgname = 'grok_graph_rewake_attempts_append_only'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 27
       and trigger_row.tgfoid =
         'public.reject_grok_graph_rewake_attempt_mutation()'::pg_catalog.regprocedure
  ) or not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
           'public.grok_graph_rewake_attempts'::pg_catalog.regclass
       and trigger_row.tgname = 'grok_graph_rewake_attempts_no_truncate'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 34
  ) then
    raise exception 'grok_graph_rewake_postflight_trigger_mismatch';
  end if;
end;
$grok_graph_rewake_catalog_postflight$;

do $grok_graph_rewake_function_postflight$
declare
  v_signature text;
  v_service_execute boolean;
  v_routine oid;
begin
  for v_signature, v_service_execute in
    select * from (values
      ('public.assert_current_grok_graph_rewake_intent(public.grok_graph_rewake_intents)', false),
      ('public.enqueue_grok_graph_rewake_after_phase1c()', false),
      ('public.claim_grok_graph_rewake_as_worker(text,uuid,integer)', true),
      ('public.record_grok_graph_rewake_delivery_as_worker(text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text)', true)
    ) expected(signature, service_execute)
  loop
    v_routine := pg_catalog.to_regprocedure(v_signature);
    if v_routine is null or not exists (
      select 1
        from pg_catalog.pg_proc routine
        join pg_catalog.pg_language language_row
          on language_row.oid = routine.prolang
       where routine.oid = v_routine
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and language_row.lanname = 'plpgsql'
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and routine.prokind = 'f'
         and not routine.proleakproof
    )
        or pg_catalog.has_function_privilege('anon', v_routine, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', v_routine, 'EXECUTE')
        or pg_catalog.has_function_privilege(
          'service_role', v_routine, 'EXECUTE'
        ) is distinct from v_service_execute
    then
      raise exception 'grok_graph_rewake_postflight_function_identity_or_acl_mismatch: %',
        v_signature;
    end if;
  end loop;
end;
$grok_graph_rewake_function_postflight$;

do $grok_graph_rewake_runtime_postflight$
declare
  v_intents_before bigint;
  v_attempts_before bigint;
  v_blocked boolean := false;
begin
  select pg_catalog.count(*) into v_intents_before
    from public.grok_graph_rewake_intents;
  select pg_catalog.count(*) into v_attempts_before
    from public.grok_graph_rewake_attempts;

  begin
    perform public.claim_grok_graph_rewake_as_worker(
      'missing-disabled-worker',
      '00000000-0000-4000-8000-000000000001'::uuid,
      120
    );
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_graph_rewake_postflight_disabled_worker_was_not_blocked';
  end if;

  v_blocked := false;
  begin
    perform public.record_grok_graph_rewake_delivery_as_worker(
      'missing-disabled-worker',
      '00000000-0000-4000-8000-000000000002'::uuid,
      '00000000-0000-4000-8000-000000000003'::uuid,
      '00000000-0000-4000-8000-000000000004'::uuid,
      '00000000-0000-4000-8000-000000000005'::uuid,
      '00000000-0000-4000-8000-000000000006'::uuid,
      '00000000-0000-4000-8000-000000000007'::uuid,
      true,
      null
    );
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'grok_graph_rewake_postflight_disabled_delivery_was_not_blocked';
  end if;

  if (select pg_catalog.count(*) from public.grok_graph_rewake_intents)
       is distinct from v_intents_before
      or (select pg_catalog.count(*) from public.grok_graph_rewake_attempts)
       is distinct from v_attempts_before
      or exists (
        select 1 from public.phase1c_workers worker
         where worker.last_heartbeat_at > pg_catalog.now() - interval '10 minutes'
            or worker.current_run_id is not null
      )
      or exists (
        select 1 from public.graph_runs graph_run
         where graph_run.state = 'RUNNING'::public.graph_run_state
      )
      or exists (
        select 1 from public.agent_runs agent_run
         where agent_run.status = 'running'::public.run_status
      )
  then
    raise exception 'grok_graph_rewake_postflight_runtime_or_evidence_changed';
  end if;
end;
$grok_graph_rewake_runtime_postflight$;

select 'grok-graph-rewake-release-postflight-ok';

rollback;
