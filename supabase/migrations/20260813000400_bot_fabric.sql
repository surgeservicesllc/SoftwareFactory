-- Bot fabric: provider-neutral bots, owner-authored roles, and project
-- assignments.
--
-- Boundaries this migration deliberately preserves:
--   * A bot row is metadata plus an opaque reference to server-side secret
--     material. No credential value is ever stored, and privileged reference
--     names are rejected at the table boundary.
--   * Readiness is configuration evidence only. It never asserts that a
--     provider session exists, and no executor is introduced here.
--   * Authenticated callers receive SELECT only. Every mutation runs through a
--     narrow SECURITY DEFINER function that revalidates the caller, the tenant,
--     and the exact resource, then appends immutable activity evidence.

create type public.bot_provider as enum (
  'anthropic', 'openai', 'google', 'xai', 'mistral',
  'deepseek', 'groq', 'openrouter', 'selfhosted', 'custom'
);
create type public.bot_readiness as enum ('not_connected', 'ready', 'blocked', 'disabled');
create type public.bot_assignment_status as enum ('active', 'paused', 'released');

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  provider public.bot_provider not null,
  model text not null check (char_length(btrim(model)) between 1 and 120),
  credential_ref text,
  base_url text,
  readiness public.bot_readiness not null default 'not_connected',
  readiness_detail text check (readiness_detail is null or char_length(readiness_detail) <= 200),
  last_checked_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bots_id_organization_unique unique (id, organization_id),
  constraint bots_name_unique_per_organization unique (organization_id, name),
  constraint bots_credential_ref_shape check (
    credential_ref is null or credential_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  constraint bots_credential_ref_not_privileged check (
    credential_ref is null
    or (
      credential_ref not in (
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_DB_PASSWORD',
        'GITHUB_APP_PRIVATE_KEY',
        'GITHUB_WEBHOOK_SECRET',
        'GITHUB_CLIENT_SECRET',
        'GITHUB_STATE_SECRET',
        'DATABASE_URL',
        'POSTGRES_PASSWORD',
        'VERCEL_TOKEN'
      )
      and credential_ref not like 'NEXT\_PUBLIC\_%'
    )
  ),
  constraint bots_base_url_https check (
    base_url is null
    or (
      char_length(base_url) between 12 and 300
      and base_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'
    )
  ),
  constraint bots_name_no_likely_secret check (not public.text_has_likely_secret(name)),
  constraint bots_model_no_likely_secret check (not public.text_has_likely_secret(model)),
  constraint bots_notes_no_likely_secret check (
    notes is null or not public.text_has_likely_secret(notes)
  )
);

create table public.bot_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  summary text not null check (char_length(btrim(summary)) between 1 and 240),
  instructions text not null check (char_length(btrim(instructions)) between 1 and 8000),
  risk_ceiling public.risk_level not null default 'green',
  capabilities jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_roles_id_organization_unique unique (id, organization_id),
  constraint bot_roles_slug_unique_per_organization unique (organization_id, slug),
  constraint bot_roles_capabilities_array check (jsonb_typeof(capabilities) = 'array'),
  constraint bot_roles_capabilities_bounded check (jsonb_array_length(capabilities) <= 12),
  constraint bot_roles_capabilities_no_sensitive_data check (
    not public.jsonb_has_sensitive_keys(capabilities)
  ),
  constraint bot_roles_name_no_likely_secret check (not public.text_has_likely_secret(name)),
  constraint bot_roles_summary_no_likely_secret check (not public.text_has_likely_secret(summary)),
  constraint bot_roles_instructions_no_likely_secret check (
    not public.text_has_likely_secret(instructions)
  )
);

create table public.bot_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bot_id uuid not null,
  project_id uuid not null,
  role_id uuid not null,
  status public.bot_assignment_status not null default 'active',
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_assignments_id_organization_unique unique (id, organization_id),
  constraint bot_assignments_bot_fk foreign key (bot_id, organization_id)
    references public.bots(id, organization_id) on delete cascade,
  constraint bot_assignments_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint bot_assignments_role_fk foreign key (role_id, organization_id)
    references public.bot_roles(id, organization_id) on delete restrict,
  constraint bot_assignments_release_consistent check (
    (status = 'released'::public.bot_assignment_status and released_at is not null)
    or (status <> 'released'::public.bot_assignment_status and released_at is null)
  )
);

-- A bot holds at most one posting at a time, so "move this bot to that project"
-- is a single audited transition rather than a fan-out of competing postings.
create unique index bot_assignments_one_open_posting_per_bot
  on public.bot_assignments (bot_id)
  where status <> 'released'::public.bot_assignment_status;

create index bots_organization_idx on public.bots (organization_id, name);
create index bot_roles_organization_idx on public.bot_roles (organization_id, name);
create index bot_assignments_organization_idx on public.bot_assignments (organization_id, status);
create index bot_assignments_project_idx on public.bot_assignments (project_id, status);
create index bot_assignments_role_idx on public.bot_assignments (role_id);

do $bot_fabric_triggers$
declare
  target_table text;
begin
  foreach target_table in array array['bots', 'bot_roles', 'bot_assignments']
  loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.reject_sensitive_row_data()',
      target_table || '_reject_sensitive_data', target_table
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      target_table || '_set_updated_at', target_table
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_organization_reassignment()',
      target_table || '_prevent_organization_reassignment', target_table
    );
  end loop;
end;
$bot_fabric_triggers$;

alter table public.bots enable row level security;
alter table public.bots force row level security;
alter table public.bot_roles enable row level security;
alter table public.bot_roles force row level security;
alter table public.bot_assignments enable row level security;
alter table public.bot_assignments force row level security;

create policy bots_select_members
  on public.bots for select to authenticated
  using (public.is_organization_member(organization_id));
create policy bot_roles_select_members
  on public.bot_roles for select to authenticated
  using (public.is_organization_member(organization_id));
create policy bot_assignments_select_members
  on public.bot_assignments for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.bots from anon, authenticated;
revoke all on table public.bot_roles from anon, authenticated;
revoke all on table public.bot_assignments from anon, authenticated;

grant select on table public.bots to authenticated;
grant select on table public.bot_roles to authenticated;
grant select on table public.bot_assignments to authenticated;

create or replace function public.assert_bot_fabric_manager(target_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if target_organization_id is null then
    raise exception using errcode = '22023', message = 'organization is required';
  end if;
  if not public.can_manage_organization(target_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  return caller_id;
end;
$function$;

create or replace function public.normalize_bot_credential_ref(p_credential_ref text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $function$
declare
  normalized text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_credential_ref, '')));
begin
  if normalized = '' then
    return null;
  end if;
  if normalized !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    raise exception using errcode = '22023', message = 'credential reference must name a server-side environment variable';
  end if;
  if public.text_has_likely_secret(normalized) then
    raise exception using errcode = '22023', message = 'credential reference must be a name, not a secret value';
  end if;

  return normalized;
end;
$function$;

create or replace function public.register_bot(
  p_organization_id uuid,
  p_name text,
  p_provider public.bot_provider,
  p_model text,
  p_credential_ref text default null,
  p_base_url text default null,
  p_notes text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
begin
  insert into public.bots (
    organization_id, name, provider, model, credential_ref, base_url, notes, created_by
  ) values (
    p_organization_id,
    pg_catalog.btrim(p_name),
    p_provider,
    pg_catalog.btrim(p_model),
    public.normalize_bot_credential_ref(p_credential_ref),
    pg_catalog.nullif(pg_catalog.btrim(coalesce(p_base_url, '')), ''),
    pg_catalog.nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    caller_id
  )
  returning * into bot_record;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.registered'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot registered in the fabric',
    pg_catalog.jsonb_build_object(
      'provider', bot_record.provider::text,
      'model', bot_record.model,
      'credential_reference_present', bot_record.credential_ref is not null,
      'readiness', bot_record.readiness::text
    )
  );

  return next bot_record;
end;
$function$;

create or replace function public.update_bot(
  p_organization_id uuid,
  p_bot_id uuid,
  p_name text,
  p_model text,
  p_credential_ref text default null,
  p_base_url text default null,
  p_notes text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
begin
  update public.bots
  set
    name = pg_catalog.btrim(p_name),
    model = pg_catalog.btrim(p_model),
    credential_ref = public.normalize_bot_credential_ref(p_credential_ref),
    base_url = pg_catalog.nullif(pg_catalog.btrim(coalesce(p_base_url, '')), ''),
    notes = pg_catalog.nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    readiness = 'not_connected'::public.bot_readiness,
    readiness_detail = null,
    last_checked_at = null
  where id = p_bot_id
    and organization_id = p_organization_id
  returning * into bot_record;

  if not found then
    raise exception using errcode = 'P0002', message = 'bot was not found for this organization';
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.updated'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot configuration updated; readiness reset pending a new check',
    pg_catalog.jsonb_build_object(
      'provider', bot_record.provider::text,
      'model', bot_record.model,
      'credential_reference_present', bot_record.credential_ref is not null
    )
  );

  return next bot_record;
end;
$function$;

create or replace function public.record_bot_readiness(
  p_organization_id uuid,
  p_bot_id uuid,
  p_readiness public.bot_readiness,
  p_detail text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
  safe_detail text := pg_catalog.nullif(pg_catalog.btrim(coalesce(p_detail, '')), '');
begin
  if safe_detail is not null and public.text_has_likely_secret(safe_detail) then
    raise exception using errcode = '22023', message = 'readiness detail must not contain secret material';
  end if;

  update public.bots
  set
    readiness = p_readiness,
    readiness_detail = pg_catalog.left(safe_detail, 200),
    last_checked_at = now()
  where id = p_bot_id
    and organization_id = p_organization_id
  returning * into bot_record;

  if not found then
    raise exception using errcode = 'P0002', message = 'bot was not found for this organization';
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.readiness_checked'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot readiness recorded from server-side configuration evidence',
    pg_catalog.jsonb_build_object(
      'readiness', bot_record.readiness::text,
      'credential_reference_present', bot_record.credential_ref is not null,
      'executor_connected', false
    )
  );

  return next bot_record;
end;
$function$;

create or replace function public.retire_bot(
  p_organization_id uuid,
  p_bot_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
begin
  select * into bot_record
  from public.bots
  where id = p_bot_id
    and organization_id = p_organization_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'bot was not found for this organization';
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.retired'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot removed from the fabric and released from every project',
    pg_catalog.jsonb_build_object(
      'provider', bot_record.provider::text,
      'model', bot_record.model
    )
  );

  delete from public.bots
  where id = p_bot_id
    and organization_id = p_organization_id;
end;
$function$;

create or replace function public.save_bot_role(
  p_organization_id uuid,
  p_role_id uuid,
  p_name text,
  p_slug text,
  p_summary text,
  p_instructions text,
  p_risk_ceiling public.risk_level default 'green'::public.risk_level,
  p_capabilities jsonb default '[]'::jsonb
)
returns setof public.bot_roles
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  role_record public.bot_roles%rowtype;
  normalized_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  capability_entry jsonb;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_capabilities, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'capabilities must be a list';
  end if;
  for capability_entry in
    select value from pg_catalog.jsonb_array_elements(coalesce(p_capabilities, '[]'::jsonb))
  loop
    if pg_catalog.jsonb_typeof(capability_entry) <> 'string'
      or pg_catalog.char_length(capability_entry #>> '{}') not between 1 and 40 then
      raise exception using errcode = '22023', message = 'each capability must be a short label';
    end if;
  end loop;

  if p_role_id is null then
    insert into public.bot_roles (
      organization_id, name, slug, summary, instructions, risk_ceiling, capabilities, created_by
    ) values (
      p_organization_id,
      pg_catalog.btrim(p_name),
      normalized_slug,
      pg_catalog.btrim(p_summary),
      pg_catalog.btrim(p_instructions),
      p_risk_ceiling,
      coalesce(p_capabilities, '[]'::jsonb),
      caller_id
    )
    returning * into role_record;
  else
    update public.bot_roles
    set
      name = pg_catalog.btrim(p_name),
      slug = normalized_slug,
      summary = pg_catalog.btrim(p_summary),
      instructions = pg_catalog.btrim(p_instructions),
      risk_ceiling = p_risk_ceiling,
      capabilities = coalesce(p_capabilities, '[]'::jsonb)
    where id = p_role_id
      and organization_id = p_organization_id
    returning * into role_record;

    if not found then
      raise exception using errcode = 'P0002', message = 'role was not found for this organization';
    end if;
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot_role.saved'::public.activity_event_type,
    'bot_role',
    role_record.id,
    'Bot role definition saved',
    pg_catalog.jsonb_build_object(
      'slug', role_record.slug,
      'risk_ceiling', role_record.risk_ceiling::text,
      'capability_count', pg_catalog.jsonb_array_length(role_record.capabilities)
    )
  );

  return next role_record;
end;
$function$;

create or replace function public.remove_bot_role(
  p_organization_id uuid,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  role_record public.bot_roles%rowtype;
begin
  select * into role_record
  from public.bot_roles
  where id = p_role_id
    and organization_id = p_organization_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'role was not found for this organization';
  end if;

  if exists (
    select 1
    from public.bot_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.role_id = p_role_id
      and assignment.status <> 'released'::public.bot_assignment_status
  ) then
    raise exception using errcode = '23514', message = 'release the bots holding this role before removing it';
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot_role.removed'::public.activity_event_type,
    'bot_role',
    role_record.id,
    'Bot role definition removed',
    pg_catalog.jsonb_build_object('slug', role_record.slug)
  );

  delete from public.bot_roles
  where id = p_role_id
    and organization_id = p_organization_id;
end;
$function$;

create or replace function public.assign_bot(
  p_organization_id uuid,
  p_bot_id uuid,
  p_project_id uuid,
  p_role_id uuid
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  assignment_record public.bot_assignments%rowtype;
  previous_project_id uuid;
  previous_role_id uuid;
  transition public.activity_event_type;
begin
  if not exists (
    select 1 from public.bots bot
    where bot.id = p_bot_id and bot.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'bot was not found for this organization';
  end if;
  if not exists (
    select 1 from public.bot_roles role_definition
    where role_definition.id = p_role_id and role_definition.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'role was not found for this organization';
  end if;
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id
      and project.status <> 'archived'::public.project_status
  ) then
    raise exception using errcode = 'P0002', message = 'project was not found for this organization';
  end if;

  select assignment.project_id, assignment.role_id
    into previous_project_id, previous_role_id
  from public.bot_assignments assignment
  where assignment.bot_id = p_bot_id
    and assignment.organization_id = p_organization_id
    and assignment.status <> 'released'::public.bot_assignment_status
  for update;

  if previous_project_id is null then
    insert into public.bot_assignments (
      organization_id, bot_id, project_id, role_id, created_by
    ) values (
      p_organization_id, p_bot_id, p_project_id, p_role_id, caller_id
    )
    returning * into assignment_record;
    transition := 'bot.assigned'::public.activity_event_type;
  else
    update public.bot_assignments
    set
      project_id = p_project_id,
      role_id = p_role_id,
      status = 'active'::public.bot_assignment_status,
      assigned_at = now(),
      released_at = null
    where bot_id = p_bot_id
      and organization_id = p_organization_id
      and status <> 'released'::public.bot_assignment_status
    returning * into assignment_record;
    transition := case
      when previous_project_id is distinct from p_project_id
        then 'bot.moved'::public.activity_event_type
      else 'bot.assignment_changed'::public.activity_event_type
    end;
  end if;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    assignment_record.project_id,
    caller_id,
    transition,
    'bot_assignment',
    assignment_record.id,
    'Bot posting created or moved. Assignment is routing intent, not execution.',
    pg_catalog.jsonb_build_object(
      'bot_id', assignment_record.bot_id,
      'role_id', assignment_record.role_id,
      'previous_project_id', previous_project_id,
      'previous_role_id', previous_role_id,
      'executor_connected', false
    )
  );

  return next assignment_record;
end;
$function$;

create or replace function public.update_bot_assignment(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_status public.bot_assignment_status
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  assignment_record public.bot_assignments%rowtype;
begin
  update public.bot_assignments
  set
    status = p_status,
    released_at = case
      when p_status = 'released'::public.bot_assignment_status then now()
      else null
    end
  where id = p_assignment_id
    and organization_id = p_organization_id
  returning * into assignment_record;

  if not found then
    raise exception using errcode = 'P0002', message = 'assignment was not found for this organization';
  end if;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    assignment_record.project_id,
    caller_id,
    'bot.assignment_changed'::public.activity_event_type,
    'bot_assignment',
    assignment_record.id,
    'Bot posting status changed',
    pg_catalog.jsonb_build_object(
      'bot_id', assignment_record.bot_id,
      'status', assignment_record.status::text
    )
  );

  return next assignment_record;
end;
$function$;

revoke all on function public.assert_bot_fabric_manager(uuid) from public, anon, authenticated;
revoke all on function public.normalize_bot_credential_ref(text) from public, anon, authenticated;
revoke all on function public.register_bot(uuid, text, public.bot_provider, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_bot(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_bot_readiness(uuid, uuid, public.bot_readiness, text) from public, anon, authenticated;
revoke all on function public.retire_bot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_bot_role(uuid, uuid, text, text, text, text, public.risk_level, jsonb) from public, anon, authenticated;
revoke all on function public.remove_bot_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assign_bot(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_bot_assignment(uuid, uuid, public.bot_assignment_status) from public, anon, authenticated;

grant execute on function public.register_bot(uuid, text, public.bot_provider, text, text, text, text) to authenticated;
grant execute on function public.update_bot(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.record_bot_readiness(uuid, uuid, public.bot_readiness, text) to authenticated;
grant execute on function public.retire_bot(uuid, uuid) to authenticated;
grant execute on function public.save_bot_role(uuid, uuid, text, text, text, text, public.risk_level, jsonb) to authenticated;
grant execute on function public.remove_bot_role(uuid, uuid) to authenticated;
grant execute on function public.assign_bot(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_bot_assignment(uuid, uuid, public.bot_assignment_status) to authenticated;

comment on table public.bots is
  'Provider-neutral bot registration. Stores metadata and an opaque server-side secret reference; never credential material.';
comment on column public.bots.credential_ref is
  'Name of a server-side environment variable holding the provider credential. The value is never stored, returned, or logged.';
comment on column public.bots.readiness is
  'Configuration evidence only. "ready" means the referenced secret and configuration resolve server-side; it does not assert a verified provider session or an executor.';
comment on table public.bot_assignments is
  'Declarative routing intent binding one bot to one project under one role. It does not authorize or perform execution.';
