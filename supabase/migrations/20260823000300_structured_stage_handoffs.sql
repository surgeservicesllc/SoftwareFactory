-- ---------------------------------------------------------------------------
-- The handoff a stage makes to the next one, written down.
--
-- `graph_handoffs` has existed since 20260814000100 and nothing has ever
-- written to it. The worker passes a completed node's output along its edges
-- in memory and that is all: the receiving node gets the bytes, and the fact
-- that a handoff happened — whether the payload satisfied the receiver's
-- contract, what was assumed, what was left blocked — exists only for as long
-- as the process does.
--
-- That is exactly the state a resumable engine cannot be in. A run reclaimed
-- after a restart can reconstruct every node's status from `node_runs` and
-- every output from `graph_artifacts`, and still cannot say whether the
-- architecture package BUILD received was the one ARCHITECT meant to send.
--
-- ## Why the validity is stored rather than recomputed
--
-- `contract_valid` is decided against the *receiving* node's contract at the
-- moment of the handoff, and the column exists so that decision survives. A
-- reader recomputing it later would be checking today's contract against
-- yesterday's payload — which is a different question, and one whose answer
-- changes when a schema is edited, silently rewriting history.
--
-- ## Why it is a worker function and not a table grant
--
-- The same reason every other write here is: `graph_handoffs` grants nothing
-- to anon or authenticated, and the worker reaches it only through a SECURITY
-- DEFINER function that proves its identity first. A table grant would let
-- anything holding the service key fabricate a handoff, and a fabricated
-- handoff is a fabricated provenance record.
--
-- Forward-only and replay-safe: one `create or replace function`, its grants
-- restated, and one index guarded by `if not exists`.
-- ---------------------------------------------------------------------------

create index if not exists graph_handoffs_run_idx
  on public.graph_handoffs (graph_run_id, created_at desc);

create index if not exists graph_handoffs_to_node_idx
  on public.graph_handoffs (to_node_id, created_at desc);

create or replace function public.record_graph_handoff_as_worker(
  p_worker_id text,
  p_graph_run_id uuid,
  p_to_node_id uuid,
  p_contract_valid boolean,
  p_payload jsonb,
  p_from_node_run_id uuid default null,
  p_validation_issues jsonb default '[]'::jsonb,
  p_decisions jsonb default '[]'::jsonb,
  p_assumptions jsonb default '[]'::jsonb,
  p_blockers jsonb default '[]'::jsonb,
  p_next_action text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_node_organization_id uuid;
  v_handoff_id uuid;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  select organization_id into v_organization_id
    from public.graph_runs where id = p_graph_run_id;
  if v_organization_id is null then
    raise exception 'graph_run_not_found' using errcode = 'P0002';
  end if;

  -- The receiving node has to belong to the same tenant as the run. The
  -- composite foreign key would catch a mismatch on insert, but it would catch
  -- it as a constraint violation naming two columns rather than as the thing
  -- it actually is: a handoff addressed across a tenant boundary.
  select organization_id into v_node_organization_id
    from public.graph_nodes where id = p_to_node_id;
  if v_node_organization_id is null then
    raise exception 'graph_node_not_found' using errcode = 'P0002';
  end if;
  if v_node_organization_id <> v_organization_id then
    raise exception 'handoff_crosses_organizations' using errcode = '42501';
  end if;

  insert into public.graph_handoffs (
    organization_id, graph_run_id, from_node_run_id, to_node_id,
    contract_valid, validation_issues, payload,
    decisions, assumptions, blockers, next_action
  )
  values (
    v_organization_id, p_graph_run_id, p_from_node_run_id, p_to_node_id,
    p_contract_valid,
    coalesce(p_validation_issues, '[]'::jsonb),
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_decisions, '[]'::jsonb),
    coalesce(p_assumptions, '[]'::jsonb),
    coalesce(p_blockers, '[]'::jsonb),
    p_next_action
  )
  returning id into v_handoff_id;

  return v_handoff_id;
end;
$$;

revoke all on function public.record_graph_handoff_as_worker(
  text, uuid, uuid, boolean, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.record_graph_handoff_as_worker(
  text, uuid, uuid, boolean, jsonb, uuid, jsonb, jsonb, jsonb, jsonb, text
) to service_role;
