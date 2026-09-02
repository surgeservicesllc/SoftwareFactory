-- ---------------------------------------------------------------------------
-- Increment 35 — the schedule bends (ADR-239).
--
-- PestBoss generates plans in bulk but cannot edit visits in bulk, and has
-- no notion of a job that takes a crew several days. Both leave a
-- dispatcher doing arithmetic by hand: "move Rosa's Tuesday to Wednesday,
-- all nine of them" and "the plant fumigation is Monday to Thursday".
--
-- This file adds:
--
--   crm_work_orders_bulk_edit()   one call, many visits, ONE OUTCOME PER
--                                 ROW: applied, or refused with the reason
--                                 in words. A completed visit is not
--                                 changed; a visit on a route is not moved
--                                 to another day or technician until it is
--                                 taken off the route (the route names
--                                 itself in the refusal); "completed" is
--                                 never set in bulk. The rest of the batch
--                                 goes through.
--   crm_projects                  a job across days: one account, one site,
--                                 a service, a technician, a first and last
--                                 day (at most 31), a daily window
--   crm_project_create()          the project and ONE VISIT PER DAY, each a
--                                 real work order that routes, completes and
--                                 bills like any other
--   crm_project_progress()        every project with its days counted from
--                                 its visits — total, completed, cancelled,
--                                 the next day — nothing stored
--   crm_project_cancel()          cancels the visits not yet completed; the
--                                 outcome trigger records each one
--
-- A project's visits carry project_id, so the day board can say "day 2 of
-- 4" beside a visit and a route can still take that day's visit alone.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_project_status as enum ('planned', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  technician_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  service_type text not null check (char_length(btrim(service_type)) between 1 and 120),
  starts_on date not null,
  ends_on date not null,
  daily_start time not null,
  daily_end time not null,
  include_weekends boolean not null default false,
  status public.crm_project_status not null default 'planned',
  note text check (note is null or char_length(btrim(note)) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_projects_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  constraint crm_projects_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete set null,
  constraint crm_projects_span check (ends_on >= starts_on and ends_on - starts_on <= 30),
  constraint crm_projects_window check (daily_end > daily_start),
  constraint crm_projects_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_projects_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_projects_org_id_key
  on public.crm_projects (organization_id, id);
create index if not exists crm_projects_org_starts_idx
  on public.crm_projects (organization_id, starts_on desc);

alter table public.crm_projects enable row level security;
alter table public.crm_projects force row level security;

drop policy if exists crm_projects_select_member on public.crm_projects;
create policy crm_projects_select_member on public.crm_projects
  for select to authenticated using (public.is_organization_member(organization_id));
drop policy if exists crm_projects_insert_member on public.crm_projects;
create policy crm_projects_insert_member on public.crm_projects
  for insert to authenticated with check (public.is_organization_member(organization_id));
drop policy if exists crm_projects_update_member on public.crm_projects;
create policy crm_projects_update_member on public.crm_projects
  for update to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
drop policy if exists crm_projects_delete_member on public.crm_projects;
create policy crm_projects_delete_member on public.crm_projects
  for delete to authenticated using (public.is_organization_member(organization_id));

revoke all on public.crm_projects from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.crm_projects to authenticated;

drop trigger if exists crm_projects_set_updated_at on public.crm_projects;
create trigger crm_projects_set_updated_at
  before update on public.crm_projects
  for each row execute function public.set_updated_at();

alter table public.crm_work_orders
  add column if not exists project_id uuid;

alter table public.crm_work_orders drop constraint if exists crm_work_orders_project_same_org;
alter table public.crm_work_orders add constraint crm_work_orders_project_same_org
  foreign key (organization_id, project_id)
  references public.crm_projects (organization_id, id) on delete set null;

create index if not exists crm_work_orders_project_idx
  on public.crm_work_orders (organization_id, project_id)
  where project_id is not null;

-- The project and one visit per day. Runs as the caller: RLS on both tables
-- decides, and the visit's own constraints (site on the account, technician
-- in the workspace, window in order) hold as they do for any other visit.
create or replace function public.crm_project_create(
  p_organization uuid,
  p_account uuid,
  p_property uuid,
  p_name text,
  p_service_type text,
  p_technician uuid,
  p_starts_on date,
  p_ends_on date,
  p_daily_start time,
  p_daily_end time,
  p_include_weekends boolean default false,
  p_note text default null
)
returns table (project_id uuid, visits integer)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_project uuid;
  v_day date;
  v_count integer := 0;
begin
  insert into public.crm_projects
    (organization_id, account_id, property_id, technician_id, name, service_type,
     starts_on, ends_on, daily_start, daily_end, include_weekends, note, created_by)
  values
    (p_organization, p_account, p_property, p_technician, btrim(p_name), btrim(p_service_type),
     p_starts_on, p_ends_on, p_daily_start, p_daily_end, coalesce(p_include_weekends, false),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_project;

  v_day := p_starts_on;
  while v_day <= p_ends_on loop
    if coalesce(p_include_weekends, false) or extract(isodow from v_day) < 6 then
      insert into public.crm_work_orders
        (organization_id, account_id, property_id, technician_id, project_id, service_type,
         scheduled_start, scheduled_end, status, created_by)
      values
        (p_organization, p_account, p_property, p_technician, v_project, btrim(p_service_type),
         (v_day::timestamp + p_daily_start) at time zone 'UTC',
         (v_day::timestamp + p_daily_end) at time zone 'UTC',
         'scheduled', auth.uid());
      v_count := v_count + 1;
    end if;
    v_day := v_day + 1;
  end loop;

  if v_count = 0 then
    raise exception 'that span has no working day in it; include weekends or widen the dates'
      using errcode = 'check_violation';
  end if;

  return query select v_project, v_count;
end;
$$;

revoke all on function public.crm_project_create(uuid, uuid, uuid, text, text, uuid, date, date, time, time, boolean, text)
  from public, anon, service_role;
grant execute on function public.crm_project_create(uuid, uuid, uuid, text, text, uuid, date, date, time, time, boolean, text)
  to authenticated;

-- Every project with its days counted from its visits, live.
create or replace function public.crm_project_progress(p_organization uuid)
returns table (
  project_id uuid,
  name text,
  account_id uuid,
  account_name text,
  property_id uuid,
  property_label text,
  technician_id uuid,
  technician_name text,
  service_type text,
  starts_on date,
  ends_on date,
  status public.crm_project_status,
  note text,
  days integer,
  completed integer,
  cancelled integer,
  remaining integer,
  next_day date,
  -- 'cancelled', 'done' (nothing remains), 'active' (something done, something left), 'planned'
  state text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with visits as (
    select w.project_id,
           count(*)::integer as days,
           count(*) filter (where w.status = 'completed')::integer as completed,
           count(*) filter (where w.status = 'cancelled')::integer as cancelled,
           min(w.scheduled_start) filter (where w.status not in ('completed', 'cancelled')) as next_start
      from public.crm_work_orders w
     where w.organization_id = p_organization and w.project_id is not null
     group by w.project_id
  )
  select p.id, p.name, p.account_id, a.name, p.property_id, s.label,
         p.technician_id,
         case when t.id is null then null else t.first_name || coalesce(' ' || t.last_name, '') end,
         p.service_type, p.starts_on, p.ends_on, p.status, p.note,
         coalesce(v.days, 0), coalesce(v.completed, 0), coalesce(v.cancelled, 0),
         coalesce(v.days, 0) - coalesce(v.completed, 0) - coalesce(v.cancelled, 0),
         (v.next_start at time zone 'UTC')::date,
         case
           when p.status = 'cancelled' then 'cancelled'
           when coalesce(v.days, 0) - coalesce(v.completed, 0) - coalesce(v.cancelled, 0) = 0 then 'done'
           when coalesce(v.completed, 0) > 0 then 'active'
           else 'planned'
         end
    from public.crm_projects p
    join public.crm_accounts a on a.id = p.account_id
    left join public.crm_properties s on s.id = p.property_id
    left join public.crm_technicians t on t.id = p.technician_id
    left join visits v on v.project_id = p.id
   where p.organization_id = p_organization
   order by p.starts_on desc, p.name;
$$;

revoke all on function public.crm_project_progress(uuid) from public, anon, service_role;
grant execute on function public.crm_project_progress(uuid) to authenticated;

-- Cancels the project and every visit of it not yet completed; the outcome
-- trigger records each cancellation on the account's timeline.
create or replace function public.crm_project_cancel(p_organization uuid, p_project uuid)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  update public.crm_projects set status = 'cancelled'
   where organization_id = p_organization and id = p_project and status <> 'cancelled';
  if not found then
    raise exception 'no such project, or it is already cancelled' using errcode = 'no_data_found';
  end if;
  update public.crm_work_orders set status = 'cancelled'
   where organization_id = p_organization and project_id = p_project
     and status not in ('completed', 'cancelled');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.crm_project_cancel(uuid, uuid) from public, anon, service_role;
grant execute on function public.crm_project_cancel(uuid, uuid) to authenticated;

-- One call, many visits, one outcome per row.
create or replace function public.crm_work_orders_bulk_edit(
  p_organization uuid,
  p_ids uuid[],
  p_set_technician boolean default false,
  p_technician uuid default null,
  p_shift_days integer default 0,
  p_status public.crm_work_order_status default null
)
returns table (work_order_id uuid, applied boolean, reason text, technician_id uuid, scheduled_start timestamptz, status public.crm_work_order_status)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_row public.crm_work_orders;
  v_route record;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 200 then
    raise exception 'pick between one and two hundred visits' using errcode = 'check_violation';
  end if;
  if not coalesce(p_set_technician, false) and coalesce(p_shift_days, 0) = 0 and p_status is null then
    raise exception 'nothing to change' using errcode = 'check_violation';
  end if;
  if p_status = 'completed' then
    raise exception 'a visit is completed one at a time, with its notes' using errcode = 'check_violation';
  end if;
  if abs(coalesce(p_shift_days, 0)) > 365 then
    raise exception 'a shift is at most a year' using errcode = 'check_violation';
  end if;

  foreach v_id in array p_ids loop
    begin
      select w.* into v_row from public.crm_work_orders w
       where w.organization_id = p_organization and w.id = v_id;
      if not found then
        work_order_id := v_id; applied := false; reason := 'not found in this workspace';
        technician_id := null; scheduled_start := null; status := null;
        return next;
        continue;
      end if;
      if v_row.status = 'completed' then
        work_order_id := v_id; applied := false; reason := 'completed; not changed';
        technician_id := v_row.technician_id; scheduled_start := v_row.scheduled_start; status := v_row.status;
        return next;
        continue;
      end if;
      if (coalesce(p_shift_days, 0) <> 0 or (coalesce(p_set_technician, false) and p_technician is distinct from v_row.technician_id)) then
        select r.name, r.route_date into v_route
          from public.crm_route_stops st join public.crm_routes r on r.id = st.route_id
         where st.organization_id = p_organization and st.work_order_id = v_id
         limit 1;
        if found then
          work_order_id := v_id; applied := false;
          reason := format('on route "%s" for %s; take it off the route first', coalesce(v_route.name, 'unnamed'), v_route.route_date);
          technician_id := v_row.technician_id; scheduled_start := v_row.scheduled_start; status := v_row.status;
          return next;
          continue;
        end if;
      end if;

      update public.crm_work_orders w
         set technician_id = case when coalesce(p_set_technician, false) then p_technician else w.technician_id end,
             scheduled_start = w.scheduled_start + make_interval(days => coalesce(p_shift_days, 0)),
             scheduled_end = w.scheduled_end + make_interval(days => coalesce(p_shift_days, 0)),
             status = coalesce(p_status, w.status)
       where w.organization_id = p_organization and w.id = v_id
       returning w.technician_id, w.scheduled_start, w.status into technician_id, scheduled_start, status;
      work_order_id := v_id; applied := true; reason := null;
      return next;
    exception when others then
      work_order_id := v_id; applied := false; reason := sqlerrm;
      technician_id := v_row.technician_id; scheduled_start := v_row.scheduled_start; status := v_row.status;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.crm_work_orders_bulk_edit(uuid, uuid[], boolean, uuid, integer, public.crm_work_order_status)
  from public, anon, service_role;
grant execute on function public.crm_work_orders_bulk_edit(uuid, uuid[], boolean, uuid, integer, public.crm_work_order_status)
  to authenticated;
