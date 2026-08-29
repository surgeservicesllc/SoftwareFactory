-- Billing foundation: organizations can pay for the plans the pricing page
-- already advertises.
--
-- The storefront predates this file: marketing_pricing_plans has carried
-- Free / Basic / Pro / Enterprise with real prices since 20260813000500, and
-- every "Start Free Trial" button has pointed at /sign-in with nothing behind
-- it. This migration adds the state that makes those buttons honest:
--
--   billing_customers      one Stripe customer per organization
--   billing_subscriptions  the organization's current paid plan, mirrored
--                          from Stripe by the webhook
--   billing_events         every webhook delivery, unique by Stripe event id,
--                          so replays are idempotent and the trail is auditable
--
-- Two writers, deliberately separated:
--   * the checkout route (a signed-in owner/admin) may only record the
--     customer mapping, through ensure_billing_customer below;
--   * the Stripe webhook (service_role, no user session) mirrors subscription
--     state. authenticated holds zero write grants on subscription rows —
--     a browser cannot promote its own organization.
--
-- No credential, secret, or webhook signing key is stored here. Stripe ids
-- (cus_*, sub_*, evt_*) are references to server-side state, not secrets.

-- ---------------------------------------------------------------------------
-- Status vocabulary: Stripe's own, so the mirror never has to translate.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.billing_subscription_status as enum (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused'
  );
exception when duplicate_object then null; end $$;

alter type public.activity_event_type add value if not exists 'billing.customer_linked';
alter type public.activity_event_type add value if not exists 'billing.subscription_changed';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.billing_customers (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,64}$'),
  -- The plan key is the marketing slug the customer bought (basic, pro).
  -- 'free' never appears here: free is the absence of a subscription.
  plan_key text not null check (plan_key ~ '^[a-z][a-z0-9-]{0,40}$'),
  status public.billing_subscription_status not null,
  cadence text not null check (cadence in ('monthly', 'yearly')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_subscriptions_org_idx
  on public.billing_subscriptions (organization_id, updated_at desc);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique check (stripe_event_id ~ '^evt_[A-Za-z0-9]{1,64}$'),
  event_type text not null check (char_length(event_type) between 1 and 100),
  organization_id uuid references public.organizations(id) on delete set null,
  -- A short human summary, never the raw payload: Stripe payloads carry
  -- customer email and card metadata that have no business in this table.
  summary text not null check (char_length(summary) between 1 and 500),
  received_at timestamptz not null default now()
);

create index if not exists billing_events_org_idx
  on public.billing_events (organization_id, received_at desc)
  where organization_id is not null;

-- ---------------------------------------------------------------------------
-- Row security. Members see their organization's billing state; nobody
-- writes through PostgREST as a browser role. The webhook writes as
-- service_role, which passes policies but must still hold table grants.
-- ---------------------------------------------------------------------------
alter table public.billing_customers enable row level security;
alter table public.billing_customers force row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_subscriptions force row level security;
alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;

drop policy if exists billing_customers_select_members on public.billing_customers;
create policy billing_customers_select_members
  on public.billing_customers for select
  using (public.is_organization_member(organization_id));

drop policy if exists billing_subscriptions_select_members on public.billing_subscriptions;
create policy billing_subscriptions_select_members
  on public.billing_subscriptions for select
  using (public.is_organization_member(organization_id));

drop policy if exists billing_events_select_managers on public.billing_events;
create policy billing_events_select_managers
  on public.billing_events for select
  using (organization_id is not null and public.can_manage_organization(organization_id));

revoke all on public.billing_customers from anon, authenticated;
grant select on public.billing_customers to authenticated;
revoke all on public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;
revoke all on public.billing_events from anon, authenticated;
grant select on public.billing_events to authenticated;

grant select, insert, update on public.billing_customers to service_role;
grant select, insert, update on public.billing_subscriptions to service_role;
grant select, insert on public.billing_events to service_role;

-- The webhook's audit trail goes through a definer function rather than a
-- table grant: activity_events keeps zero service_role privileges, the same
-- posture every other audited surface holds.
create or replace function public.record_billing_activity(
  p_organization_id uuid,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_organization_id is null then
    raise exception 'An audit event needs its organization.' using errcode = '22004';
  end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 500 then
    raise exception 'An audit event needs a description of at most 500 characters.'
      using errcode = '22000';
  end if;
  insert into public.activity_events
    (organization_id, event_type, entity_type, description, metadata)
  values
    (p_organization_id, 'billing.subscription_changed', 'billing_subscription',
     btrim(p_description), '{}'::jsonb);
end;
$function$;

revoke all on function public.record_billing_activity(uuid, text) from public, anon, authenticated;
grant execute on function public.record_billing_activity(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- ensure_billing_customer: the one write a signed-in caller may make.
-- Owner/admin only, own organization only, insert-once: a second call with a
-- different Stripe customer id is a conflict, not an overwrite — remapping an
-- organization to a new customer is a support operation, not a button.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_billing_customer(
  p_organization_id uuid,
  p_stripe_customer_id text
)
returns public.billing_customers
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_row public.billing_customers;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception 'Only an organization owner or administrator can start billing.'
      using errcode = '42501';
  end if;
  if p_stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,64}$' then
    raise exception 'The Stripe customer reference is not well formed.'
      using errcode = '22000';
  end if;

  insert into public.billing_customers (organization_id, stripe_customer_id, created_by)
  values (p_organization_id, p_stripe_customer_id, auth.uid())
  on conflict (organization_id) do update
    set updated_at = now()
    where public.billing_customers.stripe_customer_id = excluded.stripe_customer_id
  returning * into v_row;

  if v_row.organization_id is null then
    raise exception 'This organization is already linked to a different billing customer.'
      using errcode = '23505';
  end if;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values
    (p_organization_id, auth.uid(), 'billing.customer_linked', 'billing_customer',
     p_organization_id, 'Billing customer linked for this organization.', '{}'::jsonb)
  on conflict do nothing;

  return v_row;
end;
$function$;

revoke all on function public.ensure_billing_customer(uuid, text) from public, anon, service_role;
grant execute on function public.ensure_billing_customer(uuid, text) to authenticated;
