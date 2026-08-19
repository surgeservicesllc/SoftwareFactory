-- The improvement ledger: Phase 3's step 2, modelled on autonomy_decisions.
--
-- The Phase 3 audit named the central gap precisely: "An AI recommendation is
-- NOT improvement." A recommendation becomes an improvement only when a
-- baseline was captured before the change, a falsifiable prediction was made,
-- and an after-state was compared against both. This table is where that
-- lifecycle lives — append-only, because an improvement loop that could edit
-- its own history could improve its score by rewriting it.
--
-- One table, four entry types, each a permanent event in a proposal's life:
--
--   proposal        title, what changes, the prediction, the baseline, the
--                   acceptance criteria, and the constitution version that
--                   judged the intent (factory-constitution-v1 onward).
--   decision        accepted or rejected, with the reason.
--   implementation  the command id the work went through — improvements ride
--                   the ordinary submit_command path (goals 24/25), never a
--                   special self-edit door.
--   evaluation      the measured after-state, the outcome against the
--                   prediction, and the lesson. Recorded even for failures —
--                   especially for failures.
--
-- The one rule enforced hardest at the boundary: no proposal without a
-- non-empty baseline. A proposal that cannot say what the world looked like
-- before it is a recommendation wearing improvement's clothes.

alter type public.activity_event_type add value if not exists 'improvement.proposed';
alter type public.activity_event_type add value if not exists 'improvement.decided';
alter type public.activity_event_type add value if not exists 'improvement.evaluated';

create table public.improvement_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  -- Null for factory-wide improvements; set for project-scoped ones.
  project_id uuid,

  entry_type text not null check (
    entry_type in ('proposal', 'decision', 'implementation', 'evaluation')
  ),
  -- The proposal row this entry belongs to. A proposal row points at itself
  -- after insert (enforced in the recording function), so one id groups a
  -- proposal's whole life.
  proposal_id uuid,

  title text check (
    title is null or (
      char_length(btrim(title)) between 3 and 200
      and not public.text_has_likely_secret(title)
    )
  ),
  proposal text check (
    proposal is null or (
      char_length(btrim(proposal)) between 10 and 4000
      and not public.text_has_likely_secret(proposal)
    )
  ),
  prediction text check (
    prediction is null or (
      char_length(btrim(prediction)) between 10 and 2000
      and not public.text_has_likely_secret(prediction)
    )
  ),
  baseline jsonb check (
    baseline is null or (
      jsonb_typeof(baseline) = 'object'
      and octet_length(baseline::text) <= 16384
      and not public.jsonb_has_sensitive_keys(baseline)
    )
  ),
  acceptance_criteria jsonb check (
    acceptance_criteria is null or (
      jsonb_typeof(acceptance_criteria) = 'array'
      and jsonb_array_length(acceptance_criteria) between 1 and 12
      and octet_length(acceptance_criteria::text) <= 8192
      and not public.jsonb_has_sensitive_keys(acceptance_criteria)
    )
  ),
  constitution_version text check (
    constitution_version is null or constitution_version ~ '^[a-z0-9-]{5,80}$'
  ),

  decision text check (decision in ('accepted', 'rejected')),
  reason text check (
    reason is null or (
      char_length(btrim(reason)) between 3 and 1000
      and not public.text_has_likely_secret(reason)
    )
  ),

  command_id uuid,

  actual jsonb check (
    actual is null or (
      jsonb_typeof(actual) = 'object'
      and octet_length(actual::text) <= 16384
      and not public.jsonb_has_sensitive_keys(actual)
    )
  ),
  outcome text check (outcome in ('improved', 'no_change', 'regressed')),
  lesson text check (
    lesson is null or (
      char_length(btrim(lesson)) between 10 and 2000
      and not public.text_has_likely_secret(lesson)
    )
  ),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint improvement_ledger_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint improvement_ledger_command_fk foreign key (command_id, organization_id)
    references public.commands(id, organization_id) on delete restrict,
  constraint improvement_ledger_proposal_fk foreign key (proposal_id)
    references public.improvement_ledger(id) on delete restrict,

  -- Each entry type carries exactly its own evidence. A row that mixes them
  -- would be a row nobody can read back unambiguously.
  constraint improvement_ledger_entry_shape check (
    (entry_type = 'proposal'
      and title is not null and proposal is not null and prediction is not null
      and baseline is not null and acceptance_criteria is not null
      and constitution_version is not null
      and decision is null and command_id is null
      and actual is null and outcome is null and lesson is null)
    or (entry_type = 'decision'
      and decision is not null and reason is not null
      and title is null and proposal is null and prediction is null
      and baseline is null and acceptance_criteria is null
      and constitution_version is null and command_id is null
      and actual is null and outcome is null and lesson is null)
    or (entry_type = 'implementation'
      and command_id is not null
      and title is null and proposal is null and prediction is null
      and baseline is null and acceptance_criteria is null
      and constitution_version is null and decision is null
      and actual is null and outcome is null and lesson is null)
    or (entry_type = 'evaluation'
      and actual is not null and outcome is not null and lesson is not null
      and title is null and proposal is null and prediction is null
      and baseline is null and acceptance_criteria is null
      and constitution_version is null and decision is null and command_id is null)
  )
);

comment on table public.improvement_ledger is
  'Append-only lifecycle of factory self-improvement: proposal (with baseline, prediction, and the constitution version that judged it), decision, implementation through the ordinary command path, and measured evaluation with a lesson. A recommendation is not an improvement; this table is the difference.';

create index improvement_ledger_recent_idx
  on public.improvement_ledger (organization_id, created_at desc);
create index improvement_ledger_proposal_idx
  on public.improvement_ledger (proposal_id, created_at);

alter table public.improvement_ledger enable row level security;
alter table public.improvement_ledger force row level security;

create policy improvement_ledger_select_members
  on public.improvement_ledger for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.improvement_ledger from anon, authenticated, service_role;
grant select on table public.improvement_ledger to authenticated;

create or replace function public.improvement_ledger_is_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'improvement_ledger is append-only';
end;
$function$;

create trigger improvement_ledger_no_update
  before update or delete on public.improvement_ledger
  for each row execute function public.improvement_ledger_is_append_only();

create or replace function public.record_improvement_proposal(
  p_project_id uuid,
  p_title text,
  p_proposal text,
  p_prediction text,
  p_baseline jsonb,
  p_acceptance_criteria jsonb,
  p_constitution_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  organization_record uuid;
  -- Generated up front so the proposal row can reference itself at insert:
  -- the append-only trigger (correctly) refuses the update that would
  -- otherwise set proposal_id after the fact.
  entry_id uuid := gen_random_uuid();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if p_project_id is not null then
    select project.organization_id into organization_record
    from public.projects project
    where project.id = p_project_id
      and public.is_organization_owner(project.organization_id);
    if not found then
      raise exception using errcode = 'P0002', message = 'project not found';
    end if;
  else
    select membership.organization_id into organization_record
    from public.organization_members membership
    where membership.user_id = caller_id and membership.role = 'owner'
    order by membership.created_at
    limit 1;
    if organization_record is null then
      raise exception using errcode = '42501',
        message = 'only an organization owner may record an improvement proposal';
    end if;
  end if;

  -- The rule the whole ledger exists for.
  if p_baseline is null or jsonb_typeof(p_baseline) <> 'object' or p_baseline = '{}'::jsonb then
    raise exception using errcode = '22023',
      message = 'a proposal without a baseline is a recommendation, not an improvement';
  end if;

  insert into public.improvement_ledger (
    id, organization_id, project_id, entry_type, proposal_id, title, proposal,
    prediction, baseline, acceptance_criteria, constitution_version, created_by
  ) values (
    entry_id, organization_record, p_project_id, 'proposal', entry_id, p_title,
    p_proposal, p_prediction, p_baseline, p_acceptance_criteria,
    p_constitution_version, caller_id
  );

  perform public.record_activity_event(
    organization_record, p_project_id,
    'improvement.proposed'::public.activity_event_type,
    'improvement', entry_id,
    'Improvement proposed with baseline and prediction',
    jsonb_build_object('constitutionVersion', p_constitution_version)
  );

  return entry_id;
end;
$function$;

create or replace function public.record_improvement_decision(
  p_proposal_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  proposal_record public.improvement_ledger%rowtype;
  entry_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select entry.* into proposal_record
  from public.improvement_ledger entry
  where entry.id = p_proposal_id and entry.entry_type = 'proposal'
    and public.is_organization_owner(entry.organization_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'proposal not found';
  end if;

  if exists (
    select 1 from public.improvement_ledger entry
    where entry.proposal_id = p_proposal_id and entry.entry_type = 'decision'
  ) then
    raise exception using errcode = '22023',
      message = 'this proposal is already decided; the ledger does not re-decide';
  end if;

  insert into public.improvement_ledger (
    organization_id, project_id, entry_type, proposal_id, decision, reason, created_by
  ) values (
    proposal_record.organization_id, proposal_record.project_id, 'decision',
    p_proposal_id, p_decision, p_reason, caller_id
  )
  returning id into entry_id;

  perform public.record_activity_event(
    proposal_record.organization_id, proposal_record.project_id,
    'improvement.decided'::public.activity_event_type,
    'improvement', p_proposal_id,
    'Improvement proposal ' || p_decision,
    jsonb_build_object('reason', p_reason)
  );

  return entry_id;
end;
$function$;

create or replace function public.record_improvement_implementation(
  p_proposal_id uuid,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  proposal_record public.improvement_ledger%rowtype;
  entry_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select entry.* into proposal_record
  from public.improvement_ledger entry
  where entry.id = p_proposal_id and entry.entry_type = 'proposal'
    and public.is_organization_owner(entry.organization_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'proposal not found';
  end if;

  -- Implementation follows acceptance. Recording work against an undecided
  -- or rejected proposal would let the loop act first and ask later.
  if not exists (
    select 1 from public.improvement_ledger entry
    where entry.proposal_id = p_proposal_id and entry.entry_type = 'decision'
      and entry.decision = 'accepted'
  ) then
    raise exception using errcode = '22023',
      message = 'implementation requires an accepted decision first';
  end if;

  if not exists (
    select 1 from public.commands command
    where command.id = p_command_id
      and command.organization_id = proposal_record.organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'command not found';
  end if;

  insert into public.improvement_ledger (
    organization_id, project_id, entry_type, proposal_id, command_id, created_by
  ) values (
    proposal_record.organization_id, proposal_record.project_id,
    'implementation', p_proposal_id, p_command_id, caller_id
  )
  returning id into entry_id;

  return entry_id;
end;
$function$;

create or replace function public.record_improvement_evaluation(
  p_proposal_id uuid,
  p_actual jsonb,
  p_outcome text,
  p_lesson text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  proposal_record public.improvement_ledger%rowtype;
  entry_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select entry.* into proposal_record
  from public.improvement_ledger entry
  where entry.id = p_proposal_id and entry.entry_type = 'proposal'
    and public.is_organization_owner(entry.organization_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'proposal not found';
  end if;

  if not exists (
    select 1 from public.improvement_ledger entry
    where entry.proposal_id = p_proposal_id and entry.entry_type = 'decision'
      and entry.decision = 'accepted'
  ) then
    raise exception using errcode = '22023',
      message = 'evaluation requires an accepted decision first';
  end if;

  if exists (
    select 1 from public.improvement_ledger entry
    where entry.proposal_id = p_proposal_id and entry.entry_type = 'evaluation'
  ) then
    raise exception using errcode = '22023',
      message = 'this proposal is already evaluated; a second evaluation would be score shopping';
  end if;

  if p_actual is null or jsonb_typeof(p_actual) <> 'object' or p_actual = '{}'::jsonb then
    raise exception using errcode = '22023',
      message = 'an evaluation without measured after-state is an opinion, not an outcome';
  end if;

  insert into public.improvement_ledger (
    organization_id, project_id, entry_type, proposal_id, actual, outcome,
    lesson, created_by
  ) values (
    proposal_record.organization_id, proposal_record.project_id, 'evaluation',
    p_proposal_id, p_actual, p_outcome, p_lesson, caller_id
  )
  returning id into entry_id;

  perform public.record_activity_event(
    proposal_record.organization_id, proposal_record.project_id,
    'improvement.evaluated'::public.activity_event_type,
    'improvement', p_proposal_id,
    'Improvement evaluated: ' || p_outcome,
    jsonb_build_object('outcome', p_outcome)
  );

  return entry_id;
end;
$function$;

revoke all on function public.improvement_ledger_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function public.record_improvement_proposal(uuid, text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_improvement_decision(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_improvement_implementation(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_improvement_evaluation(uuid, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_improvement_proposal(uuid, text, text, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.record_improvement_decision(uuid, text, text) to authenticated;
grant execute on function public.record_improvement_implementation(uuid, uuid) to authenticated;
grant execute on function public.record_improvement_evaluation(uuid, jsonb, text, text) to authenticated;
