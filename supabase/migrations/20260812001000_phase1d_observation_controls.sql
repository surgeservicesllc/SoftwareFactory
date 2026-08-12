-- Phase 1D observation-only control scaffolding.
-- This migration deliberately adds no executor and authorizes no approval,
-- merge, deployment, or rollback operation.

alter table public.organizations
  add column autonomy_kill_switch_active boolean not null default true;

alter table public.organizations
  add constraint organizations_phase1d_kill_switch_active
  check (autonomy_kill_switch_active);

comment on column public.organizations.autonomy_kill_switch_active is
  'Fail-closed Phase 1D interlock. It is locked ON until a separately approved future migration introduces a proven executor rollout.';

alter table public.projects
  add constraint projects_phase1d_green_observation_only
  check (
    not autonomous_mode
    and maximum_autonomous_risk = 'green'::public.risk_level
    and not auto_approve
    and not auto_merge
    and not auto_deploy
    and not auto_rollback
  ) not valid;

-- Fail rather than silently rewriting any unexpected pre-existing authority.
-- An unsafe row requires explicit owner investigation before this migration can
-- be applied.
alter table public.projects
  validate constraint projects_phase1d_green_observation_only;

comment on column public.projects.autonomous_mode is
  'Phase 1D scaffold flag constrained OFF. The global kill switch remains ON and no autonomous executor is connected.';
comment on constraint projects_phase1d_green_observation_only on public.projects is
  'Phase 1D keeps Autonomous Mode OFF, retains a GREEN ceiling, and disables auto approve, merge, deploy, and rollback.';

create or replace function public.enforce_safe_project_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.autonomous_mode
    or new.maximum_autonomous_risk <> 'green'::public.risk_level
    or new.auto_approve
    or new.auto_merge
    or new.auto_deploy
    or new.auto_rollback then
    raise exception using
      errcode = '23514',
      message = 'Phase 1D is scaffold-only: autonomous mode and automatic approval, merge, deploy, and rollback must remain disabled with a GREEN ceiling';
  end if;

  if tg_op = 'INSERT' then return new; end if;

  if row(
    new.autonomous_mode,
    new.maximum_autonomous_risk,
    new.auto_approve,
    new.auto_merge,
    new.auto_deploy,
    new.auto_rollback
  ) is distinct from row(
    old.autonomous_mode,
    old.maximum_autonomous_risk,
    old.auto_approve,
    old.auto_merge,
    old.auto_deploy,
    old.auto_rollback
  ) and not public.is_organization_owner(old.organization_id) then
    raise exception using
      errcode = '42501',
      message = 'only an organization owner may change autonomy observation controls';
  end if;

  return new;
end;
$function$;

create or replace function public.audit_project_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.created'::public.activity_event_type,
      'project',
      new.id,
      'Project created',
      pg_catalog.jsonb_build_object('name', new.name, 'status', new.status)
    );
    return new;
  end if;

  perform public.record_activity_event(
    new.organization_id,
    new.id,
    'project.updated'::public.activity_event_type,
    'project',
    new.id,
    'Project updated',
    pg_catalog.jsonb_build_object('name', new.name, 'status', new.status)
  );

  if new.autonomous_mode is distinct from old.autonomous_mode then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.autonomous_mode_changed'::public.activity_event_type,
      'project',
      new.id,
      'Autonomy observation mode changed',
      pg_catalog.jsonb_build_object(
        'from', old.autonomous_mode,
        'to', new.autonomous_mode,
        'execution_allowed', false,
        'global_kill_switch_active', true
      )
    );
  end if;

  if new.maximum_autonomous_risk is distinct from old.maximum_autonomous_risk then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.risk_authorization_changed'::public.activity_event_type,
      'project',
      new.id,
      'Maximum autonomous risk changed',
      pg_catalog.jsonb_build_object('from', old.maximum_autonomous_risk, 'to', new.maximum_autonomous_risk)
    );
  end if;

  if row(new.auto_approve, new.auto_merge, new.auto_deploy, new.auto_rollback)
    is distinct from row(old.auto_approve, old.auto_merge, old.auto_deploy, old.auto_rollback) then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.automation_controls_changed'::public.activity_event_type,
      'project',
      new.id,
      'Automation controls changed',
      pg_catalog.jsonb_build_object(
        'auto_approve', new.auto_approve,
        'auto_merge', new.auto_merge,
        'auto_deploy', new.auto_deploy,
        'auto_rollback', new.auto_rollback,
        'execution_allowed', false
      )
    );
  end if;

  return new;
end;
$function$;

create or replace function public.update_project_controls(
  p_project_id uuid,
  p_autonomous_mode boolean default null,
  p_maximum_autonomous_risk public.risk_level default null,
  p_auto_approve boolean default null,
  p_auto_merge boolean default null,
  p_auto_deploy boolean default null,
  p_auto_rollback boolean default null,
  p_expected_updated_at timestamptz default null
)
returns table (
  project_id uuid,
  autonomous_mode boolean,
  maximum_autonomous_risk public.risk_level,
  auto_approve boolean,
  auto_merge boolean,
  auto_deploy boolean,
  auto_rollback boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  next_maximum_risk public.risk_level;
  next_auto_approve boolean;
  next_auto_merge boolean;
  next_auto_deploy boolean;
  next_auto_rollback boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if p_autonomous_mode is null
    and p_maximum_autonomous_risk is null
    and p_auto_approve is null
    and p_auto_merge is null
    and p_auto_deploy is null
    and p_auto_rollback is null then
    raise exception using errcode = '22023', message = 'at least one control must be supplied';
  end if;

  select project.*
  into project_record
  from public.projects project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may change project controls';
  end if;

  if p_expected_updated_at is not null and project_record.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'project controls changed since they were read';
  end if;

  next_maximum_risk := coalesce(p_maximum_autonomous_risk, project_record.maximum_autonomous_risk);
  next_auto_approve := coalesce(p_auto_approve, project_record.auto_approve);
  next_auto_merge := coalesce(p_auto_merge, project_record.auto_merge);
  next_auto_deploy := coalesce(p_auto_deploy, project_record.auto_deploy);
  next_auto_rollback := coalesce(p_auto_rollback, project_record.auto_rollback);

  if coalesce(p_autonomous_mode, project_record.autonomous_mode)
    or next_maximum_risk <> 'green'::public.risk_level
    or next_auto_approve
    or next_auto_merge
    or next_auto_deploy
    or next_auto_rollback then
    raise exception using
      errcode = '23514',
      message = 'Phase 1D is scaffold-only: autonomous mode must remain OFF and only the GREEN ceiling may be configured';
  end if;

  update public.projects project
  set
    autonomous_mode = coalesce(p_autonomous_mode, project.autonomous_mode),
    maximum_autonomous_risk = next_maximum_risk,
    auto_approve = next_auto_approve,
    auto_merge = next_auto_merge,
    auto_deploy = next_auto_deploy,
    auto_rollback = next_auto_rollback
  where project.id = p_project_id
  returning project.* into project_record;

  return query select
    project_record.id,
    project_record.autonomous_mode,
    project_record.maximum_autonomous_risk,
    project_record.auto_approve,
    project_record.auto_merge,
    project_record.auto_deploy,
    project_record.auto_rollback,
    project_record.updated_at;
end;
$function$;

revoke all on function public.enforce_safe_project_controls() from public, anon, authenticated;
revoke all on function public.audit_project_change() from public, anon, authenticated;
revoke all on function public.update_project_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, timestamptz) from public, anon;
grant execute on function public.update_project_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, timestamptz) to authenticated;

comment on function public.update_project_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, timestamptz) is
  'Owner-only Phase 1D scaffold-control update. It keeps autonomous mode OFF, permits only a GREEN ceiling, and cannot approve, merge, deploy, rollback, or execute work.';
