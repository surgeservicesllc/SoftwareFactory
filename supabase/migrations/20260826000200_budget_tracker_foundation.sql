-- Budget Tracker: the authenticated /BudgetTracker surface's data model.
--
-- This is the most sensitive personal data in the product: a household's
-- accounts, balances, income, debts and twenty years of transactions. So it
-- follows the Job Seeker rule exactly — every table is scoped by BOTH
-- organization_id and user_id, RLS requires organization membership AND row
-- ownership, and FORCE keeps the owning role subject to it. An administrator
-- of the organization does not read a member's finances.
--
-- No row in this schema is seeded. The tables ship empty and are filled by
-- the person who owns them, through the import path or by hand. Real
-- financial history does not belong in source control.
--
-- Five invariants live in the schema rather than in application code, because
-- application code is replaceable and these must not be:
--
--   1. Money is integer cents, everywhere, always. The spreadsheets this
--      replaces carry running totals like 5402.860000000001 — binary floating
--      point accumulating error over 8,000 rows. Cents as bigint cannot drift.
--   2. Sign follows kind. A deposit is positive, a debit/check/fee is
--      negative. A ledger that lets a debit be positive silently inverts every
--      total built on it.
--   3. Import is idempotent. Every transaction carries a content hash unique
--      per person; importing the same file twice conflicts instead of
--      doubling the ledger, and genuinely repeated charges stay distinct
--      through an occurrence ordinal.
--   4. A credit limit belongs only to revolving credit. Utilization computed
--      against a mortgage is a meaningless number that looks like a real one.
--   5. Categories and accounts cannot be borrowed across people. Every
--      foreign key is checked against the same owner, so one person's
--      transaction can never reference another's account.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.budget_account_kind as enum (
    'checking', 'savings', 'credit_card', 'loan', 'mortgage', 'brokerage', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.budget_transaction_kind as enum (
    'deposit', 'debit', 'check', 'fee', 'atm_credit', 'transfer_in', 'transfer_out', 'adjustment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.budget_category_kind as enum ('income', 'expense', 'transfer', 'debt', 'savings');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.budget_obligation_status as enum (
    'scheduled', 'paid', 'repeats_monthly', 'overdue', 'closed'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table if not exists public.budget_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  institution text check (institution is null or char_length(btrim(institution)) between 1 and 160),
  kind public.budget_account_kind not null,
  -- The last four digits a statement prints, and nothing more. There is no
  -- column here for a full account or card number, deliberately: this product
  -- has no use for one, and a column that exists is a column that gets filled.
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  current_balance_cents bigint not null default 0
    check (current_balance_cents between -1000000000000 and 1000000000000),
  -- Revolving credit only; see the constraint below.
  credit_limit_cents bigint
    check (credit_limit_cents is null or credit_limit_cents between 0 and 1000000000000),
  apr_bps integer check (apr_bps is null or apr_bps between 0 and 100000),
  -- A promotional rate that ends is the single most expensive thing to forget
  -- in a household budget, so it is a first-class column rather than a note.
  promo_apr_ends_on date,
  opened_on date,
  closed_on date,
  is_active boolean not null default true,
  sort_rank integer not null default 0 check (sort_rank between -1000 and 1000),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budget_accounts_name_per_person unique (organization_id, user_id, name),
  constraint budget_accounts_limit_is_revolving check (
    credit_limit_cents is null or kind = 'credit_card'
  ),
  constraint budget_accounts_closed_after_opened check (
    closed_on is null or opened_on is null or closed_on >= opened_on
  ),
  constraint budget_accounts_closed_is_inactive check (
    closed_on is null or is_active = false
  )
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind public.budget_category_kind not null,
  -- A design token name, not a raw colour: the page owns its palette, and a
  -- stored hex would outlive the theme it was picked for and break dark mode.
  tone text not null default 'neutral'
    check (tone in ('neutral', 'income', 'essential', 'discretionary', 'debt', 'savings', 'warning')),
  monthly_limit_cents bigint
    check (monthly_limit_cents is null or monthly_limit_cents between 0 and 1000000000000),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budget_categories_name_per_person unique (organization_id, user_id, name)
);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create table if not exists public.budget_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.budget_accounts(id) on delete cascade,
  category_id uuid references public.budget_categories(id) on delete set null,
  posted_on date not null check (posted_on between date '1970-01-01' and date '2100-01-01'),
  kind public.budget_transaction_kind not null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  -- Signed: negative is money leaving. See the sign constraint below.
  amount_cents bigint not null check (amount_cents between -1000000000000 and 1000000000000),
  -- The balance the statement showed after this line, when the import carried
  -- one. Evidence of what the source said, not a computed figure — the
  -- application recomputes running totals from amounts and never trusts this
  -- for arithmetic.
  balance_after_cents bigint
    check (balance_after_cents is null or balance_after_cents between -1000000000000 and 1000000000000),
  -- Both sides of a move between the person's own accounts share this id, so
  -- a transfer can be excluded from spend without guessing from the wording.
  transfer_group_id uuid,
  import_batch_id uuid,
  -- Idempotency. sha256 over account, date, kind, normalized description,
  -- amount and the occurrence ordinal within that identical group.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budget_transactions_sign_follows_kind check (
    case kind
      when 'deposit' then amount_cents > 0
      when 'atm_credit' then amount_cents > 0
      when 'transfer_in' then amount_cents > 0
      when 'debit' then amount_cents < 0
      when 'check' then amount_cents < 0
      when 'fee' then amount_cents < 0
      when 'transfer_out' then amount_cents < 0
      else true
    end
  ),
  constraint budget_transactions_hash_per_person unique (organization_id, user_id, content_hash)
);

-- ---------------------------------------------------------------------------
-- Recurring obligations — the bill schedule
-- ---------------------------------------------------------------------------

create table if not exists public.budget_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The account the balance sits on, when there is one. A utility bill has no
  -- account here; a credit card payment does.
  account_id uuid references public.budget_accounts(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  due_day smallint not null check (due_day between 1 and 31),
  amount_cents bigint not null default 0 check (amount_cents between 0 and 1000000000000),
  balance_cents bigint check (balance_cents is null or balance_cents between 0 and 1000000000000),
  monthly_interest_cents bigint
    check (monthly_interest_cents is null or monthly_interest_cents between 0 and 1000000000000),
  credit_limit_cents bigint
    check (credit_limit_cents is null or credit_limit_cents between 0 and 1000000000000),
  apr_bps integer check (apr_bps is null or apr_bps between 0 and 100000),
  status public.budget_obligation_status not null default 'scheduled',
  -- Which account or card actually pays it, as the person writes it.
  paid_from text check (paid_from is null or char_length(btrim(paid_from)) between 1 and 160),
  -- Whose obligation it is inside a household. Free text on purpose: this is
  -- a label the household chooses, not an identity the system resolves.
  owner_label text check (owner_label is null or char_length(btrim(owner_label)) between 1 and 80),
  payoff_rank integer check (payoff_rank is null or payoff_rank between 1 and 999),
  autopay boolean not null default false,
  last_paid_on date,
  next_due_on date,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budget_obligations_name_per_person unique (organization_id, user_id, name),
  constraint budget_obligations_balance_within_limit check (
    credit_limit_cents is null or balance_cents is null or balance_cents <= credit_limit_cents * 2
  )
);

-- ---------------------------------------------------------------------------
-- Monthly plan — the budget half of a budget tracker
-- ---------------------------------------------------------------------------

create table if not exists public.budget_month_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.budget_categories(id) on delete cascade,
  -- Always the first of the month; the constraint makes that true rather than
  -- conventional, so grouping never has to normalize.
  month date not null check (extract(day from month) = 1),
  planned_cents bigint not null check (planned_cents between 0 and 1000000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budget_month_plans_one_per_category_month
    unique (organization_id, user_id, category_id, month)
);

-- ---------------------------------------------------------------------------
-- Import provenance
-- ---------------------------------------------------------------------------

create table if not exists public.budget_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.budget_accounts(id) on delete cascade,
  source_name text not null check (char_length(btrim(source_name)) between 1 and 260),
  sheet_name text check (sheet_name is null or char_length(btrim(sheet_name)) between 1 and 200),
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  -- What the importer could not read, kept so a partial import announces its
  -- own gaps instead of looking complete. Text, bounded, never the row data.
  notice text check (notice is null or char_length(notice) <= 4000),
  created_at timestamptz not null default now(),

  constraint budget_import_batches_counts_add_up check (rows_imported + rows_skipped <= rows_read)
);

-- ---------------------------------------------------------------------------
-- Cross-table ownership: a foreign key alone would let one person's
-- transaction point at another person's account. These make that impossible.
-- ---------------------------------------------------------------------------

create or replace function public.budget_row_belongs_to_writer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  -- One trigger serves four tables and they do not share a column set:
  -- budget_month_plans has no account_id, budget_import_batches has no
  -- category_id. Reading NEW.account_id directly would raise "record new has
  -- no field" on the tables that lack it, so the row is inspected as jsonb
  -- and each key is checked only where it exists.
  v_row jsonb := to_jsonb(new);
  v_account uuid;
  v_category uuid;
  v_owner record;
begin
  if v_row ? 'account_id' then
    v_account := nullif(v_row ->> 'account_id', '')::uuid;
  end if;
  if v_row ? 'category_id' then
    v_category := nullif(v_row ->> 'category_id', '')::uuid;
  end if;

  if v_account is not null then
    select organization_id, user_id into v_owner
      from public.budget_accounts where id = v_account;
    if v_owner is null
       or v_owner.organization_id <> new.organization_id
       or v_owner.user_id <> new.user_id then
      raise exception using errcode = '42501',
        message = 'account does not belong to this person';
    end if;
  end if;

  if v_category is not null then
    select organization_id, user_id into v_owner
      from public.budget_categories where id = v_category;
    if v_owner is null
       or v_owner.organization_id <> new.organization_id
       or v_owner.user_id <> new.user_id then
      raise exception using errcode = '42501',
        message = 'category does not belong to this person';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.budget_row_belongs_to_writer() from public, anon, authenticated;

drop trigger if exists budget_transactions_ownership on public.budget_transactions;
create trigger budget_transactions_ownership
  before insert or update on public.budget_transactions
  for each row execute function public.budget_row_belongs_to_writer();

drop trigger if exists budget_obligations_ownership on public.budget_obligations;
create trigger budget_obligations_ownership
  before insert or update on public.budget_obligations
  for each row execute function public.budget_row_belongs_to_writer();

drop trigger if exists budget_month_plans_ownership on public.budget_month_plans;
create trigger budget_month_plans_ownership
  before insert or update on public.budget_month_plans
  for each row execute function public.budget_row_belongs_to_writer();

drop trigger if exists budget_import_batches_ownership on public.budget_import_batches;
create trigger budget_import_batches_ownership
  before insert or update on public.budget_import_batches
  for each row execute function public.budget_row_belongs_to_writer();

-- ---------------------------------------------------------------------------
-- Row Level Security: organization member AND row owner, on every table.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'budget_accounts', 'budget_categories', 'budget_transactions',
    'budget_obligations', 'budget_month_plans', 'budget_import_batches'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    /*
     * service_role is BYPASSRLS. A grant to it is not a narrower kind of
     * access to these tables — it is every policy above, switched off. The
     * hosted database's default privileges re-grant it on each new table, and
     * 20260812002600 narrowed only the tables that existed when it ran, so
     * the revoke has to be stated here or these six arrive wide open to it.
     *
     * Nothing in the application needs it: every Budget Tracker read and
     * write goes through the signed-in person's own session client, which is
     * exactly what makes the row policies the real boundary.
     */
    execute format('revoke all on table public.%I from service_role', v_table);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_own', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_select_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_own', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_insert_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_update_own', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())
         with check (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_update_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_delete_own', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_delete_own', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes. The transaction table is the one that grows without bound — twenty
-- years of a single checking account is already 8,000 rows — so every read the
-- page performs has one.
-- ---------------------------------------------------------------------------

create index if not exists budget_accounts_person_idx
  on public.budget_accounts (organization_id, user_id, is_active, sort_rank);

create index if not exists budget_categories_person_idx
  on public.budget_categories (organization_id, user_id, is_archived, name);

create index if not exists budget_transactions_person_date_idx
  on public.budget_transactions (organization_id, user_id, posted_on desc, id desc);

create index if not exists budget_transactions_account_date_idx
  on public.budget_transactions (account_id, posted_on desc, id desc);

create index if not exists budget_transactions_category_idx
  on public.budget_transactions (organization_id, user_id, category_id, posted_on desc);

create index if not exists budget_transactions_batch_idx
  on public.budget_transactions (import_batch_id)
  where import_batch_id is not null;

create index if not exists budget_transactions_transfer_idx
  on public.budget_transactions (transfer_group_id)
  where transfer_group_id is not null;

create index if not exists budget_obligations_person_due_idx
  on public.budget_obligations (organization_id, user_id, due_day, name);

create index if not exists budget_month_plans_person_month_idx
  on public.budget_month_plans (organization_id, user_id, month desc);

create index if not exists budget_import_batches_person_idx
  on public.budget_import_batches (organization_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reads that must not be done in the browser.
--
-- Monthly cash flow over twenty years is an aggregate over every row in the
-- ledger. Computing it in the page would mean shipping eight thousand
-- transactions to a phone to add them up. These functions are SECURITY
-- INVOKER — the default, stated here because it is load-bearing — so RLS
-- applies to the caller exactly as it does to a direct select, and a
-- definer's rights are never borrowed to read someone else's finances.
-- ---------------------------------------------------------------------------

create or replace function public.budget_monthly_flow(
  p_organization_id uuid,
  p_months integer default 36
)
returns table (
  month date,
  income_cents bigint,
  expense_cents bigint,
  net_cents bigint,
  transaction_count integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  select
    date_trunc('month', t.posted_on)::date as month,
    coalesce(sum(t.amount_cents) filter (where t.amount_cents > 0), 0)::bigint as income_cents,
    coalesce(abs(sum(t.amount_cents) filter (where t.amount_cents < 0)), 0)::bigint as expense_cents,
    coalesce(sum(t.amount_cents), 0)::bigint as net_cents,
    count(*)::integer as transaction_count
  from public.budget_transactions t
  where t.organization_id = p_organization_id
    -- A move between the person's own accounts is neither income nor
    -- spending. Counting it inflates both sides of every month it appears in.
    and t.kind not in ('transfer_in', 'transfer_out')
  group by 1
  order by 1 desc
  limit greatest(coalesce(p_months, 36), 1);
$function$;

revoke all on function public.budget_monthly_flow(uuid, integer) from public, anon;
grant execute on function public.budget_monthly_flow(uuid, integer) to authenticated;

create or replace function public.budget_category_spend(
  p_organization_id uuid,
  p_month date
)
returns table (
  category_id uuid,
  spent_cents bigint,
  transaction_count integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  select
    t.category_id,
    abs(sum(t.amount_cents))::bigint as spent_cents,
    count(*)::integer as transaction_count
  from public.budget_transactions t
  where t.organization_id = p_organization_id
    and t.amount_cents < 0
    and t.kind not in ('transfer_in', 'transfer_out')
    and date_trunc('month', t.posted_on)::date = date_trunc('month', p_month)::date
  group by t.category_id
  order by 2 desc;
$function$;

revoke all on function public.budget_category_spend(uuid, date) from public, anon;
grant execute on function public.budget_category_spend(uuid, date) to authenticated;
