-- Services CRM increment 3: field service core (task #63, owner /goal —
-- ADR-189). Technicians, work orders, and recurring service plans, on the
-- foundation's exact posture: org-scoped forced RLS, composite same-org
-- foreign keys, anon/service_role revoked, grants stated revoke-then-grant
-- against hosted default privileges.
--
-- The audit spine grows its first real 'service' writer: completing a work
-- order writes the service event onto the account timeline through a
-- SECURITY DEFINER trigger, in the same transaction — the system kind the
-- manual route refuses finally has its reviewed machinery. Cancellations
-- are recorded too; mere dispatch progress is not noise the history needs.
--
-- Deliberate absences, stated as missing grants:
--   - No DELETE on technicians: service history hangs off them; a departed
--     technician is marked inactive, never erased from the audit trail.
--   - No DELETE on work orders or plans: a visit that did not happen is
--     cancelled, and the cancellation is itself history.
--
-- Same-account integrity: a work order's property must belong to the work
-- order's account, in the same organization — enforced by a three-column
-- composite foreign key, so a route bug cannot schedule service at another
-- customer's site.

do $$ begin
  create type public.crm_work_order_status as enum (
    'scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_service_recurrence as enum (
    'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Technicians: the people who perform service. license_number feeds the
-- compliance increment's applicator/license reporting.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_technicians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 100),
  email text check (email is null or (position('@' in email) > 1 and char_length(email) between 3 and 320)),
  phone text check (phone is null or phone ~ '^[0-9+() .\-]{7,32}$'),
  license_number text check (license_number is null or char_length(btrim(license_number)) between 1 and 120),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_technicians_license_no_secret check (not public.text_has_likely_secret(license_number))
);

create unique index if not exists crm_technicians_org_id_key
  on public.crm_technicians (organization_id, id);

-- The three-column key work orders and plans hang their same-account
-- property integrity on.
create unique index if not exists crm_properties_org_account_id_key
  on public.crm_properties (organization_id, account_id, id);

-- ---------------------------------------------------------------------------
-- Service plans: the recurring agreement. A plan does not perform service —
-- it says when the next visit is due; generating a visit creates a work
-- order and advances next_due by the recurrence.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_service_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  service_type text not null check (char_length(btrim(service_type)) between 1 and 120),
  recurrence public.crm_service_recurrence not null,
  next_due date not null,
  technician_id uuid,
  value_cents bigint check (value_cents is null or value_cents between 0 and 100000000000),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_service_plans_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  constraint crm_service_plans_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete set null,
  constraint crm_service_plans_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_service_plans_org_id_key
  on public.crm_service_plans (organization_id, id);

-- ---------------------------------------------------------------------------
-- Work orders: one scheduled visit. completed_at is maintained by trigger
-- and CHECKed against the status, exactly as opportunities' closed_at is —
-- completion reporting can never disagree with the status column.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  technician_id uuid,
  plan_id uuid,
  status public.crm_work_order_status not null default 'scheduled',
  service_type text not null check (char_length(btrim(service_type)) between 1 and 120),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  instructions text check (instructions is null or char_length(instructions) between 1 and 2000),
  completion_notes text check (completion_notes is null or char_length(completion_notes) between 1 and 3500),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_work_orders_window check (scheduled_end > scheduled_start),
  constraint crm_work_orders_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  constraint crm_work_orders_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete set null,
  constraint crm_work_orders_plan_same_org
    foreign key (organization_id, plan_id)
    references public.crm_service_plans (organization_id, id) on delete set null,
  constraint crm_work_orders_completed_iff_timestamp
    check ((status = 'completed') = (completed_at is not null)),
  constraint crm_work_orders_instructions_no_secret check (not public.text_has_likely_secret(instructions)),
  constraint crm_work_orders_completion_no_secret check (not public.text_has_likely_secret(completion_notes))
);

-- completed_at follows the status, on insert and on every move.
create or replace function public.crm_work_order_set_completed_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_work_order_set_completed_at()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_work_orders_set_completed_at on public.crm_work_orders;
create trigger crm_work_orders_set_completed_at
  before insert or update on public.crm_work_orders
  for each row execute function public.crm_work_order_set_completed_at();

-- The audit spine's first real 'service' writer: completion lands on the
-- account timeline in the same transaction, naming the site in detail where
-- 4000 characters fit; a cancellation is recorded as the status change it
-- is. Same-stage progress (dispatched, in progress) is not history.
create or replace function public.crm_record_work_order_outcome()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_property_label text;
begin
  if new.status is distinct from old.status and new.status in ('completed', 'cancelled') then
    select label into v_property_label
      from public.crm_properties where id = new.property_id;
    insert into public.crm_timeline_events
      (organization_id, account_id, kind, summary, detail, actor_user_id)
    values (
      new.organization_id,
      new.account_id,
      case when new.status = 'completed' then 'service'::public.crm_timeline_kind
           else 'status_change'::public.crm_timeline_kind end,
      case when new.status = 'completed'
           then format('Service completed: %s.', new.service_type)
           else format('Work order cancelled: %s.', new.service_type) end,
      nullif(concat_ws(' ',
        case when v_property_label is not null then format('Property: %s.', v_property_label) end,
        new.completion_notes), ''),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.crm_record_work_order_outcome()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_work_orders_outcome on public.crm_work_orders;
create trigger crm_work_orders_outcome
  after update on public.crm_work_orders
  for each row execute function public.crm_record_work_order_outcome();

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_technicians', 'crm_service_plans', 'crm_work_orders'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants: the foundation's posture, revoke-then-grant
-- because hosted default privileges granted ALL at creation. select, insert
-- and update for members; DELETE is granted to no one.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_technicians', 'crm_service_plans', 'crm_work_orders'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select, insert, update on table public.%I to authenticated', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_member', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id))',
      v_table || '_select_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_member', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id))',
      v_table || '_insert_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes: the dispatch board's reads.
-- ---------------------------------------------------------------------------

create index if not exists crm_work_orders_org_status_start_idx
  on public.crm_work_orders (organization_id, status, scheduled_start);
create index if not exists crm_work_orders_org_technician_idx
  on public.crm_work_orders (organization_id, technician_id, scheduled_start);
create index if not exists crm_work_orders_org_account_idx
  on public.crm_work_orders (organization_id, account_id);
create index if not exists crm_service_plans_org_due_idx
  on public.crm_service_plans (organization_id, active, next_due);
create index if not exists crm_service_plans_org_account_idx
  on public.crm_service_plans (organization_id, account_id);
create index if not exists crm_technicians_org_active_idx
  on public.crm_technicians (organization_id, active);
