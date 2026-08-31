-- Persist a deterministic Grok planning refusal as one atomic, replay-safe
-- transaction. A blocked session is deliberately not closed: it remains
-- readable evidence, but the existing message boundary rejects all further
-- appends because only active sessions accept transcript mutations.
--
-- This migration does not dispatch a worker, create a graph/run, or change any
-- autonomous-execution control. It only records bounded failure evidence.

do $grok_planning_failure_preflight$
declare
  v_status_constraint text;
  v_closed_constraint text;
  v_function record;
  v_rls boolean;
  v_force_rls boolean;
begin
  select class.relrowsecurity, class.relforcerowsecurity
    into v_rls, v_force_rls
    from pg_catalog.pg_class class
   where class.oid = pg_catalog.to_regclass('public.grok_sessions');
  if not found or not v_rls or not v_force_rls then
    raise exception 'grok_sessions identity/RLS mismatch before planning-failure admission';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into v_status_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = 'public.grok_sessions'::regclass
     and constraint_row.conname = 'grok_sessions_status_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;
  if not found
      or pg_catalog.strpos(v_status_constraint, '''active''') = 0
      or pg_catalog.strpos(v_status_constraint, '''completed''') = 0
      or pg_catalog.strpos(v_status_constraint, '''cancelled''') = 0
      or pg_catalog.strpos(v_status_constraint, '''archived''') = 0
      or pg_catalog.strpos(v_status_constraint, '''blocked''') > 0 then
    raise exception 'grok session status constraint mismatch before planning-failure admission';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into v_closed_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = 'public.grok_sessions'::regclass
     and constraint_row.conname = 'grok_sessions_closed_state'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;
  if not found
      or pg_catalog.strpos(v_closed_constraint, 'status = ''active''') = 0
      or pg_catalog.strpos(v_closed_constraint, 'closed_at IS NULL') = 0
      or pg_catalog.strpos(v_closed_constraint, 'closed_at IS NOT NULL') = 0
      or pg_catalog.strpos(v_closed_constraint, '''blocked''') > 0 then
    raise exception 'grok session closed-state constraint mismatch before planning-failure admission';
  end if;

  select routine.prosecdef, routine.proconfig,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
    into v_function
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'public.enforce_grok_session_update()'
   );
  if not found
      or not v_function.prosecdef
      or v_function.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or v_function.owner_name <> 'postgres' then
    raise exception 'grok session guard identity mismatch before planning-failure admission';
  end if;

  select routine.prosecdef, routine.proconfig,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
    into v_function
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)'
   );
  if not found
      or not v_function.prosecdef
      or v_function.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or v_function.owner_name <> 'postgres'
      or not pg_catalog.has_function_privilege(
        'service_role',
        'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)',
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated',
        'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)',
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'anon',
        'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)',
        'EXECUTE'
      ) then
    raise exception 'grok session status RPC identity/ACL mismatch before planning-failure admission';
  end if;
end;
$grok_planning_failure_preflight$;

alter table public.grok_sessions
  drop constraint grok_sessions_status_check;
alter table public.grok_sessions
  add constraint grok_sessions_status_check
  check (status in ('active', 'blocked', 'completed', 'cancelled', 'archived'));

alter table public.grok_sessions
  drop constraint grok_sessions_closed_state;
alter table public.grok_sessions
  add constraint grok_sessions_closed_state
  check (
    (status in ('active', 'blocked') and closed_at is null)
    or (
      status in ('completed', 'cancelled', 'archived')
      and closed_at is not null
    )
  );

create or replace function public.enforce_grok_session_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if (new.id, new.organization_id, new.project_id, new.created_by, new.idempotency_key, new.created_at)
      is distinct from
     (old.id, old.organization_id, old.project_id, old.created_by, old.idempotency_key, old.created_at) then
    raise exception using errcode = '55000', message = 'grok session identity is immutable';
  end if;
  if new.version <> old.version + 1
      or new.last_message_sequence < old.last_message_sequence
      or new.last_message_sequence > old.last_message_sequence + 1
      or new.last_event_sequence < old.last_event_sequence
      or new.last_event_sequence > old.last_event_sequence + 1
      or new.updated_at < old.updated_at then
    raise exception using errcode = '55000', message = 'grok session progress must advance monotonically';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'active' and new.status in ('blocked', 'completed', 'cancelled', 'archived'))
    or (old.status in ('completed', 'cancelled') and new.status = 'archived')
  ) then
    raise exception using errcode = '55000', message = 'invalid grok session state transition';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_grok_session_update()
  from public, anon, authenticated, service_role;

create or replace function public.set_grok_session_status_as_server(
  p_organization_id uuid,
  p_session_id uuid,
  p_status text,
  p_expected_version bigint
)
returns public.grok_sessions
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
begin
  if p_status not in ('blocked', 'completed', 'cancelled', 'archived') then
    raise exception using errcode = '22023', message = 'invalid grok session status';
  end if;
  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;
  -- Exact replay remains before the version CAS. A timed-out terminal or
  -- planning-failure transition must not duplicate its immutable event.
  if v_session.status = p_status then
    return v_session;
  end if;
  if v_session.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_grok_session_version';
  end if;

  update public.grok_sessions
     set status = p_status,
         closed_at = case
           when p_status = 'blocked' then null
           else coalesce(closed_at, pg_catalog.now())
         end,
         last_event_sequence = last_event_sequence + 1,
         version = version + 1,
         updated_at = pg_catalog.now()
   where id = p_session_id
   returning * into v_session;

  insert into public.grok_events (
    organization_id, project_id, session_id, sequence_no, event_type,
    correlation_id, payload
  ) values (
    p_organization_id, v_session.project_id, p_session_id,
    v_session.last_event_sequence, 'session.' || p_status, p_session_id,
    pg_catalog.jsonb_build_object('status', p_status)
  );
  return v_session;
end;
$function$;

revoke all on function public.set_grok_session_status_as_server(
  uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.set_grok_session_status_as_server(
  uuid, uuid, text, bigint
) to service_role;

create function public.record_grok_planning_failure_as_server(
  p_organization_id uuid,
  p_session_id uuid,
  p_user_message_id uuid,
  p_error_code text,
  p_idempotency_key text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_user_message public.grok_messages;
  v_message public.grok_messages;
  v_event public.grok_events;
  v_blocked_event public.grok_events;
  v_content text;
  v_metadata jsonb;
  v_payload jsonb;
  v_initial_event_sequence bigint;
begin
  if p_organization_id is null
      or p_session_id is null
      or p_user_message_id is null
      or p_expected_version is null
      or p_expected_version <= 0
      or p_expected_version > 9223372036854775804
      or p_idempotency_key is null
      or pg_catalog.char_length(p_idempotency_key) not between 8 and 128
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception using errcode = '22023', message = 'invalid grok planning failure input';
  end if;

  v_content := case p_error_code
    when 'INVALID_INPUT' then
      'Planning is blocked because the request does not satisfy the bounded Grok planning contract.'
    when 'SENSITIVE_DATA' then
      'Planning is blocked because the request contains secret-shaped data. Remove it and start a new goal.'
    when 'NO_CONFIGURED_AGENTS' then
      'Planning is blocked until this project has at least one Ready configured Claude or Codex agent.'
    when 'MISSING_CLAUDE_AGENT' then
      'Planning is blocked until a Ready configured Claude agent covers every required planning and verification task.'
    when 'MISSING_CODEX_AGENT' then
      'Planning is blocked until a Ready configured Codex agent covers the repository-writing task.'
    when 'GRAPH_INVALID' then
      'Planning is blocked because the deterministic task graph did not satisfy the graph contract.'
    else null
  end;
  if v_content is null then
    raise exception using errcode = '22023', message = 'invalid grok planner error code';
  end if;

  v_metadata := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'kind', 'grok.planning_error',
    'code', p_error_code,
    'workerWoken', false,
    'executionStarted', false
  );

  -- Lock first, then inspect replay evidence. The replay lookup and its exact
  -- evidence checks deliberately precede every status/version CAS.
  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  select message.* into v_message
    from public.grok_messages message
   where message.organization_id = p_organization_id
     and message.session_id = p_session_id
     and message.idempotency_key = p_idempotency_key;
  if found then
    v_payload := pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'detail', 'Planning was blocked before any graph or worker dispatch.',
      'code', p_error_code,
      'messageId', v_message.id,
      'workerWoken', false,
      'executionStarted', false
    );
    if v_message.sequence_no <> 2
        or v_message.role <> 'assistant'
        or v_message.content is distinct from v_content
        or v_message.metadata is distinct from v_metadata
        or v_message.reply_to_message_id is distinct from p_user_message_id
        or v_message.actor_user_id is not null then
      raise exception using errcode = '22023', message = 'grok planning failure idempotency key was reused with different input';
    end if;

    select event.* into v_event
      from public.grok_events event
     where event.organization_id = p_organization_id
       and event.session_id = p_session_id
       and event.event_type = 'session.planning_failed'
       and event.correlation_id = p_session_id;
    if not found
        or v_event.sequence_no <> 4
        or v_event.message_id is distinct from v_message.id
        or v_event.task_link_id is not null
        or v_event.actor_user_id is not null
        or v_event.payload is distinct from v_payload then
      raise exception using errcode = '55000', message = 'grok planning failure replay evidence mismatch';
    end if;

    select event.* into v_blocked_event
      from public.grok_events event
     where event.organization_id = p_organization_id
       and event.session_id = p_session_id
       and event.event_type = 'session.blocked'
       and event.correlation_id = p_session_id;
    if not found
        or v_blocked_event.sequence_no <> 5
        or v_blocked_event.message_id is not null
        or v_blocked_event.task_link_id is not null
        or v_blocked_event.actor_user_id is not null
        or v_blocked_event.payload is distinct from
          pg_catalog.jsonb_build_object('status', 'blocked')
        or v_session.status <> 'blocked'
        or v_session.closed_at is not null
        or v_session.last_message_sequence <> 2
        or v_session.last_event_sequence <> 5
        or v_session.version <> 5 then
      raise exception using errcode = '55000', message = 'grok planning failure replay status mismatch';
    end if;

    return pg_catalog.jsonb_build_object(
      'session', pg_catalog.to_jsonb(v_session),
      'message', pg_catalog.to_jsonb(v_message),
      'event', pg_catalog.to_jsonb(v_event)
    );
  end if;

  if v_session.status <> 'active' or v_session.closed_at is not null then
    raise exception using errcode = '55000', message = 'grok planning failure session is not active';
  end if;
  if v_session.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_grok_session_version';
  end if;
  if v_session.last_message_sequence <> 1
      or v_session.last_event_sequence <> 2
      or v_session.version <> 2 then
    raise exception using errcode = '55000', message = 'grok planning failure session is not pristine';
  end if;

  select message.* into v_user_message
    from public.grok_messages message
   where message.id = p_user_message_id
     and message.organization_id = p_organization_id
     and message.session_id = p_session_id
     and message.sequence_no = 1
     and message.role = 'user';
  if not found then
    raise exception using errcode = 'P0002', message = 'grok planning failure user message not found';
  end if;
  if v_user_message.reply_to_message_id is not null
      or v_user_message.actor_user_id is null
      or not exists (
        select 1
          from public.grok_events event
         where event.organization_id = p_organization_id
           and event.session_id = p_session_id
           and event.sequence_no = 2
           and event.event_type = 'message.appended'
           and event.correlation_id = v_user_message.id
           and event.message_id = v_user_message.id
           and event.task_link_id is null
           and event.actor_user_id = v_user_message.actor_user_id
           and event.payload = pg_catalog.jsonb_build_object(
             'message_id', v_user_message.id,
             'message_sequence', 1,
             'role', 'user'
           )
      ) then
    raise exception using errcode = '55000', message = 'grok planning failure user evidence mismatch';
  end if;

  v_initial_event_sequence := v_session.last_event_sequence;
  v_message := public.append_grok_message_internal(
    p_organization_id,
    p_session_id,
    'assistant',
    v_content,
    v_metadata,
    p_idempotency_key,
    v_session.last_message_sequence,
    v_user_message.id,
    null
  );
  v_payload := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'detail', 'Planning was blocked before any graph or worker dispatch.',
    'code', p_error_code,
    'messageId', v_message.id,
    'workerWoken', false,
    'executionStarted', false
  );
  v_event := public.record_grok_event_as_server(
    p_organization_id,
    p_session_id,
    'session.planning_failed',
    p_session_id,
    v_payload,
    v_initial_event_sequence + 1,
    v_message.id,
    null
  );
  v_session := public.set_grok_session_status_as_server(
    p_organization_id,
    p_session_id,
    'blocked',
    p_expected_version + 2
  );

  if v_session.status <> 'blocked'
      or v_session.closed_at is not null
      or v_session.last_message_sequence <> 2
      or v_session.last_event_sequence <> 5
      or v_session.version <> p_expected_version + 3 then
    raise exception using errcode = '55000', message = 'grok planning failure persistence invariant failed';
  end if;

  return pg_catalog.jsonb_build_object(
    'session', pg_catalog.to_jsonb(v_session),
    'message', pg_catalog.to_jsonb(v_message),
    'event', pg_catalog.to_jsonb(v_event)
  );
end;
$function$;

revoke all on function public.record_grok_planning_failure_as_server(
  uuid, uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_planning_failure_as_server(
  uuid, uuid, uuid, text, text, bigint
) to service_role;

do $grok_planning_failure_postflight$
declare
  v_status_constraint text;
  v_closed_constraint text;
  v_function record;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into v_status_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = 'public.grok_sessions'::regclass
     and constraint_row.conname = 'grok_sessions_status_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;
  if not found
      or pg_catalog.strpos(v_status_constraint, '''blocked''') = 0 then
    raise exception 'grok session blocked status constraint was not installed';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into v_closed_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = 'public.grok_sessions'::regclass
     and constraint_row.conname = 'grok_sessions_closed_state'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;
  if not found
      or pg_catalog.strpos(v_closed_constraint, '''blocked''') = 0
      or pg_catalog.strpos(v_closed_constraint, 'closed_at IS NULL') = 0
      or exists (
        select 1
          from public.grok_sessions session
         where (session.status in ('active', 'blocked') and session.closed_at is not null)
            or (session.status in ('completed', 'cancelled', 'archived') and session.closed_at is null)
      ) then
    raise exception 'grok session nonclosed blocked invariant was not installed';
  end if;

  select routine.prosecdef, routine.proconfig,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
    into v_function
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)'
   );
  if not found
      or not v_function.prosecdef
      or v_function.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or v_function.owner_name <> 'postgres'
      or not pg_catalog.has_function_privilege(
        'service_role',
        'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)',
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated',
        'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)',
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'anon',
        'public.set_grok_session_status_as_server(uuid,uuid,text,bigint)',
        'EXECUTE'
      ) then
    raise exception 'grok session status RPC identity/ACL mismatch after planning-failure admission';
  end if;

  select routine.prosecdef, routine.proconfig,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
    into v_function
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'public.record_grok_planning_failure_as_server(uuid,uuid,uuid,text,text,bigint)'
   );
  if not found
      or not v_function.prosecdef
      or v_function.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or v_function.owner_name <> 'postgres'
      or not pg_catalog.has_function_privilege(
        'service_role',
        'public.record_grok_planning_failure_as_server(uuid,uuid,uuid,text,text,bigint)',
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated',
        'public.record_grok_planning_failure_as_server(uuid,uuid,uuid,text,text,bigint)',
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'anon',
        'public.record_grok_planning_failure_as_server(uuid,uuid,uuid,text,text,bigint)',
        'EXECUTE'
      ) then
    raise exception 'grok planning failure RPC identity/ACL mismatch after installation';
  end if;
end;
$grok_planning_failure_postflight$;
