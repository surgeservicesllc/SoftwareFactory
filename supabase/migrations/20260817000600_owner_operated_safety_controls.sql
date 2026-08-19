-- The owner operates the safety controls (ADR-080; explicit owner order,
-- 2026-08-17: "make every single button on the Safety page editable and
-- wired, and the action actually does something").
--
-- Phase 1D locked the kill switch ON with a CHECK constraint and froze both
-- scopes at disabled/GREEN, with the stated exit "a separately approved
-- future migration". This is that migration, under the owner's written
-- instruction, and it moves editability — not enforcement — into the owner's
-- hands:
--
--   * every transition is organization-OWNER-only (admins cannot touch these);
--   * releasing the kill switch or enabling any action requires a reason and
--     records an immutable activity event;
--   * the autonomous risk ceiling may never reach RED — "RED always needs
--     you" is the product promise and stays a database refusal;
--   * resolution is unchanged: a flag ON grants nothing that the envelope
--     (emergency stop, release freeze, executor binding) or a missing
--     capability (no merge endpoint, no deployment adapter) still refuses.

-- ---------------------------------------------------------------------------
-- 1. The hard scaffold constraints give way to owner-gated triggers
-- ---------------------------------------------------------------------------

alter table public.organizations
  drop constraint if exists organizations_phase1d_kill_switch_active;
alter table public.organizations
  drop constraint if exists organizations_phase1d_green_observation_only;
alter table public.projects
  drop constraint if exists projects_phase1d_green_observation_only;

-- The ceiling may be GREEN or YELLOW, never RED, at either scope.
alter table public.organizations
  drop constraint if exists organizations_autonomy_ceiling_below_red;
alter table public.organizations
  add constraint organizations_autonomy_ceiling_below_red
  check (maximum_autonomous_risk <> 'red'::public.risk_level);
alter table public.projects
  drop constraint if exists projects_autonomy_ceiling_below_red;
alter table public.projects
  add constraint projects_autonomy_ceiling_below_red
  check (maximum_autonomous_risk <> 'red'::public.risk_level);

comment on column public.organizations.autonomy_kill_switch_active is
  'The global interlock. Owner-operable since 20260817000600 (ADR-080): released or engaged only by the organization owner, with a recorded reason; while active, every automatic action resolves to off.';

-- ---------------------------------------------------------------------------
-- 2. Triggers: attribution and the RED refusal, not a frozen scaffold
-- ---------------------------------------------------------------------------

create or replace function public.enforce_safe_organization_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.maximum_autonomous_risk = 'red'::public.risk_level then
    raise exception using errcode = '23514',
      message = 'the autonomous risk ceiling can never be RED: RED work always needs the owner';
  end if;

  -- Born fail-closed, always: authority is enabled after creation, by the
  -- owner, as an attributed and audit-evented update — never at birth.
  if tg_op = 'INSERT' then
    if new.autonomous_mode
      or new.maximum_autonomous_risk <> 'green'::public.risk_level
      or new.auto_plan or new.auto_code or new.auto_test or new.auto_repair
      or new.auto_review or new.auto_approve or new.auto_merge
      or new.auto_deploy or new.auto_rollback then
      raise exception using errcode = '23514',
        message = 'organizations are born fail-closed: enable controls after creation, as the owner';
    end if;
    return new;
  end if;

  if (old.autonomy_kill_switch_active is distinct from new.autonomy_kill_switch_active
    or row(
      new.autonomous_mode, new.maximum_autonomous_risk,
      new.auto_plan, new.auto_code, new.auto_test, new.auto_repair, new.auto_review,
      new.auto_approve, new.auto_merge, new.auto_deploy, new.auto_rollback
    ) is distinct from row(
      old.autonomous_mode, old.maximum_autonomous_risk,
      old.auto_plan, old.auto_code, old.auto_test, old.auto_repair, old.auto_review,
      old.auto_approve, old.auto_merge, old.auto_deploy, old.auto_rollback
    ))
    and not public.is_organization_owner(old.id) then
    raise exception using errcode = '42501',
      message = 'only the organization owner may change the kill switch or autonomy controls';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_safe_organization_controls() from public, anon, authenticated;

create or replace function public.enforce_safe_project_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.maximum_autonomous_risk = 'red'::public.risk_level then
    raise exception using errcode = '23514',
      message = 'the autonomous risk ceiling can never be RED: RED work always needs the owner';
  end if;

  if tg_op = 'INSERT' then
    if new.autonomous_mode
      or new.maximum_autonomous_risk <> 'green'::public.risk_level
      or new.auto_plan or new.auto_code or new.auto_test or new.auto_repair
      or new.auto_review or new.auto_approve or new.auto_merge
      or new.auto_deploy or new.auto_rollback then
      raise exception using errcode = '23514',
        message = 'projects are born fail-closed: enable controls after creation, as the owner';
    end if;
    return new;
  end if;

  if row(
    new.autonomous_mode, new.maximum_autonomous_risk,
    new.auto_plan, new.auto_code, new.auto_test, new.auto_repair, new.auto_review,
    new.auto_approve, new.auto_merge, new.auto_deploy, new.auto_rollback
  ) is distinct from row(
    old.autonomous_mode, old.maximum_autonomous_risk,
    old.auto_plan, old.auto_code, old.auto_test, old.auto_repair, old.auto_review,
    old.auto_approve, old.auto_merge, old.auto_deploy, old.auto_rollback
  ) and not public.is_organization_owner(old.organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may change autonomy controls';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_safe_project_controls() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The owner-facing operations, each one audit-evented
-- ---------------------------------------------------------------------------

alter type public.activity_event_type add value if not exists 'autonomy.kill_switch_changed';
alter type public.activity_event_type add value if not exists 'autonomy.controls_changed';

create or replace function public.set_autonomy_kill_switch(
  p_organization_id uuid,
  p_active boolean,
  p_reason text default null
)
returns table (organization_id uuid, kill_switch_active boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  organization_record public.organizations%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only the organization owner may operate the kill switch';
  end if;
  -- Releasing the interlock is the consequential direction; it must say why.
  if p_active = false and trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'a reason is required to release the kill switch';
  end if;

  select organization.* into organization_record
  from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  if organization_record.autonomy_kill_switch_active is distinct from p_active then
    update public.organizations organization
    set autonomy_kill_switch_active = p_active, updated_at = now()
    where organization.id = p_organization_id
    returning organization.* into organization_record;

    perform public.record_activity_event(
      p_organization_id, null,
      'autonomy.kill_switch_changed'::public.activity_event_type,
      'organization', p_organization_id,
      case when p_active then 'Global kill switch engaged' else 'Global kill switch released by the owner' end,
      jsonb_build_object('active', p_active, 'reason', coalesce(trimmed_reason, ''))
    );
  end if;

  return query select organization_record.id, organization_record.autonomy_kill_switch_active;
end;
$function$;

revoke all on function public.set_autonomy_kill_switch(uuid, boolean, text) from public, anon;
grant execute on function public.set_autonomy_kill_switch(uuid, boolean, text) to authenticated;

create or replace function public.set_organization_autonomy_controls(
  p_organization_id uuid,
  p_autonomous_mode boolean default null,
  p_maximum_autonomous_risk public.risk_level default null,
  p_auto_plan boolean default null,
  p_auto_code boolean default null,
  p_auto_test boolean default null,
  p_auto_repair boolean default null,
  p_auto_review boolean default null,
  p_auto_approve boolean default null,
  p_auto_merge boolean default null,
  p_auto_deploy boolean default null,
  p_auto_rollback boolean default null,
  p_reason text default null
)
returns table (
  organization_id uuid,
  autonomous_mode boolean,
  maximum_autonomous_risk public.risk_level,
  auto_plan boolean, auto_code boolean, auto_test boolean, auto_repair boolean,
  auto_review boolean, auto_approve boolean, auto_merge boolean,
  auto_deploy boolean, auto_rollback boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  organization_record public.organizations%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only the organization owner may change autonomy controls';
  end if;
  if p_maximum_autonomous_risk = 'red'::public.risk_level then
    raise exception using errcode = '23514',
      message = 'the autonomous risk ceiling can never be RED: RED work always needs the owner';
  end if;

  select organization.* into organization_record
  from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  update public.organizations organization
  set autonomous_mode = coalesce(p_autonomous_mode, organization.autonomous_mode),
      maximum_autonomous_risk = coalesce(p_maximum_autonomous_risk, organization.maximum_autonomous_risk),
      auto_plan = coalesce(p_auto_plan, organization.auto_plan),
      auto_code = coalesce(p_auto_code, organization.auto_code),
      auto_test = coalesce(p_auto_test, organization.auto_test),
      auto_repair = coalesce(p_auto_repair, organization.auto_repair),
      auto_review = coalesce(p_auto_review, organization.auto_review),
      auto_approve = coalesce(p_auto_approve, organization.auto_approve),
      auto_merge = coalesce(p_auto_merge, organization.auto_merge),
      auto_deploy = coalesce(p_auto_deploy, organization.auto_deploy),
      auto_rollback = coalesce(p_auto_rollback, organization.auto_rollback),
      updated_at = now()
  where organization.id = p_organization_id
  returning organization.* into organization_record;

  perform public.record_activity_event(
    p_organization_id, null,
    'autonomy.controls_changed'::public.activity_event_type,
    'organization', p_organization_id,
    'Organization autonomy controls changed by the owner',
    jsonb_build_object(
      'reason', coalesce(trimmed_reason, ''),
      'autonomousMode', organization_record.autonomous_mode,
      'maximumAutonomousRisk', organization_record.maximum_autonomous_risk::text,
      'autoPlan', organization_record.auto_plan,
      'autoCode', organization_record.auto_code,
      'autoTest', organization_record.auto_test,
      'autoRepair', organization_record.auto_repair,
      'autoReview', organization_record.auto_review,
      'autoApprove', organization_record.auto_approve,
      'autoMerge', organization_record.auto_merge,
      'autoDeploy', organization_record.auto_deploy,
      'autoRollback', organization_record.auto_rollback
    )
  );

  return query select organization_record.id,
    organization_record.autonomous_mode, organization_record.maximum_autonomous_risk,
    organization_record.auto_plan, organization_record.auto_code, organization_record.auto_test,
    organization_record.auto_repair, organization_record.auto_review, organization_record.auto_approve,
    organization_record.auto_merge, organization_record.auto_deploy, organization_record.auto_rollback;
end;
$function$;

revoke all on function public.set_organization_autonomy_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.set_organization_autonomy_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Read the organization's control row
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_autonomy_controls(
  p_organization_id uuid
)
returns table (
  organization_id uuid,
  kill_switch_active boolean,
  autonomous_mode boolean,
  maximum_autonomous_risk public.risk_level,
  auto_plan boolean, auto_code boolean, auto_test boolean, auto_repair boolean,
  auto_review boolean, auto_approve boolean, auto_merge boolean,
  auto_deploy boolean, auto_rollback boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select organization.id, organization.autonomy_kill_switch_active,
    organization.autonomous_mode, organization.maximum_autonomous_risk,
    organization.auto_plan, organization.auto_code, organization.auto_test,
    organization.auto_repair, organization.auto_review, organization.auto_approve,
    organization.auto_merge, organization.auto_deploy, organization.auto_rollback
  from public.organizations organization
  where organization.id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

revoke all on function public.get_organization_autonomy_controls(uuid) from public, anon;
grant execute on function public.get_organization_autonomy_controls(uuid) to authenticated;
