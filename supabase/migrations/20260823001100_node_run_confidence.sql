-- ---------------------------------------------------------------------------
-- Let the worker record how confident a node was in what it produced.
--
-- `node_runs.confidence` has existed since 20260821000200 and
-- `list_graph_runs` has projected it since 20260823000900. Nothing has ever
-- written to it, so the console reads null for every node of every run — a
-- column and a projection with no producer, which is the same shape of dead
-- surface the stage column was in before it was backfilled.
--
-- ## Where the number comes from, and what it is not
--
-- Every advisory provider run returns `ProviderStructuredResult`, which
-- carries the model's own `confidence` as one of exactly three bands: low,
-- medium, high (`lib/providers/contract.ts`). This column is
-- `numeric(4, 3)` bounded to [0, 1], so the bands are stored as three fixed
-- points — 0.250, 0.500, 0.750 — and nothing else is ever written.
--
-- That mapping is deliberate and worth stating, because a number between 0 and
-- 1 reads like a probability and this one is not. Only three values ever
-- appear, the mapping is exactly invertible, and 0.500 means the model said
-- "medium" rather than that anything was measured at fifty percent. The
-- endpoints are unused on purpose: a model that has not been calibrated
-- against outcomes should not be recorded as certain or as knowing nothing.
--
-- A node whose executor reports no confidence stores null. DETERMINISTIC and
-- ANCHOR nodes do not produce one — a file that was read either was or was
-- not — and inventing a value for them so the column looks full is the
-- failure this comment exists to prevent.
--
-- ## Why the function is dropped rather than replaced
--
-- `create or replace` cannot change a signature. Adding `p_confidence` to the
-- existing seven-argument function would create a second overload beside it,
-- and PostgREST resolving between two overloads that differ only by a trailing
-- default is exactly the ambiguity 20260819001000 dropped
-- `claim_planned_graph(text)` to avoid. The full argument list is dropped
-- first, and the grants are restated because a drop takes them with it.
--
-- Forward-only and replay-safe: `drop function if exists` with the full
-- argument list, then `create`, then the grants.
-- ---------------------------------------------------------------------------

drop function if exists public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer
);

create function public.record_node_state_as_worker(
  p_worker_id text,
  p_node_run_id uuid,
  p_state public.graph_node_state,
  p_detail text default null,
  p_provider text default null,
  p_model text default null,
  p_latency_ms integer default null,
  p_confidence numeric default null
)
returns public.node_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.node_runs;
  v_current public.graph_node_state;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  select * into v_run from public.node_runs where id = p_node_run_id;
  if v_run.id is null then
    raise exception 'node_run_not_found' using errcode = 'P0002';
  end if;

  v_current := v_run.state;
  if v_current in ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED') then
    raise exception 'node_already_terminal' using errcode = '22023';
  end if;

  -- Refused rather than clamped. A caller sending 1.4 has a bug, and silently
  -- storing 1.0 for it would leave the column looking like a measurement
  -- while the code that produced it stays wrong. The table's own CHECK would
  -- catch this too; raising here names the argument instead of the column.
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'confidence_out_of_range' using errcode = '22003';
  end if;

  update public.node_runs
     set state = p_state,
         provider = coalesce(p_provider, provider),
         model = coalesce(p_model, model),
         latency_ms = coalesce(p_latency_ms, latency_ms),
         -- coalesce, not assignment: a node reports its confidence once, on the
         -- transition that carries its output. Later transitions on the same
         -- run — a gate opening, a verification — pass null and must not erase
         -- it.
         confidence = coalesce(p_confidence, confidence),
         blocked_reason = case when p_state = 'BLOCKED' then p_detail else blocked_reason end,
         error_message = case when p_state = 'FAILED' then p_detail else error_message end,
         started_at = case when p_state = 'RUNNING' and started_at is null then now() else started_at end,
         completed_at = case
           when p_state in ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED') then now()
           else completed_at
         end,
         updated_at = now()
   where id = p_node_run_id
  returning * into v_run;

  insert into public.graph_events (
    organization_id, graph_run_id, node_run_id, event_type, detail
  )
  values (
    v_run.organization_id, v_run.graph_run_id, v_run.id,
    'node_' || lower(p_state::text),
    coalesce(p_detail, format('worker %s', p_worker_id))
  );

  return v_run;
end;
$$;

revoke all on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer, numeric
) from public, anon, authenticated;
grant execute on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer, numeric
) to service_role;
