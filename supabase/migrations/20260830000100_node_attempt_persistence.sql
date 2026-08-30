-- The runner counted attempts; the database never saw them (task #56).
--
-- node_runs.attempt has existed since 20260814000100 with a default of 0
-- and a unique (graph_run_id, node_id, attempt) constraint, but no writer:
-- the worker's in-memory counter died with the process, so a resumed or
-- audited run could not say how many tries a node took. The recording
-- boundary now takes the attempt as an explicit parameter:
--
-- - an ordinary transition persists it (coalesce keeps old callers whole);
-- - RUNNING again with a HIGHER attempt is a retry - a real second start
--   that updates the counter and appends its own node_running event, where
--   before it was swallowed as a replay;
-- - a LOWER attempt is refused as a regression, and a non-positive one as
--   nonsense;
-- - an exact replay (same state, same attempt, same evidence) keeps the
--   established idempotent behavior.
--
-- The old seven-parameter signature is dropped and replaced by the
-- eight-parameter one with a NULL default, so existing positional and named
-- callers resolve unchanged. The body is otherwise the 20260827000200
-- definition verbatim. ACLs are re-stated exactly: service_role may
-- execute, nobody else.

drop function if exists public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer
);

create or replace function public.record_node_state_as_worker(
  p_worker_id text,
  p_node_run_id uuid,
  p_state public.graph_node_state,
  p_detail text default null,
  p_provider text default null,
  p_model text default null,
  p_latency_ms integer default null,
  p_attempt integer default null
)
returns public.node_runs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  peek_node_run public.node_runs%rowtype;
  node_run_record public.node_runs%rowtype;
  graph_run_record public.graph_runs%rowtype;
  node_capability text;
  node_executor public.graph_node_executor;
  normalized_detail text := coalesce(
    p_detail,
    pg_catalog.format('worker %s', p_worker_id)
      || case
           when p_attempt is not null and p_attempt > 1
             then pg_catalog.format(' attempt %s', p_attempt)
           else ''
         end
  );
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_state is null or p_state in (
    'PENDING'::public.graph_node_state,
    'READY'::public.graph_node_state,
    'BLOCKED'::public.graph_node_state
  ) then
    raise exception using errcode = '22023',
      message = 'worker_node_state_target_forbidden';
  end if;
  if public.text_has_likely_secret(p_detail) then
    raise exception using errcode = '22023',
      message = 'node transition detail contains secret-shaped material';
  end if;
  select * into peek_node_run from public.node_runs where id = p_node_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'node_run_not_found';
  end if;

  select * into graph_run_record
  from public.graph_runs run
  where run.id = peek_node_run.graph_run_id
    and run.organization_id = peek_node_run.organization_id
  for update;
  if not found or graph_run_record.state <> 'RUNNING'::public.graph_run_state then
    raise exception using errcode = '55000', message = 'parent_graph_run_not_running';
  end if;

  select * into node_run_record
  from public.node_runs node_run
  where node_run.id = p_node_run_id
    and node_run.graph_run_id = graph_run_record.id
    and node_run.organization_id = graph_run_record.organization_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'node_run_identity_changed';
  end if;

  select node.capability, node.executor into node_capability, node_executor
  from public.graph_nodes node
  where node.id = node_run_record.node_id
    and node.organization_id = node_run_record.organization_id
    and node.graph_id = graph_run_record.graph_id;
  if not found then
    raise exception using errcode = '55000', message = 'graph_node_identity_changed';
  end if;
  if p_state = 'COMPLETED'::public.graph_node_state
    and node_capability in ('review', 'security_review', 'qa')
    and node_executor = 'MODEL'::public.graph_node_executor
  then
    raise exception using errcode = '55000',
      message = 'reviewer_completion_requires_atomic_verifications';
  end if;

  -- A transport can lose the response after the transaction commits. An
  -- exact replay returns the durable row and does not append a second event;
  -- any changed evidence is a conflicting rewrite, including on terminal
  -- states. This also prevents timestamp regression on retries.
  if p_attempt is not null and p_attempt < 1 then
    raise exception using errcode = '22023', message = 'node_attempt_must_be_positive';
  end if;
  if p_attempt is not null and p_attempt < node_run_record.attempt then
    -- An attempt counter never runs backwards; a lower number is a stale or
    -- forged report, not a replay.
    raise exception using errcode = '22023', message = 'node_attempt_regression';
  end if;

  -- A retry is a real second start, not a replay: RUNNING again with a
  -- higher attempt records the counter and appends its own event.
  if node_run_record.state = 'RUNNING'::public.graph_node_state
    and p_state = 'RUNNING'::public.graph_node_state
    and p_attempt is not null
    and p_attempt > node_run_record.attempt
  then
    update public.node_runs
    set attempt = p_attempt,
        updated_at = pg_catalog.now()
    where id = node_run_record.id
    returning * into node_run_record;
    insert into public.graph_events (
      organization_id, graph_run_id, node_run_id, event_type, detail
    ) values (
      node_run_record.organization_id,
      node_run_record.graph_run_id,
      node_run_record.id,
      'node_running',
      normalized_detail
    );
    return node_run_record;
  end if;

  if node_run_record.state = p_state then
    if (p_provider is not null and p_provider is distinct from node_run_record.provider)
      or (p_model is not null and p_model is distinct from node_run_record.model)
      or (p_latency_ms is not null and p_latency_ms is distinct from node_run_record.latency_ms)
      or (p_state = 'RUNNING'::public.graph_node_state and node_run_record.started_at is null)
      or (
        p_state in (
          'COMPLETED'::public.graph_node_state,
          'FAILED'::public.graph_node_state,
          'CANCELLED'::public.graph_node_state,
          'SKIPPED'::public.graph_node_state
        )
        and node_run_record.completed_at is null
      )
      or not exists (
        select 1
        from public.graph_events event
        where event.organization_id = node_run_record.organization_id
          and event.graph_run_id = node_run_record.graph_run_id
          and event.node_run_id = node_run_record.id
          and event.event_type = 'node_' || pg_catalog.lower(p_state::text)
          and event.detail is not distinct from normalized_detail
      )
    then
      raise exception using errcode = '22023', message = 'node_state_replay_mismatch';
    end if;
    return node_run_record;
  end if;

  if not (
    (
      node_run_record.state in (
        'PENDING'::public.graph_node_state,
        'READY'::public.graph_node_state,
        'BLOCKED'::public.graph_node_state
      )
      and p_state in (
        'RUNNING'::public.graph_node_state,
        'SKIPPED'::public.graph_node_state
      )
    )
    or (
      node_run_record.state = 'RUNNING'::public.graph_node_state
      and p_state in (
        'VERIFYING'::public.graph_node_state,
        'COMPLETED'::public.graph_node_state,
        'FAILED'::public.graph_node_state,
        'CANCELLED'::public.graph_node_state,
        'SKIPPED'::public.graph_node_state
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_worker_node_state_transition';
  end if;

  update public.node_runs
  set state = p_state,
      attempt = coalesce(p_attempt, attempt),
      provider = coalesce(p_provider, provider),
      model = coalesce(p_model, model),
      latency_ms = coalesce(p_latency_ms, latency_ms),
      error_message = case when p_state = 'FAILED' then p_detail else error_message end,
      started_at = case
        when p_state = 'RUNNING' and started_at is null then pg_catalog.now()
        else started_at
      end,
      completed_at = case
        when p_state in ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED')
          then coalesce(completed_at, pg_catalog.now())
        else completed_at
      end,
      updated_at = pg_catalog.now()
  where id = node_run_record.id
  returning * into node_run_record;

  update public.graph_runs
  set updated_at = pg_catalog.now()
  where id = graph_run_record.id
    and state = 'RUNNING'::public.graph_run_state;

  insert into public.graph_events (
    organization_id, graph_run_id, node_run_id, event_type, detail
  ) values (
    node_run_record.organization_id,
    node_run_record.graph_run_id,
    node_run_record.id,
    'node_' || pg_catalog.lower(p_state::text),
    normalized_detail
  );
  return node_run_record;
end;
$function$;

revoke all on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.record_node_state_as_worker(
  text, uuid, public.graph_node_state, text, text, text, integer, integer
) to service_role;

