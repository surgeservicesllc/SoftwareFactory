-- ---------------------------------------------------------------------------
-- Increment 23 — autopay authorization (ADR-218).
--
-- "Autopay, stored payment methods, card + ACH" has sat at GAP with the
-- reason "the ledger records money that moved; it does not move money."
-- That is true of the CHARGE. It is the fourth time this week a real
-- blocker has been stretched to cover more than it does.
--
-- Moving money needs a processor. Everything that has to be true BEFORE
-- money moves does not, and in this particular feature that "everything"
-- is the legally significant half:
--
--   * WHICH instrument — brand, last four, expiry. Never the number.
--   * WHAT THE CUSTOMER AGREED TO, when, through which channel, in the
--     words they were shown. For an ACH debit this is a NACHA requirement,
--     and the business that cannot produce it loses the dispute.
--   * HOW MUCH they authorized, and on which day relative to the invoice.
--
-- A shop with all of that and no processor can still answer "did this
-- customer agree to be charged, for how much, and when?" — which is the
-- question that actually arrives, months later, by email from a bank.
--
-- THE ONE RULE THIS FILE EXISTS TO ENFORCE:
--
--   NOTHING HERE CAN SAY MONEY MOVED.
--
-- `succeeded` on a charge attempt is reachable only through
-- crm_autopay_record_settlement, which asks crm_integration_live(org,
-- 'card_payments') first, and members hold no UPDATE on the attempts
-- table. Same construction as ADR-217, for the same reason.
--
-- THE SECOND RULE:
--
--   A CARD NUMBER CANNOT BE STORED HERE, EVEN BY MISTAKE.
--
-- Not "we don't put it there" — the schema refuses it. Every free-text
-- column carries the secret guard, `last_four` is exactly four digits, and
-- a dedicated check rejects any run of 12-19 digits anywhere in the
-- holder name or the reference. This repository holds no PCI scope and
-- intends to keep it that way; the sealed vault (ADR-207 purposes) is
-- where a processor token belongs, and this table stores only its NAME.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_instrument_kind as enum ('card', 'bank_account');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_mandate_channel as enum ('web', 'phone', 'paper', 'in_person');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_charge_state as enum (
    -- Written, due, and nothing has taken it. Deliberately not 'pending':
    -- pending implies something is processing it, and nothing is.
    'scheduled',
    -- Reachable only through the settlement function, which requires a
    -- live card_payments provider. Unreachable while nothing is connected.
    'succeeded',
    'failed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- A PAN detector, in the same spirit as text_has_likely_secret.
--
-- Deliberately blunt: any run of 12 to 19 digits, ignoring the spaces and
-- dashes people type between groups. It will occasionally refuse a long
-- reference number, and that is the right trade — a false refusal costs
-- somebody a retype, while a false accept puts a card number in a database
-- dump and this repository into PCI scope.
-- ---------------------------------------------------------------------------

create or replace function public.text_has_likely_pan(input_text text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    pg_catalog.regexp_replace(coalesce(input_text, ''), '[ -]', '', 'g') ~ '[0-9]{12,19}',
    false
  );
$$;

revoke all on function public.text_has_likely_pan(text) from public;
grant execute on function public.text_has_likely_pan(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The instrument, as metadata. A connection record is metadata plus a
-- reference to server-side secret material; so is this.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_payment_instruments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,

  kind public.crm_instrument_kind not null,

  -- What a person needs to recognise it on a screen, and nothing more.
  display_brand text not null check (char_length(btrim(display_brand)) between 2 and 40),
  last_four text not null check (last_four ~ '^[0-9]{4}$'),

  -- Cards expire; bank accounts do not. Both columns or neither, and only
  -- on a card — a bank account carrying an expiry is a row somebody filled
  -- in from the wrong form.
  expires_month smallint check (expires_month between 1 and 12),
  expires_year smallint check (expires_year between 2020 and 2100),

  holder_name text check (holder_name is null or char_length(btrim(holder_name)) between 1 and 160),

  -- The vault purpose the processor's token is filed under. A NAME, not a
  -- token: `provider_credentials` holds the sealed envelope and no browser
  -- role can read it. Same discipline as crm_service_integrations.
  vault_purpose text not null
    check (vault_purpose ~ '^[a-z][a-z0-9_]{1,62}$')
    check (not public.text_has_likely_secret(vault_purpose)),

  added_at timestamptz not null default now(),
  -- Removing an instrument does not delete it: mandates and charge
  -- attempts point at it, and the history has to stay readable.
  removed_at timestamptz,
  removed_reason text
    check (removed_reason is null or char_length(btrim(removed_reason)) between 1 and 200),

  created_by uuid not null references auth.users(id) on delete restrict,

  constraint crm_payment_instruments_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,

  constraint crm_payment_instruments_expiry_iff_card
    check ((num_nonnulls(expires_month, expires_year) = 2) = (kind = 'card')),
  constraint crm_payment_instruments_removed_complete
    check ((removed_at is null) = (removed_reason is null)),

  -- The PAN refusals. Every column a person types into.
  constraint crm_payment_instruments_holder_no_pan
    check (not public.text_has_likely_pan(holder_name)),
  constraint crm_payment_instruments_brand_no_pan
    check (not public.text_has_likely_pan(display_brand)),
  constraint crm_payment_instruments_holder_no_secret
    check (not public.text_has_likely_secret(holder_name)),
  constraint crm_payment_instruments_brand_no_secret
    check (not public.text_has_likely_secret(display_brand)),
  constraint crm_payment_instruments_removed_no_secret
    check (not public.text_has_likely_secret(removed_reason))
);

create unique index if not exists crm_payment_instruments_org_id_key
  on public.crm_payment_instruments (organization_id, id);
create index if not exists crm_payment_instruments_org_account_idx
  on public.crm_payment_instruments (organization_id, account_id, added_at desc);

-- ---------------------------------------------------------------------------
-- THE MANDATE. The most important table in this file.
--
-- A charge without a recorded authorization is, from the bank's point of
-- view, a charge the customer did not agree to. What has to survive is not
-- "we ticked a box" but the WORDS THEY WERE SHOWN, frozen — because the
-- wording changes over time and the question is always what the wording
-- said on the day they agreed.
--
-- Append-only for everybody, exactly like a filed service document
-- (ADR-216): a mandate that can be edited afterwards is not evidence.
-- Withdrawing one is a new fact recorded elsewhere, not an edit here.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_payment_mandates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  instrument_id uuid not null,

  channel public.crm_mandate_channel not null,
  -- The customer's own words-in-agreement, as shown. Frozen.
  agreement_text text not null check (char_length(btrim(agreement_text)) between 20 and 4000),
  -- Which revision of the wording this was, so a shop can find every
  -- mandate taken under a version it later had to change.
  agreement_version text not null check (char_length(btrim(agreement_version)) between 1 and 40),

  -- Who agreed, in their own words on the day — a name typed into a form,
  -- not a foreign key, because the person who authorizes may not be a user
  -- of anything.
  authorized_by_name text not null check (char_length(btrim(authorized_by_name)) between 1 and 160),
  authorized_at timestamptz not null,

  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),

  constraint crm_payment_mandates_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_payment_mandates_instrument_same_org
    foreign key (organization_id, instrument_id)
    references public.crm_payment_instruments (organization_id, id) on delete cascade,

  -- Recording it later than it happened is normal — a paper form arrives in
  -- the post. Recording it BEFORE it happened is not.
  constraint crm_payment_mandates_recorded_after_authorized
    check (recorded_at >= authorized_at - interval '1 minute'),

  constraint crm_payment_mandates_name_no_pan
    check (not public.text_has_likely_pan(authorized_by_name)),
  constraint crm_payment_mandates_agreement_no_pan
    check (not public.text_has_likely_pan(agreement_text)),
  constraint crm_payment_mandates_agreement_no_secret
    check (not public.text_has_likely_secret(agreement_text)),
  constraint crm_payment_mandates_name_no_secret
    check (not public.text_has_likely_secret(authorized_by_name))
);

create unique index if not exists crm_payment_mandates_org_id_key
  on public.crm_payment_mandates (organization_id, id);
create index if not exists crm_payment_mandates_org_account_idx
  on public.crm_payment_mandates (organization_id, account_id, authorized_at desc);

-- ---------------------------------------------------------------------------
-- The enrollment: what the customer signed up for.
--
-- `max_amount_cents` is the cap they authorized, and it is the reason this
-- table is not just a boolean on the account. "Charge me automatically" is
-- not consent to charge any amount; a plan that quietly doubles must stop
-- at the ceiling and be looked at by a person.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_autopay_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  instrument_id uuid not null,
  -- The mandate this enrollment rests on. NOT NULL: an enrollment without a
  -- recorded authorization is precisely the row that loses the dispute.
  mandate_id uuid not null,

  -- Null means every invoice for the account; set means this plan only.
  plan_id uuid,

  -- Days after the invoice's due date. 0 charges on the day it falls due.
  charge_offset_days smallint not null default 0 check (charge_offset_days between 0 and 30),
  -- The ceiling the customer agreed to, per charge.
  max_amount_cents bigint not null check (max_amount_cents > 0 and max_amount_cents <= 100000000000),

  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text
    check (revoke_reason is null or char_length(btrim(revoke_reason)) between 1 and 200),

  created_by uuid not null references auth.users(id) on delete restrict,

  constraint crm_autopay_enrollments_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_autopay_enrollments_instrument_same_org
    foreign key (organization_id, instrument_id)
    references public.crm_payment_instruments (organization_id, id) on delete cascade,
  constraint crm_autopay_enrollments_mandate_same_org
    foreign key (organization_id, mandate_id)
    references public.crm_payment_mandates (organization_id, id) on delete restrict,
  constraint crm_autopay_enrollments_plan_same_org
    foreign key (organization_id, plan_id)
    references public.crm_service_plans (organization_id, id) on delete cascade,

  constraint crm_autopay_enrollments_revoked_complete
    check ((revoked_at is null) = (revoke_reason is null)),
  constraint crm_autopay_enrollments_reason_no_secret
    check (not public.text_has_likely_secret(revoke_reason))
);

create unique index if not exists crm_autopay_enrollments_org_id_key
  on public.crm_autopay_enrollments (organization_id, id);

-- One live enrollment per account per plan. Two would race to charge the
-- same invoice twice. The sentinel stands in for "the whole account",
-- because a null never collides with itself in a unique index.
create unique index if not exists crm_autopay_enrollments_one_live_key
  on public.crm_autopay_enrollments (
    organization_id, account_id, coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- The attempt. Append-only, and the state that means money moved is
-- unreachable without a connected processor.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_charge_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null,
  invoice_id uuid not null,

  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  scheduled_on date not null,
  state public.crm_charge_state not null default 'scheduled',

  -- Written only by crm_autopay_record_settlement. There is no UPDATE
  -- grant on this table; see the grants at the foot of the file.
  settled_at timestamptz,
  processor_reference text
    check (processor_reference is null or char_length(btrim(processor_reference)) between 1 and 200),

  failure_reason text
    check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 300),
  cancelled_at timestamptz,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint crm_charge_attempts_enrollment_same_org
    foreign key (organization_id, enrollment_id)
    references public.crm_autopay_enrollments (organization_id, id) on delete cascade,
  constraint crm_charge_attempts_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.crm_invoices (organization_id, id) on delete cascade,

  -- THE ONE THIS FILE EXISTS FOR. An attempt claiming the money moved must
  -- carry the processor's own reference AND the moment; a reference cannot
  -- exist on an attempt that did not settle. There is no shape of this row
  -- that says "succeeded" with nothing to check the claim against.
  constraint crm_charge_attempts_succeeded_evidence
    check ((settled_at is not null) = (state = 'succeeded')
           and (processor_reference is not null) = (state = 'succeeded')),
  constraint crm_charge_attempts_failed_evidence
    check ((failure_reason is not null) = (state = 'failed')),
  constraint crm_charge_attempts_cancelled_evidence
    check ((cancelled_at is not null) = (state = 'cancelled')),

  constraint crm_charge_attempts_reference_no_secret
    check (not public.text_has_likely_secret(processor_reference)),
  constraint crm_charge_attempts_reference_no_pan
    check (not public.text_has_likely_pan(processor_reference)),
  constraint crm_charge_attempts_failure_no_secret
    check (not public.text_has_likely_secret(failure_reason))
);

create unique index if not exists crm_charge_attempts_org_id_key
  on public.crm_charge_attempts (organization_id, id);

-- One live attempt per invoice. Two would charge the customer twice for
-- the same bill, which is the failure the billing generator's unique index
-- exists to prevent on the other side of the ledger.
create unique index if not exists crm_charge_attempts_one_live_per_invoice_key
  on public.crm_charge_attempts (organization_id, invoice_id)
  where state <> 'cancelled';
create index if not exists crm_charge_attempts_org_state_due_idx
  on public.crm_charge_attempts (organization_id, state, scheduled_on);

-- ---------------------------------------------------------------------------
-- Two rules that a CHECK constraint cannot express, because both look at
-- another row. PostgREST is a door: a trigger is the only place these hold
-- for every caller.
-- ---------------------------------------------------------------------------

-- The mandate must belong to the same account AND the same instrument this
-- enrollment charges. A mandate for the customer's other card authorizes
-- nothing about this one.
create or replace function public.crm_autopay_mandate_matches()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.crm_payment_mandates m
     where m.organization_id = new.organization_id
       and m.id = new.mandate_id
       and m.account_id = new.account_id
       and m.instrument_id = new.instrument_id
  ) then
    raise exception
      'the mandate must authorize this account and this instrument; autopay cannot rest on somebody else''s agreement'
      using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from public.crm_payment_instruments i
     where i.organization_id = new.organization_id
       and i.id = new.instrument_id
       and i.removed_at is not null
  ) and new.revoked_at is null then
    raise exception 'that payment method was removed; enrol a current one'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.crm_autopay_mandate_matches()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_autopay_enrollment_mandate on public.crm_autopay_enrollments;
create trigger crm_autopay_enrollment_mandate
  before insert or update on public.crm_autopay_enrollments
  for each row execute function public.crm_autopay_mandate_matches();

-- An attempt may never exceed the ceiling the customer authorized. This is
-- the whole point of storing a cap, and it belongs here rather than in the
-- scheduler: a caller that inserts directly must hit it too.
create or replace function public.crm_charge_within_authorized_cap()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_cap bigint;
  v_revoked timestamptz;
begin
  select e.max_amount_cents, e.revoked_at into v_cap, v_revoked
    from public.crm_autopay_enrollments e
   where e.organization_id = new.organization_id and e.id = new.enrollment_id;

  if v_cap is null then
    raise exception 'no such enrollment' using errcode = 'foreign_key_violation';
  end if;
  if v_revoked is not null then
    raise exception 'that autopay enrollment was revoked; it cannot take new charges'
      using errcode = 'check_violation';
  end if;
  if new.amount_cents > v_cap then
    -- to_char, not a format spec: RAISE substitutes `%` and nothing else,
    -- so `%.2f` would print the raw numeric at full scale — "450.0000000000000000"
    -- — in a message whose whole job is to state two amounts clearly.
    raise exception
      'this charge is % but the customer authorized at most %; a person has to look at it',
      to_char(new.amount_cents / 100.0, 'FM999999990.00'),
      to_char(v_cap / 100.0, 'FM999999990.00')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.crm_charge_within_authorized_cap()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_charge_attempts_cap on public.crm_charge_attempts;
create trigger crm_charge_attempts_cap
  before insert on public.crm_charge_attempts
  for each row execute function public.crm_charge_within_authorized_cap();

-- ---------------------------------------------------------------------------
-- Scheduling one. The amount comes from the invoice's OUTSTANDING balance,
-- never its total: a customer who part-paid by cheque must not be charged
-- the whole bill again.
-- ---------------------------------------------------------------------------

create or replace function public.crm_autopay_schedule_charge(
  p_enrollment uuid,
  p_invoice uuid
)
returns table (attempt_id uuid, attempt_amount_cents bigint, attempt_scheduled_on date)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_account uuid;
  v_offset smallint;
  v_due date;
  v_balance bigint;
  v_status public.crm_invoice_status;
  v_invoice_account uuid;
  v_id uuid;
  v_on date;
begin
  select e.organization_id, e.account_id, e.charge_offset_days
    into v_org, v_account, v_offset
    from public.crm_autopay_enrollments e
   where e.id = p_enrollment and e.revoked_at is null;
  if v_org is null then
    raise exception 'no such live enrollment' using errcode = 'no_data_found';
  end if;

  select i.due_on, i.total_cents - i.paid_cents, i.status, i.account_id
    into v_due, v_balance, v_status, v_invoice_account
    from public.crm_invoices i
   where i.organization_id = v_org and i.id = p_invoice;
  if v_due is null and v_balance is null then
    raise exception 'no such invoice' using errcode = 'no_data_found';
  end if;

  -- The enrollment authorizes charges for ONE account. An invoice belonging
  -- to another is not covered by it, however live it is.
  if v_invoice_account <> v_account then
    raise exception 'that invoice belongs to a different account than this enrollment'
      using errcode = 'check_violation';
  end if;

  if v_status <> 'open' then
    raise exception 'only an open invoice is charged automatically; this one is %', v_status
      using errcode = 'check_violation';
  end if;
  if v_balance <= 0 then
    raise exception 'that invoice has nothing outstanding' using errcode = 'check_violation';
  end if;
  if v_due is null then
    raise exception 'an invoice with no due date has no day to charge on'
      using errcode = 'check_violation';
  end if;

  v_on := v_due + v_offset;

  insert into public.crm_charge_attempts
    (organization_id, enrollment_id, invoice_id, amount_cents, scheduled_on, created_by)
  values (v_org, p_enrollment, p_invoice, v_balance, v_on, auth.uid())
  returning id into v_id;

  return query select v_id, v_balance, v_on;
end;
$$;

revoke all on function public.crm_autopay_schedule_charge(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.crm_autopay_schedule_charge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording that money actually moved. THE GATE.
--
-- SECURITY DEFINER, and it needs justifying: members hold no UPDATE on
-- crm_charge_attempts, which is what makes `succeeded` unreachable by any
-- other route. Membership is checked explicitly and first.
--
-- With no card_payments provider connected this raises, so no row anywhere
-- can say a customer was charged.
-- ---------------------------------------------------------------------------

create or replace function public.crm_autopay_record_settlement(
  p_attempt uuid,
  p_processor_reference text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_state public.crm_charge_state;
begin
  select a.organization_id, a.state into v_org, v_state
    from public.crm_charge_attempts a where a.id = p_attempt for update;

  if v_org is null then
    raise exception 'no such charge attempt' using errcode = 'no_data_found';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;
  if v_state <> 'scheduled' then
    raise exception 'only a scheduled charge can settle; this one is %', v_state
      using errcode = 'check_violation';
  end if;
  if p_processor_reference is null or btrim(p_processor_reference) = '' then
    raise exception 'a settled charge carries the processor''s own reference for it'
      using errcode = 'check_violation';
  end if;

  -- The gate. ADR-207's single question, asked before anything claims money
  -- moved.
  if not public.crm_integration_live(v_org, 'card_payments') then
    raise exception
      'no card payment provider is connected for this workspace, so nothing can be recorded as charged'
      using errcode = 'check_violation';
  end if;

  update public.crm_charge_attempts
     set state = 'succeeded',
         settled_at = now(),
         processor_reference = btrim(p_processor_reference)
   where id = p_attempt;

  return true;
end;
$$;

revoke all on function public.crm_autopay_record_settlement(uuid, text)
  from public, anon, service_role;
grant execute on function public.crm_autopay_record_settlement(uuid, text) to authenticated;

create or replace function public.crm_autopay_record_failure(p_attempt uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_state public.crm_charge_state;
begin
  select a.organization_id, a.state into v_org, v_state
    from public.crm_charge_attempts a where a.id = p_attempt for update;

  if v_org is null then
    raise exception 'no such charge attempt' using errcode = 'no_data_found';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;
  if v_state <> 'scheduled' then
    raise exception 'only a scheduled charge can fail; this one is %', v_state
      using errcode = 'check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a failure carries its reason' using errcode = 'check_violation';
  end if;

  update public.crm_charge_attempts
     set state = 'failed', failure_reason = btrim(p_reason)
   where id = p_attempt;
  return true;
end;
$$;

revoke all on function public.crm_autopay_record_failure(uuid, text)
  from public, anon, service_role;
grant execute on function public.crm_autopay_record_failure(uuid, text) to authenticated;

create or replace function public.crm_autopay_cancel_charge(p_attempt uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_state public.crm_charge_state;
begin
  select a.organization_id, a.state into v_org, v_state
    from public.crm_charge_attempts a where a.id = p_attempt for update;

  if v_org is null then
    raise exception 'no such charge attempt' using errcode = 'no_data_found';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;
  -- A settled charge cannot be cancelled. The money moved; undoing it is a
  -- refund, which this schema already records elsewhere.
  if v_state <> 'scheduled' then
    raise exception 'a % charge cannot be cancelled', v_state using errcode = 'check_violation';
  end if;

  update public.crm_charge_attempts
     set state = 'cancelled', cancelled_at = now()
   where id = p_attempt;
  return true;
end;
$$;

revoke all on function public.crm_autopay_cancel_charge(uuid, text)
  from public, anon, service_role;
grant execute on function public.crm_autopay_cancel_charge(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What is waiting to be charged, and what the workspace cannot charge.
-- ---------------------------------------------------------------------------

create or replace function public.crm_autopay_due(
  p_organization_id uuid,
  p_limit integer default 100
)
returns table (
  -- Prefixed, always: an unprefixed OUT parameter named `state` or
  -- `amount_cents` would shadow the table column throughout this body.
  charge_id uuid,
  charge_account uuid,
  charge_invoice uuid,
  charge_amount_cents bigint,
  charge_scheduled_on date,
  charge_state public.crm_charge_state,
  charge_overdue boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select a.id, e.account_id, a.invoice_id, a.amount_cents, a.scheduled_on, a.state,
         a.state = 'scheduled' and a.scheduled_on < current_date
    from public.crm_charge_attempts a
    join public.crm_autopay_enrollments e
      on e.organization_id = a.organization_id and e.id = a.enrollment_id
   where a.organization_id = p_organization_id
     and a.state = 'scheduled'
   -- Positional: columns 7 = overdue, 5 = scheduled day, 4 = amount. The
   -- names above are OUT parameters, not columns.
   order by 7 desc, 5 asc, 4 desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.crm_autopay_due(uuid, integer)
  from public, anon, service_role;
grant execute on function public.crm_autopay_due(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. REVOKE first: hosted default privileges grant ALL on
-- every new table, so any capability expressed as the ABSENCE of a grant
-- has to be revoked before it is true.
--
-- crm_charge_attempts gets SELECT and INSERT and nothing else. That absence
-- is what makes `succeeded` unwritable except through the settlement
-- function, which asks whether a processor is connected.
--
-- crm_payment_mandates gets SELECT and INSERT and nothing else either, for
-- the ADR-216 reason: a mandate that can be edited afterwards is not
-- evidence of what the customer agreed to.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_payment_instruments enable row level security';
  execute 'alter table public.crm_payment_instruments force row level security';
  execute 'revoke all on table public.crm_payment_instruments
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_payment_instruments_select_member on public.crm_payment_instruments';
  execute 'create policy crm_payment_instruments_select_member on public.crm_payment_instruments
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_payment_instruments_insert_member on public.crm_payment_instruments';
  execute 'create policy crm_payment_instruments_insert_member on public.crm_payment_instruments
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_payment_instruments_update_member on public.crm_payment_instruments';
  execute 'create policy crm_payment_instruments_update_member on public.crm_payment_instruments
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  -- Update so an instrument can be RETIRED. No delete: mandates and
  -- attempts point at it and the history has to stay readable.
  execute 'grant select, insert, update on table public.crm_payment_instruments to authenticated';

  execute 'alter table public.crm_payment_mandates enable row level security';
  execute 'alter table public.crm_payment_mandates force row level security';
  execute 'revoke all on table public.crm_payment_mandates
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_payment_mandates_select_member on public.crm_payment_mandates';
  execute 'create policy crm_payment_mandates_select_member on public.crm_payment_mandates
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_payment_mandates_insert_member on public.crm_payment_mandates';
  execute 'create policy crm_payment_mandates_insert_member on public.crm_payment_mandates
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'grant select, insert on table public.crm_payment_mandates to authenticated';

  execute 'alter table public.crm_autopay_enrollments enable row level security';
  execute 'alter table public.crm_autopay_enrollments force row level security';
  execute 'revoke all on table public.crm_autopay_enrollments
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_autopay_enrollments_select_member on public.crm_autopay_enrollments';
  execute 'create policy crm_autopay_enrollments_select_member on public.crm_autopay_enrollments
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_autopay_enrollments_insert_member on public.crm_autopay_enrollments';
  execute 'create policy crm_autopay_enrollments_insert_member on public.crm_autopay_enrollments
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_autopay_enrollments_update_member on public.crm_autopay_enrollments';
  execute 'create policy crm_autopay_enrollments_update_member on public.crm_autopay_enrollments
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  execute 'grant select, insert, update on table public.crm_autopay_enrollments to authenticated';

  execute 'alter table public.crm_charge_attempts enable row level security';
  execute 'alter table public.crm_charge_attempts force row level security';
  execute 'revoke all on table public.crm_charge_attempts
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_charge_attempts_select_member on public.crm_charge_attempts';
  execute 'create policy crm_charge_attempts_select_member on public.crm_charge_attempts
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_charge_attempts_insert_member on public.crm_charge_attempts';
  execute 'create policy crm_charge_attempts_insert_member on public.crm_charge_attempts
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'grant select, insert on table public.crm_charge_attempts to authenticated';
end;
$$;
