-- Baseline capture and telemetry-derived evaluation: Phase 3's step 3.
--
-- The ledger (20260815001200) enforces the *structure* of measurement — no
-- proposal without a baseline, no evaluation without an after-state. These
-- two functions supply the *machinery*, so the numbers come from the
-- factory's own telemetry rather than from hands:
--
--   capture_improvement_baseline    reads the real telemetry tables over a
--                                   fourteen-day window into the canonical
--                                   baseline object. A source with no rows is
--                                   *named* in `unavailable`, never zeroed —
--                                   an empty table is an honest "not
--                                   measured", and zeroing it would let the
--                                   first real failure read as a regression
--                                   against a fiction.
--
--   evaluate_improvement_from_telemetry
--                                   captures the current state with the same
--                                   function, compares it to the proposal's
--                                   stored baseline metric by metric with a
--                                   fixed direction table, derives
--                                   improved/no_change/regressed, and records
--                                   the evaluation through the ledger's own
--                                   discipline (accepted decision required,
--                                   one evaluation ever). If nothing is
--                                   comparable it refuses and says so —
--                                   abstention is an answer; a guessed
--                                   outcome is not.
--
-- Directionality is deliberate and fixed: succeeded runs and validation pass
-- rate improve upward; failed runs, open incidents, and failed deployments
-- improve downward. Withheld scheduling decisions are captured as context but
-- excluded from outcome derivation — withholding is capacity discipline, not
-- a defect, and counting it against an improvement would teach the factory to
-- want fewer ceilings.

create or replace function public.capture_improvement_baseline(
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
  metrics jsonb := '{}'::jsonb;
  unavailable text[] := '{}';
  runs_total integer;
  runs_succeeded integer;
  runs_failed integer;
  validation_total integer;
  validation_passed integer;
  incidents_open integer;
  deployments_succeeded integer;
  deployments_failed integer;
  scheduling_withheld integer;
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
        message = 'only an organization owner may capture a baseline';
    end if;
  end if;

  select count(*),
    count(*) filter (where run.status = 'succeeded'::public.run_status),
    count(*) filter (where run.status = 'failed'::public.run_status)
  into runs_total, runs_succeeded, runs_failed
  from public.agent_runs run
  where run.organization_id = organization_record
    and (p_project_id is null or run.project_id = p_project_id)
    and run.created_at >= window_start;
  if runs_total = 0 then
    unavailable := array_append(unavailable, 'runs');
  else
    metrics := metrics || jsonb_build_object(
      'runsTotal', runs_total, 'runsSucceeded', runs_succeeded, 'runsFailed', runs_failed
    );
  end if;

  select count(*), count(*) filter (where validation.status = 'passed')
  into validation_total, validation_passed
  from public.phase1c_run_validations validation
  join public.agent_runs run on run.id = validation.run_id
    and run.organization_id = validation.organization_id
  where validation.organization_id = organization_record
    and (p_project_id is null or run.project_id = p_project_id)
    and validation.created_at >= window_start;
  if validation_total = 0 then
    unavailable := array_append(unavailable, 'validations');
  else
    metrics := metrics || jsonb_build_object(
      'validationSample', validation_total,
      'validationPassRate', round(validation_passed::numeric / validation_total, 4)
    );
  end if;

  select count(*) into incidents_open
  from public.incidents incident
  where incident.organization_id = organization_record
    and (p_project_id is null or incident.project_id = p_project_id)
    and incident.status in (
      'open'::public.incident_status, 'investigating'::public.incident_status,
      'mitigated'::public.incident_status
    );
  -- Zero open incidents is a real measurement, not a missing source: the
  -- incidents table exists from the first migration and an empty result
  -- means "none open", unlike a telemetry stream nothing has ever written.
  metrics := metrics || jsonb_build_object('incidentsOpen', incidents_open);

  select
    count(*) filter (where deployment.status = 'succeeded'::public.deployment_status),
    count(*) filter (where deployment.status = 'failed'::public.deployment_status)
  into deployments_succeeded, deployments_failed
  from public.deployments deployment
  where deployment.organization_id = organization_record
    and (p_project_id is null or deployment.project_id = p_project_id)
    and deployment.created_at >= window_start;
  if deployments_succeeded + deployments_failed = 0 then
    unavailable := array_append(unavailable, 'deployments');
  else
    metrics := metrics || jsonb_build_object(
      'deploymentsSucceeded', deployments_succeeded,
      'deploymentsFailed', deployments_failed
    );
  end if;

  select count(*) into scheduling_withheld
  from public.scheduling_decisions decision
  where decision.organization_id = organization_record
    and (p_project_id is null or decision.project_id = p_project_id)
    and decision.decision = 'withheld'
    and decision.occurred_at >= window_start;
  metrics := metrics || jsonb_build_object('schedulingWithheld', scheduling_withheld);

  return jsonb_build_object(
    'window', jsonb_build_object('days', 14, 'capturedAt', now()),
    'metrics', metrics,
    'unavailable', to_jsonb(unavailable)
  );
end;
$function$;

create or replace function public.evaluate_improvement_from_telemetry(
  p_proposal_id uuid,
  p_lesson text
)
returns table (entry_id uuid, outcome text, compared jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  proposal_record public.improvement_ledger%rowtype;
  current_state jsonb;
  baseline_metrics jsonb;
  current_metrics jsonb;
  comparisons jsonb := '[]'::jsonb;
  improved_count integer := 0;
  regressed_count integer := 0;
  compared_count integer := 0;
  derived_outcome text;
  recorded_entry uuid;
  metric record;
  baseline_value numeric;
  current_value numeric;
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

  current_state := public.capture_improvement_baseline(proposal_record.project_id);
  baseline_metrics := coalesce(proposal_record.baseline -> 'metrics', proposal_record.baseline);
  current_metrics := current_state -> 'metrics';

  -- The fixed direction table. A metric absent from either side is not
  -- compared — a number against a blank is a story, not a measurement.
  for metric in
    select * from (values
      ('runsSucceeded', 'up'), ('runsFailed', 'down'),
      ('validationPassRate', 'up'), ('incidentsOpen', 'down'),
      ('deploymentsFailed', 'down')
    ) as direction_table(name, direction)
  loop
    if baseline_metrics ? metric.name and current_metrics ? metric.name then
      baseline_value := (baseline_metrics ->> metric.name)::numeric;
      current_value := (current_metrics ->> metric.name)::numeric;
      compared_count := compared_count + 1;
      if (metric.direction = 'up' and current_value > baseline_value)
        or (metric.direction = 'down' and current_value < baseline_value) then
        improved_count := improved_count + 1;
      elsif current_value <> baseline_value then
        regressed_count := regressed_count + 1;
      end if;
      comparisons := comparisons || jsonb_build_array(jsonb_build_object(
        'metric', metric.name, 'direction', metric.direction,
        'baseline', baseline_value, 'current', current_value
      ));
    end if;
  end loop;

  if compared_count = 0 then
    raise exception using errcode = '22023',
      message = 'no metric is present in both the baseline and current telemetry; nothing can be compared, and a guessed outcome will not be recorded';
  end if;

  derived_outcome := case
    when regressed_count > 0 then 'regressed'
    when improved_count > 0 then 'improved'
    else 'no_change'
  end;

  recorded_entry := public.record_improvement_evaluation(
    p_proposal_id,
    jsonb_build_object(
      'capturedAt', current_state -> 'window' ->> 'capturedAt',
      'metrics', current_metrics,
      'comparisons', comparisons,
      'derivation', jsonb_build_object(
        'compared', compared_count, 'improved', improved_count, 'regressed', regressed_count
      )
    ),
    derived_outcome,
    p_lesson
  );

  return query select recorded_entry, derived_outcome, comparisons;
end;
$function$;

revoke all on function public.capture_improvement_baseline(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.evaluate_improvement_from_telemetry(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.capture_improvement_baseline(uuid) to authenticated;
grant execute on function public.evaluate_improvement_from_telemetry(uuid, text) to authenticated;
