-- Provider-aware AI Factory command recording without provider execution.
--
-- The existing Phase 1C path remains an executable, manually requested
-- OpenAI/Codex draft-PR path. Any other bot/model selected by the AI Factory may
-- now record the same durable command/task/routing intent, but it receives the
-- explicit `record_only` disposition and can never create an agent_run. This
-- migration does not register, claim, heartbeat, or otherwise alter a worker,
-- and it does not change any autonomy or kill-switch control.

-- Refuse every catalog other than the exact post-20260822000900 function
-- boundary before making the first durable change. Function OIDs are captured
-- live because they are database-local identities; the postflight below proves
-- that each existing OID was either preserved in place or moved to the exact
-- private name specified by this migration.
create temporary table _sf_20260822001000_input_expectations (
  purpose text primary key,
  signature text unique not null,
  source_md5 text not null check (pg_catalog.length(source_md5) = 32),
  contract_md5 text not null check (pg_catalog.length(contract_md5) = 32),
  volatility text not null check (volatility in ('i', 's', 'v')),
  execute_role text not null check (execute_role in ('none', 'authenticated'))
) on commit drop;

insert into _sf_20260822001000_input_expectations (
  purpose, signature, source_md5, contract_md5, volatility, execute_role
) values
  ('list_candidates',
   'public.list_factory_command_routing_candidates(uuid,uuid,text)',
   '2ac0a2a4d51e54d1b0d89f49cf33ba87',
   '17919dac57b41b75fe0793ad660063cc', 's', 'authenticated'),
  ('submit_factory',
   'public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
   '7addf177418dea367bce655815915e61',
   'b779f9c2f2c4d0cf086f6d67b85a457c', 'v', 'authenticated'),
  ('submit_command',
   'public.submit_command(uuid,text,public.risk_level,jsonb,text)',
   'adb50eb74e1721274f23d0d69b79e2e8',
   'b725d8bc77d8d0b2f34a69c900c16d1f', 'v', 'authenticated'),
  ('normalize_command', 'public.normalize_phase1c_command()',
   'c117268204c1d35f2c47e1b551ba02db',
   '32b955c1d25380d6e075024ee98f8530', 'v', 'none'),
  ('plan_task', 'public.plan_phase1c_task_and_run()',
   '93582f85bcdd9f95202cba675fdca814',
   '32b955c1d25380d6e075024ee98f8530', 'v', 'none'),
  ('queue_run', 'public.queue_phase1c_run_for_task()',
   'b8324f6c0dd3ddeeed993538a3bafbc3',
   '32b955c1d25380d6e075024ee98f8530', 'v', 'none'),
  ('record_provider',
   'public.record_provider_run(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   'c450eac6987cdd603d2d2511a9fa8833',
   'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'authenticated'),
  ('record_provider_phase2a',
   'public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   '46cee8bec5e12fd4f087ecbeea0c9844',
   'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'none');

create temporary table _sf_20260822001000_function_guard (
  purpose text primary key,
  input_signature text unique not null,
  routine_oid oid unique not null,
  input_source text not null,
  catalog_without_name_source_acl jsonb not null,
  effective_acl jsonb not null,
  object_comment text
) on commit drop;

create temporary table _sf_20260822001000_trigger_guard (
  trigger_name text primary key,
  trigger_oid oid unique not null,
  trigger_catalog jsonb not null
) on commit drop;

create temporary table _sf_20260822001000_trigger_expectations (
  relation_name text not null,
  trigger_name text primary key,
  function_signature text not null,
  trigger_type smallint not null
) on commit drop;

insert into _sf_20260822001000_trigger_expectations (
  relation_name, trigger_name, function_signature, trigger_type
) values
  ('public.commands', 'commands_audit_submitted',
   'public.audit_command_submitted()', 5),
  ('public.commands', 'commands_phase1c_normalize',
   'public.normalize_phase1c_command()', 7),
  ('public.commands', 'commands_phase1c_red_block',
   'public.keep_phase1c_red_command_blocked()', 19),
  ('public.commands', 'commands_prevent_org_change',
   'public.prevent_organization_reassignment()', 19),
  ('public.commands', 'commands_reject_sensitive_data',
   'public.reject_sensitive_row_data()', 23),
  ('public.commands', 'commands_set_updated_at',
   'public.set_updated_at()', 19),
  ('public.tasks', 'tasks_audit_created',
   'public.audit_task_created()', 5),
  ('public.tasks', 'tasks_phase1c_plan',
   'public.plan_phase1c_task_and_run()', 7),
  ('public.tasks', 'tasks_phase1c_queue',
   'public.queue_phase1c_run_for_task()', 5),
  ('public.tasks', 'tasks_phase1c_red_block',
   'public.keep_phase1c_red_task_blocked()', 19),
  ('public.tasks', 'tasks_prevent_org_change',
   'public.prevent_organization_reassignment()', 19),
  ('public.tasks', 'tasks_red_execution_gate',
   'public.enforce_red_task_execution()', 23),
  ('public.tasks', 'tasks_reject_sensitive_data',
   'public.reject_sensitive_row_data()', 23),
  ('public.tasks', 'tasks_set_updated_at',
   'public.set_updated_at()', 19),
  ('public.agent_runs', 'agent_runs_audit_started',
   'public.audit_agent_started()', 21),
  ('public.agent_runs', 'agent_runs_normalize_provider_dimensions',
   'public.normalize_provider_agent_run_dimensions()', 7),
  ('public.agent_runs', 'agent_runs_prevent_org_change',
   'public.prevent_organization_reassignment()', 19),
  ('public.agent_runs', 'agent_runs_red_execution_gate',
   'public.enforce_red_agent_run_execution()', 23),
  ('public.agent_runs', 'agent_runs_reject_sensitive_data',
   'public.reject_phase1c_agent_run_sensitive_data()', 23),
  ('public.agent_runs', 'agent_runs_set_updated_at',
   'public.set_updated_at()', 19);

create temporary table _sf_20260822001000_agent_runs_guard (
  relation_catalog jsonb not null,
  column_catalog jsonb not null,
  policy_catalog jsonb not null
) on commit drop;

do $preflight$
declare
  v_bad text;
  v_owner oid;
begin
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  if pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('service_role') is null
    or pg_catalog.to_regclass('auth.users') is null
    or pg_catalog.to_regclass('public.projects') is null
    or pg_catalog.to_regclass('public.commands') is null
    or pg_catalog.to_regclass('public.tasks') is null
    or pg_catalog.to_regclass('public.agent_runs') is null
    or pg_catalog.to_regclass('public.bot_assignments') is null
    or pg_catalog.to_regclass('public.bots') is null
    or pg_catalog.to_regtype('public.risk_level') is null
    or pg_catalog.to_regtype('public.run_status') is null then
    raise exception using errcode = '55000',
      message = '01000 prerequisites are not the exact expected catalog';
  end if;

  select relation.relowner into v_owner
  from pg_catalog.pg_class relation
  where relation.oid = 'public.projects'::pg_catalog.regclass;
  if v_owner is null
    or pg_catalog.pg_get_userbyid(v_owner) is distinct from 'postgres'
    or pg_catalog.to_regrole(current_user)::oid is distinct from v_owner then
    raise exception using errcode = '55000',
      message = '01000 migration identity does not own the protected catalog';
  end if;

  if pg_catalog.to_regclass('public.factory_record_only_submission_guards') is not null
    or pg_catalog.to_regprocedure(
      'public.list_factory_commands(uuid,integer,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.submit_command_phase1c_normalized_internal(uuid,text,public.risk_level,jsonb,text)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.submit_factory_command_routing_internal(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.record_provider_run_phase1c_compatibility_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)'
    ) is not null then
    raise exception using errcode = '55000',
      message = '01000 forward-only artifacts already exist';
  end if;

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from _sf_20260822001000_input_expectations expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  left join pg_catalog.pg_language language
    on language.oid = procedure.prolang
  where procedure.oid is null
     or namespace.nspname is distinct from 'public'
     or language.lanname is distinct from 'plpgsql'
     or procedure.proowner is distinct from v_owner
     or procedure.prokind is distinct from 'f'::"char"
     or procedure.provolatile is distinct from expected.volatility::"char"
     or procedure.prosecdef is distinct from true
     or procedure.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or procedure.proisstrict
     or procedure.proleakproof
     or procedure.proparallel is distinct from 'u'::"char"
     or procedure.provariadic <> 0
     or procedure.prosupport <> 0
     or procedure.probin is not null
     or procedure.prosqlbody is not null
     or pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          procedure.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
          is distinct from expected.source_md5
     or pg_catalog.md5(pg_catalog.jsonb_build_array(
          namespace.nspname,
          language.lanname,
          pg_catalog.pg_get_userbyid(procedure.proowner),
          procedure.prokind::text,
          pg_catalog.format_type(procedure.prorettype, null),
          procedure.proretset,
          procedure.pronargs,
          procedure.pronargdefaults,
          coalesce(pg_catalog.array_to_string(procedure.proargnames, ','), ''),
          coalesce(pg_catalog.array_to_string(procedure.proargmodes, ','), ''),
          coalesce((
            select pg_catalog.string_agg(
              pg_catalog.format_type(argument_type.type_oid, null),
              ',' order by argument_type.ordinality
            )
            from pg_catalog.unnest(procedure.proallargtypes)
              with ordinality argument_type(type_oid, ordinality)
          ), ''),
          coalesce(pg_catalog.pg_get_expr(procedure.proargdefaults, 0), ''),
          procedure.proisstrict,
          procedure.proleakproof,
          procedure.prosecdef,
          procedure.proparallel::text,
          procedure.provariadic = 0,
          procedure.procost::text,
          procedure.prorows::text,
          procedure.prosupport = 0,
          procedure.probin is null,
          procedure.prosqlbody is null,
          procedure.protrftypes is null,
          procedure.proconfig,
          procedure.proacl is null
        )::text) is distinct from expected.contract_md5
     or procedure.proacl is null
     or (select pg_catalog.count(*)
         from pg_catalog.aclexplode(procedure.proacl))
          <> case when expected.execute_role = 'none' then 1 else 2 end
     or not exists (
       select 1 from pg_catalog.aclexplode(procedure.proacl) acl
       where acl.grantor = procedure.proowner
         and acl.grantee = procedure.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or (
       expected.execute_role = 'authenticated'
       and not exists (
         select 1 from pg_catalog.aclexplode(procedure.proacl) acl
         where acl.grantor = procedure.proowner
           and acl.grantee = pg_catalog.to_regrole('authenticated')::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     )
     or exists (
       select 1 from pg_catalog.aclexplode(procedure.proacl) acl
       where acl.grantor <> procedure.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            case when expected.execute_role = 'authenticated'
              then pg_catalog.to_regrole('authenticated')::oid
              else procedure.proowner end
          )
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
          'authenticated', expected.signature, 'EXECUTE'
        ) is distinct from (expected.execute_role = 'authenticated')
     or exists (
       select 1 from pg_catalog.aclexplode(procedure.proacl) acl
       where acl.grantee = 0
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 input function catalog, source, or ACL mismatch',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    procedure.oid::pg_catalog.regprocedure::text,
    ', ' order by procedure.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'list_factory_command_routing_candidates', 'submit_factory_command',
      'submit_command', 'normalize_phase1c_command',
      'plan_phase1c_task_and_run', 'queue_phase1c_run_for_task',
      'record_provider_run', 'record_provider_run_phase2a_internal'
    )
    and not exists (
      select 1
      from _sf_20260822001000_input_expectations expected
      where pg_catalog.to_regprocedure(expected.signature) = procedure.oid
    );
  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 found an unexpected input function overload',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.trigger_name, ', ' order by expected.trigger_name)
  into v_bad
  from _sf_20260822001000_trigger_expectations expected
  left join pg_catalog.pg_trigger trigger
    on trigger.tgname = expected.trigger_name
   and trigger.tgrelid = pg_catalog.to_regclass(expected.relation_name)
  where trigger.oid is null
     or trigger.tgisinternal
     or trigger.tgfoid <> pg_catalog.to_regprocedure(expected.function_signature)
     or trigger.tgtype <> expected.trigger_type
     or trigger.tgenabled <> 'O'::"char"
     or trigger.tgnargs <> 0
     or trigger.tgqual is not null
     or trigger.tgoldtable is not null
     or trigger.tgnewtable is not null
     or trigger.tgparentid <> 0;
  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 trigger binding mismatch before replacement',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    trigger.tgrelid::pg_catalog.regclass::text || '.' || trigger.tgname,
    ', ' order by trigger.tgrelid::pg_catalog.regclass::text, trigger.tgname
  )
  into v_bad
  from pg_catalog.pg_trigger trigger
  where trigger.tgrelid in (
    'public.commands'::pg_catalog.regclass,
    'public.tasks'::pg_catalog.regclass,
    'public.agent_runs'::pg_catalog.regclass
  )
    and not trigger.tgisinternal
    and not exists (
      select 1
      from _sf_20260822001000_trigger_expectations expected
      where expected.trigger_name = trigger.tgname
        and pg_catalog.to_regclass(expected.relation_name) = trigger.tgrelid
    );
  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 found an unexpected command, task, or run trigger',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    rewrite.ev_class::pg_catalog.regclass::text || '.' || rewrite.rulename,
    ', ' order by rewrite.ev_class::pg_catalog.regclass::text, rewrite.rulename
  )
  into v_bad
  from pg_catalog.pg_rewrite rewrite
  where rewrite.ev_class in (
    'public.commands'::pg_catalog.regclass,
    'public.tasks'::pg_catalog.regclass,
    'public.agent_runs'::pg_catalog.regclass
  )
    and rewrite.rulename <> '_RETURN';
  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 found an unexpected command, task, or run rule',
      detail = v_bad;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend dependency
    where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      and dependency.refobjid in (
        pg_catalog.to_regprocedure(
          'public.submit_command(uuid,text,public.risk_level,jsonb,text)'
        ),
        pg_catalog.to_regprocedure(
          'public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)'
        ),
        pg_catalog.to_regprocedure(
          'public.record_provider_run(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)'
        )
      )
  ) then
    raise exception using errcode = '55000',
      message = '01000 refuses to rename a function with catalog dependents';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = 'public.agent_runs'::pg_catalog.regclass
      and relation.relkind = 'r'::"char"
      and relation.relowner = v_owner
      and relation.relrowsecurity
      and relation.relforcerowsecurity
      and not relation.relispartition
      and relation.relacl is not null
      and (select pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(acl)
             order by acl.grantor, acl.grantee, acl.privilege_type
           ) from pg_catalog.aclexplode(relation.relacl) acl)
          = (select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(acl)
               order by acl.grantor, acl.grantee, acl.privilege_type
             ) from pg_catalog.aclexplode(
               pg_catalog.acldefault('r', relation.relowner)
             ) acl)
  )
    or pg_catalog.has_table_privilege('anon', 'public.agent_runs',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or pg_catalog.has_table_privilege('authenticated', 'public.agent_runs',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or pg_catalog.has_table_privilege('service_role', 'public.agent_runs',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists (
      select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid = 'public.agent_runs'::pg_catalog.regclass
        and attribute.attnum > 0 and not attribute.attisdropped
        and attribute.attacl is not null
    )
    or not exists (
      select 1 from pg_catalog.pg_policy policy
      where policy.polrelid = 'public.agent_runs'::pg_catalog.regclass
        and policy.polname = 'agent_runs_select_members'
        and policy.polpermissive
        and policy.polcmd = 'r'::"char"
        and policy.polroles = array[
          pg_catalog.to_regrole('authenticated')::oid
        ]::oid[]
        and pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid
        ) = 'public.is_organization_member(organization_id)'
        and policy.polwithcheck is null
    )
    or (select pg_catalog.count(*) from pg_catalog.pg_policy policy
        where policy.polrelid = 'public.agent_runs'::pg_catalog.regclass) <> 1 then
    raise exception using errcode = '55000',
      message = '01000 agent_runs RLS, ACL, or policy boundary mismatch';
  end if;

  insert into _sf_20260822001000_function_guard (
    purpose, input_signature, routine_oid, input_source,
    catalog_without_name_source_acl, effective_acl, object_comment
  )
  select expected.purpose, expected.signature, procedure.oid, procedure.prosrc,
    pg_catalog.to_jsonb(procedure) - 'proname' - 'prosrc' - 'proacl',
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'grantor', acl.grantor,
        'grantee', acl.grantee,
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) order by acl.grantor, acl.grantee, acl.privilege_type)
      from pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) acl
    ), '[]'::jsonb),
    pg_catalog.obj_description(procedure.oid, 'pg_proc')
  from _sf_20260822001000_input_expectations expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(expected.signature);

  insert into _sf_20260822001000_trigger_guard (
    trigger_name, trigger_oid, trigger_catalog
  )
  select trigger.tgname, trigger.oid, pg_catalog.to_jsonb(trigger)
  from _sf_20260822001000_trigger_expectations expected
  join pg_catalog.pg_trigger trigger
    on trigger.tgname = expected.trigger_name
   and trigger.tgrelid = pg_catalog.to_regclass(expected.relation_name);

  insert into _sf_20260822001000_agent_runs_guard (
    relation_catalog, column_catalog, policy_catalog
  )
  select pg_catalog.to_jsonb(relation),
    (select pg_catalog.jsonb_agg(
       pg_catalog.to_jsonb(attribute) order by attribute.attnum
     )
     from pg_catalog.pg_attribute attribute
     where attribute.attrelid = relation.oid),
    (select pg_catalog.jsonb_agg(
       pg_catalog.to_jsonb(policy) order by policy.polname
     )
     from pg_catalog.pg_policy policy
     where policy.polrelid = relation.oid)
  from pg_catalog.pg_class relation
  where relation.oid = 'public.agent_runs'::pg_catalog.regclass;

  if (select pg_catalog.count(*) from _sf_20260822001000_function_guard) <> 8
    or (select pg_catalog.count(*) from _sf_20260822001000_trigger_guard) <> 20
    or (select pg_catalog.count(*) from _sf_20260822001000_agent_runs_guard) <> 1 then
    raise exception using errcode = '55000',
      message = '01000 failed to capture every protected input identity';
  end if;

  select pg_catalog.string_agg(procedure.oid::pg_catalog.regprocedure::text,
    ', ' order by procedure.oid::pg_catalog.regprocedure::text)
  into v_bad
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and pg_catalog.strpos(pg_catalog.lower(procedure.prosrc),
      'insert into public.agent_runs') > 0
    and procedure.oid not in (
      pg_catalog.to_regprocedure('public.queue_phase1c_run_for_task()'),
      pg_catalog.to_regprocedure(
        'public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)'
      )
    );
  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 found an unexpected agent_run producer',
      detail = v_bad;
  end if;
end;
$preflight$;

create table public.factory_record_only_submission_guards (
  token uuid primary key,
  caller_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  assignment_id uuid not null,
  authorized_parameters jsonb not null,
  created_at timestamptz not null default now(),
  constraint factory_record_only_guard_parameters_object
    check (pg_catalog.jsonb_typeof(authorized_parameters) = 'object'),
  constraint factory_record_only_guard_parameters_bounded
    check (pg_catalog.octet_length(authorized_parameters::text) <= 65536),
  constraint factory_record_only_guard_parameters_safe
    check (not public.jsonb_has_sensitive_keys(authorized_parameters))
);

comment on table public.factory_record_only_submission_guards is
  'Transaction-local capability rows consumed by submit_command so only the locked AI Factory boundary can persist a non-Codex record-only command. Successful calls leave this table empty.';

alter table public.factory_record_only_submission_guards enable row level security;
alter table public.factory_record_only_submission_guards force row level security;
revoke all on table public.factory_record_only_submission_guards
  from public, anon, authenticated, service_role;

-- Keep the complete, already-reviewed normalization, risk, dependency, and
-- Phase 1A persistence behavior at the same function OID behind a private
-- name. The public wrapper recreated below adds only a record-only capability
-- check before delegating to this unchanged implementation.
alter function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) rename to submit_command_phase1c_normalized_internal;

revoke all on function public.submit_command_phase1c_normalized_internal(
  uuid, text, public.risk_level, jsonb, text
) from public, anon, authenticated, service_role;

comment on function public.submit_command_phase1c_normalized_internal(
  uuid, text, public.risk_level, jsonb, text
) is
  'Private normalized Phase 1C command persistence used by the fixed public Codex boundary and the capability-gated AI Factory record-only boundary.';

-- Preserve the complete routing transaction behind a private name. The new
-- public wrapper derives provider/model from the locked posting before it
-- delegates; the original transaction then repeats every assignment,
-- readiness, risk, capacity, route, and immutable-evidence check.
alter function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) rename to submit_factory_command_routing_internal;

revoke all on function public.submit_factory_command_routing_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) from public, anon, authenticated, service_role;

comment on function public.submit_factory_command_routing_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) is
  'Private immutable-routing transaction. Callers use submit_factory_command, which locks and canonicalizes the selected provider/model first.';

-- The command trigger continues to be the last-resort SQL policy boundary.
-- Manual execution remains byte-for-byte the fixed OpenAI/Codex plan. The new
-- record-only branch accepts a bounded provider/model and one canonical
-- plan that advertises no pull request and no executable stages.
create or replace function public.normalize_phase1c_command()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  command_type_value text := coalesce(new.parameters ->> 'commandType', 'other');
  execution_mode_value text := coalesce(new.parameters ->> 'executionMode', '');
  required_role text;
  risk_floor public.risk_level;
  normalized_prompt text := lower(btrim(coalesce(new.prompt, '')));
  expected_budget constant jsonb := jsonb_build_object(
    'ciTimeoutMs', 900000, 'maximumDurationMs', 2700000,
    'maximumInputTokens', 200000, 'maximumOutputTokens', 50000,
    'maximumRepairAttempts', 1, 'maximumTurns', 4
  );
  expected_execution_plan constant jsonb := jsonb_build_object(
    'requiresDraftPullRequest', true,
    'stages', jsonb_build_array('inspect','implement','validate','policy_scan',
      'commit','draft_pull_request','ci','report'),
    'workflow', 'codex_draft_pr'
  );
  expected_record_only_plan constant jsonb := jsonb_build_object(
    'requiresDraftPullRequest', false,
    'stages', jsonb_build_array('record'),
    'workflow', 'factory_record_only'
  );
begin
  if command_type_value not in ('fix_bug','build_feature','audit','test','mobile','security','performance','other')
    or execution_mode_value not in ('manual', 'record_only')
    or jsonb_typeof(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) > 30
    or exists (
      select 1 from jsonb_array_elements(coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb)) criterion
      where jsonb_typeof(criterion) <> 'string'
        or char_length(btrim(criterion #>> '{}')) not between 3 and 500
        or public.text_has_likely_secret(criterion #>> '{}')
    )
    or jsonb_typeof(coalesce(new.parameters -> 'plan', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(new.parameters -> 'riskAssessment', '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid Phase 1C command plan';
  end if;

  select normalized_prompt || ' ' || coalesce(string_agg(lower(criterion #>> '{}'), ' '), '')
    into normalized_prompt
  from jsonb_array_elements(new.parameters -> 'acceptanceCriteria') criterion;

  required_role := case command_type_value
    when 'audit' then 'qa' when 'test' then 'qa' when 'mobile' then 'frontend'
    when 'security' then 'security' when 'performance' then 'performance'
    when 'build_feature' then 'architect' when 'fix_bug' then 'backend'
    else 'orchestrator' end;

  if new.parameters ->> 'agentRole' <> required_role
    or new.parameters -> 'budget' is distinct from expected_budget
    or (
      execution_mode_value = 'manual'
      and (
        new.parameters ->> 'provider' <> 'openai'
        or new.parameters ->> 'model' <> 'gpt-5.3-codex'
        or new.parameters -> 'plan' is distinct from expected_execution_plan
      )
    )
    or (
      execution_mode_value = 'record_only'
      and (
        char_length(btrim(coalesce(new.parameters ->> 'provider', ''))) not between 1 and 40
        or char_length(btrim(coalesce(new.parameters ->> 'model', ''))) not between 1 and 128
        or new.parameters -> 'plan' is distinct from expected_record_only_plan
      )
    ) then
    raise exception using errcode = '22023',
      message = 'Phase 1C execution configuration is not supported';
  end if;

  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(\mauth\M|authentication|authorization|oauth|session|cookie|rbac|permission|secret|credential|password|private[ _-]?key|api[ _-]?key|token|rls|row[ -]?level security|service[ _-]?role|production database|delete production|drop table|truncate|dns|domain ownership|billing|payment|money|auto[ -]?(merge|deploy|rollback|approve)|branch protection)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug','build_feature','mobile','performance','other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package(\.json)?|lockfile|upgrade|api|backend|frontend|component|route|workflow|configuration|refactor|feature|bug|performance|mobile|accessibility)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level end;

  new.requested_risk := greatest(new.requested_risk, risk_floor);
  new.parameters := jsonb_set(jsonb_set(new.parameters,
    '{riskAssessment,effectiveRisk}', to_jsonb(new.requested_risk::text), true),
    '{riskAssessment,classificationSource}', '"database_policy"'::jsonb, true);
  new.command_type := command_type_value;
  new.acceptance_criteria := coalesce(new.parameters -> 'acceptanceCriteria', '[]'::jsonb);
  new.execution_plan := coalesce(new.parameters -> 'plan', '{}'::jsonb);
  new.risk_assessment := coalesce(new.parameters -> 'riskAssessment', '{}'::jsonb);
  return new;
end;
$function$;

-- Record-only tasks still verify the exact live repository binding and the
-- standard budget, but stop before logical-agent creation. A queued record-only
-- task therefore has no executable agent identity to claim.
create or replace function public.plan_phase1c_task_and_run()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  command_record public.commands%rowtype;
  binding jsonb;
  budget jsonb;
  execution_mode_value text;
  role_text text;
  provider_text text;
  model_text text;
  agent_record public.agents%rowtype;
begin
  if new.command_id is null then return new; end if;

  select command.* into command_record from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found then return new; end if;
  new.acceptance_criteria := command_record.acceptance_criteria;
  if command_record.requested_risk = 'red'::public.risk_level then return new; end if;
  if command_record.requested_risk not in ('green'::public.risk_level, 'yellow'::public.risk_level)
    or new.status <> 'queued'::public.task_status then
    raise exception using errcode = '55000', message = 'only queued manual GREEN or YELLOW commands enter Phase 1C';
  end if;

  binding := command_record.parameters -> 'repositoryBinding';
  budget := command_record.parameters -> 'budget';
  execution_mode_value := command_record.parameters ->> 'executionMode';
  role_text := command_record.parameters ->> 'agentRole';
  provider_text := command_record.parameters ->> 'provider';
  model_text := command_record.parameters ->> 'model';
  if jsonb_typeof(binding) <> 'object' or jsonb_typeof(budget) <> 'object'
    or role_text not in ('orchestrator','product','architect','frontend','backend','database','qa','security','performance','release','ceo_reporter')
    or execution_mode_value not in ('manual', 'record_only')
    or (execution_mode_value = 'manual' and (provider_text <> 'openai' or model_text <> 'gpt-5.3-codex'))
    or (execution_mode_value = 'record_only' and (
      char_length(btrim(coalesce(provider_text, ''))) not between 1 and 40
      or char_length(btrim(coalesce(model_text, ''))) not between 1 and 128
    ))
    or coalesce(binding ->> 'repositoryId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'connectionId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'installationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'externalInstallationId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'externalRepositoryId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'appId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'baseSha', '') !~ '^[0-9a-fA-F]{40}$'
    or char_length(coalesce(binding ->> 'baseBranch', '')) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'Phase 1C execution binding is incomplete';
  end if;

  perform 1
  from public.projects project
  join public.project_connections link on link.project_id = project.id
    and link.organization_id = project.organization_id and link.is_primary
  join public.connections connection on connection.id = link.connection_id
    and connection.organization_id = link.organization_id
  join public.github_installations installation on installation.connection_id = connection.id
    and installation.organization_id = connection.organization_id
  join public.github_repositories repository on repository.id = link.github_repository_id
    and repository.installation_id = installation.id and repository.organization_id = link.organization_id
  where project.id = new.project_id and project.organization_id = new.organization_id
    and project.status = 'active'::public.project_status
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and repository.id = (binding ->> 'repositoryId')::uuid
    and connection.id = (binding ->> 'connectionId')::uuid
    and installation.id = (binding ->> 'installationId')::uuid
    and installation.external_installation_id = (binding ->> 'externalInstallationId')::bigint
    and repository.external_repository_id = (binding ->> 'externalRepositoryId')::bigint
    and installation.app_id = (binding ->> 'appId')::bigint
    and repository.default_branch = binding ->> 'baseBranch'
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch;
  if not found then
    raise exception using errcode = '55000', message = 'Phase 1C repository binding changed before queueing';
  end if;

  if execution_mode_value = 'record_only' then
    new.assigned_agent_id := null;
    return new;
  end if;

  select agent.* into agent_record from public.agents agent
  where agent.organization_id = new.organization_id
    and agent.project_id = new.project_id
    and agent.role = role_text::public.agent_role
    and agent.provider is null and agent.model is null
  order by agent.created_at asc limit 1 for update;

  if not found then
    select agent.* into agent_record from public.agents agent
    where agent.organization_id = new.organization_id and agent.project_id is null
      and agent.role = role_text::public.agent_role
      and agent.name = case role_text
        when 'ceo_reporter' then 'CEO Reporter'
        when 'qa' then 'QA'
        else initcap(replace(role_text, '_', ' ')) end
      and agent.provider is null and agent.model is null
    order by agent.created_at asc limit 1 for update;
    if not found then
      perform public.initialize_standard_logical_agent_roster(
        new.organization_id,
        command_record.submitted_by
      );
      select agent.* into agent_record from public.agents agent
      where agent.organization_id = new.organization_id and agent.project_id is null
        and agent.role = role_text::public.agent_role
        and agent.name = case role_text
          when 'ceo_reporter' then 'CEO Reporter'
          when 'qa' then 'QA'
          else initcap(replace(role_text, '_', ' ')) end
        and agent.provider is null and agent.model is null
      order by agent.created_at asc limit 1 for update;
    end if;
    if not found then
      raise exception using errcode = '55000', message = 'standard logical agent roster is unavailable';
    end if;

    insert into public.agents (
      organization_id, project_id, name, role, description, status,
      provider, model, capabilities, created_by
    ) values (
      new.organization_id, new.project_id, agent_record.name, agent_record.role,
      agent_record.description, 'idle'::public.agent_status, null, null,
      agent_record.capabilities, command_record.submitted_by
    )
    returning * into agent_record;
  end if;
  new.assigned_agent_id := agent_record.id;
  return new;
end;
$function$;

revoke all on function public.plan_phase1c_task_and_run()
  from public, anon, authenticated, service_role;

comment on function public.plan_phase1c_task_and_run() is
  'Validates queued command bindings. Manual Codex tasks bind a project-scoped logical agent; every other record-only task deliberately binds no executable agent.';

-- This is the decisive non-execution boundary: even a queued GREEN/YELLOW
-- record-only task returns before the only trigger that inserts agent_runs.
create or replace function public.queue_phase1c_run_for_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  command_record public.commands%rowtype;
  binding jsonb;
begin
  if new.command_id is null or new.status <> 'queued'::public.task_status then return new; end if;
  select command.* into command_record from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found or command_record.requested_risk = 'red'::public.risk_level then return new; end if;
  if command_record.parameters ->> 'executionMode' = 'record_only' then return new; end if;
  binding := command_record.parameters -> 'repositoryBinding';

  insert into public.agent_runs (
    organization_id, project_id, task_id, command_id, agent_id, status,
    input, connection_id, github_repository_id, risk_level, logical_agent_role,
    provider, model, base_branch, base_sha, max_attempts
  ) values (
    new.organization_id, new.project_id, new.id, new.command_id, new.assigned_agent_id,
    'queued'::public.run_status,
    jsonb_build_object(
      'commandType', command_record.command_type,
      'acceptanceCriteria', command_record.acceptance_criteria,
      'plan', command_record.execution_plan
    ),
    (binding ->> 'connectionId')::uuid,
    (binding ->> 'repositoryId')::uuid,
    command_record.requested_risk,
    (command_record.parameters ->> 'agentRole')::public.agent_role,
    command_record.parameters ->> 'provider',
    command_record.parameters ->> 'model',
    binding ->> 'baseBranch',
    lower(binding ->> 'baseSha'),
    2
  );
  return new;
end;
$function$;

revoke all on function public.queue_phase1c_run_for_task()
  from public, anon, authenticated, service_role;

comment on function public.queue_phase1c_run_for_task() is
  'Queues an executable agent_run only for the fixed manual Codex path. Other provider/model selections are durable record-only commands/tasks with no run.';

-- Original public signature, now explicitly fixed to manual Codex unless one
-- exact unguessable capability row was created and consumed inside the locked
-- submit_factory_command transaction. The private key is stripped before the
-- normalized parameters are validated or persisted.
create or replace function public.submit_command(
  p_project_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid, task_id uuid, command_state public.command_status,
  task_state public.task_status, requires_owner_approval boolean, was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_execution_mode text := coalesce(p_parameters ->> 'executionMode', '');
  v_token_text text := p_parameters ->> '_factoryRecordOnlyAuthorization';
  v_parameters jsonb := coalesce(p_parameters, '{}'::jsonb)
    - '_factoryRecordOnlyAuthorization';
begin
  if v_execution_mode = 'record_only' then
    if v_caller is null
      or coalesce(v_token_text, '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023',
        message = 'Phase 1C execution configuration is not supported';
    end if;

    delete from public.factory_record_only_submission_guards guard
    where guard.token = v_token_text::uuid
      and guard.caller_id = v_caller
      and guard.project_id = p_project_id
      and guard.authorized_parameters = v_parameters;
    if not found then
      raise exception using errcode = '22023',
        message = 'Phase 1C execution configuration is not supported';
    end if;
  elsif p_parameters ? '_factoryRecordOnlyAuthorization' then
    raise exception using errcode = '22023',
      message = 'Phase 1C execution configuration is not supported';
  end if;

  return query
  select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created
  from public.submit_command_phase1c_normalized_internal(
    p_project_id,
    p_prompt,
    p_requested_risk,
    case when v_execution_mode = 'record_only' then v_parameters else p_parameters end,
    p_idempotency_key
  ) submission;
end;
$function$;

revoke all on function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) to authenticated;

comment on function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) is
  'Persists fixed manual Codex commands. Any other bounded provider/model is accepted record-only only with a one-use capability created inside submit_factory_command; direct unsupported execution remains rejected.';

create or replace function public.submit_factory_command(
  p_organization_id uuid,
  p_project_id uuid,
  p_project_pipeline_id uuid,
  p_assignment_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid,
  task_id uuid,
  command_state public.command_status,
  task_state public.task_status,
  requires_owner_approval boolean,
  was_created boolean,
  route_id uuid,
  project_pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  assignment_id uuid,
  bot_id uuid,
  role_id uuid,
  routing_snapshot jsonb
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_assignment public.bot_assignments%rowtype;
  v_bot public.bots%rowtype;
  v_resolved_model text;
  v_guard_token uuid;
  v_canonical_parameters jsonb;
  v_authorized_parameters jsonb;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may submit a command';
  end if;

  -- This first lock supplies the only provider/model input accepted below.
  -- The private routing transaction obtains the same locks reentrantly and
  -- repeats all tenant, lifecycle, readiness, configuration, and capacity
  -- checks before writing anything.
  select assignment.* into v_assignment
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not active for this project';
  end if;

  select bot.* into v_bot
  from public.bots bot
  where bot.id = v_assignment.bot_id
    and bot.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not active for this project';
  end if;
  v_resolved_model := coalesce(v_assignment.model, v_bot.model);

  if not (
    v_bot.provider = 'openai'::public.bot_provider
    and v_resolved_model = 'gpt-5.3-codex'
  ) then
    v_canonical_parameters := coalesce(p_parameters, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'provider', v_bot.provider::text,
        'model', v_resolved_model,
        'executionMode', 'record_only',
        'plan', pg_catalog.jsonb_build_object(
          'requiresDraftPullRequest', false,
          'stages', pg_catalog.jsonb_build_array('record'),
          'workflow', 'factory_record_only'
        )
      );
    v_guard_token := gen_random_uuid();

    insert into public.factory_record_only_submission_guards (
      token, caller_id, organization_id, project_id, assignment_id,
      authorized_parameters
    ) values (
      v_guard_token, v_caller, p_organization_id, p_project_id,
      p_assignment_id, v_canonical_parameters
    );
    v_authorized_parameters := v_canonical_parameters
      || pg_catalog.jsonb_build_object(
        '_factoryRecordOnlyAuthorization', v_guard_token::text
      );
  else
    v_authorized_parameters := p_parameters;
  end if;

  return query
  select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created,
    submission.route_id, submission.project_pipeline_id,
    submission.pipeline_template_key, submission.pipeline_template_id,
    submission.assignment_id, submission.bot_id, submission.role_id,
    submission.routing_snapshot
  from public.submit_factory_command_routing_internal(
    p_organization_id,
    p_project_id,
    p_project_pipeline_id,
    p_assignment_id,
    p_prompt,
    p_requested_risk,
    v_authorized_parameters,
    p_idempotency_key
  ) submission;

  if v_guard_token is not null and exists (
    select 1 from public.factory_record_only_submission_guards guard
    where guard.token = v_guard_token
  ) then
    raise exception using errcode = '55000',
      message = 'record-only command authorization was not consumed';
  end if;
end;
$function$;

revoke all on function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) to authenticated;

comment on function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) is
  'Locks the selected bot provider/model. Exact OpenAI/Codex retains the executable manual route; every other bounded identity persists canonical record-only command/task/route evidence and creates no agent_run.';


-- Record-only history is durable intent, not executable in-flight work. Keep
-- both the read projection and the serialized submit gate on the same rule:
-- only routes whose persisted command can enter execution consume posting
-- capacity. The explicit definitions below are the 20260821000400 contracts
-- with that one predicate added; every other lock, gate, snapshot, and ACL is
-- preserved.
create or replace function public.list_factory_command_routing_candidates(
  p_organization_id uuid,
  p_project_id uuid,
  p_template_key text
)
returns table (
  project_pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  assignment_id uuid,
  bot_id uuid,
  bot_name text,
  role_id uuid,
  role_slug text,
  role_risk_ceiling public.risk_level,
  assignment_status public.bot_assignment_status,
  is_configured boolean,
  current_readiness public.bot_readiness,
  ai_account_status text,
  provider public.bot_provider,
  model text,
  assignment_model text,
  work_effort text,
  assignment_config jsonb,
  assigned_pipeline_keys text[],
  in_flight integer,
  max_concurrent_tasks integer,
  has_capacity boolean,
  assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_template_key text := pg_catalog.btrim(coalesce(p_template_key, ''));
  v_selection public.project_pipelines%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.status = 'active'::public.project_status;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'active project was not found for this organization';
  end if;

  select selection.* into v_selection
  from public.project_pipelines selection
  where selection.organization_id = p_organization_id
    and selection.project_id = p_project_id
    and selection.template_key = v_template_key;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'selected project pipeline was not found';
  end if;

  return query
  select
    v_selection.id,
    v_selection.template_key,
    v_selection.template_id,
    assignment.id,
    bot.id,
    bot.name,
    role_definition.id,
    role_definition.slug,
    role_definition.risk_ceiling,
    assignment.status,
    not (
      assignment.preset is null
      and assignment.responsibilities = '[]'::jsonb
      and pg_catalog.btrim(coalesce(assignment.instructions, '')) = ''
      and assignment.repository_access = 'read'
      and assignment.branch_strategy = 'per_task_branch'
      and assignment.can_open_pull_request = false
      and assignment.can_merge_pull_request = false
      and assignment.pipeline_access = 'none'
      and assignment.environment_access = 'none'
      and assignment.tools = '[]'::jsonb
      and assignment.requires_human_approval = true
      and assignment.max_concurrent_tasks = 1
      and assignment.priority = 2
      and assignment.model is null
      and assignment.work_effort = 'medium'
    ),
    case
      when bot.ai_account_id is not null
        and coalesce(account.status, '') <> 'connected'
        then 'not_connected'::public.bot_readiness
      else bot.readiness
    end,
    account.status,
    bot.provider,
    coalesce(assignment.model, bot.model),
    assignment.model,
    assignment.work_effort,
    pg_catalog.jsonb_build_object(
      'preset', assignment.preset,
      'responsibilities', assignment.responsibilities,
      'instructions', assignment.instructions,
      'repositoryAccess', assignment.repository_access,
      'branchStrategy', assignment.branch_strategy,
      'canOpenPullRequest', assignment.can_open_pull_request,
      'canMergePullRequest', assignment.can_merge_pull_request,
      'pipelineAccess', assignment.pipeline_access,
      'environmentAccess', assignment.environment_access,
      'tools', assignment.tools,
      'requiresHumanApproval', assignment.requires_human_approval,
      'maxConcurrentTasks', assignment.max_concurrent_tasks,
      'priority', assignment.priority
    ),
    array(
      select scope.template_key
      from public.project_pipelines scope
      where scope.organization_id = p_organization_id
        and scope.project_id = p_project_id
      order by scope.template_key
    ),
    (
      select pg_catalog.count(*)::integer
      from public.factory_command_routes route
      join public.commands command
        on command.id = route.command_id
       and command.organization_id = route.organization_id
      where route.organization_id = p_organization_id
        and route.assignment_id = assignment.id
        and command.status in (
          'submitted'::public.command_status,
          'awaiting_approval'::public.command_status,
          'queued'::public.command_status,
          'running'::public.command_status
        )
        and coalesce(command.parameters ->> 'executionMode', '') <> 'record_only'
    ),
    assignment.max_concurrent_tasks,
    (
      select pg_catalog.count(*)::integer < assignment.max_concurrent_tasks
      from public.factory_command_routes route
      join public.commands command
        on command.id = route.command_id
       and command.organization_id = route.organization_id
      where route.organization_id = p_organization_id
        and route.assignment_id = assignment.id
        and command.status in (
          'submitted'::public.command_status,
          'awaiting_approval'::public.command_status,
          'queued'::public.command_status,
          'running'::public.command_status
        )
        and coalesce(command.parameters ->> 'executionMode', '') <> 'record_only'
    ),
    assignment.assigned_at
  from public.bot_assignments assignment
  join public.bots bot
    on bot.id = assignment.bot_id
   and bot.organization_id = assignment.organization_id
  join public.bot_roles role_definition
    on role_definition.id = assignment.role_id
   and role_definition.organization_id = assignment.organization_id
  left join public.ai_accounts account
    on account.id = bot.ai_account_id
   and account.organization_id = bot.organization_id
  where assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
  order by assignment.priority asc, assignment.assigned_at asc, assignment.id asc;
end;
$function$;

create or replace function public.submit_factory_command_routing_internal(
  p_organization_id uuid,
  p_project_id uuid,
  p_project_pipeline_id uuid,
  p_assignment_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid,
  task_id uuid,
  command_state public.command_status,
  task_state public.task_status,
  requires_owner_approval boolean,
  was_created boolean,
  route_id uuid,
  project_pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  assignment_id uuid,
  bot_id uuid,
  role_id uuid,
  routing_snapshot jsonb
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_selection public.project_pipelines%rowtype;
  v_template public.graph_templates%rowtype;
  v_assignment public.bot_assignments%rowtype;
  v_bot public.bots%rowtype;
  v_role public.bot_roles%rowtype;
  v_account_status text;
  v_current_readiness public.bot_readiness;
  v_execution_mode text := coalesce(p_parameters ->> 'executionMode', '');
  v_resolved_model text;
  v_effective_risk public.risk_level;
  v_configuration jsonb;
  v_snapshot jsonb;
  v_submission record;
  v_existing_route public.factory_command_routes%rowtype;
  v_route public.factory_command_routes%rowtype;
  v_in_flight integer;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may submit a command';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.status = 'active'::public.project_status;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'active project was not found for this organization';
  end if;

  -- Hold the selected intent row until the route snapshot is durable. A later
  -- deselection remains allowed because factory_command_routes keeps ids and
  -- snapshots, not a deletion-cascading foreign key back to this row.
  select selection.* into v_selection
  from public.project_pipelines selection
  where selection.id = p_project_pipeline_id
    and selection.organization_id = p_organization_id
    and selection.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'selected project pipeline was not found';
  end if;

  -- Serializing on the posting makes count-then-insert a real capacity gate,
  -- not two concurrent callers both observing the same final free slot.
  select assignment.* into v_assignment
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
  for update;
  if not found or v_assignment.status <> 'active'::public.bot_assignment_status then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not active for this project';
  end if;

  select bot.* into v_bot
  from public.bots bot
  where bot.id = v_assignment.bot_id
    and bot.organization_id = p_organization_id
  for update;
  select role_definition.* into v_role
  from public.bot_roles role_definition
  where role_definition.id = v_assignment.role_id
    and role_definition.organization_id = p_organization_id
  for update;
  if v_bot.id is null or v_role.id is null then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not active for this project';
  end if;

  if v_assignment.preset is null
    and v_assignment.responsibilities = '[]'::jsonb
    and pg_catalog.btrim(coalesce(v_assignment.instructions, '')) = ''
    and v_assignment.repository_access = 'read'
    and v_assignment.branch_strategy = 'per_task_branch'
    and v_assignment.can_open_pull_request = false
    and v_assignment.can_merge_pull_request = false
    and v_assignment.pipeline_access = 'none'
    and v_assignment.environment_access = 'none'
    and v_assignment.tools = '[]'::jsonb
    and v_assignment.requires_human_approval = true
    and v_assignment.max_concurrent_tasks = 1
    and v_assignment.priority = 2
    and v_assignment.model is null
    and v_assignment.work_effort = 'medium' then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not configured';
  end if;
  if v_execution_mode <> 'record_only'
    and v_assignment.repository_access <> 'write' then
    raise exception using errcode = '55000',
      message = 'selected bot assignment cannot write the repository';
  end if;
  if v_execution_mode <> 'record_only'
    and not v_assignment.can_open_pull_request then
    raise exception using errcode = '55000',
      message = 'selected bot assignment cannot open pull requests';
  end if;
  if v_assignment.pipeline_access not in ('assigned', 'all') then
    raise exception using errcode = '55000',
      message = 'selected bot assignment cannot run this pipeline';
  end if;
  v_resolved_model := coalesce(v_assignment.model, v_bot.model);
  if pg_catalog.btrim(coalesce(p_parameters ->> 'provider', '')) <> v_bot.provider::text
    or pg_catalog.btrim(coalesce(p_parameters ->> 'model', '')) <> v_resolved_model then
    raise exception using errcode = '55000',
      message = 'selected bot does not match command execution provider and model';
  end if;

  if v_bot.ai_account_id is not null then
    select account.status into v_account_status
    from public.ai_accounts account
    where account.id = v_bot.ai_account_id
      and account.organization_id = p_organization_id
    for update;
  end if;
  v_current_readiness := case
    when v_bot.ai_account_id is not null
      and coalesce(v_account_status, '') <> 'connected'
      then 'not_connected'::public.bot_readiness
    else v_bot.readiness
  end;
  if v_current_readiness <> 'ready'::public.bot_readiness then
    raise exception using errcode = '55000', message = 'selected bot is not ready';
  end if;

  if v_selection.template_id is not null then
    select template.* into v_template
    from public.graph_templates template
    where template.id = v_selection.template_id
      and template.organization_id = p_organization_id
      and template.slug = v_selection.template_key
      and template.is_archived = false
    for update;
    if not found then
      raise exception using errcode = 'P0002',
        message = 'selected project pipeline was not found';
    end if;
  end if;

  select pg_catalog.count(*)::integer into v_in_flight
  from public.factory_command_routes route
  join public.commands command
    on command.id = route.command_id
   and command.organization_id = route.organization_id
  where route.organization_id = p_organization_id
    and route.assignment_id = v_assignment.id
    and command.status in (
      'submitted'::public.command_status,
      'awaiting_approval'::public.command_status,
      'queued'::public.command_status,
      'running'::public.command_status
    )
    and coalesce(command.parameters ->> 'executionMode', '') <> 'record_only';

  v_configuration := pg_catalog.jsonb_build_object(
    'preset', v_assignment.preset,
    'responsibilities', v_assignment.responsibilities,
    'instructions', v_assignment.instructions,
    'repositoryAccess', v_assignment.repository_access,
    'branchStrategy', v_assignment.branch_strategy,
    'canOpenPullRequest', v_assignment.can_open_pull_request,
    'canMergePullRequest', v_assignment.can_merge_pull_request,
    'pipelineAccess', v_assignment.pipeline_access,
    'environmentAccess', v_assignment.environment_access,
    'tools', v_assignment.tools,
    'requiresHumanApproval', v_assignment.requires_human_approval,
    'maxConcurrentTasks', v_assignment.max_concurrent_tasks,
    'priority', v_assignment.priority
  );
  -- Mutable selection, assignment, provider, and readiness validation happens
  -- before the existing authoritative submit. Because this is one transaction,
  -- a later effective-risk, route, or capacity refusal rolls every delegated
  -- command/task/run write back automatically.
  select * into v_submission
  from public.submit_command(
    p_project_id,
    p_prompt,
    p_requested_risk,
    p_parameters,
    p_idempotency_key
  );

  -- submit_command owns the policy that raises a caller's requested risk from
  -- the normalized command type, prompt, and acceptance criteria. Read back
  -- that persisted result rather than trusting the caller's lower bound. The
  -- row lock keeps the effective command evidence stable through route insert.
  select command.requested_risk into v_effective_risk
  from public.commands command
  where command.id = v_submission.command_id
    and command.organization_id = p_organization_id
    and command.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'submitted command risk evidence was not found';
  end if;

  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'command', pg_catalog.jsonb_build_object(
      'effectiveRisk', v_effective_risk::text
    ),
    'project', pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id
    ),
    'pipeline', pg_catalog.jsonb_build_object(
      'selectionId', v_selection.id,
      'templateKey', v_selection.template_key,
      'templateId', v_selection.template_id,
      'template', case when v_selection.template_id is null then null else
        pg_catalog.jsonb_build_object(
          'name', v_template.name,
          'version', v_template.version,
          'topology', v_template.topology::text,
          'definition', v_template.definition,
          'defaultBudget', v_template.default_budget
        ) end
    ),
    'assignment', pg_catalog.jsonb_build_object(
      'assignmentId', v_assignment.id,
      'status', v_assignment.status::text,
      'botId', v_bot.id,
      'botName', v_bot.name,
      'provider', v_bot.provider::text,
      'model', v_resolved_model,
      'modelOverride', v_assignment.model,
      'workEffort', v_assignment.work_effort,
      'currentReadiness', v_current_readiness::text,
      'aiAccountStatus', v_account_status,
      'roleId', v_role.id,
      'roleSlug', v_role.slug,
      'roleRiskCeiling', v_role.risk_ceiling::text,
      'config', v_configuration
    )
  );

  select route.* into v_existing_route
  from public.factory_command_routes route
  where route.command_id = v_submission.command_id;
  if found then
    -- Both the persisted effective risk and the role ceiling are part of the
    -- immutable snapshot. Exact replay therefore proves the same risk gate
    -- that was enforced when the route was first inserted, while any later
    -- role or command drift remains an idempotency conflict rather than a
    -- rewrite of historical evidence.
    if v_existing_route.organization_id <> p_organization_id
      or v_existing_route.project_id <> p_project_id
      or v_existing_route.project_pipeline_id <> v_selection.id
      or v_existing_route.pipeline_template_key <> v_selection.template_key
      or v_existing_route.pipeline_template_id is distinct from v_selection.template_id
      or v_existing_route.assignment_id <> v_assignment.id
      or v_existing_route.bot_id <> v_bot.id
      or v_existing_route.role_id <> v_role.id
      or v_existing_route.routing_snapshot <> v_snapshot then
      raise exception using errcode = '22023',
        message = 'idempotent factory command routing evidence conflicts';
    end if;
    v_route := v_existing_route;
  else
    -- A command created before this routing boundary has no trustworthy
    -- historical assignment snapshot. Attaching today's roster state to it
    -- would manufacture evidence, so an idempotent replay may verify but may
    -- never backfill a missing route.
    if not v_submission.was_created::boolean then
      raise exception using errcode = '22023',
        message = 'idempotent command predates factory routing evidence';
    end if;
    if v_role.risk_ceiling < v_effective_risk then
      raise exception using errcode = '55000',
        message = 'selected bot role risk ceiling is too low';
    end if;
    if v_execution_mode <> 'record_only'
      and v_in_flight >= v_assignment.max_concurrent_tasks then
      raise exception using errcode = '55000',
        message = 'selected bot assignment is at its concurrency limit';
    end if;

    insert into public.factory_command_routes (
      organization_id, project_id, command_id,
      project_pipeline_id, pipeline_template_key, pipeline_template_id,
      assignment_id, bot_id, role_id, routing_snapshot, created_by
    ) values (
      p_organization_id, p_project_id, v_submission.command_id,
      v_selection.id, v_selection.template_key, v_selection.template_id,
      v_assignment.id, v_bot.id, v_role.id, v_snapshot, v_caller
    )
    returning * into v_route;

    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    ) values (
      p_organization_id,
      p_project_id,
      v_caller,
      'command.routed'::public.activity_event_type,
      'factory_command_route',
      v_route.id,
      'Command routed through a selected project pipeline to an active bot posting. Execution was not started.',
      pg_catalog.jsonb_build_object(
        'command_id', v_submission.command_id,
        'project_pipeline_id', v_selection.id,
        'pipeline_template_key', v_selection.template_key,
        'assignment_id', v_assignment.id,
        'bot_id', v_bot.id,
        'role_id', v_role.id,
        'worker_started', false,
        'autonomy_changed', false
      )
    );
  end if;

  return query select
    v_submission.command_id::uuid,
    v_submission.task_id::uuid,
    v_submission.command_state::public.command_status,
    v_submission.task_state::public.task_status,
    v_submission.requires_owner_approval::boolean,
    v_submission.was_created::boolean,
    v_route.id,
    v_route.project_pipeline_id,
    v_route.pipeline_template_key,
    v_route.pipeline_template_id,
    v_route.assignment_id,
    v_route.bot_id,
    v_route.role_id,
    v_route.routing_snapshot;
end;
$function$;

comment on function public.list_factory_command_routing_candidates(uuid, uuid, text) is
  'Member-scoped candidates. Durable record-only history is excluded from executable in-flight capacity; all executable command states retain the original capacity accounting.';
comment on function public.submit_factory_command_routing_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) is
  'Private immutable-routing transaction with serialized executable-capacity accounting. Canonical record-only history never consumes worker capacity.';


-- Phase 2A's completed-attempt recorder is a separate authenticated run
-- producer. A record-only factory task may retain a blocked routing decision,
-- but it may never be delegated as ROUTED to the private INSERT implementation.
-- Preserve the complete Phase 1C compatibility policy wrapper at its current
-- OID and put the record-only task gate in front of it. This keeps every prior
-- risk, spend, model, and execution-enabled check in the delegation chain.
alter function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) rename to record_provider_run_phase1c_compatibility_internal;

revoke all on function public.record_provider_run_phase1c_compatibility_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) from public, anon, authenticated, service_role;

comment on function public.record_provider_run_phase1c_compatibility_internal(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) is
  'Private immutable Phase 1C provider-run policy wrapper behind the record-only task boundary.';

create or replace function public.record_provider_run(
  p_organization_id uuid,
  p_project_id uuid,
  p_task_id uuid,
  p_agent_id uuid,
  p_task_kind text,
  p_risk_level public.risk_level,
  p_requested_provider text,
  p_policy_version text,
  p_decision text,
  p_source text,
  p_selected_provider text,
  p_selected_model text,
  p_reasons jsonb,
  p_candidates jsonb,
  p_fallback_from_provider text,
  p_run_status public.run_status,
  p_provider_run_reference text,
  p_input jsonb,
  p_output jsonb,
  p_usage jsonb,
  p_latency_ms integer,
  p_error_message text,
  p_events jsonb
)
returns table (routing_decision_id uuid, agent_run_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  persisted_task_risk public.risk_level;
  project_risk_ceiling public.risk_level;
  execution_enabled boolean;
  task_execution_mode text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  select task.risk_level, project.maximum_autonomous_risk,
    organization.ai_provider_execution_enabled,
    command.parameters ->> 'executionMode'
  into persisted_task_risk, project_risk_ceiling, execution_enabled,
    task_execution_mode
  from public.tasks task
  join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  join public.organizations organization on organization.id = task.organization_id
  left join public.commands command
    on command.id = task.command_id
   and command.organization_id = task.organization_id
   and command.project_id = task.project_id
  where task.id = p_task_id
    and task.organization_id = p_organization_id
    and task.project_id = p_project_id;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'task not found for this project';
  end if;
  if p_decision = 'ROUTED' and task_execution_mode = 'record_only' then
    raise exception using errcode = '55000',
      message = 'record-only tasks cannot create provider runs';
  end if;
  if persisted_task_risk is distinct from p_risk_level then
    raise exception using errcode = '22023',
      message = 'provider run risk must match the persisted task';
  end if;
  if p_decision = 'ROUTED' and not execution_enabled then
    raise exception using errcode = '55000',
      message = 'outbound provider execution is disabled';
  end if;
  if p_decision = 'ROUTED' and p_risk_level = 'red'::public.risk_level then
    raise exception using errcode = '42501',
      message = 'RED provider execution requires a separately approved phase';
  end if;
  if p_decision = 'ROUTED' and p_risk_level > project_risk_ceiling then
    raise exception using errcode = '42501',
      message = 'provider run risk exceeds the project ceiling';
  end if;
  if p_decision = 'ROUTED' and p_run_status not in (
    'succeeded'::public.run_status,
    'failed'::public.run_status,
    'cancelled'::public.run_status
  ) then
    raise exception using errcode = '22023',
      message = 'a completed provider attempt requires a terminal run status';
  end if;
  if p_decision = 'ROUTED' and not exists (
    select 1 from public.provider_model_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.provider = nullif(p_selected_provider, '')::public.connection_provider
      and configuration.model = nullif(p_selected_model, '')
      and configuration.enabled
  ) then
    raise exception using errcode = '23514',
      message = 'the routed model is not enabled for this organization and provider';
  end if;

  return query
    select recorded.routing_decision_id, recorded.agent_run_id
    from public.record_provider_run_phase1c_compatibility_internal(
      p_organization_id, p_project_id, p_task_id, p_agent_id, p_task_kind,
      p_risk_level, p_requested_provider, p_policy_version, p_decision,
      p_source, p_selected_provider, p_selected_model, p_reasons, p_candidates,
      p_fallback_from_provider, p_run_status, p_provider_run_reference, p_input,
      p_output, coalesce(p_usage, '{}'::jsonb), p_latency_ms, p_error_message,
      p_events
    ) recorded;
end;
$function$;

revoke all on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) to authenticated;

comment on function public.record_provider_run(
  uuid, uuid, uuid, uuid, text, public.risk_level, text, text, text, text, text, text,
  jsonb, jsonb, text, public.run_status, text, jsonb, jsonb, jsonb, integer, text, jsonb
) is
  'Records Phase 2A routing evidence and completed attempts while refusing every ROUTED record-only factory task before the private agent_run producer.';

-- The browser needs this one non-sensitive disposition to describe a durable
-- record-only command truthfully. Raw parameters and idempotency data remain
-- private; every other field matches the established safe command list.
create function public.list_factory_commands(
  p_organization_id uuid,
  p_limit integer default 50,
  p_project_id uuid default null
)
returns table (
  id uuid,
  prompt text,
  requested_risk public.risk_level,
  status public.command_status,
  submitted_at timestamptz,
  completed_at timestamptz,
  project_id uuid,
  project_name text,
  execution_mode text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    return;
  end if;

  return query
    select command.id, command.prompt, command.requested_risk, command.status,
      command.submitted_at, command.completed_at, project.id, project.name,
      case
        when command.parameters ->> 'executionMode' = 'record_only'
          then 'record_only'::text
        when command.parameters ->> 'executionMode' = 'manual'
          and command.parameters ->> 'provider' = 'openai'
          and command.parameters ->> 'model' = 'gpt-5.3-codex'
          then 'manual'::text
        else 'unknown'::text
      end
    from public.commands command
    left join public.projects project
      on project.id = command.project_id
     and project.organization_id = command.organization_id
    where command.organization_id = p_organization_id
      and (p_project_id is null or command.project_id = p_project_id)
    order by command.submitted_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.list_factory_commands(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_factory_commands(uuid, integer, uuid)
  to authenticated;

comment on function public.list_factory_commands(uuid, integer, uuid) is
  'Caller-bound tenant command list, optionally project-scoped before its row limit, with canonical manual, record_only, or unknown disposition and no raw parameters or idempotency data.';

-- Prove the entire replacement landed as one exact catalog transition. The
-- three prior public entrypoint OIDs must now be the three private delegates;
-- trigger functions and the Phase 2A sink retain their live OIDs; each new
-- public wrapper has a distinct OID and only the authenticated execute grant.
create temporary table _sf_20260822001000_output_expectations (
  purpose text primary key,
  signature text unique not null,
  source_md5 text not null check (pg_catalog.length(source_md5) = 32),
  contract_md5 text not null check (pg_catalog.length(contract_md5) = 32),
  volatility text not null check (volatility in ('s', 'v')),
  execute_role text not null check (execute_role in ('none', 'authenticated')),
  input_purpose text
) on commit drop;

insert into _sf_20260822001000_output_expectations (
  purpose, signature, source_md5, contract_md5, volatility, execute_role,
  input_purpose
) values
  ('list_candidates',
   'public.list_factory_command_routing_candidates(uuid,uuid,text)',
   '203f54d969fbc699304e780c1ad68a85',
   '17919dac57b41b75fe0793ad660063cc', 's', 'authenticated',
   'list_candidates'),
  ('normalize_command', 'public.normalize_phase1c_command()',
   'cd28d70a40e860660461700926e97830',
   '32b955c1d25380d6e075024ee98f8530', 'v', 'none',
   'normalize_command'),
  ('plan_task', 'public.plan_phase1c_task_and_run()',
   '2de7070bb9359ce7ad45516da2956a4b',
   '32b955c1d25380d6e075024ee98f8530', 'v', 'none', 'plan_task'),
  ('queue_run', 'public.queue_phase1c_run_for_task()',
   '4737eba3e8490632fdd89c6d06fece82',
   '32b955c1d25380d6e075024ee98f8530', 'v', 'none', 'queue_run'),
  ('submit_command_internal',
   'public.submit_command_phase1c_normalized_internal(uuid,text,public.risk_level,jsonb,text)',
   'adb50eb74e1721274f23d0d69b79e2e8',
   'b725d8bc77d8d0b2f34a69c900c16d1f', 'v', 'none',
   'submit_command'),
  ('submit_command_public',
   'public.submit_command(uuid,text,public.risk_level,jsonb,text)',
   '024c3aa1f74d976fb7a8a6d7138cd9fb',
   'b725d8bc77d8d0b2f34a69c900c16d1f', 'v', 'authenticated', null),
  ('submit_factory_internal',
   'public.submit_factory_command_routing_internal(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
   '8418fd26e9b1783315a93ffbf4543838',
   'b779f9c2f2c4d0cf086f6d67b85a457c', 'v', 'none',
   'submit_factory'),
  ('submit_factory_public',
   'public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
   '6008476137a77db33d220be4b14a9c8d',
   'b779f9c2f2c4d0cf086f6d67b85a457c', 'v', 'authenticated', null),
  ('record_provider_compatibility',
   'public.record_provider_run_phase1c_compatibility_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   'c450eac6987cdd603d2d2511a9fa8833',
   'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'none',
   'record_provider'),
  ('record_provider_public',
   'public.record_provider_run(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   '9dfdfc57f4f8b0965a89fefd927beb26',
   'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'authenticated', null),
  ('record_provider_phase2a',
   'public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)',
   '46cee8bec5e12fd4f087ecbeea0c9844',
   'cf7f54b49fe3d5eb87b32fe782e7641c', 'v', 'none',
   'record_provider_phase2a');

do $postflight$
declare
  v_bad text;
  v_owner oid;
begin
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  select relation.relowner into v_owner
  from pg_catalog.pg_class relation
  where relation.oid = 'public.projects'::pg_catalog.regclass;

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from _sf_20260822001000_output_expectations expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  left join pg_catalog.pg_language language
    on language.oid = procedure.prolang
  left join _sf_20260822001000_function_guard input_guard
    on input_guard.purpose = expected.input_purpose
  where procedure.oid is null
     or namespace.nspname is distinct from 'public'
     or language.lanname is distinct from 'plpgsql'
     or procedure.proowner is distinct from v_owner
     or procedure.prokind is distinct from 'f'::"char"
     or procedure.provolatile is distinct from expected.volatility::"char"
     or procedure.prosecdef is distinct from true
     or procedure.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or procedure.proisstrict
     or procedure.proleakproof
     or procedure.proparallel is distinct from 'u'::"char"
     or procedure.provariadic <> 0
     or procedure.prosupport <> 0
     or procedure.probin is not null
     or procedure.prosqlbody is not null
     or pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          procedure.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
          is distinct from expected.source_md5
     or pg_catalog.md5(pg_catalog.jsonb_build_array(
          namespace.nspname,
          language.lanname,
          pg_catalog.pg_get_userbyid(procedure.proowner),
          procedure.prokind::text,
          pg_catalog.format_type(procedure.prorettype, null),
          procedure.proretset,
          procedure.pronargs,
          procedure.pronargdefaults,
          coalesce(pg_catalog.array_to_string(procedure.proargnames, ','), ''),
          coalesce(pg_catalog.array_to_string(procedure.proargmodes, ','), ''),
          coalesce((
            select pg_catalog.string_agg(
              pg_catalog.format_type(argument_type.type_oid, null),
              ',' order by argument_type.ordinality
            )
            from pg_catalog.unnest(procedure.proallargtypes)
              with ordinality argument_type(type_oid, ordinality)
          ), ''),
          coalesce(pg_catalog.pg_get_expr(procedure.proargdefaults, 0), ''),
          procedure.proisstrict,
          procedure.proleakproof,
          procedure.prosecdef,
          procedure.proparallel::text,
          procedure.provariadic = 0,
          procedure.procost::text,
          procedure.prorows::text,
          procedure.prosupport = 0,
          procedure.probin is null,
          procedure.prosqlbody is null,
          procedure.protrftypes is null,
          procedure.proconfig,
          procedure.proacl is null
        )::text) is distinct from expected.contract_md5
     or procedure.proacl is null
     or (select pg_catalog.count(*)
         from pg_catalog.aclexplode(procedure.proacl))
          <> case when expected.execute_role = 'none' then 1 else 2 end
     or not exists (
       select 1 from pg_catalog.aclexplode(procedure.proacl) acl
       where acl.grantor = procedure.proowner
         and acl.grantee = procedure.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or (
       expected.execute_role = 'authenticated'
       and not exists (
         select 1 from pg_catalog.aclexplode(procedure.proacl) acl
         where acl.grantor = procedure.proowner
           and acl.grantee = pg_catalog.to_regrole('authenticated')::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     )
     or exists (
       select 1 from pg_catalog.aclexplode(procedure.proacl) acl
       where acl.grantor <> procedure.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            procedure.proowner,
            case when expected.execute_role = 'authenticated'
              then pg_catalog.to_regrole('authenticated')::oid
              else procedure.proowner end
          )
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
          'authenticated', expected.signature, 'EXECUTE'
        ) is distinct from (expected.execute_role = 'authenticated')
     or exists (
       select 1 from pg_catalog.aclexplode(procedure.proacl) acl
       where acl.grantee = 0
     )
     or (
       expected.input_purpose is not null
       and procedure.oid is distinct from input_guard.routine_oid
     )
     or (
       expected.input_purpose is null
       and exists (
         select 1 from _sf_20260822001000_function_guard guard
         where guard.routine_oid = procedure.oid
       )
     )
     or (
       expected.input_purpose is not null
       and pg_catalog.to_jsonb(procedure) - 'proname' - 'prosrc' - 'proacl'
           is distinct from input_guard.catalog_without_name_source_acl
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '01000 output function catalog, source, OID, or ACL mismatch',
      detail = v_bad;
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      join pg_catalog.pg_language language
        on language.oid = procedure.prolang
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.list_factory_commands(uuid,integer,uuid)'
      )
        and namespace.nspname = 'public'
        and language.lanname = 'plpgsql'
        and procedure.proowner = v_owner
        and procedure.prokind = 'f'::"char"
        and procedure.provolatile = 's'::"char"
        and procedure.prosecdef
        and procedure.proconfig = array['search_path=pg_catalog']::text[]
        and not procedure.proisstrict
        and not procedure.proleakproof
        and procedure.proparallel = 'u'::"char"
        and procedure.provariadic = 0
        and procedure.prosupport = 0
        and procedure.probin is null
        and procedure.prosqlbody is null
        and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          procedure.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
          = 'ba62f4f5357cec647d3ff582107710a7'
        and procedure.proacl is not null
        and (select pg_catalog.count(*)
             from pg_catalog.aclexplode(procedure.proacl)) = 2
        and pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
        and not exists (
          select 1 from pg_catalog.aclexplode(procedure.proacl) acl
          where acl.grantor <> procedure.proowner
             or acl.privilege_type <> 'EXECUTE'
             or acl.is_grantable
             or acl.grantee not in (
               procedure.proowner,
               pg_catalog.to_regrole('authenticated')::oid
             )
        )) <> 1
    or (select pg_catalog.count(*)
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace
          on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname = 'list_factory_commands') <> 1 then
    raise exception using errcode = '55000',
      message = '01000 safe command disposition list catalog, source, or ACL mismatch';
  end if;

  select pg_catalog.string_agg(
    procedure.oid::pg_catalog.regprocedure::text,
    ', ' order by procedure.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'list_factory_command_routing_candidates', 'normalize_phase1c_command',
      'plan_phase1c_task_and_run', 'queue_phase1c_run_for_task',
      'submit_command', 'submit_command_phase1c_normalized_internal',
      'submit_factory_command', 'submit_factory_command_routing_internal',
      'record_provider_run',
      'record_provider_run_phase1c_compatibility_internal',
      'record_provider_run_phase2a_internal'
    )
    and not exists (
      select 1 from _sf_20260822001000_output_expectations expected
      where pg_catalog.to_regprocedure(expected.signature) = procedure.oid
    );
  if v_bad is not null
    or (select pg_catalog.count(*)
        from _sf_20260822001000_output_expectations) <> 11 then
    raise exception using errcode = '55000',
      message = '01000 found an unexpected output function overload',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(guard.trigger_name, ', ' order by guard.trigger_name)
  into v_bad
  from _sf_20260822001000_trigger_guard guard
  left join pg_catalog.pg_trigger trigger on trigger.oid = guard.trigger_oid
  where trigger.oid is null
     or pg_catalog.to_jsonb(trigger) is distinct from guard.trigger_catalog;
  if v_bad is not null
    or (select pg_catalog.count(*)
        from _sf_20260822001000_trigger_guard) <> 20
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger
        where trigger.tgrelid in (
          'public.commands'::pg_catalog.regclass,
          'public.tasks'::pg_catalog.regclass,
          'public.agent_runs'::pg_catalog.regclass
        ) and not trigger.tgisinternal) <> 20
    or exists (
      select 1 from pg_catalog.pg_rewrite rewrite
      where rewrite.ev_class in (
        'public.commands'::pg_catalog.regclass,
        'public.tasks'::pg_catalog.regclass,
        'public.agent_runs'::pg_catalog.regclass
      ) and rewrite.rulename <> '_RETURN'
    ) then
    raise exception using errcode = '55000',
      message = '01000 changed a protected trigger or rule binding',
      detail = v_bad;
  end if;

  if not exists (
    select 1
    from _sf_20260822001000_agent_runs_guard guard
    join pg_catalog.pg_class relation
      on relation.oid = 'public.agent_runs'::pg_catalog.regclass
    where pg_catalog.to_jsonb(relation) = guard.relation_catalog
      and (select pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(attribute) order by attribute.attnum
           ) from pg_catalog.pg_attribute attribute
           where attribute.attrelid = relation.oid) = guard.column_catalog
      and (select pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(policy) order by policy.polname
           ) from pg_catalog.pg_policy policy
           where policy.polrelid = relation.oid) = guard.policy_catalog
  ) then
    raise exception using errcode = '55000',
      message = '01000 changed the agent_runs catalog, RLS, ACL, or policy';
  end if;

  select pg_catalog.string_agg(
    procedure.oid::pg_catalog.regprocedure::text,
    ', ' order by procedure.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and pg_catalog.strpos(pg_catalog.lower(procedure.prosrc),
      'insert into public.agent_runs') > 0
    and procedure.oid not in (
      (select guard.routine_oid from _sf_20260822001000_function_guard guard
       where guard.purpose = 'queue_run'),
      (select guard.routine_oid from _sf_20260822001000_function_guard guard
       where guard.purpose = 'record_provider_phase2a')
    );
  if v_bad is not null
    or (select pg_catalog.count(*)
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace
          on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and pg_catalog.strpos(pg_catalog.lower(procedure.prosrc),
            'insert into public.agent_runs') > 0) <> 2 then
    raise exception using errcode = '55000',
      message = '01000 agent_run producer identity changed', detail = v_bad;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid =
        'public.factory_record_only_submission_guards'::pg_catalog.regclass
      and relation.relkind = 'r'::"char"
      and relation.relowner = v_owner
      and relation.relrowsecurity
      and relation.relforcerowsecurity
      and not relation.relispartition
      and relation.relacl is not null
      and (select pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(acl)
             order by acl.grantor, acl.grantee, acl.privilege_type
           ) from pg_catalog.aclexplode(relation.relacl) acl)
          = (select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(acl)
               order by acl.grantor, acl.grantee, acl.privilege_type
             ) from pg_catalog.aclexplode(
               pg_catalog.acldefault('r', relation.relowner)
             ) acl)
  )
    or pg_catalog.has_table_privilege(
      'anon', 'public.factory_record_only_submission_guards',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.factory_record_only_submission_guards',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or pg_catalog.has_table_privilege(
      'service_role', 'public.factory_record_only_submission_guards',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or (select pg_catalog.count(*) from pg_catalog.pg_attribute attribute
        where attribute.attrelid =
          'public.factory_record_only_submission_guards'::pg_catalog.regclass
          and attribute.attnum > 0 and not attribute.attisdropped) <> 7
    or exists (
      select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid =
          'public.factory_record_only_submission_guards'::pg_catalog.regclass
        and attribute.attnum > 0 and not attribute.attisdropped
        and attribute.attacl is not null
    )
    or exists (
      select 1 from (values
        (1, 'token', 'uuid', true, null::text),
        (2, 'caller_id', 'uuid', true, null::text),
        (3, 'organization_id', 'uuid', true, null::text),
        (4, 'project_id', 'uuid', true, null::text),
        (5, 'assignment_id', 'uuid', true, null::text),
        (6, 'authorized_parameters', 'jsonb', true, null::text),
        (7, 'created_at', 'timestamp with time zone', true, 'now()')
      ) expected(attnum, attname, type_name, not_null, default_expression)
      left join pg_catalog.pg_attribute attribute
        on attribute.attrelid =
          'public.factory_record_only_submission_guards'::pg_catalog.regclass
       and attribute.attnum = expected.attnum
      left join pg_catalog.pg_attrdef attribute_default
        on attribute_default.adrelid = attribute.attrelid
       and attribute_default.adnum = attribute.attnum
      where attribute.attname is distinct from expected.attname
         or pg_catalog.format_type(
              attribute.atttypid, attribute.atttypmod
            ) is distinct from expected.type_name
         or attribute.attnotnull is distinct from expected.not_null
         or pg_catalog.pg_get_expr(
              attribute_default.adbin, attribute_default.adrelid
            ) is distinct from expected.default_expression
    )
    or (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_record
        where constraint_record.conrelid =
          'public.factory_record_only_submission_guards'::pg_catalog.regclass
          and constraint_record.contype in ('p'::"char", 'c'::"char")) <> 4
    or exists (
      select 1 from (values
        ('factory_record_only_submission_guards_pkey', 'p'),
        ('factory_record_only_guard_parameters_object', 'c'),
        ('factory_record_only_guard_parameters_bounded', 'c'),
        ('factory_record_only_guard_parameters_safe', 'c')
      ) expected(constraint_name, constraint_type)
      left join pg_catalog.pg_constraint constraint_record
        on constraint_record.conrelid =
          'public.factory_record_only_submission_guards'::pg_catalog.regclass
       and constraint_record.conname = expected.constraint_name
      where constraint_record.oid is null
         or constraint_record.contype <> expected.constraint_type::"char"
         or not constraint_record.convalidated
    )
    or exists (
      select 1 from pg_catalog.pg_policy policy
      where policy.polrelid =
        'public.factory_record_only_submission_guards'::pg_catalog.regclass
    )
    or exists (
      select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid =
        'public.factory_record_only_submission_guards'::pg_catalog.regclass
        and not trigger.tgisinternal
    )
    or exists (
      select 1 from pg_catalog.pg_rewrite rewrite
      where rewrite.ev_class =
        'public.factory_record_only_submission_guards'::pg_catalog.regclass
        and rewrite.rulename <> '_RETURN'
    ) then
    raise exception using errcode = '55000',
      message = '01000 record-only guard table postflight mismatch';
  end if;

  if (select pg_catalog.count(*) from _sf_20260822001000_input_expectations) <> 8
    or (select pg_catalog.count(*) from _sf_20260822001000_function_guard) <> 8
    or (select pg_catalog.count(*) from _sf_20260822001000_trigger_expectations) <> 20
    or (select pg_catalog.count(*) from _sf_20260822001000_trigger_guard) <> 20
    or (select pg_catalog.count(*) from _sf_20260822001000_agent_runs_guard) <> 1
    or (select pg_catalog.count(*) from _sf_20260822001000_output_expectations) <> 11 then
    raise exception using errcode = '55000',
      message = '01000 did not consume the complete preflight evidence set';
  end if;
end;
$postflight$;
