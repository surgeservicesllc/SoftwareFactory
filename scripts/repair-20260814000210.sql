-- Corrective repair for 20260814000210_phase2c_resource_persistence.
--
-- That migration applied partially against hosted: `resource_breakers` exists,
-- and re-running the original file therefore fails at its first statement with
-- `42P07: relation "resource_breakers" already exists`, before reaching the two
-- tables, the policies, the triggers or the grants that never ran.
--
-- This is the same migration made idempotent, so it can be run against ANY
-- partial state -- including the fully-applied one, where it is a no-op. It was
-- verified both ways against real PostgreSQL before being written here:
--
--   * against a database holding only `resource_breakers`, it completes the
--     migration;
--   * against a database where the whole migration already ran, it changes
--     nothing and raises nothing.
--
-- What changed from the original, and nothing else changed:
--
--   create table            -> create table if not exists
--   create index            -> create index if not exists
--   create policy           -> preceded by drop policy if exists
--   create trigger          -> preceded by drop trigger if exists
--
-- `create or replace function`, `alter table ... enable/force row level
-- security`, `revoke`, `grant` and `comment on` are already idempotent and are
-- untouched.
--
-- No RLS is disabled, no data is deleted, and no grant is widened. Dropping a
-- policy immediately before recreating it is the only way to make one
-- idempotent in PostgreSQL, and the recreate is in the same transaction.
--
-- RUN THIS INSIDE A TRANSACTION. The Supabase SQL editor does not wrap
-- statements for you, so a failure partway would leave exactly the kind of
-- half-applied state this file exists to repair.

begin;

-- Phase 2C: give the Resource Manager somewhere to remember.
--
-- Two of its parts were pure functions over inputs nobody stored, and that is a
-- defect rather than a design:
--
--   * A circuit breaker that lives in a request's memory reopens every request.
--     Three consecutive outages spread across three requests never reach the
--     threshold, so the breaker that exists to stop a bad provider absorbing
--     work could never actually fire in production.
--   * A routing decision that is computed and discarded cannot be learned from.
--     `lib/resources/history.ts` scores regret against a prediction; with no
--     stored prediction there is nothing to compare an outcome to.
--
-- Two tables with different natures, deliberately not merged. Breaker state is
-- *state* and must be updatable. An assignment is *evidence* and must not be.
--
-- Neither table grants `service_role` anything, and no browser writes: every
-- write goes through a SECURITY DEFINER function below.

-- ---------------------------------------------------------------------------
-- Circuit breaker state
-- ---------------------------------------------------------------------------

create table if not exists public.resource_breakers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- A provider ("openai") or a provider/model pair ("openai/gpt-5.3-codex").
  -- Free-form on purpose: the catalogue is code, and pinning an enum here would
  -- mean a migration every time a model is added.
  target text not null check (
    length(btrim(target)) between 1 and 200
    and target = btrim(target)
    and not public.text_has_likely_secret(target)
  ),

  state text not null default 'closed' check (state in ('closed', 'open', 'half_open')),
  fault text check (fault is null or fault in (
    'outage', 'rate_limit', 'malformed_output', 'validation_failure', 'excessive_latency'
  )),
  consecutive_faults integer not null default 0 check (consecutive_faults >= 0),
  opened_at timestamptz,

  -- A named, generated sentence — never a provider message, which could carry
  -- anything a provider felt like returning.
  reason text check (reason is null or length(reason) <= 400),

  updated_at timestamptz not null default now(),

  constraint resource_breakers_target_unique unique (organization_id, target),

  -- An open breaker must say what opened it and when, or it cannot be evaluated:
  -- `evaluateBreaker` needs both to compute the cooldown, and treats a record
  -- missing either as closed. Storing such a row would silently disarm it.
  constraint resource_breakers_open_is_explained check (
    state <> 'open' or (fault is not null and opened_at is not null)
  ),

  -- A closed breaker is closed, not "open but forgotten". Note what this does
  -- *not* say: a closed breaker may hold a non-zero fault count, because that
  -- is precisely a breaker accumulating toward its threshold. An earlier
  -- version of this constraint required a zero count and thereby reset the
  -- counter on every write, so the breaker could never open — the defect this
  -- whole table exists to fix, reintroduced one line lower down.
  constraint resource_breakers_closed_is_clean check (
    state <> 'closed' or (opened_at is null and reason is null)
  )
);

comment on table public.resource_breakers is
  'Current circuit-breaker state per provider or provider/model target. Mutable by design: this is state, not evidence. Transitions are recorded immutably in resource_breaker_events.';
comment on column public.resource_breakers.reason is
  'A generated sentence naming the fault and count. Never a provider message.';

create index if not exists resource_breakers_open
  on public.resource_breakers (organization_id, state)
  where state <> 'closed';

alter table public.resource_breakers enable row level security;
alter table public.resource_breakers force row level security;

drop policy if exists resource_breakers_select_members on public.resource_breakers;
create policy resource_breakers_select_members
  on public.resource_breakers for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.resource_breakers from anon, authenticated;
grant select on table public.resource_breakers to authenticated;

-- ---------------------------------------------------------------------------
-- Breaker transitions, append-only
-- ---------------------------------------------------------------------------

create table if not exists public.resource_breaker_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  breaker_id uuid not null references public.resource_breakers(id) on delete cascade,

  target text not null,
  from_state text not null check (from_state in ('closed', 'open', 'half_open')),
  to_state text not null check (to_state in ('closed', 'open', 'half_open')),
  fault text check (fault is null or fault in (
    'outage', 'rate_limit', 'malformed_output', 'validation_failure', 'excessive_latency'
  )),
  consecutive_faults integer not null default 0 check (consecutive_faults >= 0),
  reason text check (reason is null or length(reason) <= 400),
  occurred_at timestamptz not null default now(),

  -- A transition that changes nothing is not a transition. Recording every
  -- fault below the threshold would bury the openings that matter.
  constraint resource_breaker_events_is_a_transition check (from_state <> to_state)
);

comment on table public.resource_breaker_events is
  'Append-only record of every circuit-breaker state change. A fault below its threshold changes no state and is deliberately not recorded here.';

create index if not exists resource_breaker_events_recent
  on public.resource_breaker_events (organization_id, occurred_at desc);

alter table public.resource_breaker_events enable row level security;
alter table public.resource_breaker_events force row level security;

drop policy if exists resource_breaker_events_select_members on public.resource_breaker_events;
create policy resource_breaker_events_select_members
  on public.resource_breaker_events for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.resource_breaker_events from anon, authenticated;
grant select on table public.resource_breaker_events to authenticated;

create or replace function public.reject_resource_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'resource evidence records are append-only';
end;
$function$;

revoke all on function public.reject_resource_evidence_mutation() from public, anon, authenticated;

drop trigger if exists resource_breaker_events_append_only on public.resource_breaker_events;
create trigger resource_breaker_events_append_only
  before update or delete on public.resource_breaker_events
  for each row execute function public.reject_resource_evidence_mutation();

-- ---------------------------------------------------------------------------
-- Routing decisions
-- ---------------------------------------------------------------------------
--
-- Distinct from Phase 2A's `provider_routing_decisions`, which is immutable
-- evidence of a *provider* choice and must not be repurposed. This records the
-- Phase 2C manager's richer decision: which agent, which model, under which
-- objective and mode, and why — including the case where the answer was that no
-- model was needed at all.

create table if not exists public.resource_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  -- The unit of work routed. Phase 2B's graph does not exist, so today this is
  -- a Phase 1C task id; the column is deliberately not a foreign key so a graph
  -- node can use it later without a migration.
  node_id uuid not null,

  decision text not null check (decision in (
    'DETERMINISTIC_NO_MODEL_REQUIRED', 'ASSIGNED', 'NO_ELIGIBLE_WORKER', 'REQUESTED_WORKER_INELIGIBLE'
  )),
  objective text not null check (objective in ('QUALITY', 'SPEED', 'COST', 'BALANCED')),
  mode text not null check (mode in ('AUTO', 'CLAUDE', 'CODEX', 'SPECIFIC_AGENT', 'SPECIFIC_MODEL')),

  agent_id text check (agent_id is null or (
    length(btrim(agent_id)) between 1 and 200 and not public.text_has_likely_secret(agent_id)
  )),
  provider text check (provider is null or (
    length(btrim(provider)) between 1 and 100 and not public.text_has_likely_secret(provider)
  )),
  model text check (model is null or (
    length(btrim(model)) between 1 and 128 and not public.text_has_likely_secret(model)
  )),

  reason text not null check (length(reason) between 1 and 500),
  policy_version text not null check (length(policy_version) between 1 and 100),

  -- Bounded, structured candidate evidence: agent, provider, model, eligibility,
  -- score, named rejections and notes. Not prose, and not a model's reasoning.
  candidates jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) <= 20),

  -- What was predicted, so an outcome can later be compared against it rather
  -- than against a guess reconstructed after the fact.
  predicted_success_rate numeric(5, 4)
    check (predicted_success_rate is null or predicted_success_rate between 0 and 1),
  prediction_evidenced boolean not null default false,

  decided_at timestamptz not null default now(),

  constraint resource_assignments_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,

  -- An assignment names a worker; every other outcome must not, or the record
  -- would imply work was routed somewhere it was not.
  constraint resource_assignments_worker_matches_decision check (
    (decision = 'ASSIGNED' and agent_id is not null and provider is not null and model is not null)
    or (decision <> 'ASSIGNED' and agent_id is null and provider is null and model is null)
  ),

  -- An unevidenced prediction must carry no number. `history.ts` returns null
  -- below its minimum sample count precisely so nothing invents one; persisting
  -- a rate here without evidence would undo that.
  constraint resource_assignments_prediction_is_evidenced check (
    prediction_evidenced or predicted_success_rate is null
  )
);

comment on table public.resource_assignments is
  'Immutable record of one Resource Manager routing decision: the worker chosen, the objective and mode, the named reason, and bounded candidate evidence. An unevidenced prediction stores no success rate.';
comment on column public.resource_assignments.node_id is
  'The routed unit of work. A Phase 1C task today; intentionally not a foreign key so a Phase 2B graph node can reuse it without a migration.';
comment on column public.resource_assignments.candidates is
  'Bounded structured evidence per candidate. Never provider output or intermediate reasoning.';

create index if not exists resource_assignments_project_recent
  on public.resource_assignments (project_id, decided_at desc);
create index if not exists resource_assignments_node
  on public.resource_assignments (node_id, decided_at desc);

alter table public.resource_assignments enable row level security;
alter table public.resource_assignments force row level security;

drop policy if exists resource_assignments_select_members on public.resource_assignments;
create policy resource_assignments_select_members
  on public.resource_assignments for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.resource_assignments from anon, authenticated;
grant select on table public.resource_assignments to authenticated;

drop trigger if exists resource_assignments_append_only on public.resource_assignments;
create trigger resource_assignments_append_only
  before update or delete on public.resource_assignments
  for each row execute function public.reject_resource_evidence_mutation();

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------

create or replace function public.record_resource_assignment(
  p_project_id uuid,
  p_node_id uuid,
  p_decision text,
  p_objective text,
  p_mode text,
  p_reason text,
  p_policy_version text,
  p_agent_id text default null,
  p_provider text default null,
  p_model text default null,
  p_candidates jsonb default '[]'::jsonb,
  p_predicted_success_rate numeric default null,
  p_prediction_evidenced boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  assignment_id uuid;
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

  insert into public.resource_assignments (
    organization_id, project_id, node_id, decision, objective, mode,
    agent_id, provider, model, reason, policy_version, candidates,
    predicted_success_rate, prediction_evidenced
  ) values (
    project_record.organization_id, p_project_id, p_node_id, p_decision, p_objective, p_mode,
    p_agent_id, p_provider, p_model, p_reason, p_policy_version,
    coalesce(p_candidates, '[]'::jsonb),
    p_predicted_success_rate, coalesce(p_prediction_evidenced, false)
  )
  returning id into assignment_id;

  return assignment_id;
end;
$function$;

comment on function public.record_resource_assignment is
  'Append one immutable Resource Manager decision. Refuses a named worker on a non-assignment, and refuses a success rate on an unevidenced prediction.';

revoke all on function public.record_resource_assignment(
  uuid, uuid, text, text, text, text, text, text, text, text, jsonb, numeric, boolean
) from public, anon, service_role;
grant execute on function public.record_resource_assignment(
  uuid, uuid, text, text, text, text, text, text, text, text, jsonb, numeric, boolean
) to authenticated;

-- Fold one observed fault into a durable breaker.
--
-- The threshold and cooldown tables live in `lib/resources/breakers.ts` and are
-- passed in rather than duplicated here, so the two cannot disagree about when
-- a breaker opens. What this function owns is the part TypeScript cannot do
-- safely across concurrent requests: read-modify-write under a row lock.
create or replace function public.record_resource_breaker_fault(
  p_organization_id uuid,
  p_target text,
  p_fault text,
  p_threshold integer
)
returns table (
  breaker_id uuid,
  state text,
  consecutive_faults integer,
  opened boolean,
  reason text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  breaker_record public.resource_breakers%rowtype;
  previous_state text;
  next_consecutive integer;
  next_state text;
  next_reason text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  if p_threshold is null or p_threshold < 1 then
    raise exception using errcode = '22023', message = 'a fault threshold of at least one is required';
  end if;

  -- Insert-or-lock. Two simultaneous first faults for one target must not both
  -- create a row, and must not both read a count of zero.
  insert into public.resource_breakers (organization_id, target)
  values (p_organization_id, btrim(p_target))
  on conflict (organization_id, target) do nothing;

  select * into breaker_record
  from public.resource_breakers
  where organization_id = p_organization_id and target = btrim(p_target)
  for update;

  previous_state := breaker_record.state;

  -- A different fault class restarts counting: three unrelated symptoms are not
  -- evidence of one problem. This mirrors `recordFault` exactly.
  if breaker_record.fault is not distinct from p_fault then
    next_consecutive := breaker_record.consecutive_faults + 1;
  else
    next_consecutive := 1;
  end if;

  if next_consecutive >= p_threshold then
    next_state := 'open';
    next_reason := next_consecutive || ' consecutive '
      || pg_catalog.replace(p_fault, '_', ' ') || ' failures.';
  else
    next_state := case when breaker_record.state = 'open' then 'open' else 'closed' end;
    next_reason := breaker_record.reason;
  end if;

  update public.resource_breakers
  set state = next_state,
    fault = p_fault,
    consecutive_faults = next_consecutive,
    opened_at = case
      when next_state = 'open' and previous_state <> 'open' then now()
      when next_state = 'closed' then null
      else breaker_record.opened_at
    end,
    reason = case when next_state = 'closed' then null else next_reason end,
    updated_at = now()
  where id = breaker_record.id
  returning * into breaker_record;

  if previous_state <> breaker_record.state then
    insert into public.resource_breaker_events (
      organization_id, breaker_id, target, from_state, to_state,
      fault, consecutive_faults, reason
    ) values (
      p_organization_id, breaker_record.id, breaker_record.target,
      previous_state, breaker_record.state,
      breaker_record.fault, breaker_record.consecutive_faults, breaker_record.reason
    );
  end if;

  return query select breaker_record.id, breaker_record.state,
    breaker_record.consecutive_faults,
    (previous_state <> 'open' and breaker_record.state = 'open'),
    breaker_record.reason;
end;
$function$;

comment on function public.record_resource_breaker_fault is
  'Fold one observed fault into a durable circuit breaker under a row lock. The threshold is supplied by lib/resources/breakers.ts so the rule has one home. Records a transition event only when the state actually changes.';

revoke all on function public.record_resource_breaker_fault(uuid, text, text, integer)
  from public, anon, service_role;
grant execute on function public.record_resource_breaker_fault(uuid, text, text, integer)
  to authenticated;

-- A success closes the breaker outright — recovery needs no ceremony.
create or replace function public.record_resource_breaker_success(
  p_organization_id uuid,
  p_target text
)
returns table (
  breaker_id uuid,
  state text,
  closed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  breaker_record public.resource_breakers%rowtype;
  previous_state text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'caller is not a member of this organization';
  end if;

  select * into breaker_record
  from public.resource_breakers
  where organization_id = p_organization_id and target = btrim(p_target)
  for update;

  -- Nothing has ever failed for this target, so there is nothing to close and
  -- no row worth creating.
  if not found then
    return query select null::uuid, 'closed'::text, false;
    return;
  end if;

  previous_state := breaker_record.state;

  update public.resource_breakers
  set state = 'closed', fault = null, consecutive_faults = 0,
    opened_at = null, reason = null, updated_at = now()
  where id = breaker_record.id
  returning * into breaker_record;

  if previous_state <> 'closed' then
    insert into public.resource_breaker_events (
      organization_id, breaker_id, target, from_state, to_state,
      fault, consecutive_faults, reason
    ) values (
      p_organization_id, breaker_record.id, breaker_record.target,
      previous_state, 'closed', null, 0, null
    );
  end if;

  return query select breaker_record.id, breaker_record.state, (previous_state <> 'closed');
end;
$function$;

comment on function public.record_resource_breaker_success is
  'Close a circuit breaker after an observed success. A target that never failed has no row and none is created.';

revoke all on function public.record_resource_breaker_success(uuid, text)
  from public, anon, service_role;
grant execute on function public.record_resource_breaker_success(uuid, text)
  to authenticated;

commit;

-- Verify. All three must return 1, and the rls column must read `rls+force`.

select c.relname,
       case when c.relrowsecurity and c.relforcerowsecurity then 'rls+force' else 'INCOMPLETE' end as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
   and c.relname in ('resource_breakers', 'resource_breaker_events', 'resource_assignments')
 order by c.relname;
