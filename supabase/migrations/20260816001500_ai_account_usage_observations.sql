-- Usage observations per AI account: what the provider said, when it said it.
--
-- The Bot Manager shows each connected account's subscription usage — the
-- session (5-hour) and weekly windows the provider itself reports. Truthful
-- status is the whole design: the console renders only rows recorded here by
-- the auth-broker worker's sweep, never a number computed client-side or a
-- default. An account with no observation reads "no usage recorded yet", and
-- a probe that failed records *that it failed* rather than nothing, so
-- staleness is visible instead of silent.
--
-- Three observation statuses, mirroring the repository's evidence language:
--   measured     the provider returned usage windows; `windows` holds them
--   unavailable  the probe ran and failed (refused credential, bad payload)
--   unsupported  no proven usage endpoint exists for this provider yet
--
-- The table is append-only evidence with zero direct table access, like the
-- broker tables it extends: the worker writes through one service-role
-- definer function, members read the latest row per account through one
-- authenticated definer function, and nothing else can touch it.

-- ---------------------------------------------------------------------------
-- Window payload validation
-- ---------------------------------------------------------------------------

-- The only shape a stored usage window may have: a bounded array of objects
-- carrying exactly window_key/label/used_percent and an optional resets_at.
-- Validated in a CHECK so a compromised or buggy writer cannot smuggle
-- anything else — most importantly, nothing credential-shaped — into a row
-- that authenticated browsers will read.
create or replace function public.ai_usage_windows_valid(p_windows jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_window jsonb;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_windows) > 8 then
    return false;
  end if;

  for v_window in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(v_window) <> 'object' then
      return false;
    end if;
    -- Exactly the allowlisted keys; an unknown key is a refusal, not a pass.
    if exists (
      select 1 from jsonb_object_keys(v_window) as key
      where key not in ('window_key', 'label', 'used_percent', 'resets_at')
    ) then
      return false;
    end if;
    if jsonb_typeof(v_window -> 'window_key') is distinct from 'string'
      or (v_window ->> 'window_key') !~ '^[a-z][a-z0-9_]{0,39}$' then
      return false;
    end if;
    if jsonb_typeof(v_window -> 'label') is distinct from 'string'
      or char_length(v_window ->> 'label') not between 1 and 80
      or public.text_has_likely_secret(v_window ->> 'label') then
      return false;
    end if;
    if jsonb_typeof(v_window -> 'used_percent') is distinct from 'number'
      or (v_window ->> 'used_percent')::numeric < 0
      or (v_window ->> 'used_percent')::numeric > 100 then
      return false;
    end if;
    if v_window ? 'resets_at'
      and jsonb_typeof(v_window -> 'resets_at') not in ('string', 'null') then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

revoke all on function public.ai_usage_windows_valid(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The evidence table
-- ---------------------------------------------------------------------------

create table public.ai_account_usage_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ai_account_id uuid not null,
  observed_at timestamptz not null default now(),
  -- Where the observation came from. One writer exists today; naming it keeps
  -- a future second writer distinguishable instead of anonymous.
  source text not null default 'auth_broker_sweep'
    check (source in ('auth_broker_sweep')),
  status text not null check (status in ('measured', 'unavailable', 'unsupported')),
  windows jsonb not null default '[]'::jsonb,
  -- Human-readable and shape-checked, like every worker-reported text column:
  -- a token pasted into an error message can never land here.
  detail text check (
    detail is null
    or (char_length(detail) <= 400 and not public.text_has_likely_secret(detail))
  ),
  created_at timestamptz not null default now(),

  constraint ai_account_usage_account_fk foreign key (ai_account_id, organization_id)
    references public.ai_accounts (id, organization_id) on delete cascade,
  constraint ai_account_usage_windows_shape check (public.ai_usage_windows_valid(windows)),
  -- "Measured" means there is a measurement; anything else must not carry one.
  constraint ai_account_usage_measured_has_windows check (
    (status = 'measured') = (jsonb_array_length(windows) > 0)
  )
);

comment on table public.ai_account_usage_observations is
  'Append-only provider-usage evidence per AI account, recorded by the auth-broker sweep. The console renders the latest row per account and nothing else.';

create index ai_account_usage_latest_idx
  on public.ai_account_usage_observations (ai_account_id, observed_at desc);

create index ai_account_usage_organization_idx
  on public.ai_account_usage_observations (organization_id, observed_at desc);

alter table public.ai_account_usage_observations enable row level security;
alter table public.ai_account_usage_observations force row level security;

revoke all on table public.ai_account_usage_observations
  from anon, authenticated, service_role;

-- Append-only: evidence about what a provider reported is history, and
-- history that can be rewritten is not evidence.
create or replace function public.ai_account_usage_no_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'usage observations are append-only';
end;
$function$;

revoke all on function public.ai_account_usage_no_rewrite()
  from public, anon, authenticated, service_role;

create trigger ai_account_usage_observations_append_only
  before update or delete on public.ai_account_usage_observations
  for each row execute function public.ai_account_usage_no_rewrite();

-- ---------------------------------------------------------------------------
-- Writing, for the worker
-- ---------------------------------------------------------------------------

create or replace function public.record_ai_account_usage(
  p_organization_id uuid,
  p_ai_account_id uuid,
  p_status text,
  p_windows jsonb,
  p_detail text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_id uuid;
begin
  if p_status is null or p_status not in ('measured', 'unavailable', 'unsupported') then
    raise exception using errcode = '23514', message = 'unknown usage observation status';
  end if;

  -- The account must exist under exactly that organization. The check keeps a
  -- writer holding a real account id from attributing usage across a tenant
  -- boundary; the FK alone would only require the pair to exist.
  if not exists (
    select 1 from public.ai_accounts a
    where a.id = p_ai_account_id and a.organization_id = p_organization_id
  ) then
    raise exception using errcode = '42501',
      message = 'no such AI account in that organization';
  end if;

  insert into public.ai_account_usage_observations
    (organization_id, ai_account_id, status, windows, detail)
  values (
    p_organization_id,
    p_ai_account_id,
    p_status,
    coalesce(p_windows, '[]'::jsonb),
    nullif(btrim(coalesce(p_detail, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.record_ai_account_usage(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.record_ai_account_usage(uuid, uuid, text, jsonb, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Reading, for the console
-- ---------------------------------------------------------------------------

-- The latest observation per account, whatever its status: a fresh failure is
-- newer truth than a stale success and must win the projection.
create or replace function public.list_ai_account_usage(p_organization_id uuid)
returns table (
  usage_account_id uuid,
  usage_observed_at timestamptz,
  usage_status text,
  usage_windows jsonb,
  usage_detail text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select distinct on (o.ai_account_id)
    o.ai_account_id, o.observed_at, o.status, o.windows, o.detail
  from public.ai_account_usage_observations o
  where o.organization_id = p_organization_id
  order by o.ai_account_id, o.observed_at desc;
end;
$function$;

revoke all on function public.list_ai_account_usage(uuid)
  from public, anon, service_role;
grant execute on function public.list_ai_account_usage(uuid) to authenticated;
