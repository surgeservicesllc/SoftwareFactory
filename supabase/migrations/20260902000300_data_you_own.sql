-- ---------------------------------------------------------------------------
-- Increment 28 — data you own (ADR-230).
--
-- Three complaints, one root: the customer's data is treated as the
-- vendor's. HubSpot "creates new properties if I don't set everything
-- correctly" on import and leaves "duplicate companies with no cleanup
-- tools"; PestPac users say errors "cannot be corrected" and that their
-- data is "held hostage", with migration "expensive, incomplete, and
-- requiring extreme manual work daily".
--
-- This file gives the database three things:
--
--   crm_accounts.merged_into_id   a merged account is a real record that
--                                 says where it went, not a deleted one
--   crm_imports                   an append-only log of what an import did
--   crm_merge_accounts()          the merge itself, one statement, audited
--
-- The import's refusal to invent a column, and the export, live in the
-- routes: neither needs schema. What the merge needs from the schema is
-- exactly this: a way to leave the loser readable and pointing at the
-- survivor, and a single definer that re-points every child in ONE
-- statement so the composite foreign keys (organization, account,
-- property) are checked once, at the end, when they are all true.
-- ---------------------------------------------------------------------------

alter table public.crm_accounts
  add column if not exists merged_into_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_accounts_merged_into_same_org'
  ) then
    alter table public.crm_accounts
      add constraint crm_accounts_merged_into_same_org
        foreign key (organization_id, merged_into_id)
        references public.crm_accounts (organization_id, id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crm_accounts_merged_is_inactive'
  ) then
    -- A merged account is inactive; it cannot be a customer somewhere else.
    alter table public.crm_accounts
      add constraint crm_accounts_merged_is_inactive
        check (merged_into_id is null or status = 'inactive');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crm_accounts_merged_not_self'
  ) then
    alter table public.crm_accounts
      add constraint crm_accounts_merged_not_self
        check (merged_into_id is null or merged_into_id <> id);
  end if;
end;
$$;

create index if not exists crm_accounts_org_merged_into_idx
  on public.crm_accounts (organization_id, merged_into_id)
  where merged_into_id is not null;

-- ---------------------------------------------------------------------------
-- What an import did. Only a COMMITTED import is recorded — a dry run is
-- a question, not an event. The mapping is kept so "why does this account
-- have that source?" can be answered a year later.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_label text not null check (char_length(btrim(source_label)) between 1 and 160),
  mapping jsonb not null,
  row_count integer not null check (row_count between 0 and 1000000),
  created_accounts integer not null check (created_accounts >= 0),
  created_properties integer not null check (created_properties >= 0),
  created_contacts integer not null check (created_contacts >= 0),
  skipped_duplicates integer not null check (skipped_duplicates >= 0),
  invalid_rows integer not null check (invalid_rows >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint crm_imports_accounts_within_rows
    check (created_accounts + skipped_duplicates + invalid_rows <= row_count),
  constraint crm_imports_label_no_secret check (not public.text_has_likely_secret(source_label))
);

create unique index if not exists crm_imports_org_id_key
  on public.crm_imports (organization_id, id);
create index if not exists crm_imports_org_created_idx
  on public.crm_imports (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The merge.
--
-- DEFINER, because re-pointing touches ledgers whose browser roles hold no
-- UPDATE grant on purpose (payments, applications, notices) — a merge is
-- the one legitimate reason a payment's account changes, and it changes
-- to the account that IS the same customer. Membership is checked
-- explicitly at the top, exactly as the grant would have.
--
-- Everything is re-pointed in ONE statement. The ten tables whose foreign
-- key is (organization, account, property) cannot be updated one table at
-- a time: moving a property first orphans its work orders, moving the
-- work orders first points them at a property row that does not yet
-- exist. Data-modifying CTEs run as one statement and the keys are checked
-- once, at the end, when every row already agrees.
--
-- What is NOT moved: the loser's history. The timeline is immutable, and a
-- merge does not rewrite what happened to whom; the loser stays readable,
-- points at the survivor, and both accounts get a line saying so. Two
-- kinds of row are left behind where the survivor already has their
-- equivalent — list membership for the same list, and a contact
-- preference for the same channel — because a consent record is not
-- something a merge should silently overwrite.
--
-- Two collisions REFUSE the merge rather than guess: a portal login with
-- the same email on both sides (which account would that person see?),
-- and a live autopay enrollment on both (which card would be charged?).
-- ---------------------------------------------------------------------------

create or replace function public.crm_merge_accounts(p_survivor uuid, p_loser uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_loser_org uuid;
  v_survivor_name text;
  v_loser_name text;
  v_survivor_merged uuid;
  v_loser_merged uuid;
  v_counts jsonb;
begin
  if p_survivor = p_loser then
    raise exception 'an account cannot be merged into itself' using errcode = 'check_violation';
  end if;

  select a.organization_id, a.name, a.merged_into_id
    into v_org, v_survivor_name, v_survivor_merged
    from public.crm_accounts a where a.id = p_survivor;
  select a.organization_id, a.name, a.merged_into_id
    into v_loser_org, v_loser_name, v_loser_merged
    from public.crm_accounts a where a.id = p_loser;

  if v_org is null or v_loser_org is null or v_org <> v_loser_org then
    raise exception 'both accounts must exist in the same workspace' using errcode = 'no_data_found';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception 'not a member of this workspace' using errcode = 'insufficient_privilege';
  end if;
  if v_survivor_merged is not null then
    raise exception '% was already merged into another account', v_survivor_name
      using errcode = 'check_violation';
  end if;
  if v_loser_merged is not null then
    raise exception '% was already merged into another account', v_loser_name
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.crm_portal_users l
      join public.crm_portal_users s
        on s.organization_id = l.organization_id
       and s.account_id = p_survivor
       and lower(s.email) = lower(l.email)
     where l.organization_id = v_org and l.account_id = p_loser
  ) then
    raise exception 'both accounts have a portal login for the same email; decide which one stays before merging'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.crm_autopay_enrollments e
              where e.organization_id = v_org and e.account_id = p_survivor and e.revoked_at is null)
     and exists (select 1 from public.crm_autopay_enrollments e
                  where e.organization_id = v_org and e.account_id = p_loser and e.revoked_at is null)
  then
    raise exception 'both accounts have a live autopay enrollment; revoke one before merging'
      using errcode = 'check_violation';
  end if;

  with
    -- The property tree: properties and the ten tables keyed on them.
    props as (
      update public.crm_properties set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    work_orders as (
      update public.crm_work_orders set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    plans as (
      update public.crm_service_plans set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    sightings as (
      update public.crm_pest_sightings set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    devices as (
      update public.crm_devices set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    applications as (
      update public.crm_applications set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    documents as (
      update public.crm_documents set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    estimates as (
      update public.crm_estimates set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    forms as (
      update public.crm_form_instances set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    requests as (
      update public.crm_portal_requests set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    wdo as (
      update public.crm_wdo_inspections set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    -- Everything else keyed on the account alone.
    contacts as (
      update public.crm_contacts set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    opportunities as (
      update public.crm_opportunities set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    contracts as (
      update public.crm_contracts set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    invoices as (
      update public.crm_invoices set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    payments as (
      update public.crm_payments set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    dunning as (
      update public.crm_dunning_notices set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    notices as (
      update public.crm_notices set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    messages as (
      update public.crm_messages set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    attributions as (
      update public.crm_attributions set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    knocks as (
      update public.crm_knocks set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    service_documents as (
      update public.crm_service_documents set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    portal_users as (
      update public.crm_portal_users set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    instruments as (
      update public.crm_payment_instruments set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    mandates as (
      update public.crm_payment_mandates set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    enrollments as (
      update public.crm_autopay_enrollments set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    tasks as (
      update public.crm_tasks set account_id = p_survivor
       where organization_id = v_org and account_id = p_loser returning 1),
    -- Left behind where the survivor already holds the equivalent.
    memberships as (
      update public.crm_list_members m set account_id = p_survivor
       where m.organization_id = v_org and m.account_id = p_loser
         and not exists (
           select 1 from public.crm_list_members s
            where s.organization_id = v_org and s.list_id = m.list_id and s.account_id = p_survivor)
       returning 1),
    preferences as (
      update public.crm_contact_preferences p set account_id = p_survivor
       where p.organization_id = v_org and p.account_id = p_loser
         and not exists (
           select 1 from public.crm_contact_preferences s
            where s.organization_id = v_org and s.channel = p.channel and s.account_id = p_survivor)
       returning 1)
  select jsonb_build_object(
           'properties', (select count(*) from props),
           'workOrders', (select count(*) from work_orders),
           'servicePlans', (select count(*) from plans),
           'sightings', (select count(*) from sightings),
           'devices', (select count(*) from devices),
           'applications', (select count(*) from applications),
           'documents', (select count(*) from documents),
           'estimates', (select count(*) from estimates),
           'formInstances', (select count(*) from forms),
           'portalRequests', (select count(*) from requests),
           'wdoInspections', (select count(*) from wdo),
           'contacts', (select count(*) from contacts),
           'opportunities', (select count(*) from opportunities),
           'contracts', (select count(*) from contracts),
           'invoices', (select count(*) from invoices),
           'payments', (select count(*) from payments),
           'dunningNotices', (select count(*) from dunning),
           'notices', (select count(*) from notices),
           'messages', (select count(*) from messages),
           'attributions', (select count(*) from attributions),
           'knocks', (select count(*) from knocks),
           'serviceDocuments', (select count(*) from service_documents),
           'portalUsers', (select count(*) from portal_users),
           'paymentInstruments', (select count(*) from instruments),
           'paymentMandates', (select count(*) from mandates),
           'autopayEnrollments', (select count(*) from enrollments),
           'tasks', (select count(*) from tasks),
           'listMemberships', (select count(*) from memberships),
           'contactPreferences', (select count(*) from preferences))
    into v_counts;

  -- The loser stays, inactive, pointing at where it went. The status
  -- trigger writes its own history line; these two say why.
  update public.crm_accounts
     set status = 'inactive', merged_into_id = p_survivor
   where organization_id = v_org and id = p_loser;

  insert into public.crm_timeline_events
    (organization_id, account_id, kind, summary, detail, actor_user_id)
  values
    (v_org, p_loser, 'note',
     left(format('Merged into %s.', v_survivor_name), 300),
     'Every contact, location, visit, document and invoice now belongs to that account. This record stays for its history.',
     auth.uid()),
    (v_org, p_survivor, 'note',
     left(format('Absorbed %s.', v_loser_name), 300),
     left(format('Re-pointed: %s.', (
       select string_agg(format('%s %s', value, key), ', ' order by key)
         from jsonb_each_text(v_counts) where value <> '0')), 4000),
     auth.uid());

  return v_counts;
end;
$$;

revoke all on function public.crm_merge_accounts(uuid, uuid) from public, anon, service_role;
grant execute on function public.crm_merge_accounts(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. REVOKE first: hosted default privileges grant ALL.
-- The import log is append-only: what an import did is not a thing to
-- edit later.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_imports enable row level security';
  execute 'alter table public.crm_imports force row level security';
  execute 'revoke all on table public.crm_imports
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_imports_select_member on public.crm_imports';
  execute 'create policy crm_imports_select_member on public.crm_imports
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_imports_insert_member on public.crm_imports';
  execute 'create policy crm_imports_insert_member on public.crm_imports
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'grant select, insert on table public.crm_imports to authenticated';
end;
$$;
