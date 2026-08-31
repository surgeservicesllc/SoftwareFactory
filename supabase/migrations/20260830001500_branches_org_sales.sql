-- Services CRM increment 7: branches, the org chart, territories and the
-- sales motion (task #64, owner directive — ADR-195). The company half of
-- the CRM: until now every row belonged to an organization and to nobody
-- in particular. A pest-services business is run out of branches, by
-- managers, through territories, by named people who are measured on what
-- they sell — and every platform this is judged against (Briostack,
-- FieldRoutes, PestPac) reports by branch, by territory and by rep.
--
-- Posture is unchanged: organization-scoped forced RLS, revoke-then-grant
-- against the hosted default privileges, anon and service_role shut out,
-- same-organization composite foreign keys throughout, nothing deletable.
--
-- Three invariants live in the schema:
--
--   1. A person cannot report to themselves, and a branch's manager must
--      be a person in the same organization. The org chart is a graph the
--      database refuses to make nonsense of.
--   2. A commission's amount is DERIVED from its basis and its rate by
--      trigger. A caller states what was sold and at what rate; it cannot
--      state a payout that disagrees with its own arithmetic.
--   3. A closed branch is not an active branch, and an ended employment is
--      not an active employee. "Active" is never left contradicting a date.

-- Composite keys the later references need. crm_invoices already carries
-- one from the billing migration; the three new tables get theirs beside
-- their own definitions.

do $$ begin
  create type public.crm_employee_role as enum (
    'owner', 'branch_manager', 'sales_manager', 'sales_rep', 'csr', 'dispatcher', 'admin'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_commission_status as enum ('accrued', 'approved', 'paid', 'void');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Branches: the physical operation. A code is the short identity a branch
-- is known by on a route sheet and in a report; it is unique per
-- organization and never reused, because a report that silently changes
-- which office it means is worse than one that is missing.
--
-- The manager reference is added AFTER crm_employees exists: a branch is
-- managed by an employee, and an employee belongs to a branch, so one of
-- the two directions has to be declared second.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manager_id uuid,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  address text check (address is null or char_length(btrim(address)) between 1 and 500),
  phone text check (phone is null or phone ~ '^[0-9+() .\-]{7,32}$'),
  email text check (email is null or (position('@' in email) > 1 and char_length(email) between 3 and 320)),
  -- An IANA zone name, so a route sheet's "8am" means the branch's 8am.
  time_zone text check (time_zone is null or time_zone ~ '^[A-Za-z][A-Za-z_+-]{1,30}(/[A-Za-z][A-Za-z_+-]{1,30}){0,2}$'),
  opened_on date,
  closed_on date,
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_branches_closed_after_opened
    check (closed_on is null or opened_on is null or closed_on >= opened_on),
  -- A branch that closed is not open for business, whatever the flag says.
  constraint crm_branches_closed_is_inactive check (closed_on is null or active = false),
  constraint crm_branches_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_branches_notes_no_secret check (not public.text_has_likely_secret(notes)),
  constraint crm_branches_address_no_secret check (not public.text_has_likely_secret(address))
);

create unique index if not exists crm_branches_org_id_key
  on public.crm_branches (organization_id, id);
create unique index if not exists crm_branches_org_code_key
  on public.crm_branches (organization_id, code);

-- ---------------------------------------------------------------------------
-- Employees: the org chart. Owners, branch and sales managers, sales reps,
-- customer service, dispatch and admin — the people a book of business is
-- run by. Field technicians keep their own roster (they carry licenses and
-- take work-order assignments); this table gives them a branch and a
-- supervisor without moving them.
--
-- There is no DELETE. A commission, an assignment and a signature all hang
-- off a person; someone who leaves is ended, never erased.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  reports_to_id uuid,
  -- The optional link to a real login: a staff record is a person in the
  -- business, not an account, and most of them will never sign in.
  user_id uuid references auth.users(id) on delete set null,
  employee_code text not null check (employee_code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 80),
  email text check (email is null or (position('@' in email) > 1 and char_length(email) between 3 and 320)),
  phone text check (phone is null or phone ~ '^[0-9+() .\-]{7,32}$'),
  role public.crm_employee_role not null,
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  hire_date date,
  end_date date,
  -- Basis points, so a 7.5% commission is 750 and there is no float here
  -- either. 10000 is the whole sale, which is the honest ceiling.
  commission_bps integer check (commission_bps is null or commission_bps between 0 and 10000),
  monthly_quota_cents bigint check (monthly_quota_cents is null or (monthly_quota_cents >= 0 and monthly_quota_cents <= 100000000000)),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_employees_branch_same_org
    foreign key (organization_id, branch_id)
    references public.crm_branches (organization_id, id) on delete set null,
  constraint crm_employees_end_after_hire
    check (end_date is null or hire_date is null or end_date >= hire_date),
  -- Someone whose employment ended is not on the active roster.
  constraint crm_employees_ended_is_inactive check (end_date is null or active = false),
  constraint crm_employees_no_self_report check (reports_to_id is null or reports_to_id <> id),
  constraint crm_employees_name_no_secret check (not public.text_has_likely_secret(first_name)),
  constraint crm_employees_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_employees_org_id_key
  on public.crm_employees (organization_id, id);
create unique index if not exists crm_employees_org_code_key
  on public.crm_employees (organization_id, employee_code);
-- One staff record per login, so two people cannot share an identity.
create unique index if not exists crm_employees_org_user_key
  on public.crm_employees (organization_id, user_id) where user_id is not null;

-- The self-reference and the branch's manager, both declared now that the
-- table they point at exists. A composite self-reference cannot be inline.
do $$ begin
  alter table public.crm_employees
    add constraint crm_employees_reports_to_same_org
    foreign key (organization_id, reports_to_id)
    references public.crm_employees (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_branches
    add constraint crm_branches_manager_same_org
    foreign key (organization_id, manager_id)
    references public.crm_employees (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Territories: the map the sales motion is measured on. A territory belongs
-- to a branch, is worked by a rep, and is defined by the postal codes it
-- covers — stored as an array, and CHECKed element by element by matching
-- the joined string, because a territory whose codes are free text cannot
-- be reported on.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_territories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  rep_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
  city text check (city is null or char_length(btrim(city)) between 1 and 120),
  region text check (region is null or region ~ '^[A-Z]{2}$'),
  postal_codes text[] not null default '{}'::text[]
    check (
      array_length(postal_codes, 1) is null
      or (
        array_length(postal_codes, 1) between 1 and 400
        and array_to_string(postal_codes, ',')
            ~ '^[A-Z0-9][A-Z0-9 -]{0,10}(,[A-Z0-9][A-Z0-9 -]{0,10})*$'
      )
    ),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_territories_branch_same_org
    foreign key (organization_id, branch_id)
    references public.crm_branches (organization_id, id) on delete cascade,
  constraint crm_territories_rep_same_org
    foreign key (organization_id, rep_id)
    references public.crm_employees (organization_id, id) on delete set null,
  constraint crm_territories_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_territories_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_territories_org_id_key
  on public.crm_territories (organization_id, id);
create unique index if not exists crm_territories_org_code_key
  on public.crm_territories (organization_id, code);

-- ---------------------------------------------------------------------------
-- The book of business gains its place in the company: which branch serves
-- it, which territory it sits in, and which named person owns the
-- relationship. All three are nullable — a book seeded before branches
-- existed is not wrong, it is unassigned — and all three are
-- same-organization by composite key.
-- ---------------------------------------------------------------------------

alter table public.crm_accounts
  add column if not exists branch_id uuid,
  add column if not exists territory_id uuid,
  add column if not exists owner_employee_id uuid;

do $$ begin
  alter table public.crm_accounts
    add constraint crm_accounts_branch_same_org
    foreign key (organization_id, branch_id)
    references public.crm_branches (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_accounts
    add constraint crm_accounts_territory_same_org
    foreign key (organization_id, territory_id)
    references public.crm_territories (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_accounts
    add constraint crm_accounts_owner_same_org
    foreign key (organization_id, owner_employee_id)
    references public.crm_employees (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

-- A deal is worked by somebody. Without this the leaderboard is a guess.
alter table public.crm_opportunities
  add column if not exists owner_employee_id uuid;

do $$ begin
  alter table public.crm_opportunities
    add constraint crm_opportunities_owner_same_org
    foreign key (organization_id, owner_employee_id)
    references public.crm_employees (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

-- Technicians keep their roster and gain their place in it.
alter table public.crm_technicians
  add column if not exists branch_id uuid,
  add column if not exists reports_to_id uuid,
  add column if not exists hire_date date;

do $$ begin
  alter table public.crm_technicians
    add constraint crm_technicians_branch_same_org
    foreign key (organization_id, branch_id)
    references public.crm_branches (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_technicians
    add constraint crm_technicians_reports_to_same_org
    foreign key (organization_id, reports_to_id)
    references public.crm_employees (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Commissions: what a sale earned the person who made it. The amount is
-- derived from the basis and the rate by trigger — invariant 2 — so a
-- payout can never disagree with the arithmetic that produced it. Each one
-- names what it was earned on: a won opportunity, a signed contract, a paid
-- invoice, or more than one of the three.
--
-- Approval and payment are recorded as they happen and cannot be skipped:
-- a paid commission has both moments, an accrued one has neither.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  opportunity_id uuid,
  contract_id uuid,
  invoice_id uuid,
  basis_cents bigint not null check (basis_cents >= 0 and basis_cents <= 100000000000),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  status public.crm_commission_status not null default 'accrued',
  earned_on date not null,
  approved_at timestamptz,
  paid_at timestamptz,
  note text check (note is null or char_length(note) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_commissions_employee_same_org
    foreign key (organization_id, employee_id)
    references public.crm_employees (organization_id, id) on delete restrict,
  constraint crm_commissions_opportunity_same_org
    foreign key (organization_id, opportunity_id)
    references public.crm_opportunities (organization_id, id) on delete set null,
  constraint crm_commissions_contract_same_org
    foreign key (organization_id, contract_id)
    references public.crm_contracts (organization_id, id) on delete set null,
  constraint crm_commissions_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.crm_invoices (organization_id, id) on delete set null,
  -- A commission is earned on something. One of the three, at least.
  constraint crm_commissions_has_source
    check (num_nonnulls(opportunity_id, contract_id, invoice_id) >= 1),
  constraint crm_commissions_accrued_has_no_stamps
    check (status <> 'accrued' or (approved_at is null and paid_at is null)),
  constraint crm_commissions_approved_has_moment
    check (status <> 'approved' or approved_at is not null),
  constraint crm_commissions_paid_has_both
    check (status <> 'paid' or (approved_at is not null and paid_at is not null)),
  constraint crm_commissions_paid_after_approved
    check (paid_at is null or approved_at is null or paid_at >= approved_at),
  constraint crm_commissions_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_commissions_org_id_key
  on public.crm_commissions (organization_id, id);

-- Invariant 2, stated where no route can route around it.
create or replace function public.crm_derive_commission_amount()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.amount_cents := round(new.basis_cents::numeric * new.rate_bps / 10000)::bigint;
  return new;
end;
$$;

revoke all on function public.crm_derive_commission_amount()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_commissions_derive_amount on public.crm_commissions;
create trigger crm_commissions_derive_amount
  before insert or update on public.crm_commissions
  for each row execute function public.crm_derive_commission_amount();

-- ---------------------------------------------------------------------------
-- updated_at, Row Level Security and grants. Nothing here is deletable: a
-- closed branch, an ended employee, a retired territory and a voided
-- commission all stay on the record.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_branches', 'crm_employees', 'crm_territories', 'crm_commissions'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);

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

    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);

    execute format('grant select, insert, update on table public.%I to authenticated', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes: the reads these pages actually make.
-- ---------------------------------------------------------------------------

create index if not exists crm_branches_org_active_idx
  on public.crm_branches (organization_id, active, name);
create index if not exists crm_employees_org_branch_idx
  on public.crm_employees (organization_id, branch_id, active);
create index if not exists crm_employees_org_role_idx
  on public.crm_employees (organization_id, role, active);
create index if not exists crm_employees_org_reports_to_idx
  on public.crm_employees (organization_id, reports_to_id);
create index if not exists crm_territories_org_branch_idx
  on public.crm_territories (organization_id, branch_id, active);
create index if not exists crm_territories_org_rep_idx
  on public.crm_territories (organization_id, rep_id);
create index if not exists crm_commissions_org_employee_idx
  on public.crm_commissions (organization_id, employee_id, earned_on desc);
create index if not exists crm_commissions_org_status_idx
  on public.crm_commissions (organization_id, status, earned_on desc);
create index if not exists crm_accounts_org_branch_idx
  on public.crm_accounts (organization_id, branch_id);
create index if not exists crm_accounts_org_owner_idx
  on public.crm_accounts (organization_id, owner_employee_id);
create index if not exists crm_accounts_org_territory_idx
  on public.crm_accounts (organization_id, territory_id);
create index if not exists crm_opportunities_org_owner_idx
  on public.crm_opportunities (organization_id, owner_employee_id, stage);
create index if not exists crm_technicians_org_branch_idx
  on public.crm_technicians (organization_id, branch_id, active);
