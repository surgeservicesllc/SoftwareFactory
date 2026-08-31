-- ---------------------------------------------------------------------------
-- Increment 25 — the day route (ADR-220).
--
-- "Route optimization / visual route manager / dynamic planner" has been a
-- GAP against four competitors, and I have now been wrong about it in both
-- directions. First I called it "not provider-gated" without checking that
-- `crm_properties` holds an address and NO COORDINATES — turning an address
-- into a point is geocoding, and that needs a provider. Then, correcting
-- that, I let the whole row sit behind it.
--
-- Geocoding gates OPTIMISATION. It does not gate the ROUTE MANAGER, and
-- that is most of what a dispatcher actually uses.
--
-- WHY THIS IS NOT "SORT BY SCHEDULED TIME". The appointment times say when
-- a customer was promised a visit. The SEQUENCE says the order a technician
-- drives them, and the two differ constantly for reasons no algorithm here
-- can know: a commercial kitchen has to be done before it opens, a gated
-- yard is locked until ten, a difficult call goes last so it cannot
-- overrun into anybody else's window. Those are the dispatcher's
-- judgements, and until now this schema had nowhere to record them —
-- crm_work_orders carries a technician and a start time and nothing else.
--
-- THE ORDER IS THE DISPATCHER'S, and this file computes none of it. That is
-- the honest boundary: what a person decides is stored faithfully, and what
-- would need a mapping provider — drive time, traffic, time windows,
-- geocoding a whole book of addresses — is not pretended at.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_route_status as enum (
    -- Being built by a dispatcher; stops may still move.
    'planned',
    -- Handed to the technician. The order they are driving.
    'released',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  technician_id uuid not null,
  -- Where the day starts. A route without a starting point cannot be
  -- sequenced by anybody, human or otherwise.
  branch_id uuid not null,
  route_date date not null,

  status public.crm_route_status not null default 'planned',
  name text check (name is null or char_length(btrim(name)) between 1 and 120),
  note text check (note is null or char_length(btrim(note)) between 1 and 500),

  released_at timestamptz,
  completed_at timestamptz,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_routes_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete cascade,
  constraint crm_routes_branch_same_org
    foreign key (organization_id, branch_id)
    references public.crm_branches (organization_id, id) on delete restrict,

  -- Each terminal moment belongs to its status and nowhere else.
  constraint crm_routes_released_evidence
    check ((released_at is not null) = (status in ('released', 'completed'))),
  constraint crm_routes_completed_evidence
    check ((completed_at is not null) = (status = 'completed')),
  constraint crm_routes_completed_after_released
    check (completed_at is null or released_at is null or completed_at >= released_at),

  constraint crm_routes_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_routes_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_routes_org_id_key
  on public.crm_routes (organization_id, id);

-- One live route per technician per day. Two would mean a technician
-- holding two different orders for the same morning, which is not a
-- scheduling nuance — it is a person driving to the wrong place.
create unique index if not exists crm_routes_one_per_technician_day_key
  on public.crm_routes (organization_id, technician_id, route_date)
  where status <> 'cancelled';
create index if not exists crm_routes_org_date_idx
  on public.crm_routes (organization_id, route_date, technician_id);

-- ---------------------------------------------------------------------------
-- The stops, in the order they are driven.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_route_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid not null,
  work_order_id uuid not null,

  -- Contiguous from 1. The technician reads "stop 3 of 9", and a gap in
  -- the numbering is a stop somebody deleted without renumbering.
  position integer not null check (position >= 1),

  -- What the dispatcher expects, which is not a promise to the customer —
  -- that lives on the work order's own window.
  planned_arrival timestamptz,
  note text check (note is null or char_length(btrim(note)) between 1 and 300),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint crm_route_stops_route_same_org
    foreign key (organization_id, route_id)
    references public.crm_routes (organization_id, id) on delete cascade,
  constraint crm_route_stops_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete cascade,
  constraint crm_route_stops_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_route_stops_org_id_key
  on public.crm_route_stops (organization_id, id);
-- No two stops share a position on one route.
create unique index if not exists crm_route_stops_route_position_key
  on public.crm_route_stops (organization_id, route_id, position);
-- A visit is driven to once. Being on two routes is the same failure as two
-- routes for one technician, seen from the other side.
create unique index if not exists crm_route_stops_work_order_key
  on public.crm_route_stops (organization_id, work_order_id);

-- ---------------------------------------------------------------------------
-- A stop must be for the route's own day, and its technician.
--
-- Cross-table, so a trigger rather than a check: PostgREST is a door, and a
-- rule that only the sequencing function enforces is a rule a direct insert
-- walks past.
-- ---------------------------------------------------------------------------

create or replace function public.crm_route_stop_belongs()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_route_date date;
  v_route_technician uuid;
  v_visit_day date;
  v_visit_technician uuid;
begin
  select r.route_date, r.technician_id into v_route_date, v_route_technician
    from public.crm_routes r
   where r.organization_id = new.organization_id and r.id = new.route_id;
  if v_route_date is null then
    raise exception 'no such route' using errcode = 'foreign_key_violation';
  end if;

  select (w.scheduled_start at time zone 'UTC')::date, w.technician_id
    into v_visit_day, v_visit_technician
    from public.crm_work_orders w
   where w.organization_id = new.organization_id and w.id = new.work_order_id;
  if v_visit_day is null then
    raise exception 'no such work order' using errcode = 'foreign_key_violation';
  end if;

  if v_visit_day <> v_route_date then
    raise exception
      'that visit is scheduled for % and this route is for %; a stop on the wrong day sends somebody to the wrong place',
      v_visit_day, v_route_date
      using errcode = 'check_violation';
  end if;

  -- Unassigned is fine — putting it on the route IS the assignment, and the
  -- sequencing function makes it. Assigned to somebody ELSE is not.
  if v_visit_technician is not null and v_visit_technician <> v_route_technician then
    raise exception 'that visit belongs to another technician; reassign it before routing it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.crm_route_stop_belongs()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_route_stops_belong on public.crm_route_stops;
create trigger crm_route_stops_belong
  before insert or update on public.crm_route_stops
  for each row execute function public.crm_route_stop_belongs();

-- ---------------------------------------------------------------------------
-- Setting the order.
--
-- REPLACES THE WHOLE SEQUENCE, and does it as a delete followed by an
-- insert rather than by renumbering in place. Moving stop 3 to position 1
-- by updating rows one at a time collides with the unique index the moment
-- two rows briefly hold the same number — the same trap
-- crm_plan_set_sequence hit, for the same reason. Replacing the set never
-- has two rows claiming a position.
--
-- What a dispatcher already typed is preserved across the reorder: a
-- planned arrival and a note follow their work order to its new position,
-- because losing them on every drag would make the feature unusable.
-- ---------------------------------------------------------------------------

create or replace function public.crm_route_set_order(
  p_route uuid,
  p_work_orders uuid[]
)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_status public.crm_route_status;
  v_technician uuid;
  v_count integer;
begin
  select r.organization_id, r.status, r.technician_id
    into v_org, v_status, v_technician
    from public.crm_routes r where r.id = p_route;
  if v_org is null then
    raise exception 'no such route' using errcode = 'no_data_found';
  end if;
  if v_status in ('completed', 'cancelled') then
    raise exception 'a % route cannot be resequenced', v_status
      using errcode = 'check_violation';
  end if;

  if array_length(p_work_orders, 1) is null then
    delete from public.crm_route_stops
     where organization_id = v_org and route_id = p_route;
    return 0;
  end if;

  -- The same visit twice would silently drop one of them.
  if (select count(*) from unnest(p_work_orders) as w(id))
     <> (select count(distinct w.id) from unnest(p_work_orders) as w(id)) then
    raise exception 'the same visit appears twice in this order'
      using errcode = 'check_violation';
  end if;

  -- Putting a visit on a route IS assigning it, which is what a dispatcher
  -- is doing. Only ever fills a blank; the trigger refuses somebody else's.
  update public.crm_work_orders
     set technician_id = v_technician
   where organization_id = v_org
     and id = any(p_work_orders)
     and technician_id is null;

  -- Carry the dispatcher's own annotations across the reorder.
  create temporary table crm_route_carry on commit drop as
    select work_order_id, planned_arrival, note
      from public.crm_route_stops
     where organization_id = v_org and route_id = p_route;

  delete from public.crm_route_stops
   where organization_id = v_org and route_id = p_route;

  insert into public.crm_route_stops
    (organization_id, route_id, work_order_id, position, planned_arrival, note, created_by)
  select v_org, p_route, ordered.id, ordered.position,
         carry.planned_arrival, carry.note, auth.uid()
    from unnest(p_work_orders) with ordinality as ordered(id, position)
    left join crm_route_carry carry on carry.work_order_id = ordered.id;

  get diagnostics v_count = row_count;
  drop table if exists crm_route_carry;
  return v_count;
end;
$$;

revoke all on function public.crm_route_set_order(uuid, uuid[])
  from public, anon, service_role;
grant execute on function public.crm_route_set_order(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The sheet a technician actually reads: the stops in order, with enough
-- about each to arrive at the right door.
-- ---------------------------------------------------------------------------

create or replace function public.crm_route_sheet(p_route uuid)
returns table (
  -- Prefixed: an OUT parameter named `position` or `note` would shadow the
  -- table column of that name throughout this body.
  stop_position integer,
  stop_work_order uuid,
  stop_customer text,
  stop_property text,
  stop_address text,
  stop_service text,
  stop_window_start timestamptz,
  stop_planned_arrival timestamptz,
  stop_status public.crm_work_order_status,
  stop_note text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select s.position, s.work_order_id, a.name, p.label, p.address,
         w.service_type, w.scheduled_start, s.planned_arrival, w.status, s.note
    from public.crm_route_stops s
    join public.crm_work_orders w
      on w.organization_id = s.organization_id and w.id = s.work_order_id
    join public.crm_accounts a
      on a.organization_id = w.organization_id and a.id = w.account_id
    join public.crm_properties p
      on p.organization_id = w.organization_id and p.id = w.property_id
   where s.route_id = p_route
   -- Positional: column 1 is the sequence, and `stop_position` above names
   -- an OUT parameter rather than a column.
   order by 1;
$$;

revoke all on function public.crm_route_sheet(uuid) from public, anon, service_role;
grant execute on function public.crm_route_sheet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. REVOKE first: hosted default privileges grant ALL on
-- every new table.
--
-- Unlike the notice and charge ledgers, nothing here is protected by the
-- ABSENCE of a grant — a route is working state a dispatcher edits all day.
-- What holds it together is the triggers and the unique indexes, which a
-- direct write cannot walk past either.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_routes enable row level security';
  execute 'alter table public.crm_routes force row level security';
  execute 'revoke all on table public.crm_routes
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_routes_select_member on public.crm_routes';
  execute 'create policy crm_routes_select_member on public.crm_routes
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_routes_insert_member on public.crm_routes';
  execute 'create policy crm_routes_insert_member on public.crm_routes
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_routes_update_member on public.crm_routes';
  execute 'create policy crm_routes_update_member on public.crm_routes
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  -- No delete: a route that ran is a record of where somebody was sent.
  -- Cancelling is a status.
  execute 'grant select, insert, update on table public.crm_routes to authenticated';

  execute 'alter table public.crm_route_stops enable row level security';
  execute 'alter table public.crm_route_stops force row level security';
  execute 'revoke all on table public.crm_route_stops
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_route_stops_select_member on public.crm_route_stops';
  execute 'create policy crm_route_stops_select_member on public.crm_route_stops
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_route_stops_insert_member on public.crm_route_stops';
  execute 'create policy crm_route_stops_insert_member on public.crm_route_stops
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_route_stops_update_member on public.crm_route_stops';
  execute 'create policy crm_route_stops_update_member on public.crm_route_stops
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_route_stops_delete_member on public.crm_route_stops';
  execute 'create policy crm_route_stops_delete_member on public.crm_route_stops
             for delete to authenticated using (public.is_organization_member(organization_id))';
  -- Delete is granted because resequencing replaces the set; the stops are
  -- working state, not evidence.
  execute 'grant select, insert, update, delete on table public.crm_route_stops to authenticated';
end;
$$;
