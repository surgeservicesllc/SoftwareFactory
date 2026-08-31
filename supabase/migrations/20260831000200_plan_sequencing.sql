-- ---------------------------------------------------------------------------
-- Increment 19 — the calendar the customer actually agreed to (ADR-211).
--
-- A service plan has always known how OFTEN it runs. It has never known
-- WHEN. Real pest programs are sold as dates, not intervals:
--
--   * "the 1st and the 15th"            — twice-monthly, 24 visits a year
--   * "2nd and 4th Tuesday"             — twice-monthly, anchored to a route
--   * "March perimeter, June mosquito,  — a seasonal sequence where each
--      September rodent, November          visit is a DIFFERENT service
--      winterization"
--
-- `biweekly` cannot express any of them. Every fortnight is 26 visits a
-- year, not 24, and it drifts off the day of the month the customer was
-- promised — after six months a "1st and 15th" account is being visited on
-- the 9th and the 23rd. That is the difference between a schedule and a
-- cadence, and it is why this row has stood at PARTIAL.
--
-- THE MODEL: a plan may carry an ordered list of STEPS and a cycle length.
-- The steps say where in the cycle each visit falls and, optionally, what
-- service it is. `crm_plan_occurrences` walks them forward from any date.
-- A plan with no steps keeps behaving exactly as it does today.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not touch billing. The
-- recurrence still decides what period an invoice covers (ADR-200), and
-- the tests pin that a sequenced plan bills exactly as it did before its
-- steps were written. Sequencing changes when the van shows up; it does
-- not change what the customer is charged.
--
-- That separation is not a shortcut, it is the product. Level billing —
-- pay monthly, serviced quarterly — is normal in this industry, so a plan
-- whose visit count and bill count disagree is a legitimate arrangement
-- rather than an error to refuse. `crm_plan_cadence` therefore REPORTS
-- both numbers side by side instead of forbidding the mismatch, so an
-- operator can see "4 visits, 12 bills" and confirm that is what was sold.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_plan_step_anchor as enum ('day_of_month', 'nth_weekday');
exception when duplicate_object then null; end $$;

-- How long one full pass through the steps takes. Null means this plan is
-- not sequenced and follows its recurrence, which is every plan until
-- somebody writes a step.
alter table public.crm_service_plans
  add column if not exists cycle_months smallint;

-- Only divisors of 12. A cycle of, say, five months cannot be anchored to
-- the calendar without restarting every January, which would silently move
-- the customer's dates once a year — the exact drift this increment exists
-- to remove. Refusing the shape is honest; pretending to support it is not.
do $$ begin
  alter table public.crm_service_plans
    add constraint crm_service_plans_cycle_months_divides_year
    check (cycle_months is null or cycle_months in (1, 2, 3, 4, 6, 12));
exception when duplicate_object then null; end $$;

create table if not exists public.crm_plan_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,

  -- Where in the cycle this visit falls. Position orders the steps; the
  -- month offset places them, so "1st and 15th" is two steps at offset 0
  -- and a seasonal program is four steps at offsets 2, 5, 8 and 10.
  position smallint not null check (position between 1 and 24),
  month_offset smallint not null default 0 check (month_offset between 0 and 11),

  anchor public.crm_plan_step_anchor not null,

  -- Anchor 'day_of_month': the 15th. A day past the end of a short month
  -- is clamped to its last day by the generator rather than refused, so
  -- "the 31st" is a legal instruction that means "month end" in February.
  day_of_month smallint check (day_of_month between 1 and 31),

  -- Anchor 'nth_weekday': the 2nd Tuesday. Week 5 means THE LAST one,
  -- which is what a route actually means by "last Friday of the month" in
  -- a month with only four Fridays.
  week_of_month smallint check (week_of_month between 1 and 5),
  weekday smallint check (weekday between 0 and 6),

  -- Null means this visit is the plan's own service. A seasonal program
  -- overrides it per step, which is the half of "custom sequencing" that
  -- an interval could never express.
  service_type text,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_plan_steps_plan_same_org
    foreign key (organization_id, plan_id)
    references public.crm_service_plans (organization_id, id) on delete cascade,

  -- One anchor per step, completely. A row carrying both a day and a
  -- weekday would let the generator pick, and a generator that picks is a
  -- generator nobody can predict from the row.
  constraint crm_plan_steps_anchor_complete check (
    case anchor
      when 'day_of_month' then
        day_of_month is not null and week_of_month is null and weekday is null
      when 'nth_weekday' then
        day_of_month is null and week_of_month is not null and weekday is not null
    end
  ),
  constraint crm_plan_steps_service_type_shape
    check (service_type is null or char_length(btrim(service_type)) between 1 and 120),
  constraint crm_plan_steps_service_type_no_secret
    check (not public.text_has_likely_secret(service_type))
);

create unique index if not exists crm_plan_steps_org_id_key
  on public.crm_plan_steps (organization_id, id);
create unique index if not exists crm_plan_steps_plan_position_key
  on public.crm_plan_steps (organization_id, plan_id, position);
create index if not exists crm_plan_steps_plan_idx
  on public.crm_plan_steps (organization_id, plan_id, month_offset, position);

-- ---------------------------------------------------------------------------
-- A step's month offset has to fit inside its plan's cycle, and a plan that
-- carries steps has to have a cycle at all. Neither can be a CHECK — both
-- read the other table — so both doors are guarded.
--
-- Both doors matter: PostgREST is a door. Guarding only the write path in
-- the application would leave a member able to PATCH cycle_months to null
-- underneath a plan that has four steps, and the generator would then
-- silently return nothing for an account somebody is still being billed
-- for.
-- ---------------------------------------------------------------------------

create or replace function public.crm_plan_step_fits_cycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_cycle smallint;
begin
  select cycle_months into v_cycle
    from public.crm_service_plans
   where organization_id = new.organization_id and id = new.plan_id;

  if v_cycle is null then
    raise exception 'plan % has no cycle length, so it cannot carry sequenced steps', new.plan_id
      using errcode = 'check_violation';
  end if;
  if new.month_offset >= v_cycle then
    raise exception 'step month offset % falls outside a % month cycle',
      new.month_offset, v_cycle using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_plan_step_fits_cycle()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_plan_steps_fit_cycle on public.crm_plan_steps;
create trigger crm_plan_steps_fit_cycle
  before insert or update on public.crm_plan_steps
  for each row execute function public.crm_plan_step_fits_cycle();

create or replace function public.crm_plan_cycle_still_fits_steps()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_widest smallint;
  v_steps integer;
begin
  if new.cycle_months is not distinct from old.cycle_months then
    return new;
  end if;

  select count(*), max(month_offset) into v_steps, v_widest
    from public.crm_plan_steps
   where organization_id = new.organization_id and plan_id = new.id;

  if v_steps = 0 then
    return new;
  end if;
  if new.cycle_months is null then
    raise exception 'plan % carries % sequenced step(s); clear them before clearing the cycle',
      new.id, v_steps using errcode = 'check_violation';
  end if;
  if v_widest >= new.cycle_months then
    raise exception 'plan % has a step in month % , which a % month cycle does not reach',
      new.id, v_widest, new.cycle_months using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_plan_cycle_still_fits_steps()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_service_plans_cycle_fits_steps on public.crm_service_plans;
create trigger crm_service_plans_cycle_fits_steps
  before update on public.crm_service_plans
  for each row execute function public.crm_plan_cycle_still_fits_steps();

-- ---------------------------------------------------------------------------
-- One step, one month, one date. Immutable and table-free, so it can be
-- tested directly and so the planner can fold it.
--
-- Two clamps, both deliberate:
--   * day 31 in a 30-day month is the 30th, not an error. "The 31st" is
--     how an operator writes "month end".
--   * week 5 means THE LAST one. A month with four Fridays has no fifth
--     Friday, and a route that says "last Friday" means the fourth in that
--     month rather than nothing at all.
-- ---------------------------------------------------------------------------

create or replace function public.crm_plan_step_date(
  p_year integer,
  p_month integer,
  p_anchor public.crm_plan_step_anchor,
  p_day_of_month smallint,
  p_week_of_month smallint,
  p_weekday smallint
)
returns date
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_first date := make_date(p_year, p_month, 1);
  v_last date := (v_first + interval '1 month - 1 day')::date;
  v_candidate date;
begin
  if p_anchor = 'day_of_month' then
    return make_date(p_year, p_month, least(p_day_of_month, extract(day from v_last)::int));
  end if;

  if p_week_of_month = 5 then
    -- Walk back from month end to the requested weekday.
    return v_last - ((extract(dow from v_last)::int - p_weekday + 7) % 7);
  end if;

  -- Forward from the 1st to the first matching weekday, then whole weeks.
  v_candidate := v_first + ((p_weekday - extract(dow from v_first)::int + 7) % 7);
  v_candidate := v_candidate + (p_week_of_month - 1) * 7;
  -- A 5th-week request is handled above; a 4th that overflows cannot
  -- happen, but a month can still be short of a requested 5th if the enum
  -- ever widens, so fall back to the last matching weekday.
  if v_candidate > v_last then
    v_candidate := v_last - ((extract(dow from v_last)::int - p_weekday + 7) % 7);
  end if;
  return v_candidate;
end;
$$;

revoke all on function public.crm_plan_step_date(
  integer, integer, public.crm_plan_step_anchor, smallint, smallint, smallint
) from public, anon, authenticated, service_role;
grant execute on function public.crm_plan_step_date(
  integer, integer, public.crm_plan_step_anchor, smallint, smallint, smallint
) to authenticated;

-- ---------------------------------------------------------------------------
-- The generator.
--
-- Cycles are anchored to the CALENDAR, not to a stored origin date: a step
-- at month offset k lands in every month where (month - 1) % cycle = k. So
-- a four-step annual program written as offsets 2, 5, 8 and 10 is March,
-- June, September and November forever, and it stays those months whoever
-- edits the plan and whenever they do it. An origin column would drift the
-- moment somebody paused and resumed an account.
--
-- SECURITY INVOKER, like every other reader in this schema (ADR-199): it
-- reads the caller's own book through RLS and can reach nothing they could
-- not already select.
-- ---------------------------------------------------------------------------

create or replace function public.crm_plan_occurrences(
  p_plan uuid,
  p_from date,
  p_count integer default 12
)
returns table (
  step_position smallint,
  occurs_on date,
  service_type text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with plan as (
    select p.id, p.organization_id, p.cycle_months, p.service_type
      from public.crm_service_plans p
     where p.id = p_plan
  ),
  -- Enough months to satisfy any request: one full cycle per asked-for
  -- occurrence, plus a year of slack for a request landing mid-cycle.
  months as (
    select (date_trunc('month', p_from)::date
            + (n || ' months')::interval)::date as month_start
      from plan,
           generate_series(
             0,
             least(greatest(p_count, 1), 240) * coalesce(plan.cycle_months, 1) + 12
           ) as n
  )
  select s.position,
         public.crm_plan_step_date(
           extract(year from m.month_start)::int,
           extract(month from m.month_start)::int,
           s.anchor, s.day_of_month, s.week_of_month, s.weekday
         ) as occurs_on,
         coalesce(s.service_type, plan.service_type) as service_type
    from plan
    join months m on true
    join public.crm_plan_steps s
      on s.organization_id = plan.organization_id
     and s.plan_id = plan.id
     and (extract(month from m.month_start)::int - 1) % plan.cycle_months = s.month_offset
   where public.crm_plan_step_date(
           extract(year from m.month_start)::int,
           extract(month from m.month_start)::int,
           s.anchor, s.day_of_month, s.week_of_month, s.weekday
         ) >= p_from
   order by 2, 1
   limit least(greatest(p_count, 1), 240);
$$;

revoke all on function public.crm_plan_occurrences(uuid, date, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_plan_occurrences(uuid, date, integer)
  to authenticated;

-- The single date the dispatch path needs: the first visit strictly after
-- the one just generated. Null for an unsequenced plan, which is the
-- signal the caller uses to fall back to the recurrence interval.
create or replace function public.crm_plan_next_occurrence(
  p_plan uuid,
  p_after date
)
returns date
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select occurs_on
    from public.crm_plan_occurrences(p_plan, (p_after + 1)::date, 1)
   limit 1;
$$;

revoke all on function public.crm_plan_next_occurrence(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_plan_next_occurrence(uuid, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Visits and bills, side by side, because they are allowed to disagree.
--
-- Level billing — pay every month, serviced every quarter — is a normal
-- pest-control arrangement, so a plan with 4 visits and 12 bills is a sale
-- rather than a fault. Refusing it would be wrong; hiding it would be
-- worse. This states both numbers so an operator confirms the one they
-- meant, and so nobody has to infer visit count from a cadence word that
-- no longer decides it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_plan_cadence(p_plan uuid)
returns table (
  sequenced boolean,
  visits_per_year numeric,
  bills_per_year numeric
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    p.cycle_months is not null and count(s.id) > 0,
    case
      when p.cycle_months is null or count(s.id) = 0 then null
      else count(s.id)::numeric * (12::numeric / p.cycle_months)
    end,
    -- Whole visits a year, as the industry quotes them: 52 weeks, 26
    -- fortnights. Not 365.25/7, which would put a fraction of a visit on
    -- an invoice nobody ever sends.
    case p.recurrence
      when 'weekly' then 52
      when 'biweekly' then 26
      when 'monthly' then 12
      when 'bimonthly' then 6
      when 'quarterly' then 4
      when 'semiannual' then 2
      when 'annual' then 1
    end::numeric
    from public.crm_service_plans p
    left join public.crm_plan_steps s
      on s.organization_id = p.organization_id and s.plan_id = p.id
   where p.id = p_plan
   group by p.id, p.cycle_months, p.recurrence;
$$;

revoke all on function public.crm_plan_cadence(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_plan_cadence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Steps are as readable and as writable as the plan they belong to,
-- and no more. REVOKE first: hosted default privileges grant ALL on every
-- new table, and a narrower grant on top of ALL narrows nothing.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_plan_steps enable row level security';
  execute 'alter table public.crm_plan_steps force row level security';
  execute 'revoke all on table public.crm_plan_steps
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_plan_steps_select_member on public.crm_plan_steps';
  execute 'create policy crm_plan_steps_select_member on public.crm_plan_steps
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_plan_steps_write_member on public.crm_plan_steps';
  execute 'create policy crm_plan_steps_write_member on public.crm_plan_steps
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_plan_steps_update_member on public.crm_plan_steps';
  execute 'create policy crm_plan_steps_update_member on public.crm_plan_steps
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';

  -- A schedule is edited, including by removing a visit from it. Unlike
  -- the ledgers in this schema a step is not evidence of anything that
  -- happened, so it may be deleted.
  execute 'drop policy if exists crm_plan_steps_delete_member on public.crm_plan_steps';
  execute 'create policy crm_plan_steps_delete_member on public.crm_plan_steps
             for delete to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'grant select, insert, update, delete on table public.crm_plan_steps to authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting a whole sequence at once.
--
-- A schedule is edited as a SET, not a row at a time, and the two triggers
-- above make the row-at-a-time path genuinely awkward: moving an annual
-- program to a monthly one means clearing four steps before the cycle can
-- shrink, and any order a client picks leaves a window where the plan is
-- inconsistent. Worse, a client that crashed halfway would leave an
-- account with a cycle and no steps — a plan that generates no visits and
-- says nothing about it.
--
-- So the replacement is one statement: delete, re-cycle, re-insert. It
-- either takes or it does not.
--
-- SECURITY INVOKER: it writes through the caller's own policies. A definer
-- here would let a member edit a schedule in a book they cannot read.
-- ---------------------------------------------------------------------------

create or replace function public.crm_plan_set_sequence(
  p_plan uuid,
  p_cycle_months smallint,
  p_steps jsonb default '[]'::jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_written integer;
begin
  select organization_id into v_org
    from public.crm_service_plans
   where id = p_plan;

  if v_org is null then
    raise exception 'no such service plan in this workspace'
      using errcode = 'no_data_found';
  end if;

  if jsonb_typeof(p_steps) <> 'array' then
    raise exception 'the steps must be an array' using errcode = 'invalid_parameter_value';
  end if;

  if p_cycle_months is null and jsonb_array_length(p_steps) > 0 then
    raise exception 'a sequence needs a cycle length' using errcode = 'check_violation';
  end if;

  -- Order matters and is the reason this is one function: the old steps
  -- have to go before the cycle can change, or the plan trigger refuses a
  -- cycle that does not reach a step which is about to be deleted anyway.
  delete from public.crm_plan_steps
   where organization_id = v_org and plan_id = p_plan;

  update public.crm_service_plans
     set cycle_months = p_cycle_months, updated_at = now()
   where organization_id = v_org and id = p_plan;

  insert into public.crm_plan_steps
    (organization_id, plan_id, position, month_offset, anchor,
     day_of_month, week_of_month, weekday, service_type, created_by)
  select v_org, p_plan, s.position, s.month_offset, s.anchor,
         s.day_of_month, s.week_of_month, s.weekday,
         nullif(btrim(coalesce(s.service_type, '')), ''),
         auth.uid()
    from jsonb_to_recordset(p_steps) as s(
      position smallint,
      month_offset smallint,
      anchor public.crm_plan_step_anchor,
      day_of_month smallint,
      week_of_month smallint,
      weekday smallint,
      service_type text
    );

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.crm_plan_set_sequence(uuid, smallint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_plan_set_sequence(uuid, smallint, jsonb)
  to authenticated;
