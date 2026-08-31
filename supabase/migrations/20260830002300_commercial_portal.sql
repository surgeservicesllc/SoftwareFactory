-- ---------------------------------------------------------------------------
-- Increment 15 — the commercial portal view (ADR-203).
--
-- A residential customer wants to know when somebody is coming and what
-- they owe. A commercial customer — a food plant, a warehouse, a hospital —
-- wants to hand an auditor a binder. That binder is the same six questions
-- every time: what is open right now, where are my stations and what did
-- they catch, is the trend going the wrong way, what did you put down and
-- where is its safety sheet, and what did the last inspection say.
--
-- This increment adds NO tables. Every input already exists: crm_devices
-- and the append-only crm_device_events, crm_pest_sightings, crm_products
-- and crm_applications, crm_form_instances. What is missing is the
-- projection — the customer-shaped view of data that today only a staff
-- member can read. So this file is seven functions and one column.
--
-- Every read follows increment 10's pattern exactly and for the same
-- reasons: SECURITY DEFINER over crm_portal_account_for(auth.uid()), which
-- nobody can execute directly, so the caller cannot name an account. The
-- projections list their columns; anything internal is ABSENT from the
-- projection rather than filtered out of a row. Read the column lists —
-- that is the whole surface a commercial customer can see.
--
-- The one new column is provenance. A sighting a customer reports and a
-- sighting a technician observed are the same kind of fact and belong in
-- the same table, but a branch manager triaging the morning list needs to
-- know which of the two is in front of them. `reported_by_portal_user_id`
-- says so, and is null for everything staff wrote.
--
-- Honesty rules carried forward from increments 11 and 14, because a
-- compliance binder is exactly where a comfortable zero does real damage:
--
--   * A station with no service scan yet has a null last service and a
--     null activity reading. It is not a station that caught nothing.
--   * A station with no activity_threshold recorded has a null
--     `over_threshold`. There is no threshold, so it is not "under" one.
--   * A trend cell with no scans carrying a count reports null activity
--     and shows its scan count beside it, so an empty month reads as
--     "nobody looked" and never as "nothing found".
--   * A product with no SDS on file returns null, not a broken link.
-- ---------------------------------------------------------------------------

-- Provenance: who reported this sighting, when it was the customer.
alter table public.crm_pest_sightings
  add column if not exists reported_by_portal_user_id uuid;

do $$ begin
  alter table public.crm_pest_sightings
    add constraint crm_pest_sightings_portal_user_same_org
    foreign key (organization_id, reported_by_portal_user_id)
    references public.crm_portal_users (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists crm_pest_sightings_org_portal_user_idx
  on public.crm_pest_sightings (organization_id, reported_by_portal_user_id)
  where reported_by_portal_user_id is not null;

-- Supports both the open-conditions read and the staff sighting list.
create index if not exists crm_pest_sightings_org_account_open_idx
  on public.crm_pest_sightings (organization_id, account_id, sighted_at desc)
  where corrected_at is null;

create index if not exists crm_device_events_org_device_recorded_idx
  on public.crm_device_events (organization_id, device_id, recorded_at desc);

create index if not exists crm_applications_org_account_applied_idx
  on public.crm_applications (organization_id, account_id, applied_at desc);

-- ---------------------------------------------------------------------------
-- The sites. A commercial account is rarely one address, and every other
-- projection here is filtered by one of these ids.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_sites()
returns table (
  id uuid,
  label text,
  address text,
  property_type text,
  active_devices integer,
  open_sightings integer,
  last_visit_at timestamptz,
  next_visit_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p.id,
    p.label,
    p.address,
    p.property_type,
    (select count(*)::integer from public.crm_devices d
      where d.property_id = p.id and d.status = 'active'),
    (select count(*)::integer from public.crm_pest_sightings s
      where s.property_id = p.id and s.corrected_at is null),
    (select max(w.completed_at) from public.crm_work_orders w
      where w.property_id = p.id and w.status = 'completed'),
    (select min(w.scheduled_start) from public.crm_work_orders w
      where w.property_id = p.id
        and w.status in ('scheduled', 'dispatched')
        and w.scheduled_start >= now())
  from public.crm_portal_account_for(auth.uid()) me
  join public.crm_properties p
    on p.account_id = me.account_id and p.organization_id = me.organization_id
  order by p.label
  limit 500;
$$;

-- ---------------------------------------------------------------------------
-- The stations. `barcode` is included deliberately: it is the label
-- physically stuck to the station, so a customer walking the floor with a
-- clipboard can match the row to the box on the wall. It is an identifier
-- for a bait box, not a secret.
--
-- The last service, its condition and its count come from the append-only
-- ledger, not from a summary column, so what the portal shows and what an
-- auditor would find in crm_device_events are the same rows.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_devices(p_property_id uuid default null)
returns table (
  id uuid,
  property_id uuid,
  property_label text,
  label text,
  barcode text,
  device_type public.crm_device_type,
  status public.crm_device_status,
  location_note text,
  activity_threshold integer,
  installed_at timestamptz,
  last_service_at timestamptz,
  last_condition public.crm_device_condition,
  last_activity_count integer,
  last_pest_observed text,
  over_threshold boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (select * from public.crm_portal_account_for(auth.uid())),
  station as (
    select d.*
      from me
      join public.crm_devices d
        on d.account_id = me.account_id and d.organization_id = me.organization_id
     where p_property_id is null or d.property_id = p_property_id
  ),
  latest as (
    select distinct on (e.device_id)
           e.device_id, e.recorded_at, e.condition, e.activity_count, e.pest_observed
      from public.crm_device_events e
      join station s on s.id = e.device_id
     where e.event = 'service'
     order by e.device_id, e.recorded_at desc
  )
  select
    s.id, s.property_id, p.label, s.label, s.barcode, s.device_type, s.status,
    s.location_note, s.activity_threshold, s.installed_at,
    l.recorded_at, l.condition, l.activity_count, l.pest_observed,
    -- Null when there is no threshold to be over, and null when nothing has
    -- been counted yet. Only a real reading against a real threshold
    -- answers this question.
    case
      when s.activity_threshold is null or l.activity_count is null then null
      else l.activity_count >= s.activity_threshold
    end
  from station s
  join public.crm_properties p on p.id = s.property_id
  left join latest l on l.device_id = s.id
  order by p.label, s.label
  limit 2000;
$$;

-- ---------------------------------------------------------------------------
-- The trend. One row per month per station type — the shape a heat map
-- wants. `scans` sits next to `activity_total` on purpose: a dark cell
-- with two scans behind it and a dark cell with none mean opposite things,
-- and the grid has to be able to tell them apart.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_device_trend(
  p_months integer default 12,
  p_property_id uuid default null
)
returns table (
  month date,
  device_type public.crm_device_type,
  scans integer,
  scans_with_count integer,
  activity_total bigint,
  stations_flagged integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (select * from public.crm_portal_account_for(auth.uid())),
  bounded as (
    select greatest(1, least(coalesce(p_months, 12), 36)) as months
  ),
  station as (
    select d.id, d.device_type, d.activity_threshold
      from me
      join public.crm_devices d
        on d.account_id = me.account_id and d.organization_id = me.organization_id
     where p_property_id is null or d.property_id = p_property_id
  ),
  scan as (
    select date_trunc('month', e.recorded_at)::date as month,
           s.device_type,
           e.activity_count,
           s.activity_threshold,
           s.id as device_id
      from public.crm_device_events e
      join station s on s.id = e.device_id
      cross join bounded b
     where e.event = 'service'
       and e.recorded_at >= date_trunc('month', now()) - make_interval(months => b.months - 1)
  )
  select
    scan.month,
    scan.device_type,
    count(*)::integer,
    count(scan.activity_count)::integer,
    -- Null, not zero, when no scan in the cell carried a number.
    case when count(scan.activity_count) = 0 then null else sum(scan.activity_count)::bigint end,
    count(distinct scan.device_id) filter (
      where scan.activity_threshold is not null
        and scan.activity_count is not null
        and scan.activity_count >= scan.activity_threshold
    )::integer
  from scan
  group by scan.month, scan.device_type
  order by scan.month desc, scan.device_type;
$$;

-- ---------------------------------------------------------------------------
-- Open conditions — the single list a quality manager opens first. Two
-- kinds of fact, unioned into one shape: a sighting nobody has corrected,
-- and a station whose last scan came back wrong.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_conditions()
returns table (
  kind text,
  source_id uuid,
  property_id uuid,
  property_label text,
  headline text,
  detail text,
  severity text,
  observed_at timestamptz,
  reported_by_customer boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (select * from public.crm_portal_account_for(auth.uid())),
  sighting as (
    select
      'sighting'::text as kind,
      s.id as source_id,
      s.property_id,
      p.label as property_label,
      s.pest as headline,
      coalesce(s.location_note, s.note) as detail,
      s.severity::text as severity,
      s.sighted_at as observed_at,
      s.reported_by_portal_user_id is not null as reported_by_customer
    from me
    join public.crm_pest_sightings s
      on s.account_id = me.account_id and s.organization_id = me.organization_id
    join public.crm_properties p on p.id = s.property_id
    where s.corrected_at is null
  ),
  station as (
    select d.id, d.label, d.property_id, d.device_type, d.activity_threshold, d.organization_id
      from me
      join public.crm_devices d
        on d.account_id = me.account_id and d.organization_id = me.organization_id
     where d.status = 'active'
  ),
  latest as (
    select distinct on (e.device_id)
           e.device_id, e.recorded_at, e.condition, e.activity_count
      from public.crm_device_events e
      join station s on s.id = e.device_id
     where e.event = 'service'
     order by e.device_id, e.recorded_at desc
  ),
  flagged as (
    select
      'device'::text,
      s.id,
      s.property_id,
      p.label,
      s.label,
      case
        when l.condition in ('damaged', 'missing') then 'Station reported ' || l.condition::text
        when l.condition = 'needs_service' then 'Station flagged for service'
        else 'Activity ' || l.activity_count::text || ' at or above the threshold of '
             || s.activity_threshold::text
      end,
      case
        when l.condition in ('damaged', 'missing') then 'high'
        when s.activity_threshold is not null and l.activity_count is not null
             and l.activity_count >= s.activity_threshold * 2 then 'high'
        else 'moderate'
      end,
      l.recorded_at,
      false
    from station s
    join public.crm_properties p on p.id = s.property_id
    join latest l on l.device_id = s.id
    where l.condition in ('needs_service', 'damaged', 'missing')
       or (s.activity_threshold is not null
           and l.activity_count is not null
           and l.activity_count >= s.activity_threshold)
  )
  select * from sighting
  union all
  select * from flagged
  -- Positional: `observed_at` also names an output parameter of this
  -- function, and a bare reference here would be ambiguous.
  order by 8 desc
  limit 500;
$$;

-- ---------------------------------------------------------------------------
-- The safety library. Not a catalogue of everything the branch stocks —
-- only what was actually applied at this customer's own sites, which is
-- the set an inspector will ask about. The SDS and label references are
-- the manufacturer's published documents; a product with none on file
-- returns null and the portal says so rather than offering a dead link.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_safety_library()
returns table (
  product_id uuid,
  name text,
  epa_registration_number text,
  active_ingredient text,
  signal_word text,
  restricted_use boolean,
  sds_url text,
  label_url text,
  applications integer,
  last_applied_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    pr.id, pr.name, pr.epa_registration_number, pr.active_ingredient,
    pr.signal_word, pr.restricted_use, pr.sds_url, pr.label_url,
    count(*)::integer, max(a.applied_at)
  from public.crm_portal_account_for(auth.uid()) me
  join public.crm_applications a
    on a.account_id = me.account_id and a.organization_id = me.organization_id
  join public.crm_products pr on pr.id = a.product_id
  group by pr.id, pr.name, pr.epa_registration_number, pr.active_ingredient,
           pr.signal_word, pr.restricted_use, pr.sds_url, pr.label_url
  order by max(a.applied_at) desc
  limit 300;
$$;

-- ---------------------------------------------------------------------------
-- Inspection history. Completed instances only — an inspection that has
-- been assigned but not performed has nothing to report, and showing it
-- would let an empty row read as a finished one.
--
-- `signature_path` is a storage path, not a URL, and is not projected. The
-- portal is told a signature EXISTS; fetching it is a separate, signed
-- request the storage layer authorizes on its own terms.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_inspections()
returns table (
  id uuid,
  template_name text,
  template_kind public.crm_form_kind,
  property_id uuid,
  property_label text,
  completed_at timestamptz,
  signed_by_name text,
  signed_at timestamptz,
  has_signature boolean,
  notes text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    f.id, t.name, t.kind, f.property_id, p.label, f.completed_at,
    f.signed_by_name, f.signed_at, f.signature_path is not null, f.notes
  from public.crm_portal_account_for(auth.uid()) me
  join public.crm_form_instances f
    on f.account_id = me.account_id and f.organization_id = me.organization_id
  join public.crm_form_templates t on t.id = f.template_id
  left join public.crm_properties p on p.id = f.property_id
  where f.status = 'completed'
  order by f.completed_at desc
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- The one write. A commercial customer sees a roach at 06:00 and needs it
-- on the record before the branch opens; making them phone it in is how a
-- sighting log goes stale. The record lands in the same table a technician
-- writes to, so the trend and the open-conditions list see it immediately,
-- and it is stamped with the portal user who reported it.
--
-- The named site must be the caller's own — the same check
-- crm_portal_submit_request makes, for the same reason.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_report_sighting(
  p_property_id uuid,
  p_pest text,
  p_severity public.crm_sighting_severity default 'moderate',
  p_location_note text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_me record;
  v_id uuid;
begin
  select * into v_me from public.crm_portal_account_for(auth.uid());
  if v_me.account_id is null then
    raise exception 'no portal access' using errcode = 'insufficient_privilege';
  end if;
  if p_property_id is null or not exists (
    select 1 from public.crm_properties
     where id = p_property_id
       and account_id = v_me.account_id
       and organization_id = v_me.organization_id
  ) then
    raise exception 'that site is not on this account' using errcode = 'check_violation';
  end if;

  insert into public.crm_pest_sightings
    (organization_id, account_id, property_id, pest, severity, location_note, note,
     reported_by_portal_user_id, created_by)
  values
    (v_me.organization_id, v_me.account_id, p_property_id, p_pest, p_severity,
     p_location_note, p_note, v_me.portal_user_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Same shape as increment 10: the projections are reachable only
-- by a signed-in caller, and the resolver they lean on stays unreachable
-- to everybody.
-- ---------------------------------------------------------------------------

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'crm_portal_sites()',
    'crm_portal_devices(uuid)',
    'crm_portal_device_trend(integer, uuid)',
    'crm_portal_conditions()',
    'crm_portal_safety_library()',
    'crm_portal_inspections()',
    'crm_portal_report_sighting(uuid, text, public.crm_sighting_severity, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', v_function);
    execute format('grant execute on function public.%s to authenticated', v_function);
  end loop;
end;
$$;
