-- Stop, made real for graphs (task #61 increment: run controls).
--
-- A graph had no way to be stopped: claimability is derived from run
-- history, so a planned or re-claimable graph stayed in the queue until a
-- worker spent it. Owners asked for Stop; the honest semantics are
-- WITHDRAWAL - a member marks the graph withdrawn, every future claim
-- skips it, and nothing pretends to interrupt a live worker (a RUNNING
-- claim is refused here; the worker's own budget and abort paths stop
-- live work). The claim selector below is the 20260828000200 definition
-- verbatim plus exactly one predicate: `and g.withdrawn_at is null`.

alter table public.graphs
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references auth.users(id) on delete set null,
  add column if not exists withdrawal_reason text
    check (withdrawal_reason is null or char_length(btrim(withdrawal_reason)) between 1 and 500);
alter table public.graphs
  add constraint graphs_withdrawal_pair check ((withdrawn_at is null) = (withdrawn_by is null));

alter type public.activity_event_type add value if not exists 'graph.withdrawn';

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
     and g.withdrawn_at is null
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


-- ---------------------------------------------------------------------------
-- withdraw_graph_as_member: the Stop control.
--
-- Idempotent on an already-withdrawn graph (the second click is agreement,
-- not an error). Refuses while a run is RUNNING: a live claim belongs to its
-- worker, and pretending to stop it would be a dead button wearing a label.
-- Every withdrawal is an immutable activity event.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_graph_as_member(
  p_organization_id uuid,
  p_graph_id uuid,
  p_reason text default null
)
returns public.graphs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph public.graphs;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception 'Only a member of the owning organization can withdraw a graph.'
      using errcode = '42501';
  end if;
  if v_reason is not null and pg_catalog.char_length(v_reason) > 500 then
    raise exception 'A withdrawal reason is at most 500 characters.'
      using errcode = '22000';
  end if;
  if public.text_has_likely_secret(v_reason) then
    raise exception 'The withdrawal reason contains secret-shaped material.'
      using errcode = '22023';
  end if;

  select * into v_graph
    from public.graphs g
   where g.id = p_graph_id and g.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph_not_found';
  end if;
  if v_graph.withdrawn_at is not null then
    return v_graph;
  end if;
  if exists (
    select 1 from public.graph_runs r
     where r.graph_id = v_graph.id and r.state = 'RUNNING'::public.graph_run_state
  ) then
    raise exception using errcode = '55000', message = 'graph_run_in_flight';
  end if;

  update public.graphs
     set withdrawn_at = pg_catalog.now(),
         withdrawn_by = auth.uid(),
         withdrawal_reason = v_reason,
         updated_at = pg_catalog.now()
   where id = v_graph.id
   returning * into v_graph;

  insert into public.activity_events
    (organization_id, project_id, actor_user_id, event_type, entity_type, entity_id,
     description, metadata)
  values
    (v_graph.organization_id, v_graph.project_id, auth.uid(), 'graph.withdrawn', 'graph',
     v_graph.id,
     pg_catalog.left('Graph withdrawn from the worker queue'
       || case when v_reason is null then '' else ': ' || v_reason end || '.', 500),
     '{}'::jsonb);

  return v_graph;
end;
$function$;

revoke all on function public.withdraw_graph_as_member(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.withdraw_graph_as_member(uuid, uuid, text) to authenticated;
