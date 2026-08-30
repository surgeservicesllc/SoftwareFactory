-- Services CRM increment 4: pest/IPM core (task #63, owner /goal —
-- ADR-190). Devices/stations with barcode identity, an append-only scan
-- ledger, and pest sighting logs with corrective actions — the
-- differentiator pillar, on the established posture: org-scoped forced
-- RLS, revoke-then-grant against hosted default privileges,
-- anon/service_role shut out, same-account property integrity by
-- three-column composite keys.
--
-- The compliance stance is structural:
--   - The scan ledger (crm_device_events) is APPEND-ONLY at the grant
--     level, exactly like the account timeline: a station's history can
--     be added to, never rewritten — an auditor reads what the technician
--     scanned, not what someone later wished they had.
--   - Devices are never deleted. A pulled station is a 'remove' scan; the
--     device row and its whole ledger remain.
--   - Device state (active/removed, current location) is maintained by a
--     trigger FROM the ledger, so the state can never contradict the
--     history that produced it.
--   - Sightings are never deleted; a resolved sighting records its
--     corrective action and keeps its past.

do $$ begin
  create type public.crm_device_type as enum (
    'bait_station', 'snap_trap', 'multi_catch', 'insect_light_trap', 'pheromone_trap', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_device_status as enum ('active', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_device_event_kind as enum ('install', 'service', 'move', 'remove');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_device_condition as enum ('ok', 'needs_service', 'damaged', 'missing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_sighting_severity as enum ('low', 'moderate', 'high');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Devices: the stations on a site. The barcode is the field identity — one
-- scanable string per organization, unique so a scan can never resolve to
-- two stations. activity_threshold is the IPM trigger point: a service scan
-- at or above it flags the station on the dashboard.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  device_type public.crm_device_type not null,
  barcode text not null check (barcode ~ '^[A-Za-z0-9._\-]{4,64}$'),
  status public.crm_device_status not null default 'active',
  location_note text check (location_note is null or char_length(location_note) between 1 and 300),
  activity_threshold integer check (activity_threshold is null or activity_threshold between 1 and 100000),
  installed_at timestamptz not null default now(),
  removed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_devices_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  constraint crm_devices_removed_iff_timestamp
    check ((status = 'removed') = (removed_at is not null)),
  constraint crm_devices_location_no_secret check (not public.text_has_likely_secret(location_note))
);

create unique index if not exists crm_devices_org_barcode_key
  on public.crm_devices (organization_id, barcode);
create unique index if not exists crm_devices_org_id_key
  on public.crm_devices (organization_id, id);
-- The scan ledger references its work order by the same-org pair; work
-- orders were never a composite target before, so the key arrives here.
create unique index if not exists crm_work_orders_org_id_key
  on public.crm_work_orders (organization_id, id);

-- ---------------------------------------------------------------------------
-- The scan ledger: every install/service/move/remove that ever touched a
-- station. Append-only at the grant level; device state is derived from it
-- by trigger, never written around it.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_device_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null,
  event public.crm_device_event_kind not null,
  condition public.crm_device_condition,
  -- Captures, consumption points, or trap counts — the trend's raw number.
  activity_count integer check (activity_count is null or activity_count between 0 and 100000),
  pest_observed text check (pest_observed is null or char_length(btrim(pest_observed)) between 1 and 120),
  location_note text check (location_note is null or char_length(location_note) between 1 and 300),
  note text check (note is null or char_length(note) between 1 and 1000),
  work_order_id uuid,
  recorded_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  constraint crm_device_events_device_same_org
    foreign key (organization_id, device_id)
    references public.crm_devices (organization_id, id) on delete cascade,
  constraint crm_device_events_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_device_events_location_no_secret check (not public.text_has_likely_secret(location_note)),
  constraint crm_device_events_note_no_secret check (not public.text_has_likely_secret(note))
);

-- Every device begins with its install scan, written by the database the
-- moment the device row exists — a station can never predate its ledger.
create or replace function public.crm_record_device_install()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.crm_device_events
    (organization_id, device_id, event, location_note, recorded_at, actor_user_id)
  values (new.organization_id, new.id, 'install', new.location_note, new.installed_at, auth.uid());
  return new;
end;
$$;

revoke all on function public.crm_record_device_install()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_devices_record_install on public.crm_devices;
create trigger crm_devices_record_install
  after insert on public.crm_devices
  for each row execute function public.crm_record_device_install();

-- Device state follows the ledger: install (re)activates, remove closes,
-- move relocates. The scan is the source of truth; the device row is its
-- projection.
create or replace function public.crm_apply_device_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.event = 'install' then
    update public.crm_devices
       set status = 'active', removed_at = null,
           location_note = coalesce(new.location_note, location_note),
           installed_at = new.recorded_at
     where id = new.device_id;
  elsif new.event = 'remove' then
    update public.crm_devices
       set status = 'removed', removed_at = new.recorded_at
     where id = new.device_id;
  elsif new.event = 'move' and new.location_note is not null then
    update public.crm_devices
       set location_note = new.location_note
     where id = new.device_id;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_apply_device_event()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_device_events_apply on public.crm_device_events;
create trigger crm_device_events_apply
  after insert on public.crm_device_events
  for each row execute function public.crm_apply_device_event();

-- ---------------------------------------------------------------------------
-- Pest sightings: the log the IPM workflow starts from. A sighting is
-- resolved by recording its corrective action — never by deleting it.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_pest_sightings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  pest text not null check (char_length(btrim(pest)) between 1 and 120),
  severity public.crm_sighting_severity not null default 'moderate',
  location_note text check (location_note is null or char_length(location_note) between 1 and 300),
  note text check (note is null or char_length(note) between 1 and 1000),
  sighted_at timestamptz not null default now(),
  corrective_action text check (corrective_action is null or char_length(corrective_action) between 1 and 1000),
  corrected_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_pest_sightings_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  -- A correction timestamp without its action is a claim with no content.
  constraint crm_pest_sightings_corrected_iff_action
    check ((corrected_at is not null) = (corrective_action is not null)),
  constraint crm_pest_sightings_location_no_secret check (not public.text_has_likely_secret(location_note)),
  constraint crm_pest_sightings_note_no_secret check (not public.text_has_likely_secret(note)),
  constraint crm_pest_sightings_action_no_secret check (not public.text_has_likely_secret(corrective_action))
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_devices', 'crm_pest_sightings'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants: forced member RLS everywhere,
-- revoke-then-grant against hosted defaults. Devices and sightings may be
-- corrected (update) but never deleted; the scan ledger takes select and
-- insert ONLY — its immutability is the absence of every other grant.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_devices', 'crm_device_events', 'crm_pest_sightings'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_member', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id))',
      v_table || '_select_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_member', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id))',
      v_table || '_insert_member', v_table);
  end loop;

  foreach v_table in array array['crm_devices', 'crm_pest_sightings'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);
  end loop;
end;
$$;

grant select, insert, update on table public.crm_devices to authenticated;
grant select, insert on table public.crm_device_events to authenticated;
grant select, insert, update on table public.crm_pest_sightings to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes: the dashboard's and the scanner's reads.
-- ---------------------------------------------------------------------------

create index if not exists crm_devices_org_property_idx
  on public.crm_devices (organization_id, property_id, status);
create index if not exists crm_device_events_device_time_idx
  on public.crm_device_events (organization_id, device_id, recorded_at desc);
create index if not exists crm_pest_sightings_org_open_idx
  on public.crm_pest_sightings (organization_id, property_id, sighted_at desc)
  where corrected_at is null;
create index if not exists crm_pest_sightings_org_property_idx
  on public.crm_pest_sightings (organization_id, property_id, sighted_at desc);
