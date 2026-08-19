-- Show the verdicts, not just store them.
--
-- 20260819000700 made a reviewing node's judgement durable and auditable.
-- Auditable by whom, though: nothing read it. The member-facing run list
-- returned node states and artifact counts and said nothing about whether
-- anything had been verified, so the rows existed and no surface admitted
-- it. Evidence nobody can see is evidence nobody acts on.
--
-- Same shape as before: definer, membership-checked, authenticated only.
-- Verdicts travel with the subject node they judge, because "REJECT" alone
-- is a mood and "REJECT, of the config inspection, citing an unbounded
-- query" is a finding.

-- A `returns table` gains a column only by being dropped first: Postgres
-- refuses to change an existing function's return type in place. The drop is
-- guarded and the grants are reissued below, so replaying this file — which
-- the hosted apply does deliberately — is a no-op either way.
drop function if exists public.list_graph_runs(uuid, integer);

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
  artifact_counts jsonb,
  verifications jsonb
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
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'subject_node_key', n.node_key,
        'lens', v.lens::text,
        'verdict', v.verdict::text,
        'evidence', v.evidence,
        'verifier_provider', v.verifier_provider,
        -- Recorded, not assumed: a verifier that shared the subject's
        -- context is a weaker verification, and hiding that would make
        -- every row here look equally strong.
        'shared_worker_context', v.shared_worker_context
      ) order by n.node_key), '[]'::jsonb)
        from public.graph_verifications v
        join public.node_runs nr on nr.id = v.subject_node_run_id
        join public.graph_nodes n on n.id = nr.node_id
       where v.graph_run_id = r.id
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
