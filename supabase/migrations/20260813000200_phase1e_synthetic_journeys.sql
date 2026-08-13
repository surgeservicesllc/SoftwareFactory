-- Phase 1E synthetic production journeys.
--
-- A synthetic check runs against real production, so a careless step does real
-- damage. Safety is enforced here in the database, not only in application
-- code: destructive methods and paths are rejected by CHECK constraint, a
-- declared safe write must say how it leaves no residue, and each validation
-- profile must actually cover what it promises.
--
-- This migration adds no executor. Journeys are executed by the same bounded
-- outbound HTTPS probe that already backs uptime monitors, and their results
-- are recorded through the existing observation workflow.

/* ---------------------------------------------------------- step safety */

create or replace function public.synthetic_step_is_safe(step jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select
    jsonb_typeof(step) = 'object'
    and step ? 'kind' and step ? 'name' and step ? 'path' and step ? 'method'
    and (step ->> 'kind') in ('app_shell', 'login', 'critical_read', 'safe_write', 'api', 'workflow')
    and (step ->> 'method') in ('GET', 'HEAD', 'POST')
    and char_length(coalesce(step ->> 'name', '')) between 1 and 120
    and char_length(coalesce(step ->> 'path', '')) between 1 and 200
    and (step ->> 'path') like '/%'
    -- A write may only exist where it was explicitly declared as one.
    and (
      (step ->> 'method') <> 'POST'
      or (step ->> 'kind') in ('safe_write', 'login')
    )
    -- A declared safe write must describe how it avoids leaving residue.
    and (
      (step ->> 'kind') <> 'safe_write'
      or char_length(coalesce(step ->> 'reversal_note', '')) between 10 and 300
    )
    -- Destructive-looking targets are refused outright rather than warned about.
    and (step ->> 'path') !~* '(delete|destroy|purge|drop|truncate|wipe|reset|revoke|deactivate|cancel-account|close-account)'
    and coalesce((step ->> 'expected_status')::integer, 200) between 100 and 599;
$function$;

comment on function public.synthetic_step_is_safe(jsonb) is
  'Non-destructive synthetic step contract. Only GET, HEAD, and an explicitly declared safe POST are permitted, and destructive-looking paths are rejected.';

create or replace function public.synthetic_steps_are_safe(steps jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 12
    and not exists (
      select 1
      from jsonb_array_elements(steps) as element(step)
      where not public.synthetic_step_is_safe(element.step)
    );
$function$;

create or replace function public.synthetic_steps_cover_profile(
  steps jsonb,
  target_profile public.synthetic_profile
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case target_profile
    when 'basic' then
      steps @> '[{"kind":"app_shell"}]'::jsonb
    when 'standard' then
      steps @> '[{"kind":"app_shell"}]'::jsonb
      and steps @> '[{"kind":"critical_read"}]'::jsonb
    else
      steps @> '[{"kind":"app_shell"}]'::jsonb
      and steps @> '[{"kind":"login"}]'::jsonb
      and steps @> '[{"kind":"critical_read"}]'::jsonb
      and steps @> '[{"kind":"workflow"}]'::jsonb
  end;
$function$;

comment on function public.synthetic_steps_cover_profile(jsonb, public.synthetic_profile) is
  'A profile is a promise about coverage. Basic checks the app shell; Standard adds a critical read; Critical additionally requires sign-in and one business-critical workflow.';

/* -------------------------------------------------------------- journeys */

create table public.synthetic_journeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  monitor_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  profile public.synthetic_profile not null,
  base_url text not null check (base_url ~ '^https://[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]{3,200}$'),
  steps jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint synthetic_journeys_id_organization_unique unique (id, organization_id),
  constraint synthetic_journeys_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint synthetic_journeys_monitor_fk foreign key (monitor_id, organization_id)
    references public.production_monitors(id, organization_id) on delete cascade,
  constraint synthetic_journeys_monitor_unique unique (monitor_id),
  constraint synthetic_journeys_steps_are_safe check (public.synthetic_steps_are_safe(steps)),
  constraint synthetic_journeys_profile_covered check (
    public.synthetic_steps_cover_profile(steps, profile)
  ),
  constraint synthetic_journeys_steps_no_sensitive_data check (not public.jsonb_has_sensitive_keys(steps))
);

comment on table public.synthetic_journeys is
  'Project-defined production journeys. Step safety and profile coverage are enforced by CHECK constraint, so an unsafe journey cannot be stored even if application validation is bypassed.';

create index synthetic_journeys_project_idx on public.synthetic_journeys (project_id);

alter table public.synthetic_journeys enable row level security;
alter table public.synthetic_journeys force row level security;

create trigger synthetic_journeys_reject_sensitive_data
  before insert or update on public.synthetic_journeys
  for each row execute function public.reject_sensitive_row_data();

create trigger synthetic_journeys_set_updated_at
  before update on public.synthetic_journeys
  for each row execute function public.set_updated_at();

create trigger synthetic_journeys_prevent_org_change
  before update on public.synthetic_journeys
  for each row execute function public.prevent_organization_reassignment();

revoke all on table public.synthetic_journeys from anon, authenticated;
grant select on table public.synthetic_journeys to authenticated;

create policy synthetic_journeys_select_members
  on public.synthetic_journeys for select to authenticated
  using (public.is_organization_member(organization_id));

/* ------------------------------------------------------------- workflows */

create or replace function public.configure_synthetic_journey(
  p_monitor_id uuid,
  p_name text,
  p_profile public.synthetic_profile,
  p_base_url text,
  p_steps jsonb
)
returns setof public.synthetic_journeys
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  monitor_record public.production_monitors%rowtype;
  journey_record public.synthetic_journeys%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into monitor_record from public.production_monitors where id = p_monitor_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'monitor not found';
  end if;

  if not public.can_manage_organization(monitor_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  if monitor_record.signal_kind <> 'synthetic' then
    raise exception using errcode = '23514', message = 'a journey may only be attached to a synthetic monitor';
  end if;

  if not public.synthetic_steps_are_safe(coalesce(p_steps, '[]'::jsonb)) then
    raise exception using
      errcode = '23514',
      message = 'a synthetic journey may not contain destructive steps or an undeclared write';
  end if;

  if not public.synthetic_steps_cover_profile(coalesce(p_steps, '[]'::jsonb), p_profile) then
    raise exception using
      errcode = '23514',
      message = 'the journey does not cover everything its validation profile promises';
  end if;

  insert into public.synthetic_journeys (
    organization_id, project_id, monitor_id, name, profile, base_url, steps, created_by
  )
  values (
    monitor_record.organization_id, monitor_record.project_id, p_monitor_id,
    p_name, p_profile, p_base_url, p_steps, auth.uid()
  )
  on conflict (monitor_id) do update
  set name = excluded.name,
    profile = excluded.profile,
    base_url = excluded.base_url,
    steps = excluded.steps
  returning * into journey_record;

  -- Keep the monitor's declared profile aligned with the journey it runs.
  update public.production_monitors
  set profile = p_profile
  where id = p_monitor_id;

  perform public.record_operations_audit_event(
    monitor_record.organization_id, monitor_record.project_id,
    'monitor.configured'::public.operations_audit_kind,
    'synthetic_journey', journey_record.id,
    format('Synthetic journey %s configured', journey_record.name),
    pg_catalog.jsonb_build_object(
      'profile', p_profile,
      'steps', jsonb_array_length(journey_record.steps),
      'monitor_id', p_monitor_id
    )
  );

  return next journey_record;
end;
$function$;

create or replace function public.list_synthetic_journeys(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  monitor_id uuid,
  monitor_name text,
  name text,
  profile public.synthetic_profile,
  base_url text,
  steps jsonb,
  enabled boolean,
  monitor_connection_state public.monitor_connection_state,
  last_outcome public.signal_outcome,
  last_observed_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select journey.id, journey.project_id, project.name, journey.monitor_id, monitor.name,
    journey.name, journey.profile, journey.base_url, journey.steps, journey.enabled,
    monitor.connection_state, monitor.last_outcome, monitor.last_observed_at
  from public.synthetic_journeys journey
  join public.projects project
    on project.id = journey.project_id and project.organization_id = journey.organization_id
  join public.production_monitors monitor
    on monitor.id = journey.monitor_id and monitor.organization_id = journey.organization_id
  where journey.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by project.name asc, journey.name asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

/* ------------------------------------------------------------ privileges */

revoke all on function public.synthetic_step_is_safe(jsonb) from public, anon, service_role;
revoke all on function public.synthetic_steps_are_safe(jsonb) from public, anon, service_role;
revoke all on function public.synthetic_steps_cover_profile(jsonb, public.synthetic_profile) from public, anon, service_role;
revoke all on function public.configure_synthetic_journey(uuid, text, public.synthetic_profile, text, jsonb) from public, anon, service_role;
revoke all on function public.list_synthetic_journeys(uuid, integer) from public, anon, service_role;

grant execute on function public.synthetic_step_is_safe(jsonb) to authenticated;
grant execute on function public.synthetic_steps_are_safe(jsonb) to authenticated;
grant execute on function public.synthetic_steps_cover_profile(jsonb, public.synthetic_profile) to authenticated;
grant execute on function public.configure_synthetic_journey(uuid, text, public.synthetic_profile, text, jsonb) to authenticated;
grant execute on function public.list_synthetic_journeys(uuid, integer) to authenticated;
