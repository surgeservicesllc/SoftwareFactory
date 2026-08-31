-- Queue-diagnosis honesty: withdrawal and pause become visible reasons.
--
-- diagnose_graph_queue_as_worker_v2 (20260827000200) predates
-- 20260830000200 (withdraw) and 20260830000400 (pause), whose claim
-- predicates exclude such graphs. The diagnostic projection did not carry
-- either timestamp, so a withdrawn or paused graph was reported as "looks
-- claimable -- an empty claim contradicts this listing". The contradiction
-- line was the honest cover, not a wrong claim -- but the whole point of
-- the diagnosis is to name WHICH filter excluded the graph somebody is
-- watching, and these two filters were nameless.
--
-- This is a read-only restatement: the function body is the 20260827000200
-- text verbatim plus two projected columns straight off public.graphs. The
-- claim path is untouched; protocol version stays 2 because nothing about
-- claiming changed. Adding OUT columns requires DROP + CREATE (CREATE OR
-- REPLACE refuses a return-type change), so the ACL is restated below --
-- worker traffic only, exactly as before.

drop function if exists public.diagnose_graph_queue_as_worker_v2(
  text, text, jsonb, uuid, integer);

create or replace function public.diagnose_graph_queue_as_worker_v2(
  p_worker_id text,
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_target_graph_id uuid,
  p_protocol_version integer
)
returns table (
  id uuid,
  requires_owner_approval boolean,
  is_lifecycle boolean,
  created_at timestamptz,
  withdrawn_at timestamptz,
  pause_requested_at timestamptz,
  repository_scope_matches boolean,
  required_check_policy_matches boolean,
  phase1c_resume_ready boolean,
  graph_nodes jsonb,
  graph_runs jsonb,
  graph_gates jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_protocol_version is distinct from 2 then
    raise exception using errcode = '22023',
      message = 'graph queue diagnosis protocol version 2 is required';
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

  return query
  select
    graph.id,
    graph.requires_owner_approval,
    graph.is_lifecycle,
    graph.created_at,
    graph.withdrawn_at,
    graph.pause_requested_at,
    exists (
      select 1
      from public.projects project
      join public.project_connections link
        on link.project_id = project.id
       and link.organization_id = project.organization_id
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
      where project.id = graph.project_id
        and project.organization_id = graph.organization_id
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
        and (graph.github_repository_id is null
          or graph.github_repository_id = repository.id)
    ),
    (
      graph.template_key is distinct from 'full_lifecycle'
      or graph.template_version is distinct from 2
      or graph.required_check_names = p_required_check_names
    ),
    (
      not graph.is_lifecycle
      or graph.template_key is distinct from 'full_lifecycle'
      or graph.template_version is distinct from 2
      or not exists (
        select 1
        from public.graph_gates architecture_gate
        where architecture_gate.graph_id = graph.id
          and architecture_gate.organization_id = graph.organization_id
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
          where prior.graph_id = graph.id
            and prior.organization_id = graph.organization_id
            and prior.state not in ('FAILED', 'CANCELLED')
            and prior.completed_at is not null
          order by prior.completed_at desc, prior.id desc
          limit 1
        )
          and public.graph_phase1c_bridge_state_rank(bridge.state) >=
            public.graph_phase1c_bridge_state_rank('PULL_REQUEST_RECORDED')
      )
    ),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('executor', node.executor)
        order by node.node_key, node.id
      )
      from public.graph_nodes node
      where node.graph_id = graph.id
        and node.organization_id = graph.organization_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'state', run.state,
          'completed_at', run.completed_at
        ) order by run.created_at, run.id
      )
      from public.graph_runs run
      where run.graph_id = graph.id
        and run.organization_id = graph.organization_id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'state', gate.state,
          'opened_at', gate.opened_at,
          'decided_at', gate.decided_at
        ) order by gate.opened_at, gate.id
      )
      from public.graph_gates gate
      where gate.graph_id = graph.id
        and gate.organization_id = graph.organization_id
    ), '[]'::jsonb)
  from public.graphs graph
  where (p_target_graph_id is null or graph.id = p_target_graph_id)
    and exists (
      select 1
      from public.projects project
      join public.project_connections link
        on link.project_id = project.id
       and link.organization_id = project.organization_id
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
      where project.id = graph.project_id
        and project.organization_id = graph.organization_id
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
        and (graph.github_repository_id is null
          or graph.github_repository_id = repository.id)
    )
  order by graph.created_at desc, graph.id desc
  limit 50;
end;
$function$;

revoke all on function public.diagnose_graph_queue_as_worker_v2(
  text, text, jsonb, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.diagnose_graph_queue_as_worker_v2(
  text, text, jsonb, uuid, integer
) to service_role;

