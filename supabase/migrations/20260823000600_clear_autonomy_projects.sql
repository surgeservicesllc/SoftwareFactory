-- The Autonomy page's Clear control, built on the supported end of a
-- project's life rather than against it.
--
-- The owner asked for a Clear that empties "What the loop may do". That list
-- is one row per project, so the first design deleted projects. Three
-- independent guards refused, and the third one settles it by name:
-- `refuse_project_deletion` (20260815000900) states that a project's
-- append-only activity trail makes it undeletable from its first recorded
-- moment, that this is deliberate, that there is no escape hatch, and that
-- "the supported end of a project's life is archive_project".
--
-- Archiving reaches the same visible outcome without any of that:
--
--   * `archive_project` (20260815000700) is already owner-only, already
--     requires a reason, already writes an immutable event per transition,
--     and deliberately deletes nothing - every run, task, command and
--     activity row keeps its project foreign key.
--   * The claim path filters on `project.status = 'active'`, so an archived
--     project is precisely one the loop may do nothing with.
--
-- That second fact is why the list changes too. Showing an archived project
-- under "What the loop may do" was already misleading - the answer for such a
-- project is "nothing" - so excluding it states the truth rather than hiding
-- one. Everything remains on the Projects page, where archived projects are
-- listed and can be unarchived.

do $preflight$
begin
  if to_regprocedure('public.archive_project(uuid,text)') is null then
    raise exception using errcode = '55000',
      message = '20260823000600 preflight: archive_project is missing';
  end if;
  if to_regprocedure('public.list_autonomy_status(uuid,integer)') is null then
    raise exception using errcode = '55000',
      message = '20260823000600 preflight: list_autonomy_status is missing';
  end if;
  if to_regprocedure('public.can_manage_organization(uuid)') is null then
    raise exception using errcode = '55000',
      message = '20260823000600 preflight: can_manage_organization is missing';
  end if;
end;
$preflight$;

-- What the loop may do, over the projects it may actually do anything with.
-- Identical to 20260814001000's body but for the status filter.
create or replace function public.list_autonomy_status(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  project_id uuid,
  project_name text,
  autonomous_mode boolean,
  maximum_autonomous_risk public.risk_level,
  risk_ceiling_source text,
  kill_switch_active boolean,
  release_frozen boolean,
  executor_connected boolean,
  enabled_action_count integer,
  total_action_count integer,
  decisions_recorded integer,
  last_decision_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select
    p.id,
    p.name,
    r.autonomous_mode,
    r.maximum_autonomous_risk,
    r.risk_ceiling_source,
    r.kill_switch_active,
    r.release_frozen,
    r.executor_connected,
    (
      (r.auto_plan)::integer + (r.auto_code)::integer + (r.auto_test)::integer
      + (r.auto_repair)::integer + (r.auto_review)::integer + (r.auto_approve)::integer
      + (r.auto_merge)::integer + (r.auto_deploy)::integer + (r.auto_rollback)::integer
    ),
    9,
    (select count(*)::integer from public.autonomy_decisions d where d.project_id = p.id),
    (select max(d.decided_at) from public.autonomy_decisions d where d.project_id = p.id)
  from public.projects p
  cross join lateral public.resolved_autonomy_controls(p.id) r
  where p.organization_id = p_organization_id
    -- An archived project is one no work can be claimed for, so "what the
    -- loop may do" about it is nothing, and saying nothing is the truthful
    -- rendering. It remains on the Projects page and can be unarchived.
    and p.status <> 'archived'::public.project_status
  order by p.name
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

comment on function public.list_autonomy_status(uuid, integer) is
  'The resolved autonomy envelope per project the loop can still act on, with both interlocks and executor connectivity beside it. Archived projects are excluded because no work can be claimed for them.';

-- Archive every project the loop can still act on, in one owner-authorized
-- step. Each project goes through archive_project, so every rule that
-- function enforces - and every event it writes - applies unchanged.
create function public.clear_autonomy_projects(
  p_organization_id uuid,
  p_reason text
)
returns table (archived_count integer, already_archived integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_project record;
  v_archived integer := 0;
  v_already integer := 0;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an owner or admin may clear the autonomy list';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception using errcode = '22023',
      message = 'a reason of at least 10 characters is required';
  end if;

  for v_project in
    select project.id, project.status
      from public.projects project
     where project.organization_id = p_organization_id
     order by project.created_at
  loop
    if v_project.status = 'archived'::public.project_status then
      v_already := v_already + 1;
      continue;
    end if;
    perform public.archive_project(v_project.id, btrim(p_reason));
    v_archived := v_archived + 1;
  end loop;

  return query select v_archived, v_already;
end;
$function$;

comment on function public.clear_autonomy_projects(uuid, text) is
  'Archives every project the loop can still act on, through archive_project so its owner check, reason requirement and immutable per-project event all apply. Deletes nothing: archived projects keep every run, task, command and activity row, and can be unarchived from the Projects page.';

revoke all on function public.clear_autonomy_projects(uuid, text)
  from public, anon, service_role;
grant execute on function public.clear_autonomy_projects(uuid, text) to authenticated;

do $postflight$
begin
  if to_regprocedure('public.clear_autonomy_projects(uuid,text)') is null then
    raise exception using errcode = '55000',
      message = '20260823000600 postflight: the function was not created';
  end if;
  if has_function_privilege('anon', to_regprocedure('public.clear_autonomy_projects(uuid,text)'), 'EXECUTE')
    or has_function_privilege('service_role', to_regprocedure('public.clear_autonomy_projects(uuid,text)'), 'EXECUTE')
    or not has_function_privilege('authenticated', to_regprocedure('public.clear_autonomy_projects(uuid,text)'), 'EXECUTE') then
    raise exception using errcode = '55000',
      message = '20260823000600 postflight: the execute grants are not owner+authenticated only';
  end if;
  -- The deletion guard this design deliberately does not touch must still be
  -- in place, refusing deletes on projects.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.projects'::regclass
       and tgname = 'projects_guarded_deletion'
       and not tgisinternal
  ) then
    raise exception using errcode = '55000',
      message = '20260823000600 postflight: the project deletion guard is missing';
  end if;
end;
$postflight$;
