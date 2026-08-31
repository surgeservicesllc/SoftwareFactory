-- ---------------------------------------------------------------------------
-- Increment 22 — a place inside a place (ADR-215).
--
-- An account has properties and a property has stations, work orders and
-- sightings. Nothing sits BELOW a property, so a 200-unit apartment block
-- is one row here and two hundred service points in reality.
--
-- That is the shape PestPac sells as Multi-Unit, and it is the last row on
-- the competitor board that needed neither a provider account, an owner
-- authorization, nor object storage — only a level in the schema.
--
-- WHAT MAKES IT MORE THAN A LABEL: everything that happens at a place can
-- now name the unit it happened in, through a COMPOSITE foreign key that
-- carries the property along. A work order at Harborview cannot name a unit
-- of Fairview, because the reference is (organization, property, unit)
-- rather than (unit). Getting that wrong is how multi-unit becomes a
-- reporting feature that quietly attributes a treatment to the wrong home.
--
-- WHAT IT DELIBERATELY DOES NOT DO: invent occupancy. A unit is a place, not
-- a person. It carries an occupant NAME because a technician knocking needs
-- one, and nothing else about them — no contact record, no separate account,
-- no billing identity. A unit is billed through the account that owns the
-- property, which is how these contracts are actually written.
-- ---------------------------------------------------------------------------

-- The composite key this level needs. `crm_properties` carries
-- (organization, account, id) from increment 3 but never (organization, id)
-- on its own, and a unit belongs to a property regardless of which account
-- holds it — so the narrower key is the right target and it arrives here.
create unique index if not exists crm_properties_org_id_key
  on public.crm_properties (organization_id, id);

create table if not exists public.crm_property_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,

  -- What is on the door: "4B", "Suite 210", "Bay 3", "Common laundry".
  label text not null check (char_length(btrim(label)) between 1 and 60),

  unit_type text check (unit_type is null or char_length(btrim(unit_type)) between 1 and 60),

  -- A name to ask for, not a contact record. See the note above.
  occupant_name text check (occupant_name is null or char_length(btrim(occupant_name)) between 1 and 160),

  access_notes text check (access_notes is null or char_length(access_notes) between 1 and 1000),

  -- A unit that is empty, refused entry, or taken out of the programme is
  -- still a unit. Servicing stops; the row and its history stay.
  active boolean not null default true,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_property_units_property_same_org
    foreign key (organization_id, property_id)
    references public.crm_properties (organization_id, id) on delete cascade,
  constraint crm_property_units_occupant_no_secret
    check (not public.text_has_likely_secret(occupant_name)),
  constraint crm_property_units_access_no_secret
    check (not public.text_has_likely_secret(access_notes))
);

-- Two doors cannot carry the same number. Case-insensitive, because "4b" and
-- "4B" are one door and a second row for it would split its history.
create unique index if not exists crm_property_units_label_key
  on public.crm_property_units (organization_id, property_id, lower(btrim(label)));

-- The composite target. Everything below references this triple rather than
-- the id alone, which is what stops a unit being attached to the wrong site.
create unique index if not exists crm_property_units_property_id_key
  on public.crm_property_units (organization_id, property_id, id);
create index if not exists crm_property_units_property_idx
  on public.crm_property_units (organization_id, property_id, active);

-- ---------------------------------------------------------------------------
-- The things that happen at a place can now say which door.
--
-- Nullable everywhere, deliberately: a single-family home has no units, and
-- every row already written stays exactly as valid as it was.
-- ---------------------------------------------------------------------------

alter table public.crm_work_orders add column if not exists unit_id uuid;
alter table public.crm_devices add column if not exists unit_id uuid;
alter table public.crm_pest_sightings add column if not exists unit_id uuid;
alter table public.crm_service_plans add column if not exists unit_id uuid;

do $$ begin
  alter table public.crm_work_orders
    add constraint crm_work_orders_unit_same_property
    foreign key (organization_id, property_id, unit_id)
    references public.crm_property_units (organization_id, property_id, id)
    -- SET NULL (unit_id), not a bare SET NULL: a bare one nulls EVERY
    -- referencing column, and two of these three are NOT NULL — deleting a
    -- door would have tried to erase the visit's organization and property
    -- and failed at the constraint. The column list nulls the door alone.
    on delete set null (unit_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_devices
    add constraint crm_devices_unit_same_property
    foreign key (organization_id, property_id, unit_id)
    references public.crm_property_units (organization_id, property_id, id)
    -- SET NULL (unit_id), not a bare SET NULL: a bare one nulls EVERY
    -- referencing column, and two of these three are NOT NULL — deleting a
    -- door would have tried to erase the visit's organization and property
    -- and failed at the constraint. The column list nulls the door alone.
    on delete set null (unit_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_pest_sightings
    add constraint crm_pest_sightings_unit_same_property
    foreign key (organization_id, property_id, unit_id)
    references public.crm_property_units (organization_id, property_id, id)
    -- SET NULL (unit_id), not a bare SET NULL: a bare one nulls EVERY
    -- referencing column, and two of these three are NOT NULL — deleting a
    -- door would have tried to erase the visit's organization and property
    -- and failed at the constraint. The column list nulls the door alone.
    on delete set null (unit_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_service_plans
    add constraint crm_service_plans_unit_same_property
    foreign key (organization_id, property_id, unit_id)
    references public.crm_property_units (organization_id, property_id, id)
    -- SET NULL (unit_id), not a bare SET NULL: a bare one nulls EVERY
    -- referencing column, and two of these three are NOT NULL — deleting a
    -- door would have tried to erase the visit's organization and property
    -- and failed at the constraint. The column list nulls the door alone.
    on delete set null (unit_id);
exception when duplicate_object then null; end $$;

create index if not exists crm_work_orders_unit_idx
  on public.crm_work_orders (organization_id, unit_id) where unit_id is not null;
create index if not exists crm_devices_unit_idx
  on public.crm_devices (organization_id, unit_id) where unit_id is not null;

-- ---------------------------------------------------------------------------
-- The question multi-unit exists to answer: which doors were missed.
--
-- A 200-unit block where 188 were treated and 12 were never entered is the
-- normal outcome of a building sweep, and the twelve are the whole point.
-- Counting the treated ones is easy and useless; naming the untreated ones
-- is what stops a re-infestation from the unit nobody opened.
--
-- SECURITY INVOKER: it reads the caller's own book through RLS, like every
-- other reader here.
-- ---------------------------------------------------------------------------

create or replace function public.crm_property_unit_coverage(
  p_property uuid,
  p_since date default (current_date - 90)
)
returns table (
  unit_id uuid,
  unit_label text,
  unit_active boolean,
  occupant_name text,
  last_serviced_at timestamptz,
  visits_in_window bigint,
  active_stations bigint,
  open_sightings bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    u.id,
    u.label,
    u.active,
    u.occupant_name,
    (select max(w.completed_at)
       from public.crm_work_orders w
      where w.organization_id = u.organization_id and w.unit_id = u.id
        and w.status = 'completed'),
    (select count(*)
       from public.crm_work_orders w
      where w.organization_id = u.organization_id and w.unit_id = u.id
        and w.status = 'completed'
        and w.completed_at >= p_since::timestamptz),
    (select count(*)
       from public.crm_devices d
      where d.organization_id = u.organization_id and d.unit_id = u.id
        and d.status = 'active'),
    (select count(*)
       from public.crm_pest_sightings s
      where s.organization_id = u.organization_id and s.unit_id = u.id
        and s.corrected_at is null)
    from public.crm_property_units u
   where u.property_id = p_property
   -- Never serviced sorts first: a null last-serviced is the row an operator
   -- most needs to see, and burying it under the ones that went fine is how
   -- it gets missed twice.
   --
   -- Positional, because `last_serviced_at` names an OUT parameter of this
   -- function and is not a column in this query's scope — the same trap as
   -- ADR-203's `observed_at`. Columns are 3 = active, 5 = last serviced,
   -- 2 = label.
   order by 3 desc, 5 asc nulls first, 2;
$$;

revoke all on function public.crm_property_unit_coverage(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_property_unit_coverage(uuid, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. REVOKE first: hosted default privileges grant ALL on every new table,
-- and a narrower grant on top of ALL narrows nothing.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_property_units enable row level security';
  execute 'alter table public.crm_property_units force row level security';
  execute 'revoke all on table public.crm_property_units
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_property_units_select_member on public.crm_property_units';
  execute 'create policy crm_property_units_select_member on public.crm_property_units
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_property_units_insert_member on public.crm_property_units';
  execute 'create policy crm_property_units_insert_member on public.crm_property_units
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_property_units_update_member on public.crm_property_units';
  execute 'create policy crm_property_units_update_member on public.crm_property_units
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';

  -- A unit may be removed while it holds no history; once a visit, station or
  -- sighting names it those references null out rather than cascade, so the
  -- work is never deleted with the door.
  execute 'drop policy if exists crm_property_units_delete_member on public.crm_property_units';
  execute 'create policy crm_property_units_delete_member on public.crm_property_units
             for delete to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'grant select, insert, update, delete on table public.crm_property_units to authenticated';
end;
$$;
