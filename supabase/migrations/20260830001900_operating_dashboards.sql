-- Services CRM increment 11: the operating dashboards (task #65, owner
-- /goal — ADR-199). PestPac, FieldRoutes and Briostack all lead with a
-- revenue and productivity view; the competitor matrix marks it the
-- largest remaining gap after the portal.
--
-- EVERY FUNCTION HERE IS SECURITY INVOKER — deliberately, and it is the
-- whole security argument for the file. These read across a book of
-- business, and a definer would be a definer over every tenant's rows at
-- once. Running as the caller means Row Level Security is evaluated
-- normally, so a dashboard can only ever aggregate rows its reader could
-- already have listed one at a time. There is no new visibility in this
-- migration; there is only arithmetic over visibility that already
-- existed.
--
-- They are also the reason the aggregation is in SQL rather than in a
-- route. A route that fetches five thousand rows and tallies them in
-- JavaScript reports a number that is right only while the book is small,
-- and silently wrong afterwards. The corpus is already 44,837 rows. A
-- dashboard built on a truncated fetch is a dashboard that lies.
--
-- Two reporting rules are enforced here rather than left to the caller:
--
--   1. A RATE OVER NOTHING IS NULL. Collection rate with nothing invoiced,
--      completion rate with nothing scheduled, average duration with no
--      finished visit — all null, never zero. Zero is a measurement; null
--      is the absence of one, and a dashboard that renders "0%" for "we
--      did not bill anybody" is telling the reader something false.
--   2. A RUNNING SHIFT HAS NO WORKED TOTAL. Open timesheets are excluded
--      from labour minutes rather than counted as elapsed-so-far, on the
--      same reasoning the forms surface uses (ADR-197).

-- ---------------------------------------------------------------------------
-- Revenue: what was billed, what came in, and what is still owed.
--
-- Invoiced and collected are deliberately NOT the same series. An invoice
-- is billed in the month it was issued; a payment lands in the month it
-- was received, which is frequently a different one. Reporting them as a
-- single line would hide exactly the lag a collections desk exists to
-- watch.
-- ---------------------------------------------------------------------------

create or replace function public.crm_revenue_by_month(p_months integer default 12)
returns table (
  month date,
  invoiced_cents bigint,
  collected_cents bigint,
  refunded_cents bigint,
  invoice_count integer,
  -- Null when nothing was invoiced that month: see rule 1.
  collection_rate_bps integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with months as (
    select generate_series(
      date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1),
      date_trunc('month', current_date),
      interval '1 month'
    )::date as month
  ),
  billed as (
    select date_trunc('month', i.issued_on)::date as month,
           sum(i.total_cents)::bigint as invoiced_cents,
           count(*)::integer as invoice_count
      from public.crm_invoices i
     -- A draft was never issued to anybody, so it was never revenue.
     where i.status <> 'draft' and i.issued_on is not null
     group by 1
  ),
  received as (
    select date_trunc('month', p.received_at)::date as month,
           sum(p.amount_cents)::bigint as collected_cents
      from public.crm_payments p
     group by 1
  ),
  returned as (
    select date_trunc('month', r.refunded_at)::date as month,
           sum(r.amount_cents)::bigint as refunded_cents
      from public.crm_refunds r
     group by 1
  )
  select m.month,
         coalesce(b.invoiced_cents, 0)::bigint,
         coalesce(c.collected_cents, 0)::bigint,
         coalesce(d.refunded_cents, 0)::bigint,
         coalesce(b.invoice_count, 0)::integer,
         case
           when coalesce(b.invoiced_cents, 0) = 0 then null
           else round(
             (coalesce(c.collected_cents, 0) - coalesce(d.refunded_cents, 0))::numeric
             * 10000 / b.invoiced_cents
           )::integer
         end
    from months m
    left join billed b on b.month = m.month
    left join received c on c.month = m.month
    left join returned d on d.month = m.month
   order by m.month;
$$;

-- ---------------------------------------------------------------------------
-- Accounts receivable, by age. The buckets a collections desk actually
-- works, and the one number that is usually missing from them: how much is
-- open but not yet due, which is not a problem and should not be counted
-- as one.
-- ---------------------------------------------------------------------------

create or replace function public.crm_receivable_aging()
returns table (
  bucket text,
  invoice_count integer,
  balance_cents bigint
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with open_invoices as (
    select i.id,
           greatest(i.total_cents - i.paid_cents, 0)::bigint as balance_cents,
           case
             when i.due_on is null then 'undated'
             when i.due_on >= current_date then 'current'
             when current_date - i.due_on <= 30 then '1-30'
             when current_date - i.due_on <= 60 then '31-60'
             when current_date - i.due_on <= 90 then '61-90'
             else '90+'
           end as bucket
      from public.crm_invoices i
     where i.status = 'open' and i.total_cents > i.paid_cents
  ),
  buckets as (
    -- Named rather than derived, so an empty bucket still reports itself.
    -- A missing row reads as "no data"; a zero reads as "nothing overdue",
    -- and those are different answers.
    select unnest(array['current', '1-30', '31-60', '61-90', '90+', 'undated']) as bucket
  )
  select b.bucket,
         coalesce(count(o.id), 0)::integer,
         coalesce(sum(o.balance_cents), 0)::bigint
    from buckets b
    left join open_invoices o on o.bucket = b.bucket
   group by b.bucket
   order by array_position(
     array['current', '1-30', '31-60', '61-90', '90+', 'undated'], b.bucket);
$$;

-- ---------------------------------------------------------------------------
-- Retention. The denominator is the whole book, and the uncomfortable
-- halves are reported beside the comfortable ones: accounts that went
-- inactive, contracts that ended without a successor, and customers with
-- no active service plan at all.
-- ---------------------------------------------------------------------------

create or replace function public.crm_retention_summary()
returns table (
  customers integer,
  inactive integer,
  prospects integer,
  customers_without_plan integer,
  contracts_active integer,
  contracts_ended integer,
  -- Null when there is no book to retain: rule 1 again.
  retention_bps integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with book as (
    select
      count(*) filter (where a.status = 'customer')::integer as customers,
      count(*) filter (where a.status = 'inactive')::integer as inactive,
      count(*) filter (where a.status = 'prospect')::integer as prospects
      from public.crm_accounts a
  ),
  unserved as (
    select count(*)::integer as customers_without_plan
      from public.crm_accounts a
     where a.status = 'customer'
       and not exists (
         select 1 from public.crm_service_plans p
          where p.account_id = a.id and p.active
       )
  ),
  agreements as (
    select
      count(*) filter (where c.status = 'active')::integer as contracts_active,
      count(*) filter (where c.status = 'ended')::integer as contracts_ended
      from public.crm_contracts c
  )
  select b.customers, b.inactive, b.prospects, u.customers_without_plan,
         g.contracts_active, g.contracts_ended,
         case
           when b.customers + b.inactive = 0 then null
           else round(b.customers::numeric * 10000 / (b.customers + b.inactive))::integer
         end
    from book b, unserved u, agreements g;
$$;

-- ---------------------------------------------------------------------------
-- Technician productivity. Completed work against what was scheduled, and
-- the labour behind it.
--
-- Every technician on the roster appears, including one who did nothing in
-- the window: an empty row is the finding, and dropping it would make the
-- averages flatter than the branch actually is.
-- ---------------------------------------------------------------------------

create or replace function public.crm_technician_productivity(p_days integer default 90)
returns table (
  technician_id uuid,
  first_name text,
  last_name text,
  branch_id uuid,
  active boolean,
  scheduled integer,
  completed integer,
  cancelled integer,
  -- Null while nothing was scheduled: rule 1.
  completion_rate_bps integer,
  -- Finished shifts only, minus breaks: rule 2. Null when every shift in
  -- the window is still running, which is a different thing from no work.
  worked_minutes bigint,
  running_shifts integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with window_start as (
    select (now() - make_interval(days => greatest(p_days, 1)))::timestamptz as since
  ),
  orders as (
    select w.technician_id,
           count(*)::integer as scheduled,
           count(*) filter (where w.status = 'completed')::integer as completed,
           count(*) filter (where w.status = 'cancelled')::integer as cancelled
      from public.crm_work_orders w, window_start s
     where w.technician_id is not null and w.scheduled_start >= s.since
     group by w.technician_id
  ),
  labour as (
    select t.technician_id,
           sum(
             greatest(
               (extract(epoch from (t.ended_at - t.started_at)) / 60)::bigint - t.break_minutes,
               0
             )
           ) filter (where t.ended_at is not null)::bigint as worked_minutes,
           count(*) filter (where t.ended_at is null)::integer as running_shifts
      from public.crm_timesheets t, window_start s
     where t.started_at >= s.since
     group by t.technician_id
  )
  select tech.id, tech.first_name, tech.last_name, tech.branch_id, tech.active,
         coalesce(o.scheduled, 0)::integer,
         coalesce(o.completed, 0)::integer,
         coalesce(o.cancelled, 0)::integer,
         case
           when coalesce(o.scheduled, 0) = 0 then null
           else round(coalesce(o.completed, 0)::numeric * 10000 / o.scheduled)::integer
         end,
         l.worked_minutes,
         coalesce(l.running_shifts, 0)::integer
    from public.crm_technicians tech
    left join orders o on o.technician_id = tech.id
    left join labour l on l.technician_id = tech.id
   order by coalesce(o.completed, 0) desc, tech.last_name nulls last, tech.first_name;
$$;

-- ---------------------------------------------------------------------------
-- Route density: how a day is actually shaped for one technician.
--
-- There is no mapping provider connected to this project, so DRIVE TIME
-- CANNOT BE COMPUTED and nothing here pretends to. What can be computed
-- from real scheduled windows is the shape of the day: how many stops,
-- when the first and last one are, how much of the span is booked, and how
-- much of it is a hole. A three-hour gap at eleven in the morning is a
-- dispatcher's finding whether or not anybody knows the mileage.
-- ---------------------------------------------------------------------------

create or replace function public.crm_route_density(p_days integer default 14)
returns table (
  day date,
  technician_id uuid,
  branch_id uuid,
  stops integer,
  first_start timestamptz,
  last_end timestamptz,
  span_minutes integer,
  booked_minutes integer,
  -- The span not covered by a scheduled window. Null with a single stop:
  -- one stop has no gaps, and calling that zero would read as a full day.
  idle_minutes integer,
  accounts integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with stops as (
    select w.technician_id,
           (w.scheduled_start at time zone 'UTC')::date as day,
           w.scheduled_start,
           w.scheduled_end,
           w.account_id
      from public.crm_work_orders w
     where w.technician_id is not null
       and w.status <> 'cancelled'
       and w.scheduled_start >= (now() - make_interval(days => greatest(p_days, 1)))
  )
  select s.day,
         s.technician_id,
         tech.branch_id,
         count(*)::integer as stops,
         min(s.scheduled_start),
         max(s.scheduled_end),
         (extract(epoch from (max(s.scheduled_end) - min(s.scheduled_start))) / 60)::integer,
         sum(extract(epoch from (s.scheduled_end - s.scheduled_start)) / 60)::integer,
         case
           when count(*) < 2 then null
           else greatest(
             (extract(epoch from (max(s.scheduled_end) - min(s.scheduled_start))) / 60)::integer
             - sum(extract(epoch from (s.scheduled_end - s.scheduled_start)) / 60)::integer,
             0
           )
         end,
         count(distinct s.account_id)::integer
    from stops s
    join public.crm_technicians tech on tech.id = s.technician_id
   group by s.day, s.technician_id, tech.branch_id
   order by s.day desc, stops desc;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Invoker functions still need execute, and still must not be
-- reachable by a signed-out visitor or by the service role.
-- ---------------------------------------------------------------------------

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'crm_revenue_by_month(integer)',
    'crm_receivable_aging()',
    'crm_retention_summary()',
    'crm_technician_productivity(integer)',
    'crm_route_density(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', v_function);
    execute format('grant execute on function public.%s to authenticated', v_function);
  end loop;
end;
$$;

-- Two indexes, and only two. The rest of what these functions walk is
-- already indexed by the migrations that created the tables — payments by
-- (organization_id, received_at), work orders by (organization_id,
-- technician_id, scheduled_start), timesheets by (organization_id,
-- technician_id, started_at). Adding a second copy of an index under a new
-- name costs every write and buys no read.
--
-- These two are genuinely absent: invoices are indexed by account and by
-- due date, but nothing groups them by issue month; and refunds are
-- indexed under the payment they credit, which is the wrong order for a
-- monthly total.
create index if not exists crm_invoices_org_issued_idx
  on public.crm_invoices (organization_id, issued_on) where status <> 'draft';
create index if not exists crm_refunds_org_refunded_idx
  on public.crm_refunds (organization_id, refunded_at);
