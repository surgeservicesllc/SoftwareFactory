-- The self-audit engine: Phase 3 goals 1 and 2.
--
-- "Factory can audit its own repository/system" and "self-health score uses
-- real evidence." Eighteen telemetry tables record what happens; until now
-- nothing read them *as evidence about the factory*. This function does, with
-- the two disciplines every honest surface in this repository already
-- follows:
--
-- **Unmeasured is named, never zeroed.** A domain with no rows in the window
-- reports `measured: false` with a reason. The health score is computed over
-- measured domains only, and its `confidence` says how much of the factory
-- was actually visible. With today's thin telemetry (no live run has
-- completed), the score will be low-confidence or abstain entirely — that is
-- the truthful answer, and the tests pin it.
--
-- **The formula is fixed and boring.** Each measured domain scores 0-100 by a
-- stated rule; the overall score is their unweighted mean. No domain can be
-- dropped because it scored badly — the domain list is the function body, and
-- changing it is a reviewed migration, not a parameter.

create or replace function public.audit_factory_health(
  p_project_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  organization_record uuid;
  window_start timestamptz := now() - interval '14 days';
  domains jsonb := '{}'::jsonb;
  scores numeric[] := '{}';
  runs_total integer; runs_succeeded integer; runs_failed integer;
  validation_total integer; validation_passed integer;
  verifier_total integer; verifier_blocked integer;
  repairs_total integer; repairs_failed integer;
  incidents_open integer; incidents_opened integer; incidents_resolved integer;
  deployments_succeeded integer; deployments_failed integer;
  breakers_open integer;
  queued_runs integer; oldest_queued_seconds numeric;
  domain_score numeric;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if p_project_id is not null then
    select project.organization_id into organization_record
    from public.projects project
    where project.id = p_project_id
      and public.is_organization_member(project.organization_id);
    if not found then
      raise exception using errcode = 'P0002', message = 'project not found';
    end if;
  else
    select membership.organization_id into organization_record
    from public.organization_members membership
    where membership.user_id = caller_id
    order by membership.created_at
    limit 1;
    if organization_record is null then
      raise exception using errcode = '42501',
        message = 'an organization membership is required to audit factory health';
    end if;
  end if;

  -- Runs: success rate over the window.
  select count(*),
    count(*) filter (where run.status = 'succeeded'::public.run_status),
    count(*) filter (where run.status = 'failed'::public.run_status)
  into runs_total, runs_succeeded, runs_failed
  from public.agent_runs run
  where run.organization_id = organization_record
    and (p_project_id is null or run.project_id = p_project_id)
    and run.created_at >= window_start;
  if runs_succeeded + runs_failed = 0 then
    domains := domains || jsonb_build_object('runs', jsonb_build_object(
      'measured', false, 'reason', 'no run reached a terminal state in the window'));
  else
    domain_score := round(100.0 * runs_succeeded / (runs_succeeded + runs_failed), 1);
    scores := array_append(scores, domain_score);
    domains := domains || jsonb_build_object('runs', jsonb_build_object(
      'measured', true, 'total', runs_total, 'succeeded', runs_succeeded,
      'failed', runs_failed, 'score', domain_score));
  end if;

  -- Validations: pass rate.
  select count(*), count(*) filter (where validation.status = 'passed')
  into validation_total, validation_passed
  from public.phase1c_run_validations validation
  join public.agent_runs run on run.id = validation.run_id
    and run.organization_id = validation.organization_id
  where validation.organization_id = organization_record
    and (p_project_id is null or run.project_id = p_project_id)
    and validation.created_at >= window_start;
  if validation_total = 0 then
    domains := domains || jsonb_build_object('validations', jsonb_build_object(
      'measured', false, 'reason', 'no validation ran in the window'));
  else
    domain_score := round(100.0 * validation_passed / validation_total, 1);
    scores := array_append(scores, domain_score);
    domains := domains || jsonb_build_object('validations', jsonb_build_object(
      'measured', true, 'sample', validation_total, 'passed', validation_passed,
      'score', domain_score));
  end if;

  -- Verifier: how often the decision layer let work through cleanly.
  select count(*), count(*) filter (where decision.decision = 'NOT_APPROVED')
  into verifier_total, verifier_blocked
  from public.autonomy_decisions decision
  where decision.organization_id = organization_record
    and (p_project_id is null or decision.project_id = p_project_id)
    and decision.decided_at >= window_start;
  if verifier_total = 0 then
    domains := domains || jsonb_build_object('verifier', jsonb_build_object(
      'measured', false, 'reason', 'no autonomy decision was recorded in the window'));
  else
    domain_score := round(100.0 * (verifier_total - verifier_blocked) / verifier_total, 1);
    scores := array_append(scores, domain_score);
    domains := domains || jsonb_build_object('verifier', jsonb_build_object(
      'measured', true, 'decisions', verifier_total, 'blocked', verifier_blocked,
      'score', domain_score));
  end if;

  -- Repairs: how often a repair attempt failed outright.
  select count(*), count(*) filter (where repair.state = 'failed'::public.repair_state)
  into repairs_total, repairs_failed
  from public.repair_attempts repair
  where repair.organization_id = organization_record
    and (p_project_id is null or repair.project_id = p_project_id)
    and repair.created_at >= window_start;
  if repairs_total = 0 then
    domains := domains || jsonb_build_object('repairs', jsonb_build_object(
      'measured', false, 'reason', 'no repair was attempted in the window'));
  else
    domain_score := round(100.0 * (repairs_total - repairs_failed) / repairs_total, 1);
    scores := array_append(scores, domain_score);
    domains := domains || jsonb_build_object('repairs', jsonb_build_object(
      'measured', true, 'attempts', repairs_total, 'failed', repairs_failed,
      'score', domain_score));
  end if;

  -- Incidents: always measured — the table exists from the first migration,
  -- and empty honestly means "none open". Each open incident costs 25 points.
  select
    count(*) filter (where incident.status in (
      'open'::public.incident_status, 'investigating'::public.incident_status,
      'mitigated'::public.incident_status)),
    count(*) filter (where incident.created_at >= window_start),
    count(*) filter (where incident.resolved_at >= window_start)
  into incidents_open, incidents_opened, incidents_resolved
  from public.incidents incident
  where incident.organization_id = organization_record
    and (p_project_id is null or incident.project_id = p_project_id);
  domain_score := greatest(0, 100 - 25 * incidents_open);
  scores := array_append(scores, domain_score);
  domains := domains || jsonb_build_object('incidents', jsonb_build_object(
    'measured', true, 'open', incidents_open, 'openedInWindow', incidents_opened,
    'resolvedInWindow', incidents_resolved, 'score', domain_score));

  -- Deployments: success rate over the window.
  select
    count(*) filter (where deployment.status = 'succeeded'::public.deployment_status),
    count(*) filter (where deployment.status = 'failed'::public.deployment_status)
  into deployments_succeeded, deployments_failed
  from public.deployments deployment
  where deployment.organization_id = organization_record
    and (p_project_id is null or deployment.project_id = p_project_id)
    and deployment.created_at >= window_start;
  if deployments_succeeded + deployments_failed = 0 then
    domains := domains || jsonb_build_object('deployments', jsonb_build_object(
      'measured', false, 'reason', 'no deployment reached a terminal state in the window'));
  else
    domain_score := round(
      100.0 * deployments_succeeded / (deployments_succeeded + deployments_failed), 1);
    scores := array_append(scores, domain_score);
    domains := domains || jsonb_build_object('deployments', jsonb_build_object(
      'measured', true, 'succeeded', deployments_succeeded,
      'failed', deployments_failed, 'score', domain_score));
  end if;

  -- Breakers: always measured for the same reason as incidents. An open
  -- breaker means a provider target is refusing work right now.
  select count(*) into breakers_open
  from public.resource_breakers breaker
  where breaker.organization_id = organization_record
    and breaker.state = 'open';
  domain_score := case when breakers_open = 0 then 100 else 25 end;
  scores := array_append(scores, domain_score);
  domains := domains || jsonb_build_object('breakers', jsonb_build_object(
    'measured', true, 'open', breakers_open, 'score', domain_score));

  -- Queue: age of the oldest queued run. Under an hour is healthy; a run
  -- queued for a day scores zero — something upstream is not claiming.
  select count(*),
    coalesce(extract(epoch from now() - min(run.created_at)), 0)
  into queued_runs, oldest_queued_seconds
  from public.agent_runs run
  where run.organization_id = organization_record
    and (p_project_id is null or run.project_id = p_project_id)
    and run.status = 'queued'::public.run_status;
  if queued_runs = 0 then
    domains := domains || jsonb_build_object('queue', jsonb_build_object(
      'measured', false, 'reason', 'nothing is queued'));
  else
    domain_score := round(greatest(0, 100 - (oldest_queued_seconds / 864)), 1);
    scores := array_append(scores, domain_score);
    domains := domains || jsonb_build_object('queue', jsonb_build_object(
      'measured', true, 'queuedRuns', queued_runs,
      'oldestQueuedSeconds', round(oldest_queued_seconds), 'score', domain_score));
  end if;

  return jsonb_build_object(
    'policyVersion', 'factory-self-audit-v1',
    'window', jsonb_build_object('days', 14, 'generatedAt', now()),
    'domains', domains,
    'score', case
      when array_length(scores, 1) is null then jsonb_build_object(
        'value', null, 'measuredDomains', 0, 'totalDomains', 8,
        'abstained', true,
        'reason', 'no domain held any evidence in the window; a score would be invented')
      else jsonb_build_object(
        'value', round((select avg(score_value) from unnest(scores) score_value), 1),
        'measuredDomains', array_length(scores, 1), 'totalDomains', 8,
        'confidence', round(array_length(scores, 1) / 8.0, 2),
        'abstained', false)
    end
  );
end;
$function$;

revoke all on function public.audit_factory_health(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.audit_factory_health(uuid) to authenticated;
