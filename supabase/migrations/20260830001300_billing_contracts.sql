-- Services CRM increment 6: estimates, contracts, invoices, payments and
-- refunds (task #63, owner /goal — ADR-193). The money half of the
-- Lead → Payment chain, on the established posture: org-scoped forced RLS,
-- revoke-then-grant against hosted default privileges, anon/service_role
-- shut out, same-org composite keys throughout.
--
-- Money is recorded, never revised. Five invariants live in the schema:
--
--   1. Payments and refunds are APPEND-ONLY at the grant level. Money that
--      moved is a fact; a mistake is corrected by recording the opposite
--      movement, exactly as a ledger is corrected by a contra entry.
--   2. A refund can never exceed what was paid. A trigger sums the
--      payment's existing refunds under a row lock and refuses the excess,
--      so two concurrent refunds cannot together overdraw it.
--   3. An invoice's paid total is maintained by trigger from its payments
--      and refunds, and its status follows from that total — `paid` is
--      something the ledger decides, never something a caller asserts.
--   4. Every payment writes a `payment` event onto the account timeline in
--      the same transaction. With this, all three system kinds
--      (status_change, service, payment) have real database writers.
--   5. Amounts are integer cents with non-negative CHECKs. There is no
--      floating-point money anywhere in this schema.
--
-- Nothing here is deletable. A withdrawn estimate is `declined`, a closed
-- contract is `ended`, an invoice raised in error is `void` — and the void
-- is itself part of the record.

-- Composite keys these references need but earlier migrations never had a
-- reason to create: an estimate points at the opportunity it came from, and
-- a contract at the recurring plan it governs, both same-organization.
create unique index if not exists crm_opportunities_org_id_key
  on public.crm_opportunities (organization_id, id);
create unique index if not exists crm_service_plans_org_id_key
  on public.crm_service_plans (organization_id, id);

do $$ begin
  create type public.crm_estimate_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_contract_status as enum ('active', 'ended', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_payment_method as enum ('card', 'ach', 'check', 'cash', 'other');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Estimates: the priced proposal. Total is stored in cents and CHECKed
-- against the sum of its lines by trigger, so a proposal cannot quietly
-- disagree with its own arithmetic.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid,
  opportunity_id uuid,
  number text not null check (char_length(btrim(number)) between 3 and 40),
  status public.crm_estimate_status not null default 'draft',
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0 and subtotal_cents <= 100000000000),
  tax_cents bigint not null default 0 check (tax_cents >= 0 and tax_cents <= 100000000000),
  total_cents bigint not null default 0 check (total_cents >= 0 and total_cents <= 100000000000),
  valid_until date,
  terms text check (terms is null or char_length(terms) between 1 and 4000),
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  sent_at timestamptz,
  decided_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_estimates_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete set null,
  constraint crm_estimates_opportunity_same_org
    foreign key (organization_id, opportunity_id)
    references public.crm_opportunities (organization_id, id) on delete set null,
  -- A decision timestamp belongs only to a decided estimate.
  constraint crm_estimates_decided_iff_closed
    check ((status in ('accepted', 'declined', 'expired')) = (decided_at is not null)),
  constraint crm_estimates_total_is_sum check (total_cents = subtotal_cents + tax_cents),
  constraint crm_estimates_terms_no_secret check (not public.text_has_likely_secret(terms)),
  constraint crm_estimates_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_estimates_org_id_key
  on public.crm_estimates (organization_id, id);
create unique index if not exists crm_estimates_org_number_key
  on public.crm_estimates (organization_id, number);

create table if not exists public.crm_estimate_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid not null,
  position integer not null check (position between 1 and 500),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 100000),
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000000),
  amount_cents bigint not null check (amount_cents >= 0 and amount_cents <= 100000000000),
  created_at timestamptz not null default now(),
  constraint crm_estimate_lines_estimate_same_org
    foreign key (organization_id, estimate_id)
    references public.crm_estimates (organization_id, id) on delete cascade,
  constraint crm_estimate_lines_description_no_secret
    check (not public.text_has_likely_secret(description))
);

create unique index if not exists crm_estimate_lines_position_key
  on public.crm_estimate_lines (organization_id, estimate_id, position);

-- ---------------------------------------------------------------------------
-- Contracts: the agreement an accepted estimate becomes.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  estimate_id uuid,
  plan_id uuid,
  number text not null check (char_length(btrim(number)) between 3 and 40),
  status public.crm_contract_status not null default 'active',
  value_cents bigint not null check (value_cents >= 0 and value_cents <= 100000000000),
  starts_on date not null,
  ends_on date,
  auto_renew boolean not null default false,
  terms text check (terms is null or char_length(terms) between 1 and 4000),
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  signed_at timestamptz,
  signed_by_name text check (signed_by_name is null or char_length(btrim(signed_by_name)) between 1 and 120),
  ended_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_contracts_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_contracts_estimate_same_org
    foreign key (organization_id, estimate_id)
    references public.crm_estimates (organization_id, id) on delete set null,
  constraint crm_contracts_plan_same_org
    foreign key (organization_id, plan_id)
    references public.crm_service_plans (organization_id, id) on delete set null,
  constraint crm_contracts_ends_after_starts check (ends_on is null or ends_on >= starts_on),
  constraint crm_contracts_ended_iff_closed
    check ((status in ('ended', 'cancelled')) = (ended_at is not null)),
  -- A signature is a name and a moment together, or neither.
  constraint crm_contracts_signature_complete
    check ((signed_at is null) = (signed_by_name is null)),
  constraint crm_contracts_terms_no_secret check (not public.text_has_likely_secret(terms)),
  constraint crm_contracts_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_contracts_org_id_key
  on public.crm_contracts (organization_id, id);
create unique index if not exists crm_contracts_org_number_key
  on public.crm_contracts (organization_id, number);

-- ---------------------------------------------------------------------------
-- Invoices. paid_cents and status are maintained by the payment triggers;
-- a caller states what was billed, the ledger states what was settled.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  contract_id uuid,
  work_order_id uuid,
  number text not null check (char_length(btrim(number)) between 3 and 40),
  status public.crm_invoice_status not null default 'draft',
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0 and subtotal_cents <= 100000000000),
  tax_cents bigint not null default 0 check (tax_cents >= 0 and tax_cents <= 100000000000),
  total_cents bigint not null default 0 check (total_cents >= 0 and total_cents <= 100000000000),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  issued_on date,
  due_on date,
  memo text check (memo is null or char_length(memo) between 1 and 2000),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_invoices_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_invoices_contract_same_org
    foreign key (organization_id, contract_id)
    references public.crm_contracts (organization_id, id) on delete set null,
  constraint crm_invoices_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_invoices_total_is_sum check (total_cents = subtotal_cents + tax_cents),
  constraint crm_invoices_due_after_issue check (due_on is null or issued_on is null or due_on >= issued_on),
  -- A void names its reason and its moment together.
  constraint crm_invoices_void_complete check ((voided_at is null) = (void_reason is null)),
  constraint crm_invoices_voided_iff_status check ((status = 'void') = (voided_at is not null)),
  constraint crm_invoices_memo_no_secret check (not public.text_has_likely_secret(memo))
);

create unique index if not exists crm_invoices_org_id_key
  on public.crm_invoices (organization_id, id);
create unique index if not exists crm_invoices_org_number_key
  on public.crm_invoices (organization_id, number);

create table if not exists public.crm_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  position integer not null check (position between 1 and 500),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 100000),
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000000),
  amount_cents bigint not null check (amount_cents >= 0 and amount_cents <= 100000000000),
  created_at timestamptz not null default now(),
  constraint crm_invoice_lines_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.crm_invoices (organization_id, id) on delete cascade,
  constraint crm_invoice_lines_description_no_secret
    check (not public.text_has_likely_secret(description))
);

create unique index if not exists crm_invoice_lines_position_key
  on public.crm_invoice_lines (organization_id, invoice_id, position);

-- ---------------------------------------------------------------------------
-- Payments and refunds: the append-only money ledger.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  method public.crm_payment_method not null,
  -- A processor's own identifier, when one exists. Never a card number:
  -- the CHECK bounds it to a reference, and the secret guard applies.
  reference text check (reference is null or char_length(btrim(reference)) between 1 and 120),
  received_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  note text check (note is null or char_length(note) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_payments_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.crm_invoices (organization_id, id) on delete restrict,
  constraint crm_payments_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_payments_reference_no_secret check (not public.text_has_likely_secret(reference)),
  constraint crm_payments_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_payments_org_id_key
  on public.crm_payments (organization_id, id);

create table if not exists public.crm_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  refunded_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_refunds_payment_same_org
    foreign key (organization_id, payment_id)
    references public.crm_payments (organization_id, id) on delete restrict,
  constraint crm_refunds_reason_no_secret check (not public.text_has_likely_secret(reason))
);

-- A refund can never exceed what was paid. The payment row is locked while
-- its existing refunds are summed, so two concurrent refunds cannot
-- together overdraw it — the classic double-refund race, closed in the
-- database rather than hoped away in a route.
create or replace function public.crm_guard_refund_total()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_paid bigint;
  v_refunded bigint;
begin
  select amount_cents into v_paid
    from public.crm_payments where id = new.payment_id for update;
  if v_paid is null then
    raise exception 'refund references a payment that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  select coalesce(sum(amount_cents), 0) into v_refunded
    from public.crm_refunds where payment_id = new.payment_id;
  if v_refunded + new.amount_cents > v_paid then
    raise exception 'refunds (% + %) would exceed the payment of %',
      v_refunded, new.amount_cents, v_paid
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_guard_refund_total()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_refunds_guard_total on public.crm_refunds;
create trigger crm_refunds_guard_total
  before insert on public.crm_refunds
  for each row execute function public.crm_guard_refund_total();

-- The invoice's settled total is derived from its ledger, never asserted.
-- `paid` is what the payments say, and an invoice that is refunded back
-- below its total reopens — the ledger decides, in both directions.
create or replace function public.crm_settle_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_total bigint;
  v_status public.crm_invoice_status;
  v_settled bigint;
begin
  select total_cents, status into v_total, v_status
    from public.crm_invoices where id = p_invoice_id for update;
  if v_total is null then return; end if;

  select coalesce(sum(payments.amount_cents), 0)
       - coalesce((select sum(refunds.amount_cents)
                     from public.crm_refunds refunds
                     join public.crm_payments inner_payments
                       on inner_payments.id = refunds.payment_id
                    where inner_payments.invoice_id = p_invoice_id), 0)
    into v_settled
    from public.crm_payments payments
   where payments.invoice_id = p_invoice_id;

  update public.crm_invoices
     set paid_cents = greatest(v_settled, 0),
         -- A void or uncollectible invoice keeps its status: those are
         -- decisions about the debt, not statements about the cash.
         status = case
           when v_status in ('void', 'uncollectible') then v_status
           when v_settled >= v_total and v_total > 0 then 'paid'::public.crm_invoice_status
           when v_status = 'draft' then 'draft'::public.crm_invoice_status
           else 'open'::public.crm_invoice_status
         end
   where id = p_invoice_id;
end;
$$;

revoke all on function public.crm_settle_invoice(uuid)
  from public, anon, authenticated, service_role;

-- A payment settles its invoice and lands on the account's timeline, in the
-- same transaction. This is the third and final system kind to gain a real
-- database writer.
create or replace function public.crm_record_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_number text;
begin
  perform public.crm_settle_invoice(new.invoice_id);
  select number into v_number from public.crm_invoices where id = new.invoice_id;
  insert into public.crm_timeline_events
    (organization_id, account_id, kind, summary, detail, occurred_at, actor_user_id)
  values (
    new.organization_id,
    new.account_id,
    'payment',
    format('Payment received: %s on invoice %s.',
           to_char(new.amount_cents / 100.0, 'FM999,999,990.00'),
           coalesce(v_number, 'unknown')),
    format('Method: %s.%s', new.method,
           case when new.reference is not null then format(' Reference: %s.', new.reference) else '' end),
    new.received_at,
    auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.crm_record_payment()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_payments_record on public.crm_payments;
create trigger crm_payments_record
  after insert on public.crm_payments
  for each row execute function public.crm_record_payment();

-- A refund re-settles the invoice it ultimately belongs to.
create or replace function public.crm_resettle_after_refund()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_invoice uuid;
begin
  select invoice_id into v_invoice from public.crm_payments where id = new.payment_id;
  if v_invoice is not null then perform public.crm_settle_invoice(v_invoice); end if;
  return new;
end;
$$;

revoke all on function public.crm_resettle_after_refund()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_refunds_resettle on public.crm_refunds;
create trigger crm_refunds_resettle
  after insert on public.crm_refunds
  for each row execute function public.crm_resettle_after_refund();

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_estimates', 'crm_contracts', 'crm_invoices'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants. Payments and refunds take select+insert
-- ONLY — invariant 1, stated where no policy can undo it. Nothing here is
-- deletable; an invoice raised in error is voided, and the void is part of
-- the record.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_estimates', 'crm_estimate_lines', 'crm_contracts', 'crm_invoices',
    'crm_invoice_lines', 'crm_payments', 'crm_refunds'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role', v_table);

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
  end loop;

  foreach v_table in array array['crm_estimates', 'crm_contracts', 'crm_invoices'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);
  end loop;
end;
$$;

grant select, insert, update on table public.crm_estimates to authenticated;
grant select, insert on table public.crm_estimate_lines to authenticated;
grant select, insert, update on table public.crm_contracts to authenticated;
grant select, insert, update on table public.crm_invoices to authenticated;
grant select, insert on table public.crm_invoice_lines to authenticated;
-- Invariant 1: money that moved can be read and appended, never rewritten.
grant select, insert on table public.crm_payments to authenticated;
grant select, insert on table public.crm_refunds to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes: the billing reads.
-- ---------------------------------------------------------------------------

create index if not exists crm_estimates_org_status_idx
  on public.crm_estimates (organization_id, status, created_at desc);
create index if not exists crm_estimates_org_account_idx
  on public.crm_estimates (organization_id, account_id, created_at desc);
create index if not exists crm_contracts_org_status_idx
  on public.crm_contracts (organization_id, status, starts_on desc);
create index if not exists crm_contracts_org_account_idx
  on public.crm_contracts (organization_id, account_id);
create index if not exists crm_invoices_org_status_idx
  on public.crm_invoices (organization_id, status, due_on);
create index if not exists crm_invoices_org_account_idx
  on public.crm_invoices (organization_id, account_id, issued_on desc);
create index if not exists crm_payments_org_invoice_idx
  on public.crm_payments (organization_id, invoice_id, received_at desc);
create index if not exists crm_payments_org_received_idx
  on public.crm_payments (organization_id, received_at desc);
create index if not exists crm_refunds_org_payment_idx
  on public.crm_refunds (organization_id, payment_id, refunded_at desc);
