-- A gate approval survives runs that answered nothing.
--
-- Live lifecycle d7241cf4 stranded on the exact sequence this migration
-- repairs: its run halted at the ARCHITECTURE human gate (PARTIAL), the owner
-- approved the gate, the next claim's run was voided by a provider session
-- limit (CANCELLED, per 20260823-000900's void rule) — and the reopen rule
-- then read the approval as stale because the void's completed_at was newer
-- than decided_at. The claim compared the approval against the last RUN;
-- it must compare against the last ANSWER. FAILED and CANCELLED runs answer
-- nothing (that is why they leave the graph claimable everywhere else in
-- this function), so they are now excluded from the freshness watermark.
--
-- Replaces 20260821000200's claim_planned_graph verbatim except for that one
-- clause. The TypeScript queue diagnosis (lib/worker/queue-diagnosis.ts)
-- mirrors the same change in the same commit.

create or replace function public.claim_planned_graph(
  p_worker_id text,
  p_supported_executors text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_graph public.graphs;
  v_run_id uuid;
  v_stale record;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  if p_supported_executors is null or array_length(p_supported_executors, 1) is null then
    raise exception using
      errcode = '22023',
      message = 'a worker must declare at least one executor it can run';
  end if;

  -- Reclaim abandonment first; unchanged from 20260819000100. A worker that
  -- died mid-run leaves its run RUNNING forever, and an in-flight run keeps its
  -- graph out of the queue — a permanent, silent loss.
  for v_stale in
    select r.id, r.organization_id
      from public.graph_runs r
     where r.state = 'RUNNING'
       and r.updated_at < now() - interval '2 hours'
       and not exists (
         select 1 from public.node_runs nr
          where nr.graph_run_id = r.id
            and nr.updated_at >= now() - interval '2 hours'
       )
  loop
    update public.graph_runs
       set state = 'FAILED', completed_at = now(), updated_at = now()
     where id = v_stale.id and state = 'RUNNING';
    if not found then
      continue;
    end if;

    update public.node_runs
       set state = 'CANCELLED',
           blocked_reason = 'The worker running this graph stopped reporting; the run was reclaimed.',
           completed_at = now(),
           updated_at = now()
     where graph_run_id = v_stale.id
       and state in ('PENDING', 'READY', 'RUNNING', 'VERIFYING', 'BLOCKED');

    insert into public.graph_events (organization_id, graph_run_id, event_type, detail)
    values (
      v_stale.organization_id, v_stale.id, 'run_failed',
      format('Reclaimed by worker %s: the run had been silent for over two hours and its worker is presumed dead.', p_worker_id)
    );
  end loop;

  -- Claimable: never run, or every previous run FAILED or CANCELLED; under
  -- three genuine failures and ten total runs; and — new here — every node's
  -- executor is one this worker actually provides.
  select g.* into v_graph
    from public.graphs g
   where g.requires_owner_approval = false
     and (
       -- The original rule: never run, or every previous run FAILED/CANCELLED.
       not exists (
         select 1 from public.graph_runs r
          where r.graph_id = g.id and r.state not in ('FAILED', 'CANCELLED')
       )
       /*
        * Or: a lifecycle that stopped at a gate, and the gate has since been
        * decided.
        *
        * Without this a lifecycle stops at its first gate forever. The rule
        * above is right for every other graph — PARTIAL is an answer, not an
        * infrastructure fault, so the graph leaves the queue — but a run that
        * halted to ask a person is a question, and an approval is the answer
        * arriving. Nothing is in flight, and the decision is information the
        * last run did not have.
        */
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
              /*
               * The watermark is the last ANSWER, not the last run. A run
               * CANCELLED by withheld capacity (or FAILED by infrastructure)
               * answered nothing, so it must not stale the approval that was
               * meant to reopen the halted lifecycle. Live graph d7241cf4
               * proved the gap: architecture approved, the next run voided on
               * a session limit, and the approval was consumed by the void —
               * the lifecycle stranded with its question answered.
               */
              and gate.decided_at > coalesce(
                (select max(r.completed_at) from public.graph_runs r
                  where r.graph_id = g.id
                    and r.state not in ('FAILED', 'CANCELLED')),
                gate.opened_at
              )
         )
       )
     )
     and (select count(*) from public.graph_runs r
           where r.graph_id = g.id and r.state = 'FAILED') < 3
     and (select count(*) from public.graph_runs r where r.graph_id = g.id) < 10
     and not exists (
       select 1 from public.graph_nodes n
        where n.graph_id = g.id
          and n.executor::text <> all (p_supported_executors)
     )
   order by g.created_at
   for update skip locked
   limit 1;

  if v_graph.id is null then
    return null;
  end if;

  insert into public.graph_runs (organization_id, graph_id, state, started_at, created_by)
  values (v_graph.organization_id, v_graph.id, 'RUNNING', now(), v_graph.created_by)
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

  return jsonb_build_object(
    'graph_run_id', v_run_id,
    'graph_id', v_graph.id,
    'organization_id', v_graph.organization_id,
    'project_id', v_graph.project_id,
    'goal', v_graph.goal,
    'topology', v_graph.topology,
    'risk_level', v_graph.risk_level,
    'is_lifecycle', v_graph.is_lifecycle,
    'iteration', v_graph.iteration,
    'max_iterations', v_graph.max_iterations,
    'project_repository', (
      select p.github_repository
        from public.projects p
       where p.id = v_graph.project_id
         and p.organization_id = v_graph.organization_id
    ),
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
        -- `node_id` as well as `node_run_id`: a gate is keyed to the graph
        -- node, because the run id changes on every claim and the node id does
        -- not. That is what lets an approval outlive the run that asked for it.
        'node_id', n.id,
        'lifecycle_stage', n.lifecycle_stage,
        'gate_kind', n.gate_kind,
        -- Null when no gate has ever been opened on this node. The worker reads
        -- it to tell "stop here and ask" from "a person already said yes".
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
         -- Feedback edges point backwards. The compiler rejects every cycle and
         -- is right to, so a lifecycle whose feedback edges reached it would
         -- fail to compile and never run at all.
         and e.is_feedback = false
    )
  );
end;
$$;


revoke all on function public.claim_planned_graph(text, text[]) from public, anon, authenticated;
grant execute on function public.claim_planned_graph(text, text[]) to service_role;

-- Postflight: the deployed body must carry the answer-scoped watermark.
do $postflight$
declare
  v_body text;
begin
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_planned_graph';
  if v_body not like '%not in (''FAILED'', ''CANCELLED'')%' then
    raise exception 'claim_planned_graph does not scope the approval watermark to answering runs';
  end if;
end
$postflight$;
