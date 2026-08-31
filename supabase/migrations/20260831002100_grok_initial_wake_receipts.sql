-- Durable, truth-preserving initial Grok graph wakes.
--
-- An owner Resume commits one immutable wake intent beside the exact atomic
-- graph transition.  GitHub repository_dispatch acceptance is separate,
-- append-only transport evidence.  A worker is called woken only after it has
-- claimed the exact graph and durably acknowledged the exact intent/revision.

create table public.grok_graph_wake_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  graph_id uuid not null,
  control_intent_id uuid not null,
  control_revision bigint not null check (control_revision > 0),
  wake_revision bigint not null check (wake_revision > control_revision),
  session_version bigint not null check (session_version > 0),
  created_at timestamptz not null default pg_catalog.now(),
  constraint grok_graph_wake_intents_scope_unique
    unique (id, organization_id, project_id, session_id, graph_id),
  constraint grok_graph_wake_intents_control_unique unique (control_intent_id),
  constraint grok_graph_wake_intents_revision_unique unique (session_id, control_revision),
  constraint grok_graph_wake_intents_consecutive_revision
    check (wake_revision = control_revision + 1),
  constraint grok_graph_wake_intents_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_graph_wake_intents_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint grok_graph_wake_intents_control_fk
    foreign key (control_intent_id, organization_id, session_id)
    references public.grok_control_intents(id, organization_id, session_id) on delete restrict
);

create table public.grok_graph_wake_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  graph_id uuid not null,
  wake_intent_id uuid not null,
  control_revision bigint not null check (control_revision > 0),
  attempt_number integer not null check (attempt_number between 1 and 32),
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  outcome text not null check (outcome in ('accepted', 'failed')),
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,79}$'
  ),
  created_at timestamptz not null default pg_catalog.now(),
  constraint grok_graph_wake_dispatch_scope_unique
    unique (id, organization_id, project_id, session_id, graph_id),
  constraint grok_graph_wake_dispatch_attempt_unique
    unique (wake_intent_id, attempt_number),
  constraint grok_graph_wake_dispatch_idempotency_unique
    unique (wake_intent_id, idempotency_key),
  constraint grok_graph_wake_dispatch_outcome_shape check (
    (outcome = 'accepted' and failure_code is null)
    or (outcome = 'failed' and failure_code is not null)
  ),
  constraint grok_graph_wake_dispatch_intent_fk
    foreign key (wake_intent_id, organization_id, project_id, session_id, graph_id)
    references public.grok_graph_wake_intents(
      id, organization_id, project_id, session_id, graph_id
    ) on delete restrict
);

create table public.grok_graph_wake_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  graph_id uuid not null,
  graph_run_id uuid not null,
  wake_intent_id uuid not null,
  control_revision bigint not null check (control_revision > 0),
  worker_id text not null
    check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'),
  protocol_version integer not null check (protocol_version = 1),
  capability_version integer not null check (capability_version = 1),
  acknowledged_at timestamptz not null default pg_catalog.now(),
  constraint grok_graph_wake_receipts_scope_unique
    unique (id, organization_id, project_id, session_id, graph_id),
  constraint grok_graph_wake_receipts_intent_unique unique (wake_intent_id),
  constraint grok_graph_wake_receipts_run_unique unique (graph_run_id),
  constraint grok_graph_wake_receipts_intent_fk
    foreign key (wake_intent_id, organization_id, project_id, session_id, graph_id)
    references public.grok_graph_wake_intents(
      id, organization_id, project_id, session_id, graph_id
    ) on delete restrict,
  constraint grok_graph_wake_receipts_run_fk
    foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete restrict
);

create index grok_graph_wake_intents_graph_revision_idx
  on public.grok_graph_wake_intents (organization_id, graph_id, control_revision desc);
create index grok_graph_wake_dispatch_intent_idx
  on public.grok_graph_wake_dispatch_attempts (wake_intent_id, attempt_number);
create index grok_graph_wake_receipts_session_idx
  on public.grok_graph_wake_receipts (organization_id, session_id, acknowledged_at desc);

do $wake_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'grok_graph_wake_intents',
    'grok_graph_wake_dispatch_attempts',
    'grok_graph_wake_receipts'
  ] loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table);
    execute pg_catalog.format('alter table public.%I force row level security', v_table);
    execute pg_catalog.format(
      'create policy %I on public.%I for select to authenticated using (public.is_organization_member(organization_id))',
      v_table || '_select_member', v_table
    );
    execute pg_catalog.format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      v_table
    );
  end loop;
end;
$wake_rls$;

do $wake_immutable_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'grok_graph_wake_intents',
    'grok_graph_wake_dispatch_attempts',
    'grok_graph_wake_receipts'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_grok_evidence_mutation()',
      v_table || '_immutable', v_table
    );
    execute pg_catalog.format(
      'create trigger %I before truncate on public.%I for each statement execute function public.reject_grok_evidence_mutation()',
      v_table || '_no_truncate', v_table
    );
  end loop;
end;
$wake_immutable_triggers$;

create function public.assert_current_grok_graph_wake_intent(
  p_intent public.grok_graph_wake_intents
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_control public.grok_control_intents;
  v_graph public.graphs;
  v_session public.grok_sessions;
begin
  select control.* into v_control
    from public.grok_control_intents control
   where control.id = p_intent.control_intent_id
     and control.organization_id = p_intent.organization_id
     and control.project_id = p_intent.project_id
     and control.session_id = p_intent.session_id
     and control.target_kind = 'graph'
     and control.graph_id = p_intent.graph_id
     and control.action = 'resume'
     and control.state = 'applied';
  if not found then
    raise exception using errcode = '55000',
      message = 'grok graph wake control identity is stale';
  end if;

  if not exists (
    select 1
      from public.grok_events event
     where event.organization_id = p_intent.organization_id
       and event.project_id = p_intent.project_id
       and event.session_id = p_intent.session_id
       and event.event_type = 'control.applied'
       and event.correlation_id = p_intent.control_intent_id
       and event.sequence_no = p_intent.control_revision
  ) or not exists (
    select 1
      from public.grok_events event
     where event.organization_id = p_intent.organization_id
       and event.project_id = p_intent.project_id
       and event.session_id = p_intent.session_id
       and event.event_type = 'graph.wake_requested'
       and event.correlation_id = p_intent.id
       and event.sequence_no = p_intent.wake_revision
  ) then
    raise exception using errcode = '55000',
      message = 'grok graph wake revision evidence is stale';
  end if;

  if exists (
    select 1
      from public.grok_events later_event
      join public.grok_control_intents later_control
        on later_control.id = later_event.correlation_id
       and later_control.organization_id = later_event.organization_id
       and later_control.session_id = later_event.session_id
     where later_event.organization_id = p_intent.organization_id
       and later_event.session_id = p_intent.session_id
       and later_event.event_type = 'control.requested'
       and later_event.sequence_no > p_intent.control_revision
       and later_control.target_kind = 'graph'
       and later_control.graph_id = p_intent.graph_id
  ) then
    raise exception using errcode = '55000',
      message = 'grok graph wake was superseded by a later control';
  end if;

  select graph.* into v_graph
    from public.graphs graph
   where graph.id = p_intent.graph_id
     and graph.organization_id = p_intent.organization_id
     and graph.project_id = p_intent.project_id
     and graph.pause_requested_at is null
     and graph.withdrawn_at is null;
  if not found then
    raise exception using errcode = '55000',
      message = 'grok graph wake target is stale or stopped';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_intent.session_id
     and session.organization_id = p_intent.organization_id
     and session.project_id = p_intent.project_id
     and session.version >= p_intent.session_version
     and session.last_event_sequence >= p_intent.wake_revision;
  if not found or not exists (
    select 1
      from public.grok_graph_launches launch
     where launch.organization_id = p_intent.organization_id
       and launch.project_id = p_intent.project_id
       and launch.session_id = p_intent.session_id
       and launch.graph_id = p_intent.graph_id
  ) then
    raise exception using errcode = '55000',
      message = 'grok graph wake session or launch identity is stale';
  end if;

  if not public.assert_current_grok_execution_admissions(p_intent.graph_id) then
    raise exception using errcode = '55000',
      message = 'grok graph wake admission is stale';
  end if;
  return true;
end;
$function$;

revoke all on function public.assert_current_grok_graph_wake_intent(
  public.grok_graph_wake_intents
) from public, anon, authenticated, service_role;

-- Preserve the rolling v2 ABI while making every fresh Resume create its
-- wake intent in the same transaction as the graph transition.  A legacy
-- applied Resume without this evidence is refused on replay rather than
-- manufacturing a historical wake after the fact.
create or replace function public.apply_grok_graph_control_v2_as_owner(
  p_organization_id uuid,
  p_session_id uuid,
  p_graph_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text
)
returns table (
  intent_id uuid, organization_id uuid, project_id uuid, session_id uuid,
  graph_id uuid, action text, state text, idempotency_key text, replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_control record;
  v_session public.grok_sessions;
  v_wake public.grok_graph_wake_intents;
  v_control_revision bigint;
begin
  if auth.uid() is null
      or not public.has_organization_role(
        p_organization_id,
        array['owner'::public.organization_member_role]
      )
      or not exists (
        select 1
          from public.grok_sessions session
          join public.grok_graph_launches launch
            on launch.session_id = session.id
           and launch.organization_id = session.organization_id
           and launch.project_id = session.project_id
         where session.id = p_session_id
           and session.organization_id = p_organization_id
           and launch.graph_id = p_graph_id
      )
  then
    raise exception using errcode = '42501', message = 'Grok graph control is not authorized';
  end if;
  if p_action = 'resume' then
    if not public.assert_current_grok_execution_admissions(p_graph_id) then
      raise exception using errcode = '55000',
        message = 'Grok resume requires current execution admissions';
    end if;
  end if;

  select applied.* into v_control
    from public.apply_grok_graph_control_as_owner(
      p_organization_id, p_session_id, p_graph_id, p_action, p_reason,
      p_idempotency_key
    ) applied;

  if p_action = 'resume' then
    select event.sequence_no into v_control_revision
      from public.grok_events event
     where event.organization_id = p_organization_id
       and event.session_id = p_session_id
       and event.event_type = 'control.applied'
       and event.correlation_id = v_control.intent_id;
    if not found or v_control_revision is null then
      raise exception using errcode = '55000',
        message = 'grok Resume lacks one exact applied control revision';
    end if;

    select wake.* into v_wake
      from public.grok_graph_wake_intents wake
     where wake.control_intent_id = v_control.intent_id;
    if found then
      if v_wake.organization_id is distinct from p_organization_id
          or v_wake.project_id is distinct from v_control.project_id
          or v_wake.session_id is distinct from p_session_id
          or v_wake.graph_id is distinct from p_graph_id
          or v_wake.control_revision is distinct from v_control_revision
          or not public.assert_current_grok_graph_wake_intent(v_wake)
      then
        raise exception using errcode = '55000',
          message = 'grok Resume wake replay conflicts with exact identity';
      end if;
    else
      if v_control.replayed then
        raise exception using errcode = '55000',
          message = 'legacy Grok Resume has no atomic wake intent';
      end if;
      select session.* into v_session
        from public.grok_sessions session
       where session.id = p_session_id
         and session.organization_id = p_organization_id
         and session.project_id = v_control.project_id
       for update;
      if not found
          or v_session.last_event_sequence is distinct from v_control_revision then
        raise exception using errcode = '55000',
          message = 'grok Resume wake revision is not consecutive';
      end if;

      insert into public.grok_graph_wake_intents (
        organization_id, project_id, session_id, graph_id, control_intent_id,
        control_revision, wake_revision, session_version
      ) values (
        p_organization_id, v_control.project_id, p_session_id, p_graph_id,
        v_control.intent_id, v_control_revision, v_control_revision + 1,
        v_session.version + 1
      ) returning * into v_wake;

      perform public.record_grok_event_as_server(
        p_organization_id,
        p_session_id,
        'graph.wake_requested',
        v_wake.id,
        pg_catalog.jsonb_build_object(
          'schemaVersion', 1,
          'graphId', p_graph_id,
          'controlIntentId', v_control.intent_id,
          'controlRevision', v_control_revision,
          'wakeRevision', v_wake.wake_revision,
          'dispatchAccepted', false,
          'workerAcknowledged', false,
          'workerWoken', false
        ),
        v_session.last_event_sequence,
        null,
        null
      );
    end if;
  end if;

  return query select
    v_control.intent_id, v_control.organization_id, v_control.project_id,
    v_control.session_id, v_control.graph_id, v_control.action,
    v_control.state, v_control.idempotency_key, v_control.replayed;
end;
$function$;

revoke all on function public.apply_grok_graph_control_v2_as_owner(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_grok_graph_control_v2_as_owner(
  uuid, uuid, uuid, text, text, text
) to authenticated;

create function public.apply_grok_graph_control_v3_as_owner(
  p_organization_id uuid,
  p_session_id uuid,
  p_graph_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text
)
returns table (
  intent_id uuid, organization_id uuid, project_id uuid, session_id uuid,
  graph_id uuid, action text, state text, idempotency_key text, replayed boolean,
  wake_intent_id uuid, control_revision bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_control record;
  v_wake public.grok_graph_wake_intents;
begin
  select applied.* into v_control
    from public.apply_grok_graph_control_v2_as_owner(
      p_organization_id, p_session_id, p_graph_id, p_action, p_reason,
      p_idempotency_key
    ) applied;
  if p_action = 'resume' then
    select wake.* into v_wake
      from public.grok_graph_wake_intents wake
     where wake.control_intent_id = v_control.intent_id
       and wake.organization_id = p_organization_id
       and wake.project_id = v_control.project_id
       and wake.session_id = p_session_id
       and wake.graph_id = p_graph_id;
    if not found then
      raise exception using errcode = '55000',
        message = 'grok Resume did not return its exact wake intent';
    end if;
  end if;
  return query select
    v_control.intent_id, v_control.organization_id, v_control.project_id,
    v_control.session_id, v_control.graph_id, v_control.action,
    v_control.state, v_control.idempotency_key, v_control.replayed,
    v_wake.id, v_wake.control_revision;
end;
$function$;

revoke all on function public.apply_grok_graph_control_v3_as_owner(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_grok_graph_control_v3_as_owner(
  uuid, uuid, uuid, text, text, text
) to authenticated;

create function public.record_grok_graph_wake_dispatch_as_server(
  p_organization_id uuid,
  p_wake_intent_id uuid,
  p_control_revision bigint,
  p_outcome text,
  p_failure_code text,
  p_idempotency_key text
)
returns public.grok_graph_wake_dispatch_attempts
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_intent public.grok_graph_wake_intents;
  v_existing public.grok_graph_wake_dispatch_attempts;
  v_attempt public.grok_graph_wake_dispatch_attempts;
  v_session public.grok_sessions;
  v_attempt_number integer;
begin
  if p_wake_intent_id is null
      or p_control_revision is null or p_control_revision <= 0
      or p_outcome not in ('accepted', 'failed')
      or (p_outcome = 'accepted') <> (p_failure_code is null)
      or (p_failure_code is not null and p_failure_code !~ '^[A-Z][A-Z0-9_]{0,79}$')
      or p_idempotency_key is null
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  then
    raise exception using errcode = '22023',
      message = 'invalid Grok graph wake dispatch evidence';
  end if;

  select intent.* into v_intent
    from public.grok_graph_wake_intents intent
   where intent.id = p_wake_intent_id
     and intent.organization_id = p_organization_id
     and intent.control_revision = p_control_revision
   for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Grok graph wake intent was not found at the exact revision';
  end if;
  if p_outcome = 'accepted' then
    perform public.assert_current_grok_graph_wake_intent(v_intent);
  end if;

  select attempt.* into v_existing
    from public.grok_graph_wake_dispatch_attempts attempt
   where attempt.wake_intent_id = p_wake_intent_id
     and attempt.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.organization_id is not distinct from p_organization_id
        and v_existing.control_revision is not distinct from p_control_revision
        and v_existing.outcome is not distinct from p_outcome
        and v_existing.failure_code is not distinct from p_failure_code
    then
      return v_existing;
    end if;
    raise exception using errcode = '22023',
      message = 'Grok wake dispatch idempotency key conflicts with existing evidence';
  end if;

  select pg_catalog.count(*)::integer + 1 into v_attempt_number
    from public.grok_graph_wake_dispatch_attempts attempt
   where attempt.wake_intent_id = p_wake_intent_id;
  if v_attempt_number > 32 then
    raise exception using errcode = '54000',
      message = 'Grok graph wake dispatch attempt budget is exhausted';
  end if;

  insert into public.grok_graph_wake_dispatch_attempts (
    organization_id, project_id, session_id, graph_id, wake_intent_id,
    control_revision, attempt_number, idempotency_key, outcome, failure_code
  ) values (
    v_intent.organization_id, v_intent.project_id, v_intent.session_id,
    v_intent.graph_id, v_intent.id, v_intent.control_revision,
    v_attempt_number, p_idempotency_key, p_outcome, p_failure_code
  ) returning * into v_attempt;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = v_intent.session_id
     and session.organization_id = v_intent.organization_id
     and session.project_id = v_intent.project_id
   for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'Grok graph wake dispatch session identity is stale';
  end if;
  perform public.record_grok_event_as_server(
    v_intent.organization_id,
    v_intent.session_id,
    'graph.wake_dispatch_' || p_outcome,
    v_attempt.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'wakeIntentId', v_intent.id,
      'graphId', v_intent.graph_id,
      'controlRevision', v_intent.control_revision,
      'attemptNumber', v_attempt.attempt_number,
      'dispatchAccepted', p_outcome = 'accepted',
      'failureCode', p_failure_code,
      'workerAcknowledged', false,
      'workerWoken', false
    )),
    v_session.last_event_sequence,
    null,
    null
  );
  return v_attempt;
end;
$function$;

revoke all on function public.record_grok_graph_wake_dispatch_as_server(
  uuid, uuid, bigint, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_graph_wake_dispatch_as_server(
  uuid, uuid, bigint, text, text, text
) to service_role;

create function public.assert_no_grok_graph_wake_payload_required_as_worker(
  p_worker_id text,
  p_graph_id uuid,
  p_graph_run_id uuid,
  p_protocol_version integer,
  p_capability_version integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_graph_id is null or p_graph_run_id is null
      or p_protocol_version is distinct from 1
      or p_capability_version is distinct from 1
  then
    raise exception using errcode = '22023',
      message = 'exact Grok graph wake worker protocol and capability version 1 are required';
  end if;

  if not exists (
    select 1
      from public.graph_runs run
     where run.id = p_graph_run_id
       and run.graph_id = p_graph_id
       and run.state = 'RUNNING'
       and run.started_at is not null
  ) or not exists (
    select 1
      from public.graph_events event
     where event.graph_run_id = p_graph_run_id
       and event.event_type = 'run_started'
       and event.detail = pg_catalog.format(
         'Claimed by worker %s; nodes queued.', p_worker_id
       )
  ) then
    raise exception using errcode = '55000',
      message = 'Grok graph wake guard does not match an exact active worker claim';
  end if;

  -- Do not resolve or return an intent identity here. A Resume worker must
  -- carry the exact opaque dispatch identity; an old/malformed dispatch that
  -- omitted it fails closed instead of discovering current work from the DB.
  if exists (
    select 1
      from public.grok_graph_wake_intents intent
     where intent.graph_id = p_graph_id
  ) then
    raise exception using errcode = '55000',
      message = 'exact Grok graph wake intent and control revision payload are required';
  end if;
  return true;
end;
$function$;

revoke all on function public.assert_no_grok_graph_wake_payload_required_as_worker(
  text, uuid, uuid, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.assert_no_grok_graph_wake_payload_required_as_worker(
  text, uuid, uuid, integer, integer
) to service_role;

create function public.acknowledge_grok_graph_wake_as_worker(
  p_worker_id text,
  p_wake_intent_id uuid,
  p_control_revision bigint,
  p_graph_id uuid,
  p_graph_run_id uuid,
  p_protocol_version integer,
  p_capability_version integer
)
returns public.grok_graph_wake_receipts
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_intent public.grok_graph_wake_intents;
  v_existing public.grok_graph_wake_receipts;
  v_receipt public.grok_graph_wake_receipts;
  v_run public.graph_runs;
  v_session public.grok_sessions;
  v_dispatch_at timestamptz;
begin
  perform public.assert_graph_worker_id(p_worker_id);
  if p_wake_intent_id is null
      or p_control_revision is null or p_control_revision <= 0
      or p_graph_id is null or p_graph_run_id is null
      or p_protocol_version is distinct from 1
      or p_capability_version is distinct from 1
  then
    raise exception using errcode = '22023',
      message = 'exact Grok graph wake worker protocol and capability version 1 are required';
  end if;

  select intent.* into v_intent
    from public.grok_graph_wake_intents intent
   where intent.id = p_wake_intent_id
     and intent.control_revision = p_control_revision
     and intent.graph_id = p_graph_id
   for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Grok graph wake intent, revision, or graph identity mismatch';
  end if;
  perform public.assert_current_grok_graph_wake_intent(v_intent);

  select receipt.* into v_existing
    from public.grok_graph_wake_receipts receipt
   where receipt.wake_intent_id = p_wake_intent_id;
  if found then
    if v_existing.organization_id is not distinct from v_intent.organization_id
        and v_existing.project_id is not distinct from v_intent.project_id
        and v_existing.session_id is not distinct from v_intent.session_id
        and v_existing.graph_id is not distinct from p_graph_id
        and v_existing.graph_run_id is not distinct from p_graph_run_id
        and v_existing.control_revision is not distinct from p_control_revision
        and v_existing.worker_id is not distinct from p_worker_id
        and v_existing.protocol_version is not distinct from p_protocol_version
        and v_existing.capability_version is not distinct from p_capability_version
    then
      return v_existing;
    end if;
    raise exception using errcode = '55000',
      message = 'Grok graph wake receipt replay conflicts with exact worker identity';
  end if;

  select pg_catalog.min(attempt.created_at) into v_dispatch_at
    from public.grok_graph_wake_dispatch_attempts attempt
   where attempt.wake_intent_id = p_wake_intent_id
     and attempt.organization_id = v_intent.organization_id
     and attempt.project_id = v_intent.project_id
     and attempt.session_id = v_intent.session_id
     and attempt.graph_id = p_graph_id
     and attempt.control_revision = p_control_revision
     and attempt.outcome = 'accepted';
  if v_dispatch_at is null then
    raise exception using errcode = '55000',
      message = 'Grok graph wake has no durable accepted dispatch evidence';
  end if;

  select run.* into v_run
    from public.graph_runs run
   where run.id = p_graph_run_id
     and run.organization_id = v_intent.organization_id
     and run.graph_id = p_graph_id
     and run.state = 'RUNNING'
     and run.started_at is not null
     and run.started_at >= v_dispatch_at;
  if not found or not exists (
    select 1
      from public.graph_events event
     where event.organization_id = v_intent.organization_id
       and event.graph_run_id = p_graph_run_id
       and event.event_type = 'run_started'
       and event.detail = pg_catalog.format(
         'Claimed by worker %s; nodes queued.', p_worker_id
       )
  ) or not exists (
    select 1
      from public.node_runs node_run
     where node_run.organization_id = v_intent.organization_id
       and node_run.graph_run_id = p_graph_run_id
       and node_run.state = 'PENDING'
  ) then
    raise exception using errcode = '55000',
      message = 'Grok graph wake does not match an exact active worker claim';
  end if;

  insert into public.grok_graph_wake_receipts (
    organization_id, project_id, session_id, graph_id, graph_run_id,
    wake_intent_id, control_revision, worker_id, protocol_version,
    capability_version
  ) values (
    v_intent.organization_id, v_intent.project_id, v_intent.session_id,
    v_intent.graph_id, p_graph_run_id, v_intent.id,
    v_intent.control_revision, p_worker_id, p_protocol_version,
    p_capability_version
  ) returning * into v_receipt;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = v_intent.session_id
     and session.organization_id = v_intent.organization_id
     and session.project_id = v_intent.project_id
   for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'Grok graph wake receipt session identity is stale';
  end if;
  perform public.record_grok_event_as_server(
    v_intent.organization_id,
    v_intent.session_id,
    'graph.wake_acknowledged',
    v_receipt.id,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'wakeIntentId', v_intent.id,
      'graphId', v_intent.graph_id,
      'graphRunId', p_graph_run_id,
      'controlRevision', v_intent.control_revision,
      'workerId', p_worker_id,
      'protocolVersion', p_protocol_version,
      'capabilityVersion', p_capability_version,
      'dispatchAccepted', true,
      'workerAcknowledged', true,
      'workerWoken', true
    ),
    v_session.last_event_sequence,
    null,
    null
  );
  return v_receipt;
end;
$function$;

revoke all on function public.acknowledge_grok_graph_wake_as_worker(
  text, uuid, bigint, uuid, uuid, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_grok_graph_wake_as_worker(
  text, uuid, bigint, uuid, uuid, integer, integer
) to service_role;

create function public.read_grok_graph_wake_state_as_owner(
  p_organization_id uuid,
  p_session_id uuid,
  p_graph_id uuid
)
returns table (
  wake_intent_id uuid,
  control_revision bigint,
  dispatch_accepted boolean,
  dispatch_recorded_at timestamptz,
  worker_acknowledged boolean,
  worker_woken boolean,
  worker_id text,
  protocol_version integer,
  capability_version integer,
  acknowledged_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null
      or not public.has_organization_role(
        p_organization_id,
        array['owner'::public.organization_member_role]
      )
      or not exists (
        select 1
          from public.grok_graph_launches launch
         where launch.organization_id = p_organization_id
           and launch.session_id = p_session_id
           and launch.graph_id = p_graph_id
      )
  then
    raise exception using errcode = '42501',
      message = 'Grok graph wake evidence is not authorized';
  end if;

  return query
  with latest as (
    select intent.*
      from public.grok_graph_wake_intents intent
     where intent.organization_id = p_organization_id
       and intent.session_id = p_session_id
       and intent.graph_id = p_graph_id
     order by intent.control_revision desc, intent.id desc
     limit 1
  ), dispatch as (
    select
      attempt.wake_intent_id,
      pg_catalog.bool_or(attempt.outcome = 'accepted') as accepted,
      pg_catalog.max(attempt.created_at) filter (
        where attempt.outcome = 'accepted'
      ) as accepted_at
      from public.grok_graph_wake_dispatch_attempts attempt
      join latest on latest.id = attempt.wake_intent_id
     group by attempt.wake_intent_id
  )
  select
    latest.id,
    latest.control_revision,
    coalesce(dispatch.accepted, false),
    dispatch.accepted_at,
    receipt.id is not null,
    receipt.id is not null,
    receipt.worker_id,
    receipt.protocol_version,
    receipt.capability_version,
    receipt.acknowledged_at
  from latest
  left join dispatch on dispatch.wake_intent_id = latest.id
  left join public.grok_graph_wake_receipts receipt
    on receipt.wake_intent_id = latest.id;
end;
$function$;

revoke all on function public.read_grok_graph_wake_state_as_owner(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_grok_graph_wake_state_as_owner(uuid, uuid, uuid)
  to authenticated;

comment on table public.grok_graph_wake_intents is
  'Immutable owner Resume wake intents bound to exact tenant/session/graph/control revisions. Goal text and credentials are never stored.';
comment on table public.grok_graph_wake_dispatch_attempts is
  'Append-only GitHub repository_dispatch accepted/failed evidence. HTTP acceptance is not a worker wake.';
comment on table public.grok_graph_wake_receipts is
  'Append-only exact graph-claim acknowledgements. Only this receipt proves workerWoken for a Grok Resume.';
comment on function public.acknowledge_grok_graph_wake_as_worker(
  text, uuid, bigint, uuid, uuid, integer, integer
) is 'Service-role-only exact Grok wake receipt recorded after an exact graph claim and before provider work.';
comment on function public.assert_no_grok_graph_wake_payload_required_as_worker(
  text, uuid, uuid, integer, integer
) is 'Service-role-only absence guard: never resolves a wake identity and rejects a claimed initial graph when any Resume intent exists but its exact dispatch payload is absent.';

do $wake_postflight$
declare
  v_table text;
begin
  foreach v_table in array array[
    'grok_graph_wake_intents',
    'grok_graph_wake_dispatch_attempts',
    'grok_graph_wake_receipts'
  ] loop
    if not exists (
      select 1
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace space on space.oid = relation.relnamespace
       where space.nspname = 'public'
         and relation.relname = v_table
         and relation.relkind = 'r'
         and relation.relrowsecurity
         and relation.relforcerowsecurity
    ) then
      raise exception using errcode = '55000',
        message = 'Grok graph wake evidence table is not forced-RLS';
    end if;
    if exists (
      select 1
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace space on space.oid = relation.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )) privilege
       where space.nspname = 'public'
         and relation.relname = v_table
         and privilege.grantee <> relation.relowner
    ) then
      raise exception using errcode = '55000',
        message = 'Grok graph wake evidence table leaked direct privileges';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.record_grok_graph_wake_dispatch_as_server(uuid,uuid,bigint,text,text,text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.acknowledge_grok_graph_wake_as_worker(text,uuid,bigint,uuid,uuid,integer,integer)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.assert_no_grok_graph_wake_payload_required_as_worker(text,uuid,uuid,integer,integer)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_grok_graph_wake_dispatch_as_server(uuid,uuid,bigint,text,text,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.acknowledge_grok_graph_wake_as_worker(text,uuid,bigint,uuid,uuid,integer,integer)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.assert_no_grok_graph_wake_payload_required_as_worker(text,uuid,uuid,integer,integer)',
    'EXECUTE'
  ) then
    raise exception using errcode = '55000',
      message = 'Grok graph wake mutation functions are not service-role-only';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.apply_grok_graph_control_v3_as_owner(uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'public.read_grok_graph_wake_state_as_owner(uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception using errcode = '55000',
      message = 'Grok graph wake owner boundary ACL is incomplete';
  end if;
end;
$wake_postflight$;
