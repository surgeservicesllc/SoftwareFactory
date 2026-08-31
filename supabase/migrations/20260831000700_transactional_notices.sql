-- ---------------------------------------------------------------------------
-- Increment 22 — transactional service notices (ADR-217).
--
-- Two matrix rows have sat at GAP and PARTIAL for the same stated reason:
-- "no email or SMS provider is connected." That reason is true and it is
-- not the whole story, which is the mistake this repository made three
-- times yesterday — a real blocker, and too wide a conclusion drawn from
-- it. Sending is gated. COMPOSING, ADDRESSING, DEDUPLICATING and
-- SUPPRESSING are not, and they are where the actual product lives.
--
-- What was genuinely missing: `crm_messages` (increment 10) is already a
-- real outbox — channel, status funnel, destination as it stood that day,
-- the whole delivery chain — but it requires `campaign_id NOT NULL`. A
-- reminder that a technician arrives tomorrow is not a campaign, and
-- inventing a campaign row to carry one would be a lie told to a foreign
-- key. `crm_dunning_notices` (increment 12) is not it either: that records
-- what a PERSON did — called, posted a letter — not what was composed.
--
-- So a transactional notice had nowhere to live, and this file is that
-- place.
--
-- THE ONE RULE THIS FILE EXISTS TO ENFORCE:
--
--   NOTHING CAN CLAIM TO HAVE BEEN SENT.
--
-- Not "the UI won't show it as sent" — nothing can WRITE it. `sent` is
-- reachable only through a function that asks `crm_integration_live()`
-- first (ADR-207: the single question every gated feature asks), and
-- members hold no UPDATE grant on this table at all, so there is no second
-- route to the column. With no provider connected, the state is
-- unreachable by construction rather than by convention.
--
-- Increment 12 wrote the standard this has to meet: "a queue of unsent
-- reminders that looked like sent ones would be worse than no dunning at
-- all." A composed notice here is honestly labelled `composed` — not
-- `queued`, because queued implies something drains it and nothing does.
--
-- THE SECOND RULE: A SUPPRESSED NOTICE IS STILL A ROW.
--
-- When a customer has asked not to be contacted, the notice is composed
-- and then recorded as `suppressed` with the reason, rather than never
-- existing. Silently dropping it would mean nobody can answer "was this
-- customer told?" — and "we have no record either way" is the answer that
-- loses the argument.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_notice_kind as enum (
    -- About a visit:
    'visit_reminder', 'visit_confirmation', 'technician_en_route', 'visit_completed',
    -- About money:
    'invoice_due', 'invoice_overdue',
    -- About the agreement:
    'plan_renewal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_notice_state as enum (
    -- Written, addressed, and nothing has taken it. Deliberately NOT
    -- 'queued': a queue implies a drainer, and there isn't one.
    'composed',
    -- The customer asked not to be contacted. Kept, not dropped.
    'suppressed',
    -- Reachable only via crm_notice_mark_dispatched, which requires a live
    -- provider. Unreachable while nothing is connected.
    'sent',
    'failed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Who may be contacted, and about what.
--
-- SEPARATE FROM MARKETING CONSENT ON PURPOSE, and the separation is the
-- feature rather than an oversight. `crm_list_members.unsubscribed_at`
-- (increment 10) records leaving a mailing list. Someone who unsubscribes
-- from a newsletter has NOT asked to stop being told that a technician is
-- arriving at their house tomorrow morning, and suppressing that on the
-- strength of a newsletter opt-out would be a worse failure than sending
-- it: they booked the visit.
--
-- An explicit do-not-contact is different, and it stops both. That is why
-- setting it forces both permissions false in the same row: there is no
-- such state as "do not contact, but marketing is fine", and a schema that
-- can express one will eventually hold one.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contact_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,

  -- Postcards are excluded here and below: a postcard is put in a postbox
  -- by a person, so there is no send for this schema to gate and no
  -- reminder-shaped thing for it to carry.
  channel public.crm_channel not null check (channel in ('email', 'sms')),

  -- Telling somebody about their own service. Default true, because
  -- withholding it is the surprising choice.
  transactional_allowed boolean not null default true,
  marketing_allowed boolean not null default true,

  -- The hard stop. When set it overrides everything, which the check below
  -- enforces rather than trusting each reader to remember.
  do_not_contact_at timestamptz,
  do_not_contact_reason text
    check (do_not_contact_reason is null
           or char_length(btrim(do_not_contact_reason)) between 1 and 300),

  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_contact_preferences_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,

  -- A reason belongs to a do-not-contact and nowhere else, exactly as an
  -- unsubscribe reason belongs to an unsubscribe.
  constraint crm_contact_preferences_reason_iff_stopped
    check (do_not_contact_reason is null or do_not_contact_at is not null),

  -- The override, made structural.
  constraint crm_contact_preferences_stop_forbids_everything
    check (do_not_contact_at is null
           or (transactional_allowed = false and marketing_allowed = false)),

  constraint crm_contact_preferences_reason_no_secret
    check (not public.text_has_likely_secret(do_not_contact_reason))
);

create unique index if not exists crm_contact_preferences_org_account_channel_key
  on public.crm_contact_preferences (organization_id, account_id, channel);
create unique index if not exists crm_contact_preferences_org_id_key
  on public.crm_contact_preferences (organization_id, id);
-- The composer reads this on every call, per account.
create index if not exists crm_contact_preferences_org_account_idx
  on public.crm_contact_preferences (organization_id, account_id);

-- ---------------------------------------------------------------------------
-- The notice itself: what would be said, to whom, about which thing.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,

  kind public.crm_notice_kind not null,
  channel public.crm_channel not null check (channel in ('email', 'sms')),
  state public.crm_notice_state not null default 'composed',

  -- Exactly one of these three, and it has to match the kind. A visit
  -- reminder pointing at an invoice is not a notice anybody can act on.
  work_order_id uuid,
  invoice_id uuid,
  plan_id uuid,

  -- An email has a subject line and an SMS does not. Not a nullable field
  -- that happens to be empty for SMS — a field whose presence IS the
  -- channel, checked both ways.
  subject_line text
    check (subject_line is null or char_length(btrim(subject_line)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 4000),

  -- The address as it stood the day this was composed. Copied, never
  -- joined: a customer who changes their number next month has not
  -- changed where this went.
  destination text not null check (char_length(btrim(destination)) between 3 and 320),

  -- WHEN IT BELONGS. `due_on` is the branch's own calendar day, supplied
  -- by the caller, and it is the deduplication grain. It is deliberately
  -- NOT derived from `due_at` — which calendar day a 7pm reminder belongs
  -- to is a business decision made in a local timezone, and deriving it in
  -- UTC would put the evening reminders of half the year on the wrong day.
  due_on date not null,
  due_at timestamptz not null,

  composed_at timestamptz not null default now(),

  suppressed_at timestamptz,
  suppression_reason text
    check (suppression_reason is null or char_length(btrim(suppression_reason)) between 1 and 300),

  -- Writable only by crm_notice_mark_dispatched. See the grants at the
  -- foot of this file: members hold no UPDATE on this table.
  dispatched_at timestamptz,
  provider_reference text
    check (provider_reference is null or char_length(btrim(provider_reference)) between 1 and 200),

  failure_reason text
    check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 300),
  cancelled_at timestamptz,

  created_by uuid not null references auth.users(id) on delete restrict,

  constraint crm_notices_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_notices_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete cascade,
  constraint crm_notices_invoice_same_org
    foreign key (organization_id, invoice_id)
    references public.crm_invoices (organization_id, id) on delete cascade,
  constraint crm_notices_plan_same_org
    foreign key (organization_id, plan_id)
    references public.crm_service_plans (organization_id, id) on delete cascade,

  constraint crm_notices_exactly_one_subject
    check (num_nonnulls(work_order_id, invoice_id, plan_id) = 1),

  constraint crm_notices_subject_matches_kind
    check (
      case kind
        when 'visit_reminder'      then work_order_id is not null
        when 'visit_confirmation'  then work_order_id is not null
        when 'technician_en_route' then work_order_id is not null
        when 'visit_completed'     then work_order_id is not null
        when 'invoice_due'         then invoice_id is not null
        when 'invoice_overdue'     then invoice_id is not null
        when 'plan_renewal'        then plan_id is not null
      end
    ),

  constraint crm_notices_subject_line_iff_email
    check ((subject_line is not null) = (channel = 'email')),

  -- Each terminal state and its evidence, both ways. A state without its
  -- moment is unauditable; a moment without its state is a row that half
  -- happened.
  constraint crm_notices_suppressed_evidence
    check ((suppressed_at is not null) = (state = 'suppressed')
           and (suppression_reason is not null) = (state = 'suppressed')),
  constraint crm_notices_failed_evidence
    check ((failure_reason is not null) = (state = 'failed')),
  constraint crm_notices_cancelled_evidence
    check ((cancelled_at is not null) = (state = 'cancelled')),

  -- THE ONE THIS FILE EXISTS FOR. A notice claiming it was sent must carry
  -- the provider's own reference for it, and a provider reference cannot
  -- exist on a notice that was not sent. There is no shape of this row
  -- that says "sent" without something to check the claim against.
  constraint crm_notices_sent_evidence
    check ((dispatched_at is not null) = (state = 'sent')
           and (provider_reference is not null) = (state = 'sent')),

  constraint crm_notices_dispatch_after_composed
    check (dispatched_at is null or dispatched_at >= composed_at),

  constraint crm_notices_subject_line_no_secret
    check (not public.text_has_likely_secret(subject_line)),
  constraint crm_notices_body_no_secret check (not public.text_has_likely_secret(body)),
  constraint crm_notices_destination_no_secret
    check (not public.text_has_likely_secret(destination)),
  constraint crm_notices_suppression_no_secret
    check (not public.text_has_likely_secret(suppression_reason)),
  constraint crm_notices_failure_no_secret
    check (not public.text_has_likely_secret(failure_reason)),
  -- A provider reference is an opaque id, and the day somebody stores an
  -- API token in it is the day this constraint earns its keep.
  constraint crm_notices_provider_reference_no_secret
    check (not public.text_has_likely_secret(provider_reference))
);

create unique index if not exists crm_notices_org_id_key
  on public.crm_notices (organization_id, id);

-- ---------------------------------------------------------------------------
-- THE DEDUPLICATION LOCK.
--
-- Increment 12 established the standard for this class of bug: "a
-- generator that reads-then-writes is a generator that double-bills the
-- moment two people press the button together, and 'we only run it once'
-- is not a constraint." The same is true of reminders — two people
-- pressing Remind, or one person pressing it twice on a slow connection,
-- must not produce two texts to the same customer about the same visit on
-- the same day.
--
-- `coalesce` over the three subject columns is safe as an index
-- expression: exactly one is ever non-null (see the check above), and
-- coalesce over uuid is immutable.
--
-- Cancelled notices are excluded so that cancelling one and composing a
-- corrected replacement is possible. Suppressed ones are NOT excluded: a
-- customer who has asked not to be contacted should not accumulate a
-- suppressed notice per attempt.
-- ---------------------------------------------------------------------------

create unique index if not exists crm_notices_org_kind_subject_day_key
  on public.crm_notices (
    organization_id, kind, coalesce(work_order_id, invoice_id, plan_id), due_on
  )
  where state <> 'cancelled';

create index if not exists crm_notices_org_state_due_idx
  on public.crm_notices (organization_id, state, due_at);
create index if not exists crm_notices_org_account_idx
  on public.crm_notices (organization_id, account_id, composed_at desc);

-- ---------------------------------------------------------------------------
-- Composing one.
--
-- The subject is a single uuid and the KIND says which table it names, so
-- there is no call shape that files a visit reminder against an invoice.
-- The account is DERIVED from that row rather than passed: a caller can
-- get a parameter wrong, and a notice addressed to the wrong customer
-- about someone else's visit is the worst thing this table could hold.
--
-- SECURITY INVOKER. Every table it touches has policies already; a definer
-- here would widen authority to buy nothing.
-- ---------------------------------------------------------------------------

create or replace function public.crm_notice_compose(
  p_kind public.crm_notice_kind,
  p_channel public.crm_channel,
  p_subject uuid,
  p_destination text,
  p_body text,
  p_due_on date,
  p_due_at timestamptz,
  p_subject_line text default null
)
returns table (
  -- Every output column is prefixed. An unprefixed one would SHADOW the
  -- table column of the same name everywhere in this body — a defect this
  -- repository shipped three times before it was understood.
  notice_id uuid,
  notice_state public.crm_notice_state,
  notice_duplicate boolean
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_account uuid;
  v_work_order uuid;
  v_invoice uuid;
  v_plan uuid;
  v_stop timestamptz;
  v_allowed boolean;
  v_pref_found boolean := false;
  v_state public.crm_notice_state := 'composed';
  v_suppression text;
  v_id uuid;
begin
  if p_channel not in ('email', 'sms') then
    raise exception 'a transactional notice is email or sms; a postcard is posted by a person'
      using errcode = 'check_violation';
  end if;

  -- Resolve the subject, and with it the organization and the account.
  -- RLS narrows these reads, so "not found" and "not yours" are the same
  -- answer on purpose.
  if p_kind in ('visit_reminder', 'visit_confirmation', 'technician_en_route', 'visit_completed') then
    select w.organization_id, w.account_id into v_org, v_account
      from public.crm_work_orders w where w.id = p_subject;
    v_work_order := p_subject;
  elsif p_kind in ('invoice_due', 'invoice_overdue') then
    select i.organization_id, i.account_id into v_org, v_account
      from public.crm_invoices i where i.id = p_subject;
    v_invoice := p_subject;
  else
    select s.organization_id, s.account_id into v_org, v_account
      from public.crm_service_plans s where s.id = p_subject;
    v_plan := p_subject;
  end if;

  if v_org is null then
    raise exception 'no such % subject', p_kind using errcode = 'no_data_found';
  end if;

  -- May we contact them at all? A missing preference row means nobody has
  -- expressed one, which is permission — the customer booked the service.
  select cp.do_not_contact_at, cp.transactional_allowed
    into v_stop, v_allowed
    from public.crm_contact_preferences cp
   where cp.organization_id = v_org
     and cp.account_id = v_account
     and cp.channel = p_channel;
  v_pref_found := found;

  if v_pref_found and v_stop is not null then
    v_state := 'suppressed';
    v_suppression := format(
      'The customer asked not to be contacted on %s; recorded %s.',
      p_channel, to_char(v_stop at time zone 'UTC', 'YYYY-MM-DD')
    );
  elsif v_pref_found and v_allowed = false then
    v_state := 'suppressed';
    v_suppression := format(
      'Transactional notices are switched off for this account on %s.', p_channel
    );
  end if;

  insert into public.crm_notices (
    organization_id, account_id, kind, channel, state,
    work_order_id, invoice_id, plan_id,
    subject_line, body, destination, due_on, due_at,
    suppressed_at, suppression_reason, created_by
  )
  values (
    v_org, v_account, p_kind, p_channel, v_state,
    v_work_order, v_invoice, v_plan,
    p_subject_line, p_body, p_destination, p_due_on, p_due_at,
    case when v_state = 'suppressed' then now() end, v_suppression, auth.uid()
  )
  -- The lock, inferred against the partial index. A second press of
  -- Remind returns the first notice rather than composing a second.
  on conflict (organization_id, kind, coalesce(work_order_id, invoice_id, plan_id), due_on)
    where state <> 'cancelled'
  do nothing
  returning id into v_id;

  if v_id is null then
    return query
      select n.id, n.state, true
        from public.crm_notices n
       where n.organization_id = v_org
         and n.kind = p_kind
         and coalesce(n.work_order_id, n.invoice_id, n.plan_id) = p_subject
         and n.due_on = p_due_on
         and n.state <> 'cancelled';
    return;
  end if;

  return query select v_id, v_state, false;
end;
$$;

revoke all on function public.crm_notice_compose(
  public.crm_notice_kind, public.crm_channel, uuid, text, text, date, timestamptz, text)
  from public, anon, service_role;
grant execute on function public.crm_notice_compose(
  public.crm_notice_kind, public.crm_channel, uuid, text, text, date, timestamptz, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Marking one sent. THE GATE.
--
-- SECURITY DEFINER, and it needs justifying because most writes in this
-- chain are not. Members hold no UPDATE grant on crm_notices — that
-- absence is what makes `sent` unreachable by any other route — so the
-- only way to record a real dispatch is a function that runs as the owner
-- and asks the gating question first. Membership is checked explicitly and
-- first, exactly as crm_integration_status does it.
--
-- With no provider connected, crm_integration_live() returns false and
-- this raises. That is the entire honesty guarantee, and it is a
-- constraint rather than a convention: nothing anywhere can write a
-- notice that says it was sent.
-- ---------------------------------------------------------------------------

create or replace function public.crm_notice_mark_dispatched(
  p_notice uuid,
  p_provider_reference text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_channel public.crm_channel;
  v_state public.crm_notice_state;
begin
  select n.organization_id, n.channel, n.state
    into v_org, v_channel, v_state
    from public.crm_notices n
   where n.id = p_notice
     for update;

  if v_org is null then
    raise exception 'no such notice' using errcode = 'no_data_found';
  end if;

  if not public.is_organization_member(v_org) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  if p_provider_reference is null or btrim(p_provider_reference) = '' then
    raise exception 'a dispatched notice carries the provider''s own reference for it'
      using errcode = 'check_violation';
  end if;

  if v_state <> 'composed' then
    raise exception 'only a composed notice can be dispatched; this one is %', v_state
      using errcode = 'check_violation';
  end if;

  -- The gate. `email` and `sms` name the same capabilities in the provider
  -- registry, and this is the single question ADR-207 exists to answer.
  if not public.crm_integration_live(v_org, v_channel::text::public.crm_integration_provider) then
    raise exception
      'no % provider is connected for this workspace, so nothing can be recorded as sent',
      v_channel
      using errcode = 'check_violation';
  end if;

  update public.crm_notices
     set state = 'sent',
         dispatched_at = now(),
         provider_reference = btrim(p_provider_reference)
   where id = p_notice;

  return true;
end;
$$;

revoke all on function public.crm_notice_mark_dispatched(uuid, text)
  from public, anon, service_role;
grant execute on function public.crm_notice_mark_dispatched(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The other two ways out of `composed`. Both definer for the same reason:
-- there is no UPDATE grant, on purpose.
-- ---------------------------------------------------------------------------

create or replace function public.crm_notice_mark_failed(p_notice uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_state public.crm_notice_state;
begin
  select n.organization_id, n.state into v_org, v_state
    from public.crm_notices n where n.id = p_notice for update;

  if v_org is null then
    raise exception 'no such notice' using errcode = 'no_data_found';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;
  if v_state <> 'composed' then
    raise exception 'only a composed notice can fail; this one is %', v_state
      using errcode = 'check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a failure carries its reason' using errcode = 'check_violation';
  end if;

  update public.crm_notices
     set state = 'failed', failure_reason = btrim(p_reason)
   where id = p_notice;
  return true;
end;
$$;

revoke all on function public.crm_notice_mark_failed(uuid, text)
  from public, anon, service_role;
grant execute on function public.crm_notice_mark_failed(uuid, text) to authenticated;

create or replace function public.crm_notice_cancel(p_notice uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_state public.crm_notice_state;
begin
  select n.organization_id, n.state into v_org, v_state
    from public.crm_notices n where n.id = p_notice for update;

  if v_org is null then
    raise exception 'no such notice' using errcode = 'no_data_found';
  end if;
  if not public.is_organization_member(v_org) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;
  -- A sent notice cannot be cancelled. It was sent; the customer has it.
  if v_state not in ('composed', 'suppressed') then
    raise exception 'a % notice cannot be cancelled', v_state using errcode = 'check_violation';
  end if;

  update public.crm_notices
     set state = 'cancelled',
         cancelled_at = now(),
         -- Leaving the terminal state's evidence behind would contradict
         -- the constraints, which permit exactly one story per row.
         suppressed_at = null,
         suppression_reason = null
   where id = p_notice;
  return true;
end;
$$;

revoke all on function public.crm_notice_cancel(uuid) from public, anon, service_role;
grant execute on function public.crm_notice_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What the workspace still owes its customers.
--
-- Composed AND suppressed, in one answer, because they are the two halves
-- of the same question. A page that showed only the composed ones would
-- quietly under-report: the customers nobody may contact are exactly the
-- ones where "did anyone tell them?" gets asked later.
-- ---------------------------------------------------------------------------

create or replace function public.crm_notices_outstanding(
  p_organization_id uuid,
  p_limit integer default 100
)
returns table (
  -- Prefixed, always: an OUT parameter named `state` or `kind` would
  -- shadow the table column of that name throughout this body.
  notice_id uuid,
  notice_account uuid,
  notice_kind public.crm_notice_kind,
  notice_channel public.crm_channel,
  notice_state public.crm_notice_state,
  notice_destination text,
  notice_due_at timestamptz,
  notice_overdue boolean,
  notice_suppression text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select n.id, n.account_id, n.kind, n.channel, n.state, n.destination, n.due_at,
         n.state = 'composed' and n.due_at <= now(),
         n.suppression_reason
    from public.crm_notices n
   where n.organization_id = p_organization_id
     and n.state in ('composed', 'suppressed')
   -- Positional: columns 8 = overdue, 7 = due, 3 = kind. Written this way
   -- because the names above are OUT parameters, not columns.
   order by 8 desc, 7 asc, 3
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.crm_notices_outstanding(uuid, integer)
  from public, anon, service_role;
grant execute on function public.crm_notices_outstanding(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- A contact preference change writes itself into the account's history.
--
-- "Important state transitions must create immutable activity/audit
-- events", and a customer asking not to be contacted is among the most
-- important this schema records: it is the row a complaint turns on. The
-- preference table holds only the current state, so without this the
-- moment somebody lifted a do-not-contact would leave no trace.
--
-- Kind `status_change` rather than a new enum value: this IS a status
-- change on the account, and widening a shared enum for one caller would
-- also mean revisiting the manual route that refuses system kinds.
-- ---------------------------------------------------------------------------

create or replace function public.crm_record_contact_preference_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_summary text;
  v_was_stopped boolean := false;
begin
  -- OLD is unassigned on INSERT and reading a field of it raises, so every
  -- look at it is nested under the operation rather than guarded by an
  -- `and` — SQL does not promise to short-circuit one.
  if tg_op = 'UPDATE' then
    if new.do_not_contact_at is not distinct from old.do_not_contact_at
       and new.transactional_allowed is not distinct from old.transactional_allowed
       and new.marketing_allowed is not distinct from old.marketing_allowed then
      return new;
    end if;
    v_was_stopped := old.do_not_contact_at is not null;
  end if;

  if new.do_not_contact_at is not null then
    v_summary := pg_catalog.format('Do not contact on %s.', new.channel);
  elsif v_was_stopped then
    -- The lift, which is the transition nobody can reconstruct afterwards
    -- if it is not written down here.
    v_summary := pg_catalog.format('Do-not-contact lifted on %s.', new.channel);
  elsif new.transactional_allowed = false then
    v_summary := pg_catalog.format('Service notices switched off on %s.', new.channel);
  elsif tg_op = 'INSERT' then
    return new;
  else
    v_summary := pg_catalog.format(
      'Contact preferences changed on %s: service notices %s, marketing %s.',
      new.channel,
      case when new.transactional_allowed then 'on' else 'off' end,
      case when new.marketing_allowed then 'on' else 'off' end
    );
  end if;

  insert into public.crm_timeline_events
    (organization_id, account_id, kind, summary, actor_user_id)
  values (new.organization_id, new.account_id, 'status_change', v_summary, auth.uid());

  return new;
end;
$$;

revoke all on function public.crm_record_contact_preference_change()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_contact_preferences_history on public.crm_contact_preferences;
create trigger crm_contact_preferences_history
  after insert or update on public.crm_contact_preferences
  for each row execute function public.crm_record_contact_preference_change();

-- ---------------------------------------------------------------------------
-- Row Level Security. REVOKE first: hosted default privileges grant ALL on
-- every new table, so a capability expressed as the ABSENCE of a grant has
-- to be revoked before it is true.
--
-- THAT ABSENCE IS THE WHOLE FEATURE HERE. `crm_notices` gets SELECT and
-- INSERT and nothing else. No UPDATE means no member can write `state =
-- 'sent'`, no matter what a policy says, and the only route to that column
-- is crm_notice_mark_dispatched — which asks whether a provider is
-- actually connected before it writes.
--
-- No DELETE either: a notice is the record of what a customer was or was
-- not told, including the suppressed ones.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_notices enable row level security';
  execute 'alter table public.crm_notices force row level security';
  execute 'revoke all on table public.crm_notices
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_notices_select_member on public.crm_notices';
  execute 'create policy crm_notices_select_member on public.crm_notices
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_notices_insert_member on public.crm_notices';
  execute 'create policy crm_notices_insert_member on public.crm_notices
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'grant select, insert on table public.crm_notices to authenticated';

  -- Preferences are current state, so they update. They do not delete:
  -- erasing the record of a do-not-contact is precisely the operation
  -- that must not exist.
  execute 'alter table public.crm_contact_preferences enable row level security';
  execute 'alter table public.crm_contact_preferences force row level security';
  execute 'revoke all on table public.crm_contact_preferences
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_contact_preferences_select_member
             on public.crm_contact_preferences';
  execute 'create policy crm_contact_preferences_select_member
             on public.crm_contact_preferences
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_contact_preferences_insert_member
             on public.crm_contact_preferences';
  execute 'create policy crm_contact_preferences_insert_member
             on public.crm_contact_preferences
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_contact_preferences_update_member
             on public.crm_contact_preferences';
  execute 'create policy crm_contact_preferences_update_member
             on public.crm_contact_preferences
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';

  execute 'grant select, insert, update on table public.crm_contact_preferences
             to authenticated';
end;
$$;
