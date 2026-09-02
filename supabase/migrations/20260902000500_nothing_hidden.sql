-- ---------------------------------------------------------------------------
-- Increment 30 — nothing hidden (ADR-232).
--
-- Three complaints share one shape: a figure with nothing behind it. A
-- dashboard number nobody can open; an automation that "would have" done
-- something to records nobody can list; a schedule whose conflicts are
-- discovered by the technician who drives to them.
--
-- Three functions, all SECURITY INVOKER — they read what the caller may
-- read and store nothing:
--
--   crm_schedule_audit(org, days)        every contradiction in the next N
--                                        days, named, with the rows involved
--   crm_automation_dry_run(org, rule, d) exactly which records a rule would
--                                        touch right now, what it would do
--                                        to each, and why it would NOT
--   crm_dashboard_rows(org, figure, key) the rows behind any dashboard
--                                        figure, by the figure's own
--                                        predicate — the same one the
--                                        aggregate uses, so the count and
--                                        the list can never disagree
-- ---------------------------------------------------------------------------

create or replace function public.crm_schedule_audit(
  p_organization uuid,
  p_days integer default 14
)
returns table (
  finding text,
  severity text,
  occurs_on date,
  work_order_id uuid,
  other_work_order_id uuid,
  plan_id uuid,
  route_id uuid,
  account_id uuid,
  account_name text,
  technician_id uuid,
  technician_name text,
  detail text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with bounds as (
    select current_date as from_day,
           (current_date + greatest(p_days, 1))::date as to_day
  ),
  open_visits as (
    select w.id, w.account_id, w.technician_id, w.plan_id, w.status,
           w.scheduled_start, w.scheduled_end, w.service_type,
           (w.scheduled_start at time zone 'UTC')::date as day
      from public.crm_work_orders w
     where w.organization_id = p_organization
       and w.status in ('scheduled', 'dispatched', 'in_progress')
  ),
  tech as (
    select t.id, t.first_name || coalesce(' ' || t.last_name, '') as name
      from public.crm_technicians t
     where t.organization_id = p_organization
  ),
  findings as (
    -- One technician, two windows that overlap. Each visit is its own
    -- finding, because each is the one somebody will have to move.
    select 'double_booked'::text as finding, 'high'::text as severity, a.day as occurs_on,
           a.id as work_order_id, b.id as other_work_order_id,
           null::uuid as plan_id, null::uuid as route_id,
           a.account_id, a.technician_id,
           format('Overlaps %s, %s–%s.', bacc.name,
                  to_char(b.scheduled_start, 'HH24:MI'), to_char(b.scheduled_end, 'HH24:MI')) as detail
      from open_visits a
      join open_visits b
        on b.technician_id = a.technician_id and b.id <> a.id
       and a.scheduled_start < b.scheduled_end and b.scheduled_start < a.scheduled_end
      join public.crm_accounts bacc on bacc.id = b.account_id
      cross join bounds
     where a.technician_id is not null
       and a.day between bounds.from_day and bounds.to_day
    union all
    -- The window ended and nobody completed or cancelled the visit.
    select 'slipped', 'high', v.day, v.id, null, null, null, v.account_id, v.technician_id,
           format('The window ended %s and the visit is still %s.',
                  to_char(v.scheduled_end, 'YYYY-MM-DD HH24:MI'), v.status)
      from open_visits v
     where v.scheduled_end < now()
    union all
    -- Scheduled, but no route will carry it.
    select 'unrouted', 'medium', v.day, v.id, null, null, null, v.account_id, v.technician_id,
           'No planned or released route carries this visit.'
      from open_visits v cross join bounds
     where v.status in ('scheduled', 'dispatched')
       and v.day between bounds.from_day and bounds.to_day
       and not exists (
         select 1
           from public.crm_route_stops s
           join public.crm_routes r on r.id = s.route_id
          where s.work_order_id = v.id and r.status in ('planned', 'released')
       )
    union all
    -- A plan falls due and no visit sits within a week of it.
    select 'plan_due_unscheduled', 'medium', p.next_due, null, null, p.id, null,
           p.account_id, p.technician_id,
           format('%s due %s (%s); no visit within a week of it.',
                  p.service_type, to_char(p.next_due, 'YYYY-MM-DD'), p.recurrence)
      from public.crm_service_plans p cross join bounds
     where p.organization_id = p_organization
       and p.active
       and p.next_due <= bounds.to_day
       and not exists (
         select 1 from public.crm_work_orders w
          where w.plan_id = p.id
            and w.status <> 'cancelled'
            and (w.scheduled_start at time zone 'UTC')::date between p.next_due - 7 and p.next_due + 7
       )
    union all
    -- The dispatcher's planned arrival contradicts the window promised to
    -- the customer.
    select 'arrival_outside_window', 'low', r.route_date, v.id, null, null, r.id,
           v.account_id, r.technician_id,
           format('Planned arrival %s is outside the promised window %s–%s.',
                  to_char(s.planned_arrival, 'HH24:MI'),
                  to_char(v.scheduled_start, 'HH24:MI'), to_char(v.scheduled_end, 'HH24:MI'))
      from public.crm_route_stops s
      join public.crm_routes r on r.id = s.route_id
      join open_visits v on v.id = s.work_order_id
      cross join bounds
     where s.organization_id = p_organization
       and r.status in ('planned', 'released')
       and r.route_date between bounds.from_day and bounds.to_day
       and s.planned_arrival is not null
       and (s.planned_arrival < v.scheduled_start or s.planned_arrival > v.scheduled_end)
    union all
    -- The visit was reassigned after it was routed: the route says one
    -- technician, the visit says another.
    select 'technician_mismatch', 'medium', r.route_date, v.id, null, null, r.id,
           v.account_id, v.technician_id,
           format('The route belongs to %s; the visit is assigned to %s.', rt.name, vt.name)
      from public.crm_route_stops s
      join public.crm_routes r on r.id = s.route_id
      join open_visits v on v.id = s.work_order_id
      join tech rt on rt.id = r.technician_id
      join tech vt on vt.id = v.technician_id
      cross join bounds
     where s.organization_id = p_organization
       and r.status in ('planned', 'released')
       and r.route_date between bounds.from_day and bounds.to_day
       and r.technician_id <> v.technician_id
  )
  select f.finding, f.severity, f.occurs_on, f.work_order_id, f.other_work_order_id,
         f.plan_id, f.route_id, f.account_id, acc.name, f.technician_id, t.name, f.detail
    from findings f
    join public.crm_accounts acc on acc.id = f.account_id
    left join tech t on t.id = f.technician_id
   order by case f.severity when 'high' then 0 when 'medium' then 1 else 2 end,
            f.occurs_on, acc.name, f.finding;
$$;

revoke all on function public.crm_schedule_audit(uuid, integer) from public, anon, service_role;
grant execute on function public.crm_schedule_audit(uuid, integer) to authenticated;

create or replace function public.crm_automation_dry_run(
  p_organization uuid,
  p_automation uuid,
  p_days integer default 30
)
returns table (
  record_kind text,
  record_id uuid,
  account_id uuid,
  account_name text,
  occurred_at timestamptz,
  fires_at timestamptz,
  would_do text,
  blocked_reason text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with rule as (
    select a.trigger_on, a.action, a.delay_hours, a.template
      from public.crm_automations a
     where a.organization_id = p_organization and a.id = p_automation
  ),
  since as (
    select (now() - make_interval(days => greatest(p_days, 1)))::timestamptz as at,
           (current_date + greatest(p_days, 1))::date as until
  ),
  candidates as (
    select 'account'::text as record_kind, acc.id as record_id, acc.id as account_id,
           acc.created_at as occurred_at
      from public.crm_accounts acc, rule, since
     where rule.trigger_on = 'lead_created'
       and acc.organization_id = p_organization
       and acc.status = 'lead' and acc.created_at >= since.at
    union all
    select 'work_order', w.id, w.account_id, w.completed_at
      from public.crm_work_orders w, rule, since
     where rule.trigger_on = 'service_completed'
       and w.organization_id = p_organization
       and w.status = 'completed' and w.completed_at >= since.at
    union all
    select 'invoice', i.id, i.account_id, (i.due_on + 1)::timestamptz
      from public.crm_invoices i, rule
     where rule.trigger_on = 'invoice_overdue'
       and i.organization_id = p_organization
       and i.status = 'open' and i.total_cents > i.paid_cents
       and i.due_on is not null and i.due_on < current_date
    union all
    select 'contract', c.id, c.account_id, c.ends_on::timestamptz
      from public.crm_contracts c, rule, since
     where rule.trigger_on = 'contract_renewing'
       and c.organization_id = p_organization
       and c.status = 'active'
       and c.ends_on between current_date and since.until
    union all
    select 'sighting', s.id, s.account_id, s.sighted_at
      from public.crm_pest_sightings s, rule, since
     where rule.trigger_on = 'sighting_recorded'
       and s.organization_id = p_organization
       and s.sighted_at >= since.at
    union all
    select 'estimate', e.id, e.account_id, e.sent_at
      from public.crm_estimates e, rule, since
     where rule.trigger_on = 'estimate_sent'
       and e.organization_id = p_organization
       and e.status = 'sent' and e.sent_at >= since.at
  ),
  recipient as (
    select c.account_id,
           (array_agg(c.email order by c.is_primary desc, c.created_at)
              filter (where c.email is not null))[1] as email,
           (array_agg(c.phone order by c.is_primary desc, c.created_at)
              filter (where c.phone is not null))[1] as phone
      from public.crm_contacts c
     where c.organization_id = p_organization
     group by c.account_id
  ),
  prefs as (
    select p.account_id, p.channel, p.transactional_allowed, p.marketing_allowed, p.do_not_contact_at
      from public.crm_contact_preferences p
     where p.organization_id = p_organization
  )
  select cand.record_kind, cand.record_id, cand.account_id, acc.name, cand.occurred_at,
         cand.occurred_at + make_interval(hours => rule.delay_hours) as fires_at,
         case rule.action
           when 'send_email' then format('Would email %s: "%s"', coalesce(r.email, 'nobody'), left(rule.template, 80))
           when 'send_sms' then format('Would text %s: "%s"', coalesce(r.phone, 'nobody'), left(rule.template, 80))
           when 'create_task' then format('Would create a task on %s.', acc.name)
           when 'notify_manager' then format('Would notify the manager of %s''s branch.', acc.name)
           when 'schedule_followup' then format('Would schedule a follow-up on %s.', acc.name)
         end as would_do,
         case
           when rule.action = 'send_email' and r.email is null then 'no email on file'
           when rule.action = 'send_email' and pe.do_not_contact_at is not null then 'do not contact by email'
           when rule.action = 'send_email' and rule.trigger_on = 'lead_created' and pe.marketing_allowed = false
             then 'email marketing declined'
           when rule.action = 'send_email' and rule.trigger_on <> 'lead_created' and pe.transactional_allowed = false
             then 'email notices declined'
           when rule.action = 'send_sms' and r.phone is null then 'no phone on file'
           when rule.action = 'send_sms' and ps.do_not_contact_at is not null then 'do not contact by SMS'
           when rule.action = 'send_sms' and rule.trigger_on = 'lead_created' and ps.marketing_allowed = false
             then 'SMS marketing declined'
           when rule.action = 'send_sms' and rule.trigger_on <> 'lead_created' and ps.transactional_allowed = false
             then 'SMS notices declined'
           else null
         end as blocked_reason
    from candidates cand
    cross join rule
    join public.crm_accounts acc on acc.id = cand.account_id
    left join recipient r on r.account_id = cand.account_id
    left join prefs pe on pe.account_id = cand.account_id and pe.channel = 'email'
    left join prefs ps on ps.account_id = cand.account_id and ps.channel = 'sms'
   order by cand.occurred_at desc
   limit 1000;
$$;

revoke all on function public.crm_automation_dry_run(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.crm_automation_dry_run(uuid, uuid, integer) to authenticated;

create or replace function public.crm_dashboard_rows(
  p_organization uuid,
  p_figure text,
  p_key text default null,
  p_days integer default 90
)
returns table (
  row_kind text,
  row_id uuid,
  account_id uuid,
  account_name text,
  label text,
  occurred_on date,
  amount_cents bigint,
  status text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  -- Every cast is inside a CASE so a key meant for one figure is never
  -- parsed for another.
  with k as (
    select case when p_figure = 'invoiced_month' then date_trunc('month', p_key::date)::date end as month_key,
           case when p_figure = 'technician' then p_key::uuid end as technician_key,
           case when p_figure = 'route_day' then split_part(p_key, '|', 1)::date end as route_day_key,
           case when p_figure = 'route_day' then split_part(p_key, '|', 2)::uuid end as route_technician_key,
           (now() - make_interval(days => greatest(p_days, 1)))::timestamptz as since
  ),
  acc as (
    select a.id, a.name, a.status
      from public.crm_accounts a
     where a.organization_id = p_organization
  ),
  rows_ as (
    select 'invoice'::text as row_kind, i.id as row_id, i.account_id, a.name as account_name,
           i.number as label, i.issued_on as occurred_on, i.total_cents as amount_cents, i.status::text as status
      from public.crm_invoices i
      join acc a on a.id = i.account_id
      cross join k
     where p_figure = 'invoiced_month'
       and i.organization_id = p_organization
       and i.status <> 'draft' and i.issued_on is not null
       and date_trunc('month', i.issued_on)::date = k.month_key
    union all
    select 'invoice', i.id, i.account_id, a.name, i.number, i.due_on,
           greatest(i.total_cents - i.paid_cents, 0)::bigint, i.status::text
      from public.crm_invoices i
      join acc a on a.id = i.account_id
     where p_figure in ('overdue', 'aging')
       and i.organization_id = p_organization
       and i.status = 'open' and i.total_cents > i.paid_cents
       and (
         (p_figure = 'overdue' and i.due_on is not null and i.due_on < current_date)
         or (p_figure = 'aging' and p_key = case
               when i.due_on is null then 'undated'
               when i.due_on >= current_date then 'current'
               when current_date - i.due_on <= 30 then '1-30'
               when current_date - i.due_on <= 60 then '31-60'
               when current_date - i.due_on <= 90 then '61-90'
               else '90+'
             end)
       )
    union all
    select 'account', a.id, a.id, a.name, a.name, null::date, null::bigint, a.status::text
      from acc a
     where p_figure = 'no_plan'
       and a.status = 'customer'
       and not exists (select 1 from public.crm_service_plans p where p.account_id = a.id and p.active)
    union all
    select 'account', a.id, a.id, a.name, a.name, null::date, null::bigint, a.status::text
      from acc a
     where p_figure = 'retention' and a.status::text = p_key
    union all
    select 'work_order', w.id, w.account_id, a.name, w.service_type,
           (w.scheduled_start at time zone 'UTC')::date, null::bigint, w.status::text
      from public.crm_work_orders w
      join acc a on a.id = w.account_id
      cross join k
     where p_figure = 'technician'
       and w.organization_id = p_organization
       and w.technician_id = k.technician_key
       and w.scheduled_start >= k.since
    union all
    select 'work_order', w.id, w.account_id, a.name, w.service_type,
           (w.scheduled_start at time zone 'UTC')::date, null::bigint, w.status::text
      from public.crm_work_orders w
      join acc a on a.id = w.account_id
      cross join k
     where p_figure = 'route_day'
       and w.organization_id = p_organization
       and w.technician_id = k.route_technician_key
       and w.status <> 'cancelled'
       and (w.scheduled_start at time zone 'UTC')::date = k.route_day_key
  )
  select r.row_kind, r.row_id, r.account_id, r.account_name, r.label, r.occurred_on, r.amount_cents, r.status
    from rows_ r
   order by r.occurred_on desc nulls last, r.account_name, r.label
   limit 500;
$$;

revoke all on function public.crm_dashboard_rows(uuid, text, text, integer) from public, anon, service_role;
grant execute on function public.crm_dashboard_rows(uuid, text, text, integer) to authenticated;
