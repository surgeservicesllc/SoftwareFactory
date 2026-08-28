-- Forward-only containment for a partially applied Phase 2E selector.
--
-- Production has the exact 20260815000300 portfolio-aware selector while the
-- three breaker helpers from 20260815000500 are already present byte-for-byte.
-- Do not repair the old migration ledger or replay either historical file.
-- Normalize only this private selector after proving every dependency and ACL.

do $preflight$
declare
  selector_oid oid := pg_catalog.to_regprocedure(
    'public.claim_phase1c_run_budget_internal(text,text,text,integer)'
  );
  selector_hash text;
  helper record;
  breaker_relation oid := pg_catalog.to_regclass('public.resource_breakers');
begin
  if selector_oid is null then
    raise exception using errcode = '55000',
      message = 'breaker-aware selector normalization found no selector';
  end if;

  select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
    routine.prosrc, E'\r\n', E'\n'
  ), E'\r', E'\n'))
    into selector_hash
  from pg_catalog.pg_proc routine
  where routine.oid = selector_oid;

  if selector_hash not in (
    'ed5840b9d8d0efdb513a8576df128e9b',
    '5933952d71f9da90a2a80a05ce6e0378'
  ) then
    raise exception using errcode = '55000',
      message = 'breaker-aware selector normalization source identity mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_language language on language.oid = routine.prolang
    where routine.oid = selector_oid
      and language.lanname = 'plpgsql'
      and routine.prokind = 'f'
      and routine.provolatile = 'v'
      and routine.proparallel = 'u'
      and not routine.proisstrict
      and not routine.proleakproof
      and routine.proretset
      and routine.pronargdefaults = 1
      and routine.prorettype = 'record'::pg_catalog.regtype
      and pg_catalog.md5(pg_catalog.pg_get_function_identity_arguments(routine.oid))
        = '0e52321dcc4ae192741cff672f3b9abb'
      and pg_catalog.md5(pg_catalog.pg_get_function_arguments(routine.oid))
        = 'b511c642748a410371daffa5975dfc95'
      and pg_catalog.md5(pg_catalog.pg_get_function_result(routine.oid))
        = '6dd487ee94c50b0250bdca6bfdacac71'
      and routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
      and routine.proacl is not null
      and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) = 1
      and not exists (
        select 1 from pg_catalog.aclexplode(routine.proacl) acl
        where acl.grantor <> routine.proowner
          or acl.grantee <> routine.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
      )
      and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
  ) then
    raise exception using errcode = '55000',
      message = 'breaker-aware selector normalization metadata or ACL mismatch';
  end if;

  for helper in
    select * from (values
      ('public.breaker_cooldown_seconds(text)',
       '9b46c6e078158e2f2ac1be0126e47e65', 'i', 'integer'),
      ('public.breaker_suppression_reason(uuid,text,text,timestamptz)',
       'ce7c51ad47992174634c960b8a8faaaf', 's', 'text'),
      ('public.consume_breaker_trial(uuid,text,text)',
       '41323ace6fed5d3e5ebc512464bd358d', 'v', 'void')
    ) expected(signature, source_md5, volatility, return_type)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_language language on language.oid = routine.prolang
      where routine.oid = pg_catalog.to_regprocedure(helper.signature)
        and language.lanname = 'sql'
        and routine.prokind = 'f'
        and routine.provolatile = helper.volatility::"char"
        and routine.proparallel = 'u'
        and not routine.proisstrict
        and not routine.proleakproof
        and not routine.proretset
        and routine.pronargdefaults = 0
        and routine.prorettype = pg_catalog.to_regtype(helper.return_type)
        and not routine.prosecdef
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
        and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          routine.prosrc, E'\r\n', E'\n'
        ), E'\r', E'\n')) = helper.source_md5
        and routine.proacl is not null
        and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) = 1
        and not exists (
          select 1 from pg_catalog.aclexplode(routine.proacl) acl
          where acl.grantor <> routine.proowner
            or acl.grantee <> routine.proowner
            or acl.privilege_type <> 'EXECUTE'
            or acl.is_grantable
        )
        and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
    ) then
      raise exception using errcode = '55000',
        message = pg_catalog.format(
          'breaker-aware selector helper identity mismatch: %s', helper.signature
        );
    end if;
  end loop;

  if breaker_relation is null
    or not exists (
      select 1 from pg_catalog.pg_class relation
      where relation.oid = breaker_relation
        and relation.relkind = 'r'
        and relation.relrowsecurity
        and relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
    )
    or exists (
      with expected(
        column_name, column_type, is_not_null, default_md5
      ) as (values
        ('id', 'uuid', true, 'f3b72bb359a50b640590970a2ab8e514'),
        ('organization_id', 'uuid', true, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('target', 'text', true, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('state', 'text', true, '032cd0831e00bde5d89d95eeb9528422'),
        ('fault', 'text', false, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('consecutive_faults', 'integer', true,
          'cfcd208495d565ef66e7dff9f98764da'),
        ('opened_at', 'timestamp with time zone', false,
          'd41d8cd98f00b204e9800998ecf8427e'),
        ('reason', 'text', false, 'd41d8cd98f00b204e9800998ecf8427e'),
        ('updated_at', 'timestamp with time zone', true,
          '75230039beb12ce952f24927f2bfa2f2')
      )
      select 1
      from expected
      left join pg_catalog.pg_attribute attribute
        on attribute.attrelid = breaker_relation
       and attribute.attname = expected.column_name
       and attribute.attnum > 0
       and not attribute.attisdropped
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attnum is null
        or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> expected.column_type
        or attribute.attnotnull is distinct from expected.is_not_null
        or attribute.attidentity <> ''
        or attribute.attgenerated <> ''
        or pg_catalog.md5(coalesce(
          pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid), ''
        )) <> expected.default_md5
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = breaker_relation
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) <> 9
    or exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = breaker_relation
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attacl is not null
    )
    or not exists (
      select 1 from pg_catalog.pg_class relation
      where relation.oid = breaker_relation and relation.relacl is not null
    )
    or exists (
      with relation_row as (
        select relation.relowner, relation.relacl
        from pg_catalog.pg_class relation
        where relation.oid = breaker_relation
      ), actual as (
        select acl.*
        from relation_row
        cross join lateral pg_catalog.aclexplode(relation_row.relacl) acl
      ), owner_expected as (
        select acl.privilege_type
        from relation_row
        cross join lateral pg_catalog.aclexplode(
          pg_catalog.acldefault('r', relation_row.relowner)
        ) acl
      ), authenticated_expected(privilege_type) as (values ('SELECT'))
      select 1
      from relation_row
      where exists (
        select 1 from actual
        where actual.grantor <> relation_row.relowner
          or actual.is_grantable
          or actual.grantee not in (
            relation_row.relowner,
            pg_catalog.to_regrole('authenticated')::oid,
            pg_catalog.to_regrole('service_role')::oid
          )
      )
      or exists (
        (select actual.privilege_type from actual
          where actual.grantee = relation_row.relowner)
        except select owner_expected.privilege_type from owner_expected
      )
      or exists (
        (select owner_expected.privilege_type from owner_expected)
        except select actual.privilege_type from actual
          where actual.grantee = relation_row.relowner
      )
      or exists (
        (select actual.privilege_type from actual
          where actual.grantee = pg_catalog.to_regrole('authenticated')::oid)
        except select authenticated_expected.privilege_type
          from authenticated_expected
      )
      or exists (
        (select authenticated_expected.privilege_type
          from authenticated_expected)
        except select actual.privilege_type from actual
          where actual.grantee = pg_catalog.to_regrole('authenticated')::oid
      )
      or (
        exists (select 1 from actual
          where actual.grantee = pg_catalog.to_regrole('service_role')::oid)
        and (
          exists (
            (select actual.privilege_type from actual
              where actual.grantee = pg_catalog.to_regrole('service_role')::oid)
            except select owner_expected.privilege_type from owner_expected
          )
          or exists (
            (select owner_expected.privilege_type from owner_expected)
            except select actual.privilege_type from actual
              where actual.grantee = pg_catalog.to_regrole('service_role')::oid
          )
        )
      )
    )
    or exists (
      with expected(
        constraint_name, constraint_type, definition_md5
      ) as (values
        ('resource_breakers_closed_is_clean', 'c',
          '04012ad5d4aa2f1b2ad25b2451e653f0'),
        ('resource_breakers_consecutive_faults_check', 'c',
          'c2fffa885f6f01170d2209708856b0e5'),
        ('resource_breakers_fault_check', 'c',
          '7ef8577e9c0f9f106b3bd472842c6b7d'),
        ('resource_breakers_open_is_explained', 'c',
          '05304b586d0396bce917f1936a987cc3'),
        ('resource_breakers_organization_id_fkey', 'f',
          '3c702b28ccc97a0ac52c0acefcdea477'),
        ('resource_breakers_pkey', 'p',
          '4c6419b3704337bbfe50f018842a9ad3'),
        ('resource_breakers_reason_check', 'c',
          'a16938033d9fedba1bfb6f1fb3f9a695'),
        ('resource_breakers_state_check', 'c',
          '211da65e82943c44beb39b317af7c000'),
        ('resource_breakers_target_check', 'c',
          '3f2b58d9d0290fe4b4398322f617a246'),
        ('resource_breakers_target_unique', 'u',
          'ac9e3f03dd3d27504b3cadcc477aa415')
      )
      select 1
      from expected
      left join pg_catalog.pg_constraint constraint_row
        on constraint_row.conrelid = breaker_relation
       and constraint_row.conname = expected.constraint_name
      where constraint_row.oid is null
        or constraint_row.contype <> expected.constraint_type::"char"
        or not constraint_row.convalidated
        or pg_catalog.md5(pg_catalog.pg_get_constraintdef(
          constraint_row.oid, true
        )) <> expected.definition_md5
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = breaker_relation
        and constraint_row.contype <> 'n'
    ) <> 10
    or exists (
      with expected(index_name, definition_md5) as (values
        ('resource_breakers_open', '415d827b30b8846fb40447bd1d968b3e'),
        ('resource_breakers_pkey', 'aec60ef53c6e6e9f763eb3598f3f89c0'),
        ('resource_breakers_target_unique',
          '0591eee739b49876d13d08b49e55e67f')
      )
      select 1
      from expected
      left join pg_catalog.pg_class index_relation
        on index_relation.relname = expected.index_name
       and index_relation.relnamespace = 'public'::pg_catalog.regnamespace
      left join pg_catalog.pg_index index_row
        on index_row.indexrelid = index_relation.oid
       and index_row.indrelid = breaker_relation
      where index_row.indexrelid is null
        or not index_row.indisvalid
        or not index_row.indisready
        or not index_row.indislive
        or pg_catalog.md5(pg_catalog.pg_get_indexdef(index_row.indexrelid))
          <> expected.definition_md5
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = breaker_relation
    ) <> 3
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_policy policy
      where policy.polrelid = breaker_relation
    ) <> 1
    or not exists (
      select 1
      from pg_catalog.pg_policy policy
      where policy.polrelid = breaker_relation
        and policy.polname = 'resource_breakers_select_members'
        and policy.polcmd = 'r'
        and policy.polpermissive
        and policy.polroles = array[
          pg_catalog.to_regrole('authenticated')::oid
        ]
        and policy.polwithcheck is null
        and pg_catalog.md5(pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid
        )) = '2eea03a91826969e8abc25f7f80097f6'
    )
  then
    raise exception using errcode = '55000',
      message = 'breaker-aware selector dependency table drifted';
  end if;

  if (
      select pg_catalog.count(*)
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace space on space.oid = routine.pronamespace
      where space.nspname = 'public'
        and routine.proname in (
          'claim_planned_graph_internal',
          'claim_phase1c_run_budget_internal'
        )
    ) <> 2
  then
    raise exception using errcode = '55000',
      message = 'breaker-aware selector base overload count drifted';
  end if;

  if pg_catalog.to_regprocedure(
      'public.claim_phase1c_run_target_budget_internal(text,text,text,integer,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.claim_phase1c_run_target_internal(text,text,text,integer,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.claim_phase1c_run_by_command_v2(text,text,text,integer,uuid,integer)'
    ) is not null
  then
    raise exception using errcode = '55000',
      message = 'target-bound selector catalog already exists';
  end if;
end;
$preflight$;

create or replace function public.claim_phase1c_run_budget_internal(
  p_worker_id text, p_provider text, p_model text,
  p_lease_seconds integer default 120
)
returns table (
  run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
  command_id uuid, agent_id uuid, prompt text, command_type text,
  requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
  connection_id uuid, repository_id uuid, internal_installation_id uuid,
  external_installation_id bigint, app_id bigint, external_repository_id bigint,
  repository_full_name text, base_branch text, base_sha text,
  lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
  cancellation_requested boolean, logical_agent_role text, provider text, model text,
  maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
  maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
  owner_approval_id uuid, owner_approval_expires_at timestamptz,
  recovery_head_branch text, recovery_head_sha text,
  recovery_pull_request_number integer, recovery_pull_request_url text,
  recovery_provider_run_reference text, recovery_usage jsonb
)
language plpgsql security definer set search_path = pg_catalog as $function$
declare
  claimed_run_id uuid;
  worker_capacity integer;
  worker_active integer;
  claimed_priority smallint;
  claimed_verdict record;
  withheld_candidate record;
  claimed_run public.agent_runs%rowtype;
  exhausted_run public.agent_runs%rowtype;
  terminal_outcome text;
  deadline_exhausted boolean;
  terminal_error_code text;
  terminal_failure_summary text;
  new_lease_token uuid := gen_random_uuid();
  bounded_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 300));
begin
  if not exists (
    select 1 from public.phase1c_workers worker
    where worker.worker_id = p_worker_id and worker.status = 'active'
      and worker.last_heartbeat_at > now() - interval '5 minutes'
      and worker.last_heartbeat_at <= now() + interval '1 minute'
  ) then raise exception using errcode = '42501', message = 'worker is not registered and active'; end if;
  if p_provider <> 'openai' or p_model <> 'gpt-5.3-codex' then
    raise exception using errcode = '22023', message = 'unsupported worker provider or model';
  end if;

  for exhausted_run in
    select run.* from public.agent_runs run
    join public.commands deadline_command on deadline_command.id = run.command_id
      and deadline_command.organization_id = run.organization_id
    where (
      run.status = 'running'::public.run_status
      and run.lease_expires_at < now()
      and (run.cancellation_requested_at is not null
        or run.attempt_number >= run.max_attempts
        or run.started_at is null
        or case
          when deadline_command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
            and (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
              between 60000 and 3600000
            then run.started_at + make_interval(secs =>
              (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) <= now()
          else true
        end)
    ) or (
      run.status = 'queued'::public.run_status
      and run.started_at is not null
      and case
        when deadline_command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
          and (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
            between 60000 and 3600000
          then run.started_at + make_interval(secs =>
            (deadline_command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) <= now()
        else true
      end
    )
    for update of run skip locked
  loop
    select case
      when exhausted_run.started_at is null then true
      when command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
        and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer
          between 60000 and 3600000
        then exhausted_run.started_at + make_interval(secs =>
          (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) <= now()
      else true
    end into deadline_exhausted
    from public.commands command
    where command.id = exhausted_run.command_id
      and command.organization_id = exhausted_run.organization_id;
    terminal_outcome := case when exhausted_run.cancellation_requested_at is not null
      then 'cancelled' else 'failed' end;
    terminal_error_code := case
      when terminal_outcome = 'cancelled' then null
      when deadline_exhausted then 'timed_out'
      else 'lease_attempts_exhausted'
    end;
    terminal_failure_summary := case
      when deadline_exhausted then 'The configured maximum execution duration elapsed.'
      else 'The bounded worker attempt limit was exhausted.'
    end;
    update public.agent_runs run set status = terminal_outcome::public.run_status,
      lease_worker_id = null, lease_token = null, lease_expires_at = null,
      retryable = false, error_code = terminal_error_code,
      error_message = case when terminal_outcome = 'failed' then
        case when deadline_exhausted
          then 'The bounded execution deadline elapsed before the stale lease could be reclaimed.'
          else 'The worker lease expired after the bounded attempt limit.' end
        end,
      result_summary = case when terminal_outcome = 'cancelled'
        then 'The owner-requested cancellation completed after the worker lease expired.'
        else terminal_failure_summary end,
      completed_at = now(), updated_at = now()
      where run.id = exhausted_run.id;
    update public.tasks task set status = terminal_outcome::public.task_status,
      blocked_reason = case when terminal_outcome = 'failed' then terminal_failure_summary end,
      result_summary = case when terminal_outcome = 'cancelled'
        then 'The owner-requested cancellation completed safely.'
        when deadline_exhausted then 'The worker stopped at the durable execution deadline.'
        else 'The worker stopped after repeated lease loss.' end,
      completed_at = now(), updated_at = now() where task.id = exhausted_run.task_id;
    update public.commands command set status = terminal_outcome::public.command_status,
      completed_at = now(), updated_at = now() where command.id = exhausted_run.command_id;
    update public.agents agent set status = 'idle'::public.agent_status,
      current_assignment = null, last_run_at = now(), updated_at = now()
      where agent.id = exhausted_run.agent_id;
    update public.phase1c_workers worker set current_run_id = null,
      status = case when worker.status = 'disabled' then worker.status else 'error' end,
      updated_at = now() where worker.current_run_id = exhausted_run.id;
    insert into public.phase1c_run_events (
      organization_id, run_id, attempt_number, event_type, message, details
    ) values (
      exhausted_run.organization_id, exhausted_run.id, exhausted_run.attempt_number,
      terminal_outcome, case when terminal_outcome = 'cancelled'
        then 'The stale worker lease reached the owner-requested cancellation boundary.'
        when deadline_exhausted then 'The stale worker lease reached the durable execution deadline.'
        else 'The stale worker lease exhausted the bounded attempt limit.' end,
      jsonb_build_object('errorCode', terminal_error_code)
    );
    perform public.record_activity_event(
      exhausted_run.organization_id, exhausted_run.project_id,
      case when terminal_outcome = 'cancelled' then 'agent.cancelled'::public.activity_event_type
        else 'agent.failed'::public.activity_event_type end,
      'agent_run', exhausted_run.id,
      case when terminal_outcome = 'cancelled'
        then 'Phase 1C run cancelled after its worker lease expired'
        when deadline_exhausted then 'Phase 1C run failed at its durable execution deadline'
        else 'Phase 1C run failed after bounded lease exhaustion' end,
      jsonb_build_object('attempt', exhausted_run.attempt_number,
        'maxAttempts', exhausted_run.max_attempts)
    );
    insert into public.reports (
      organization_id, project_id, generated_by_agent_id, type, status,
      title, summary, content, period_start, period_end, published_at
    ) values (
      exhausted_run.organization_id, exhausted_run.project_id, exhausted_run.agent_id,
      'quality'::public.report_type, 'published'::public.report_status,
      'Phase 1C run ' || left(exhausted_run.id::text, 8) || ' ' || terminal_outcome,
      case when terminal_outcome = 'cancelled'
        then 'The owner-requested cancellation completed after the worker lease expired.'
        else terminal_failure_summary end,
      jsonb_build_object(
        'outcome', terminal_outcome, 'runIds', jsonb_build_array(exhausted_run.id),
        'pullRequestNumbers', coalesce((select jsonb_agg(evidence.external_number)
          from (select pull.external_number from public.pull_requests pull
            where pull.agent_run_id = exhausted_run.id
            order by pull.created_at desc limit 10) evidence), '[]'::jsonb),
        'changedFiles', exhausted_run.changed_files,
        'checks', exhausted_run.checks,
        'validations', coalesce((select jsonb_agg(jsonb_build_object(
          'name', evidence.name, 'status', evidence.status,
          'durationMs', evidence.duration_ms,
          'attempt', evidence.attempt_number, 'round', evidence.validation_round
        ) order by evidence.attempt_number desc, evidence.validation_round desc)
          from (select validation.* from public.phase1c_run_validations validation
            where validation.run_id = exhausted_run.id
            order by validation.attempt_number desc, validation.validation_round desc limit 100
          ) evidence), '[]'::jsonb),
        'sections', jsonb_build_array(jsonb_build_object(
          'title', case when terminal_outcome = 'cancelled'
            then 'Cancellation completed'
            when deadline_exhausted then 'Execution deadline reached'
            else 'Bounded lease exhaustion' end,
          'body', case when terminal_outcome = 'cancelled'
            then 'The run stopped after its worker lease expired.'
            when deadline_exhausted
            then 'The stale lease was terminalized before another worker could exceed the durable execution deadline.'
            else 'The worker lease expired after the configured attempt limit.' end
        )),
        'findings', jsonb_build_array(jsonb_build_object(
          'title', 'Execution stopped',
          'severity', case when terminal_outcome = 'cancelled' then 'medium' else 'high' end,
          'status', 'open', 'summary', case when terminal_outcome = 'cancelled'
            then 'The owner-requested safe boundary was honored.'
            when deadline_exhausted then 'No additional worker was permitted after the execution deadline.'
            else 'No further automatic attempt is permitted.' end
        )),
        'security', jsonb_build_object(
          'risk', exhausted_run.risk_level,
          'errorCode', terminal_error_code,
          'blocker', case when terminal_outcome = 'cancelled'
            then 'Owner-requested cancellation.'
            when deadline_exhausted then 'The durable execution deadline elapsed.'
            else 'The bounded worker attempt limit was exhausted.' end
        ),
        'decisions', case when terminal_outcome = 'cancelled' then jsonb_build_array(
          jsonb_build_object('id', exhausted_run.id::text || '-cancellation',
            'title', 'Cancellation requested', 'status', 'recorded',
            'ownerAction', left(exhausted_run.cancellation_reason, 500))
        ) else '[]'::jsonb end
      ),
      exhausted_run.started_at, now(), now()
    );
  end loop;

  -- Worker capacity. Measured from live leases rather than from
  -- `current_run_id`, so a worker that crashed mid-run stops consuming capacity
  -- the moment its lease expires instead of holding a slot until someone
  -- notices. No audit row: `phase1c_workers` is not organization-scoped, so
  -- there is no organization this could honestly be attributed to, and worker
  -- utilisation is directly visible from the leases themselves.
  select worker.maximum_concurrent_runs into worker_capacity
  from public.phase1c_workers worker where worker.worker_id = p_worker_id;
  select count(*) into worker_active
  from public.agent_runs active
  where active.lease_worker_id = p_worker_id
    and active.status = 'running'::public.run_status
    and active.lease_expires_at > now();
  if worker_active >= coalesce(worker_capacity, 1) then return; end if;

  select run.id, portfolio_priority.value into claimed_run_id, claimed_priority
  from public.agent_runs run
  join public.tasks task on task.id = run.task_id and task.organization_id = run.organization_id
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.agents assigned_agent on assigned_agent.id = run.agent_id
    and assigned_agent.organization_id = run.organization_id
  join public.projects project on project.id = run.project_id and project.organization_id = run.organization_id
  join public.organizations organization on organization.id = run.organization_id
  cross join lateral (
    select public.effective_work_priority(
      project.engineering_priority, project.strategic_focus,
      public.is_emergency_work(task.id, command.id), run.created_at,
      organization.fairness_promotion_seconds, now()
    ) as value
  ) portfolio_priority
  cross join lateral public.portfolio_capacity_verdict(
    run.organization_id, run.project_id, run.provider, run.connection_id,
    portfolio_priority.value
  ) capacity_verdict
  join public.project_connections link on link.project_id = project.id
    and link.organization_id = project.organization_id and link.connection_id = run.connection_id
    and link.github_repository_id = run.github_repository_id and link.is_primary
  join public.connections connection on connection.id = link.connection_id
    and connection.organization_id = link.organization_id
  join public.github_installations installation on installation.connection_id = connection.id
    and installation.organization_id = connection.organization_id
  join public.github_repositories repository on repository.id = run.github_repository_id
    and repository.installation_id = installation.id and repository.organization_id = run.organization_id
  where (run.status = 'queued'::public.run_status
      or (run.status = 'running'::public.run_status and run.lease_expires_at < now()))
    and run.attempt_number < run.max_attempts and run.cancellation_requested_at is null
    and command.parameters -> 'budget' ->> 'maximumDurationMs' ~ '^[0-9]{1,7}$'
    and (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer between 60000 and 3600000
    and (run.started_at is null or run.started_at + make_interval(secs =>
      (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0) > now())
    and run.risk_level in ('green'::public.risk_level, 'yellow'::public.risk_level)
    and command.requested_risk = run.risk_level
    and command.status in ('queued'::public.command_status, 'running'::public.command_status)
    and task.status in ('queued'::public.task_status, 'in_progress'::public.task_status)
    and run.provider = p_provider and run.model = p_model
    and project.status = 'active'::public.project_status
    and not project.engineering_paused
    and capacity_verdict.allowed
    and public.breaker_suppression_reason(
      run.organization_id, run.provider, run.model, now()
    ) is null
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch
    and run.base_branch = repository.default_branch
    and not exists (
      select 1 from public.agent_runs other_run
      where other_run.agent_id = run.agent_id and other_run.id <> run.id
        and other_run.status = 'running'::public.run_status
        and other_run.lease_expires_at > now()
    )
    and not exists (
      select 1 from public.task_dependencies dependency
      join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
        and prerequisite.organization_id = dependency.organization_id
      where dependency.task_id = task.id and dependency.organization_id = task.organization_id
        and prerequisite.status <> 'completed'::public.task_status
    )
    and (
      (
        not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'branch')
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'commit')
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'pull_request')
        and not exists (select 1 from public.pull_requests pull where pull.agent_run_id = run.id)
      ) or (
        (select count(*) from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'branch') = 1
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'commit')
        and not exists (select 1 from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'pull_request')
        and not exists (select 1 from public.pull_requests pull where pull.agent_run_id = run.id)
      ) or (
        (select count(*) from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'branch') = 1
        and (select count(*) from public.phase1c_run_artifacts artifact
          where artifact.run_id = run.id and artifact.artifact_type = 'commit') >= 1
        and run.head_branch ~ '^factory/[A-Za-z0-9._/-]{1,240}$'
        and run.head_sha ~ '^[0-9a-f]{40}$'
        and exists (select 1 from public.phase1c_run_artifacts branch
          where branch.run_id = run.id and branch.artifact_type = 'branch'
            and branch.reference = run.head_branch)
        and exists (select 1 from public.phase1c_run_artifacts commit
          where commit.run_id = run.id and commit.artifact_type = 'commit'
            and lower(commit.reference) = run.head_sha)
        and (
          (
            not exists (select 1 from public.phase1c_run_artifacts artifact
              where artifact.run_id = run.id and artifact.artifact_type = 'pull_request')
            and not exists (select 1 from public.pull_requests pull
              where pull.agent_run_id = run.id)
          ) or (
            (select count(*) from public.phase1c_run_artifacts artifact
              where artifact.run_id = run.id and artifact.artifact_type = 'pull_request') = 1
            and (select count(*) from public.pull_requests pull
              where pull.agent_run_id = run.id) = 1
            and exists (
              select 1 from public.pull_requests pull
              where pull.agent_run_id = run.id and pull.organization_id = run.organization_id
                and pull.project_id = run.project_id and pull.repository = repository.full_name
                and pull.status = 'draft'::public.pull_request_status
                and pull.head_branch = run.head_branch and pull.base_branch = run.base_branch
                and exists (select 1 from public.phase1c_run_artifacts artifact
                  where artifact.run_id = run.id and artifact.artifact_type = 'pull_request'
                    and artifact.reference = pull.url
                    and artifact.external_number = pull.external_number)
            )
          )
        )
      )
    )
  order by portfolio_priority.value asc,
    case when run.status = 'queued'::public.run_status then 0 else 1 end,
    case when project.strategic_focus then 0 else 1 end,
    task.priority desc, run.created_at asc
  limit 1 for update of run, assigned_agent skip locked;
  if claimed_run_id is null then
    -- Nothing was claimed. If portfolio work was ready and a ceiling is what
    -- held it back, that is a bottleneck the owner needs to see. It is the only
    -- case recorded: an idle poll against an empty queue is evidence of
    -- nothing, and writing a row for it would bury the rows that matter.
    select run.organization_id as organization_id, run.project_id as project_id,
      -- An unhealthy provider is named ahead of a ceiling: a breaker is the
      -- more actionable of the two, and a ceiling that is also binding will
      -- still be there once the provider recovers.
      coalesce(withheld_breaker.reason, withheld_verdict.reason) as reason,
      withheld_verdict.capacity as capacity,
      withheld_priority.value as effective_priority
    into withheld_candidate
    from public.agent_runs run
    join public.tasks task on task.id = run.task_id
      and task.organization_id = run.organization_id
    join public.commands command on command.id = run.command_id
      and command.organization_id = run.organization_id
    join public.projects project on project.id = run.project_id
      and project.organization_id = run.organization_id
    join public.organizations organization on organization.id = run.organization_id
    cross join lateral (
      select public.effective_work_priority(
        project.engineering_priority, project.strategic_focus,
        public.is_emergency_work(task.id, command.id), run.created_at,
        organization.fairness_promotion_seconds, now()
      ) as value
    ) withheld_priority
    cross join lateral public.portfolio_capacity_verdict(
      run.organization_id, run.project_id, run.provider, run.connection_id,
      withheld_priority.value
    ) withheld_verdict
    cross join lateral (
      select public.breaker_suppression_reason(
        run.organization_id, run.provider, run.model, now()
      ) as reason
    ) withheld_breaker
    where run.status = 'queued'::public.run_status
      and run.provider = p_provider and run.model = p_model
      and run.cancellation_requested_at is null
      and run.attempt_number < run.max_attempts
      and project.status = 'active'::public.project_status
      and not project.engineering_paused
      and not exists (
        select 1 from public.task_dependencies dependency
        join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
          and prerequisite.organization_id = dependency.organization_id
        where dependency.task_id = task.id
          and dependency.organization_id = task.organization_id
          and prerequisite.status <> 'completed'::public.task_status
      )
      and (not withheld_verdict.allowed or withheld_breaker.reason is not null)
    order by withheld_priority.value asc, run.created_at asc
    limit 1;

    if found then
      insert into public.scheduling_decisions (
        organization_id, decision, project_id, worker_id, provider, model,
        effective_priority, reason, capacity
      )
      select withheld_candidate.organization_id, 'withheld',
        withheld_candidate.project_id, p_worker_id, p_provider, p_model,
        withheld_candidate.effective_priority, withheld_candidate.reason,
        withheld_candidate.capacity
      -- A worker polls continuously, and a ceiling stays binding for as long as
      -- the work it is holding runs. Without this the audit would be one row per
      -- poll for the same unchanged fact.
      where not exists (
        select 1 from public.scheduling_decisions recent
        where recent.organization_id = withheld_candidate.organization_id
          and recent.worker_id = p_worker_id
          and recent.decision = 'withheld'
          and recent.reason = withheld_candidate.reason
          and recent.occurred_at > now() - interval '1 minute'
      );
    end if;
    return;
  end if;

  update public.agent_runs run set
    status = 'running'::public.run_status, lease_worker_id = p_worker_id,
    lease_token = new_lease_token,
    lease_expires_at = now() + make_interval(secs => bounded_lease_seconds),
    attempt_number = run.attempt_number + 1, retryable = false,
    error_code = null, error_message = null,
    started_at = coalesce(run.started_at, now()), completed_at = null, updated_at = now()
  where run.id = claimed_run_id returning run.* into claimed_run;
  update public.tasks task set status = 'in_progress'::public.task_status,
    started_at = coalesce(task.started_at, now()), updated_at = now()
    where task.id = claimed_run.task_id;
  update public.commands command set status = 'running'::public.command_status, updated_at = now()
    where command.id = claimed_run.command_id;
  update public.agents agent set status = 'busy'::public.agent_status,
    current_assignment = claimed_run.task_id::text, last_run_at = now(), updated_at = now()
    where agent.id = claimed_run.agent_id;
  update public.phase1c_workers worker set current_run_id = claimed_run.id,
    last_heartbeat_at = now(), updated_at = now() where worker.worker_id = p_worker_id;
  insert into public.phase1c_run_events (
    organization_id, run_id, attempt_number, event_type, message, details
  ) values (
    claimed_run.organization_id, claimed_run.id, claimed_run.attempt_number,
    'claimed', 'Worker claimed the durable run lease.',
    jsonb_build_object('workerId', p_worker_id, 'leaseSeconds', bounded_lease_seconds)
  );

  -- An admitted trial restarts the cooldown clock, so exactly one trial is in
  -- flight at a time: the next poller sees an open breaker still inside its
  -- window. A success closes the breaker; a fault re-opens it with a fresh
  -- timer; a worker that dies without reporting simply frees the breaker again
  -- after another cooldown.
  perform public.consume_breaker_trial(
    claimed_run.organization_id, claimed_run.provider, claimed_run.model
  );

  -- Goal 28: project, task, agent, provider, connection and reason, on every
  -- assignment. The capacity snapshot is taken *after* the claim, so it shows
  -- the state this assignment produced rather than the state it was weighed
  -- against; the effective priority records what it was weighed at.
  select * into claimed_verdict from public.portfolio_capacity_verdict(
    claimed_run.organization_id, claimed_run.project_id, claimed_run.provider,
    claimed_run.connection_id, claimed_priority
  );
  insert into public.scheduling_decisions (
    organization_id, decision, project_id, run_id, task_id, agent_id,
    connection_id, worker_id, provider, model, effective_priority, reason,
    capacity
  ) values (
    claimed_run.organization_id, 'assigned', claimed_run.project_id,
    claimed_run.id, claimed_run.task_id, claimed_run.agent_id,
    claimed_run.connection_id, p_worker_id, claimed_run.provider,
    claimed_run.model, claimed_priority,
    'Highest effective priority P' || claimed_priority::text
      || ' within project, provider and portfolio capacity.',
    claimed_verdict.capacity
  );

  return query
  select run.id, run.organization_id, run.project_id, run.task_id,
    run.command_id, run.agent_id, command.prompt, command.command_type,
    run.risk_level, command.acceptance_criteria, command.execution_plan,
    run.connection_id, run.github_repository_id, installation.id,
    installation.external_installation_id, installation.app_id,
    repository.external_repository_id, repository.full_name,
    run.base_branch, run.base_sha, run.lease_token, run.lease_expires_at,
    run.attempt_number, run.cancellation_requested_at is not null,
    run.logical_agent_role::text, run.provider, run.model,
    least(
      (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer,
      greatest(1, floor(extract(epoch from (
        run.started_at + make_interval(secs =>
          (command.parameters -> 'budget' ->> 'maximumDurationMs')::integer / 1000.0
        ) - now()
      )) * 1000)::integer)
    ),
    (command.parameters -> 'budget' ->> 'maximumTurns')::integer,
    (command.parameters -> 'budget' ->> 'maximumInputTokens')::integer,
    (command.parameters -> 'budget' ->> 'maximumOutputTokens')::integer,
    (command.parameters -> 'budget' ->> 'maximumRepairAttempts')::integer,
    (command.parameters -> 'budget' ->> 'ciTimeoutMs')::integer,
    null::uuid, null::timestamptz,
    case when exists (select 1 from public.phase1c_run_artifacts branch
      where branch.run_id = run.id and branch.artifact_type = 'branch'
        and branch.reference = run.head_branch) then run.head_branch end,
    case when exists (select 1 from public.phase1c_run_artifacts commit
      where commit.run_id = run.id and commit.artifact_type = 'commit'
        and lower(commit.reference) = run.head_sha) then run.head_sha end,
    pull.external_number, pull.url,
    case when exists (select 1 from public.phase1c_run_artifacts branch
      where branch.run_id = run.id and branch.artifact_type = 'branch'
        and branch.reference = run.head_branch)
      and exists (select 1 from public.phase1c_run_artifacts commit
        where commit.run_id = run.id and commit.artifact_type = 'commit'
          and lower(commit.reference) = run.head_sha)
      then run.provider_run_reference end,
    case when exists (select 1 from public.phase1c_run_artifacts branch
      where branch.run_id = run.id and branch.artifact_type = 'branch'
        and branch.reference = run.head_branch)
      and exists (select 1 from public.phase1c_run_artifacts commit
        where commit.run_id = run.id and commit.artifact_type = 'commit'
          and lower(commit.reference) = run.head_sha)
      then run.usage else '{}'::jsonb end
  from public.agent_runs run
  join public.commands command on command.id = run.command_id and command.organization_id = run.organization_id
  join public.github_repositories repository on repository.id = run.github_repository_id
    and repository.organization_id = run.organization_id
  join public.github_installations installation on installation.id = repository.installation_id
    and installation.organization_id = repository.organization_id
  left join public.pull_requests pull on pull.agent_run_id = run.id
    and pull.status = 'draft'::public.pull_request_status
  where run.id = claimed_run.id;
end;
$function$;

revoke all on function public.claim_phase1c_run_budget_internal(
  text, text, text, integer
) from public, anon, authenticated, service_role;

comment on function public.claim_phase1c_run_budget_internal(
  text, text, text, integer
) is
  'Portfolio-aware selection: effective priority, strategic focus, engineering pause, circuit-breaker health, and worker/project/provider/portfolio ceilings, recorded in scheduling_decisions.';

do $postflight$
declare
  selector_oid oid := pg_catalog.to_regprocedure(
    'public.claim_phase1c_run_budget_internal(text,text,text,integer)'
  );
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_language language on language.oid = routine.prolang
    where routine.oid = selector_oid
      and language.lanname = 'plpgsql'
      and routine.prokind = 'f'
      and routine.provolatile = 'v'
      and routine.proparallel = 'u'
      and not routine.proisstrict
      and not routine.proleakproof
      and routine.proretset
      and routine.pronargdefaults = 1
      and routine.prorettype = 'record'::pg_catalog.regtype
      and pg_catalog.md5(pg_catalog.pg_get_function_identity_arguments(routine.oid))
        = '0e52321dcc4ae192741cff672f3b9abb'
      and pg_catalog.md5(pg_catalog.pg_get_function_arguments(routine.oid))
        = 'b511c642748a410371daffa5975dfc95'
      and pg_catalog.md5(pg_catalog.pg_get_function_result(routine.oid))
        = '6dd487ee94c50b0250bdca6bfdacac71'
      and routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
      and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
        routine.prosrc, E'\r\n', E'\n'
      ), E'\r', E'\n')) = '5933952d71f9da90a2a80a05ce6e0378'
      and routine.proacl is not null
      and (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) = 1
      and not exists (
        select 1 from pg_catalog.aclexplode(routine.proacl) acl
        where acl.grantor <> routine.proowner
          or acl.grantee <> routine.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
      )
      and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
  ) then
    raise exception using errcode = '55000',
      message = 'breaker-aware selector normalization postflight failed';
  end if;
end;
$postflight$;
