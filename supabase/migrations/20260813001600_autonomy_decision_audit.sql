-- Make the loop's decisions auditable.
--
-- `AGENTS.md` requires important state transitions to create immutable
-- activity/audit events. An approval decision is exactly that: it is the moment
-- the loop concluded a change may or may not proceed, and it is the thing
-- someone will need to reconstruct afterwards when asking "why did it merge
-- that?" or "why did it refuse this?".
--
-- Until now every Phase 1D decision was computed and thrown away. The modules
-- even carried fields labelled "for the audit record" against a record that did
-- not exist. This adds it.
--
-- The table is append-only and holds no free text from a provider: only the
-- decision, the named blockers, and the identifiers needed to tie it back to a
-- commit and a person.

create table public.autonomy_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  -- What was being decided.
  action text not null check (action in (
    'plan', 'code', 'test', 'repair', 'review', 'approve', 'merge', 'deploy', 'rollback'
  )),
  decision text not null check (decision in (
    'APPROVED_AUTOMATICALLY', 'OWNER_APPROVAL_REQUIRED', 'NOT_APPROVED'
  )),

  -- What it was decided against.
  risk public.risk_level not null,
  risk_escalated boolean not null default false,
  head_sha text check (head_sha is null or head_sha ~ '^[0-9a-f]{7,40}$'),

  -- Who. Both may be null when no human was involved in that role.
  author_id uuid references auth.users(id) on delete set null,
  approver_id uuid references auth.users(id) on delete set null,

  -- Why. Named blockers only; never a provider message or free-form reasoning.
  blockers text[] not null default '{}'::text[],
  reached_stage text,

  policy_version text not null,
  decided_at timestamptz not null default now(),

  constraint autonomy_decisions_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,

  -- The rule the whole phase turns on, enforced here too: an approval whose
  -- approver is its author is not a valid record of an independent decision.
  constraint autonomy_decisions_no_self_approval check (
    decision <> 'APPROVED_AUTOMATICALLY'
    or approver_id is null
    or author_id is null
    or approver_id <> author_id
  ),

  -- A refusal must say why; an approval must not claim a blocker.
  constraint autonomy_decisions_blockers_match_decision check (
    (decision = 'APPROVED_AUTOMATICALLY' and cardinality(blockers) = 0)
    or (decision <> 'APPROVED_AUTOMATICALLY' and cardinality(blockers) > 0)
  )
);

comment on table public.autonomy_decisions is
  'Immutable record of every autonomous-loop decision: what was decided, against which commit and risk, by whom, and which named blockers applied.';
comment on column public.autonomy_decisions.blockers is
  'Named blocker codes only. Never a provider message, a diff, or intermediate reasoning.';

create index autonomy_decisions_project_recent
  on public.autonomy_decisions (project_id, decided_at desc);

alter table public.autonomy_decisions enable row level security;
alter table public.autonomy_decisions force row level security;

-- Members may read their own organization's decisions; nobody writes from a
-- browser. Insertion goes through the SECURITY DEFINER function below.
create policy autonomy_decisions_select_members
  on public.autonomy_decisions for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.autonomy_decisions from anon, authenticated;
grant select on table public.autonomy_decisions to authenticated;

-- Append-only: a decision that can be edited afterwards is not evidence.
create or replace function public.reject_autonomy_decision_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'autonomy decision records are append-only';
end;
$function$;

create trigger autonomy_decisions_append_only
  before update or delete on public.autonomy_decisions
  for each row execute function public.reject_autonomy_decision_mutation();

revoke all on function public.reject_autonomy_decision_mutation() from public, anon, authenticated;

create or replace function public.record_autonomy_decision(
  p_project_id uuid,
  p_action text,
  p_decision text,
  p_risk public.risk_level,
  p_blockers text[],
  p_policy_version text,
  p_head_sha text default null,
  p_author_id uuid default null,
  p_approver_id uuid default null,
  p_risk_escalated boolean default false,
  p_reached_stage text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  decision_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = '42704', message = 'project not found';
  end if;

  if not public.is_organization_member(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  insert into public.autonomy_decisions (
    organization_id, project_id, action, decision, risk, risk_escalated,
    head_sha, author_id, approver_id, blockers, reached_stage, policy_version
  ) values (
    project_record.organization_id, p_project_id, p_action, p_decision, p_risk, p_risk_escalated,
    p_head_sha, p_author_id, p_approver_id,
    coalesce(p_blockers, '{}'::text[]), p_reached_stage, p_policy_version
  )
  returning id into decision_id;

  return decision_id;
end;
$function$;

comment on function public.record_autonomy_decision is
  'Append one immutable autonomy decision. Refuses a self-approval and refuses a refusal with no named blocker.';

revoke all on function public.record_autonomy_decision(
  uuid, text, text, public.risk_level, text[], text, text, uuid, uuid, boolean, text
) from public, anon;
grant execute on function public.record_autonomy_decision(
  uuid, text, text, public.risk_level, text[], text, text, uuid, uuid, boolean, text
) to authenticated;
