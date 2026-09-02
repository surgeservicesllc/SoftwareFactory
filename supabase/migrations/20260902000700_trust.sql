-- ---------------------------------------------------------------------------
-- Increment 32 — trust (ADR-234).
--
-- Two of the teardown's last complaints are about a figure nobody can
-- argue with and a list nobody can clean: "a forecasting tool that lacks
-- customisation" (a model you cannot see) and "inactive and bounced
-- contacts need manual cleanup" (a list that quietly rots). Both get the
-- same treatment as everything before them: the inputs are the owner's,
-- printed beside the figure, and the finding is computed live.
--
--   crm_forecast_assumptions        the owner's annual churn and growth,
--                                   one row per workspace, with a note
--                                   saying where the numbers came from
--   crm_revenue_forecast_scenario   the recorded forecast beside the same
--                                   months with those assumptions applied,
--                                   and the factor printed per month
--   crm_contact_hygiene             every contact the book should not
--                                   trust as it stands, with the reasons
--
-- Nothing here sends, deletes or "cleans" anything: a flagged contact is
-- a person's call, made on the account page.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_forecast_assumptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Annual rates in basis points: 1200 is twelve percent a year.
  annual_churn_bps integer not null default 0 check (annual_churn_bps between 0 and 10000),
  annual_growth_bps integer not null default 0 check (annual_growth_bps between 0 and 10000),
  -- Where the numbers came from, in the owner's words. A scenario with no
  -- provenance is a guess wearing a decimal point.
  note text check (note is null or char_length(btrim(note)) between 1 and 300),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_forecast_assumptions_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_forecast_assumptions_org_key
  on public.crm_forecast_assumptions (organization_id);
create unique index if not exists crm_forecast_assumptions_org_id_key
  on public.crm_forecast_assumptions (organization_id, id);

alter table public.crm_forecast_assumptions enable row level security;
alter table public.crm_forecast_assumptions force row level security;

drop policy if exists crm_forecast_assumptions_select_member on public.crm_forecast_assumptions;
create policy crm_forecast_assumptions_select_member on public.crm_forecast_assumptions
  for select to authenticated using (public.is_organization_member(organization_id));
drop policy if exists crm_forecast_assumptions_insert_member on public.crm_forecast_assumptions;
create policy crm_forecast_assumptions_insert_member on public.crm_forecast_assumptions
  for insert to authenticated with check (public.is_organization_member(organization_id));
drop policy if exists crm_forecast_assumptions_update_member on public.crm_forecast_assumptions;
create policy crm_forecast_assumptions_update_member on public.crm_forecast_assumptions
  for update to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
drop policy if exists crm_forecast_assumptions_delete_member on public.crm_forecast_assumptions;
create policy crm_forecast_assumptions_delete_member on public.crm_forecast_assumptions
  for delete to authenticated using (public.is_organization_member(organization_id));

revoke all on public.crm_forecast_assumptions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.crm_forecast_assumptions to authenticated;

drop trigger if exists crm_forecast_assumptions_set_updated_at on public.crm_forecast_assumptions;
create trigger crm_forecast_assumptions_set_updated_at
  before update on public.crm_forecast_assumptions
  for each row execute function public.set_updated_at();

-- The recorded forecast (ADR-202: what is on the books, no model) beside
-- the same months with the owner's annual churn and growth compounded
-- month by month from the current month. The factor is printed so the
-- scenario can be checked by hand: month k carries
-- (1 - churn_m)^k * (1 + growth_m)^k, where churn_m and growth_m are the
-- monthly rates that compound to the annual ones. Month 0 is always the
-- recorded figure. Inputs outside 0..100% are clamped, not trusted.
create or replace function public.crm_revenue_forecast_scenario(
  p_months integer default 12,
  p_churn_bps integer default 0,
  p_growth_bps integer default 0
)
returns table (
  month date,
  months_ahead integer,
  recorded_cents bigint,
  scenario_cents bigint,
  factor_bps integer,
  plans integer,
  contracts integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with base as (
    select f.month, f.total_cents, f.plans, f.contracts,
           (row_number() over (order by f.month) - 1)::integer as k
      from public.crm_revenue_forecast(greatest(p_months, 1)) f
  ),
  rates as (
    select 1 - power(1 - least(greatest(coalesce(p_churn_bps, 0), 0), 10000) / 10000.0, 1.0 / 12) as churn_m,
           power(1 + least(greatest(coalesce(p_growth_bps, 0), 0), 10000) / 10000.0, 1.0 / 12) - 1 as growth_m
  ),
  factored as (
    select b.*, power(1 - r.churn_m, b.k) * power(1 + r.growth_m, b.k) as factor
      from base b cross join rates r
  )
  select f.month, f.k, f.total_cents,
         round(f.total_cents * f.factor)::bigint,
         round(f.factor * 10000)::integer,
         f.plans, f.contracts
    from factored f
   order by f.month;
$$;

revoke all on function public.crm_revenue_forecast_scenario(integer, integer, integer) from public, anon, service_role;
grant execute on function public.crm_revenue_forecast_scenario(integer, integer, integer) to authenticated;

-- Every contact the book should not trust as it stands, with the reasons:
--   unreachable       no email and no phone
--   undeliverable     a transactional notice to this address or number failed
--   duplicate_email   the same address sits on another contact in the book
--   inactive_account  the account it belongs to is inactive
--   untouched_year    nothing on the account — no history, invoice or
--                     completed visit — in the last year, or ever
-- A contact with no flag is not returned: the list is the finding.
create or replace function public.crm_contact_hygiene(p_organization uuid)
returns table (
  contact_id uuid,
  account_id uuid,
  account_name text,
  account_status text,
  contact_name text,
  email text,
  phone text,
  is_primary boolean,
  last_touch_at timestamptz,
  days_since_touch integer,
  flags text[],
  flag_count integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with touches as (
    select e.account_id, max(e.occurred_at) as at
      from public.crm_timeline_events e
     where e.organization_id = p_organization
     group by e.account_id
    union all
    select i.account_id, max(i.issued_on)::timestamptz
      from public.crm_invoices i
     where i.organization_id = p_organization and i.issued_on is not null
     group by i.account_id
    union all
    select w.account_id, max(w.completed_at)
      from public.crm_work_orders w
     where w.organization_id = p_organization and w.completed_at is not null
     group by w.account_id
  ),
  last_touch as (
    select t.account_id, max(t.at) as at from touches t group by t.account_id
  ),
  failed as (
    select distinct lower(btrim(n.destination)) as destination
      from public.crm_notices n
     where n.organization_id = p_organization and n.state = 'failed'
  ),
  repeated as (
    select lower(btrim(c.email)) as email
      from public.crm_contacts c
     where c.organization_id = p_organization and c.email is not null
     group by 1
    having count(*) > 1
  ),
  flagged as (
    select c.id, c.account_id, acc.name as account_name, acc.status::text as account_status,
           c.first_name || coalesce(' ' || c.last_name, '') as contact_name,
           c.email, c.phone, c.is_primary, lt.at as last_touch_at,
           array_remove(array[
             case when c.email is null and c.phone is null then 'unreachable' end,
             case when fe.destination is not null or fp.destination is not null then 'undeliverable' end,
             case when r.email is not null then 'duplicate_email' end,
             case when acc.status = 'inactive' then 'inactive_account' end,
             case when lt.at is null or lt.at < now() - interval '365 days' then 'untouched_year' end
           ], null) as flags
      from public.crm_contacts c
      join public.crm_accounts acc on acc.id = c.account_id
      left join last_touch lt on lt.account_id = c.account_id
      left join failed fe on c.email is not null and fe.destination = lower(btrim(c.email))
      left join failed fp on c.phone is not null and fp.destination = lower(btrim(c.phone))
      left join repeated r on c.email is not null and r.email = lower(btrim(c.email))
     where c.organization_id = p_organization
  )
  select f.id, f.account_id, f.account_name, f.account_status, f.contact_name, f.email, f.phone,
         f.is_primary, f.last_touch_at,
         case when f.last_touch_at is null then null
              else (extract(epoch from (now() - f.last_touch_at)) / 86400)::integer end,
         f.flags, cardinality(f.flags)
    from flagged f
   where cardinality(f.flags) > 0
   order by cardinality(f.flags) desc, f.last_touch_at asc nulls first, f.account_name, f.contact_name;
$$;

revoke all on function public.crm_contact_hygiene(uuid) from public, anon, service_role;
grant execute on function public.crm_contact_hygiene(uuid) to authenticated;
