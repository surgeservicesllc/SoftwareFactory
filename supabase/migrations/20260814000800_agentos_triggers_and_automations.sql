-- AgentOS triggers and cron automations.
--
-- docs/AGENTOS_SPEC.md §14–15. A trigger is a public URL plus a signing
-- secret: a valid POST creates a task for the trigger's scoped agent. An
-- automation is a named cron entry that does the same on a schedule.
--
-- A trigger URL is public by design, so the security lives in three places:
--
--   * The signing secret is a REFERENCE to a server-side variable, never a
--     value, matching how every other credential is handled here.
--   * A trigger names exactly one agent, and that agent's grants still apply.
--     A public endpoint cannot widen what the agent may do.
--   * Deliveries are recorded and deduplicated, so a replayed request cannot
--     spawn the same work twice.
--
-- Nothing dispatches here either. A delivery is recorded and a task is
-- created; no session starts.

create type public.agentos_trigger_delivery_status as enum (
  'accepted', 'rejected_signature', 'rejected_disabled', 'duplicate'
);

create table public.agentos_triggers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  agent_id uuid not null,

  name text not null check (name ~ '^[a-z][a-z0-9-]{0,62}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  -- Opaque public path segment. Not the secret; knowing it proves nothing.
  public_slug text not null check (public_slug ~ '^[a-z0-9]{24,64}$'),
  -- The NAME of the server-side variable holding the signing secret.
  secret_env_var text not null check (secret_env_var ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  job_prompt text not null check (char_length(btrim(job_prompt)) between 1 and 4000),
  enabled boolean not null default false,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_triggers_name_unique unique (organization_id, name),
  constraint agentos_triggers_slug_unique unique (public_slug),
  constraint agentos_triggers_id_organization_unique unique (id, organization_id),
  constraint agentos_triggers_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint agentos_triggers_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete restrict,
  -- Same refusal as MCP connections: a privileged or browser-visible variable
  -- can never be a webhook signing secret.
  constraint agentos_triggers_secret_not_privileged check (
    secret_env_var not in (
      'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'DATABASE_URL',
      'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_STATE_SECRET',
      'VERCEL_TOKEN', 'WORKER_TICK_SECRET', 'CRON_SECRET'
    )
    and secret_env_var not like 'NEXT\_PUBLIC\_%'
  ),
  constraint agentos_triggers_prompt_no_secret check (
    not public.text_has_likely_secret(job_prompt)
  )
);

comment on column public.agentos_triggers.public_slug is
  'The public URL segment. Knowing it proves nothing: every delivery is still signature-checked.';

create table public.agentos_trigger_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  trigger_id uuid not null,
  -- Sender-supplied id used to reject replays.
  external_delivery_id text not null check (char_length(external_delivery_id) between 1 and 200),
  status public.agentos_trigger_delivery_status not null,
  -- The sanitized body only. The raw request is never stored.
  sanitized_payload jsonb not null default '{}'::jsonb,
  task_id uuid,
  received_at timestamptz not null default now(),

  constraint agentos_trigger_deliveries_trigger_fk foreign key (trigger_id, organization_id)
    references public.agentos_triggers(id, organization_id) on delete cascade,
  constraint agentos_trigger_deliveries_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete set null,
  constraint agentos_trigger_deliveries_payload_object check (
    jsonb_typeof(sanitized_payload) = 'object'
  ),
  -- The stored payload is what a prompt will quote, so it must already be
  -- clean. A sensitive key here means sanitization was skipped.
  constraint agentos_trigger_deliveries_payload_no_secret check (
    not public.jsonb_has_sensitive_keys(sanitized_payload)
  )
);

-- One accepted delivery per external id. A replay is recorded as a duplicate
-- rather than spawning the same work again.
create unique index agentos_trigger_deliveries_dedupe
  on public.agentos_trigger_deliveries (trigger_id, external_delivery_id)
  where status = 'accepted';

create table public.agentos_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  agent_id uuid,
  template_id uuid,

  name text not null check (name ~ '^[a-z][a-z0-9-]{0,62}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  cron_expression text not null check (char_length(btrim(cron_expression)) between 9 and 100),
  timezone text not null default 'UTC' check (char_length(btrim(timezone)) between 1 and 64),
  job_prompt text check (job_prompt is null or char_length(btrim(job_prompt)) between 1 and 4000),
  enabled boolean not null default false,
  last_fired_at timestamptz,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_automations_name_unique unique (organization_id, name),
  constraint agentos_automations_id_organization_unique unique (id, organization_id),
  constraint agentos_automations_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint agentos_automations_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete restrict,
  constraint agentos_automations_template_fk foreign key (template_id, organization_id)
    references public.agentos_task_templates(id, organization_id) on delete restrict,
  -- An automation runs a template or an agent with a prompt. Neither, or a
  -- half-specified one, would fire into nothing.
  constraint agentos_automations_has_work check (
    (template_id is not null and agent_id is null and job_prompt is null)
    or (template_id is null and agent_id is not null and job_prompt is not null)
  ),
  constraint agentos_automations_prompt_no_secret check (
    job_prompt is null or not public.text_has_likely_secret(job_prompt)
  )
);

create index agentos_triggers_project_idx on public.agentos_triggers (organization_id, project_id);
create index agentos_trigger_deliveries_trigger_idx
  on public.agentos_trigger_deliveries (organization_id, trigger_id, received_at desc);
create index agentos_automations_project_idx on public.agentos_automations (organization_id, project_id);

alter table public.agentos_triggers enable row level security;
alter table public.agentos_triggers force row level security;
alter table public.agentos_trigger_deliveries enable row level security;
alter table public.agentos_trigger_deliveries force row level security;
alter table public.agentos_automations enable row level security;
alter table public.agentos_automations force row level security;

create policy agentos_triggers_select_members on public.agentos_triggers for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_trigger_deliveries_select_members
  on public.agentos_trigger_deliveries for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_automations_select_members on public.agentos_automations for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.agentos_triggers from anon, authenticated;
revoke all on table public.agentos_trigger_deliveries from anon, authenticated;
revoke all on table public.agentos_automations from anon, authenticated;
grant select on table public.agentos_triggers to authenticated;
grant select on table public.agentos_trigger_deliveries to authenticated;
grant select on table public.agentos_automations to authenticated;

-- ---------------------------------------------------------------------------
-- Recording a delivery
-- ---------------------------------------------------------------------------
--
-- Called after the signature has been verified server-side. Enforces the two
-- things a caller could get wrong: a disabled trigger must not produce work,
-- and a replay must not produce it twice.

create or replace function public.agentos_record_trigger_delivery(
  p_trigger_id uuid,
  p_external_delivery_id text,
  p_sanitized_payload jsonb,
  p_signature_valid boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  trigger_record public.agentos_triggers;
  existing public.agentos_trigger_deliveries;
  delivery_status public.agentos_trigger_delivery_status;
  new_task_id uuid;
begin
  select * into trigger_record from public.agentos_triggers where id = p_trigger_id;
  if not found then
    raise exception using errcode = '42501', message = 'the trigger does not exist';
  end if;

  if not p_signature_valid then
    delivery_status := 'rejected_signature';
  elsif not trigger_record.enabled then
    -- A disabled trigger accepts nothing, even correctly signed.
    delivery_status := 'rejected_disabled';
  else
    select * into existing
      from public.agentos_trigger_deliveries
     where trigger_id = p_trigger_id
       and external_delivery_id = p_external_delivery_id
       and status = 'accepted';
    if found then
      delivery_status := 'duplicate';
    else
      delivery_status := 'accepted';
    end if;
  end if;

  if delivery_status = 'accepted' then
    insert into public.tasks
      (organization_id, project_id, title, description, status, risk_level,
       assigned_agent_id, created_by)
    values
      (trigger_record.organization_id, trigger_record.project_id,
       left(format('%s delivery', trigger_record.display_name), 240),
       trigger_record.job_prompt, 'backlog', 'green',
       trigger_record.agent_id, trigger_record.created_by)
    returning id into new_task_id;
  end if;

  insert into public.agentos_trigger_deliveries
    (organization_id, trigger_id, external_delivery_id, status, sanitized_payload, task_id)
  values
    (trigger_record.organization_id, p_trigger_id, p_external_delivery_id,
     delivery_status, coalesce(p_sanitized_payload, '{}'::jsonb), new_task_id);

  return jsonb_build_object(
    'status', delivery_status,
    'taskId', new_task_id,
    -- Nothing starts a session. Said plainly rather than implied.
    'sessionStarted', false,
    'blocker', 'TRIGGER_RUNNER_NOT_CONNECTED'
  );
end;
$function$;

comment on function public.agentos_record_trigger_delivery(uuid, text, jsonb, boolean) is
  'Records a delivery whose signature was already verified server-side. A disabled trigger and a replayed delivery both produce no task.';

-- The webhook boundary is a machine path, so this is the one function here
-- service_role may call. It still creates only a backlog task.
revoke all on function public.agentos_record_trigger_delivery(uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.agentos_record_trigger_delivery(uuid, text, jsonb, boolean)
  to service_role;
