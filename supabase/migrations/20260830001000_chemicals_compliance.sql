-- Services CRM increment 5: chemicals & compliance (task #63, owner /goal
-- — ADR-191). The regulated half of pest services: what was applied,
-- where, at what rate, by whom under which license, from which lot — and
-- the jurisdiction rules that decide what a given state requires.
--
-- The compliance stance is structural, on the established posture
-- (org-scoped forced RLS, revoke-then-grant against hosted default
-- privileges, anon/service_role shut out, same-org composite keys):
--
--   1. Application records are APPEND-ONLY at the grant level. A
--      pesticide application is a legal record: it may be read and
--      created, never edited or deleted. An error is corrected by
--      recording a superseding application that references the first,
--      exactly as a paper log is corrected by a later entry.
--   2. An application names its applicator AND the license they held.
--      The license is COPIED onto the record, not merely referenced: a
--      technician's license number may be corrected or renewed later,
--      and the application must still say what was true that day.
--   3. Regulatory rules are configurable rows, never hardcoded. A
--      jurisdiction ("US-OR", "US-TX", "CA-ON") carries its own record
--      retention window and its own required fields; nothing in this
--      schema privileges one state's requirements.
--   4. Products carry SDS and label references as URLs, checked to be
--      https — a compliance officer follows the link the workspace
--      recorded, and a secret can never masquerade as one.

do $$ begin
  create type public.crm_application_method as enum (
    'bait', 'crack_and_crevice', 'spot', 'perimeter', 'broadcast', 'void', 'dust', 'fumigation', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_measure_unit as enum ('oz', 'fl_oz', 'lb', 'g', 'kg', 'ml', 'l', 'gal', 'each');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The chemical catalogue: what this workspace is licensed to apply. EPA
-- registration numbers are the regulator's identity for a product, so they
-- are unique per organization where present.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  epa_registration_number text check (
    epa_registration_number is null or epa_registration_number ~ '^[0-9]{2,7}-[0-9]{1,7}(-[0-9]{1,7})?$'
  ),
  active_ingredient text check (active_ingredient is null or char_length(btrim(active_ingredient)) between 1 and 200),
  signal_word text check (signal_word is null or signal_word in ('CAUTION', 'WARNING', 'DANGER')),
  -- SDS and label live where the manufacturer publishes them; the workspace
  -- records the reference so an audit can follow it.
  sds_url text check (sds_url is null or sds_url ~ '^https://[^[:space:]]{4,500}$'),
  label_url text check (label_url is null or label_url ~ '^https://[^[:space:]]{4,500}$'),
  restricted_use boolean not null default false,
  default_unit public.crm_measure_unit,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_products_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_products_ingredient_no_secret check (not public.text_has_likely_secret(active_ingredient))
);

create unique index if not exists crm_products_org_id_key
  on public.crm_products (organization_id, id);
create unique index if not exists crm_products_org_epa_key
  on public.crm_products (organization_id, epa_registration_number)
  where epa_registration_number is not null;

-- ---------------------------------------------------------------------------
-- Lots: the traceable batch. Quantity on hand moves with each application,
-- maintained by trigger so the ledger and the shelf agree.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_product_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  lot_number text not null check (char_length(btrim(lot_number)) between 1 and 100),
  unit public.crm_measure_unit not null,
  quantity_received numeric(14, 3) not null check (quantity_received > 0 and quantity_received <= 1000000),
  quantity_remaining numeric(14, 3) not null check (quantity_remaining >= 0),
  received_on date not null default current_date,
  expires_on date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_product_lots_product_same_org
    foreign key (organization_id, product_id)
    references public.crm_products (organization_id, id) on delete cascade,
  constraint crm_product_lots_remaining_within_received
    check (quantity_remaining <= quantity_received),
  constraint crm_product_lots_expiry_after_receipt
    check (expires_on is null or expires_on >= received_on)
);

create unique index if not exists crm_product_lots_org_id_key
  on public.crm_product_lots (organization_id, id);
create unique index if not exists crm_product_lots_org_product_lot_key
  on public.crm_product_lots (organization_id, product_id, lot_number);

-- ---------------------------------------------------------------------------
-- Applications: the legal record. Append-only; a mistake is corrected by a
-- superseding record that names the one it replaces.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  work_order_id uuid,
  product_id uuid not null,
  lot_id uuid,
  device_id uuid,
  technician_id uuid not null,
  -- The license as it stood on the day, copied — not a live reference.
  applicator_license text check (applicator_license is null or char_length(btrim(applicator_license)) between 1 and 60),
  method public.crm_application_method not null,
  target_pest text check (target_pest is null or char_length(btrim(target_pest)) between 1 and 120),
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 1000000),
  unit public.crm_measure_unit not null,
  -- Free text because labels state rates in their own words ("0.5 oz per
  -- gallon", "1 lb / 1000 sq ft"); bounded and secret-guarded.
  application_rate text check (application_rate is null or char_length(btrim(application_rate)) between 1 and 200),
  treated_area text check (treated_area is null or char_length(btrim(treated_area)) between 1 and 300),
  location_note text check (location_note is null or char_length(location_note) between 1 and 300),
  note text check (note is null or char_length(note) between 1 and 1000),
  applied_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  -- A correction names the record it supersedes; the original stays.
  supersedes_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_applications_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  constraint crm_applications_product_same_org
    foreign key (organization_id, product_id)
    references public.crm_products (organization_id, id) on delete restrict,
  constraint crm_applications_lot_same_org
    foreign key (organization_id, lot_id)
    references public.crm_product_lots (organization_id, id) on delete restrict,
  constraint crm_applications_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete restrict,
  constraint crm_applications_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_applications_device_same_org
    foreign key (organization_id, device_id)
    references public.crm_devices (organization_id, id) on delete set null,
  constraint crm_applications_not_self_superseding check (supersedes_id is distinct from id),
  constraint crm_applications_rate_no_secret check (not public.text_has_likely_secret(application_rate)),
  constraint crm_applications_note_no_secret check (not public.text_has_likely_secret(note)),
  constraint crm_applications_area_no_secret check (not public.text_has_likely_secret(treated_area))
);

create unique index if not exists crm_applications_org_id_key
  on public.crm_applications (organization_id, id);

-- The self-reference is added after the table, because the composite key it
-- points at is this very table's own index: it cannot exist inline.
do $$ begin
  alter table public.crm_applications
    add constraint crm_applications_supersedes_same_org
    foreign key (organization_id, supersedes_id)
    references public.crm_applications (organization_id, id) on delete restrict;
exception when duplicate_object then null; end $$;

-- An application draws down its lot, in the same transaction, and refuses
-- to draw more than the lot holds. Unit mismatch is refused outright: an
-- ounce is not a litre, and silently converting would falsify the record.
create or replace function public.crm_apply_lot_drawdown()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_unit public.crm_measure_unit;
  v_remaining numeric(14, 3);
begin
  if new.lot_id is null then
    return new;
  end if;
  select unit, quantity_remaining into v_unit, v_remaining
    from public.crm_product_lots where id = new.lot_id for update;
  if v_unit is distinct from new.unit then
    raise exception 'application unit % does not match lot unit %', new.unit, v_unit
      using errcode = 'check_violation';
  end if;
  if v_remaining < new.quantity then
    raise exception 'lot holds % but the application draws %', v_remaining, new.quantity
      using errcode = 'check_violation';
  end if;
  update public.crm_product_lots
     set quantity_remaining = quantity_remaining - new.quantity
   where id = new.lot_id;
  return new;
end;
$$;

revoke all on function public.crm_apply_lot_drawdown()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_applications_draw_lot on public.crm_applications;
create trigger crm_applications_draw_lot
  after insert on public.crm_applications
  for each row execute function public.crm_apply_lot_drawdown();

-- Every application lands on the account's immutable timeline as a
-- 'service' event, in the same transaction — the compliance record and the
-- customer's history can never disagree about what was applied.
create or replace function public.crm_record_application_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_product text;
begin
  select name into v_product from public.crm_products where id = new.product_id;
  insert into public.crm_timeline_events
    (organization_id, account_id, kind, summary, detail, occurred_at, actor_user_id)
  values (
    new.organization_id,
    new.account_id,
    'service',
    format('Applied %s (%s %s).', coalesce(v_product, 'product'), new.quantity, new.unit),
    nullif(concat_ws(' ',
      format('Method: %s.', new.method),
      case when new.target_pest is not null then format('Target: %s.', new.target_pest) else null end,
      case when new.application_rate is not null then format('Rate: %s.', new.application_rate) else null end,
      case when new.treated_area is not null then format('Area: %s.', new.treated_area) else null end
    ), ''),
    new.applied_at,
    auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.crm_record_application_event()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_applications_record_event on public.crm_applications;
create trigger crm_applications_record_event
  after insert on public.crm_applications
  for each row execute function public.crm_record_application_event();

-- ---------------------------------------------------------------------------
-- Jurisdiction rules: configurable per organization, never hardcoded. Each
-- row states one jurisdiction's retention window and required fields.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_compliance_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- "US-OR", "US-TX", "CA-ON" — a code the workspace chooses, not a fixed list.
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,10})?$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  retention_years integer not null check (retention_years between 1 and 100),
  requires_applicator_license boolean not null default true,
  requires_target_pest boolean not null default false,
  requires_application_rate boolean not null default false,
  requires_treated_area boolean not null default false,
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_compliance_rules_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_compliance_rules_org_jurisdiction_key
  on public.crm_compliance_rules (organization_id, jurisdiction);

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_products', 'crm_product_lots', 'crm_compliance_rules'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants. Applications take select+insert ONLY —
-- invariant 1, stated where no policy mistake can undo it. Nothing here is
-- deletable: a discontinued product is inactive, a spent lot is zero.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_products', 'crm_product_lots', 'crm_applications', 'crm_compliance_rules'
  ] loop
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

  foreach v_table in array array['crm_products', 'crm_product_lots', 'crm_compliance_rules'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);
  end loop;
end;
$$;

grant select, insert, update on table public.crm_products to authenticated;
grant select, insert, update on table public.crm_product_lots to authenticated;
grant select, insert, update on table public.crm_compliance_rules to authenticated;
-- Invariant 1: the application log can be read and appended, never rewritten.
grant select, insert on table public.crm_applications to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes: the compliance report's reads.
-- ---------------------------------------------------------------------------

create index if not exists crm_applications_org_applied_idx
  on public.crm_applications (organization_id, applied_at desc);
create index if not exists crm_applications_org_account_idx
  on public.crm_applications (organization_id, account_id, applied_at desc);
create index if not exists crm_applications_org_property_idx
  on public.crm_applications (organization_id, property_id, applied_at desc);
create index if not exists crm_applications_org_product_idx
  on public.crm_applications (organization_id, product_id, applied_at desc);
create index if not exists crm_applications_org_technician_idx
  on public.crm_applications (organization_id, technician_id, applied_at desc);
create index if not exists crm_product_lots_org_product_idx
  on public.crm_product_lots (organization_id, product_id, expires_on);
