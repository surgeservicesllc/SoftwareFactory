-- ---------------------------------------------------------------------------
-- Increment 27 — explainable scoring, and assignment with its reason
-- (ADR-229).
--
-- HubSpot's lead scoring is "complex and clunky", its contact scoring
-- "finicky, we have to restart the workflow", and its predictive scoring
-- is a number nobody can argue with because nobody can see inside it.
-- PestPac sells "service opportunity identification" and "automatic lead
-- assignment" as modules. The honest version of all four is the same
-- thing: a score that is a SUM of named rules, each with editable points,
-- each printed with the fact that made it apply — so a salesperson reading
-- "72" also reads "estimate sent (+15), commercial (+15), three service
-- locations (+15), no activity in 30 days (−10)" and can disagree with any
-- line of it.
--
-- Three models over one engine:
--
--   lead     how warm a lead or prospect is
--   churn    how much a customer is at risk
--   upsell   where a customer has room to buy more
--
-- The DEFAULT rules live in a function so they are versioned with the
-- schema and identical for every workspace; a workspace overrides points
-- or switches a rule off through `crm_scoring_rules`, which holds only
-- the overrides. Nothing is stored about an account: a score is computed
-- from the rows as they are at the moment of asking, like every other
-- figure in this product.
--
-- Assignment rides along because it is the same shape of honesty: a new
-- account whose billing address carries a postal code inside a
-- territory's coverage is assigned that territory, its branch and its
-- rep — and a line on the account's history says exactly which postal
-- code matched which territory, so "the system gave it to Ada" is never
-- a mystery.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_scoring_model as enum ('lead', 'churn', 'upsell');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The defaults, as a function: one place, versioned, the same everywhere.
-- Labels are what the page prints; the fact beside a score is computed
-- per account and is more specific than the label.
-- ---------------------------------------------------------------------------

create or replace function public.crm_scoring_defaults()
returns table (model public.crm_scoring_model, rule_key text, label text, points integer)
language sql
immutable
set search_path = pg_catalog, public
as $$
  values
    ('lead'::public.crm_scoring_model, 'has_email'::text, 'Email on file'::text, 10),
    ('lead', 'has_phone', 'Phone on file', 10),
    ('lead', 'source_recorded', 'Source recorded', 5),
    ('lead', 'commercial', 'Commercial account', 15),
    ('lead', 'service_locations', 'Service locations on file (per location, up to four)', 5),
    ('lead', 'open_opportunity', 'An open opportunity', 10),
    ('lead', 'opportunity_value', 'An open opportunity worth at least $1,000', 10),
    ('lead', 'estimate_sent', 'An estimate sent', 15),
    ('lead', 'portal_request', 'Asked for service through the portal', 10),
    ('lead', 'activity_7d', 'Activity in the last 7 days', 15),
    ('lead', 'activity_30d', 'Activity in the last 30 days', 5),
    ('lead', 'silent_30d', 'No activity in 30 days', -10),
    ('churn', 'visit_overdue', 'An active plan more than 14 days past due', 25),
    ('churn', 'no_visit_90d', 'An active plan but no completed visit in 90 days', 20),
    ('churn', 'cancelled_visits_90d', 'Cancelled visits in 90 days (per visit, up to three)', 10),
    ('churn', 'overdue_invoice', 'An invoice past due', 20),
    ('churn', 'unresolved_sighting', 'A sighting without corrective action', 15),
    ('churn', 'contract_ending_60d', 'A contract ending within 60 days', 15),
    ('churn', 'request_unanswered', 'A portal request not yet acknowledged', 10),
    ('churn', 'silent_90d', 'No activity in 90 days', 10),
    ('upsell', 'location_without_plan', 'A service location with no active plan', 20),
    ('upsell', 'sighting_without_plan', 'A sighting at a location with no active plan', 25),
    ('upsell', 'wdo_stale', 'No WDO inspection issued in the last 12 months', 15),
    ('upsell', 'estimate_accepted_no_contract', 'An accepted estimate with no active contract', 20),
    ('upsell', 'contract_renewal_90d', 'A contract ending within 90 days', 15),
    ('upsell', 'one_off_visits', 'Three or more one-off visits in six months', 20),
    ('upsell', 'commercial_without_ipm', 'Commercial account with no monitoring stations', 15)
$$;

revoke all on function public.crm_scoring_defaults() from public, anon, service_role;
grant execute on function public.crm_scoring_defaults() to authenticated;

-- ---------------------------------------------------------------------------
-- Overrides. A row exists only where a workspace changed something; a
-- missing row means the default. Deleting an override IS resetting it.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model public.crm_scoring_model not null,
  -- Keys carry their windows (silent_30d, no_visit_90d), so digits are part
  -- of the vocabulary; the trigger below still requires a rule that exists.
  rule_key text not null check (rule_key ~ '^[a-z][a-z0-9_]{2,39}$'),
  points integer not null check (points between -100 and 100),
  active boolean not null default true,
  note text check (note is null or char_length(btrim(note)) between 1 and 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_scoring_rules_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_scoring_rules_org_model_key
  on public.crm_scoring_rules (organization_id, model, rule_key);

-- An override must name a rule that exists. Cross-function, so a trigger.
create or replace function public.crm_scoring_rule_known()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.crm_scoring_defaults() d
     where d.model = new.model and d.rule_key = new.rule_key
  ) then
    raise exception 'no rule % in the % model', new.rule_key, new.model
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_scoring_rule_known()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_scoring_rules_known on public.crm_scoring_rules;
create trigger crm_scoring_rules_known
  before insert or update on public.crm_scoring_rules
  for each row execute function public.crm_scoring_rule_known();

drop trigger if exists crm_scoring_rules_set_updated_at on public.crm_scoring_rules;
create trigger crm_scoring_rules_set_updated_at
  before update on public.crm_scoring_rules
  for each row execute function public.set_updated_at();

-- The rules a workspace actually runs: defaults with overrides laid over.
create or replace function public.crm_effective_scoring_rules(
  p_organization uuid,
  p_model public.crm_scoring_model
)
returns table (
  rule_key text,
  label text,
  points integer,
  default_points integer,
  active boolean,
  overridden boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select d.rule_key, d.label,
         coalesce(o.points, d.points),
         d.points,
         coalesce(o.active, true),
         o.id is not null
    from public.crm_scoring_defaults() d
    left join public.crm_scoring_rules o
      on o.organization_id = p_organization
     and o.model = d.model
     and o.rule_key = d.rule_key
   where d.model = p_model
   order by d.rule_key;
$$;

revoke all on function public.crm_effective_scoring_rules(uuid, public.crm_scoring_model)
  from public, anon, service_role;
grant execute on function public.crm_effective_scoring_rules(uuid, public.crm_scoring_model)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The engine. One facts row per account, then every active rule is asked
-- whether it applies and with what multiplier, and the answer is kept
-- beside the points as the FACT — the specific sentence, not the label.
--
-- INVOKER: every table read is member-scoped, so the caller scores
-- exactly the accounts they could open. Lead scores leads and prospects;
-- churn and upsell score customers.
-- ---------------------------------------------------------------------------

create or replace function public.crm_score_accounts(
  p_organization uuid,
  p_model public.crm_scoring_model
)
returns table (
  account_id uuid,
  score integer,
  breakdown jsonb
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with rules as (
    select r.rule_key, r.label, r.points
      from public.crm_effective_scoring_rules(p_organization, p_model) r
     where r.active
  ),
  scoped as (
    select a.*
      from public.crm_accounts a
     where a.organization_id = p_organization
       and case p_model
             when 'lead' then a.status in ('lead', 'prospect')
             else a.status = 'customer'
           end
  ),
  facts as (
    select a.id as account_id,
           a.kind, a.source, a.email, a.phone,
           (a.email is not null or exists (
              select 1 from public.crm_contacts c
               where c.organization_id = a.organization_id and c.account_id = a.id and c.email is not null))
             as has_email,
           (a.phone is not null or exists (
              select 1 from public.crm_contacts c
               where c.organization_id = a.organization_id and c.account_id = a.id and c.phone is not null))
             as has_phone,
           (select count(*) from public.crm_properties p
             where p.organization_id = a.organization_id and p.account_id = a.id)::integer
             as locations,
           (select count(*) from public.crm_properties p
             where p.organization_id = a.organization_id and p.account_id = a.id
               and not exists (
                 select 1 from public.crm_service_plans sp
                  where sp.organization_id = p.organization_id and sp.property_id = p.id and sp.active))::integer
             as locations_without_plan,
           (select count(*) from public.crm_opportunities o
             where o.organization_id = a.organization_id and o.account_id = a.id
               and o.stage not in ('won', 'lost'))::integer
             as open_opportunities,
           (select max(o.value_cents) from public.crm_opportunities o
             where o.organization_id = a.organization_id and o.account_id = a.id
               and o.stage not in ('won', 'lost'))
             as open_opportunity_value,
           exists (select 1 from public.crm_estimates e
                    where e.organization_id = a.organization_id and e.account_id = a.id and e.status = 'sent')
             as estimate_sent,
           exists (select 1 from public.crm_estimates e
                    where e.organization_id = a.organization_id and e.account_id = a.id
                      and e.status = 'accepted' and e.decided_at >= now() - interval '180 days')
             as estimate_accepted_recent,
           exists (select 1 from public.crm_portal_requests r
                    where r.organization_id = a.organization_id and r.account_id = a.id)
             as portal_request,
           exists (select 1 from public.crm_portal_requests r
                    where r.organization_id = a.organization_id and r.account_id = a.id and r.status = 'submitted')
             as request_unanswered,
           (select current_date - max(e.occurred_at)::date from public.crm_timeline_events e
             where e.organization_id = a.organization_id and e.account_id = a.id)
             as last_activity_days,
           (select max(current_date - sp.next_due) from public.crm_service_plans sp
             where sp.organization_id = a.organization_id and sp.account_id = a.id
               and sp.active and sp.next_due < current_date)
             as plan_overdue_days,
           (select count(*) from public.crm_service_plans sp
             where sp.organization_id = a.organization_id and sp.account_id = a.id and sp.active)::integer
             as active_plans,
           (select current_date - max(w.completed_at)::date from public.crm_work_orders w
             where w.organization_id = a.organization_id and w.account_id = a.id and w.status = 'completed')
             as last_completed_days,
           (select count(*) from public.crm_work_orders w
             where w.organization_id = a.organization_id and w.account_id = a.id
               and w.status = 'cancelled' and w.scheduled_start >= now() - interval '90 days')::integer
             as cancelled_90d,
           (select count(*) from public.crm_work_orders w
             where w.organization_id = a.organization_id and w.account_id = a.id
               and w.status = 'completed' and w.plan_id is null
               and w.completed_at >= now() - interval '6 months')::integer
             as one_off_visits_6m,
           (select coalesce(sum(i.total_cents - i.paid_cents), 0) from public.crm_invoices i
             where i.organization_id = a.organization_id and i.account_id = a.id
               and i.status = 'open' and i.due_on < current_date and i.paid_cents < i.total_cents)::bigint
             as overdue_cents,
           (select count(*) from public.crm_pest_sightings s
             where s.organization_id = a.organization_id and s.account_id = a.id and s.corrected_at is null)::integer
             as unresolved_sightings,
           (select count(*) from public.crm_pest_sightings s
             where s.organization_id = a.organization_id and s.account_id = a.id
               and not exists (
                 select 1 from public.crm_service_plans sp
                  where sp.organization_id = s.organization_id and sp.property_id = s.property_id and sp.active))::integer
             as sightings_without_plan,
           (select s.pest from public.crm_pest_sightings s
             where s.organization_id = a.organization_id and s.account_id = a.id
               and not exists (
                 select 1 from public.crm_service_plans sp
                  where sp.organization_id = s.organization_id and sp.property_id = s.property_id and sp.active)
             order by s.sighted_at desc limit 1)
             as sighting_without_plan_pest,
           exists (select 1 from public.crm_contracts k
                    where k.organization_id = a.organization_id and k.account_id = a.id and k.status = 'active')
             as contract_active,
           (select min(k.ends_on - current_date) from public.crm_contracts k
             where k.organization_id = a.organization_id and k.account_id = a.id
               and k.status = 'active' and k.ends_on is not null and k.ends_on >= current_date)
             as contract_ending_days,
           (select current_date - max(i.inspected_on) from public.crm_wdo_inspections i
             where i.organization_id = a.organization_id and i.account_id = a.id and i.status = 'issued')
             as wdo_last_days,
           (select count(*) from public.crm_devices d
             where d.organization_id = a.organization_id and d.account_id = a.id and d.status = 'active')::integer
             as devices
      from scoped a
  ),
  applied as (
    select f.account_id, r.rule_key, r.label, r.points,
           -- (multiplier, fact): a rule applies when its multiplier is
           -- positive, and the fact is the specific sentence for THIS account.
           case r.rule_key
             when 'has_email' then case when f.has_email then 1 else 0 end
             when 'has_phone' then case when f.has_phone then 1 else 0 end
             when 'source_recorded' then case when f.source is not null then 1 else 0 end
             when 'commercial' then case when f.kind = 'commercial' then 1 else 0 end
             when 'service_locations' then least(f.locations, 4)
             when 'open_opportunity' then case when f.open_opportunities > 0 then 1 else 0 end
             when 'opportunity_value' then case when coalesce(f.open_opportunity_value, 0) >= 100000 then 1 else 0 end
             when 'estimate_sent' then case when f.estimate_sent then 1 else 0 end
             when 'portal_request' then case when f.portal_request then 1 else 0 end
             when 'activity_7d' then case when f.last_activity_days <= 7 then 1 else 0 end
             when 'activity_30d' then case when f.last_activity_days between 8 and 30 then 1 else 0 end
             when 'silent_30d' then case when f.last_activity_days is null or f.last_activity_days > 30 then 1 else 0 end
             when 'visit_overdue' then case when f.plan_overdue_days > 14 then 1 else 0 end
             when 'no_visit_90d' then case when f.active_plans > 0 and (f.last_completed_days is null or f.last_completed_days > 90) then 1 else 0 end
             when 'cancelled_visits_90d' then least(f.cancelled_90d, 3)
             when 'overdue_invoice' then case when f.overdue_cents > 0 then 1 else 0 end
             when 'unresolved_sighting' then case when f.unresolved_sightings > 0 then 1 else 0 end
             when 'contract_ending_60d' then case when f.contract_ending_days <= 60 then 1 else 0 end
             when 'request_unanswered' then case when f.request_unanswered then 1 else 0 end
             when 'silent_90d' then case when f.last_activity_days is null or f.last_activity_days > 90 then 1 else 0 end
             when 'location_without_plan' then case when f.locations_without_plan > 0 then 1 else 0 end
             when 'sighting_without_plan' then case when f.sightings_without_plan > 0 then 1 else 0 end
             when 'wdo_stale' then case when f.wdo_last_days is null or f.wdo_last_days > 365 then 1 else 0 end
             when 'estimate_accepted_no_contract' then case when f.estimate_accepted_recent and not f.contract_active then 1 else 0 end
             when 'contract_renewal_90d' then case when f.contract_ending_days <= 90 then 1 else 0 end
             when 'one_off_visits' then case when f.one_off_visits_6m >= 3 then 1 else 0 end
             when 'commercial_without_ipm' then case when f.kind = 'commercial' and f.devices = 0 then 1 else 0 end
             else 0
           end as multiplier,
           case r.rule_key
             when 'has_email' then 'Email on file'
             when 'has_phone' then 'Phone on file'
             when 'source_recorded' then format('Source: %s', f.source)
             when 'commercial' then 'Commercial account'
             when 'service_locations' then format('%s service location%s on file', f.locations, case when f.locations = 1 then '' else 's' end)
             when 'open_opportunity' then format('%s open opportunit%s', f.open_opportunities, case when f.open_opportunities = 1 then 'y' else 'ies' end)
             when 'opportunity_value' then format('An open opportunity worth $%s', to_char(coalesce(f.open_opportunity_value, 0) / 100.0, 'FM999,999,999,990.00'))
             when 'estimate_sent' then 'An estimate is out, undecided'
             when 'portal_request' then 'Asked for service through the portal'
             when 'activity_7d' then format('Activity %s day%s ago', f.last_activity_days, case when f.last_activity_days = 1 then '' else 's' end)
             when 'activity_30d' then format('Last activity %s days ago', f.last_activity_days)
             when 'silent_30d' then case when f.last_activity_days is null then 'No activity ever recorded' else format('No activity in %s days', f.last_activity_days) end
             when 'visit_overdue' then format('An active plan is %s days past due', f.plan_overdue_days)
             when 'no_visit_90d' then case when f.last_completed_days is null then 'An active plan with no completed visit on record' else format('Last completed visit %s days ago', f.last_completed_days) end
             when 'cancelled_visits_90d' then format('%s cancelled visit%s in 90 days', f.cancelled_90d, case when f.cancelled_90d = 1 then '' else 's' end)
             when 'overdue_invoice' then format('$%s past due', to_char(f.overdue_cents / 100.0, 'FM999,999,999,990.00'))
             when 'unresolved_sighting' then format('%s sighting%s without corrective action', f.unresolved_sightings, case when f.unresolved_sightings = 1 then '' else 's' end)
             when 'contract_ending_60d' then format('A contract ends in %s days', f.contract_ending_days)
             when 'request_unanswered' then 'A portal request is waiting for an answer'
             when 'silent_90d' then case when f.last_activity_days is null then 'No activity ever recorded' else format('No activity in %s days', f.last_activity_days) end
             when 'location_without_plan' then format('%s of %s location%s ha%s no active plan', f.locations_without_plan, f.locations, case when f.locations = 1 then '' else 's' end, case when f.locations_without_plan = 1 then 's' else 've' end)
             when 'sighting_without_plan' then format('%s sighting%s (%s) at a location with no active plan', f.sightings_without_plan, case when f.sightings_without_plan = 1 then '' else 's' end, f.sighting_without_plan_pest)
             when 'wdo_stale' then case when f.wdo_last_days is null then 'No WDO inspection has been issued' else format('Last WDO inspection issued %s days ago', f.wdo_last_days) end
             when 'estimate_accepted_no_contract' then 'An estimate was accepted in the last 180 days; no contract is active'
             when 'contract_renewal_90d' then format('A contract ends in %s days', f.contract_ending_days)
             when 'one_off_visits' then format('%s one-off visits in six months', f.one_off_visits_6m)
             when 'commercial_without_ipm' then 'Commercial account with no active monitoring stations'
             else ''
           end as fact
      from facts f
     cross join rules r
  )
  select f.account_id,
         coalesce((select sum(x.points * x.multiplier) from applied x
                    where x.account_id = f.account_id and x.multiplier > 0), 0)::integer as score,
         coalesce((select jsonb_agg(jsonb_build_object(
                             'rule', x.rule_key, 'label', x.label,
                             'points', x.points * x.multiplier, 'fact', x.fact)
                           order by abs(x.points * x.multiplier) desc, x.rule_key)
                     from applied x
                    where x.account_id = f.account_id and x.multiplier > 0), '[]'::jsonb) as breakdown
    from facts f
   order by 2 desc, 1;
$$;

revoke all on function public.crm_score_accounts(uuid, public.crm_scoring_model)
  from public, anon, service_role;
grant execute on function public.crm_score_accounts(uuid, public.crm_scoring_model) to authenticated;

-- ---------------------------------------------------------------------------
-- Assignment with its reason.
--
-- The postal code is read from the billing address: the LAST five-digit
-- group in it, because "Suite 1200, 4100 Cannery Row, Monterey 93940"
-- carries a number that is not a postal code before the one that is.
-- A territory is matched only on its declared coverage, never on a city
-- name, and only an ACTIVE one; the first by code wins so the choice is
-- deterministic and can be read back.
-- ---------------------------------------------------------------------------

create or replace function public.crm_territory_for_address(
  p_organization uuid,
  p_address text
)
returns table (
  territory_id uuid,
  branch_id uuid,
  rep_id uuid,
  code text,
  name text,
  postal_code text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with zip as (
    select r.m[1] as postal_code
      from regexp_matches(coalesce(p_address, ''), '(?:^|[^0-9])([0-9]{5})(?:-[0-9]{4})?(?:[^0-9]|$)', 'g')
             with ordinality as r(m, n)
     order by r.n desc
     limit 1
  )
  select t.id, t.branch_id, t.rep_id, t.code, t.name, z.postal_code
    from zip z
    join public.crm_territories t
      on t.organization_id = p_organization
     and t.active
     and z.postal_code = any(t.postal_codes)
   order by t.code
   limit 1;
$$;

revoke all on function public.crm_territory_for_address(uuid, text)
  from public, anon, service_role;
grant execute on function public.crm_territory_for_address(uuid, text) to authenticated;

-- On creation. AFTER INSERT so the account is real when the history line
-- is written; the same definer pattern as status changes. Only fills what
-- the caller left blank — a territory somebody chose on purpose stays.
create or replace function public.crm_account_assign_on_create()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_match record;
begin
  if new.territory_id is not null then
    return new;
  end if;
  select * into v_match
    from public.crm_territory_for_address(new.organization_id, new.billing_address);
  if v_match.territory_id is null then
    return new;
  end if;

  update public.crm_accounts a
     set territory_id = v_match.territory_id,
         branch_id = coalesce(a.branch_id, v_match.branch_id),
         owner_employee_id = coalesce(a.owner_employee_id, v_match.rep_id)
   where a.id = new.id;

  insert into public.crm_timeline_events
    (organization_id, account_id, kind, summary, actor_user_id)
  values (
    new.organization_id,
    new.id,
    'note',
    left(format('Assigned to territory %s (%s) by postal code %s.', v_match.name, v_match.code, v_match.postal_code), 300),
    auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.crm_account_assign_on_create()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_accounts_assign_on_create on public.crm_accounts;
create trigger crm_accounts_assign_on_create
  after insert on public.crm_accounts
  for each row execute function public.crm_account_assign_on_create();

-- The backfill: every account with no territory, matched the same way.
-- INVOKER — the caller updates rows they may update and writes history
-- lines as themselves. Returns how many were assigned.
create or replace function public.crm_assign_accounts_by_postal(p_organization uuid)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_account record;
  v_match record;
  v_count integer := 0;
begin
  for v_account in
    select a.id, a.billing_address
      from public.crm_accounts a
     where a.organization_id = p_organization
       and a.territory_id is null
       and a.billing_address is not null
     order by a.created_at
  loop
    select * into v_match
      from public.crm_territory_for_address(p_organization, v_account.billing_address);
    if v_match.territory_id is null then
      continue;
    end if;
    update public.crm_accounts a
       set territory_id = v_match.territory_id,
           branch_id = coalesce(a.branch_id, v_match.branch_id),
           owner_employee_id = coalesce(a.owner_employee_id, v_match.rep_id)
     where a.organization_id = p_organization and a.id = v_account.id;
    insert into public.crm_timeline_events
      (organization_id, account_id, kind, summary, actor_user_id)
    values (
      p_organization,
      v_account.id,
      'note',
      left(format('Assigned to territory %s (%s) by postal code %s.', v_match.name, v_match.code, v_match.postal_code), 300),
      auth.uid()
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.crm_assign_accounts_by_postal(uuid)
  from public, anon, service_role;
grant execute on function public.crm_assign_accounts_by_postal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. REVOKE first: hosted default privileges grant ALL.
-- Overrides are working configuration: a member may set, change and
-- delete them (deleting is resetting to the default).
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_scoring_rules enable row level security';
  execute 'alter table public.crm_scoring_rules force row level security';
  execute 'revoke all on table public.crm_scoring_rules
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_scoring_rules_select_member on public.crm_scoring_rules';
  execute 'create policy crm_scoring_rules_select_member on public.crm_scoring_rules
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_scoring_rules_insert_member on public.crm_scoring_rules';
  execute 'create policy crm_scoring_rules_insert_member on public.crm_scoring_rules
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_scoring_rules_update_member on public.crm_scoring_rules';
  execute 'create policy crm_scoring_rules_update_member on public.crm_scoring_rules
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_scoring_rules_delete_member on public.crm_scoring_rules';
  execute 'create policy crm_scoring_rules_delete_member on public.crm_scoring_rules
             for delete to authenticated using (public.is_organization_member(organization_id))';
  execute 'grant select, insert, update, delete on table public.crm_scoring_rules to authenticated';
end;
$$;
