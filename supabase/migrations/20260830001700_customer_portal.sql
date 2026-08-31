-- Services CRM increment 10: the customer portal (task #64, owner /goal —
-- ADR-197). Both PestPac and Briostack lead with this; the competitor
-- matrix marks it the largest remaining gap.
--
-- THIS IS THE MOST SECURITY-SENSITIVE MIGRATION IN THE CRM. Everything
-- before it was staff-facing: every table is organization-scoped, and the
-- only reader is a member of that organization. A portal adds a reader who
-- is NOT a member — a customer, who must see exactly one account's rows and
-- nothing else, ever.
--
-- So the design deliberately does NOT widen a single existing policy. Not
-- one `using` clause in this schema is touched. A portal reader gets in
-- through reviewed SECURITY DEFINER functions that resolve the caller to
-- exactly one account and filter every read by it. That means:
--
--   * a mistake here cannot silently widen staff-facing access, because
--     staff-facing access is not edited;
--   * the entire customer-visible surface is the bodies of a handful of
--     functions in this file, which is a reviewable amount of code;
--   * and a customer with no portal link resolves to no account, so the
--     functions return nothing rather than everything.
--
-- Four invariants:
--
--   1. ONE PORTAL USER SEES EXACTLY ONE ACCOUNT. The link is unique per
--      login, and every read filters by the account it resolves to.
--   2. THE PORTAL READS A NARROWED PROJECTION, NEVER A TABLE. Internal
--      notes, costs, technician licences and staff commentary are not in
--      the returned columns at all — not hidden by a policy, absent from
--      the projection.
--   3. A SERVICE REQUEST IS THE CUSTOMER'S WORDS. Portal users insert and
--      read their own requests; they cannot edit one after sending it, and
--      they can never write anything else.
--   4. AN INACTIVE LINK IS NO LINK. Deactivating a portal user closes the
--      door immediately, because every function re-resolves on each call.

-- A composite reference needs its target's unique index to exist first, and
-- crm_contacts never had a reason to carry one. This is the fifth time this
-- ordering has bitten in this chain; the local replay catches it every time,
-- which is exactly why the replay runs before anything is pushed.
create unique index if not exists crm_contacts_org_account_id_key
  on public.crm_contacts (organization_id, account_id, id);

do $$ begin
  create type public.crm_portal_role as enum ('viewer', 'payer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_request_kind as enum (
    'service', 'reschedule', 'question', 'complaint', 'cancel', 'quote'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_request_status as enum (
    'submitted', 'acknowledged', 'scheduled', 'resolved', 'declined'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The link. One login, one account — invariant 1.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_portal_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  contact_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (position('@' in email) > 1 and char_length(email) between 3 and 320),
  role public.crm_portal_role not null default 'viewer',
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  last_seen_at timestamptz,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_portal_users_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_portal_users_contact_same_account
    foreign key (organization_id, account_id, contact_id)
    references public.crm_contacts (organization_id, account_id, id) on delete set null,
  -- An activated link has a login behind it; an invitation not yet accepted
  -- has neither, and cannot be mistaken for one that has.
  constraint crm_portal_users_activated_has_login
    check ((activated_at is null) = (user_id is null))
);

create unique index if not exists crm_portal_users_org_id_key
  on public.crm_portal_users (organization_id, id);
-- Invariant 1: a login belongs to exactly one account, across every tenant.
create unique index if not exists crm_portal_users_user_key
  on public.crm_portal_users (user_id) where user_id is not null;
create unique index if not exists crm_portal_users_org_account_email_key
  on public.crm_portal_users (organization_id, account_id, lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- Service requests: invariant 3. The customer's words, and the staff
-- triage that follows them.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_portal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid,
  portal_user_id uuid,
  kind public.crm_request_kind not null default 'service',
  status public.crm_request_status not null default 'submitted',
  summary text not null check (char_length(btrim(summary)) between 1 and 200),
  detail text check (detail is null or char_length(detail) between 1 and 4000),
  preferred_date date,
  -- Staff's answer, which the customer sees. Deliberately a separate column
  -- from `detail`: the customer's words are never overwritten by the reply.
  response text check (response is null or char_length(response) between 1 and 4000),
  work_order_id uuid,
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint crm_portal_requests_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_portal_requests_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete set null,
  constraint crm_portal_requests_portal_user_same_org
    foreign key (organization_id, portal_user_id)
    references public.crm_portal_users (organization_id, id) on delete set null,
  constraint crm_portal_requests_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_portal_requests_closed_iff_moment
    check ((status in ('resolved', 'declined')) = (resolved_at is not null)),
  constraint crm_portal_requests_summary_no_secret
    check (not public.text_has_likely_secret(summary)),
  constraint crm_portal_requests_detail_no_secret
    check (not public.text_has_likely_secret(detail)),
  constraint crm_portal_requests_response_no_secret
    check (not public.text_has_likely_secret(response))
);

create unique index if not exists crm_portal_requests_org_id_key
  on public.crm_portal_requests (organization_id, id);

-- ---------------------------------------------------------------------------
-- The resolver. Every portal read goes through this, and it is the only
-- place the caller becomes an account.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_account_for(p_user uuid)
returns table (organization_id uuid, account_id uuid, portal_user_id uuid, role public.crm_portal_role)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.organization_id, p.account_id, p.id, p.role
    from public.crm_portal_users p
   where p.user_id = p_user
     -- Invariant 4: an inactive link is no link, checked on every call
     -- rather than at sign-in, so revoking access takes effect at once.
     and p.active
     and p.activated_at is not null
   limit 1;
$$;

revoke all on function public.crm_portal_account_for(uuid) from public, anon, service_role;
grant execute on function public.crm_portal_account_for(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The customer-visible projections — invariant 2. Each returns named
-- columns, and internal fields are absent from the projection rather than
-- filtered out of a row. Read the column lists: that is the entire surface
-- a customer can see.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_summary()
returns table (
  account_name text,
  account_status public.crm_account_status,
  open_invoices integer,
  balance_cents bigint,
  next_visit_on date,
  open_requests integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (select * from public.crm_portal_account_for(auth.uid()))
  select
    a.name,
    a.status,
    (select count(*)::integer from public.crm_invoices i
      where i.account_id = me.account_id and i.status = 'open'),
    (select coalesce(sum(i.total_cents - i.paid_cents), 0)::bigint from public.crm_invoices i
      where i.account_id = me.account_id and i.status = 'open'),
    (select min(w.scheduled_start)::date from public.crm_work_orders w
      where w.account_id = me.account_id
        and w.status in ('scheduled', 'dispatched')
        and w.scheduled_start >= now()),
    (select count(*)::integer from public.crm_portal_requests r
      where r.account_id = me.account_id and r.status not in ('resolved', 'declined'))
  from me
  join public.crm_accounts a on a.id = me.account_id;
$$;

create or replace function public.crm_portal_invoices()
returns table (
  id uuid,
  number text,
  status public.crm_invoice_status,
  total_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  issued_on date,
  due_on date
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select i.id, i.number, i.status, i.total_cents, i.paid_cents,
         greatest(i.total_cents - i.paid_cents, 0)::bigint, i.issued_on, i.due_on
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_invoices i on i.account_id = me.account_id
   -- A draft invoice has not been issued to anybody, so it is not the
   -- customer's to see.
   where i.status <> 'draft'
   order by i.issued_on desc nulls last
   limit 200;
$$;

create or replace function public.crm_portal_visits()
returns table (
  id uuid,
  service_type text,
  status public.crm_work_order_status,
  scheduled_start timestamptz,
  completed_at timestamptz,
  property_label text,
  completion_notes text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select w.id, w.service_type, w.status, w.scheduled_start, w.completed_at,
         p.label,
         -- The technician's completion note is written for the customer and
         -- is shown. `instructions` — the dispatch note about the site and
         -- its access — is internal, and is simply not selected.
         w.completion_notes
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_work_orders w on w.account_id = me.account_id
    left join public.crm_properties p on p.id = w.property_id
   order by coalesce(w.completed_at, w.scheduled_start) desc
   limit 200;
$$;

create or replace function public.crm_portal_documents()
returns table (
  id uuid,
  title text,
  kind public.crm_document_kind,
  storage_path text,
  content_type text,
  byte_size bigint,
  uploaded_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select d.id, d.title, d.kind, d.storage_path, d.content_type, d.byte_size, d.uploaded_at
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_documents d on d.account_id = me.account_id
   -- The customer's own paperwork: agreements, reports, permits, invoices.
   -- Internal photographs and correspondence are not in this list.
   where d.kind in ('contract', 'estimate', 'inspection_report', 'service_report', 'permit', 'invoice')
   order by d.uploaded_at desc
   limit 200;
$$;

create or replace function public.crm_portal_requests_mine()
returns table (
  id uuid,
  kind public.crm_request_kind,
  status public.crm_request_status,
  summary text,
  detail text,
  preferred_date date,
  response text,
  submitted_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.id, r.kind, r.status, r.summary, r.detail, r.preferred_date,
         r.response, r.submitted_at, r.resolved_at
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_portal_requests r on r.account_id = me.account_id
   order by r.submitted_at desc
   limit 200;
$$;

-- Invariant 3: the customer can say something, once.
create or replace function public.crm_portal_submit_request(
  p_kind public.crm_request_kind,
  p_summary text,
  p_detail text default null,
  p_property_id uuid default null,
  p_preferred_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_me record;
  v_id uuid;
begin
  select * into v_me from public.crm_portal_account_for(auth.uid());
  if v_me.account_id is null then
    raise exception 'no portal access' using errcode = 'insufficient_privilege';
  end if;
  -- A named site must belong to the caller's own account; anything else is
  -- someone else's property, and the caller does not get to name it.
  if p_property_id is not null and not exists (
    select 1 from public.crm_properties
     where id = p_property_id and account_id = v_me.account_id
  ) then
    raise exception 'that site is not on this account' using errcode = 'check_violation';
  end if;

  insert into public.crm_portal_requests
    (organization_id, account_id, property_id, portal_user_id, kind, summary, detail,
     preferred_date, created_by)
  values
    (v_me.organization_id, v_me.account_id, p_property_id, v_me.portal_user_id, p_kind,
     p_summary, p_detail, p_preferred_date, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'crm_portal_summary()', 'crm_portal_invoices()', 'crm_portal_visits()',
    'crm_portal_documents()', 'crm_portal_requests_mine()',
    'crm_portal_submit_request(public.crm_request_kind, text, text, uuid, date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', v_function);
    execute format('grant execute on function public.%s to authenticated', v_function);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security. Both new tables are staff-facing in the ordinary way;
-- the portal never reads them directly, only through the definers above.
-- Nothing is deletable: an invitation withdrawn is deactivated, and a
-- request the customer sent is answered rather than erased.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_portal_users', 'crm_portal_requests'] loop
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

create index if not exists crm_portal_users_org_account_idx
  on public.crm_portal_users (organization_id, account_id, active);
create index if not exists crm_portal_requests_org_status_idx
  on public.crm_portal_requests (organization_id, status, submitted_at desc);
create index if not exists crm_portal_requests_org_account_idx
  on public.crm_portal_requests (organization_id, account_id, submitted_at desc);
