-- Services CRM increment 2: pipeline & opportunities, duplicate detection,
-- global search (task #63, owner /goal — ADR-186).
--
-- Opportunities give the book of business its sales motion: a named deal on
-- an account, staged from first contact to won or lost, valued in cents,
-- dated with an expected close. Two things live in the schema because a
-- route cannot be trusted to remember them:
--
--   1. Stage moves write themselves to the account timeline (the same
--      AFTER UPDATE pattern as account status changes), so conversion
--      history is an audit fact, not a UI courtesy.
--   2. closed_at is maintained by trigger and CHECKed to exist exactly when
--      the stage is terminal, so "closed this month" reporting can never
--      disagree with the stage column.
--
-- Opportunities carry the organization's conversion truth — win rate is
-- won/(won+lost) — so there is deliberately NO DELETE: a dead deal is marked
-- lost with its reason, never erased into a better-looking rate.
--
-- Duplicate detection: normalized generated columns on crm_accounts
-- (lowercased alphanumeric name, lowercased trimmed email, digits-only
-- phone) let the create route SURFACE likely duplicates before insert. The
-- product never merges records on its own — a person decides.
--
-- Hosted default privileges GRANT ALL on every new table (the
-- 20260830000600 lesson), so this migration states crm_opportunities'
-- grants as revoke-then-grant: a capability expressed as the absence of a
-- grant must remove the default before it can be absent.

do $$ begin
  create type public.crm_opportunity_stage as enum (
    'new', 'contacted', 'inspection', 'proposal', 'negotiation', 'won', 'lost'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Opportunities: one deal on one account. Same-organization integrity by the
-- composite foreign key, like contacts and properties.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  stage public.crm_opportunity_stage not null default 'new',
  -- Cents, so money is never a float. Bounded at $1B: a value past that is a
  -- typo, not a pest-control contract.
  value_cents bigint check (value_cents is null or value_cents between 0 and 100000000000),
  expected_close_date date,
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  lost_reason text check (lost_reason is null or char_length(btrim(lost_reason)) between 1 and 300),
  closed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_opportunities_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  -- A loss reason on a deal that is not lost is a contradiction.
  constraint crm_opportunities_lost_reason_only_lost
    check (lost_reason is null or stage = 'lost'),
  -- closed_at exists exactly when the stage is terminal — kept true by the
  -- trigger below; stated here so no later writer can break reporting.
  constraint crm_opportunities_closed_iff_terminal
    check ((stage in ('won', 'lost')) = (closed_at is not null)),
  constraint crm_opportunities_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_opportunities_notes_no_secret check (not public.text_has_likely_secret(notes)),
  constraint crm_opportunities_lost_reason_no_secret check (not public.text_has_likely_secret(lost_reason))
);

-- closed_at follows the stage, on insert and on every move: set when a deal
-- enters won/lost, cleared when it reopens, untouched while it merely edits.
create or replace function public.crm_opportunity_set_closed_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.stage in ('won', 'lost') then
    if tg_op = 'INSERT' or old.stage is distinct from new.stage then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_opportunity_set_closed_at()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_opportunities_set_closed_at on public.crm_opportunities;
create trigger crm_opportunities_set_closed_at
  before insert or update on public.crm_opportunities
  for each row execute function public.crm_opportunity_set_closed_at();

-- Stage moves write themselves to the account's timeline, same transaction,
-- same 'status_change' system kind the manual route refuses. A lost deal's
-- reason travels in detail, where 4000 characters fit.
create or replace function public.crm_record_opportunity_stage_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.crm_timeline_events
      (organization_id, account_id, kind, summary, detail, actor_user_id)
    values (
      new.organization_id,
      new.account_id,
      'status_change',
      format('Opportunity "%s": %s → %s.', new.name, old.stage, new.stage),
      case when new.stage = 'lost' then new.lost_reason else null end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.crm_record_opportunity_stage_change()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_opportunities_stage_change on public.crm_opportunities;
create trigger crm_opportunities_stage_change
  after update on public.crm_opportunities
  for each row execute function public.crm_record_opportunity_stage_change();

drop trigger if exists crm_opportunities_set_updated_at on public.crm_opportunities;
create trigger crm_opportunities_set_updated_at
  before update on public.crm_opportunities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: the foundation's exact posture — membership on every
-- row, FORCEd, anon and service_role shut out. Grants are revoke-then-grant
-- because hosted default privileges granted ALL the moment the table above
-- was created; the absence of DELETE and of any anon/service_role grant is
-- this table's capability statement.
-- ---------------------------------------------------------------------------

alter table public.crm_opportunities enable row level security;
alter table public.crm_opportunities force row level security;

revoke all on table public.crm_opportunities
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.crm_opportunities to authenticated;

drop policy if exists crm_opportunities_select_member on public.crm_opportunities;
create policy crm_opportunities_select_member on public.crm_opportunities
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists crm_opportunities_insert_member on public.crm_opportunities;
create policy crm_opportunities_insert_member on public.crm_opportunities
  for insert to authenticated
  with check (public.is_organization_member(organization_id));

drop policy if exists crm_opportunities_update_member on public.crm_opportunities;
create policy crm_opportunities_update_member on public.crm_opportunities
  for update to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

-- ---------------------------------------------------------------------------
-- Duplicate detection: normalized identity columns, computed by the database
-- so the route's comparison and the stored value can never disagree. All are
-- null when nothing meaningful remains — a normal that is '' matches
-- everything and detects nothing.
-- ---------------------------------------------------------------------------

alter table public.crm_accounts
  add column if not exists name_normal text generated always as
    (nullif(lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')), '')) stored,
  add column if not exists email_normal text generated always as
    (nullif(lower(btrim(coalesce(email, ''))), '')) stored,
  add column if not exists phone_normal text generated always as
    (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored;

-- ---------------------------------------------------------------------------
-- Indexes: the duplicate probes and the pipeline reads.
-- ---------------------------------------------------------------------------

create index if not exists crm_accounts_org_name_normal_idx
  on public.crm_accounts (organization_id, name_normal);
create index if not exists crm_accounts_org_email_normal_idx
  on public.crm_accounts (organization_id, email_normal) where email_normal is not null;
create index if not exists crm_accounts_org_phone_normal_idx
  on public.crm_accounts (organization_id, phone_normal) where phone_normal is not null;
create index if not exists crm_opportunities_org_stage_idx
  on public.crm_opportunities (organization_id, stage, updated_at desc);
create index if not exists crm_opportunities_account_idx
  on public.crm_opportunities (organization_id, account_id);
