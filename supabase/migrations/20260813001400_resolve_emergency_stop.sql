-- Report the emergency stop in the resolved control envelope.
--
-- `stop_autonomous_operations` (Phase 1E) sets
-- `projects.autonomous_operations_stopped`, but `resolved_autonomy_controls`
-- did not read it, so a caller reading the envelope from the database saw only
-- the freeze that STOP also applies. The freeze does hold every action off, so
-- nothing was permitted that should not have been — but a caller could not tell
-- an owner's deliberate emergency stop from an automatic SEV1 freeze, and those
-- are different situations that need different words in the interface and a
-- different action to clear.
--
-- The TypeScript envelope already carried `emergencyStopActive`; this makes the
-- database agree with it rather than leaving the field to be guessed.

-- PostgreSQL refuses to replace a set-returning function whose return type
-- changed, so the old signature has to go first. Dropping it is safe: the only
-- callers are this application's own reads, and the grant is reissued below.
drop function if exists public.resolved_autonomy_controls(uuid);

create function public.resolved_autonomy_controls(p_project_id uuid)
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
  emergency_stop_active boolean,
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
      p.autonomous_operations_stopped as emergency_stop_active,
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
    emergency_stop_active,
    release_frozen,
    false
  from scoped;
$function$;

comment on function public.resolved_autonomy_controls(uuid) is
  'Most-restrictive-wins resolution of organization and project controls, including the owner emergency stop. Every automatic action resolves OFF while no executor is connected.';

revoke all on function public.resolved_autonomy_controls(uuid) from public, anon;
grant execute on function public.resolved_autonomy_controls(uuid) to authenticated;
