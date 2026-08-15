-- Phase 1D: make the decision layer legible.
--
-- `autonomy_decisions` has recorded every decision since 20260813001600, and
-- nothing has ever read it. An append-only audit trail that no surface can
-- show is not auditability; it is storage. This adds the read path.
--
-- Two projections:
--
--   agentos-style decision list   what the loop decided, why it refused, and
--                                 against which head. Named blockers only.
--   autonomy status envelope      what the loop is permitted to do right now,
--                                 per project, resolved most-restrictive-wins.
--
-- Nothing here enables an action, clears an interlock, or raises a ceiling.
-- Reading what the loop decided cannot change what it may do, and the status
-- projection reports the same OFF flags the resolver already returns.

create or replace function public.list_autonomy_decisions(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  project_name text,
  action text,
  decision text,
  risk public.risk_level,
  risk_escalated boolean,
  head_sha text,
  blockers text[],
  reached_stage text,
  policy_version text,
  -- Whether a human stood behind each role, not which human. A decision list
  -- answers "was this independently approved", and the identities are on the
  -- row for anyone auditing a specific decision.
  had_author boolean,
  had_approver boolean,
  independent_approval boolean,
  decided_at timestamptz
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
    d.id,
    p.name,
    d.action,
    d.decision,
    d.risk,
    d.risk_escalated,
    d.head_sha,
    d.blockers,
    d.reached_stage,
    d.policy_version,
    (d.author_id is not null),
    (d.approver_id is not null),
    -- Surfaced explicitly rather than left for a reader to infer from two
    -- booleans: the no-self-approval rule is the one the phase turns on.
    (d.approver_id is not null and d.author_id is not null and d.approver_id <> d.author_id),
    d.decided_at
  from public.autonomy_decisions d
  join public.projects p on p.id = d.project_id
  where d.organization_id = p_organization_id
  order by d.decided_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

comment on function public.list_autonomy_decisions(uuid, integer) is
  'The autonomy audit trail, readable. Reports whether an approval was independent rather than who signed it; identities stay on the row for a targeted audit.';

revoke all on function public.list_autonomy_decisions(uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_autonomy_decisions(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- What the loop may do right now
-- ---------------------------------------------------------------------------
--
-- One row per project, carrying the resolved envelope plus the interlocks. A
-- console showing "autonomy" without the kill switch beside it would let a
-- reader conclude that nine OFF flags are the whole story.

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
    -- Reported rather than assumed. A console that showed nine OFF flags
    -- without this could read as "ready but idle" instead of "no executor".
    r.executor_connected,
    -- Counted from the resolved envelope, so a project flag the organization
    -- overrides is never reported as enabled.
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
  order by p.name
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

comment on function public.list_autonomy_status(uuid, integer) is
  'The resolved autonomy envelope per project, with both interlocks and executor connectivity beside it. Enabled actions are counted from the resolver, so an organization override cannot read as enabled.';

revoke all on function public.list_autonomy_status(uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_autonomy_status(uuid, integer) to authenticated;
