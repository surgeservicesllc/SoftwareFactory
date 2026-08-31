-- Services CRM increment 12: recurring billing and dunning (task #66, owner
-- /goal — ADR-200). PestPac, Briostack, FieldRoutes and GorillaDesk all
-- bill recurring service automatically; the competitor matrix has carried
-- it as a gap since the billing ledger landed.
--
-- THE ONE INVARIANT THIS FILE EXISTS FOR: A SERVICE PLAN CANNOT BE BILLED
-- TWICE FOR THE SAME PERIOD.
--
-- Every other kind of double entry in this schema is recoverable — a
-- duplicate note is noise, a duplicate scan is a scan. A duplicate invoice
-- is a customer being charged twice, and the first they hear of it is a
-- card statement. So the guarantee is a UNIQUE INDEX, not a check the
-- generator performs: a generator that reads-then-writes is a generator
-- that double-bills the moment two people press the button together, and
-- "we only run it once" is not a constraint. The index means the second
-- attempt cannot land even if the first is still in flight.
--
-- What this does NOT do, and does not pretend to:
--
--   * It does not run on a schedule. Nothing in this product does — the
--     automation rules (ADR-196) have no executor either. Generating is an
--     action somebody takes, and the run is recorded with their name on
--     it. Unattended billing needs a scheduler, and that is the honest
--     shape of the gap.
--   * It does not send anything. No email or SMS provider is connected, so
--     a dunning notice records what a person DID — called, posted a
--     letter, wrote by hand — rather than what a machine sent. A queue of
--     unsent reminders that looked like sent ones would be worse than no
--     dunning at all.

-- ---------------------------------------------------------------------------
-- What an invoice was generated FROM. Nullable because the great majority
-- of invoices are raised by hand and always will be; these columns only
-- carry meaning on the ones a billing run produced.
-- ---------------------------------------------------------------------------

alter table public.crm_invoices
  add column if not exists plan_id uuid,
  add column if not exists billing_run_id uuid,
  add column if not exists service_period_start date,
  add column if not exists service_period_end date;

do $$ begin
  alter table public.crm_invoices
    add constraint crm_invoices_period_ordered
    check (
      service_period_end is null or service_period_start is null
      or service_period_end >= service_period_start
    );
exception when duplicate_object then null; end $$;

-- A generated invoice carries its whole provenance or none of it: the plan
-- it came from, the period it covers, and the run that made it. A partial
-- set is a row nobody can audit.
do $$ begin
  alter table public.crm_invoices
    add constraint crm_invoices_generated_provenance
    check (
      num_nonnulls(plan_id, service_period_start, service_period_end, billing_run_id) in (0, 4)
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The run. Append-only: a billing batch is a thing that happened, and the
-- counts it reports are the ones it actually achieved.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Everything due on or before this date was considered.
  through_on date not null,
  plans_considered integer not null default 0 check (plans_considered >= 0),
  invoices_created integer not null default 0 check (invoices_created >= 0),
  -- Plans that were due but already billed for the period they were due
  -- in. Reported rather than swallowed: a run that skipped forty plans and
  -- a run that found forty nothing to do are different events.
  plans_already_billed integer not null default 0 check (plans_already_billed >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  note text check (note is null or char_length(btrim(note)) between 1 and 500),
  ran_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_billing_runs_created_within_considered
    check (invoices_created + plans_already_billed <= plans_considered),
  constraint crm_billing_runs_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_billing_runs_org_id_key
  on public.crm_billing_runs (organization_id, id);
create index if not exists crm_billing_runs_org_ran_idx
  on public.crm_billing_runs (organization_id, ran_at desc);

do $$ begin
  alter table public.crm_invoices
    add constraint crm_invoices_plan_same_org
    foreign key (organization_id, plan_id)
    references public.crm_service_plans (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_invoices
    add constraint crm_invoices_billing_run_same_org
    foreign key (organization_id, billing_run_id)
    references public.crm_billing_runs (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

-- THE GUARANTEE. One invoice per plan per service period, enforced by the
-- database rather than by the generator's own care. Partial, so the
-- hand-raised invoices that carry no plan are unaffected.
create unique index if not exists crm_invoices_plan_period_key
  on public.crm_invoices (organization_id, plan_id, service_period_start)
  where plan_id is not null;

-- ---------------------------------------------------------------------------
-- Dunning. What a person DID about an overdue invoice — not what a system
-- sent, because no system here sends anything.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_dunning_action as enum (
    'reminder_call', 'reminder_letter', 'reminder_email', 'final_notice',
    'payment_plan', 'sent_to_collections', 'written_off'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_dunning_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  account_id uuid not null,
  action public.crm_dunning_action not null,
  -- The age at the moment of acting, copied onto the record. A notice read
  -- back next year must say how overdue the invoice was WHEN somebody
  -- acted, not how overdue it is now.
  days_overdue integer not null check (days_overdue >= 0 and days_overdue <= 36500),
  balance_cents bigint not null check (balance_cents >= 0),
  outcome text check (outcome is null or char_length(btrim(outcome)) between 1 and 1000),
  acted_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_dunning_notices_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.crm_invoices (organization_id, id) on delete cascade,
  constraint crm_dunning_notices_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_dunning_notices_outcome_no_secret check (not public.text_has_likely_secret(outcome))
);

create unique index if not exists crm_dunning_notices_org_id_key
  on public.crm_dunning_notices (organization_id, id);
create index if not exists crm_dunning_notices_org_invoice_idx
  on public.crm_dunning_notices (organization_id, invoice_id, acted_at desc);
create index if not exists crm_dunning_notices_org_acted_idx
  on public.crm_dunning_notices (organization_id, acted_at desc);

-- A notice must belong to the same account as the invoice it is about.
-- Written as a trigger because a CHECK cannot reach another table, and
-- leaving it to the caller would let a collections note land on the wrong
-- customer's file.
create or replace function public.crm_check_dunning_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account uuid;
begin
  select account_id into v_account from public.crm_invoices where id = new.invoice_id;
  if v_account is null or v_account <> new.account_id then
    raise exception 'that invoice is not on this account' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_dunning_notices_check_account on public.crm_dunning_notices;
create trigger crm_dunning_notices_check_account
  before insert on public.crm_dunning_notices
  for each row execute function public.crm_check_dunning_account();

revoke all on function public.crm_check_dunning_account()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The period a recurrence covers. One place, so the generator and any
-- later reader agree on what "the month a monthly plan bills for" means.
-- ---------------------------------------------------------------------------

create or replace function public.crm_recurrence_interval(p_recurrence public.crm_service_recurrence)
returns interval
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_recurrence
    when 'weekly' then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'monthly' then interval '1 month'
    when 'bimonthly' then interval '2 months'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual' then interval '1 year'
  end;
$$;

-- ---------------------------------------------------------------------------
-- The generator.
--
-- SECURITY INVOKER, like the dashboards (ADR-199) and for the same reason:
-- it writes into the caller's own organization through RLS, so it can
-- never reach a book its caller could not already write to.
--
-- Idempotent by the unique index above rather than by looking first. The
-- `on conflict do nothing` is the whole re-run story: pressing the button
-- twice bills once, and two people pressing it together also bills once.
-- ---------------------------------------------------------------------------

create or replace function public.crm_generate_due_invoices(
  p_organization uuid,
  p_through date default current_date,
  p_net_days integer default 30,
  p_note text default null
)
returns table (
  billing_run_id uuid,
  plans_considered integer,
  invoices_created integer,
  plans_already_billed integer,
  total_cents bigint
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_run uuid;
  v_plan record;
  v_invoice uuid;
  v_considered integer := 0;
  v_created integer := 0;
  v_skipped integer := 0;
  v_total bigint := 0;
  v_period_end date;
  v_number text;
begin
  if p_net_days < 0 or p_net_days > 365 then
    raise exception 'net terms must be between 0 and 365 days' using errcode = 'check_violation';
  end if;

  insert into public.crm_billing_runs (organization_id, through_on, note, created_by)
  values (p_organization, p_through, p_note, auth.uid())
  returning id into v_run;

  for v_plan in
    select p.id, p.account_id, p.property_id, p.service_type, p.recurrence,
           p.next_due, p.value_cents
      from public.crm_service_plans p
     where p.organization_id = p_organization
       and p.active
       and p.next_due <= p_through
       -- A plan with no price cannot be billed. It is counted as
       -- considered and skipped rather than invoiced for zero, because a
       -- zero invoice is a bill the customer has to ask about.
       and p.value_cents is not null
       and p.value_cents > 0
     order by p.next_due
     for update
  loop
    v_considered := v_considered + 1;
    v_period_end := (v_plan.next_due + public.crm_recurrence_interval(v_plan.recurrence))::date - 1;
    -- Deterministic and readable: the plan's own period identifies it.
    v_number := 'AUTO-' || to_char(v_plan.next_due, 'YYYYMMDD') || '-'
                || substr(replace(v_plan.id::text, '-', ''), 1, 8);

    insert into public.crm_invoices
      (organization_id, account_id, plan_id, billing_run_id, number, status,
       subtotal_cents, tax_cents, total_cents, issued_on, due_on,
       service_period_start, service_period_end, memo, created_by)
    values
      (p_organization, v_plan.account_id, v_plan.id, v_run, v_number, 'open',
       v_plan.value_cents, 0, v_plan.value_cents, p_through,
       p_through + p_net_days, v_plan.next_due, v_period_end,
       v_plan.service_type || ' — ' || to_char(v_plan.next_due, 'YYYY-MM-DD')
         || ' to ' || to_char(v_period_end, 'YYYY-MM-DD'),
       auth.uid())
    -- The re-run story, in one clause. The predicate is repeated because
    -- the index is partial: Postgres will not infer a partial unique index
    -- from the columns alone, and without it this raises rather than
    -- skipping.
    on conflict (organization_id, plan_id, service_period_start)
      where plan_id is not null do nothing
    returning id into v_invoice;

    if v_invoice is null then
      v_skipped := v_skipped + 1;
    else
      insert into public.crm_invoice_lines
        (organization_id, invoice_id, position, description, quantity,
         unit_price_cents, amount_cents)
      values
        (p_organization, v_invoice, 1,
         v_plan.service_type || ' (' || v_plan.recurrence || ')', 1,
         v_plan.value_cents, v_plan.value_cents);
      v_created := v_created + 1;
      v_total := v_total + v_plan.value_cents;
    end if;

    -- The plan advances either way. A period already billed is a period
    -- done with, and leaving next_due behind would make every later run
    -- reconsider it forever.
    update public.crm_service_plans
       set next_due = (v_plan.next_due + public.crm_recurrence_interval(v_plan.recurrence))::date
     where id = v_plan.id;

    v_invoice := null;
  end loop;

  update public.crm_billing_runs
     set plans_considered = v_considered,
         invoices_created = v_created,
         plans_already_billed = v_skipped,
         total_cents = v_total
   where id = v_run;

  return query select v_run, v_considered, v_created, v_skipped, v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- The collections worklist: every overdue invoice with what has already
-- been tried on it. Invoker, so it reads only the caller's own book.
-- ---------------------------------------------------------------------------

create or replace function public.crm_collections_worklist(p_min_days integer default 1)
returns table (
  invoice_id uuid,
  account_id uuid,
  account_name text,
  number text,
  balance_cents bigint,
  due_on date,
  days_overdue integer,
  notices integer,
  last_action public.crm_dunning_action,
  last_acted_at timestamptz
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select i.id, i.account_id, a.name, i.number,
         (i.total_cents - i.paid_cents)::bigint,
         i.due_on,
         (current_date - i.due_on)::integer,
         coalesce(n.notices, 0)::integer,
         n.last_action,
         n.last_acted_at
    from public.crm_invoices i
    join public.crm_accounts a on a.id = i.account_id
    left join lateral (
      select count(*)::integer as notices,
             (array_agg(d.action order by d.acted_at desc))[1] as last_action,
             max(d.acted_at) as last_acted_at
        from public.crm_dunning_notices d
       where d.invoice_id = i.id
    ) n on true
   where i.status = 'open'
     and i.total_cents > i.paid_cents
     and i.due_on is not null
     and (current_date - i.due_on) >= greatest(p_min_days, 1)
   -- Oldest and largest first: the order a collections desk actually works.
   order by (current_date - i.due_on) desc, (i.total_cents - i.paid_cents) desc
   limit 500;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'crm_recurrence_interval(public.crm_service_recurrence)',
    'crm_generate_due_invoices(uuid, date, integer, text)',
    'crm_collections_worklist(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', v_function);
    execute format('grant execute on function public.%s to authenticated', v_function);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security. Neither table is deletable: a billing run happened,
-- and a collections action taken is a thing somebody did. A run's counts
-- are written by the generator alone, so nothing but SELECT and INSERT is
-- granted on either.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_billing_runs', 'crm_dunning_notices'] loop
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

    execute format('grant select, insert on table public.%I to authenticated', v_table);
  end loop;

  -- The generator writes its own totals back, so a run needs UPDATE — and
  -- only a run. A notice, once written, is final.
  execute 'drop policy if exists crm_billing_runs_update_member on public.crm_billing_runs';
  execute 'create policy crm_billing_runs_update_member on public.crm_billing_runs
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  execute 'grant update on table public.crm_billing_runs to authenticated';
end;
$$;

create index if not exists crm_invoices_org_plan_idx
  on public.crm_invoices (organization_id, plan_id) where plan_id is not null;
create index if not exists crm_service_plans_org_due_idx
  on public.crm_service_plans (organization_id, next_due) where active;
