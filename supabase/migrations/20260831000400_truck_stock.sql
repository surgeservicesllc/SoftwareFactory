-- ---------------------------------------------------------------------------
-- Increment 21 — where the material physically is (ADR-213).
--
-- `crm_product_lots` already knows how much of a lot is LEFT: an
-- application decrements `quantity_remaining` by trigger (increment 6), so
-- that number is real rather than decorative. What no table has known is
-- WHERE the remainder sits. "We have 40 oz of Termidor" and "the 40 oz is
-- on a truck that left at six" are different facts, and only the second
-- one tells a technician whether to load.
--
-- THE LEDGER IS THE BALANCE. Nothing stores an on-hand figure, because a
-- stored one drifts the first time somebody forgets to type the other
-- half. `crm_stock_on_hand` sums the movements, so a truck's stock is
-- always exactly the movements that put material there minus the ones
-- that took it away.
--
-- LOCATIONS ARE THE ROWS THAT ALREADY EXIST. A warehouse is a branch
-- (increment 13); a truck or a sprayer is equipment (increment 15). A
-- third table naming the same places would be a second source of truth
-- about where a depot is.
--
-- THE ONE THING THAT MUST BE IMPOSSIBLE: a location holding a negative
-- amount of a chemical. That is not a display bug — it means the record
-- of what a regulated product was used on is wrong somewhere. The guard
-- locks the lot before it reads the balance, because two technicians
-- drawing the last of a lot at the same moment is exactly when a
-- read-then-write check fails.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_stock_movement_kind as enum (
    'receipt', 'transfer', 'consumption', 'adjustment'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lot_id uuid not null,
  kind public.crm_stock_movement_kind not null,

  -- Always positive. Direction is carried by which side is filled in, not
  -- by a sign, so a movement cannot claim to add and subtract at once.
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 1000000),

  -- Where it came from. Null on both for a receipt: the material entered
  -- the book here.
  from_branch_id uuid,
  from_equipment_id uuid,

  -- Where it went. Null on both for a consumption: it was applied.
  to_branch_id uuid,
  to_equipment_id uuid,

  -- A consumption names the application it served, so the stock ledger and
  -- the compliance log cannot disagree about what was used.
  application_id uuid,

  note text check (note is null or char_length(btrim(note)) between 1 and 300),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,

  constraint crm_stock_movements_lot_same_org
    foreign key (organization_id, lot_id)
    references public.crm_product_lots (organization_id, id) on delete cascade,
  constraint crm_stock_movements_from_branch_same_org
    foreign key (organization_id, from_branch_id)
    references public.crm_branches (organization_id, id) on delete restrict,
  constraint crm_stock_movements_to_branch_same_org
    foreign key (organization_id, to_branch_id)
    references public.crm_branches (organization_id, id) on delete restrict,
  constraint crm_stock_movements_from_equipment_same_org
    foreign key (organization_id, from_equipment_id)
    references public.crm_equipment (organization_id, id) on delete restrict,
  constraint crm_stock_movements_to_equipment_same_org
    foreign key (organization_id, to_equipment_id)
    references public.crm_equipment (organization_id, id) on delete restrict,
  constraint crm_stock_movements_application_same_org
    foreign key (organization_id, application_id)
    references public.crm_applications (organization_id, id) on delete restrict,

  -- One place per side, at most.
  constraint crm_stock_movements_one_source
    check (num_nonnulls(from_branch_id, from_equipment_id) <= 1),
  constraint crm_stock_movements_one_destination
    check (num_nonnulls(to_branch_id, to_equipment_id) <= 1),

  -- Each kind fills in exactly the sides it means.
  constraint crm_stock_movements_shape check (
    case kind
      when 'receipt' then
        num_nonnulls(from_branch_id, from_equipment_id) = 0
        and num_nonnulls(to_branch_id, to_equipment_id) = 1
      when 'consumption' then
        num_nonnulls(from_branch_id, from_equipment_id) = 1
        and num_nonnulls(to_branch_id, to_equipment_id) = 0
      when 'transfer' then
        num_nonnulls(from_branch_id, from_equipment_id) = 1
        and num_nonnulls(to_branch_id, to_equipment_id) = 1
      -- An adjustment is a count correction in one direction: material
      -- found (a destination) or material gone (a source), never both.
      when 'adjustment' then
        num_nonnulls(from_branch_id, from_equipment_id)
          + num_nonnulls(to_branch_id, to_equipment_id) = 1
    end
  ),

  -- A transfer to the place it came from is a typo, not a movement.
  constraint crm_stock_movements_transfer_moves check (
    kind <> 'transfer'
    or from_branch_id is distinct from to_branch_id
    or from_equipment_id is distinct from to_equipment_id
  ),

  -- Only a consumption serves an application, and an adjustment that
  -- claimed one would be a second story about the same chemical.
  constraint crm_stock_movements_application_iff_consumption
    check ((kind = 'consumption') = (application_id is not null)),

  constraint crm_stock_movements_recorded_after_event
    check (recorded_at >= occurred_at - interval '1 minute'),
  constraint crm_stock_movements_note_no_secret
    check (not public.text_has_likely_secret(note))
);

-- One application draws stock once. A replayed field sync (ADR-210) must
-- not take the same ounces off a truck twice.
create unique index if not exists crm_stock_movements_one_draw_per_application
  on public.crm_stock_movements (organization_id, application_id)
  where application_id is not null;

create index if not exists crm_stock_movements_lot_idx
  on public.crm_stock_movements (organization_id, lot_id, occurred_at desc);
create index if not exists crm_stock_movements_to_equipment_idx
  on public.crm_stock_movements (organization_id, to_equipment_id)
  where to_equipment_id is not null;
create index if not exists crm_stock_movements_from_equipment_idx
  on public.crm_stock_movements (organization_id, from_equipment_id)
  where from_equipment_id is not null;

-- ---------------------------------------------------------------------------
-- What each place holds, derived. Nothing stores it.
--
-- SECURITY INVOKER: it reads the caller's own book through RLS, like every
-- other reader in this schema.
-- ---------------------------------------------------------------------------

create or replace function public.crm_stock_on_hand(p_lot uuid default null)
returns table (
  stock_lot_id uuid,
  stock_branch_id uuid,
  stock_equipment_id uuid,
  stock_quantity numeric
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with moved as (
    select m.lot_id, m.to_branch_id as branch_id, m.to_equipment_id as equipment_id,
           m.quantity as delta
      from public.crm_stock_movements m
     where (p_lot is null or m.lot_id = p_lot)
       and num_nonnulls(m.to_branch_id, m.to_equipment_id) = 1
    union all
    select m.lot_id, m.from_branch_id, m.from_equipment_id, -m.quantity
      from public.crm_stock_movements m
     where (p_lot is null or m.lot_id = p_lot)
       and num_nonnulls(m.from_branch_id, m.from_equipment_id) = 1
  )
  select lot_id, branch_id, equipment_id, sum(delta)::numeric
    from moved
   group by lot_id, branch_id, equipment_id
  -- A place that has been emptied is not a place that holds nothing worth
  -- showing; it is simply empty, and the caller filters if it wants to.
   order by 1, 2, 3;
$$;

revoke all on function public.crm_stock_on_hand(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_stock_on_hand(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording a movement.
--
-- THE LOCK IS THE WHOLE GUARANTEE. Reading a balance and then inserting
-- against it is a race two technicians drawing the last of a lot will find
-- within a week. `select ... for update` on the lot serialises every
-- movement of that lot, so the balance this function reads is the balance
-- that still holds when it writes.
--
-- SECURITY INVOKER: it writes through the caller's own policies.
-- ---------------------------------------------------------------------------

create or replace function public.crm_stock_record_movement(
  p_lot uuid,
  p_kind public.crm_stock_movement_kind,
  p_quantity numeric,
  p_from_branch uuid default null,
  p_from_equipment uuid default null,
  p_to_branch uuid default null,
  p_to_equipment uuid default null,
  p_application uuid default null,
  p_occurred_at timestamptz default now(),
  p_note text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_unit public.crm_measure_unit;
  v_available numeric;
  v_applied numeric;
  v_movement uuid;
begin
  -- The lock. Everything below reads a balance that this holds still.
  select l.organization_id, l.unit into v_org, v_unit
    from public.crm_product_lots l
   where l.id = p_lot
     for update;

  if v_org is null then
    raise exception 'no such product lot in this workspace' using errcode = 'no_data_found';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'a movement moves a positive quantity' using errcode = 'check_violation';
  end if;

  -- Normalise to the ledger's own scale BEFORE anything is compared. The
  -- column stores three decimals, so a caller's 39.9996 becomes 40.000 on
  -- insert; checking the unrounded value would mean the balance guard and
  -- the row that lands are about two different numbers. It also keeps
  -- every message in one scale — "holds 40.000 and 50 cannot be taken"
  -- reads like two kinds of quantity.
  p_quantity := round(p_quantity, 3);

  -- A consumption must agree with the application it serves, or the stock
  -- ledger and the compliance log tell two stories about one treatment.
  if p_kind = 'consumption' then
    if p_application is null then
      raise exception 'a consumption names the application it served'
        using errcode = 'check_violation';
    end if;
    select a.quantity into v_applied
      from public.crm_applications a
     where a.organization_id = v_org and a.id = p_application and a.lot_id = p_lot;
    if v_applied is null then
      raise exception 'that application is not recorded against this lot'
        using errcode = 'no_data_found';
    end if;
    if v_applied <> p_quantity then
      raise exception 'the application recorded % and this movement draws %; they must agree',
        v_applied, p_quantity using errcode = 'check_violation';
    end if;

    -- The unique index is the real guarantee; this reads it first so a
    -- replayed field sync (ADR-210) is refused in words rather than by a
    -- constraint name.
    if exists (
      select 1 from public.crm_stock_movements m
       where m.organization_id = v_org and m.application_id = p_application
    ) then
      raise exception 'that application has already drawn stock; it cannot draw twice'
        using errcode = 'unique_violation';
    end if;
  end if;

  -- Nothing may leave a place that does not hold it. Checked after the
  -- lock, against the derived balance rather than a stored one.
  if num_nonnulls(p_from_branch, p_from_equipment) = 1 then
    select coalesce(sum(s.stock_quantity), 0) into v_available
      from public.crm_stock_on_hand(p_lot) s
     where s.stock_branch_id is not distinct from p_from_branch
       and s.stock_equipment_id is not distinct from p_from_equipment;

    if v_available < p_quantity then
      raise exception 'that location holds % % of this lot; % cannot be taken from it',
        v_available, v_unit, p_quantity using errcode = 'check_violation';
    end if;
  end if;

  insert into public.crm_stock_movements
    (organization_id, lot_id, kind, quantity, from_branch_id, from_equipment_id,
     to_branch_id, to_equipment_id, application_id, note, occurred_at, recorded_by)
  values
    (v_org, p_lot, p_kind, p_quantity, p_from_branch, p_from_equipment,
     p_to_branch, p_to_equipment, p_application, p_note, p_occurred_at, auth.uid())
  returning id into v_movement;

  return v_movement;
end;
$$;

revoke all on function public.crm_stock_record_movement(
  uuid, public.crm_stock_movement_kind, numeric, uuid, uuid, uuid, uuid, uuid,
  timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.crm_stock_record_movement(
  uuid, public.crm_stock_movement_kind, numeric, uuid, uuid, uuid, uuid, uuid,
  timestamptz, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. REVOKE first: hosted default privileges grant ALL on every new
-- table, and a narrower grant on top of ALL narrows nothing.
--
-- No update and no delete. A movement is what happened to a regulated
-- product; correcting one is another movement, which is why 'adjustment'
-- exists.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_stock_movements enable row level security';
  execute 'alter table public.crm_stock_movements force row level security';
  execute 'revoke all on table public.crm_stock_movements
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_stock_movements_select_member on public.crm_stock_movements';
  execute 'create policy crm_stock_movements_select_member on public.crm_stock_movements
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_stock_movements_insert_member on public.crm_stock_movements';
  execute 'create policy crm_stock_movements_insert_member on public.crm_stock_movements
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'grant select, insert on table public.crm_stock_movements to authenticated';
end;
$$;
