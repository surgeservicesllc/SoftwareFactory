-- Phase 1D: complete the autonomy control model.
--
-- Migration 010 shipped four of the nine automatic actions the control model
-- needs, at one scope, and locked them all off. This migration adds the missing
-- five actions, adds the organization scope the "most restrictive wins" rule
-- needs to resolve against, and extends every existing interlock to cover the
-- new columns.
--
-- It deliberately relaxes nothing. Every flag it introduces is created `false`,
-- constrained `false`, and refused by the same trigger that already refuses the
-- original four. Turning any of them on is a RED action under
-- policies/RISK_CLASSIFICATION.md and requires a separate, owner-approved
-- migration. The control model becomes complete and correct; it does not become
-- more permissive.

-- ---------------------------------------------------------------------------
-- 1. Project scope: the five missing automatic actions
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists auto_plan boolean not null default false,
  add column if not exists auto_code boolean not null default false,
  add column if not exists auto_test boolean not null default false,
  add column if not exists auto_repair boolean not null default false,
  add column if not exists auto_review boolean not null default false;

comment on column public.projects.auto_plan is
  'Phase 1D control, constrained OFF. Whether the loop may plan work without a human starting it.';
comment on column public.projects.auto_code is
  'Phase 1D control, constrained OFF. Whether the loop may write the change itself. Requires a Phase 1C worker, which is Not Connected.';
comment on column public.projects.auto_test is
  'Phase 1D control, constrained OFF. Whether the loop may run its own verification.';
comment on column public.projects.auto_repair is
  'Phase 1D control, constrained OFF. Whether a failure may open bounded repair work automatically.';
comment on column public.projects.auto_review is
  'Phase 1D control, constrained OFF. Whether the reviewing agents may run without a human requesting them.';

-- ---------------------------------------------------------------------------
-- 2. Organization scope: the ceiling a project may only narrow
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists autonomous_mode boolean not null default false,
  add column if not exists maximum_autonomous_risk public.risk_level not null default 'green',
  add column if not exists auto_plan boolean not null default false,
  add column if not exists auto_code boolean not null default false,
  add column if not exists auto_test boolean not null default false,
  add column if not exists auto_repair boolean not null default false,
  add column if not exists auto_review boolean not null default false,
  add column if not exists auto_approve boolean not null default false,
  add column if not exists auto_merge boolean not null default false,
  add column if not exists auto_deploy boolean not null default false,
  add column if not exists auto_rollback boolean not null default false;

comment on column public.organizations.maximum_autonomous_risk is
  'Organization risk ceiling. A project may narrow this and can never widen it; resolution takes the lower of the two.';

-- ---------------------------------------------------------------------------
-- 3. Extend the interlocks to the new columns
--
-- The existing constraint is dropped and recreated strictly stronger: it keeps
-- every clause it had and adds one per new column. `not valid` then `validate`
-- makes an unexpected pre-existing row fail loudly rather than being silently
-- rewritten.
-- ---------------------------------------------------------------------------

alter table public.projects
  drop constraint if exists projects_phase1d_green_observation_only;

alter table public.projects
  add constraint projects_phase1d_green_observation_only
  check (
    not autonomous_mode
    and maximum_autonomous_risk = 'green'::public.risk_level
    and not auto_plan
    and not auto_code
    and not auto_test
    and not auto_repair
    and not auto_review
    and not auto_approve
    and not auto_merge
    and not auto_deploy
    and not auto_rollback
  ) not valid;

alter table public.projects
  validate constraint projects_phase1d_green_observation_only;

comment on constraint projects_phase1d_green_observation_only on public.projects is
  'Phase 1D keeps Autonomous Mode OFF, retains a GREEN ceiling, and disables all nine automatic actions.';

alter table public.organizations
  add constraint organizations_phase1d_green_observation_only
  check (
    not autonomous_mode
    and maximum_autonomous_risk = 'green'::public.risk_level
    and not auto_plan
    and not auto_code
    and not auto_test
    and not auto_repair
    and not auto_review
    and not auto_approve
    and not auto_merge
    and not auto_deploy
    and not auto_rollback
  ) not valid;

alter table public.organizations
  validate constraint organizations_phase1d_green_observation_only;

comment on constraint organizations_phase1d_green_observation_only on public.organizations is
  'The organization ceiling is held at the same fail-closed position as every project. Relaxing it is a RED action requiring owner approval.';

-- ---------------------------------------------------------------------------
-- 4. The project trigger has to refuse the new columns too
--
-- Without this the CHECK would still hold, but the error would be a bare
-- constraint violation rather than the explaining message, and an owner-only
-- edit to a new column would not be attributed.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_safe_project_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.autonomous_mode
    or new.maximum_autonomous_risk <> 'green'::public.risk_level
    or new.auto_plan
    or new.auto_code
    or new.auto_test
    or new.auto_repair
    or new.auto_review
    or new.auto_approve
    or new.auto_merge
    or new.auto_deploy
    or new.auto_rollback then
    raise exception using
      errcode = '23514',
      message = 'Phase 1D is scaffold-only: autonomous mode and all nine automatic actions must remain disabled with a GREEN ceiling';
  end if;

  if tg_op = 'INSERT' then return new; end if;

  if row(
    new.autonomous_mode,
    new.maximum_autonomous_risk,
    new.auto_plan,
    new.auto_code,
    new.auto_test,
    new.auto_repair,
    new.auto_review,
    new.auto_approve,
    new.auto_merge,
    new.auto_deploy,
    new.auto_rollback
  ) is distinct from row(
    old.autonomous_mode,
    old.maximum_autonomous_risk,
    old.auto_plan,
    old.auto_code,
    old.auto_test,
    old.auto_repair,
    old.auto_review,
    old.auto_approve,
    old.auto_merge,
    old.auto_deploy,
    old.auto_rollback
  ) and not public.is_organization_owner(old.organization_id) then
    raise exception using
      errcode = '42501',
      message = 'only an organization owner may change autonomy controls';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_safe_project_controls() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The same refusal at the organization scope
-- ---------------------------------------------------------------------------

create or replace function public.enforce_safe_organization_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.autonomous_mode
    or new.maximum_autonomous_risk <> 'green'::public.risk_level
    or new.auto_plan
    or new.auto_code
    or new.auto_test
    or new.auto_repair
    or new.auto_review
    or new.auto_approve
    or new.auto_merge
    or new.auto_deploy
    or new.auto_rollback then
    raise exception using
      errcode = '23514',
      message = 'Phase 1D is scaffold-only: organization autonomy controls must remain disabled with a GREEN ceiling';
  end if;

  -- The kill switch may never be turned off by an ordinary update. Migration
  -- 010 already constrains it ON; this makes the refusal explain itself.
  if tg_op = 'UPDATE' and old.autonomy_kill_switch_active and not new.autonomy_kill_switch_active then
    raise exception using
      errcode = '42501',
      message = 'the global kill switch cannot be released without an owner-approved migration';
  end if;

  if tg_op = 'INSERT' then return new; end if;

  if row(
    new.autonomous_mode,
    new.maximum_autonomous_risk,
    new.auto_plan, new.auto_code, new.auto_test, new.auto_repair, new.auto_review,
    new.auto_approve, new.auto_merge, new.auto_deploy, new.auto_rollback
  ) is distinct from row(
    old.autonomous_mode,
    old.maximum_autonomous_risk,
    old.auto_plan, old.auto_code, old.auto_test, old.auto_repair, old.auto_review,
    old.auto_approve, old.auto_merge, old.auto_deploy, old.auto_rollback
  ) and not public.is_organization_owner(old.id) then
    raise exception using
      errcode = '42501',
      message = 'only an organization owner may change autonomy controls';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_safe_organization_controls() from public, anon, authenticated;

drop trigger if exists organizations_enforce_safe_controls on public.organizations;
create trigger organizations_enforce_safe_controls
  before insert or update on public.organizations
  for each row execute function public.enforce_safe_organization_controls();

-- ---------------------------------------------------------------------------
-- 6. Read the resolved control state
--
-- Resolution belongs in one place. Putting it here means the API, the UI, and
-- any future worker all read the same answer, and none of them can accidentally
-- resolve it more permissively than the database does.
-- ---------------------------------------------------------------------------

create or replace function public.resolved_autonomy_controls(p_project_id uuid)
returns table (
  organization_id uuid,
  project_id uuid,
  autonomous_mode boolean,
  maximum_autonomous_risk public.risk_level,
  risk_ceiling_source text,
  auto_plan boolean,
  auto_code boolean,
  auto_test boolean,
  auto_repair boolean,
  auto_review boolean,
  auto_approve boolean,
  auto_merge boolean,
  auto_deploy boolean,
  auto_rollback boolean,
  kill_switch_active boolean,
  release_frozen boolean,
  executor_connected boolean
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  with scoped as (
    select
      o.id as organization_id,
      p.id as project_id,
      o.autonomous_mode and p.autonomous_mode as autonomous_mode,
      least(o.maximum_autonomous_risk, p.maximum_autonomous_risk) as ceiling,
      o.maximum_autonomous_risk <= p.maximum_autonomous_risk as organization_is_lower,
      o.autonomy_kill_switch_active as kill_switch_active,
      exists (
        select 1 from public.release_freezes f
        where f.project_id = p.id and f.released_at is null
      ) as release_frozen,
      o.auto_plan and p.auto_plan as auto_plan,
      o.auto_code and p.auto_code as auto_code,
      o.auto_test and p.auto_test as auto_test,
      o.auto_repair and p.auto_repair as auto_repair,
      o.auto_review and p.auto_review as auto_review,
      o.auto_approve and p.auto_approve as auto_approve,
      o.auto_merge and p.auto_merge as auto_merge,
      o.auto_deploy and p.auto_deploy as auto_deploy,
      o.auto_rollback and p.auto_rollback as auto_rollback
    from public.projects p
    join public.organizations o on o.id = p.organization_id
    where p.id = p_project_id
  )
  select
    organization_id,
    project_id,
    autonomous_mode,
    ceiling,
    case when organization_is_lower then 'organization' else 'project' end,
    -- No executor exists in this phase, so every action resolves off no matter
    -- what the two scopes hold. This mirrors the envelope in lib/autonomy.
    false, false, false, false, false, false, false, false, false,
    kill_switch_active,
    release_frozen,
    false
  from scoped;
$function$;

comment on function public.resolved_autonomy_controls(uuid) is
  'Most-restrictive-wins resolution of organization and project controls. Every automatic action resolves OFF while no executor is connected.';

revoke all on function public.resolved_autonomy_controls(uuid) from public, anon;
grant execute on function public.resolved_autonomy_controls(uuid) to authenticated;
