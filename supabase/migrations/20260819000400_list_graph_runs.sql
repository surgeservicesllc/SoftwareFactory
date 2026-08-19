-- Graph runs become visible to the people who planned them.
--
-- The worker executes graphs and persists every transition, but nothing in
-- the console read graph_runs, node_runs, or graph_artifacts — results
-- landed in tables no human saw. This adds the member-facing read, in the
-- same shape as the other safe list functions: one definer function,
-- membership-checked, granted to authenticated only.
--
-- It also widens node_runs' provider check to admit 'deterministic': the
-- worker now runs reduce nodes through the engine's own reducers, and the
-- honest attribution for those rows is neither anthropic nor openai. The
-- drop-and-add pair is replay-safe.

alter table public.node_runs drop constraint if exists node_runs_provider_check;
alter table public.node_runs add constraint node_runs_provider_check
  check (provider is null or provider in ('anthropic', 'openai', 'deterministic'));

create or replace function public.list_graph_runs(
  p_organization_id uuid,
  p_limit integer default 20
)
returns table (
  graph_run_id uuid,
  graph_id uuid,
  goal text,
  topology text,
  risk_level text,
  project_id uuid,
  state text,
  had_partial_input boolean,
  started_at timestamptz,
  completed_at timestamptz,
  nodes jsonb,
  artifact_counts jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select
    r.id,
    g.id,
    g.goal,
    g.topology::text,
    g.risk_level::text,
    g.project_id,
    r.state::text,
    r.had_partial_input,
    r.started_at,
    r.completed_at,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'node_key', n.node_key,
        'executor', n.executor::text,
        'capability', n.capability,
        'state', nr.state::text,
        'provider', nr.provider,
        'model', nr.model,
        'latency_ms', nr.latency_ms,
        'error_message', nr.error_message
      ) order by n.node_key), '[]'::jsonb)
        from public.node_runs nr
        join public.graph_nodes n on n.id = nr.node_id
       where nr.graph_run_id = r.id
    ),
    (
      select coalesce(jsonb_object_agg(counts.kind, counts.total), '{}'::jsonb)
        from (
          select a.kind::text as kind, count(*)::int as total
            from public.graph_artifacts a
           where a.graph_run_id = r.id
           group by a.kind
        ) counts
    )
  from public.graph_runs r
  join public.graphs g on g.id = r.graph_id
  where r.organization_id = p_organization_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

revoke all on function public.list_graph_runs(uuid, integer) from public, anon, service_role;
grant execute on function public.list_graph_runs(uuid, integer) to authenticated;
