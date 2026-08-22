-- CONTRACT half of the bot-account-binding release.
--
-- The replacement application must be serving and accepted before this file
-- is applied. This migration deliberately changes no function body, signature,
-- owner, SECURITY DEFINER attribute, search path, table, trigger, row, or
-- policy. It removes only direct EXECUTE from the six legacy bot mutators that
-- the EXPAND migration temporarily kept callable during the rolling cutover.

do $contract$
declare
  v_bad text;
begin
  -- Make pg_get_functiondef output deterministic before comparing the frozen
  -- definitions inherited unchanged through 20260822000200.
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  if pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception using errcode = '55000',
      message = 'bot mutator CONTRACT roles are not the exact expected catalog';
  end if;

  -- A ledger row is not catalog proof. Require the complete EXPAND function
  -- surface, exact frozen definitions, SECURITY DEFINER/search_path posture,
  -- and intended replacement ACL before removing any compatibility grant.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.ai_account_bot_credential_ref(public.bot_provider,text)',
     'd652a3406462bd5e9fcc4ae6afabdc49', 'none'),
    ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)',
     '8d881acabd1e1f28ea74c3efc22354f3', 'authenticated'),
    ('public.enforce_bot_ai_account_binding()',
     '1acb03fac46c74be02b8e6ea746e0181', 'none'),
    ('public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)',
     'eeb186b89ac3ba86f3c44bbc611d300e', 'authenticated'),
    ('public.increment_bot_assignment_revision()',
     'a38347e81d404d1e6e33782cbabcd16a', 'none'),
    ('public.increment_bot_revision()',
     '25974d86264401f18dc34d4f5e10be53', 'none'),
    ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
     '416c81badfba6c09091b2f187188a81f', 'service_role'),
    ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)',
     '33e2ca65ab238042321775c4144fef79', 'authenticated'),
    ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)',
     '1364d470f5bea2fa389f3d48de320504', 'authenticated'),
    ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)',
     '237ca9363d7934b0c5d63733e5631ca7', 'authenticated')
  ) expected(signature, definition_md5, execute_role)
  left join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine.oid is null
     or routine_schema.nspname is distinct from 'public'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(routine.oid))
          is distinct from expected.definition_md5
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl))
          <> case when expected.execute_role = 'none' then 1 else 2 end
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or (
       expected.execute_role <> 'none'
       and not exists (
         select 1
         from pg_catalog.aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner
           and acl.grantee = pg_catalog.to_regrole(expected.execute_role)::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee <> routine.proowner
         and (
           expected.execute_role = 'none'
           or acl.grantee <> pg_catalog.to_regrole(expected.execute_role)::oid
         )
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or (
       pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       is distinct from (expected.execute_role = 'authenticated')
     )
     or (
       pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
       is distinct from (expected.execute_role = 'service_role')
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 function catalog is not the exact approved EXPAND state',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine_schema.nspname = 'public'
    and routine.proname in (
      'ai_account_bot_credential_ref',
      'assign_bots_to_project_checked',
      'enforce_bot_ai_account_binding',
      'ensure_ai_account_bot',
      'increment_bot_assignment_revision',
      'increment_bot_revision',
      'record_bot_readiness_preserving_disabled',
      'set_bot_assignment_execution_checked',
      'update_bot_assignment_checked',
      'update_bot_assignment_configuration_checked'
    )
    and routine.oid not in (
      'public.ai_account_bot_credential_ref(public.bot_provider,text)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.enforce_bot_ai_account_binding()'::pg_catalog.regprocedure,
      'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'::pg_catalog.regprocedure,
      'public.increment_bot_assignment_revision()'::pg_catalog.regprocedure,
      'public.increment_bot_revision()'::pg_catalog.regprocedure,
      'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 has an unexpected helper or checked-function overload',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.identity, ', ' order by expected.identity)
  into v_bad
  from (values
    ('public.bot_assignments.revision', 'public.bot_assignments'::pg_catalog.regclass,
     'revision', 'bot_assignments_revision_positive'),
    ('public.bots.revision', 'public.bots'::pg_catalog.regclass,
     'revision', 'bots_revision_positive')
  ) expected(identity, relation_id, column_name, constraint_name)
  left join pg_catalog.pg_attribute column_row
    on column_row.attrelid = expected.relation_id
   and column_row.attname = expected.column_name
   and not column_row.attisdropped
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = column_row.attrelid
   and default_row.adnum = column_row.attnum
  left join pg_catalog.pg_constraint constraint_row
    on constraint_row.conrelid = expected.relation_id
   and constraint_row.conname = expected.constraint_name
  where column_row.attnum is null
     or column_row.atttypid <> 'pg_catalog.int8'::pg_catalog.regtype
     or not column_row.attnotnull
     or column_row.attidentity <> ''
     or column_row.attgenerated <> ''
     or default_row.oid is null
     or pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
          not in ('1', '1::bigint', '''1''::bigint')
     or constraint_row.oid is null
     or constraint_row.contype <> 'c'
     or not constraint_row.convalidated
     or constraint_row.connoinherit
     or pg_catalog.pg_get_constraintdef(constraint_row.oid) <> 'CHECK ((revision > 0))';

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 revision column or constraint catalog is not exact',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.identity, ', ' order by expected.identity)
  into v_bad
  from (values
    ('public.bot_assignments.bot_assignments_increment_revision',
     'public.bot_assignments'::pg_catalog.regclass,
     'bot_assignments_increment_revision', 19::smallint,
     'public.increment_bot_assignment_revision()'::pg_catalog.regprocedure,
     'e7c4e60faa83da3f09d578815e47016b'),
    ('public.bots.bots_ai_account_binding_coherent',
     'public.bots'::pg_catalog.regclass,
     'bots_ai_account_binding_coherent', 23::smallint,
     'public.enforce_bot_ai_account_binding()'::pg_catalog.regprocedure,
     'ae174d48495938eb6aa93a1340ae4680'),
    ('public.bots.bots_increment_revision',
     'public.bots'::pg_catalog.regclass,
     'bots_increment_revision', 19::smallint,
     'public.increment_bot_revision()'::pg_catalog.regprocedure,
     '4bb567fb61d925c6a7b8dffaf9218c4f')
  ) expected(identity, relation_id, trigger_name, trigger_type, function_id, definition_md5)
  left join pg_catalog.pg_trigger trigger_row
    on trigger_row.tgrelid = expected.relation_id
   and trigger_row.tgname = expected.trigger_name
   and not trigger_row.tgisinternal
  where trigger_row.oid is null
     or trigger_row.tgenabled <> 'O'
     or trigger_row.tgtype <> expected.trigger_type
     or trigger_row.tgfoid <> expected.function_id
     or pg_catalog.md5(pg_catalog.pg_get_triggerdef(trigger_row.oid))
          <> expected.definition_md5;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '20260822000200 trigger catalog is not exact',
      detail = v_bad;
  end if;

  -- Refuse a missing, replaced, re-owned, reconfigured, or differently
  -- granted legacy routine. The hashes are md5(pg_get_functiondef(oid)) with
  -- search_path pinned to pg_catalog, so they cover the complete definitions,
  -- including arguments/defaults, return contracts, volatility, language,
  -- SECURITY DEFINER, search_path, and bodies.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '2398b395e3545628939f4f5b6461011d'),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '4bf7d8d08c5cf938fba2fea2376839eb'),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     'ed7c5cbe31543823161348d14d9c69d7'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     'cab77271ac904b4e13105f3dd3a06335'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '77852950f29eb560c300e0ec24649ed9'),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     '6cd8b39bcae374515bedc66d5da31413')
  ) expected(signature, definition_md5)
  left join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  left join pg_catalog.pg_language routine_language
    on routine_language.oid = routine.prolang
  where routine.oid is null
     or routine_schema.nspname is distinct from 'public'
     or routine_language.lanname is distinct from 'plpgsql'
     or routine.prokind is distinct from 'f'
     or routine.provolatile is distinct from 'v'
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(routine.oid))
          is distinct from expected.definition_md5
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) <> 2
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = pg_catalog.to_regrole('authenticated')::oid
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', expected.signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot mutator catalog does not match the exact authenticated-only EXPAND contract',
      detail = v_bad;
  end if;

  -- An unexpected overload could remain a direct, unversioned mutation path
  -- after the six approved identities are closed. Stop instead of partially
  -- contracting a dirty catalog.
  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine_schema.nspname = 'public'
    and routine.proname in (
      'assign_bot',
      'assign_bots_to_project',
      'record_bot_readiness',
      'set_bot_assignment_execution',
      'update_bot_assignment',
      'update_bot_assignment_configuration'
    )
    and routine.oid not in (
      'public.assign_bot(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution(uuid,uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected legacy bot mutator overload exists before CONTRACT',
      detail = v_bad;
  end if;

  -- One DO statement keeps preflight, the six ACL edits, and verification
  -- atomic even if a caller omits psql --single-transaction.
  execute 'revoke all privileges on function public.assign_bot(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.assign_bots_to_project(uuid,uuid,jsonb) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.record_bot_readiness(uuid,uuid,public.bot_readiness,text) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.set_bot_assignment_execution(uuid,uuid,text,text) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.update_bot_assignment(uuid,uuid,public.bot_assignment_status) from public, anon, authenticated, service_role';
  execute 'revoke all privileges on function public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status) from public, anon, authenticated, service_role';

  -- Re-read the complete definitions and exact ACL shape. The function owner
  -- remains the sole executor so SECURITY DEFINER checked wrappers can still
  -- delegate internally, while every direct client/worker path is closed.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '2398b395e3545628939f4f5b6461011d'),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '4bf7d8d08c5cf938fba2fea2376839eb'),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     'ed7c5cbe31543823161348d14d9c69d7'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     'cab77271ac904b4e13105f3dd3a06335'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '77852950f29eb560c300e0ec24649ed9'),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     '6cd8b39bcae374515bedc66d5da31413')
  ) expected(signature, definition_md5)
  join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  where pg_catalog.md5(pg_catalog.pg_get_functiondef(routine.oid))
          is distinct from expected.definition_md5
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) <> 1
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or pg_catalog.has_function_privilege(
       'authenticated', expected.signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot mutator CONTRACT verification failed',
      detail = v_bad;
  end if;
end;
$contract$;
