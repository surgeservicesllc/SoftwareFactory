-- Durable Chief-of-Staff workspace persistence.
--
-- This is a conversation and lineage spine, not another executor. Commands,
-- tasks, graphs, graph runs, gates and artifacts remain authoritative in their
-- existing tables. These rows only preserve what a person and the factory saw,
-- and link that transcript to the exact control-plane evidence it describes.
-- Recording a control intent never performs the requested control action.

-- phase1c_run_artifacts predates tenant-composite foreign keys. Its UUID is
-- already globally unique; this redundant composite key lets an artifact link
-- prove tenant identity in the catalogue rather than relying on application
-- code alone.
do $grok_phase1c_artifact_key$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.phase1c_run_artifacts'::regclass
       and conname = 'phase1c_run_artifacts_id_organization_unique'
  ) then
    alter table public.phase1c_run_artifacts
      add constraint phase1c_run_artifacts_id_organization_unique
      unique (id, organization_id);
  end if;
end;
$grok_phase1c_artifact_key$;

create table public.grok_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  last_message_sequence bigint not null default 0
    check (last_message_sequence >= 0),
  last_event_sequence bigint not null default 0
    check (last_event_sequence >= 0),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint grok_sessions_id_scope_unique
    unique (id, organization_id, project_id),
  constraint grok_sessions_create_idempotency_unique
    unique (organization_id, project_id, created_by, idempotency_key),
  constraint grok_sessions_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint grok_sessions_title_no_secret
    check (not public.text_has_likely_secret(title)),
  constraint grok_sessions_idempotency_shape
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint grok_sessions_closed_state
    check ((status = 'active' and closed_at is null)
      or (status <> 'active' and closed_at is not null))
);

create table public.grok_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  sequence_no bigint not null check (sequence_no > 0),
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  metadata jsonb not null default '{}'::jsonb,
  reply_to_message_id uuid,
  actor_user_id uuid references auth.users(id) on delete restrict,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  constraint grok_messages_id_scope_unique
    unique (id, organization_id, session_id),
  constraint grok_messages_session_sequence_unique
    unique (session_id, sequence_no),
  constraint grok_messages_session_idempotency_unique
    unique (session_id, idempotency_key),
  constraint grok_messages_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_messages_reply_fk
    foreign key (reply_to_message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_messages_actor_shape
    check ((role = 'user' and actor_user_id is not null)
      or (role <> 'user' and actor_user_id is null)),
  constraint grok_messages_content_no_secret
    check (not public.text_has_likely_secret(content)),
  constraint grok_messages_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint grok_messages_metadata_bounded
    check (octet_length(metadata::text) <= 65536),
  constraint grok_messages_metadata_no_secret
    check (not public.jsonb_has_sensitive_keys(metadata)),
  constraint grok_messages_idempotency_shape
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$')
);

create table public.grok_task_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid,
  command_id uuid,
  task_id uuid,
  graph_id uuid,
  graph_run_id uuid,
  relation text not null
    check (relation in ('requested', 'planned', 'executing', 'result')),
  created_at timestamptz not null default now(),
  constraint grok_task_links_id_scope_unique
    unique (id, organization_id, session_id),
  constraint grok_task_links_has_engine_record
    check (num_nonnulls(command_id, task_id, graph_id, graph_run_id) >= 1),
  constraint grok_task_links_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_task_links_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_task_links_command_fk
    foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete restrict,
  constraint grok_task_links_task_fk
    foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete restrict,
  constraint grok_task_links_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint grok_task_links_graph_run_fk
    foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete restrict
);

create unique index grok_task_links_command_unique
  on public.grok_task_links (session_id, command_id)
  where command_id is not null;
create unique index grok_task_links_task_unique
  on public.grok_task_links (session_id, task_id)
  where task_id is not null;
create unique index grok_task_links_graph_unique
  on public.grok_task_links (session_id, graph_id)
  where graph_id is not null;
create unique index grok_task_links_graph_run_unique
  on public.grok_task_links (session_id, graph_run_id)
  where graph_run_id is not null;

-- One atomic, idempotent graph launch per request key. This private evidence
-- closes the create-graph-before-link crash window: graph creation, the
-- session link and this row commit together or all roll back together.
create table public.grok_graph_launches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  graph_id uuid not null,
  task_link_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint grok_graph_launches_session_idempotency_unique
    unique (session_id, idempotency_key),
  constraint grok_graph_launches_graph_unique unique (graph_id),
  constraint grok_graph_launches_task_link_unique unique (task_link_id),
  constraint grok_graph_launches_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_graph_launches_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_graph_launches_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint grok_graph_launches_task_link_fk
    foreign key (task_link_id, organization_id, session_id)
    references public.grok_task_links(id, organization_id, session_id) on delete restrict,
  constraint grok_graph_launches_idempotency_shape
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$')
);

create table public.grok_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid,
  task_link_id uuid,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  correlation_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint grok_events_session_sequence_unique
    unique (session_id, sequence_no),
  constraint grok_events_session_correlation_unique
    unique (session_id, correlation_id, event_type),
  constraint grok_events_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_events_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_events_task_link_fk
    foreign key (task_link_id, organization_id, session_id)
    references public.grok_task_links(id, organization_id, session_id) on delete restrict,
  constraint grok_events_payload_object
    check (jsonb_typeof(payload) = 'object'),
  constraint grok_events_payload_bounded
    check (octet_length(payload::text) <= 65536),
  constraint grok_events_payload_no_secret
    check (not public.jsonb_has_sensitive_keys(payload))
);

create table public.grok_artifact_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid,
  task_link_id uuid,
  graph_artifact_id uuid,
  phase1c_artifact_id uuid,
  purpose text not null check (char_length(btrim(purpose)) between 1 and 160),
  created_at timestamptz not null default now(),
  constraint grok_artifact_links_exactly_one_source
    check (num_nonnulls(graph_artifact_id, phase1c_artifact_id) = 1),
  constraint grok_artifact_links_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_artifact_links_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_artifact_links_task_link_fk
    foreign key (task_link_id, organization_id, session_id)
    references public.grok_task_links(id, organization_id, session_id) on delete restrict,
  constraint grok_artifact_links_graph_artifact_fk
    foreign key (graph_artifact_id, organization_id)
    references public.graph_artifacts(id, organization_id) on delete restrict,
  constraint grok_artifact_links_phase1c_artifact_fk
    foreign key (phase1c_artifact_id, organization_id)
    references public.phase1c_run_artifacts(id, organization_id) on delete restrict,
  constraint grok_artifact_links_purpose_no_secret
    check (not public.text_has_likely_secret(purpose))
);

create unique index grok_artifact_links_graph_source_unique
  on public.grok_artifact_links (session_id, graph_artifact_id)
  where graph_artifact_id is not null;
create unique index grok_artifact_links_phase1c_source_unique
  on public.grok_artifact_links (session_id, phase1c_artifact_id)
  where phase1c_artifact_id is not null;

create table public.grok_control_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  target_kind text not null
    check (target_kind in ('graph', 'graph_run', 'task', 'gate')),
  graph_id uuid,
  graph_run_id uuid,
  task_id uuid,
  gate_id uuid,
  action text not null
    check (action in ('pause', 'resume', 'withdraw', 'cancel', 'retry', 'approve', 'reject')),
  state text not null default 'requested'
    check (state in ('requested', 'accepted', 'rejected', 'applied', 'failed', 'superseded')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz,
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,79}$'
  ),
  failure_detail text check (
    failure_detail is null or char_length(failure_detail) between 1 and 1000
  ),
  updated_at timestamptz not null default now(),
  constraint grok_control_intents_id_scope_unique
    unique (id, organization_id, session_id),
  constraint grok_control_intents_session_idempotency_unique
    unique (session_id, idempotency_key),
  constraint grok_control_intents_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_control_intents_graph_fk
    foreign key (graph_id, organization_id)
    references public.graphs(id, organization_id) on delete restrict,
  constraint grok_control_intents_graph_run_fk
    foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete restrict,
  constraint grok_control_intents_task_fk
    foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete restrict,
  constraint grok_control_intents_gate_fk
    foreign key (gate_id, organization_id)
    references public.graph_gates(id, organization_id) on delete restrict,
  constraint grok_control_intents_exact_target
    check (
      (target_kind = 'graph' and graph_id is not null
        and num_nonnulls(graph_run_id, task_id, gate_id) = 0)
      or (target_kind = 'graph_run' and graph_run_id is not null
        and num_nonnulls(graph_id, task_id, gate_id) = 0)
      or (target_kind = 'task' and task_id is not null
        and num_nonnulls(graph_id, graph_run_id, gate_id) = 0)
      or (target_kind = 'gate' and gate_id is not null
        and num_nonnulls(graph_id, graph_run_id, task_id) = 0)
    ),
  constraint grok_control_intents_action_target
    check (
      (target_kind = 'graph' and action in ('pause', 'resume', 'withdraw'))
      or (target_kind in ('graph_run', 'task') and action in ('cancel', 'retry'))
      or (target_kind = 'gate' and action in ('approve', 'reject'))
    ),
  constraint grok_control_intents_resolution_shape
    check (
      (state = 'requested' and decided_at is null and applied_at is null
        and failure_code is null and failure_detail is null)
      or (state in ('accepted', 'rejected', 'superseded') and decided_at is not null
        and applied_at is null and failure_code is null and failure_detail is null)
      or (state = 'applied' and decided_at is not null and applied_at is not null
        and failure_code is null and failure_detail is null)
      or (state = 'failed' and decided_at is not null and applied_at is null
        and failure_code is not null)
    ),
  constraint grok_control_intents_reason_no_secret
    check (not public.text_has_likely_secret(reason)),
  constraint grok_control_intents_failure_no_secret
    check (failure_detail is null or not public.text_has_likely_secret(failure_detail)),
  constraint grok_control_intents_idempotency_shape
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$')
);

create index grok_sessions_project_updated_idx
  on public.grok_sessions (organization_id, project_id, updated_at desc, id desc);
create index grok_messages_session_sequence_idx
  on public.grok_messages (session_id, sequence_no);
create index grok_events_session_sequence_idx
  on public.grok_events (session_id, sequence_no);
create index grok_control_intents_session_requested_idx
  on public.grok_control_intents (session_id, requested_at desc, id desc);

comment on table public.grok_sessions is
  'Durable tenant/project Chief-of-Staff workspaces. They dispatch nothing.';
comment on table public.grok_messages is
  'Append-only ordered workspace transcript. Provider credentials and raw tool payloads do not belong here.';
comment on table public.grok_task_links is
  'Immutable links from a workspace turn to existing command/task/graph/run truth.';
comment on table public.grok_events is
  'Append-only ordered workspace history, including bounded tool/checkpoint/error summaries.';
comment on table public.grok_artifact_links is
  'Immutable links to existing graph or Phase 1C artifacts; artifact content remains in its source table.';
comment on table public.grok_control_intents is
  'Audited control requests. A row is intent only and never performs the target action.';

-- ---------------------------------------------------------------------------
-- Mutation guards. Evidence rows cannot be rewritten or truncated. Sessions
-- may advance only monotonically, and control intents have a finite monotonic
-- state machine.
-- ---------------------------------------------------------------------------

create function public.reject_grok_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000', message = 'grok workspace evidence is immutable';
end;
$function$;

revoke all on function public.reject_grok_evidence_mutation()
  from public, anon, authenticated, service_role;

do $grok_immutable_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'grok_messages', 'grok_task_links', 'grok_graph_launches',
    'grok_events', 'grok_artifact_links'
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
$grok_immutable_triggers$;

create function public.enforce_grok_session_update()
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
    (old.status = 'active' and new.status in ('completed', 'cancelled', 'archived'))
    or (old.status in ('completed', 'cancelled') and new.status = 'archived')
  ) then
    raise exception using errcode = '55000', message = 'invalid grok session state transition';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_grok_session_update()
  from public, anon, authenticated, service_role;

create trigger grok_sessions_guard_update
before update on public.grok_sessions
for each row execute function public.enforce_grok_session_update();
create trigger grok_sessions_no_delete
before delete on public.grok_sessions
for each row execute function public.reject_grok_evidence_mutation();
create trigger grok_sessions_no_truncate
before truncate on public.grok_sessions
for each statement execute function public.reject_grok_evidence_mutation();

create function public.enforce_grok_control_intent_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if (new.id, new.organization_id, new.project_id, new.session_id,
      new.target_kind, new.graph_id, new.graph_run_id, new.task_id, new.gate_id,
      new.action, new.reason, new.idempotency_key, new.requested_by, new.requested_at)
      is distinct from
     (old.id, old.organization_id, old.project_id, old.session_id,
      old.target_kind, old.graph_id, old.graph_run_id, old.task_id, old.gate_id,
      old.action, old.reason, old.idempotency_key, old.requested_by, old.requested_at) then
    raise exception using errcode = '55000', message = 'grok control intent identity is immutable';
  end if;
  if new.updated_at < old.updated_at or not (
    (old.state = 'requested' and new.state in ('accepted', 'rejected', 'applied', 'failed', 'superseded'))
    or (old.state = 'accepted' and new.state in ('applied', 'failed', 'superseded'))
  ) then
    raise exception using errcode = '55000', message = 'invalid grok control intent transition';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_grok_control_intent_update()
  from public, anon, authenticated, service_role;

create trigger grok_control_intents_guard_update
before update on public.grok_control_intents
for each row execute function public.enforce_grok_control_intent_update();
create trigger grok_control_intents_no_delete
before delete on public.grok_control_intents
for each row execute function public.reject_grok_evidence_mutation();
create trigger grok_control_intents_no_truncate
before truncate on public.grok_control_intents
for each statement execute function public.reject_grok_evidence_mutation();

-- ---------------------------------------------------------------------------
-- RLS and grants. Table access is deliberately absent, including for the
-- BYPASSRLS service role. Bounded functions are the only read/write surface.
-- ---------------------------------------------------------------------------

do $grok_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'grok_sessions', 'grok_messages', 'grok_task_links', 'grok_graph_launches',
    'grok_events', 'grok_artifact_links', 'grok_control_intents'
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
$grok_rls$;

-- ---------------------------------------------------------------------------
-- Authenticated session and transcript boundary.
-- ---------------------------------------------------------------------------

create function public.create_grok_session(
  p_organization_id uuid,
  p_project_id uuid,
  p_title text,
  p_idempotency_key text
)
returns public.grok_sessions
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_title text := pg_catalog.btrim(p_title);
  v_session public.grok_sessions;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501', message = 'organization owner access is required';
  end if;
  if v_title is null or pg_catalog.char_length(v_title) not between 1 and 160
      or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'invalid grok session input';
  end if;
  if not exists (
    select 1
      from public.projects project
     where project.id = p_project_id
       and project.organization_id = p_organization_id
       and project.status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'project_not_found';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.organization_id = p_organization_id
     and session.project_id = p_project_id
     and session.created_by = v_caller
     and session.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_session.title is distinct from v_title then
      raise exception using errcode = '22023', message = 'grok session idempotency key was reused with different input';
    end if;
    return v_session;
  end if;

  insert into public.grok_sessions (
    organization_id, project_id, title, created_by, idempotency_key,
    last_event_sequence
  ) values (
    p_organization_id, p_project_id, v_title, v_caller, p_idempotency_key, 1
  ) returning * into v_session;

  insert into public.grok_events (
    organization_id, project_id, session_id, sequence_no, event_type,
    correlation_id, payload, actor_user_id
  ) values (
    p_organization_id, p_project_id, v_session.id, 1, 'session.created',
    v_session.id, pg_catalog.jsonb_build_object('session_id', v_session.id), v_caller
  );

  return v_session;
exception
  when unique_violation then
    select session.* into v_session
      from public.grok_sessions session
     where session.organization_id = p_organization_id
       and session.project_id = p_project_id
       and session.created_by = v_caller
       and session.idempotency_key = p_idempotency_key;
    if found and v_session.title is not distinct from v_title then
      return v_session;
    end if;
    raise exception using errcode = '22023', message = 'grok session idempotency key was reused with different input';
end;
$function$;

revoke all on function public.create_grok_session(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_grok_session(uuid, uuid, text, text)
  to authenticated;

create function public.list_grok_sessions(
  p_organization_id uuid,
  p_project_id uuid default null,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  session_id uuid,
  project_id uuid,
  project_name text,
  title text,
  status text,
  last_message_sequence bigint,
  last_event_sequence bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role]
  ) then
    return;
  end if;
  if p_limit is null or p_limit not between 1 and 100
      or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception using errcode = '22023', message = 'invalid grok session list cursor';
  end if;

  return query
  select session.id as session_id,
         session.project_id,
         project.name as project_name,
         session.title,
         case
           when session.status <> 'active' then session.status
           when linked_graph.withdrawn_at is not null then 'stopped'
           when linked_graph.pause_requested_at is not null then 'paused'
           when latest_run.run_state is not null then latest_run.run_state
           when linked_graph.graph_id is not null then 'planned'
           when exists (
             select 1
               from public.grok_messages message
              where message.session_id = session.id
                and message.organization_id = session.organization_id
                and message.role = 'assistant'
                and message.metadata ->> 'kind' = 'grok.plan'
           ) then 'blocked'
           else 'active'
         end as status,
         session.last_message_sequence,
         session.last_event_sequence,
         session.created_at,
         session.updated_at
    from public.grok_sessions session
    join public.projects project
      on project.id = session.project_id
     and project.organization_id = session.organization_id
    left join lateral (
      select graph.id as graph_id,
             graph.pause_requested_at,
             graph.withdrawn_at
        from public.grok_task_links task_link
        join public.graphs graph
          on graph.id = task_link.graph_id
         and graph.organization_id = task_link.organization_id
       where task_link.session_id = session.id
         and task_link.organization_id = session.organization_id
         and task_link.relation = 'planned'
         and task_link.graph_id is not null
       order by task_link.created_at desc, task_link.id desc
       limit 1
    ) linked_graph on true
    left join lateral (
      select pg_catalog.lower(graph_run.state::text) as run_state
        from public.graph_runs graph_run
       where graph_run.organization_id = session.organization_id
         and graph_run.graph_id = linked_graph.graph_id
       order by graph_run.created_at desc, graph_run.id desc
       limit 1
    ) latest_run on true
   where session.organization_id = p_organization_id
     and (p_project_id is null or session.project_id = p_project_id)
     and (p_before_created_at is null
       or (session.created_at, session.id) < (p_before_created_at, p_before_id))
   order by session.created_at desc, session.id desc
   limit p_limit;
end;
$function$;

revoke all on function public.list_grok_sessions(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_grok_sessions(uuid, uuid, integer, timestamptz, uuid)
  to authenticated;

create function public.read_grok_session(
  p_organization_id uuid,
  p_session_id uuid,
  p_after_message_sequence bigint default 0,
  p_after_event_sequence bigint default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_messages jsonb;
  v_task_links jsonb;
  v_events jsonb;
  v_artifact_links jsonb;
  v_control_intents jsonb;
begin
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;
  if p_after_message_sequence is null or p_after_message_sequence < 0
      or p_after_event_sequence is null or p_after_event_sequence < 0
      or p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid grok session read cursor';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(message)
           order by message.sequence_no), '[]'::jsonb)
    into v_messages
    from (
      select *
        from public.grok_messages message
       where message.session_id = p_session_id
         and message.organization_id = p_organization_id
         and message.sequence_no > p_after_message_sequence
       order by message.sequence_no
       limit p_limit
    ) message;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(task_link)
           order by task_link.created_at, task_link.id), '[]'::jsonb)
    into v_task_links
    from (
      select *
        from public.grok_task_links task_link
       where task_link.session_id = p_session_id
         and task_link.organization_id = p_organization_id
       order by task_link.created_at, task_link.id
       limit 500
    ) task_link;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(event)
           order by event.sequence_no), '[]'::jsonb)
    into v_events
    from (
      select *
        from public.grok_events event
       where event.session_id = p_session_id
         and event.organization_id = p_organization_id
         and event.sequence_no > p_after_event_sequence
       order by event.sequence_no
       limit p_limit
    ) event;

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
             'id', artifact_link.id,
             'kind', coalesce(graph_artifact.kind::text, phase1c_artifact.artifact_type),
             'label', artifact_link.purpose,
             'uri', case
               when graph_artifact.id is not null then
                 coalesce(graph_artifact.payload ->> 'uri', graph_artifact.payload ->> 'url')
               else phase1c_artifact.reference
             end,
             'created_at', artifact_link.created_at
           )) order by artifact_link.created_at, artifact_link.id), '[]'::jsonb)
    into v_artifact_links
    from (
      select *
        from public.grok_artifact_links source_link
       where source_link.session_id = p_session_id
         and source_link.organization_id = p_organization_id
       order by source_link.created_at, source_link.id
       limit 500
    ) artifact_link
    left join public.graph_artifacts graph_artifact
      on graph_artifact.id = artifact_link.graph_artifact_id
     and graph_artifact.organization_id = artifact_link.organization_id
    left join public.graph_runs graph_run
      on graph_run.id = graph_artifact.graph_run_id
     and graph_run.organization_id = graph_artifact.organization_id
    left join public.graphs graph
      on graph.id = graph_run.graph_id
     and graph.organization_id = graph_run.organization_id
    left join public.phase1c_run_artifacts phase1c_artifact
      on phase1c_artifact.id = artifact_link.phase1c_artifact_id
     and phase1c_artifact.organization_id = artifact_link.organization_id
    left join public.agent_runs phase1c_run
      on phase1c_run.id = phase1c_artifact.run_id
     and phase1c_run.organization_id = phase1c_artifact.organization_id
   where (
       (graph_artifact.id is not null and graph.project_id = v_session.project_id)
       or (phase1c_artifact.id is not null and phase1c_run.project_id = v_session.project_id)
     );

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(control_intent)
           order by control_intent.requested_at, control_intent.id), '[]'::jsonb)
    into v_control_intents
    from (
      select *
        from public.grok_control_intents control_intent
       where control_intent.session_id = p_session_id
         and control_intent.organization_id = p_organization_id
       order by control_intent.requested_at, control_intent.id
       limit 500
    ) control_intent;

  return pg_catalog.jsonb_build_object(
    'session', pg_catalog.to_jsonb(v_session),
    'messages', v_messages,
    'task_links', v_task_links,
    'events', v_events,
    'artifact_links', v_artifact_links,
    'control_intents', v_control_intents,
    'next', pg_catalog.jsonb_build_object(
      'message_sequence', v_session.last_message_sequence,
      'event_sequence', v_session.last_event_sequence
    )
  );
end;
$function$;

revoke all on function public.read_grok_session(uuid, uuid, bigint, bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.read_grok_session(uuid, uuid, bigint, bigint, integer)
  to authenticated;

create function public.append_grok_message_internal(
  p_organization_id uuid,
  p_session_id uuid,
  p_role text,
  p_content text,
  p_metadata jsonb,
  p_idempotency_key text,
  p_expected_sequence bigint,
  p_reply_to_message_id uuid,
  p_actor_user_id uuid
)
returns public.grok_messages
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_existing public.grok_messages;
  v_message public.grok_messages;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_role not in ('user', 'assistant', 'system', 'tool')
      or (p_role = 'user') <> (p_actor_user_id is not null)
      or p_expected_sequence is null or p_expected_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid grok message input';
  end if;

  -- Replay is checked before the sequence CAS. A timed-out request remains
  -- resumable after later messages have advanced the session.
  select message.* into v_existing
    from public.grok_messages message
   where message.organization_id = p_organization_id
     and message.session_id = p_session_id
     and message.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.role is not distinct from p_role
        and v_existing.content is not distinct from p_content
        and v_existing.metadata is not distinct from v_metadata
        and v_existing.reply_to_message_id is not distinct from p_reply_to_message_id
        and v_existing.actor_user_id is not distinct from p_actor_user_id then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok message idempotency key was reused with different input';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;
  if v_session.status <> 'active' then
    raise exception using errcode = '55000', message = 'grok_session_not_active';
  end if;

  -- Close the race between the optimistic replay read and the session lock.
  select message.* into v_existing
    from public.grok_messages message
   where message.organization_id = p_organization_id
     and message.session_id = p_session_id
     and message.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.role is not distinct from p_role
        and v_existing.content is not distinct from p_content
        and v_existing.metadata is not distinct from v_metadata
        and v_existing.reply_to_message_id is not distinct from p_reply_to_message_id
        and v_existing.actor_user_id is not distinct from p_actor_user_id then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok message idempotency key was reused with different input';
  end if;

  if v_session.last_message_sequence <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'stale_grok_message_sequence';
  end if;
  if p_reply_to_message_id is not null and not exists (
    select 1
      from public.grok_messages reply
     where reply.id = p_reply_to_message_id
       and reply.organization_id = p_organization_id
       and reply.session_id = p_session_id
       and reply.sequence_no <= v_session.last_message_sequence
  ) then
    raise exception using errcode = 'P0002', message = 'grok_reply_not_found';
  end if;

  insert into public.grok_messages (
    organization_id, project_id, session_id, sequence_no, role, content,
    metadata, reply_to_message_id, actor_user_id, idempotency_key
  ) values (
    p_organization_id, v_session.project_id, p_session_id,
    v_session.last_message_sequence + 1, p_role, p_content, v_metadata,
    p_reply_to_message_id, p_actor_user_id, p_idempotency_key
  ) returning * into v_message;

  update public.grok_sessions
     set last_message_sequence = last_message_sequence + 1,
         last_event_sequence = last_event_sequence + 1,
         version = version + 1,
         updated_at = pg_catalog.now()
   where id = p_session_id;

  insert into public.grok_events (
    organization_id, project_id, session_id, message_id, sequence_no,
    event_type, correlation_id, payload, actor_user_id
  ) values (
    p_organization_id, v_session.project_id, p_session_id, v_message.id,
    v_session.last_event_sequence + 1, 'message.appended', v_message.id,
    pg_catalog.jsonb_build_object(
      'message_id', v_message.id,
      'message_sequence', v_message.sequence_no,
      'role', v_message.role
    ),
    p_actor_user_id
  );

  return v_message;
end;
$function$;

revoke all on function public.append_grok_message_internal(
  uuid, uuid, text, text, jsonb, text, bigint, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.append_grok_user_message(
  p_organization_id uuid,
  p_session_id uuid,
  p_content text,
  p_metadata jsonb,
  p_idempotency_key text,
  p_expected_sequence bigint,
  p_reply_to_message_id uuid default null
)
returns public.grok_messages
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501', message = 'organization owner access is required';
  end if;
  return public.append_grok_message_internal(
    p_organization_id, p_session_id, 'user', p_content, p_metadata,
    p_idempotency_key, p_expected_sequence, p_reply_to_message_id, v_caller
  );
end;
$function$;

revoke all on function public.append_grok_user_message(
  uuid, uuid, text, jsonb, text, bigint, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.append_grok_user_message(
  uuid, uuid, text, jsonb, text, bigint, uuid
) to authenticated;

create function public.append_grok_message_as_server(
  p_organization_id uuid,
  p_session_id uuid,
  p_role text,
  p_content text,
  p_metadata jsonb,
  p_idempotency_key text,
  p_expected_sequence bigint,
  p_reply_to_message_id uuid default null
)
returns public.grok_messages
language sql
volatile
security definer
set search_path = pg_catalog
as $function$
  select public.append_grok_message_internal(
    p_organization_id, p_session_id, p_role, p_content, p_metadata,
    p_idempotency_key, p_expected_sequence, p_reply_to_message_id, null
  );
$function$;

revoke all on function public.append_grok_message_as_server(
  uuid, uuid, text, text, jsonb, text, bigint, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.append_grok_message_as_server(
  uuid, uuid, text, text, jsonb, text, bigint, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Server-only lineage and event writers. They validate the complete
-- tenant/project chain and are exact-replay safe.
-- ---------------------------------------------------------------------------

create function public.link_grok_task_as_server(
  p_organization_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_command_id uuid,
  p_task_id uuid,
  p_graph_id uuid,
  p_graph_run_id uuid,
  p_relation text
)
returns public.grok_task_links
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_existing public.grok_task_links;
  v_link public.grok_task_links;
  v_task_command_id uuid;
  v_run_graph_id uuid;
begin
  if pg_catalog.num_nonnulls(p_command_id, p_task_id, p_graph_id, p_graph_run_id) < 1
      or p_relation not in ('requested', 'planned', 'executing', 'result') then
    raise exception using errcode = '22023', message = 'invalid grok task link input';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.grok_messages message
     where message.id = p_message_id
       and message.organization_id = p_organization_id
       and message.session_id = p_session_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_message_not_found';
  end if;
  if p_command_id is not null and not exists (
    select 1 from public.commands command
     where command.id = p_command_id
       and command.organization_id = p_organization_id
       and command.project_id = v_session.project_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_engine_record_not_found';
  end if;
  if p_task_id is not null then
    select task.command_id into v_task_command_id
      from public.tasks task
     where task.id = p_task_id
       and task.organization_id = p_organization_id
       and task.project_id = v_session.project_id;
    if not found or (p_command_id is not null and v_task_command_id <> p_command_id) then
      raise exception using errcode = 'P0002', message = 'grok_engine_record_not_found';
    end if;
  end if;
  if p_graph_id is not null and not exists (
    select 1 from public.graphs graph
     where graph.id = p_graph_id
       and graph.organization_id = p_organization_id
       and graph.project_id = v_session.project_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_engine_record_not_found';
  end if;
  if p_graph_run_id is not null then
    select run.graph_id into v_run_graph_id
      from public.graph_runs run
      join public.graphs graph
        on graph.id = run.graph_id
       and graph.organization_id = run.organization_id
     where run.id = p_graph_run_id
       and run.organization_id = p_organization_id
       and graph.project_id = v_session.project_id;
    if not found or (p_graph_id is not null and v_run_graph_id <> p_graph_id) then
      raise exception using errcode = 'P0002', message = 'grok_engine_record_not_found';
    end if;
  end if;

  select task_link.* into v_existing
    from public.grok_task_links task_link
   where task_link.session_id = p_session_id
     and task_link.organization_id = p_organization_id
     and (
       (p_command_id is not null and task_link.command_id = p_command_id)
       or (p_task_id is not null and task_link.task_id = p_task_id)
       or (p_graph_id is not null and task_link.graph_id = p_graph_id)
       or (p_graph_run_id is not null and task_link.graph_run_id = p_graph_run_id)
     )
   limit 1;
  if found then
    if v_existing.message_id is not distinct from p_message_id
        and v_existing.command_id is not distinct from p_command_id
        and v_existing.task_id is not distinct from p_task_id
        and v_existing.graph_id is not distinct from p_graph_id
        and v_existing.graph_run_id is not distinct from p_graph_run_id
        and v_existing.relation is not distinct from p_relation then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok task link identity conflicts with existing evidence';
  end if;

  insert into public.grok_task_links (
    organization_id, project_id, session_id, message_id, command_id, task_id,
    graph_id, graph_run_id, relation
  ) values (
    p_organization_id, v_session.project_id, p_session_id, p_message_id,
    p_command_id, p_task_id, p_graph_id, p_graph_run_id, p_relation
  ) returning * into v_link;
  return v_link;
exception
  when unique_violation then
    select task_link.* into v_existing
      from public.grok_task_links task_link
     where task_link.session_id = p_session_id
       and task_link.organization_id = p_organization_id
       and (
         (p_command_id is not null and task_link.command_id = p_command_id)
         or (p_task_id is not null and task_link.task_id = p_task_id)
         or (p_graph_id is not null and task_link.graph_id = p_graph_id)
         or (p_graph_run_id is not null and task_link.graph_run_id = p_graph_run_id)
       )
     limit 1;
    if found
        and v_existing.message_id is not distinct from p_message_id
        and v_existing.command_id is not distinct from p_command_id
        and v_existing.task_id is not distinct from p_task_id
        and v_existing.graph_id is not distinct from p_graph_id
        and v_existing.graph_run_id is not distinct from p_graph_run_id
        and v_existing.relation is not distinct from p_relation then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok task link identity conflicts with existing evidence';
end;
$function$;

revoke all on function public.link_grok_task_as_server(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.link_grok_task_as_server(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text
) to service_role;

create function public.record_grok_event_as_server(
  p_organization_id uuid,
  p_session_id uuid,
  p_event_type text,
  p_correlation_id uuid,
  p_payload jsonb,
  p_expected_sequence bigint,
  p_message_id uuid default null,
  p_task_link_id uuid default null
)
returns public.grok_events
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_existing public.grok_events;
  v_event public.grok_events;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_event_type is null or p_correlation_id is null
      or p_expected_sequence is null or p_expected_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid grok event input';
  end if;

  -- Exact replay precedes the sequence CAS for resumability after timeout.
  select event.* into v_existing
    from public.grok_events event
   where event.organization_id = p_organization_id
     and event.session_id = p_session_id
     and event.correlation_id = p_correlation_id
     and event.event_type = p_event_type;
  if found then
    if v_existing.payload is not distinct from v_payload
        and v_existing.message_id is not distinct from p_message_id
        and v_existing.task_link_id is not distinct from p_task_link_id then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok event correlation was reused with different input';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  select event.* into v_existing
    from public.grok_events event
   where event.organization_id = p_organization_id
     and event.session_id = p_session_id
     and event.correlation_id = p_correlation_id
     and event.event_type = p_event_type;
  if found then
    if v_existing.payload is not distinct from v_payload
        and v_existing.message_id is not distinct from p_message_id
        and v_existing.task_link_id is not distinct from p_task_link_id then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok event correlation was reused with different input';
  end if;

  if v_session.last_event_sequence <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'stale_grok_event_sequence';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.grok_messages message
     where message.id = p_message_id
       and message.organization_id = p_organization_id
       and message.session_id = p_session_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_message_not_found';
  end if;
  if p_task_link_id is not null and not exists (
    select 1 from public.grok_task_links task_link
     where task_link.id = p_task_link_id
       and task_link.organization_id = p_organization_id
       and task_link.session_id = p_session_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_task_link_not_found';
  end if;

  insert into public.grok_events (
    organization_id, project_id, session_id, message_id, task_link_id,
    sequence_no, event_type, correlation_id, payload
  ) values (
    p_organization_id, v_session.project_id, p_session_id, p_message_id,
    p_task_link_id, v_session.last_event_sequence + 1, p_event_type,
    p_correlation_id, v_payload
  ) returning * into v_event;

  update public.grok_sessions
     set last_event_sequence = last_event_sequence + 1,
         version = version + 1,
         updated_at = pg_catalog.now()
   where id = p_session_id;

  return v_event;
end;
$function$;

revoke all on function public.record_grok_event_as_server(
  uuid, uuid, text, uuid, jsonb, bigint, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_event_as_server(
  uuid, uuid, text, uuid, jsonb, bigint, uuid, uuid
) to service_role;

create function public.link_grok_artifact_as_server(
  p_organization_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_task_link_id uuid,
  p_graph_artifact_id uuid,
  p_phase1c_artifact_id uuid,
  p_purpose text
)
returns public.grok_artifact_links
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_existing public.grok_artifact_links;
  v_link public.grok_artifact_links;
begin
  if pg_catalog.num_nonnulls(p_graph_artifact_id, p_phase1c_artifact_id) <> 1 then
    raise exception using errcode = '22023', message = 'exactly one grok artifact source is required';
  end if;
  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.grok_messages message
     where message.id = p_message_id
       and message.organization_id = p_organization_id
       and message.session_id = p_session_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_message_not_found';
  end if;
  if p_task_link_id is not null and not exists (
    select 1 from public.grok_task_links task_link
     where task_link.id = p_task_link_id
       and task_link.organization_id = p_organization_id
       and task_link.session_id = p_session_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_task_link_not_found';
  end if;
  if p_graph_artifact_id is not null and not exists (
    select 1
      from public.graph_artifacts artifact
      join public.graph_runs run
        on run.id = artifact.graph_run_id
       and run.organization_id = artifact.organization_id
      join public.graphs graph
        on graph.id = run.graph_id
       and graph.organization_id = run.organization_id
     where artifact.id = p_graph_artifact_id
       and artifact.organization_id = p_organization_id
       and graph.project_id = v_session.project_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_artifact_not_found';
  end if;
  if p_phase1c_artifact_id is not null and not exists (
    select 1
      from public.phase1c_run_artifacts artifact
      join public.agent_runs run
        on run.id = artifact.run_id
       and run.organization_id = artifact.organization_id
     where artifact.id = p_phase1c_artifact_id
       and artifact.organization_id = p_organization_id
       and run.project_id = v_session.project_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_artifact_not_found';
  end if;

  select artifact_link.* into v_existing
    from public.grok_artifact_links artifact_link
   where artifact_link.session_id = p_session_id
     and artifact_link.organization_id = p_organization_id
     and (
       (p_graph_artifact_id is not null
         and artifact_link.graph_artifact_id = p_graph_artifact_id)
       or (p_phase1c_artifact_id is not null
         and artifact_link.phase1c_artifact_id = p_phase1c_artifact_id)
     );
  if found then
    if v_existing.message_id is not distinct from p_message_id
        and v_existing.task_link_id is not distinct from p_task_link_id
        and v_existing.graph_artifact_id is not distinct from p_graph_artifact_id
        and v_existing.phase1c_artifact_id is not distinct from p_phase1c_artifact_id
        and v_existing.purpose is not distinct from p_purpose then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok artifact link conflicts with existing evidence';
  end if;

  insert into public.grok_artifact_links (
    organization_id, project_id, session_id, message_id, task_link_id,
    graph_artifact_id, phase1c_artifact_id, purpose
  ) values (
    p_organization_id, v_session.project_id, p_session_id, p_message_id,
    p_task_link_id, p_graph_artifact_id, p_phase1c_artifact_id, p_purpose
  ) returning * into v_link;
  return v_link;
exception
  when unique_violation then
    select artifact_link.* into v_existing
      from public.grok_artifact_links artifact_link
     where artifact_link.session_id = p_session_id
       and artifact_link.organization_id = p_organization_id
       and (
         (p_graph_artifact_id is not null
           and artifact_link.graph_artifact_id = p_graph_artifact_id)
         or (p_phase1c_artifact_id is not null
           and artifact_link.phase1c_artifact_id = p_phase1c_artifact_id)
       );
    if found
        and v_existing.message_id is not distinct from p_message_id
        and v_existing.task_link_id is not distinct from p_task_link_id
        and v_existing.graph_artifact_id is not distinct from p_graph_artifact_id
        and v_existing.phase1c_artifact_id is not distinct from p_phase1c_artifact_id
        and v_existing.purpose is not distinct from p_purpose then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok artifact link conflicts with existing evidence';
end;
$function$;

revoke all on function public.link_grok_artifact_as_server(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.link_grok_artifact_as_server(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Control intents: durable request/decision evidence around the already
-- reviewed pause, withdraw, gate, cancel and retry functions. Neither function
-- below invokes an action on its own.
-- ---------------------------------------------------------------------------

create function public.request_grok_control_intent(
  p_organization_id uuid,
  p_session_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text
)
returns public.grok_control_intents
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_session public.grok_sessions;
  v_existing public.grok_control_intents;
  v_intent public.grok_control_intents;
  v_graph_id uuid;
  v_graph_run_id uuid;
  v_task_id uuid;
  v_gate_id uuid;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501', message = 'organization owner access is required';
  end if;
  if p_target_id is null or p_target_kind not in ('graph', 'graph_run', 'task', 'gate')
      or p_action not in ('pause', 'resume', 'withdraw', 'cancel', 'retry', 'approve', 'reject') then
    raise exception using errcode = '22023', message = 'invalid grok control intent input';
  end if;
  if (p_target_kind = 'graph' and p_action not in ('pause', 'resume', 'withdraw'))
      or (p_target_kind in ('graph_run', 'task') and p_action not in ('cancel', 'retry'))
      or (p_target_kind = 'gate' and p_action not in ('approve', 'reject')) then
    raise exception using errcode = '22023', message = 'grok control action does not match its target';
  end if;
  if p_action in ('cancel', 'retry', 'approve', 'reject')
      and not public.has_organization_role(
        p_organization_id,
        array['owner'::public.organization_member_role,
              'admin'::public.organization_member_role]
      ) then
    raise exception using errcode = '42501', message = 'owner or administrator access is required';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  select intent.* into v_existing
    from public.grok_control_intents intent
   where intent.session_id = p_session_id
     and intent.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.target_kind is not distinct from p_target_kind
        and coalesce(v_existing.graph_id, v_existing.graph_run_id,
                     v_existing.task_id, v_existing.gate_id) = p_target_id
        and v_existing.action is not distinct from p_action
        and v_existing.reason is not distinct from p_reason then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok control idempotency key was reused with different input';
  end if;

  if p_target_kind = 'graph' then
    if not exists (
      select 1 from public.graphs graph
       where graph.id = p_target_id
         and graph.organization_id = p_organization_id
         and graph.project_id = v_session.project_id
    ) then
      raise exception using errcode = 'P0002', message = 'grok_control_target_not_found';
    end if;
    v_graph_id := p_target_id;
  elsif p_target_kind = 'graph_run' then
    if not exists (
      select 1 from public.graph_runs run
      join public.graphs graph
        on graph.id = run.graph_id and graph.organization_id = run.organization_id
       where run.id = p_target_id
         and run.organization_id = p_organization_id
         and graph.project_id = v_session.project_id
    ) then
      raise exception using errcode = 'P0002', message = 'grok_control_target_not_found';
    end if;
    v_graph_run_id := p_target_id;
  elsif p_target_kind = 'task' then
    if not exists (
      select 1 from public.tasks task
       where task.id = p_target_id
         and task.organization_id = p_organization_id
         and task.project_id = v_session.project_id
    ) then
      raise exception using errcode = 'P0002', message = 'grok_control_target_not_found';
    end if;
    v_task_id := p_target_id;
  else
    if not exists (
      select 1 from public.graph_gates gate
      join public.graphs graph
        on graph.id = gate.graph_id and graph.organization_id = gate.organization_id
       where gate.id = p_target_id
         and gate.organization_id = p_organization_id
         and graph.project_id = v_session.project_id
    ) then
      raise exception using errcode = 'P0002', message = 'grok_control_target_not_found';
    end if;
    v_gate_id := p_target_id;
  end if;

  insert into public.grok_control_intents (
    organization_id, project_id, session_id, target_kind, graph_id,
    graph_run_id, task_id, gate_id, action, reason, idempotency_key, requested_by
  ) values (
    p_organization_id, v_session.project_id, p_session_id, p_target_kind,
    v_graph_id, v_graph_run_id, v_task_id, v_gate_id, p_action, p_reason,
    p_idempotency_key, v_caller
  ) returning * into v_intent;

  update public.grok_sessions
     set last_event_sequence = last_event_sequence + 1,
         version = version + 1,
         updated_at = pg_catalog.now()
   where id = p_session_id;

  insert into public.grok_events (
    organization_id, project_id, session_id, sequence_no, event_type,
    correlation_id, payload, actor_user_id
  ) values (
    p_organization_id, v_session.project_id, p_session_id,
    v_session.last_event_sequence + 1, 'control.requested', v_intent.id,
    pg_catalog.jsonb_build_object(
      'intent_id', v_intent.id,
      'target_kind', p_target_kind,
      'target_id', p_target_id,
      'action', p_action
    ),
    v_caller
  );
  return v_intent;
exception
  when unique_violation then
    select intent.* into v_existing
      from public.grok_control_intents intent
     where intent.session_id = p_session_id
       and intent.idempotency_key = p_idempotency_key;
    if found
        and v_existing.target_kind is not distinct from p_target_kind
        and coalesce(v_existing.graph_id, v_existing.graph_run_id,
                     v_existing.task_id, v_existing.gate_id) = p_target_id
        and v_existing.action is not distinct from p_action
        and v_existing.reason is not distinct from p_reason then
      return v_existing;
    end if;
    raise exception using errcode = '22023', message = 'grok control idempotency key was reused with different input';
end;
$function$;

revoke all on function public.request_grok_control_intent(
  uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_grok_control_intent(
  uuid, uuid, text, uuid, text, text, text
) to authenticated;

create function public.resolve_grok_control_intent_as_server(
  p_organization_id uuid,
  p_intent_id uuid,
  p_state text,
  p_failure_code text default null,
  p_failure_detail text default null
)
returns public.grok_control_intents
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_intent public.grok_control_intents;
  v_session public.grok_sessions;
begin
  if p_state not in ('accepted', 'rejected', 'applied', 'failed', 'superseded') then
    raise exception using errcode = '22023', message = 'invalid grok control resolution';
  end if;
  if (p_state = 'failed') <> (p_failure_code is not null)
      or (p_state <> 'failed' and p_failure_detail is not null) then
    raise exception using errcode = '22023', message = 'invalid grok control failure evidence';
  end if;

  select intent.* into v_intent
    from public.grok_control_intents intent
   where intent.id = p_intent_id
     and intent.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_control_intent_not_found';
  end if;
  if v_intent.state = p_state then
    if v_intent.failure_code is not distinct from p_failure_code
        and v_intent.failure_detail is not distinct from p_failure_detail then
      return v_intent;
    end if;
    raise exception using errcode = '22023', message = 'grok control resolution conflicts with existing evidence';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = v_intent.session_id
     and session.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  update public.grok_control_intents
     set state = p_state,
         decided_at = case
           when p_state in ('accepted', 'rejected', 'applied', 'failed', 'superseded')
             then pg_catalog.now()
           else decided_at
         end,
         applied_at = case when p_state = 'applied' then pg_catalog.now() end,
         failure_code = p_failure_code,
         failure_detail = p_failure_detail,
         updated_at = pg_catalog.now()
   where id = p_intent_id
   returning * into v_intent;

  update public.grok_sessions
     set last_event_sequence = last_event_sequence + 1,
         version = version + 1,
         updated_at = pg_catalog.now()
   where id = v_intent.session_id;

  insert into public.grok_events (
    organization_id, project_id, session_id, sequence_no, event_type,
    correlation_id, payload
  ) values (
    p_organization_id, v_session.project_id, v_session.id,
    v_session.last_event_sequence + 1, 'control.' || p_state, v_intent.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'intent_id', v_intent.id,
      'state', p_state,
      'failure_code', p_failure_code
    ))
  );
  return v_intent;
end;
$function$;

revoke all on function public.resolve_grok_control_intent_as_server(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_grok_control_intent_as_server(
  uuid, uuid, text, text, text
) to service_role;

create function public.set_grok_session_status_as_server(
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
  if p_status not in ('completed', 'cancelled', 'archived') then
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
  if v_session.status = p_status then
    return v_session;
  end if;
  if v_session.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_grok_session_version';
  end if;

  update public.grok_sessions
     set status = p_status,
         closed_at = coalesce(closed_at, pg_catalog.now()),
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
