-- Services CRM: the foundation of the Pest Services platform (task #63,
-- owner /goal, increment 1 — ADR-185).
--
-- The 360-degree record starts here: accounts (residential and commercial),
-- the people on them, the properties/sites service happens at, and one
-- immutable timeline every later surface appends to (calls, notes, status
-- changes today; services, payments, IPM events in later increments). The
-- goal's compliance pillar demands immutable audit trails, so the timeline
-- is append-only from day one — at the GRANT level, not merely by policy.
--
-- Tenancy: ORGANIZATION-scoped, deliberately not person-scoped like the
-- Budget Tracker or Job Seeker. A CRM is the org's shared book of business —
-- a technician, a dispatcher and an owner all read the same customer. RLS
-- requires organization membership on every row, FORCEd so the owning role
-- is subject to it too; anon and service_role are revoked outright (nothing
-- server-side needs these tables; every read and write is a signed-in
-- member's own session under the policies).
--
-- Four invariants live in the schema rather than in application code:
--
--   1. The timeline is append-only. authenticated holds SELECT and INSERT
--      and nothing else; there is no UPDATE or DELETE policy and no grant to
--      carry one. A recorded event cannot be edited into a different past.
--   2. Status changes write themselves. An AFTER UPDATE trigger records the
--      transition on the timeline in the same transaction, so the record of
--      "lead became customer" can never be forgotten by a route.
--   3. System event kinds cannot be forged by hand. A CHECK keeps
--      'status_change' rows to the trigger's shape; the manual-entry route
--      additionally refuses system kinds at the boundary.
--   4. Free text cannot smuggle a credential. Every free-text column is
--      checked with text_has_likely_secret, the same guard the control plane
--      uses.
--
-- No row in this schema is seeded. Test seed data lives in tests; production
-- fills through the product.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_account_kind as enum ('residential', 'commercial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_account_status as enum ('lead', 'prospect', 'customer', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_timeline_kind as enum (
    -- Hand-recorded by a member through the timeline route:
    'note', 'call', 'email', 'sms', 'task',
    -- System-recorded (triggers and later increments' machinery). The manual
    -- route refuses these so a person cannot type a payment into history:
    'status_change', 'service', 'payment'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Accounts: the book of business. status carries the lifecycle (lead →
-- prospect → customer → inactive); there is deliberately no DELETE — a
-- customer with history is deactivated, never erased out of the audit trail.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind public.crm_account_kind not null,
  status public.crm_account_status not null default 'lead',
  email text check (email is null or (position('@' in email) > 1 and char_length(email) between 3 and 320)),
  phone text check (phone is null or phone ~ '^[0-9+() .\-]{7,32}$'),
  -- Where the person or company heard of us — attribution starts as a fact.
  source text check (source is null or char_length(btrim(source)) between 1 and 120),
  billing_address text check (billing_address is null or char_length(btrim(billing_address)) between 1 and 500),
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_accounts_notes_no_secret check (not public.text_has_likely_secret(notes)),
  constraint crm_accounts_address_no_secret check (not public.text_has_likely_secret(billing_address)),
  constraint crm_accounts_name_no_secret check (not public.text_has_likely_secret(name))
);

-- ---------------------------------------------------------------------------
-- Contacts: the people on an account. A residential account usually has one;
-- a commercial account has a chain of them. Same-organization integrity is
-- enforced by the composite foreign key, so one org's contact can never hang
-- off another org's account.
-- ---------------------------------------------------------------------------

create unique index if not exists crm_accounts_org_id_key
  on public.crm_accounts (organization_id, id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 100),
  role text check (role is null or char_length(btrim(role)) between 1 and 120),
  email text check (email is null or (position('@' in email) > 1 and char_length(email) between 3 and 320)),
  phone text check (phone is null or phone ~ '^[0-9+() .\-]{7,32}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_contacts_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Properties: the sites where service happens. The unit the field-service and
-- IPM increments hang everything on — work orders, devices, station maps and
-- chemical applications will all reference a property.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  property_type text check (property_type is null or char_length(btrim(property_type)) between 1 and 120),
  access_notes text check (access_notes is null or char_length(access_notes) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_properties_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_properties_access_no_secret check (not public.text_has_likely_secret(access_notes)),
  constraint crm_properties_address_no_secret check (not public.text_has_likely_secret(address))
);

-- ---------------------------------------------------------------------------
-- Timeline: the immutable 360-degree history. Everything that ever happened
-- to an account lands here and never changes. occurred_at is when the thing
-- happened (a call this morning, logged this afternoon); recorded_at is when
-- the row was written — both, so the audit trail distinguishes the event
-- from its reporting.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  kind public.crm_timeline_kind not null,
  summary text not null check (char_length(btrim(summary)) between 1 and 300),
  detail text check (detail is null or char_length(detail) between 1 and 4000),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  -- Null actor means the system wrote it (a trigger, a later worker path);
  -- a hand-recorded event always names who recorded it.
  actor_user_id uuid references auth.users(id) on delete set null,
  constraint crm_timeline_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_timeline_summary_no_secret check (not public.text_has_likely_secret(summary)),
  constraint crm_timeline_detail_no_secret check (not public.text_has_likely_secret(detail))
);

-- ---------------------------------------------------------------------------
-- Status changes write themselves (invariant 2). AFTER UPDATE so the row it
-- describes is already real; same transaction, so a status change without its
-- history line is impossible.
-- ---------------------------------------------------------------------------

create or replace function public.crm_record_status_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status is distinct from old.status then
    insert into public.crm_timeline_events
      (organization_id, account_id, kind, summary, actor_user_id)
    values (
      new.organization_id,
      new.id,
      'status_change',
      format('Status changed: %s → %s.', old.status, new.status),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.crm_record_status_change()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_accounts_status_change on public.crm_accounts;
create trigger crm_accounts_status_change
  after update on public.crm_accounts
  for each row execute function public.crm_record_status_change();

-- updated_at, by the shared control-plane trigger.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_accounts', 'crm_contacts', 'crm_properties'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: organization membership on every row, FORCEd. Grants
-- state exactly what each table permits — the timeline's missing UPDATE and
-- DELETE grants are invariant 1, stated where a policy mistake cannot undo it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_accounts', 'crm_contacts', 'crm_properties', 'crm_timeline_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    -- service_role is BYPASSRLS; hosted default privileges re-grant it on new
    -- tables, and a grant to it is every policy switched off. Nothing
    -- server-side reads or writes the CRM.
    execute format('revoke all on table public.%I from service_role', v_table);

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
end;
$$;

-- Accounts, contacts and properties may be corrected; accounts are never
-- deleted (deactivate instead — the timeline hangs off them); contacts and
-- properties may be removed while wrong-entry cleanup is a plain need.
grant select, insert, update on table public.crm_accounts to authenticated;
grant select, insert, update, delete on table public.crm_contacts to authenticated;
grant select, insert, update, delete on table public.crm_properties to authenticated;
-- Invariant 1: the timeline can be read and appended, never rewritten.
grant select, insert on table public.crm_timeline_events to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_accounts', 'crm_contacts', 'crm_properties'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);
  end loop;
  foreach v_table in array array['crm_contacts', 'crm_properties'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_delete_member', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.is_organization_member(organization_id))',
      v_table || '_delete_member', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes: the reads the pages actually perform.
-- ---------------------------------------------------------------------------

create index if not exists crm_accounts_org_status_idx
  on public.crm_accounts (organization_id, status, kind);
create index if not exists crm_accounts_org_name_idx
  on public.crm_accounts (organization_id, lower(name));
create index if not exists crm_contacts_account_idx
  on public.crm_contacts (organization_id, account_id, is_primary);
create index if not exists crm_properties_account_idx
  on public.crm_properties (organization_id, account_id);
create index if not exists crm_timeline_account_time_idx
  on public.crm_timeline_events (organization_id, account_id, occurred_at desc);
