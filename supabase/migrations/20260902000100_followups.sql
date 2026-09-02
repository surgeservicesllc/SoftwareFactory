-- ---------------------------------------------------------------------------
-- Increment 26 — follow-ups, and the next step the book itself suggests
-- (ADR-228).
--
-- Both PestPac and HubSpot reviewers say the same thing in different words:
-- "doesn't lead you to the next step very well", "takes 50 steps to get
-- something done", "the task feature update made navigation more
-- difficult", "next best action is locked behind the expensive tier". A
-- task list is table stakes; what nobody in this field ships honestly is a
-- task list whose suggestions are COMPUTED from the customer's own records
-- with the reason printed beside each one.
--
-- Two tables and one function:
--
--   crm_tasks               what somebody has agreed to do, by when, for whom
--   crm_followup_dismissals a suggestion a person looked at and declined,
--                           until a date
--   crm_suggest_followups() the rules, read live — never stored, never stale
--
-- A suggestion is not a task. It becomes one only when a person accepts it,
-- and the accepted task keeps the suggestion's KEY and REASON so the
-- transcript of why it exists survives the click. The same key cannot be
-- accepted twice while open; that is a unique index, not a check in the
-- route, because PostgREST is a door.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_task_status as enum ('open', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_task_priority as enum ('low', 'normal', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Where a task came from. A suggested task carries the rule's key and
  -- the reason it was raised; a manual one is somebody's own decision.
  create type public.crm_task_origin as enum ('manual', 'suggested');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- What the task is about. Any of these may be absent: renewing a
  -- technician's licence is about nobody's account.
  account_id uuid,
  opportunity_id uuid,
  -- Who owns it, from the org chart rather than the login table, because
  -- most of the people who do this work never sign in.
  assignee_employee_id uuid,

  title text not null check (char_length(btrim(title)) between 1 and 200),
  detail text check (detail is null or char_length(detail) between 1 and 4000),
  due_on date not null,
  priority public.crm_task_priority not null default 'normal',
  status public.crm_task_status not null default 'open',

  origin public.crm_task_origin not null default 'manual',
  -- rule:entity — e.g. stale_lead:<account id>. Shaped so a key can never
  -- be free text somebody typed to look like a rule.
  suggestion_key text check (
    suggestion_key is null
    or suggestion_key ~ '^[a-z_]{3,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),

  done_at timestamptz,
  cancelled_at timestamptz,

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_tasks_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_tasks_opportunity_same_org
    foreign key (organization_id, opportunity_id)
    references public.crm_opportunities (organization_id, id) on delete cascade,
  constraint crm_tasks_assignee_same_org
    foreign key (organization_id, assignee_employee_id)
    references public.crm_employees (organization_id, id) on delete set null,

  -- Each terminal moment belongs to its status and nowhere else. The
  -- stamping trigger below keeps these true; they are stated here so no
  -- later writer can break them.
  constraint crm_tasks_done_evidence check ((done_at is not null) = (status = 'done')),
  constraint crm_tasks_cancelled_evidence check ((cancelled_at is not null) = (status = 'cancelled')),
  -- A suggested task always says which rule raised it and why; a manual
  -- task never pretends a rule did.
  constraint crm_tasks_suggested_has_key check ((origin = 'suggested') = (suggestion_key is not null)),
  constraint crm_tasks_suggested_has_reason check ((origin = 'suggested') = (reason is not null)),

  constraint crm_tasks_title_no_secret check (not public.text_has_likely_secret(title)),
  constraint crm_tasks_detail_no_secret check (not public.text_has_likely_secret(detail)),
  constraint crm_tasks_reason_no_secret check (not public.text_has_likely_secret(reason))
);

create unique index if not exists crm_tasks_org_id_key
  on public.crm_tasks (organization_id, id);
-- One open task per suggestion. Accepting the same suggestion from two
-- tabs would otherwise make two people chase the same customer.
create unique index if not exists crm_tasks_open_suggestion_key
  on public.crm_tasks (organization_id, suggestion_key)
  where status = 'open' and suggestion_key is not null;
create index if not exists crm_tasks_org_status_due_idx
  on public.crm_tasks (organization_id, status, due_on);
create index if not exists crm_tasks_org_assignee_idx
  on public.crm_tasks (organization_id, assignee_employee_id, status, due_on);
create index if not exists crm_tasks_org_account_idx
  on public.crm_tasks (organization_id, account_id)
  where account_id is not null;

-- ---------------------------------------------------------------------------
-- The terminal moments are stamped by the row itself. A caller says
-- "done"; the database says when. Reopening clears both, so a task that
-- went done → open → done carries the LAST completion, which is the one
-- that is true.
-- ---------------------------------------------------------------------------

create or replace function public.crm_task_stamp_moments()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    new.cancelled_at := null;
  elsif new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.done_at := null;
  else
    new.done_at := null;
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_task_stamp_moments()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_tasks_stamp_moments on public.crm_tasks;
create trigger crm_tasks_stamp_moments
  before insert or update on public.crm_tasks
  for each row execute function public.crm_task_stamp_moments();

-- ---------------------------------------------------------------------------
-- A finished follow-up about an account is part of that account's history.
-- Written by the same definer pattern the foundation uses for status
-- changes: same transaction, so a completion without its history line is
-- impossible. 'task' is a hand-recorded timeline kind, so this widens no
-- system-kind fence.
-- ---------------------------------------------------------------------------

create or replace function public.crm_task_record_done()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.account_id is not null then
    insert into public.crm_timeline_events
      (organization_id, account_id, kind, summary, detail, actor_user_id)
    values (
      new.organization_id,
      new.account_id,
      'task',
      left(format('Follow-up done: %s', new.title), 300),
      new.reason,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.crm_task_record_done()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_tasks_record_done on public.crm_tasks;
create trigger crm_tasks_record_done
  after update on public.crm_tasks
  for each row execute function public.crm_task_record_done();

drop trigger if exists crm_tasks_set_updated_at on public.crm_tasks;
create trigger crm_tasks_set_updated_at
  before update on public.crm_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Declining a suggestion. "Not now" is a decision worth keeping, and it
-- expires: a lead nobody wanted to chase in March is a lead again in April.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_followup_dismissals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  suggestion_key text not null check (
    suggestion_key ~ '^[a-z_]{3,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  until_on date not null,
  note text check (note is null or char_length(btrim(note)) between 1 and 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint crm_followup_dismissals_note_no_secret check (not public.text_has_likely_secret(note))
);

create unique index if not exists crm_followup_dismissals_org_key
  on public.crm_followup_dismissals (organization_id, suggestion_key);

-- ---------------------------------------------------------------------------
-- The suggestions. Seven rules, each a question the office already asks
-- itself every morning, answered from the rows as they are RIGHT NOW:
--
--   stale_lead            a lead or prospect with no recorded activity in 14 days
--   overdue_opportunity   an open deal past the date it was expected to close
--   estimate_undecided    an estimate sent ten days ago with no decision
--   request_unanswered    a customer's portal request nobody acknowledged in 2 days
--   invoice_quiet         an overdue invoice with no collection action in 7 days
--   licence_expiring      a technician's licence expiring within 30 days
--   sighting_uncorrected  a high-severity sighting three days without correction
--
-- INVOKER, deliberately: every table it reads is member-scoped, so the
-- caller sees suggestions about exactly the rows they could open.
-- Nothing is stored — a stored suggestion is stale the moment the invoice
-- is paid, and a suggestion about a paid invoice is the kind of "the
-- system told me to call them" that loses a customer.
--
-- A key that already has an OPEN task is not suggested again (it was
-- accepted), and a dismissed key stays quiet until its date.
-- ---------------------------------------------------------------------------

create or replace function public.crm_suggest_followups(p_organization uuid)
returns table (
  suggestion_key text,
  rule text,
  account_id uuid,
  opportunity_id uuid,
  title text,
  reason text,
  due_on date,
  priority public.crm_task_priority
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with candidates as (
    -- stale_lead
    select 'stale_lead:' || a.id as suggestion_key,
           'stale_lead' as rule,
           a.id as account_id,
           null::uuid as opportunity_id,
           left('Reach out to ' || a.name, 200) as title,
           left(format('%s with no recorded activity in %s days.',
                       initcap(a.status::text),
                       current_date - coalesce(
                         (select max(e.occurred_at)::date from public.crm_timeline_events e
                           where e.organization_id = a.organization_id and e.account_id = a.id),
                         a.created_at::date)), 500) as reason,
           current_date as due_on,
           'normal'::public.crm_task_priority as priority
      from public.crm_accounts a
     where a.organization_id = p_organization
       and a.status in ('lead', 'prospect')
       and coalesce(
             (select max(e.occurred_at) from public.crm_timeline_events e
               where e.organization_id = a.organization_id and e.account_id = a.id),
             a.created_at) < now() - interval '14 days'

    union all

    -- overdue_opportunity
    select 'overdue_opportunity:' || o.id,
           'overdue_opportunity',
           o.account_id,
           o.id,
           left('Decide ' || o.name, 200),
           left(format('Expected to close on %s and still open at "%s".',
                       o.expected_close_date, o.stage), 500),
           current_date,
           'high'
      from public.crm_opportunities o
     where o.organization_id = p_organization
       and o.stage not in ('won', 'lost')
       and o.expected_close_date is not null
       and o.expected_close_date < current_date

    union all

    -- estimate_undecided
    select 'estimate_undecided:' || e.id,
           'estimate_undecided',
           e.account_id,
           e.opportunity_id,
           left('Chase estimate ' || e.number, 200),
           left(format('Sent %s days ago with no decision recorded.',
                       current_date - e.sent_at::date), 500),
           current_date,
           'normal'
      from public.crm_estimates e
     where e.organization_id = p_organization
       and e.status = 'sent'
       and e.sent_at is not null
       and e.sent_at < now() - interval '10 days'

    union all

    -- request_unanswered
    select 'request_unanswered:' || r.id,
           'request_unanswered',
           r.account_id,
           null::uuid,
           left('Answer the customer: ' || r.summary, 200),
           left(format('Submitted through the portal %s days ago and not yet acknowledged.',
                       current_date - r.submitted_at::date), 500),
           current_date,
           'high'
      from public.crm_portal_requests r
     where r.organization_id = p_organization
       and r.status = 'submitted'
       and r.submitted_at < now() - interval '2 days'

    union all

    -- invoice_quiet
    select 'invoice_quiet:' || i.id,
           'invoice_quiet',
           i.account_id,
           null::uuid,
           left('Collect invoice ' || i.number, 200),
           left(format('%s days overdue; no collection action recorded in the last 7 days.',
                       current_date - i.due_on), 500),
           current_date,
           'high'
      from public.crm_invoices i
     where i.organization_id = p_organization
       and i.status = 'open'
       and i.due_on is not null
       and i.due_on < current_date
       and i.paid_cents < i.total_cents
       and not exists (
         select 1 from public.crm_dunning_notices d
          where d.organization_id = i.organization_id
            and d.invoice_id = i.id
            and d.acted_at >= now() - interval '7 days')

    union all

    -- licence_expiring
    select 'licence_expiring:' || t.id,
           'licence_expiring',
           null::uuid,
           null::uuid,
           left('Renew licence for ' || t.first_name || coalesce(' ' || t.last_name, ''), 200),
           left(format('Licence %s expires on %s.', t.license_number, t.license_expires_on), 500),
           greatest(current_date, t.license_expires_on - 7),
           'high'
      from public.crm_technicians t
     where t.organization_id = p_organization
       and t.active
       and t.license_expires_on is not null
       and t.license_expires_on between current_date and current_date + 30

    union all

    -- sighting_uncorrected
    select 'sighting_uncorrected:' || s.id,
           'sighting_uncorrected',
           s.account_id,
           null::uuid,
           left('Correct the high-severity sighting at ' || p.label, 200),
           left(format('Recorded %s days ago with no corrective action.',
                       current_date - s.sighted_at::date), 500),
           current_date,
           'high'
      from public.crm_pest_sightings s
      join public.crm_properties p
        on p.organization_id = s.organization_id and p.id = s.property_id
     where s.organization_id = p_organization
       and s.severity = 'high'
       and s.corrected_at is null
       and s.sighted_at < now() - interval '3 days'
  )
  select c.suggestion_key, c.rule, c.account_id, c.opportunity_id,
         c.title, c.reason, c.due_on, c.priority
    from candidates c
   where not exists (
           select 1 from public.crm_tasks t
            where t.organization_id = p_organization
              and t.suggestion_key = c.suggestion_key
              and t.status = 'open')
     and not exists (
           select 1 from public.crm_followup_dismissals d
            where d.organization_id = p_organization
              and d.suggestion_key = c.suggestion_key
              and d.until_on >= current_date)
   order by case c.priority when 'high' then 0 when 'normal' then 1 else 2 end,
            c.due_on, c.title;
$$;

revoke all on function public.crm_suggest_followups(uuid) from public, anon, service_role;
grant execute on function public.crm_suggest_followups(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. REVOKE first: hosted default privileges grant ALL on
-- every new table.
--
-- No DELETE on tasks — a follow-up that was agreed and then dropped is a
-- fact about the customer relationship; cancelling is a status. A
-- dismissal IS deletable: un-dismissing is a person changing their mind
-- about a suggestion, not rewriting history.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_tasks enable row level security';
  execute 'alter table public.crm_tasks force row level security';
  execute 'revoke all on table public.crm_tasks
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_tasks_select_member on public.crm_tasks';
  execute 'create policy crm_tasks_select_member on public.crm_tasks
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_tasks_insert_member on public.crm_tasks';
  execute 'create policy crm_tasks_insert_member on public.crm_tasks
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_tasks_update_member on public.crm_tasks';
  execute 'create policy crm_tasks_update_member on public.crm_tasks
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';
  execute 'grant select, insert, update on table public.crm_tasks to authenticated';

  execute 'alter table public.crm_followup_dismissals enable row level security';
  execute 'alter table public.crm_followup_dismissals force row level security';
  execute 'revoke all on table public.crm_followup_dismissals
             from public, anon, authenticated, service_role';
  execute 'drop policy if exists crm_followup_dismissals_select_member on public.crm_followup_dismissals';
  execute 'create policy crm_followup_dismissals_select_member on public.crm_followup_dismissals
             for select to authenticated using (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_followup_dismissals_insert_member on public.crm_followup_dismissals';
  execute 'create policy crm_followup_dismissals_insert_member on public.crm_followup_dismissals
             for insert to authenticated with check (public.is_organization_member(organization_id))';
  execute 'drop policy if exists crm_followup_dismissals_delete_member on public.crm_followup_dismissals';
  execute 'create policy crm_followup_dismissals_delete_member on public.crm_followup_dismissals
             for delete to authenticated using (public.is_organization_member(organization_id))';
  execute 'grant select, insert, delete on table public.crm_followup_dismissals to authenticated';
end;
$$;
