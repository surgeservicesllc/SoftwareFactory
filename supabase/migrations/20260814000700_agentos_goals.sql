-- AgentOS goals — the gauntlet loop.
--
-- docs/AGENTOS_SPEC.md §11. A human writes a spec, the system drafts a
-- definition of done, the human approves it, and an orchestrator dispatches
-- specialists until every checkbox is satisfied or a rail stops the loop.
--
-- The rails are the point. The spec's own anecdote is a goal left running
-- overnight without a cap that cost $1000, so:
--
--   * A goal cannot spawn before its definition of done is approved.
--   * A goal either carries a spend cap or records that a human explicitly
--     accepted running without one. Silence is not consent.
--   * Time and repetition stop the loop as firmly as spend does.
--
-- `agentos_goal_spawn_decision` is the single answer to "may this goal
-- dispatch another specialist", returning a named blocker rather than a bare
-- boolean, so a caller cannot mistake "not yet" for "no reason given".
--
-- This migration dispatches nothing. Every decision here is advisory until a
-- runner exists, and the decision function says so with its own blocker code.

create type public.agentos_goal_status as enum (
  'draft', 'awaiting_dod_approval', 'active', 'paused',
  'completed', 'stopped_spend', 'stopped_time', 'stopped_stuck', 'stopped_by_human'
);

create table public.agentos_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,

  title text not null check (char_length(btrim(title)) between 1 and 240),
  spec text not null check (char_length(btrim(spec)) between 1 and 20000),
  status public.agentos_goal_status not null default 'draft',

  -- The human approves the definition of done before anything runs. Both
  -- fields move together so an approved goal always names who approved it.
  dod_approved_by uuid references auth.users(id) on delete restrict,
  dod_approved_at timestamptz,

  -- Rails.
  spend_cap_usd numeric(10, 2) check (spend_cap_usd is null or spend_cap_usd >= 0),
  -- Running without a cap is allowed only as an explicit, attributed choice.
  uncapped_spend_acknowledged_by uuid references auth.users(id) on delete restrict,
  max_duration_minutes integer check (max_duration_minutes is null or max_duration_minutes > 0),
  stuck_threshold smallint not null default 19 check (stuck_threshold between 2 and 100),

  spent_usd numeric(10, 2) not null default 0 check (spent_usd >= 0),
  started_at timestamptz,
  stopped_at timestamptz,
  stopped_reason text check (stopped_reason is null or char_length(stopped_reason) <= 500),

  runner_preference text not null default 'auto'
    check (runner_preference in ('cloud', 'local', 'auto')),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_goals_id_organization_unique unique (id, organization_id),
  constraint agentos_goals_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,

  -- An approval is a fact about a person and a moment, or it is neither.
  constraint agentos_goals_dod_approval_complete check (
    (dod_approved_by is null and dod_approved_at is null)
    or (dod_approved_by is not null and dod_approved_at is not null)
  ),
  -- Nothing past awaiting-approval exists without that approval.
  constraint agentos_goals_active_requires_dod check (
    status in ('draft', 'awaiting_dod_approval') or dod_approved_at is not null
  ),
  -- Either a cap, or a named human who accepted its absence.
  constraint agentos_goals_spend_is_bounded_or_acknowledged check (
    status in ('draft', 'awaiting_dod_approval')
    or spend_cap_usd is not null
    or uncapped_spend_acknowledged_by is not null
  ),
  constraint agentos_goals_stopped_is_attributed check (
    (status in ('completed','stopped_spend','stopped_time','stopped_stuck','stopped_by_human')
      and stopped_at is not null)
    or (status not in ('completed','stopped_spend','stopped_time','stopped_stuck','stopped_by_human')
      and stopped_at is null)
  ),
  constraint agentos_goals_spec_no_secret check (not public.text_has_likely_secret(spec))
);

comment on table public.agentos_goals is
  'An open-ended goal. Cannot dispatch work before its definition of done is approved, and either carries a spend cap or records who accepted running without one.';

-- ---------------------------------------------------------------------------
-- Definition of done
-- ---------------------------------------------------------------------------

create table public.agentos_goal_dod_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  goal_id uuid not null,
  item_index smallint not null check (item_index >= 1 and item_index <= 100),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  satisfied boolean not null default false,
  -- Evidence, not a claim. Which iteration marked it, so a reviewer can look.
  satisfied_at timestamptz,
  satisfied_by_iteration integer,
  created_at timestamptz not null default now(),

  constraint agentos_goal_dod_unique unique (goal_id, item_index),
  constraint agentos_goal_dod_goal_fk foreign key (goal_id, organization_id)
    references public.agentos_goals(id, organization_id) on delete cascade,
  constraint agentos_goal_dod_satisfied_consistent check (
    (satisfied and satisfied_at is not null) or (not satisfied and satisfied_at is null)
  )
);

-- ---------------------------------------------------------------------------
-- Append-only progress log
-- ---------------------------------------------------------------------------

create table public.agentos_goal_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  goal_id uuid not null,
  iteration integer not null check (iteration >= 1),
  agent_name text not null check (agent_name ~ '^[a-z][a-z0-9-]{0,62}$'),
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  -- What the loop compares to decide whether anything actually moved.
  -- Derived from the unresolved checkboxes plus the work claimed.
  progress_fingerprint text not null check (progress_fingerprint ~ '^[a-f0-9]{64}$'),
  cost_usd numeric(10, 2) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),

  constraint agentos_goal_progress_goal_fk foreign key (goal_id, organization_id)
    references public.agentos_goals(id, organization_id) on delete cascade,
  constraint agentos_goal_progress_summary_no_secret check (
    not public.text_has_likely_secret(summary)
  )
);

comment on column public.agentos_goal_progress.progress_fingerprint is
  'Digest of the unresolved checkboxes and the work claimed. Identical consecutive fingerprints are what "stuck" means: the loop repeating itself rather than advancing.';

-- Append-only. A loop that can rewrite its own history cannot be audited, and
-- stuck detection reads exactly this table.
create or replace function public.agentos_reject_goal_progress_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'goal progress entries are append-only';
end;
$function$;

create trigger agentos_goal_progress_append_only
  before update or delete on public.agentos_goal_progress
  for each row execute function public.agentos_reject_goal_progress_mutation();

create index agentos_goals_project_idx on public.agentos_goals (organization_id, project_id, created_at desc);
create index agentos_goal_dod_goal_idx on public.agentos_goal_dod_items (organization_id, goal_id, item_index);
create index agentos_goal_progress_goal_idx
  on public.agentos_goal_progress (organization_id, goal_id, iteration desc);

alter table public.agentos_goals enable row level security;
alter table public.agentos_goals force row level security;
alter table public.agentos_goal_dod_items enable row level security;
alter table public.agentos_goal_dod_items force row level security;
alter table public.agentos_goal_progress enable row level security;
alter table public.agentos_goal_progress force row level security;

create policy agentos_goals_select_members on public.agentos_goals for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_goal_dod_select_members on public.agentos_goal_dod_items for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_goal_progress_select_members on public.agentos_goal_progress for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.agentos_goals from anon, authenticated;
revoke all on table public.agentos_goal_dod_items from anon, authenticated;
revoke all on table public.agentos_goal_progress from anon, authenticated;
grant select on table public.agentos_goals to authenticated;
grant select on table public.agentos_goal_dod_items to authenticated;
grant select on table public.agentos_goal_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Approving the definition of done
-- ---------------------------------------------------------------------------

create or replace function public.agentos_approve_goal_dod(
  p_goal_id uuid,
  p_spend_cap_usd numeric default null,
  p_accept_uncapped_spend boolean default false
)
returns public.agentos_goals
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  goal_record public.agentos_goals;
  updated public.agentos_goals;
  item_count integer;
  is_manager boolean;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into goal_record from public.agentos_goals where id = p_goal_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'the goal does not exist or is not visible';
  end if;
  if not public.is_organization_member(goal_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select exists (
    select 1 from public.organization_members m
     where m.organization_id = goal_record.organization_id
       and m.user_id = caller_id and m.role in ('owner', 'admin')
  ) or public.is_organization_owner(goal_record.organization_id) into is_manager;

  if not is_manager then
    raise exception using
      errcode = '42501',
      message = 'only an owner or administrator may approve a definition of done';
  end if;

  if goal_record.dod_approved_at is not null then
    raise exception using errcode = '22023', message = 'the definition of done is already approved';
  end if;

  -- Approving an empty definition of done would mean "finished" is
  -- immediately true and the loop completes having done nothing.
  select count(*) into item_count
    from public.agentos_goal_dod_items where goal_id = p_goal_id;
  if item_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'a definition of done must have at least one item before approval';
  end if;

  -- The spec asks that a cap be hard to forget. Absence has to be chosen.
  if p_spend_cap_usd is null and not p_accept_uncapped_spend then
    raise exception using
      errcode = '22023',
      message = 'set a spend cap, or explicitly accept running this goal uncapped';
  end if;

  update public.agentos_goals
     set status = 'active',
         dod_approved_by = caller_id,
         dod_approved_at = now(),
         spend_cap_usd = p_spend_cap_usd,
         uncapped_spend_acknowledged_by = case
           when p_spend_cap_usd is null then caller_id else null end,
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = p_goal_id
  returning * into updated;

  return updated;
end;
$function$;

revoke all on function public.agentos_approve_goal_dod(uuid, numeric, boolean)
  from public, anon, service_role;
grant execute on function public.agentos_approve_goal_dod(uuid, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The spawn decision
-- ---------------------------------------------------------------------------
--
-- One answer to "may this goal dispatch another specialist", with a named
-- blocker. Rails are evaluated before anything else so a goal that has already
-- overrun cannot be revived by a caller checking them in a friendlier order.

create or replace function public.agentos_goal_spawn_decision(p_goal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  goal_record public.agentos_goals;
  unresolved integer;
  repeated integer := 0;
  latest_fingerprint text;
  elapsed_minutes numeric;
  blockers text[] := '{}'::text[];
begin
  select * into goal_record from public.agentos_goals where id = p_goal_id;
  if not found then
    raise exception using errcode = '42501', message = 'the goal does not exist or is not visible';
  end if;
  if not public.is_organization_member(goal_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select count(*) into unresolved
    from public.agentos_goal_dod_items
   where goal_id = p_goal_id and not satisfied;

  -- Rails first, and each one reported even when several trip together: a
  -- caller fixing only the first would otherwise be surprised by the next.
  if goal_record.dod_approved_at is null then
    blockers := array_append(blockers, 'DOD_NOT_APPROVED');
  end if;

  if goal_record.status in ('completed','stopped_spend','stopped_time','stopped_stuck','stopped_by_human') then
    blockers := array_append(blockers, 'GOAL_' || upper(goal_record.status::text));
  elsif goal_record.status = 'paused' then
    blockers := array_append(blockers, 'GOAL_PAUSED');
  end if;

  if goal_record.spend_cap_usd is not null
     and goal_record.spent_usd >= goal_record.spend_cap_usd then
    blockers := array_append(blockers, 'SPEND_CAP_REACHED');
  end if;

  if goal_record.max_duration_minutes is not null and goal_record.started_at is not null then
    elapsed_minutes := extract(epoch from (now() - goal_record.started_at)) / 60;
    if elapsed_minutes >= goal_record.max_duration_minutes then
      blockers := array_append(blockers, 'MAX_DURATION_REACHED');
    end if;
  end if;

  -- Stuck: the same fingerprint repeated. The loop is running but the work
  -- is not moving, which is the expensive failure the rail exists for.
  select progress_fingerprint into latest_fingerprint
    from public.agentos_goal_progress
   where goal_id = p_goal_id
   order by iteration desc limit 1;

  if latest_fingerprint is not null then
    select count(*) into repeated
      from public.agentos_goal_progress
     where goal_id = p_goal_id and progress_fingerprint = latest_fingerprint;
    if repeated >= goal_record.stuck_threshold then
      blockers := array_append(blockers, 'STUCK_THRESHOLD_REACHED');
    end if;
  end if;

  if unresolved = 0 then
    blockers := array_append(blockers, 'DEFINITION_OF_DONE_SATISFIED');
  end if;

  -- Nothing dispatches work yet. Said plainly rather than implied by silence.
  blockers := array_append(blockers, 'GOAL_RUNNER_NOT_CONNECTED');

  return jsonb_build_object(
    'goalId', p_goal_id,
    'maySpawn', false,
    'blockers', to_jsonb(blockers),
    'unresolvedItems', unresolved,
    'repeatedFingerprintCount', repeated,
    'spentUsd', goal_record.spent_usd,
    'spendCapUsd', goal_record.spend_cap_usd
  );
end;
$function$;

comment on function public.agentos_goal_spawn_decision(uuid) is
  'Whether a goal may dispatch another specialist. Always reports every tripped rail, and always includes GOAL_RUNNER_NOT_CONNECTED because nothing dispatches work in this phase.';

revoke all on function public.agentos_goal_spawn_decision(uuid) from public, anon, service_role;
grant execute on function public.agentos_goal_spawn_decision(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording an iteration
-- ---------------------------------------------------------------------------
--
-- What the orchestrator does after every session: append progress, add the
-- cost, and stop the goal if a rail tripped. Stopping here rather than at the
-- next spawn means an overrun goal is already stopped when a human looks.

create or replace function public.agentos_record_goal_iteration(
  p_goal_id uuid,
  p_agent_name text,
  p_summary text,
  p_progress_fingerprint text,
  p_cost_usd numeric default 0
)
returns public.agentos_goals
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  goal_record public.agentos_goals;
  updated public.agentos_goals;
  next_iteration integer;
  repeated integer;
  elapsed_minutes numeric;
  new_status public.agentos_goal_status;
  reason text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into goal_record from public.agentos_goals where id = p_goal_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'the goal does not exist or is not visible';
  end if;
  if not public.is_organization_member(goal_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;
  if goal_record.status <> 'active' then
    raise exception using
      errcode = '22023',
      message = format('a goal in state %s does not accept iterations', goal_record.status);
  end if;

  select coalesce(max(iteration), 0) + 1 into next_iteration
    from public.agentos_goal_progress where goal_id = p_goal_id;

  insert into public.agentos_goal_progress
    (organization_id, goal_id, iteration, agent_name, summary, progress_fingerprint, cost_usd)
  values
    (goal_record.organization_id, p_goal_id, next_iteration, p_agent_name, p_summary,
     p_progress_fingerprint, coalesce(p_cost_usd, 0));

  update public.agentos_goals
     set spent_usd = spent_usd + coalesce(p_cost_usd, 0), updated_at = now()
   where id = p_goal_id
  returning * into updated;

  -- Evaluate the rails against the state this iteration just produced.
  select count(*) into repeated
    from public.agentos_goal_progress
   where goal_id = p_goal_id and progress_fingerprint = p_progress_fingerprint;

  if updated.spend_cap_usd is not null and updated.spent_usd >= updated.spend_cap_usd then
    new_status := 'stopped_spend';
    reason := format('spend %s reached the cap %s', updated.spent_usd, updated.spend_cap_usd);
  elsif repeated >= updated.stuck_threshold then
    new_status := 'stopped_stuck';
    reason := format('no progress across %s identical iterations', repeated);
  elsif updated.max_duration_minutes is not null and updated.started_at is not null then
    elapsed_minutes := extract(epoch from (now() - updated.started_at)) / 60;
    if elapsed_minutes >= updated.max_duration_minutes then
      new_status := 'stopped_time';
      reason := format('ran for %s minutes against a limit of %s',
                       round(elapsed_minutes), updated.max_duration_minutes);
    end if;
  end if;

  if new_status is null
     and not exists (select 1 from public.agentos_goal_dod_items
                      where goal_id = p_goal_id and not satisfied) then
    new_status := 'completed';
    reason := 'every definition-of-done item is satisfied';
  end if;

  if new_status is not null then
    update public.agentos_goals
       set status = new_status, stopped_at = now(), stopped_reason = reason, updated_at = now()
     where id = p_goal_id
    returning * into updated;
  end if;

  return updated;
end;
$function$;

revoke all on function public.agentos_record_goal_iteration(uuid, text, text, text, numeric)
  from public, anon, service_role;
grant execute on function public.agentos_record_goal_iteration(uuid, text, text, text, numeric)
  to authenticated;
