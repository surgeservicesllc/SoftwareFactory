-- ---------------------------------------------------------------------------
-- Increment 31 — the customer's side of the conversation (ADR-233).
--
-- "Not built for two-way communication"; "no customer surveys"; a help
-- desk with no clock. Three things, each written by the customer on their
-- own portal and read by staff under RLS:
--
--   crm_portal_surveys        one rating per completed visit, asked in the
--                             portal after the visit — no email needed
--   crm_portal_messages       a thread on the account, either side writing,
--                             each message immutable once sent
--   crm_sla_policies          per-kind acknowledge/resolve hours; defaults
--                             in code, overrides per workspace
--   crm_request_sla()         the clock on every request: due moments,
--                             met / breached / waiting / overdue, computed
--                             live from the request's own stamps
--
-- The request gains two stamps a trigger sets and nobody edits:
-- acknowledged_at (the first time its status left 'submitted') and
-- first_response_at (the first time a reply was written).
-- ---------------------------------------------------------------------------

-- --- request stamps ----------------------------------------------------------

alter table public.crm_portal_requests
  add column if not exists acknowledged_at timestamptz,
  add column if not exists first_response_at timestamptz;

create or replace function public.crm_portal_request_stamp_moments()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    -- A request born already acknowledged (seeded history, an office-filed
    -- request) keeps whatever the writer said; nothing is invented.
    return new;
  end if;
  -- The stamps are set once, by the row, and never moved by hand.
  new.acknowledged_at := old.acknowledged_at;
  new.first_response_at := old.first_response_at;
  if old.status = 'submitted' and new.status <> 'submitted' and new.acknowledged_at is null then
    new.acknowledged_at := now();
  end if;
  if old.response is null and new.response is not null and new.first_response_at is null then
    new.first_response_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.crm_portal_request_stamp_moments()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_portal_requests_stamp_moments on public.crm_portal_requests;
create trigger crm_portal_requests_stamp_moments
  before insert or update on public.crm_portal_requests
  for each row execute function public.crm_portal_request_stamp_moments();

-- --- SLA policy ----------------------------------------------------------------

create table if not exists public.crm_sla_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.crm_request_kind not null,
  acknowledge_hours integer not null check (acknowledge_hours between 1 and 720),
  resolve_hours integer not null check (resolve_hours between 1 and 2160),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_sla_policies_resolve_after_acknowledge check (resolve_hours >= acknowledge_hours)
);

create unique index if not exists crm_sla_policies_org_kind_key
  on public.crm_sla_policies (organization_id, kind);
create unique index if not exists crm_sla_policies_org_id_key
  on public.crm_sla_policies (organization_id, id);

alter table public.crm_sla_policies enable row level security;
alter table public.crm_sla_policies force row level security;

drop policy if exists crm_sla_policies_select_member on public.crm_sla_policies;
create policy crm_sla_policies_select_member on public.crm_sla_policies
  for select to authenticated using (public.is_organization_member(organization_id));
drop policy if exists crm_sla_policies_insert_member on public.crm_sla_policies;
create policy crm_sla_policies_insert_member on public.crm_sla_policies
  for insert to authenticated with check (public.is_organization_member(organization_id));
drop policy if exists crm_sla_policies_update_member on public.crm_sla_policies;
create policy crm_sla_policies_update_member on public.crm_sla_policies
  for update to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
drop policy if exists crm_sla_policies_delete_member on public.crm_sla_policies;
create policy crm_sla_policies_delete_member on public.crm_sla_policies
  for delete to authenticated using (public.is_organization_member(organization_id));

revoke all on public.crm_sla_policies from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.crm_sla_policies to authenticated;

drop trigger if exists crm_sla_policies_set_updated_at on public.crm_sla_policies;
create trigger crm_sla_policies_set_updated_at
  before update on public.crm_sla_policies
  for each row execute function public.set_updated_at();

-- The defaults are versioned with the schema, not typed into a settings
-- page: a complaint waits four hours, a quote a day.
create or replace function public.crm_sla_defaults()
returns table (kind public.crm_request_kind, acknowledge_hours integer, resolve_hours integer)
language sql
immutable
set search_path = pg_catalog, public
as $$
  values
    ('service'::public.crm_request_kind, 24, 120),
    ('reschedule'::public.crm_request_kind, 8, 48),
    ('question'::public.crm_request_kind, 24, 72),
    ('complaint'::public.crm_request_kind, 4, 48),
    ('cancel'::public.crm_request_kind, 24, 72),
    ('quote'::public.crm_request_kind, 24, 120);
$$;

revoke all on function public.crm_sla_defaults() from public, anon, service_role;
grant execute on function public.crm_sla_defaults() to authenticated;

create or replace function public.crm_effective_sla(p_organization uuid)
returns table (
  kind public.crm_request_kind,
  acknowledge_hours integer,
  resolve_hours integer,
  overridden boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select d.kind,
         coalesce(p.acknowledge_hours, d.acknowledge_hours),
         coalesce(p.resolve_hours, d.resolve_hours),
         p.id is not null
    from public.crm_sla_defaults() d
    left join public.crm_sla_policies p
      on p.organization_id = p_organization and p.kind = d.kind
   order by d.kind;
$$;

revoke all on function public.crm_effective_sla(uuid) from public, anon, service_role;
grant execute on function public.crm_effective_sla(uuid) to authenticated;

-- The clock. Every request submitted in the last p_days days, or still
-- open however old, with its due moments and its state on each of the two
-- promises. A stamp that was never recorded reads 'unrecorded', not met.
create or replace function public.crm_request_sla(
  p_organization uuid,
  p_days integer default 30
)
returns table (
  request_id uuid,
  account_id uuid,
  account_name text,
  kind public.crm_request_kind,
  status public.crm_request_status,
  summary text,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  acknowledge_hours integer,
  resolve_hours integer,
  acknowledge_due_at timestamptz,
  resolve_due_at timestamptz,
  acknowledge_state text,
  resolve_state text,
  waiting_minutes integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with sla as (
    select * from public.crm_effective_sla(p_organization)
  ),
  requests as (
    select r.id, r.account_id, r.kind, r.status, r.summary, r.submitted_at,
           r.acknowledged_at, r.first_response_at, r.resolved_at
      from public.crm_portal_requests r
     where r.organization_id = p_organization
       and (r.resolved_at is null
            or r.submitted_at >= now() - make_interval(days => greatest(p_days, 1)))
  ),
  clocked as (
    select r.*, acc.name as account_name,
           s.acknowledge_hours, s.resolve_hours,
           r.submitted_at + make_interval(hours => s.acknowledge_hours) as acknowledge_due_at,
           r.submitted_at + make_interval(hours => s.resolve_hours) as resolve_due_at
      from requests r
      join public.crm_accounts acc on acc.id = r.account_id
      join sla s on s.kind = r.kind
  )
  select c.id, c.account_id, c.account_name, c.kind, c.status, c.summary, c.submitted_at,
         c.acknowledged_at, c.first_response_at, c.resolved_at,
         c.acknowledge_hours, c.resolve_hours, c.acknowledge_due_at, c.resolve_due_at,
         case
           when c.acknowledged_at is not null then
             case when c.acknowledged_at <= c.acknowledge_due_at then 'met' else 'breached' end
           when c.status <> 'submitted' then 'unrecorded'
           when now() > c.acknowledge_due_at then 'overdue'
           else 'waiting'
         end as acknowledge_state,
         case
           when c.resolved_at is not null then
             case when c.resolved_at <= c.resolve_due_at then 'met' else 'breached' end
           when now() > c.resolve_due_at then 'overdue'
           else 'waiting'
         end as resolve_state,
         case
           when c.resolved_at is null then (extract(epoch from (now() - c.submitted_at)) / 60)::integer
           else null
         end as waiting_minutes
    from clocked c
   order by
     case
       when c.resolved_at is null and now() > c.resolve_due_at then 0
       when c.acknowledged_at is null and c.status = 'submitted' and now() > c.acknowledge_due_at then 1
       when c.resolved_at is null then 2
       else 3
     end,
     c.resolve_due_at;
$$;

revoke all on function public.crm_request_sla(uuid, integer) from public, anon, service_role;
grant execute on function public.crm_request_sla(uuid, integer) to authenticated;

-- --- surveys -------------------------------------------------------------------

create table if not exists public.crm_portal_surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  work_order_id uuid not null,
  portal_user_id uuid,
  score integer not null check (score between 1 and 5),
  comment text check (comment is null or char_length(btrim(comment)) between 1 and 1000),
  submitted_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint crm_portal_surveys_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_portal_surveys_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete cascade,
  constraint crm_portal_surveys_portal_user_same_org
    foreign key (organization_id, portal_user_id)
    references public.crm_portal_users (organization_id, id) on delete set null,
  constraint crm_portal_surveys_comment_no_secret check (not public.text_has_likely_secret(comment))
);

-- One rating per visit: the second attempt is refused, not averaged.
create unique index if not exists crm_portal_surveys_work_order_key
  on public.crm_portal_surveys (work_order_id);
create unique index if not exists crm_portal_surveys_org_id_key
  on public.crm_portal_surveys (organization_id, id);
create index if not exists crm_portal_surveys_org_submitted_idx
  on public.crm_portal_surveys (organization_id, submitted_at desc);

alter table public.crm_portal_surveys enable row level security;
alter table public.crm_portal_surveys force row level security;

drop policy if exists crm_portal_surveys_select_member on public.crm_portal_surveys;
create policy crm_portal_surveys_select_member on public.crm_portal_surveys
  for select to authenticated using (public.is_organization_member(organization_id));

-- Staff read. Only the customer writes, through the definer below; nobody
-- edits or deletes a rating, and no service key writes one either.
revoke all on public.crm_portal_surveys from public, anon, authenticated, service_role;
grant select on public.crm_portal_surveys to authenticated;

create or replace function public.crm_portal_survey_submit(
  p_work_order uuid,
  p_score integer,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_me record;
  v_visit record;
  v_id uuid;
begin
  select * into v_me from public.crm_portal_account_for(auth.uid());
  if v_me.account_id is null then
    raise exception 'no portal access' using errcode = 'insufficient_privilege';
  end if;
  select w.id, w.service_type, w.status
    into v_visit
    from public.crm_work_orders w
   where w.id = p_work_order and w.account_id = v_me.account_id;
  if v_visit.id is null then
    raise exception 'that visit is not on this account' using errcode = 'check_violation';
  end if;
  if v_visit.status <> 'completed' then
    raise exception 'a visit can be rated once it is completed' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.crm_portal_surveys s where s.work_order_id = p_work_order) then
    raise exception 'that visit has already been rated' using errcode = 'unique_violation';
  end if;

  insert into public.crm_portal_surveys
    (organization_id, account_id, work_order_id, portal_user_id, score, comment, created_by)
  values
    (v_me.organization_id, v_me.account_id, p_work_order, v_me.portal_user_id, p_score,
     nullif(btrim(p_comment), ''), auth.uid())
  returning id into v_id;

  -- The rating is history the account keeps.
  insert into public.crm_timeline_events
    (organization_id, account_id, kind, summary, detail, actor_user_id)
  values (
    v_me.organization_id, v_me.account_id, 'note',
    format('Rated the visit %s/5 (%s).', p_score, v_visit.service_type),
    nullif(btrim(p_comment), ''),
    auth.uid()
  );
  return v_id;
end;
$$;

revoke all on function public.crm_portal_survey_submit(uuid, integer, text) from public, anon, service_role;
grant execute on function public.crm_portal_survey_submit(uuid, integer, text) to authenticated;

create or replace function public.crm_portal_surveys_mine()
returns table (work_order_id uuid, score integer, comment text, submitted_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.work_order_id, s.score, s.comment, s.submitted_at
    from public.crm_portal_surveys s
    join public.crm_portal_account_for(auth.uid()) me on me.account_id = s.account_id
   order by s.submitted_at desc;
$$;

revoke all on function public.crm_portal_surveys_mine() from public, anon, service_role;
grant execute on function public.crm_portal_surveys_mine() to authenticated;

-- Staff: every response in the window with the visit and technician beside
-- it, and the completed visits it could have covered — so a response rate
-- has a denominator.
create or replace function public.crm_survey_responses(
  p_organization uuid,
  p_days integer default 90
)
returns table (
  survey_id uuid,
  work_order_id uuid,
  account_id uuid,
  account_name text,
  service_type text,
  technician_id uuid,
  technician_name text,
  completed_at timestamptz,
  score integer,
  comment text,
  submitted_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select s.id, s.work_order_id, s.account_id, acc.name, w.service_type,
         w.technician_id,
         case when t.id is null then null else t.first_name || coalesce(' ' || t.last_name, '') end,
         w.completed_at, s.score, s.comment, s.submitted_at
    from public.crm_portal_surveys s
    join public.crm_accounts acc on acc.id = s.account_id
    join public.crm_work_orders w on w.id = s.work_order_id
    left join public.crm_technicians t on t.id = w.technician_id
   where s.organization_id = p_organization
     and s.submitted_at >= now() - make_interval(days => greatest(p_days, 1))
   order by s.score asc, s.submitted_at desc;
$$;

revoke all on function public.crm_survey_responses(uuid, integer) from public, anon, service_role;
grant execute on function public.crm_survey_responses(uuid, integer) to authenticated;

-- --- messages ------------------------------------------------------------------

do $$ begin
  create type public.crm_message_author as enum ('customer', 'staff');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_portal_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  request_id uuid,
  author_kind public.crm_message_author not null,
  portal_user_id uuid,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  constraint crm_portal_messages_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_portal_messages_request_same_org
    foreign key (organization_id, request_id)
    references public.crm_portal_requests (organization_id, id) on delete set null,
  constraint crm_portal_messages_portal_user_same_org
    foreign key (organization_id, portal_user_id)
    references public.crm_portal_users (organization_id, id) on delete set null,
  -- A customer message carries its portal seat; a staff message its author.
  constraint crm_portal_messages_author_matches_kind
    check ((author_kind = 'customer') = (portal_user_id is not null)),
  constraint crm_portal_messages_read_after_sent check (read_at is null or read_at >= sent_at),
  constraint crm_portal_messages_body_no_secret check (not public.text_has_likely_secret(body))
);

create unique index if not exists crm_portal_messages_org_id_key
  on public.crm_portal_messages (organization_id, id);
create index if not exists crm_portal_messages_org_account_sent_idx
  on public.crm_portal_messages (organization_id, account_id, sent_at desc);
create index if not exists crm_portal_messages_unread_idx
  on public.crm_portal_messages (organization_id, author_kind) where read_at is null;

alter table public.crm_portal_messages enable row level security;
alter table public.crm_portal_messages force row level security;

drop policy if exists crm_portal_messages_select_member on public.crm_portal_messages;
create policy crm_portal_messages_select_member on public.crm_portal_messages
  for select to authenticated using (public.is_organization_member(organization_id));
-- Staff write their own messages, as staff, under their own id.
drop policy if exists crm_portal_messages_insert_member on public.crm_portal_messages;
create policy crm_portal_messages_insert_member on public.crm_portal_messages
  for insert to authenticated
  with check (
    public.is_organization_member(organization_id)
    and author_kind = 'staff'
    and author_user_id = auth.uid()
  );
drop policy if exists crm_portal_messages_update_member on public.crm_portal_messages;
create policy crm_portal_messages_update_member on public.crm_portal_messages
  for update to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

revoke all on public.crm_portal_messages from public, anon, authenticated, service_role;
grant select, insert, update on public.crm_portal_messages to authenticated;

-- A message is what was said. Only read_at may change after it is sent.
create or replace function public.crm_portal_message_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.body is distinct from old.body
     or new.author_kind is distinct from old.author_kind
     or new.portal_user_id is distinct from old.portal_user_id
     or new.author_user_id is distinct from old.author_user_id
     or new.account_id is distinct from old.account_id
     or new.request_id is distinct from old.request_id
     or new.sent_at is distinct from old.sent_at
     or new.organization_id is distinct from old.organization_id then
    raise exception 'a sent message cannot be changed; only its read mark can'
      using errcode = 'check_violation';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'a read mark is set once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_portal_message_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_portal_messages_immutable on public.crm_portal_messages;
create trigger crm_portal_messages_immutable
  before update on public.crm_portal_messages
  for each row execute function public.crm_portal_message_immutable();

create or replace function public.crm_portal_message_send(
  p_body text,
  p_request uuid default null
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
  if p_request is not null and not exists (
    select 1 from public.crm_portal_requests r
     where r.id = p_request and r.account_id = v_me.account_id
  ) then
    raise exception 'that request is not on this account' using errcode = 'check_violation';
  end if;
  insert into public.crm_portal_messages
    (organization_id, account_id, request_id, author_kind, portal_user_id, body)
  values
    (v_me.organization_id, v_me.account_id, p_request, 'customer', v_me.portal_user_id, btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.crm_portal_message_send(text, uuid) from public, anon, service_role;
grant execute on function public.crm_portal_message_send(text, uuid) to authenticated;

create or replace function public.crm_portal_messages_mine()
returns table (
  id uuid,
  request_id uuid,
  author_kind public.crm_message_author,
  body text,
  sent_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.id, m.request_id, m.author_kind, m.body, m.sent_at, m.read_at
    from public.crm_portal_messages m
    join public.crm_portal_account_for(auth.uid()) me on me.account_id = m.account_id
   order by m.sent_at asc
   limit 500;
$$;

revoke all on function public.crm_portal_messages_mine() from public, anon, service_role;
grant execute on function public.crm_portal_messages_mine() to authenticated;

-- The customer has seen what staff wrote. Returns how many were marked.
create or replace function public.crm_portal_messages_mark_read()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_me record;
  v_count integer;
begin
  select * into v_me from public.crm_portal_account_for(auth.uid());
  if v_me.account_id is null then
    raise exception 'no portal access' using errcode = 'insufficient_privilege';
  end if;
  update public.crm_portal_messages
     set read_at = now()
   where account_id = v_me.account_id
     and author_kind = 'staff'
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.crm_portal_messages_mark_read() from public, anon, service_role;
grant execute on function public.crm_portal_messages_mark_read() to authenticated;
