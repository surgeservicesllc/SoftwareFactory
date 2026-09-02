-- ---------------------------------------------------------------------------
-- Increment 29 — job profitability (ADR-231).
--
-- "Impossible to determine profitability reliably"; reports "totally off";
-- "cannot tell if a route makes money". The reason is never the
-- arithmetic — it is that the inputs are hidden, and a margin whose
-- inputs are hidden is a number nobody can check.
--
-- This file adds the two costs the book did not know and one function
-- that computes, per completed visit, what it earned and what it cost,
-- printing every input and counting every unknown INSTEAD of treating it
-- as zero:
--
--   crm_technicians.hourly_cost_cents   the fully loaded hourly cost of a
--                                       technician; null means unknown
--   crm_product_lots.unit_cost_cents    what one unit of a lot cost when
--                                       it was received; null means unknown
--   crm_visit_profitability()           revenue from the visit's invoices,
--                                       labour from its timesheets (or the
--                                       scheduled window, SAID so), chemicals
--                                       from its applications' lots
--
-- A margin is null — not zero, not "about" — whenever any input is unknown:
-- no invoice linked, no hourly cost on the technician, or an application
-- whose lot has no cost or whose unit does not match the lot's. The page
-- counts those, so "we lost money on Tuesday" and "we do not know what
-- Tuesday cost" are different sentences.
-- ---------------------------------------------------------------------------

alter table public.crm_technicians
  add column if not exists hourly_cost_cents integer
    check (hourly_cost_cents is null or hourly_cost_cents between 0 and 100000000);

alter table public.crm_product_lots
  add column if not exists unit_cost_cents integer
    check (unit_cost_cents is null or unit_cost_cents between 0 and 100000000);

create or replace function public.crm_visit_profitability(
  p_organization uuid,
  p_days integer default 90
)
returns table (
  work_order_id uuid,
  account_id uuid,
  account_name text,
  service_type text,
  completed_at timestamptz,
  technician_id uuid,
  technician_name text,
  branch_id uuid,
  -- Null when no invoice is linked to the visit: unbilled is not free.
  revenue_cents bigint,
  invoice_count integer,
  labour_minutes integer,
  -- 'timesheet' when finished shifts were clocked against the visit;
  -- 'window' when the scheduled window stands in, which is an estimate
  -- and is labelled as one.
  labour_basis text,
  hourly_cost_cents integer,
  labour_cost_cents bigint,
  chemical_cost_cents bigint,
  applications integer,
  -- Applications whose cost cannot be computed: no lot, a lot with no
  -- cost, or a unit that does not match the lot's.
  uncosted_applications integer,
  margin_cents bigint,
  margin_bps integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with window_start as (
    select (now() - make_interval(days => greatest(p_days, 1)))::timestamptz as since
  ),
  visits as (
    select w.id, w.account_id, w.service_type, w.completed_at, w.technician_id,
           w.scheduled_start, w.scheduled_end
      from public.crm_work_orders w, window_start s
     where w.organization_id = p_organization
       and w.status = 'completed'
       and w.completed_at >= s.since
  ),
  revenue as (
    select i.work_order_id,
           sum(i.subtotal_cents)::bigint as revenue_cents,
           count(*)::integer as invoice_count
      from public.crm_invoices i
      join visits v on v.id = i.work_order_id
     where i.organization_id = p_organization
       and i.status <> 'void'
     group by i.work_order_id
  ),
  labour as (
    select t.work_order_id,
           sum(greatest(
             (extract(epoch from (t.ended_at - t.started_at)) / 60)::bigint - t.break_minutes, 0
           ))::integer as minutes
      from public.crm_timesheets t
      join visits v on v.id = t.work_order_id
     where t.organization_id = p_organization
       and t.ended_at is not null
     group by t.work_order_id
  ),
  chemicals as (
    select a.work_order_id,
           count(*)::integer as applications,
           count(*) filter (
             where l.id is null or l.unit_cost_cents is null or l.unit <> a.unit
           )::integer as uncosted,
           coalesce(sum(round(a.quantity * l.unit_cost_cents)) filter (
             where l.id is not null and l.unit_cost_cents is not null and l.unit = a.unit
           ), 0)::bigint as cost_cents
      from public.crm_applications a
      join visits v on v.id = a.work_order_id
      left join public.crm_product_lots l
        on l.organization_id = a.organization_id and l.id = a.lot_id
     where a.organization_id = p_organization
     group by a.work_order_id
  ),
  computed as (
    select v.id as work_order_id,
           v.account_id,
           acc.name as account_name,
           v.service_type,
           v.completed_at,
           v.technician_id,
           case when tech.id is null then null
                else tech.first_name || coalesce(' ' || tech.last_name, '') end as technician_name,
           tech.branch_id,
           r.revenue_cents,
           coalesce(r.invoice_count, 0)::integer as invoice_count,
           coalesce(lab.minutes,
                    (extract(epoch from (v.scheduled_end - v.scheduled_start)) / 60)::integer)
             as labour_minutes,
           case when lab.minutes is not null then 'timesheet' else 'window' end as labour_basis,
           tech.hourly_cost_cents,
           case
             when tech.hourly_cost_cents is null then null
             else round(
               coalesce(lab.minutes,
                        (extract(epoch from (v.scheduled_end - v.scheduled_start)) / 60)::integer)
               * tech.hourly_cost_cents / 60.0)::bigint
           end as labour_cost_cents,
           coalesce(ch.cost_cents, 0)::bigint as chemical_cost_cents,
           coalesce(ch.applications, 0)::integer as applications,
           coalesce(ch.uncosted, 0)::integer as uncosted_applications
      from visits v
      join public.crm_accounts acc
        on acc.organization_id = p_organization and acc.id = v.account_id
      left join public.crm_technicians tech
        on tech.organization_id = p_organization and tech.id = v.technician_id
      left join revenue r on r.work_order_id = v.id
      left join labour lab on lab.work_order_id = v.id
      left join chemicals ch on ch.work_order_id = v.id
  )
  select c.work_order_id, c.account_id, c.account_name, c.service_type, c.completed_at,
         c.technician_id, c.technician_name, c.branch_id,
         c.revenue_cents, c.invoice_count,
         c.labour_minutes, c.labour_basis, c.hourly_cost_cents, c.labour_cost_cents,
         c.chemical_cost_cents, c.applications, c.uncosted_applications,
         case
           when c.revenue_cents is null or c.labour_cost_cents is null or c.uncosted_applications > 0
             then null
           else c.revenue_cents - c.labour_cost_cents - c.chemical_cost_cents
         end as margin_cents,
         case
           when c.revenue_cents is null or c.labour_cost_cents is null or c.uncosted_applications > 0
                or c.revenue_cents = 0
             then null
           else round((c.revenue_cents - c.labour_cost_cents - c.chemical_cost_cents) * 10000.0
                      / c.revenue_cents)::integer
         end as margin_bps
    from computed c
   order by 18 asc nulls last, c.completed_at desc;
$$;

revoke all on function public.crm_visit_profitability(uuid, integer) from public, anon, service_role;
grant execute on function public.crm_visit_profitability(uuid, integer) to authenticated;
