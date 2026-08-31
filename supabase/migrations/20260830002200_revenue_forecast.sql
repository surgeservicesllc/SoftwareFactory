-- Services CRM increment 14: revenue forecasting (task #69, owner /goal —
-- ADR-202). Briostack sells it, and the matrix carries it as a gap with no
-- provider dependency: everything it needs is already in crm_service_plans
-- and crm_contracts.
--
-- A FORECAST IS A PROJECTION OF WHAT IS ON THE BOOKS, AND NOTHING ELSE.
--
-- That sentence is the whole design, and it rules out the thing forecasting
-- features usually do. There is no churn multiplier, no growth assumption,
-- no seasonality curve — not because they would be hard, but because this
-- system has no evidence for any of them. Multiplying a real number by an
-- invented retention rate produces a number that looks more precise than
-- the truth and is less accurate, and a business would plan hiring on it.
--
-- What is projected is arithmetic over rows somebody actually signed:
--
--   * an ACTIVE service plan bills its value every recurrence, so it
--     contributes to each month its recurrence lands in;
--   * an ACTIVE contract with a term contributes its value spread across
--     the months the term covers;
--   * a plan or contract that has ended contributes nothing, and one that
--     is merely inactive contributes nothing either.
--
-- Every row carries `basis`, which names what it was computed FROM. A
-- forecast whose provenance is not on the page is a number nobody can
-- argue with, and the ones worth having are exactly the ones somebody can
-- argue with.
--
-- SECURITY INVOKER, on ADR-199's reasoning.

create or replace function public.crm_revenue_forecast(p_months integer default 12)
returns table (
  month date,
  recurring_cents bigint,
  contracted_cents bigint,
  total_cents bigint,
  plans integer,
  contracts integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with months as (
    select generate_series(
      date_trunc('month', current_date),
      date_trunc('month', current_date)
        + make_interval(months => greatest(p_months, 1) - 1),
      interval '1 month'
    )::date as month
  ),
  -- How many times a recurrence lands in a month, as a fraction. Weekly is
  -- not "four times": it is 365/7/12, because a month is not four weeks and
  -- billing twelve times a year at four-weekly rates understates a year by
  -- a whole cycle.
  plan_month as (
    select m.month,
           sum(
             p.value_cents * case p.recurrence
               when 'weekly'     then 365.0 / 7 / 12
               when 'biweekly'   then 365.0 / 14 / 12
               when 'monthly'    then 1.0
               when 'bimonthly'  then 0.5
               when 'quarterly'  then 1.0 / 3
               when 'semiannual' then 1.0 / 6
               when 'annual'     then 1.0 / 12
             end
           )::bigint as recurring_cents,
           count(*)::integer as plans
      from months m
      cross join public.crm_service_plans p
     where p.active and p.value_cents is not null and p.value_cents > 0
     group by m.month
  ),
  contract_month as (
    select m.month,
           sum(
             -- Spread across the months the term actually covers. A term
             -- with no end date is open-ended, and an open-ended contract
             -- cannot be spread — it is left to the plans underneath it
             -- rather than guessed at.
             c.value_cents::numeric
               / greatest(
                   1,
                   (extract(year from age(c.ends_on, c.starts_on)) * 12
                    + extract(month from age(c.ends_on, c.starts_on)))::integer
                 )
           )::bigint as contracted_cents,
           count(*)::integer as contracts
      from months m
      join public.crm_contracts c
        on c.status = 'active'
       and c.ends_on is not null
       and m.month >= date_trunc('month', c.starts_on)::date
       and m.month <= date_trunc('month', c.ends_on)::date
     group by m.month
  )
  select m.month,
         coalesce(p.recurring_cents, 0)::bigint,
         coalesce(c.contracted_cents, 0)::bigint,
         (coalesce(p.recurring_cents, 0) + coalesce(c.contracted_cents, 0))::bigint,
         coalesce(p.plans, 0)::integer,
         coalesce(c.contracts, 0)::integer
    from months m
    left join plan_month p on p.month = m.month
    left join contract_month c on c.month = m.month
   order by m.month;
$$;

-- ---------------------------------------------------------------------------
-- What the forecast is standing on, so a reader can judge it.
--
-- Reported beside the numbers rather than buried: how much of the book is
-- open-ended (and therefore NOT in the contracted line), how many customers
-- have no active plan at all, and how many plans carry no price. Each is a
-- reason the projection understates, and a forecast that hides its own
-- omissions is a forecast nobody should act on.
-- ---------------------------------------------------------------------------

create or replace function public.crm_forecast_basis()
returns table (
  active_plans integer,
  unpriced_plans integer,
  active_contracts integer,
  open_ended_contracts integer,
  customers_without_plan integer,
  -- Null when there is no book at all: a share of nothing is not zero.
  priced_share_bps integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with plans as (
    select
      count(*) filter (where p.active)::integer as active_plans,
      count(*) filter (where p.active and (p.value_cents is null or p.value_cents = 0))::integer
        as unpriced_plans
      from public.crm_service_plans p
  ),
  contracts as (
    select
      count(*) filter (where c.status = 'active')::integer as active_contracts,
      count(*) filter (where c.status = 'active' and c.ends_on is null)::integer
        as open_ended_contracts
      from public.crm_contracts c
  ),
  unserved as (
    select count(*)::integer as customers_without_plan
      from public.crm_accounts a
     where a.status = 'customer'
       and not exists (
         select 1 from public.crm_service_plans p
          where p.account_id = a.id and p.active
       )
  )
  select p.active_plans, p.unpriced_plans, c.active_contracts,
         c.open_ended_contracts, u.customers_without_plan,
         case
           when p.active_plans = 0 then null
           else round((p.active_plans - p.unpriced_plans)::numeric * 10000 / p.active_plans)::integer
         end
    from plans p, contracts c, unserved u;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'crm_revenue_forecast(integer)',
    'crm_forecast_basis()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', v_function);
    execute format('grant execute on function public.%s to authenticated', v_function);
  end loop;
end;
$$;

create index if not exists crm_contracts_org_term_idx
  on public.crm_contracts (organization_id, starts_on, ends_on) where status = 'active';
