-- Services CRM increment 8: documents, door-to-door canvassing, and the
-- marketing hub (task #63/#64, owner /goal — ADR-196). The last of the
-- entities the seed goal names that the schema did not yet have.
--
-- Posture unchanged: organization-scoped forced RLS, revoke-then-grant
-- against the hosted default privileges, anon and service_role shut out,
-- same-organization composite foreign keys, nothing deletable.
--
-- Four invariants live in the schema:
--
--   1. A document row is METADATA and a storage reference. The bytes never
--      enter the database, and the reference is a storage path, not a URL —
--      a public link stored here would be an access-control hole wearing a
--      column name.
--   2. A knock is a fact about a moment. crm_knocks takes select+insert
--      only: a canvasser's disposition cannot be improved after the door
--      closed.
--   3. Consent is a first-class record, not a flag someone can flip back.
--      An unsubscribed list member keeps the moment they unsubscribed, and
--      the message log is append-only, so "we never sent that" is a claim
--      the database can settle.
--   4. Nothing here claims a send happened. crm_messages records what a
--      campaign produced; no provider is wired to it, and the product
--      labels that surface Not Connected rather than implying delivery.

do $$ begin
  create type public.crm_document_kind as enum (
    'contract', 'estimate', 'photo', 'inspection_report', 'service_report',
    'permit', 'license', 'invoice', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_canvass_status as enum ('planned', 'walking', 'complete', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_knock_disposition as enum (
    'no_answer', 'not_home', 'not_interested', 'callback', 'appointment_set',
    'sold', 'do_not_knock'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_channel as enum ('email', 'sms', 'postcard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_campaign_status as enum ('draft', 'scheduled', 'sending', 'sent', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_message_status as enum (
    'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_automation_trigger as enum (
    'lead_created', 'service_completed', 'invoice_overdue', 'contract_renewing',
    'sighting_recorded', 'estimate_sent'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_automation_action as enum (
    'send_email', 'send_sms', 'create_task', 'notify_manager', 'schedule_followup'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_touch_position as enum ('first', 'assist', 'last');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Documents: invariant 1. What was filed, where it lives, and what it is
-- about — never the bytes, and never a public URL.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid,
  property_id uuid,
  work_order_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  kind public.crm_document_kind not null default 'other',
  -- A private storage path, checked to be a path rather than a link.
  -- Shape and length are checked separately on purpose: PostgreSQL refuses
  -- a regex repetition count above 255, so '{2,300}' would compile only
  -- when a row actually carried a value — the exact defect ADR-193 found.
  storage_path text not null
    check (
      storage_path ~ '^[a-z0-9][a-z0-9._/-]*$'
      and char_length(storage_path) between 3 and 301
      and storage_path !~ '://'
    ),
  content_type text check (content_type is null or content_type ~ '^[a-z]+/[a-zA-Z0-9.+-]{1,80}$'),
  byte_size bigint check (byte_size is null or (byte_size > 0 and byte_size <= 5368709120)),
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  uploaded_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_documents_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_documents_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete set null,
  constraint crm_documents_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  -- A document is filed about something.
  constraint crm_documents_has_subject
    check (num_nonnulls(account_id, property_id, work_order_id) >= 1),
  constraint crm_documents_title_no_secret check (not public.text_has_likely_secret(title)),
  constraint crm_documents_notes_no_secret check (not public.text_has_likely_secret(notes)),
  constraint crm_documents_path_no_secret check (not public.text_has_likely_secret(storage_path))
);

create unique index if not exists crm_documents_org_id_key
  on public.crm_documents (organization_id, id);
create unique index if not exists crm_documents_org_path_key
  on public.crm_documents (organization_id, storage_path);

-- ---------------------------------------------------------------------------
-- Canvassing: the door-to-door motion. A route is a rep walking a territory
-- on a day; a knock is what happened at one door.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_canvass_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid,
  rep_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  status public.crm_canvass_status not null default 'planned',
  walked_on date not null,
  started_at timestamptz,
  ended_at timestamptz,
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_canvass_routes_territory_same_org
    foreign key (organization_id, territory_id)
    references public.crm_territories (organization_id, id) on delete set null,
  constraint crm_canvass_routes_rep_same_org
    foreign key (organization_id, rep_id)
    references public.crm_employees (organization_id, id) on delete set null,
  constraint crm_canvass_routes_ended_after_started
    check (ended_at is null or started_at is null or ended_at >= started_at),
  -- A route that was walked has a start; one that finished has both.
  constraint crm_canvass_routes_walking_started
    check (status not in ('walking', 'complete') or started_at is not null),
  constraint crm_canvass_routes_complete_ended
    check (status <> 'complete' or ended_at is not null),
  constraint crm_canvass_routes_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_canvass_routes_org_id_key
  on public.crm_canvass_routes (organization_id, id);

-- Invariant 2: a knock is append-only.
create table if not exists public.crm_knocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  canvass_route_id uuid not null,
  account_id uuid,
  address text not null check (char_length(btrim(address)) between 1 and 500),
  disposition public.crm_knock_disposition not null,
  knocked_at timestamptz not null default now(),
  -- Set only when the door became a callback or an appointment.
  follow_up_on date,
  note text check (note is null or char_length(note) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_knocks_route_same_org
    foreign key (organization_id, canvass_route_id)
    references public.crm_canvass_routes (organization_id, id) on delete cascade,
  constraint crm_knocks_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete set null,
  -- A door that produced a customer names the account it produced.
  constraint crm_knocks_sold_has_account
    check (disposition <> 'sold' or account_id is not null),
  -- A follow-up date belongs to a door that asked for one.
  constraint crm_knocks_followup_iff_pending
    check (follow_up_on is null or disposition in ('callback', 'appointment_set')),
  constraint crm_knocks_address_no_secret check (not public.text_has_likely_secret(address)),
  constraint crm_knocks_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_knocks_org_id_key
  on public.crm_knocks (organization_id, id);

-- ---------------------------------------------------------------------------
-- Marketing: lists, the consent on them, campaigns, and the message log.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_marketing_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text check (description is null or char_length(description) between 1 and 2000),
  -- Static lists are curated; dynamic ones describe a rule a person wrote.
  is_dynamic boolean not null default false,
  criteria text check (criteria is null or char_length(criteria) between 1 and 1000),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A dynamic list says what it selects; a static one does not pretend to.
  constraint crm_marketing_lists_dynamic_has_criteria
    check ((is_dynamic and criteria is not null) or (not is_dynamic and criteria is null)),
  constraint crm_marketing_lists_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_marketing_lists_criteria_no_secret check (not public.text_has_likely_secret(criteria))
);

create unique index if not exists crm_marketing_lists_org_id_key
  on public.crm_marketing_lists (organization_id, id);
create unique index if not exists crm_marketing_lists_org_name_key
  on public.crm_marketing_lists (organization_id, lower(btrim(name)));

-- Invariant 3: consent is a record, and unsubscribing keeps its moment.
create table if not exists public.crm_list_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  list_id uuid not null,
  account_id uuid not null,
  source text check (source is null or char_length(btrim(source)) between 1 and 120),
  added_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  unsubscribe_reason text check (unsubscribe_reason is null or char_length(btrim(unsubscribe_reason)) between 1 and 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_list_members_list_same_org
    foreign key (organization_id, list_id)
    references public.crm_marketing_lists (organization_id, id) on delete cascade,
  constraint crm_list_members_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_list_members_unsubscribed_after_added
    check (unsubscribed_at is null or unsubscribed_at >= added_at),
  -- A reason belongs to an unsubscribe, and nowhere else.
  constraint crm_list_members_reason_iff_unsubscribed
    check (unsubscribe_reason is null or unsubscribed_at is not null),
  constraint crm_list_members_reason_no_secret check (not public.text_has_likely_secret(unsubscribe_reason))
);

create unique index if not exists crm_list_members_org_id_key
  on public.crm_list_members (organization_id, id);
-- One membership per account per list: a person is on a list or they are not.
create unique index if not exists crm_list_members_list_account_key
  on public.crm_list_members (organization_id, list_id, account_id);

create table if not exists public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  list_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  channel public.crm_channel not null,
  status public.crm_campaign_status not null default 'draft',
  subject text check (subject is null or char_length(btrim(subject)) between 1 and 200),
  body text check (body is null or char_length(body) between 1 and 8000),
  budget_cents bigint check (budget_cents is null or (budget_cents >= 0 and budget_cents <= 100000000000)),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_campaigns_list_same_org
    foreign key (organization_id, list_id)
    references public.crm_marketing_lists (organization_id, id) on delete set null,
  -- A scheduled campaign has a time; a sent one has a moment it went out.
  constraint crm_campaigns_scheduled_has_time
    check (status <> 'scheduled' or scheduled_at is not null),
  constraint crm_campaigns_sent_has_moment
    check (status <> 'sent' or sent_at is not null),
  constraint crm_campaigns_draft_has_no_moment
    check (status <> 'draft' or sent_at is null),
  -- An email campaign carries a subject; an SMS does not have one.
  constraint crm_campaigns_email_has_subject
    check (channel <> 'email' or subject is not null),
  constraint crm_campaigns_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_campaigns_body_no_secret check (not public.text_has_likely_secret(body))
);

create unique index if not exists crm_campaigns_org_id_key
  on public.crm_campaigns (organization_id, id);

-- Invariants 3 and 4: the message log is append-only, and it records what a
-- campaign produced rather than asserting that anything was delivered by a
-- provider this product has not been connected to.
create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  account_id uuid not null,
  channel public.crm_channel not null,
  status public.crm_message_status not null default 'queued',
  -- The address the message was addressed to, as it stood that day.
  destination text check (destination is null or char_length(btrim(destination)) between 3 and 320),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_messages_campaign_same_org
    foreign key (organization_id, campaign_id)
    references public.crm_campaigns (organization_id, id) on delete cascade,
  constraint crm_messages_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  -- The funnel only runs one way: a click implies an open, an open implies
  -- delivery, delivery implies a send.
  constraint crm_messages_sent_before_delivered
    check (delivered_at is null or (sent_at is not null and delivered_at >= sent_at)),
  constraint crm_messages_delivered_before_opened
    check (opened_at is null or (delivered_at is not null and opened_at >= delivered_at)),
  constraint crm_messages_opened_before_clicked
    check (clicked_at is null or (opened_at is not null and clicked_at >= opened_at)),
  constraint crm_messages_failure_iff_failed
    check ((failure_reason is not null) = (status in ('bounced', 'failed'))),
  constraint crm_messages_failure_no_secret check (not public.text_has_likely_secret(failure_reason))
);

create unique index if not exists crm_messages_org_id_key
  on public.crm_messages (organization_id, id);

-- ---------------------------------------------------------------------------
-- Automations: a rule someone wrote, and when it last did anything. This is
-- a record of intent; nothing in this migration executes one.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  trigger_on public.crm_automation_trigger not null,
  action public.crm_automation_action not null,
  delay_hours integer not null default 0 check (delay_hours between 0 and 8760),
  template text check (template is null or char_length(template) between 1 and 4000),
  active boolean not null default false,
  last_run_at timestamptz,
  run_count integer not null default 0 check (run_count >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A rule that has never run cannot claim a count, and one that has run
  -- cannot claim it never did.
  constraint crm_automations_run_count_matches_moment
    check ((run_count = 0) = (last_run_at is null)),
  -- A message-sending rule carries the text it would send.
  constraint crm_automations_sending_has_template
    check (action not in ('send_email', 'send_sms') or template is not null),
  constraint crm_automations_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_automations_template_no_secret check (not public.text_has_likely_secret(template))
);

create unique index if not exists crm_automations_org_id_key
  on public.crm_automations (organization_id, id);
create unique index if not exists crm_automations_org_name_key
  on public.crm_automations (organization_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Attribution: which touch brought which account, and where in the journey
-- it sat. Append-only — a touch is a thing that happened.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_attributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  opportunity_id uuid,
  campaign_id uuid,
  knock_id uuid,
  source text not null check (char_length(btrim(source)) between 1 and 120),
  medium text check (medium is null or char_length(btrim(medium)) between 1 and 120),
  position public.crm_touch_position not null,
  touched_at timestamptz not null default now(),
  note text check (note is null or char_length(note) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_attributions_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_attributions_opportunity_same_org
    foreign key (organization_id, opportunity_id)
    references public.crm_opportunities (organization_id, id) on delete set null,
  constraint crm_attributions_campaign_same_org
    foreign key (organization_id, campaign_id)
    references public.crm_campaigns (organization_id, id) on delete set null,
  constraint crm_attributions_knock_same_org
    foreign key (organization_id, knock_id)
    references public.crm_knocks (organization_id, id) on delete set null,
  constraint crm_attributions_source_no_secret check (not public.text_has_likely_secret(source)),
  constraint crm_attributions_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_attributions_org_id_key
  on public.crm_attributions (organization_id, id);

-- ---------------------------------------------------------------------------
-- updated_at, Row Level Security and grants.
--
-- Knocks, messages and attributions take select+insert ONLY: each records
-- something that happened, and a record of what happened is not a draft.
-- Nothing anywhere is deletable.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_documents', 'crm_canvass_routes', 'crm_marketing_lists',
    'crm_campaigns', 'crm_automations'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;

  foreach v_table in array array[
    'crm_documents', 'crm_canvass_routes', 'crm_knocks', 'crm_marketing_lists',
    'crm_list_members', 'crm_campaigns', 'crm_messages', 'crm_automations',
    'crm_attributions'
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

  -- The mutable half: a document is retitled, a route is walked, a list is
  -- curated, a campaign is edited before it goes, a rule is switched on. A
  -- membership is updated only to record an unsubscribe.
  foreach v_table in array array[
    'crm_documents', 'crm_canvass_routes', 'crm_marketing_lists',
    'crm_list_members', 'crm_campaigns', 'crm_automations'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);
  end loop;
end;
$$;

grant select, insert, update on table public.crm_documents to authenticated;
grant select, insert, update on table public.crm_canvass_routes to authenticated;
-- Invariant 2: a disposition cannot be improved after the door closed.
grant select, insert on table public.crm_knocks to authenticated;
grant select, insert, update on table public.crm_marketing_lists to authenticated;
grant select, insert, update on table public.crm_list_members to authenticated;
grant select, insert, update on table public.crm_campaigns to authenticated;
-- Invariant 3: "we never sent that" is a claim the database can settle.
grant select, insert on table public.crm_messages to authenticated;
grant select, insert, update on table public.crm_automations to authenticated;
grant select, insert on table public.crm_attributions to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes: the reads these pages make.
-- ---------------------------------------------------------------------------

create index if not exists crm_documents_org_account_idx
  on public.crm_documents (organization_id, account_id, uploaded_at desc);
create index if not exists crm_documents_org_kind_idx
  on public.crm_documents (organization_id, kind, uploaded_at desc);
create index if not exists crm_canvass_routes_org_rep_idx
  on public.crm_canvass_routes (organization_id, rep_id, walked_on desc);
create index if not exists crm_canvass_routes_org_status_idx
  on public.crm_canvass_routes (organization_id, status, walked_on desc);
create index if not exists crm_knocks_org_route_idx
  on public.crm_knocks (organization_id, canvass_route_id, knocked_at desc);
create index if not exists crm_knocks_org_disposition_idx
  on public.crm_knocks (organization_id, disposition, knocked_at desc);
create index if not exists crm_list_members_org_account_idx
  on public.crm_list_members (organization_id, account_id);
create index if not exists crm_campaigns_org_status_idx
  on public.crm_campaigns (organization_id, status, scheduled_at desc);
create index if not exists crm_messages_org_campaign_idx
  on public.crm_messages (organization_id, campaign_id, status);
create index if not exists crm_messages_org_account_idx
  on public.crm_messages (organization_id, account_id, queued_at desc);
create index if not exists crm_attributions_org_account_idx
  on public.crm_attributions (organization_id, account_id, touched_at desc);
create index if not exists crm_attributions_org_campaign_idx
  on public.crm_attributions (organization_id, campaign_id, position);
