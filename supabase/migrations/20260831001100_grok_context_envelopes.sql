-- Durable, bounded Grok context and follow-up turns.
--
-- Binary files are deliberately excluded. Text attachments are secret-scanned
-- and bounded; images and URLs are immutable references and are never fetched
-- by this control-plane boundary. No worker, run, graph, or automatic action is
-- created here.

create table public.grok_context_envelopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid not null,
  item_count integer not null check (item_count between 2 and 12),
  total_bytes integer not null check (total_bytes between 0 and 49152),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  replan_required boolean not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint grok_context_envelopes_id_scope_unique
    unique (id, organization_id, session_id),
  constraint grok_context_envelopes_message_unique unique (session_id, message_id),
  constraint grok_context_envelopes_idempotency_unique unique (session_id, idempotency_key),
  constraint grok_context_envelopes_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_context_envelopes_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict
);

create table public.grok_context_items (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 12),
  kind text not null check (kind in ('file', 'image', 'url', 'repository', 'project', 'integration')),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  state text not null check (state in ('captured', 'reference_only')),
  media_type text check (media_type is null or char_length(media_type) between 1 and 120),
  source_url text,
  repository_path text,
  integration_id uuid,
  content_text text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 0 and 16384),
  created_at timestamptz not null default now(),
  constraint grok_context_items_id_scope_unique unique (id, organization_id, session_id),
  constraint grok_context_items_envelope_ordinal_unique unique (envelope_id, ordinal),
  constraint grok_context_items_envelope_fk
    foreign key (envelope_id, organization_id, session_id)
    references public.grok_context_envelopes(id, organization_id, session_id) on delete restrict,
  constraint grok_context_items_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_context_items_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_context_items_integration_fk
    foreign key (integration_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint grok_context_items_label_no_secret check (not public.text_has_likely_secret(label)),
  constraint grok_context_items_content_no_secret
    check (content_text is null or not public.text_has_likely_secret(content_text)),
  constraint grok_context_items_reference_no_secret
    check (not public.text_has_likely_secret(coalesce(source_url, '') || E'\n' || coalesce(repository_path, ''))),
  constraint grok_context_items_shape check (
    (kind = 'file' and state = 'captured' and content_text is not null
      and media_type in ('text/plain', 'text/markdown', 'application/json', 'application/yaml', 'application/x-yaml', 'text/csv')
      and source_url is null and repository_path is null and integration_id is null
      and content_sha256 is not null and byte_size = octet_length(content_text))
    or (kind = 'image' and state = 'reference_only' and source_url is not null
      and (media_type is null or media_type ~ '^image/[a-z0-9.+-]{1,80}$') and repository_path is null
      and integration_id is null and content_text is null and content_sha256 is null and byte_size = 0)
    or (kind = 'url' and state = 'reference_only' and source_url is not null
      and media_type is null and repository_path is null and integration_id is null
      and content_text is null and content_sha256 is null and byte_size = 0)
    or (kind in ('repository', 'project') and state = 'reference_only'
      and media_type is null and integration_id is null and content_text is null
      and content_sha256 is null and byte_size = 0)
    or (kind = 'integration' and state = 'reference_only' and integration_id is not null
      and media_type is null and source_url is null and repository_path is null
      and content_text is null and content_sha256 is null and byte_size = 0)
  )
);

create index grok_context_envelopes_session_created_idx
  on public.grok_context_envelopes (session_id, created_at, id);
create index grok_context_items_session_created_idx
  on public.grok_context_items (session_id, created_at, id);

comment on table public.grok_context_envelopes is
  'Append-only tenant/project/message context receipts. They dispatch nothing and never contain credentials.';
comment on table public.grok_context_items is
  'Bounded text or reference-only Grok context. URLs are recorded, never fetched by this boundary.';

create trigger grok_context_envelopes_immutable
before update or delete on public.grok_context_envelopes
for each row execute function public.reject_grok_evidence_mutation();
create trigger grok_context_envelopes_no_truncate
before truncate on public.grok_context_envelopes
for each statement execute function public.reject_grok_evidence_mutation();
create trigger grok_context_items_immutable
before update or delete on public.grok_context_items
for each row execute function public.reject_grok_evidence_mutation();
create trigger grok_context_items_no_truncate
before truncate on public.grok_context_items
for each statement execute function public.reject_grok_evidence_mutation();

do $grok_context_rls$
declare
  v_table text;
begin
  foreach v_table in array array['grok_context_envelopes', 'grok_context_items'] loop
    execute pg_catalog.format('alter table public.%I enable row level security', v_table);
    execute pg_catalog.format('alter table public.%I force row level security', v_table);
    execute pg_catalog.format(
      'create policy %I on public.%I for select to authenticated using (public.is_organization_member(organization_id))',
      v_table || '_select_member', v_table
    );
    execute pg_catalog.format(
      'revoke all on table public.%I from public, anon, authenticated, service_role', v_table
    );
  end loop;
end;
$grok_context_rls$;

create function public.record_grok_context_envelope_internal(
  p_organization_id uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_expected_event_sequence bigint,
  p_created_by uuid,
  p_replan_required boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_message public.grok_messages;
  v_project public.projects;
  v_existing public.grok_context_envelopes;
  v_envelope public.grok_context_envelopes;
  v_item jsonb;
  v_ordinal integer;
  v_kind text;
  v_label text;
  v_media_type text;
  v_source_url text;
  v_repository_path text;
  v_integration_id uuid;
  v_content_text text;
  v_byte_size integer;
  v_total_bytes integer := 0;
  v_existing_count integer;
  v_existing_bytes bigint;
  v_input_sha256 text;
  v_content_sha256 text;
begin
  if p_organization_id is null or p_project_id is null or p_session_id is null
      or p_message_id is null or p_created_by is null or p_replan_required is null
      or p_expected_event_sequence is null or p_expected_event_sequence < 0
      or p_idempotency_key is null
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
      or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_items) not between 2 and 12 then
    raise exception using errcode = '22023', message = 'invalid grok context envelope input';
  end if;

  v_input_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('items', p_items, 'replanRequired', p_replan_required)::text,
    'UTF8'
  )), 'hex');

  select envelope.* into v_existing
    from public.grok_context_envelopes envelope
   where envelope.organization_id = p_organization_id
     and envelope.session_id = p_session_id
     and envelope.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.project_id is distinct from p_project_id
        or v_existing.message_id is distinct from p_message_id
        or v_existing.created_by is distinct from p_created_by
        or v_existing.input_sha256 is distinct from v_input_sha256
        or v_existing.replan_required is distinct from p_replan_required then
      raise exception using errcode = '22023', message = 'grok context idempotency key was reused with different input';
    end if;
    return pg_catalog.jsonb_build_object(
      'envelope', pg_catalog.to_jsonb(v_existing), 'replayed', true
    );
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found or v_session.project_id is distinct from p_project_id
      or v_session.created_by is distinct from p_created_by then
    raise exception using errcode = '42501', message = 'grok context owner, tenant, project, or session identity mismatch';
  end if;
  if v_session.status not in ('active', 'blocked') then
    raise exception using errcode = '55000', message = 'grok_session_not_active';
  end if;

  select project.* into v_project
    from public.projects project
   where project.id = p_project_id
     and project.organization_id = p_organization_id
     and project.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'project_not_found';
  end if;
  select message.* into v_message
    from public.grok_messages message
     where message.id = p_message_id and message.organization_id = p_organization_id
       and message.project_id = p_project_id and message.session_id = p_session_id
       and message.role = 'user' and message.actor_user_id = p_created_by;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok_user_message_not_found';
  end if;
  if v_session.status = 'blocked'
      and (p_replan_required or v_message.sequence_no <> 1) then
    raise exception using errcode = '55000', message = 'blocked grok context may bind only the initial user request';
  end if;
  if v_session.last_event_sequence <> p_expected_event_sequence then
    raise exception using errcode = '40001', message = 'stale_grok_context_event_sequence';
  end if;

  for v_item, v_ordinal in
    select entry.value, entry.ordinality::integer
      from pg_catalog.jsonb_array_elements(p_items) with ordinality entry(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_item) item_key
           where item_key not in (
             'kind', 'label', 'media_type', 'source_url', 'repository_path',
             'integration_id', 'content_text', 'byte_size', 'state'
           )
        ) then
      raise exception using errcode = '22023', message = 'invalid grok context item shape';
    end if;
    v_kind := v_item ->> 'kind';
    v_label := v_item ->> 'label';
    v_media_type := v_item ->> 'media_type';
    v_source_url := v_item ->> 'source_url';
    v_repository_path := v_item ->> 'repository_path';
    v_content_text := v_item ->> 'content_text';
    begin
      v_integration_id := nullif(v_item ->> 'integration_id', '')::uuid;
      v_byte_size := (v_item ->> 'byte_size')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'invalid grok context item scalar';
    end;
    if v_kind not in ('file', 'image', 'url', 'repository', 'project', 'integration')
        or v_label is null or v_label is distinct from pg_catalog.btrim(v_label)
        or pg_catalog.char_length(v_label) not between 1 and 160
        or public.text_has_likely_secret(v_label)
        or v_byte_size is null or v_byte_size not between 0 and 16384
        or public.text_has_likely_secret(coalesce(v_source_url, '') || E'\n'
          || coalesce(v_repository_path, '') || E'\n' || coalesce(v_content_text, '')) then
      raise exception using errcode = '22023', message = 'invalid or secret-shaped grok context item';
    end if;
    if v_ordinal = 1 and not (
      v_kind = 'project' and v_label = v_project.name
      and v_source_url is not distinct from v_project.production_url
      and v_repository_path is null and v_integration_id is null
      and v_media_type is null and v_content_text is null and v_byte_size = 0
      and v_item ->> 'state' = 'reference_only'
    ) then
      raise exception using errcode = '22023', message = 'the first context item must match the exact project';
    elsif v_ordinal = 2 and not (
      v_kind = 'repository' and v_label = v_project.github_repository
      and v_repository_path = v_project.default_branch and v_source_url is null
      and v_integration_id is null and v_media_type is null
      and v_content_text is null and v_byte_size = 0
      and v_item ->> 'state' = 'reference_only'
    ) then
      raise exception using errcode = '22023', message = 'the second context item must match the exact repository';
    elsif v_ordinal > 2 then
      if v_kind = 'project' then
        raise exception using errcode = '22023', message = 'project context is derived by the server';
      elsif v_kind = 'file' and not (
        v_item ->> 'state' = 'captured' and v_content_text is not null
        and v_media_type in ('text/plain', 'text/markdown', 'application/json', 'application/yaml', 'application/x-yaml', 'text/csv')
        and v_source_url is null and v_repository_path is null and v_integration_id is null
        and v_byte_size = pg_catalog.octet_length(v_content_text)
      ) then
        raise exception using errcode = '22023', message = 'invalid bounded file context';
      elsif v_kind = 'image' and not (
        v_item ->> 'state' = 'reference_only' and public.project_production_url_is_safe(v_source_url)
        and (v_media_type is null or v_media_type ~ '^image/[a-z0-9.+-]{1,80}$') and v_repository_path is null
        and v_integration_id is null and v_content_text is null and v_byte_size = 0
      ) then
        raise exception using errcode = '22023', message = 'invalid image reference context';
      elsif v_kind = 'url' and not (
        v_item ->> 'state' = 'reference_only' and public.project_production_url_is_safe(v_source_url)
        and v_media_type is null and v_repository_path is null
        and v_integration_id is null and v_content_text is null and v_byte_size = 0
      ) then
        raise exception using errcode = '22023', message = 'invalid URL reference context';
      elsif v_kind = 'repository' and not (
        v_item ->> 'state' = 'reference_only' and v_repository_path is not null
        and pg_catalog.char_length(v_repository_path) between 1 and 300
        and v_repository_path !~ '(^/|[\\]|(^|/)\.\.?(/|$)|[[:cntrl:]])'
        and v_source_url is null and v_media_type is null and v_integration_id is null
        and v_content_text is null and v_byte_size = 0
      ) then
        raise exception using errcode = '22023', message = 'invalid repository reference context';
      elsif v_kind = 'integration' and not (
        v_item ->> 'state' = 'reference_only' and v_integration_id is not null
        and v_source_url is null and v_repository_path is null and v_media_type is null
        and v_content_text is null and v_byte_size = 0
        and exists (
          select 1
            from public.project_connections link
            join public.connections connection
              on connection.id = link.connection_id
             and connection.organization_id = link.organization_id
           where link.organization_id = p_organization_id
             and link.project_id = p_project_id
             and link.connection_id = v_integration_id
        )
      ) then
        raise exception using errcode = '42501', message = 'integration context does not match this tenant project';
      end if;
    end if;
    v_total_bytes := v_total_bytes + v_byte_size;
  end loop;
  if v_total_bytes > 49152 then
    raise exception using errcode = '22023', message = 'grok context envelope exceeds 48 KB';
  end if;

  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(item.byte_size), 0)
    into v_existing_count, v_existing_bytes
    from public.grok_context_items item
   where item.organization_id = p_organization_id and item.session_id = p_session_id;
  if v_existing_count + pg_catalog.jsonb_array_length(p_items) > 64
      or v_existing_bytes + v_total_bytes > 262144 then
    raise exception using errcode = '54000', message = 'grok session context limit reached';
  end if;

  -- Close the replay race after the session lock.
  select envelope.* into v_existing
    from public.grok_context_envelopes envelope
   where envelope.organization_id = p_organization_id
     and envelope.session_id = p_session_id
     and envelope.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.project_id is distinct from p_project_id
        or v_existing.message_id is distinct from p_message_id
        or v_existing.created_by is distinct from p_created_by
        or v_existing.input_sha256 is distinct from v_input_sha256
        or v_existing.replan_required is distinct from p_replan_required then
      raise exception using errcode = '22023', message = 'grok context idempotency key was reused with different input';
    end if;
    return pg_catalog.jsonb_build_object('envelope', pg_catalog.to_jsonb(v_existing), 'replayed', true);
  end if;

  insert into public.grok_context_envelopes (
    organization_id, project_id, session_id, message_id, item_count,
    total_bytes, input_sha256, idempotency_key, replan_required, created_by
  ) values (
    p_organization_id, p_project_id, p_session_id, p_message_id,
    pg_catalog.jsonb_array_length(p_items), v_total_bytes, v_input_sha256,
    p_idempotency_key, p_replan_required, p_created_by
  ) returning * into v_envelope;

  for v_item, v_ordinal in
    select entry.value, entry.ordinality::integer
      from pg_catalog.jsonb_array_elements(p_items) with ordinality entry(value, ordinality)
  loop
    v_content_text := v_item ->> 'content_text';
    v_content_sha256 := case when v_content_text is null then null else
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_content_text, 'UTF8')), 'hex') end;
    insert into public.grok_context_items (
      envelope_id, organization_id, project_id, session_id, message_id, ordinal,
      kind, label, state, media_type, source_url, repository_path,
      integration_id, content_text, content_sha256, byte_size
    ) values (
      v_envelope.id, p_organization_id, p_project_id, p_session_id, p_message_id,
      v_ordinal, v_item ->> 'kind', v_item ->> 'label', v_item ->> 'state',
      v_item ->> 'media_type', v_item ->> 'source_url', v_item ->> 'repository_path',
      nullif(v_item ->> 'integration_id', '')::uuid, v_content_text, v_content_sha256,
      (v_item ->> 'byte_size')::integer
    );
  end loop;

  update public.grok_sessions
     set last_event_sequence = last_event_sequence + 1,
         version = version + 1,
         updated_at = pg_catalog.now()
   where id = p_session_id;
  insert into public.grok_events (
    organization_id, project_id, session_id, message_id, sequence_no,
    event_type, correlation_id, payload, actor_user_id
  ) values (
    p_organization_id, p_project_id, p_session_id, p_message_id,
    v_session.last_event_sequence + 1, 'context.recorded', v_envelope.id,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'envelopeId', v_envelope.id,
      'itemCount', v_envelope.item_count, 'totalBytes', v_envelope.total_bytes,
      'replanRequired', v_envelope.replan_required,
      'workerWoken', false, 'executionStarted', false
    ), p_created_by
  );

  return pg_catalog.jsonb_build_object(
    'envelope', pg_catalog.to_jsonb(v_envelope), 'replayed', false
  );
end;
$function$;

revoke all on function public.record_grok_context_envelope_internal(
  uuid, uuid, uuid, uuid, jsonb, text, bigint, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.record_grok_context_envelope_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_expected_event_sequence bigint,
  p_replan_required boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_requested_by is null or not exists (
    select 1 from public.organization_members member
     where member.organization_id = p_organization_id
       and member.user_id = p_requested_by
       and member.role = 'owner'::public.organization_member_role
  ) then
    raise exception using errcode = '42501', message = 'an exact organization owner request identity is required';
  end if;
  return public.record_grok_context_envelope_internal(
    p_organization_id, p_project_id, p_session_id, p_message_id, p_items,
    p_idempotency_key, p_expected_event_sequence, p_requested_by, p_replan_required
  );
end;
$function$;

revoke all on function public.record_grok_context_envelope_as_server(
  uuid, uuid, uuid, uuid, uuid, jsonb, text, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_context_envelope_as_server(
  uuid, uuid, uuid, uuid, uuid, jsonb, text, bigint, boolean
) to service_role;

create function public.append_grok_follow_up_context(
  p_organization_id uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_content text,
  p_items jsonb,
  p_idempotency_key text,
  p_expected_message_sequence bigint,
  p_expected_event_sequence bigint,
  p_reply_to_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_message public.grok_messages;
  v_context jsonb;
  v_replan_required boolean;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.has_organization_role(
    p_organization_id, array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501', message = 'organization owner access is required';
  end if;
  if p_project_id is null or p_content is null
      or pg_catalog.char_length(pg_catalog.btrim(p_content)) not between 1 and 4000
      or public.text_has_likely_secret(p_content)
      or p_expected_message_sequence is null or p_expected_message_sequence < 1
      or p_expected_event_sequence is null or p_expected_event_sequence < 1 then
    raise exception using errcode = '22023', message = 'invalid grok follow-up input';
  end if;
  if not exists (
    select 1 from public.grok_sessions session
     where session.id = p_session_id and session.organization_id = p_organization_id
       and session.project_id = p_project_id and session.created_by = v_caller
  ) then
    raise exception using errcode = '42501', message = 'grok follow-up tenant, project, or owner mismatch';
  end if;
  v_replan_required := exists (
    select 1 from public.grok_messages message
     where message.organization_id = p_organization_id
       and message.session_id = p_session_id
       and message.role = 'assistant' and message.metadata ->> 'kind' = 'grok.plan'
  );
  v_message := public.append_grok_message_internal(
    p_organization_id, p_session_id, 'user', p_content,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'kind', 'grok.follow_up',
      'planChanged', false, 'replanRequired', v_replan_required
    ), p_idempotency_key, p_expected_message_sequence, p_reply_to_message_id, v_caller
  );
  v_context := public.record_grok_context_envelope_internal(
    p_organization_id, p_project_id, p_session_id, v_message.id, p_items,
    case when pg_catalog.char_length(p_idempotency_key || ':context') <= 128
      then p_idempotency_key || ':context'
      else 'grok:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        p_idempotency_key || ':context', 'UTF8')), 'hex') end,
    p_expected_event_sequence + 1, v_caller, v_replan_required
  );
  return pg_catalog.jsonb_build_object(
    'message', pg_catalog.to_jsonb(v_message),
    'envelope', v_context -> 'envelope',
    'replayed', coalesce((v_context ->> 'replayed')::boolean, false),
    'plan_changed', false,
    'replan_required', v_replan_required
  );
end;
$function$;

revoke all on function public.append_grok_follow_up_context(
  uuid, uuid, uuid, text, jsonb, text, bigint, bigint, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.append_grok_follow_up_context(
  uuid, uuid, uuid, text, jsonb, text, bigint, bigint, uuid
) to authenticated;

create function public.list_grok_context_envelopes(
  p_organization_id uuid,
  p_session_id uuid,
  p_limit integer default 64
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_result jsonb;
begin
  if not public.has_organization_role(
    p_organization_id, array['owner'::public.organization_member_role]
  ) then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;
  if p_limit is null or p_limit not between 1 and 64 then
    raise exception using errcode = '22023', message = 'invalid grok context read limit';
  end if;
  if not exists (
    select 1 from public.grok_sessions session
     where session.id = p_session_id and session.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'grok_session_not_found';
  end if;

  select coalesce(pg_catalog.jsonb_agg(envelope.value order by envelope.created_at, envelope.id), '[]'::jsonb)
    into v_result
    from (
      select source.created_at, source.id,
        pg_catalog.jsonb_build_object(
          'id', source.id,
          'message_id', source.message_id,
          'item_count', source.item_count,
          'total_bytes', source.total_bytes,
          'input_sha256', source.input_sha256,
          'replan_required', source.replan_required,
          'created_at', source.created_at,
          'items', (
            select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'id', item.id, 'kind', item.kind, 'label', item.label,
              'state', item.state, 'media_type', item.media_type,
              'source_url', item.source_url, 'repository_path', item.repository_path,
              'integration_id', item.integration_id,
              'text_preview', case when item.content_text is null then null
                else pg_catalog.left(item.content_text, 500) end,
              'byte_size', item.byte_size
            ) order by item.ordinal), '[]'::jsonb)
              from public.grok_context_items item
             where item.envelope_id = source.id
               and item.organization_id = p_organization_id
               and item.session_id = p_session_id
          )
        ) value
        from (
          select * from public.grok_context_envelopes source_envelope
           where source_envelope.organization_id = p_organization_id
             and source_envelope.session_id = p_session_id
           order by source_envelope.created_at, source_envelope.id
           limit p_limit
        ) source
    ) envelope;
  return v_result;
end;
$function$;

revoke all on function public.list_grok_context_envelopes(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_grok_context_envelopes(uuid, uuid, integer)
  to authenticated;

do $grok_context_postflight$
declare
  v_internal regprocedure := pg_catalog.to_regprocedure(
    'public.record_grok_context_envelope_internal(uuid,uuid,uuid,uuid,jsonb,text,bigint,uuid,boolean)'
  );
  v_server regprocedure := pg_catalog.to_regprocedure(
    'public.record_grok_context_envelope_as_server(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,boolean)'
  );
  v_follow_up regprocedure := pg_catalog.to_regprocedure(
    'public.append_grok_follow_up_context(uuid,uuid,uuid,text,jsonb,text,bigint,bigint,uuid)'
  );
  v_list regprocedure := pg_catalog.to_regprocedure(
    'public.list_grok_context_envelopes(uuid,uuid,integer)'
  );
begin
  if 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and relation.relkind = 'r'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or exists (
    select 1
      from information_schema.role_table_grants privilege
     where privilege.table_schema = 'public'
       and privilege.table_name in ('grok_context_envelopes', 'grok_context_items')
       and privilege.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context relation postflight failed';
  end if;

  if 2 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and (
         (relation.relname = 'grok_context_envelopes'
           and policy.polname = 'grok_context_envelopes_select_member')
         or (relation.relname = 'grok_context_items'
           and policy.polname = 'grok_context_items_select_member')
       )
       and policy.polcmd = 'r'
       and policy.polroles = array[
         (select role.oid from pg_catalog.pg_roles role where role.rolname = 'authenticated')
       ]
       and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
         like '%is_organization_member(organization_id)%'
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context policy postflight failed';
  end if;

  if 4 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_trigger trigger
      join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in ('grok_context_envelopes', 'grok_context_items')
       and trigger.tgname in (
         'grok_context_envelopes_immutable', 'grok_context_envelopes_no_truncate',
         'grok_context_items_immutable', 'grok_context_items_no_truncate'
       )
       and not trigger.tgisinternal
       and trigger.tgfoid = pg_catalog.to_regprocedure(
         'public.reject_grok_evidence_mutation()'
       )
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context trigger postflight failed';
  end if;

  if v_internal is null or v_server is null or v_follow_up is null or v_list is null then
    raise exception using errcode = '55000',
      message = 'Grok context function identity postflight failed: signature missing';
  end if;
  if 4 is distinct from (
    select pg_catalog.count(*)::integer
      from pg_catalog.pg_proc routine
     where routine.oid in (v_internal, v_server, v_follow_up, v_list)
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context function identity postflight failed: overload count';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid in (v_internal, v_server, v_follow_up, v_list)
       and not routine.prosecdef
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context function identity postflight failed: SECURITY DEFINER';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid in (v_internal, v_server, v_follow_up, v_list)
       and not coalesce(routine.proconfig, array[]::text[])
         @> array['search_path=pg_catalog']::text[]
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context function identity postflight failed: search_path';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid in (v_internal, v_server, v_follow_up, v_list)
       and ((routine.oid = v_list and routine.provolatile <> 's')
         or (routine.oid <> v_list and routine.provolatile <> 'v'))
  ) then
    raise exception using errcode = '55000',
      message = 'Grok context function identity postflight failed: volatility';
  end if;

  if pg_catalog.has_function_privilege('anon', v_internal, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_internal, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_internal, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_server, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_server, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', v_server, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_follow_up, 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', v_follow_up, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_follow_up, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_list, 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', v_list, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_list, 'EXECUTE')
  then
    raise exception using errcode = '55000',
      message = 'Grok context function ACL postflight failed';
  end if;
end;
$grok_context_postflight$;
