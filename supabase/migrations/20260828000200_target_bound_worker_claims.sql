-- Exact-target worker claims for owner-dispatched lifecycle canaries.
--
-- The established claims intentionally remain available for the disabled-by-
-- default scheduled drain. A repository/manual dispatch, however, carries an
-- immutable graph or command UUID. These wrappers make that UUID part of the
-- database boundary. Target-aware overloads retain all established
-- eligibility, locking, ordering, lease, audit, and projection behavior while
-- filtering inside the authoritative selector. A defensive post-selection
-- assertion still aborts the whole transaction if that invariant ever drifts.
-- No worker can touch a neighboring shared-queue item merely because a
-- targeted wake arrived first, and an older item cannot starve the target.

-- This migration copies the two authoritative global selectors so an exact
-- immutable target can be filtered inside their locking boundary. Refuse to
-- replace anything unless the installed release line is the exact reviewed
-- source and retains its definer, owner, pinned search path, and private ACL.
do $preflight$
declare
  graph_internal_oid oid := pg_catalog.to_regprocedure(
    'public.claim_planned_graph_internal(text,text[],text,jsonb)'
  );
  phase_internal_oid oid := pg_catalog.to_regprocedure(
    'public.claim_phase1c_run_budget_internal(text,text,text,integer)'
  );
  routine_oid oid;
  routine_signature text;
  source_hash text;
begin
  if graph_internal_oid is null or phase_internal_oid is null then
    raise exception using errcode = '55000',
      message = 'target-bound claim preflight found a missing global selector';
  end if;

  select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
    routine.prosrc, E'\r\n', E'\n'
  ), E'\r', E'\n'))
    into source_hash
  from pg_catalog.pg_proc routine
  where routine.oid = graph_internal_oid;
  if source_hash is distinct from 'fdd3eee3e61c083789ffeb4808ed0a47' then
    raise exception using errcode = '55000',
      message = 'claim_planned_graph_internal source identity mismatch';
  end if;

  select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
    routine.prosrc, E'\r\n', E'\n'
  ), E'\r', E'\n'))
    into source_hash
  from pg_catalog.pg_proc routine
  where routine.oid = phase_internal_oid;
  if source_hash is distinct from '5933952d71f9da90a2a80a05ce6e0378' then
    raise exception using errcode = '55000',
      message = 'claim_phase1c_run_budget_internal source identity mismatch';
  end if;

  foreach routine_signature in array array[
    'public.claim_planned_graph_internal(text,text[],text,jsonb)',
    'public.claim_phase1c_run_budget_internal(text,text,text,integer)'
  ]::text[] loop
    routine_oid := pg_catalog.to_regprocedure(routine_signature);
    if not exists (
      select 1
      from pg_catalog.pg_proc routine
      where routine.oid = routine_oid
        and routine.prosecdef
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
    ) or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
    then
      raise exception using errcode = '55000',
        message = pg_catalog.format(
          'global selector metadata or ACL mismatch: %s', routine_signature
        );
    end if;
  end loop;

  foreach routine_signature in array array[
    'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)',
    'public.claim_phase1c_run_v2(text,text,text,integer,integer)'
  ]::text[] loop
    routine_oid := pg_catalog.to_regprocedure(routine_signature);
    if routine_oid is null or not exists (
      select 1
      from pg_catalog.pg_proc routine
      where routine.oid = routine_oid
        and routine.prosecdef
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
    ) or not pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
    then
      raise exception using errcode = '55000',
        message = pg_catalog.format(
          'legacy protocol-v2 claim metadata or ACL mismatch: %s', routine_signature
        );
    end if;
  end loop;
end;
$preflight$;

create or replace function public.assert_phase1c_claim_target(
  p_claimed_command_id uuid,
  p_target_command_id uuid
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
begin
  if p_target_command_id is null then
    raise exception using errcode = '22023',
      message = 'an exact target command id is required';
  end if;
  if p_claimed_command_id is distinct from p_target_command_id then
    raise exception using errcode = '55000',
      message = 'targeted Phase 1C claim selected a different command';
  end if;
  return true;
end;
$function$;

revoke all on function public.assert_phase1c_claim_target(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Target-aware private selectors keep every established scheduler, lease, budget,
-- bridge, and audit rule in one authoritative implementation. Passing NULL
-- preserves the existing scheduled-drain behavior; one-shot RPCs pass the
-- exact immutable identity and the selectors touch no neighboring queue row.

create or replace function public.claim_planned_graph_target_internal(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_target_graph_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_graph record;
  v_run_id uuid;
  v_stale record;
  v_bridge public.graph_phase1c_bridges;
  v_predecessor public.graph_runs;
  v_bridge_count integer;
  v_bridge_id uuid;
  v_claim jsonb;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  if p_supported_executors is null
    or pg_catalog.array_ndims(p_supported_executors) is distinct from 1
    or pg_catalog.cardinality(p_supported_executors) not between 1 and 3
    or pg_catalog.array_position(p_supported_executors, null) is not null
    or exists (
      select 1
      from pg_catalog.unnest(p_supported_executors) declared(executor)
      where declared.executor not in ('DETERMINISTIC', 'MODEL', 'ANCHOR')
    )
    or (
      select pg_catalog.count(distinct declared.executor)
      from pg_catalog.unnest(p_supported_executors) declared(executor)
    ) <> pg_catalog.cardinality(p_supported_executors)
  then
    raise exception using
      errcode = '22023',
      message = 'a worker must declare a unique, bounded set of supported executors';
  end if;
  if p_repository_full_name is null
    or p_repository_full_name is distinct from pg_catalog.btrim(p_repository_full_name)
    or pg_catalog.char_length(p_repository_full_name) not between 3 and 201
    or p_repository_full_name !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    or not public.graph_required_check_policy_is_safe(p_required_check_names)
  then
    raise exception using errcode = '22023',
      message = 'a worker must declare its exact repository and required-check policy';
  end if;

  for v_stale in
    select r.id, r.organization_id
      from public.graph_runs r
     where (p_target_graph_id is null or r.graph_id = p_target_graph_id)
       and r.state = 'RUNNING'
       and r.updated_at < now() - interval '2 hours'
       and not exists (
         select 1 from public.node_runs nr
          where nr.graph_run_id = r.id
            and nr.updated_at >= now() - interval '2 hours'
       )
     for update of r skip locked
  loop
    update public.graph_runs
       set state = 'FAILED', completed_at = now(), updated_at = now()
     where id = v_stale.id
       and state = 'RUNNING'
       and updated_at < now() - interval '2 hours'
       and not exists (
         select 1
         from public.node_runs nr
         where nr.graph_run_id = v_stale.id
           and nr.updated_at >= now() - interval '2 hours'
       );
    if not found then
      continue;
    end if;

    with cancelled as (
      update public.node_runs
         set state = 'CANCELLED',
             blocked_reason = 'The worker running this graph stopped reporting; the run was reclaimed.',
             completed_at = now(),
             updated_at = now()
       where graph_run_id = v_stale.id
         and state in ('PENDING', 'READY', 'RUNNING', 'VERIFYING', 'BLOCKED')
      returning id, organization_id, graph_run_id
    )
    insert into public.graph_events (
      organization_id, graph_run_id, node_run_id, event_type, detail
    )
    select
      cancelled.organization_id,
      cancelled.graph_run_id,
      cancelled.id,
      'node_cancelled',
      pg_catalog.format('Reclaimed by worker %s after the prior worker stopped reporting.', p_worker_id)
    from cancelled;

    insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
    values (
      v_stale.organization_id, v_stale.id, 'run_failed',
      format('Reclaimed by worker %s: the run had been silent for over two hours and its worker is presumed dead.', p_worker_id)
    );
  end loop;

  select
    g.*,
    project.name as project_name,
    project.production_url as project_production_url,
    repository.full_name as project_repository,
    repository.default_branch as project_default_branch
    into v_graph
    from public.graphs g
    join public.projects project
      on project.id = g.project_id
     and project.organization_id = g.organization_id
    join public.project_connections link
      on link.organization_id = g.organization_id
     and link.project_id = g.project_id
     and link.is_primary
    join public.connections connection
      on connection.id = link.connection_id
     and connection.organization_id = link.organization_id
    join public.github_installations installation
      on installation.connection_id = connection.id
     and installation.organization_id = connection.organization_id
    join public.github_repositories repository
      on repository.id = link.github_repository_id
     and repository.installation_id = installation.id
     and repository.organization_id = link.organization_id
   where (p_target_graph_id is null or g.id = p_target_graph_id)
     and g.requires_owner_approval = false
     and project.status = 'active'::public.project_status
     and connection.provider = 'github'::public.connection_provider
     and connection.status = 'connected'::public.connection_status
     and installation.status = 'active'
     and installation.suspended_at is null
     and installation.deleted_at is null
     and repository.selected
     and not repository.archived
     and not repository.disabled
     and project.github_repository = repository.full_name
     and project.default_branch = repository.default_branch
     and pg_catalog.lower(repository.full_name) =
       pg_catalog.lower(p_repository_full_name)
     and (g.github_repository_id is null
       or g.github_repository_id = repository.id)
     and (
       not exists (
         select 1 from public.graph_runs r
          where r.graph_id = g.id and r.state not in ('FAILED', 'CANCELLED')
       )
       or (
         g.is_lifecycle
         and not exists (
           select 1 from public.graph_runs r
            where r.graph_id = g.id and r.state = 'RUNNING'
         )
         and exists (
           select 1 from public.graph_gates gate
            where gate.graph_id = g.id
              and gate.state = 'APPROVED'
              and gate.decided_at > coalesce(
                (select max(r.completed_at) from public.graph_runs r
                  where r.graph_id = g.id
                    and r.state not in ('FAILED', 'CANCELLED')),
                gate.opened_at
              )
         )
       )
     )
     and (
       not g.is_lifecycle
       or g.template_key is distinct from 'full_lifecycle'
       or g.template_version is distinct from 2
       or not exists (
         select 1 from public.graph_gates architecture_gate
         where architecture_gate.graph_id = g.id
           and architecture_gate.stage = 'ARCHITECTURE'::public.sdlc_stage
           and architecture_gate.state = 'APPROVED'::public.gate_state
       )
       or exists (
         select 1
         from public.graph_runs predecessor
         join public.graph_phase1c_bridges bridge
           on bridge.organization_id = predecessor.organization_id
          and bridge.graph_id = predecessor.graph_id
          and (
            bridge.id = predecessor.phase1c_bridge_id
            or (
              predecessor.phase1c_bridge_id is null
              and bridge.graph_run_id = predecessor.id
            )
          )
         where predecessor.id = (
           select prior.id
           from public.graph_runs prior
           where prior.graph_id = g.id
             and prior.organization_id = g.organization_id
             and prior.state not in ('FAILED', 'CANCELLED')
             and prior.completed_at is not null
           order by prior.completed_at desc, prior.id desc
           limit 1
         )
           and public.graph_phase1c_bridge_state_rank(bridge.state) >=
             public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED')
       )
     )
     and (select count(*) from public.graph_runs r
           where r.graph_id = g.id and r.state = 'FAILED') < 3
     and (select count(*) from public.graph_runs r where r.graph_id = g.id) < 10
     and not exists (
       select 1 from public.graph_nodes n
        where n.graph_id = g.id
          and not (n.executor::text = any (p_supported_executors))
     )
     and (
       g.template_key is distinct from 'full_lifecycle'
       or g.template_version is distinct from 2
       or g.required_check_names = p_required_check_names
     )
   order by g.created_at
   for update of g, project, link, connection, installation, repository skip locked
   limit 1;

  if v_graph.id is null then
    return null;
  end if;

  if v_graph.is_lifecycle
    and v_graph.template_key = 'full_lifecycle'
    and v_graph.template_version = 2
    and exists (
      select 1
      from public.graph_gates architecture_gate
      where architecture_gate.organization_id = v_graph.organization_id
        and architecture_gate.graph_id = v_graph.id
        and architecture_gate.stage = 'ARCHITECTURE'::public.sdlc_stage
        and architecture_gate.state = 'APPROVED'::public.gate_state
    )
  then
    select * into v_predecessor
    from public.graph_runs prior
    where prior.graph_id = v_graph.id
      and prior.organization_id = v_graph.organization_id
      and prior.state not in ('FAILED', 'CANCELLED')
      and prior.completed_at is not null
    order by prior.completed_at desc, prior.id desc
    limit 1;
    if not found then
      raise exception using errcode = '55000',
        message = 'full lifecycle resume has no exact predecessor run';
    end if;

    select pg_catalog.count(*)::integer, min(bridge.id::text)::uuid
      into v_bridge_count, v_bridge_id
    from public.graph_phase1c_bridges bridge
    where bridge.organization_id = v_graph.organization_id
      and bridge.graph_id = v_graph.id
      and (
        bridge.id = v_predecessor.phase1c_bridge_id
        or (
          v_predecessor.phase1c_bridge_id is null
          and bridge.graph_run_id = v_predecessor.id
        )
      );
    if v_bridge_count <> 1 or v_bridge_id is null then
      raise exception using errcode = '55000',
        message = 'full lifecycle resume bridge identity is missing or ambiguous';
    end if;

    select * into v_bridge
    from public.graph_phase1c_bridges bridge
    where bridge.id = v_bridge_id
      and bridge.organization_id = v_graph.organization_id
      and bridge.graph_id = v_graph.id;
    if public.graph_phase1c_bridge_state_rank(v_bridge.state) <
        public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED') then
      raise exception using errcode = '55000',
        message = 'full lifecycle resume bridge lacks exact pull request evidence';
    end if;
  end if;

  insert into public.graph_runs (
    organization_id, graph_id, phase1c_bridge_id, state, started_at, created_by
  ) values (
    v_graph.organization_id, v_graph.id, v_bridge.id, 'RUNNING', now(), v_graph.created_by
  )
  returning id into v_run_id;

  insert into public.node_runs (organization_id, graph_run_id, node_id, state, queued_at)
  select v_graph.organization_id, v_run_id, n.id, 'PENDING', now()
    from public.graph_nodes n
   where n.graph_id = v_graph.id;

  insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
  values (
    v_graph.organization_id, v_run_id, 'run_started',
    format('Claimed by worker %s; nodes queued.', p_worker_id)
  );

  v_claim := jsonb_build_object(
    'graph_run_id', v_run_id,
    'graph_id', v_graph.id,
    'organization_id', v_graph.organization_id,
    'project_id', v_graph.project_id,
    'project_name', v_graph.project_name,
    'project_production_url', v_graph.project_production_url,
    'goal', v_graph.goal,
    'topology', v_graph.topology,
    'risk_level', v_graph.risk_level,
    'required_check_names', v_graph.required_check_names,
    'required_checks_sha256', v_graph.required_checks_sha256,
    'template_plan_sha256', v_graph.template_plan_sha256,
    'is_lifecycle', v_graph.is_lifecycle,
    'iteration', v_graph.iteration,
    'max_iterations', v_graph.max_iterations,
    'project_repository', v_graph.project_repository,
    'project_default_branch', v_graph.project_default_branch,
    'budget', (
      select to_jsonb(b) - 'id' - 'organization_id' - 'graph_id'
        from public.graph_budgets b
       where b.graph_id = v_graph.id
    ),
    'nodes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'node_run_id', nr.id,
        'node_key', n.node_key,
        'job', n.job,
        'executor', n.executor,
        'capability', n.capability,
        'model_tier', n.model_tier,
        'risk_level', n.risk_level,
        'timeout_ms', n.timeout_ms,
        'max_attempts', n.max_attempts,
        'allow_provider_fallback', n.allow_provider_fallback,
        'tolerates_partial_inputs', n.tolerates_partial_inputs,
        'node_id', n.id,
        'lifecycle_stage', n.lifecycle_stage,
        'gate_kind', n.gate_kind,
        'gate_state', gate.state,
        'input_schema', c.input_schema,
        'output_schema', c.output_schema,
        'reads', c.reads,
        'writes', c.writes,
        'acceptance_criteria', c.acceptance_criteria
      ) order by n.node_key), '[]'::jsonb)
        from public.graph_nodes n
        join public.node_runs nr on nr.node_id = n.id and nr.graph_run_id = v_run_id
        left join public.node_contracts c on c.node_id = n.id
        left join public.graph_gates gate on gate.node_id = n.id
       where n.graph_id = v_graph.id
    ),
    'edges', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'from_node_key', src.node_key,
        'to_node_key', dst.node_key,
        'reason', e.reason,
        'detail', e.detail
      ) order by src.node_key, dst.node_key), '[]'::jsonb)
        from public.graph_edges e
        join public.graph_nodes src on src.id = e.from_node_id
        join public.graph_nodes dst on dst.id = e.to_node_id
       where e.graph_id = v_graph.id
         and e.is_feedback = false
    )
  );

  if v_graph.is_lifecycle
    and v_graph.template_key = 'full_lifecycle'
    and v_graph.template_version = 2
  then
    v_claim := v_claim || jsonb_build_object(
      'template_key', v_graph.template_key,
      'template_version', v_graph.template_version,
      'base_branch', v_graph.base_branch,
      'base_sha', v_graph.base_sha,
      'phase1c_state', v_bridge.state,
      'phase1c_head_sha', v_bridge.head_sha,
      'pull_request_number', (
        select pull_request.external_number
        from public.pull_requests pull_request
        where pull_request.id = v_bridge.pull_request_id
          and pull_request.organization_id = v_bridge.organization_id
      ),
      'pull_request_url', (
        select pull_request.url
        from public.pull_requests pull_request
        where pull_request.id = v_bridge.pull_request_id
          and pull_request.organization_id = v_bridge.organization_id
      ),
      'validation_evidence', case when v_bridge.agent_run_id is null then null else
        jsonb_build_object(
          'agent_run_id', v_bridge.agent_run_id,
          'head_sha', v_bridge.head_sha,
          'validation_round', (
            select max(validation.validation_round)
            from public.phase1c_run_validations validation
            join public.agent_runs run
              on run.id = validation.run_id
             and run.organization_id = validation.organization_id
             and run.attempt_number = validation.attempt_number
            where validation.run_id = v_bridge.agent_run_id
              and validation.organization_id = v_bridge.organization_id
          ),
          'validations', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'name', bounded.name,
              'status', bounded.status,
              'duration_ms', bounded.duration_ms
            ) order by bounded.name), '[]'::jsonb)
            from (
              select validation.name, validation.status, validation.duration_ms
              from public.phase1c_run_validations validation
              join public.agent_runs run
                on run.id = validation.run_id
               and run.organization_id = validation.organization_id
               and run.attempt_number = validation.attempt_number
              where validation.run_id = v_bridge.agent_run_id
                and validation.organization_id = v_bridge.organization_id
                and validation.validation_round = (
                  select max(latest.validation_round)
                  from public.phase1c_run_validations latest
                  where latest.run_id = v_bridge.agent_run_id
                    and latest.organization_id = v_bridge.organization_id
                    and latest.attempt_number = run.attempt_number
                )
              order by validation.name
              limit 50
            ) bounded
          )
        )
      end,
      'merge_commit_sha', v_bridge.merge_commit_sha,
      'deployment_id', v_bridge.deployment_id,
      'deployment_url', (
        select deployment.url
        from public.deployments deployment
        where deployment.id = v_bridge.deployment_id
          and deployment.organization_id = v_bridge.organization_id
      )
    );
  end if;

  return v_claim;
end;
$$;

create or replace function public.claim_planned_graph_internal(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return public.claim_planned_graph_target_internal(
    p_worker_id,
    p_supported_executors,
    p_repository_full_name,
    p_required_check_names,
    null
  );
end;
$$;

revoke all on function public.claim_planned_graph_target_internal(
  text, text[], text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_planned_graph_internal(
  text, text[], text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.claim_phase1c_run_target_budget_internal(
  p_worker_id text, p_provider text, p_model text,
  p_lease_seconds integer,
  p_target_command_id uuid
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
    where (p_target_command_id is null or run.command_id = p_target_command_id)
      and (
      (
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
  where (p_target_command_id is null or run.command_id = p_target_command_id)
    and (run.status = 'queued'::public.run_status
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
    where (p_target_command_id is null or run.command_id = p_target_command_id)
      and run.status = 'queued'::public.run_status
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
begin
  return query
  select * from public.claim_phase1c_run_target_budget_internal(
    p_worker_id, p_provider, p_model, p_lease_seconds, null
  );
end;
$function$;

create or replace function public.claim_phase1c_run_target_internal(
  p_worker_id text, p_provider text, p_model text,
  p_lease_seconds integer,
  p_target_command_id uuid
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
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  claimed record;
  command_budget jsonb;
  prior_usage jsonb;
begin
  select * into claimed
  from public.claim_phase1c_run_target_budget_internal(
    p_worker_id, p_provider, p_model, p_lease_seconds,
    p_target_command_id
  );
  if not found then return; end if;

  select command.parameters -> 'budget',
    public.canonical_phase1c_usage(run.usage)
  into command_budget, prior_usage
  from public.agent_runs run
  join public.commands command on command.id = run.command_id
    and command.organization_id = run.organization_id
  where run.id = claimed.run_id;

  if command_budget ->> 'maximumTurns' !~ '^[1-8]$'
    or command_budget ->> 'maximumInputTokens' !~ '^[0-9]{4,7}$'
    or command_budget ->> 'maximumOutputTokens' !~ '^[0-9]{3,6}$'
    or (prior_usage ->> 'turns')::integer
      >= (command_budget ->> 'maximumTurns')::integer
    or (prior_usage ->> 'inputTokens')::integer
      >= (command_budget ->> 'maximumInputTokens')::integer
    or (prior_usage ->> 'outputTokens')::integer
      >= (command_budget ->> 'maximumOutputTokens')::integer then
    raise exception using errcode = '55000', message = 'run budget is exhausted';
  end if;

  return query select
    claimed.run_id, claimed.organization_id, claimed.project_id, claimed.task_id,
    claimed.command_id, claimed.agent_id, claimed.prompt, claimed.command_type,
    claimed.requested_risk, claimed.acceptance_criteria, claimed.plan,
    claimed.connection_id, claimed.repository_id, claimed.internal_installation_id,
    claimed.external_installation_id, claimed.app_id, claimed.external_repository_id,
    claimed.repository_full_name, claimed.base_branch, claimed.base_sha,
    claimed.lease_token, claimed.lease_expires_at, claimed.attempt_number,
    claimed.cancellation_requested, claimed.logical_agent_role,
    claimed.provider, claimed.model, claimed.maximum_duration_ms,
    greatest(1, (command_budget ->> 'maximumTurns')::integer
      - (prior_usage ->> 'turns')::integer),
    greatest(1, (command_budget ->> 'maximumInputTokens')::integer
      - (prior_usage ->> 'inputTokens')::integer),
    greatest(1, (command_budget ->> 'maximumOutputTokens')::integer
      - (prior_usage ->> 'outputTokens')::integer),
    claimed.maximum_repair_attempts, claimed.ci_timeout_ms,
    claimed.owner_approval_id, claimed.owner_approval_expires_at,
    claimed.recovery_head_branch, claimed.recovery_head_sha,
    claimed.recovery_pull_request_number, claimed.recovery_pull_request_url,
    claimed.recovery_provider_run_reference, prior_usage;
end;
$function$;

revoke all on function public.claim_phase1c_run_target_budget_internal(
  text, text, text, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_budget_internal(
  text, text, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_target_internal(
  text, text, text, integer, uuid
) from public, anon, authenticated, service_role;


create or replace function public.claim_planned_graph_by_id_v2(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_target_graph_id uuid,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  claimed jsonb;
  project_production_url text;
begin
  if p_target_graph_id is null then
    raise exception using errcode = '22023',
      message = 'an exact target graph id is required';
  end if;

  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '0A000',
      message = 'graph worker protocol version 2 is required';
  end if;

  claimed := public.claim_planned_graph_target_internal(
    p_worker_id,
    p_supported_executors,
    p_repository_full_name,
    p_required_check_names,
    p_target_graph_id
  );
  if claimed is null then
    return null;
  end if;
  if coalesce(claimed ->> 'graph_id', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (claimed ->> 'graph_id')::uuid is distinct from p_target_graph_id
  then
    -- The selector already filters by UUID; keep this independent projection
    -- assertion so a future refactor cannot silently weaken the boundary.
    raise exception using errcode = '55000',
      message = 'targeted graph claim selected a different graph';
  end if;

  select project.production_url
    into project_production_url
  from public.graphs graph
  join public.projects project
    on project.id = graph.project_id
   and project.organization_id = graph.organization_id
  where graph.id = p_target_graph_id
    and graph.organization_id = (claimed ->> 'organization_id')::uuid
    and project.id = (claimed ->> 'project_id')::uuid;
  if not found then
    raise exception using errcode = '55000',
      message = 'targeted graph claim lost its exact project identity';
  end if;

  -- A GitHub/Vercel deployment environment URL may be protected. The public
  -- project URL is a distinct identity used for read-only health validation;
  -- never replace or infer the recorded deployment URL with it.
  return claimed || pg_catalog.jsonb_build_object(
    'project_production_url', project_production_url
  );
end;
$function$;

revoke all on function public.claim_planned_graph_by_id_v2(
  text, text[], text, jsonb, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_planned_graph_by_id_v2(
  text, text[], text, jsonb, uuid, integer
) to service_role;

create or replace function public.claim_phase1c_run_by_command_v2(
  p_worker_id text,
  p_provider text,
  p_model text,
  p_lease_seconds integer,
  p_target_command_id uuid,
  p_protocol_version integer
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
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_target_command_id is null then
    raise exception using errcode = '22023',
      message = 'an exact target command id is required';
  end if;
  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '0A000',
      message = 'Phase 1C worker protocol version 2 is required';
  end if;

  return query
  select claimed.*
  from public.claim_phase1c_run_target_internal(
    p_worker_id,
    p_provider,
    p_model,
    p_lease_seconds,
    p_target_command_id
  ) claimed
  where public.assert_phase1c_claim_target(
    claimed.command_id,
    p_target_command_id
  );
  -- The authoritative selector can terminalize an exhausted/stale exact
  -- target before returning no row. A normal empty result commits that cleanup;
  -- raising here would roll it back and leave the same target stuck forever.
  -- Because the selector filters by p_target_command_id before locking, an
  -- empty target poll still cannot claim a neighboring queue item.
  return;
end;
$function$;

revoke all on function public.claim_phase1c_run_by_command_v2(
  text, text, text, integer, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_phase1c_run_by_command_v2(
  text, text, text, integer, uuid, integer
) to service_role;

comment on function public.claim_planned_graph_by_id_v2(
  text, text[], text, jsonb, uuid, integer
) is
  'Service-role graph claim that commits only when the established protocol-v2 claim selected the exact dispatched graph; also projects the distinct project production URL.';
comment on function public.claim_phase1c_run_by_command_v2(
  text, text, text, integer, uuid, integer
) is
  'Service-role Phase 1C claim that commits only when the established protocol-v2 claim selected the exact dispatched command.';

do $postflight$
declare
  routine_oid oid;
  routine_signature text;
begin
  foreach routine_signature in array array[
    'public.claim_planned_graph_target_internal(text,text[],text,jsonb,uuid)',
    'public.claim_planned_graph_internal(text,text[],text,jsonb)',
    'public.claim_phase1c_run_target_budget_internal(text,text,text,integer,uuid)',
    'public.claim_phase1c_run_budget_internal(text,text,text,integer)',
    'public.claim_phase1c_run_target_internal(text,text,text,integer,uuid)',
    'public.claim_phase1c_run(text,text,text,integer)'
  ]::text[] loop
    routine_oid := pg_catalog.to_regprocedure(routine_signature);
    if routine_oid is null or not exists (
      select 1
      from pg_catalog.pg_proc routine
      where routine.oid = routine_oid
        and routine.prosecdef
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
    ) or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
    then
      raise exception using errcode = '42501',
        message = pg_catalog.format(
          'private target/global claim metadata or ACL postflight failed: %s',
          routine_signature
        );
    end if;
  end loop;

  routine_oid := pg_catalog.to_regprocedure(
    'public.assert_phase1c_claim_target(uuid,uuid)'
  );
  if routine_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc routine
    where routine.oid = routine_oid
      and not routine.prosecdef
      and routine.provolatile = 'i'
      and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
  ) or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
  then
    raise exception using errcode = '42501',
      message = 'target claim assertion metadata or ACL postflight failed';
  end if;

  foreach routine_signature in array array[
    'public.claim_planned_graph_by_id_v2(text,text[],text,jsonb,uuid,integer)',
    'public.claim_phase1c_run_by_command_v2(text,text,text,integer,uuid,integer)',
    'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)',
    'public.claim_phase1c_run_v2(text,text,text,integer,integer)'
  ]::text[] loop
    routine_oid := pg_catalog.to_regprocedure(routine_signature);
    if routine_oid is null or not exists (
      select 1
      from pg_catalog.pg_proc routine
      where routine.oid = routine_oid
        and routine.prosecdef
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
    ) or not pg_catalog.has_function_privilege('service_role', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE')
    then
      raise exception using errcode = '42501',
        message = pg_catalog.format(
          'service-role target/global claim metadata or ACL postflight failed: %s',
          routine_signature
        );
    end if;
  end loop;
end;
$postflight$;
