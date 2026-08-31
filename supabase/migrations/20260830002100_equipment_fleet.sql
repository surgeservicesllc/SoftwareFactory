-- Services CRM increment 13: equipment and fleet (task #68, owner /goal —
-- ADR-201). ServSuite and FieldRoutes both sell asset management, and the
-- competitor matrix carries it as a gap with no provider dependency: this
-- is a row that can be closed by writing code, unlike GPS telemetry
-- sitting beside it.
--
-- The shape follows the IPM stations (ADR-191), deliberately, because the
-- problem is the same one: a physical thing in the field whose current
-- state is only trustworthy if it is derived from what was recorded about
-- it. So:
--
--   * `crm_equipment_events` is APPEND-ONLY at the grant level. A
--     technician's meter reading, a service, an inspection, a transfer —
--     added to, never rewritten.
--   * `crm_equipment.status` and `assigned_technician_id` are PROJECTIONS
--     of that ledger, written by trigger. State cannot contradict the
--     history that produced it.
--   * An asset is born with its own acquisition event, so nothing can
--     predate its own record.
--
-- Two rules here are specific to fleet and are worth stating because both
-- are easy to get wrong in a way that looks fine:
--
--   1. A METER DOES NOT RUN BACKWARDS. An odometer or hour meter that
--      drops is a transposed digit or the wrong asset, and accepting it
--      silently corrupts every service interval computed from it after.
--      Refused by trigger, naming both readings.
--   2. NEXT SERVICE DUE IS NULL WHEN NOTHING SAYS WHEN. An asset with no
--      service interval on file is unscheduled, which is not the same as
--      "not due" — folding the two together is how a fleet report starts
--      claiming everything is fine.

do $$ begin
  create type public.crm_equipment_kind as enum (
    'vehicle', 'trailer', 'sprayer', 'bait_gun', 'meter', 'respirator',
    'thermal_camera', 'ladder', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_equipment_status as enum (
    'in_service', 'in_repair', 'out_of_service', 'retired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_equipment_event_kind as enum (
    'acquired', 'assigned', 'unassigned', 'service', 'inspection',
    'meter_reading', 'repair_opened', 'repair_closed', 'retired'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  /*
   * The field identity somebody reads off a sticker, and frequently types
   * one-handed on a phone. Unique per organization so a tag resolves to
   * exactly one asset, reusable across organizations because two companies
   * may both run a "TRUCK-04".
   *
   * Mixed case is accepted and uniqueness is case-INSENSITIVE (see the
   * index below): `truck-04` and `TRUCK-04` are the same sticker, so the
   * second one must collide rather than create a second asset. Refusing
   * lowercase outright would have made the `upper()` in that index
   * unreachable, which is what a test caught.
   */
  asset_tag text not null check (asset_tag ~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$'),
  kind public.crm_equipment_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  make text check (make is null or char_length(btrim(make)) between 1 and 120),
  model text check (model is null or char_length(btrim(model)) between 1 and 120),
  serial_number text check (serial_number is null or char_length(btrim(serial_number)) between 1 and 120),
  branch_id uuid,
  -- Derived from the ledger by trigger. Never written directly by a route.
  status public.crm_equipment_status not null default 'in_service',
  assigned_technician_id uuid,
  -- The last reading recorded, and its unit. Null until somebody reads it.
  meter_reading numeric(12, 1) check (meter_reading is null or meter_reading >= 0),
  meter_unit text check (meter_unit is null or meter_unit in ('miles', 'kilometres', 'hours')),
  meter_read_at timestamptz,
  -- How often it is meant to be serviced. Null means nobody has said, and
  -- the report must show that rather than assuming.
  service_interval_days integer
    check (service_interval_days is null or service_interval_days between 1 and 3650),
  last_serviced_on date,
  purchased_on date,
  retired_on date,
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_equipment_branch_same_org
    foreign key (organization_id, branch_id)
    references public.crm_branches (organization_id, id) on delete set null,
  constraint crm_equipment_technician_same_org
    foreign key (organization_id, assigned_technician_id)
    references public.crm_technicians (organization_id, id) on delete set null,
  -- A retired asset is retired: the date and the status agree, or neither
  -- is trustworthy.
  constraint crm_equipment_retired_iff_dated
    check ((status = 'retired') = (retired_on is not null)),
  constraint crm_equipment_retired_after_purchase
    check (retired_on is null or purchased_on is null or retired_on >= purchased_on),
  -- A reading and its moment and its unit arrive together or not at all.
  constraint crm_equipment_meter_complete
    check (num_nonnulls(meter_reading, meter_unit, meter_read_at) in (0, 3)),
  -- Nothing in the field is assigned to somebody once it is retired.
  constraint crm_equipment_retired_unassigned
    check (status <> 'retired' or assigned_technician_id is null),
  constraint crm_equipment_notes_no_secret check (not public.text_has_likely_secret(notes)),
  constraint crm_equipment_serial_no_secret check (not public.text_has_likely_secret(serial_number))
);

create unique index if not exists crm_equipment_org_id_key
  on public.crm_equipment (organization_id, id);
create unique index if not exists crm_equipment_org_tag_key
  on public.crm_equipment (organization_id, upper(btrim(asset_tag)));
create index if not exists crm_equipment_org_status_idx
  on public.crm_equipment (organization_id, status, kind);
create index if not exists crm_equipment_org_technician_idx
  on public.crm_equipment (organization_id, assigned_technician_id);

create table if not exists public.crm_equipment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null,
  kind public.crm_equipment_event_kind not null,
  technician_id uuid,
  -- The reading taken at this event, when the event is one that takes one.
  meter_reading numeric(12, 1) check (meter_reading is null or meter_reading >= 0),
  cost_cents bigint check (cost_cents is null or (cost_cents >= 0 and cost_cents <= 100000000000)),
  vendor text check (vendor is null or char_length(btrim(vendor)) between 1 and 160),
  note text check (note is null or char_length(note) between 1 and 2000),
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_equipment_events_equipment_same_org
    foreign key (organization_id, equipment_id)
    references public.crm_equipment (organization_id, id) on delete cascade,
  constraint crm_equipment_events_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete set null,
  -- An assignment names who it went to. Anything else is a transfer to
  -- nobody, which is what `unassigned` is for.
  constraint crm_equipment_events_assigned_has_technician
    check (kind <> 'assigned' or technician_id is not null),
  constraint crm_equipment_events_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_equipment_events_org_id_key
  on public.crm_equipment_events (organization_id, id);
create index if not exists crm_equipment_events_org_equipment_idx
  on public.crm_equipment_events (organization_id, equipment_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- An asset is born with its acquisition event, so nothing predates its own
-- record. Same reasoning as a station's install scan (ADR-191).
-- ---------------------------------------------------------------------------

create or replace function public.crm_record_equipment_acquired()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.crm_equipment_events
    (organization_id, equipment_id, kind, meter_reading, occurred_at, note, created_by)
  values
    (new.organization_id, new.id, 'acquired', new.meter_reading,
     coalesce(new.purchased_on::timestamptz, now()),
     'Added to the fleet.', new.created_by);
  return new;
end;
$$;

drop trigger if exists crm_equipment_record_acquired on public.crm_equipment;
create trigger crm_equipment_record_acquired
  after insert on public.crm_equipment
  for each row execute function public.crm_record_equipment_acquired();

-- ---------------------------------------------------------------------------
-- State is a projection of the ledger, and a meter never runs backwards.
-- ---------------------------------------------------------------------------

create or replace function public.crm_apply_equipment_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current numeric(12, 1);
  v_status public.crm_equipment_status;
begin
  select meter_reading, status into v_current, v_status
    from public.crm_equipment where id = new.equipment_id;

  -- Rule 1: a meter that drops is a transposed digit or the wrong asset.
  -- Accepting it silently corrupts every interval computed from it after,
  -- so it is refused by name with both readings in the message.
  if new.meter_reading is not null and v_current is not null
     and new.meter_reading < v_current then
    raise exception
      'a meter does not run backwards: reading % is below the recorded %',
      new.meter_reading, v_current
      using errcode = 'check_violation';
  end if;

  -- Nothing is recorded against a retired asset except the retirement
  -- itself, which cannot happen twice.
  if v_status = 'retired' then
    raise exception 'that asset is retired' using errcode = 'check_violation';
  end if;

  update public.crm_equipment
     set status = case new.kind
           when 'repair_opened' then 'in_repair'::public.crm_equipment_status
           when 'repair_closed' then 'in_service'::public.crm_equipment_status
           when 'retired' then 'retired'::public.crm_equipment_status
           else status
         end,
         assigned_technician_id = case new.kind
           when 'assigned' then new.technician_id
           when 'unassigned' then null
           when 'retired' then null
           else assigned_technician_id
         end,
         meter_reading = coalesce(new.meter_reading, meter_reading),
         meter_unit = case
           when new.meter_reading is not null then coalesce(meter_unit, 'miles')
           else meter_unit
         end,
         meter_read_at = case
           when new.meter_reading is not null then new.occurred_at
           else meter_read_at
         end,
         last_serviced_on = case
           when new.kind = 'service' then new.occurred_at::date
           else last_serviced_on
         end,
         retired_on = case
           when new.kind = 'retired' then new.occurred_at::date
           else retired_on
         end,
         updated_at = now()
   where id = new.equipment_id;

  return new;
end;
$$;

drop trigger if exists crm_equipment_events_apply on public.crm_equipment_events;
create trigger crm_equipment_events_apply
  after insert on public.crm_equipment_events
  for each row execute function public.crm_apply_equipment_event();

revoke all on function public.crm_record_equipment_acquired()
  from public, anon, authenticated, service_role;
revoke all on function public.crm_apply_equipment_event()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The fleet report. Invoker, on ADR-199's reasoning: it reads across the
-- whole fleet and must not see past its reader.
-- ---------------------------------------------------------------------------

create or replace function public.crm_fleet_status()
returns table (
  equipment_id uuid,
  asset_tag text,
  name text,
  kind public.crm_equipment_kind,
  status public.crm_equipment_status,
  branch_id uuid,
  assigned_technician_id uuid,
  meter_reading numeric,
  meter_unit text,
  last_serviced_on date,
  service_interval_days integer,
  -- Null when no interval is on file. Rule 2: unscheduled is not
  -- "not due", and a fleet report that conflates them claims everything
  -- is fine.
  next_service_due date,
  days_until_service integer,
  events integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.id, e.asset_tag, e.name, e.kind, e.status, e.branch_id,
         e.assigned_technician_id, e.meter_reading, e.meter_unit,
         e.last_serviced_on, e.service_interval_days,
         case
           when e.service_interval_days is null then null
           -- Never serviced but on a schedule: due from the day it was
           -- bought, which is the honest reading of "overdue since new".
           else coalesce(e.last_serviced_on, e.purchased_on)
                  + e.service_interval_days
         end,
         case
           when e.service_interval_days is null then null
           else (coalesce(e.last_serviced_on, e.purchased_on)
                   + e.service_interval_days - current_date)
         end,
         coalesce(v.events, 0)::integer
    from public.crm_equipment e
    left join lateral (
      select count(*)::integer as events
        from public.crm_equipment_events x
       where x.equipment_id = e.id
    ) v on true
   order by e.status, e.asset_tag
   limit 1000;
$$;

do $$ begin
  execute 'revoke all on function public.crm_fleet_status() from public, anon, service_role';
  execute 'grant execute on function public.crm_fleet_status() to authenticated';
end; $$;

-- ---------------------------------------------------------------------------
-- Row Level Security. The ledger is append-only at the grant level; the
-- asset itself is editable but never deletable — a truck that leaves the
-- fleet is retired, and its history stays attached to it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_equipment', 'crm_equipment_events'] loop
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

    execute format('grant select, insert on table public.%I to authenticated', v_table);
  end loop;

  -- The asset carries editable description; the ledger does not.
  execute 'drop policy if exists crm_equipment_update_member on public.crm_equipment';
  execute 'create policy crm_equipment_update_member on public.crm_equipment
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  execute 'grant update on table public.crm_equipment to authenticated';

  execute 'drop trigger if exists crm_equipment_set_updated_at on public.crm_equipment';
  execute 'create trigger crm_equipment_set_updated_at before update on public.crm_equipment
             for each row execute function public.set_updated_at()';
end;
$$;
