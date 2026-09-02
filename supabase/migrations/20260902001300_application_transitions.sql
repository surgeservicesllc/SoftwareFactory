-- ---------------------------------------------------------------------------
-- Silence measured: application transitions, closure reasons, reply stats
-- (ADR-243)
-- ---------------------------------------------------------------------------
--
-- The complaint 67% of job seekers made in 2025 is silence: applied, and
-- nothing. The boards cannot answer it because they never learn the outcome.
-- This product can, because the person records every stage change here —
-- but until now those changes were overwritten in place, so "how long did
-- replies take" had no data behind it. This migration keeps the history:
-- one append-only row per stage or approval change, written by a trigger so
-- the ledger cannot disagree with the applications table, and readable by
-- its owner under forced RLS.
--
-- A closed application also says why. The reason is the person's own word,
-- allowed only while the stage is CLOSED, and it is what turns "why do my
-- applications end?" from a feeling into a count.

do $$ begin
  create type public.job_seeker_closed_reason as enum (
    'no_response',
    'rejected_before_interview',
    'rejected_after_interview',
    'withdrew',
    'offer_declined',
    'position_filled',
    'other'
  );
exception when duplicate_object then null; end $$;

alter table public.job_seeker_applications
  add column if not exists closed_reason public.job_seeker_closed_reason;

alter table public.job_seeker_applications
  drop constraint if exists job_seeker_applications_closed_reason_only_when_closed;
alter table public.job_seeker_applications
  add constraint job_seeker_applications_closed_reason_only_when_closed
  check (closed_reason is null or stage = 'CLOSED');

comment on column public.job_seeker_applications.closed_reason is
  'Why the application ended, in the person''s own word; allowed only while the stage is CLOSED (ADR-243).';

-- The referenced identity for the ledger's composite foreign key: a
-- transition must belong to the same person and workspace as its
-- application, provably, not by trusting a supplied user_id.
alter table public.job_seeker_applications
  drop constraint if exists job_seeker_applications_owner_identity_key;
alter table public.job_seeker_applications
  add constraint job_seeker_applications_owner_identity_key
  unique (id, organization_id, user_id);

create table if not exists public.job_seeker_application_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  from_stage public.job_seeker_stage,
  to_stage public.job_seeker_stage not null,
  from_approval public.job_seeker_approval,
  to_approval public.job_seeker_approval not null,
  closed_reason public.job_seeker_closed_reason,
  occurred_at timestamptz not null default now(),
  constraint job_seeker_application_transitions_owner_fkey
    foreign key (application_id, organization_id, user_id)
    references public.job_seeker_applications (id, organization_id, user_id)
    on delete cascade
);

comment on table public.job_seeker_application_transitions is
  'Append-only history of every stage or approval change on a person''s applications, written by trigger (ADR-243). What "days to reply" is counted from.';

create index if not exists job_seeker_application_transitions_person_idx
  on public.job_seeker_application_transitions (organization_id, user_id, application_id, occurred_at);

alter table public.job_seeker_application_transitions enable row level security;
alter table public.job_seeker_application_transitions force row level security;

revoke all on table public.job_seeker_application_transitions from public, anon, authenticated, service_role;
grant select on table public.job_seeker_application_transitions to authenticated;

drop policy if exists job_seeker_application_transitions_select_own on public.job_seeker_application_transitions;
create policy job_seeker_application_transitions_select_own
  on public.job_seeker_application_transitions
  for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

-- The ledger is written only by this trigger. SECURITY DEFINER so the row
-- lands without handing authenticated an INSERT grant on the table; the
-- values come from the application row that just changed, never from the
-- caller.
create or replace function public.job_seeker_record_application_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.job_seeker_application_transitions
      (organization_id, user_id, application_id, from_stage, to_stage, from_approval, to_approval, closed_reason)
    values
      (new.organization_id, new.user_id, new.id, null, new.stage, null, new.approval_status, new.closed_reason);
  elsif new.stage is distinct from old.stage
     or new.approval_status is distinct from old.approval_status
     or new.closed_reason is distinct from old.closed_reason then
    insert into public.job_seeker_application_transitions
      (organization_id, user_id, application_id, from_stage, to_stage, from_approval, to_approval, closed_reason)
    values
      (new.organization_id, new.user_id, new.id, old.stage, new.stage, old.approval_status, new.approval_status, new.closed_reason);
  end if;
  return new;
end;
$function$;

drop trigger if exists job_seeker_applications_record_transition on public.job_seeker_applications;
create trigger job_seeker_applications_record_transition
  after insert or update on public.job_seeker_applications
  for each row execute function public.job_seeker_record_application_transition();

-- History is evidence: rewriting a transition would make "replied after 12
-- days" say something other than what happened.
create or replace function public.job_seeker_application_transitions_no_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'application transitions are append-only; days to reply are counted from what happened';
end;
$function$;

drop trigger if exists job_seeker_application_transitions_immutable on public.job_seeker_application_transitions;
create trigger job_seeker_application_transitions_immutable
  before update or delete on public.job_seeker_application_transitions
  for each row execute function public.job_seeker_application_transitions_no_rewrite();

-- When each of the caller's applications first got a reply: the first
-- transition into a response stage, or a closure whose reason is the
-- employer's answer. A rejection is a reply — silence is the complaint.
create or replace function public.job_seeker_application_replies(p_organization_id uuid)
returns table (application_id uuid, replied_at timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select t.application_id, min(t.occurred_at) as replied_at
    from public.job_seeker_application_transitions t
   where t.organization_id = p_organization_id
     and t.user_id = auth.uid()
     and (
       t.to_stage in ('RECRUITER_RESPONSE', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER')
       or (t.to_stage = 'CLOSED'
           and t.closed_reason in ('rejected_before_interview', 'rejected_after_interview', 'position_filled'))
     )
   group by t.application_id;
$function$;

revoke all on function public.job_seeker_application_replies(uuid) from public, anon, authenticated, service_role;
grant execute on function public.job_seeker_application_replies(uuid) to authenticated;

-- Reply statistics per source, plus one row for every source together
-- (source = null): applications submitted, replies recorded, still silent,
-- and the median days from applied to the first reply. Under the caller's
-- own RLS; a median over nothing is null, never zero.
create or replace function public.job_seeker_response_stats(p_organization_id uuid)
returns table (
  source text,
  applied integer,
  replied integer,
  silent integer,
  median_days_to_reply numeric
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  with apps as (
    select a.id, a.applied_at, a.stage, j.source
      from public.job_seeker_applications a
      join public.job_seeker_jobs j on j.id = a.job_id
     where a.organization_id = p_organization_id
       and a.user_id = auth.uid()
       and a.applied_at is not null
  ),
  replies as (
    select r.application_id, r.replied_at
      from public.job_seeker_application_replies(p_organization_id) r
  ),
  joined as (
    select apps.source, apps.applied_at, apps.stage, replies.replied_at
      from apps left join replies on replies.application_id = apps.id
  ),
  grouped as (
    select j.source,
           count(*)::integer as applied,
           count(j.replied_at)::integer as replied,
           count(*) filter (where j.replied_at is null and j.stage <> 'CLOSED')::integer as silent,
           round((percentile_cont(0.5) within group (
             order by extract(epoch from (j.replied_at - j.applied_at)) / 86400.0
           ) filter (where j.replied_at is not null and j.replied_at >= j.applied_at))::numeric, 1) as median_days_to_reply
      from joined j
     group by rollup (j.source)
    -- ROLLUP over nothing still yields its grand-total row; a person with no
    -- submitted applications has no statistics, not a row of zeroes.
    having count(*) > 0
  )
  select g.source, g.applied, g.replied, g.silent, g.median_days_to_reply
    from grouped g
   order by g.source nulls first;
$function$;

revoke all on function public.job_seeker_response_stats(uuid) from public, anon, authenticated, service_role;
grant execute on function public.job_seeker_response_stats(uuid) to authenticated;
