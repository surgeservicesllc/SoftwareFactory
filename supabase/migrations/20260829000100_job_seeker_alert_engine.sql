-- Job Search alerts: the delivery ledger and the definer boundary the
-- scheduled runner crosses.
--
-- The alerts table (20260828000400) stored a cadence nothing acted on. This
-- migration gives alerts an engine-facing shape without handing the system
-- actor a single table grant: the runner reaches the data through two
-- security-definer functions granted to service_role — the same boundary
-- billing uses — so the pinned "service_role has no table grants beyond the
-- verified-ingress list" contract stays exactly as it is.
--
-- The never-repeat guarantee is a UNIQUE constraint, not application memory:
-- one row per (organization, person, saved search, job URL), inserted with
-- ON CONFLICT DO NOTHING. An alert can only ever email a given person about a
-- given job for a given search once, however many times the engine runs.

-- ---------------------------------------------------------------------------
-- Cadence grows "asap"; scanning gets a timestamp of its own.
-- ---------------------------------------------------------------------------

alter table public.job_seeker_search_alerts
  drop constraint if exists job_seeker_search_alerts_cadence_check;
alter table public.job_seeker_search_alerts
  add constraint job_seeker_search_alerts_cadence_check
    check (cadence in ('asap', 'daily', 'weekly'));

-- When the engine last scanned this alert — an observation, distinct from
-- whether anything was found or delivered. Due-ness windows read this, so an
-- empty scan still counts as a scan and a daily alert stays daily.
alter table public.job_seeker_search_alerts
  add column if not exists last_scanned_at timestamptz;

comment on column public.job_seeker_search_alerts.last_scanned_at is
  'When the alert engine last ran this alert''s search. Set only by the definer boundary; null means never scanned.';

-- ---------------------------------------------------------------------------
-- The delivery ledger.
-- ---------------------------------------------------------------------------

create table if not exists public.job_seeker_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_search_id uuid not null
    references public.job_seeker_saved_searches(id) on delete cascade,
  -- The job's identity for the never-repeat rule: the posting's own URL.
  job_url text not null check (job_url ~ '^https?://' and char_length(job_url) <= 800),
  job_title text not null check (char_length(btrim(job_title)) between 1 and 300),
  job_company text not null check (char_length(btrim(job_company)) between 1 and 300),
  board text not null check (board ~ '^[a-z][a-z0-9_]{0,62}$'),
  match_score integer check (match_score is null or (match_score between 0 and 100)),
  -- What actually happened with the email: sent, or failed with the engine
  -- keeping the row so the failure is visible and the job is not re-tried
  -- into a duplicate send storm.
  email_status text not null check (email_status in ('sent', 'failed')),
  created_at timestamptz not null default now(),
  constraint job_seeker_alert_deliveries_never_repeat
    unique (organization_id, user_id, saved_search_id, job_url)
);

create index if not exists job_seeker_alert_deliveries_recent_idx
  on public.job_seeker_alert_deliveries (organization_id, user_id, created_at desc);

comment on table public.job_seeker_alert_deliveries is
  'One row per job ever emailed (or attempted) for a saved-search alert. The unique constraint IS the never-repeat guarantee.';

-- ---------------------------------------------------------------------------
-- Row Level Security: the person reads their own delivery history; nothing
-- writes here from the client at all. Writes cross the definer boundary.
-- ---------------------------------------------------------------------------

alter table public.job_seeker_alert_deliveries enable row level security;
alter table public.job_seeker_alert_deliveries force row level security;
revoke all on table public.job_seeker_alert_deliveries from anon;
revoke all on table public.job_seeker_alert_deliveries from authenticated;
grant select on table public.job_seeker_alert_deliveries to authenticated;

drop policy if exists job_seeker_alert_deliveries_select_own on public.job_seeker_alert_deliveries;
create policy job_seeker_alert_deliveries_select_own
  on public.job_seeker_alert_deliveries for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

-- Ledger rows are evidence of an email that went out (or failed). Rewriting
-- them would un-say a delivery; deleting them would re-arm the never-repeat
-- rule for a job the person was already told about.
create or replace function public.job_seeker_alert_deliveries_no_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'alert deliveries are append-only; the ledger is the never-repeat rule';
end;
$function$;

drop trigger if exists job_seeker_alert_deliveries_immutable on public.job_seeker_alert_deliveries;
create trigger job_seeker_alert_deliveries_immutable
  before update or delete on public.job_seeker_alert_deliveries
  for each row execute function public.job_seeker_alert_deliveries_no_rewrite();

-- ---------------------------------------------------------------------------
-- The definer boundary the engine crosses. service_role may execute exactly
-- these two functions; it holds no grant on any job-seeker table.
-- ---------------------------------------------------------------------------

-- Which alerts are due, with everything one scan needs: the stored query,
-- the recipient, and the profile/preference facts the scorer reads. Due-ness
-- lives here so the schedule cannot drift from the data: asap ~ hourly,
-- daily ~ every 23h, weekly ~ every 6d18h, all measured from last_scanned_at.
create or replace function public.list_due_job_seeker_alerts(p_now timestamptz default now())
returns table (
  alert_id uuid,
  saved_search_id uuid,
  organization_id uuid,
  user_id uuid,
  recipient_email text,
  search_name text,
  search_query jsonb,
  cadence text,
  profile jsonb,
  preferences jsonb,
  profile_recorded boolean,
  delivered_urls text[]
)
language sql
security definer
set search_path = public, pg_catalog
as $function$
  select
    a.id,
    s.id,
    a.organization_id,
    a.user_id,
    -- Read through the row, not the column name: this text parses against
    -- real Supabase (where auth.users.email exists) AND the integration
    -- harness's minimal auth shim (where it does not) — a named column here
    -- would fail CREATE FUNCTION on the shim and take the whole migration
    -- chain down with it. On the shim the projection is null, and the WHERE
    -- below filters those rows out, which is also the honest behavior for a
    -- real account with no email.
    (to_jsonb(u) ->> 'email'),
    s.name,
    s.query,
    a.cadence,
    -- Exactly the facts the evaluator reads; never the whole profile row.
    coalesce(jsonb_build_object(
      'skills', p.skills,
      'technologies', p.technologies,
      'industries', p.industries,
      'employment_history', p.employment_history,
      'salary_target', p.salary_target,
      'location', p.location,
      'work_arrangement', p.work_arrangement,
      'open_to_relocation', p.open_to_relocation
    ), '{}'::jsonb),
    coalesce(jsonb_build_object(
      'target_titles', pref.target_titles,
      'compensation_minimum', pref.compensation_minimum,
      'locations', pref.locations,
      'work_arrangements', pref.work_arrangements,
      'industries', pref.industries,
      'exclusions', pref.exclusions,
      'qualification_threshold', pref.qualification_threshold
    ), '{}'::jsonb),
    p.organization_id is not null,
    coalesce(
      (select array_agg(d.job_url)
         from public.job_seeker_alert_deliveries d
        where d.saved_search_id = s.id and d.user_id = a.user_id),
      array[]::text[]
    )
  from public.job_seeker_search_alerts a
  join public.job_seeker_saved_searches s on s.id = a.saved_search_id
  join auth.users u on u.id = a.user_id
  left join public.job_seeker_profiles p
    on p.organization_id = a.organization_id
  left join public.job_seeker_preferences pref
    on pref.organization_id = a.organization_id
  where a.active
    and (to_jsonb(u) ->> 'email') is not null
    and (
      a.last_scanned_at is null
      or (a.cadence = 'asap'   and a.last_scanned_at <= p_now - interval '55 minutes')
      or (a.cadence = 'daily'  and a.last_scanned_at <= p_now - interval '23 hours')
      or (a.cadence = 'weekly' and a.last_scanned_at <= p_now - interval '6 days 18 hours')
    )
  order by a.last_scanned_at asc nulls first
  limit 50
$function$;

revoke all on function public.list_due_job_seeker_alerts(timestamptz) from public;
revoke all on function public.list_due_job_seeker_alerts(timestamptz) from anon;
revoke all on function public.list_due_job_seeker_alerts(timestamptz) from authenticated;
grant execute on function public.list_due_job_seeker_alerts(timestamptz) to service_role;

-- Record one scan's outcome: bump last_scanned_at, and insert the deliveries
-- that are genuinely new. ON CONFLICT DO NOTHING makes re-delivery
-- structurally impossible; the function reports back which URLs were new so
-- the engine emails exactly those and nothing else. Rows are validated
-- against the same bounds the table enforces before insert.
create or replace function public.record_job_seeker_alert_scan(
  p_alert_id uuid,
  p_deliveries jsonb default '[]'::jsonb
)
returns table (job_url text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_alert public.job_seeker_search_alerts%rowtype;
begin
  select * into v_alert from public.job_seeker_search_alerts where id = p_alert_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'no such alert';
  end if;

  update public.job_seeker_search_alerts
     set last_scanned_at = now(), updated_at = now()
   where id = p_alert_id;

  return query
  insert into public.job_seeker_alert_deliveries
    (organization_id, user_id, saved_search_id, job_url, job_title, job_company, board, match_score, email_status)
  select
    v_alert.organization_id,
    v_alert.user_id,
    v_alert.saved_search_id,
    d->>'jobUrl',
    d->>'jobTitle',
    d->>'jobCompany',
    d->>'board',
    nullif(d->>'matchScore', '')::integer,
    d->>'emailStatus'
  from jsonb_array_elements(coalesce(p_deliveries, '[]'::jsonb)) as d
  on conflict on constraint job_seeker_alert_deliveries_never_repeat do nothing
  returning job_seeker_alert_deliveries.job_url;
end;
$function$;

revoke all on function public.record_job_seeker_alert_scan(uuid, jsonb) from public;
revoke all on function public.record_job_seeker_alert_scan(uuid, jsonb) from anon;
revoke all on function public.record_job_seeker_alert_scan(uuid, jsonb) from authenticated;
grant execute on function public.record_job_seeker_alert_scan(uuid, jsonb) to service_role;
