-- Reports gain the per-project view, closing portfolio goal 26.
--
-- The daily report was already organization-wide with a portfolio health
-- histogram, attributed risks, and frozen projects. What it could not answer
-- was "how is this project" for a project that was neither at risk nor
-- frozen — the healthy majority had no row anywhere. A portfolio report in
-- which only the troubled projects exist cannot be read week over week.
--
-- This replaces `generate_operations_report` with the same body plus a
-- bounded `projects` array: one row per project, worst-health first, with the
-- open work and draft-PR counts the portfolio console shows, so the report
-- and the console can be reconciled against each other. The policy version
-- advances to phase1e-operations-v2 so a consumer can tell which shape it
-- holds. Nothing else changes; every existing key keeps its meaning.

create or replace function public.generate_operations_report(
  p_organization_id uuid,
  p_period_hours integer default 24
)
returns setof public.reports
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  period_start timestamptz;
  report_content jsonb;
  report_record public.reports%rowtype;
  recurring jsonb;
  frozen jsonb;
  decisions jsonb;
  risks jsonb;
  hours integer := greatest(1, least(coalesce(p_period_hours, 24), 168));
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  period_start := now() - make_interval(hours => hours);

  -- Recurring failures are the fingerprints that came back, not merely the
  -- incidents that were noisy once.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'fingerprint', incident.fingerprint,
      'project_id', incident.project_id,
      'occurrences', incident.occurrence_count,
      'sev', incident.sev
    )
  ), '[]'::jsonb)
  into recurring
  from public.incidents incident
  where incident.organization_id = p_organization_id
    and incident.fingerprint is not null
    and incident.occurrence_count > 1
    and incident.detected_at >= period_start;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'project_id', release_freeze.project_id,
      'reason_code', release_freeze.reason_code,
      'automatic', release_freeze.automatic,
      'frozen_at', release_freeze.frozen_at
    )
  ), '[]'::jsonb)
  into frozen
  from public.release_freezes release_freeze
  where release_freeze.organization_id = p_organization_id
    and release_freeze.state = 'active';

  -- Owner decisions are the recorded ones only: resumes, emergency stops, and
  -- rollback determinations.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'kind', event.kind,
      'summary', left(event.summary, 200),
      'created_at', event.created_at
    )
  ), '[]'::jsonb)
  into decisions
  from public.operations_audit_events event
  where event.organization_id = p_organization_id
    and event.created_at >= period_start
    and event.kind in (
      'freeze.released'::public.operations_audit_kind,
      'operations.stopped'::public.operations_audit_kind,
      'rollback.evaluated'::public.operations_audit_kind,
      'rollback.blocked'::public.operations_audit_kind
    );

  select coalesce(pg_catalog.jsonb_agg(risk), '[]'::jsonb)
  into risks
  from (
    select pg_catalog.jsonb_build_object(
      'project_id', project.id,
      'project', project.name,
      'health', project.operations_health_state,
      'reason', left(coalesce(project.operations_health_reason, 'No evidence recorded.'), 300)
    ) as risk
    from public.projects project
    where project.organization_id = p_organization_id
      and project.status <> 'archived'
      and project.operations_health_state in ('critical', 'degraded', 'unknown')
    order by project.operations_health_state, project.name
    limit 10
  ) top_risks;

  select pg_catalog.jsonb_build_object(
    'policy_version', 'phase1e-operations-v2',
    'period_hours', hours,
    'portfolio', (
      select pg_catalog.jsonb_build_object(
        'total', count(*),
        'healthy', count(*) filter (where project.operations_health_state = 'healthy'),
        'degraded', count(*) filter (where project.operations_health_state = 'degraded'),
        'critical', count(*) filter (where project.operations_health_state = 'critical'),
        'unknown', count(*) filter (where project.operations_health_state = 'unknown'),
        'paused', count(*) filter (where project.operations_health_state = 'paused')
      )
      from public.projects project
      where project.organization_id = p_organization_id and project.status <> 'archived'
    ),
    'incidents', (
      select pg_catalog.jsonb_build_object(
        'opened', count(*) filter (where incident.detected_at >= period_start),
        'resolved', count(*) filter (where incident.resolved_at >= period_start),
        'open_now', count(*) filter (where incident.status in ('open', 'investigating', 'mitigated')),
        'sev1_open', count(*) filter (
          where incident.sev = 'sev1' and incident.status in ('open', 'investigating', 'mitigated')
        )
      )
      from public.incidents incident
      where incident.organization_id = p_organization_id
    ),
    'unavailability', (
      -- Downtime is reported as observed failing checks, not as an estimate.
      select pg_catalog.jsonb_build_object(
        'failing_observations', count(*) filter (where observation.outcome = 'fail'),
        'degraded_observations', count(*) filter (where observation.outcome = 'degraded'),
        'total_observations', count(*)
      )
      from public.monitor_observations observation
      where observation.organization_id = p_organization_id
        and observation.observed_at >= period_start
    ),
    'deployments', (
      select pg_catalog.jsonb_build_object(
        'failed', count(*) filter (where deployment.status = 'failed'),
        'succeeded', count(*) filter (where deployment.status = 'succeeded')
      )
      from public.deployments deployment
      where deployment.organization_id = p_organization_id
        and deployment.created_at >= period_start
    ),
    'rollbacks', (
      select pg_catalog.jsonb_build_object(
        'recorded', count(*),
        'blocked', count(*) filter (where rollback_operation.state = 'blocked'),
        'failed', count(*) filter (where rollback_operation.state = 'failed'),
        'executed', 0,
        'executor', 'not_connected'
      )
      from public.rollback_operations rollback_operation
      where rollback_operation.organization_id = p_organization_id
        and rollback_operation.created_at >= period_start
    ),
    'repairs', (
      select pg_catalog.jsonb_build_object(
        'created', count(*),
        'escalated', count(*) filter (where repair.escalated),
        'executor', 'not_connected'
      )
      from public.repair_attempts repair
      where repair.organization_id = p_organization_id
        and repair.created_at >= period_start
    ),
    'projects', (
      -- The per-project view, so one artifact answers both "how is the
      -- portfolio" and "how is this project" without a second query. Archived
      -- projects appear with their status rather than vanishing: a report
      -- that silently drops a project cannot be reconciled against last
      -- week's. Bounded and ordered worst-first, like the risks above.
      select coalesce(pg_catalog.jsonb_agg(project_row), '[]'::jsonb)
      from (
        select pg_catalog.jsonb_build_object(
          'project_id', project.id,
          'project', project.name,
          'status', project.status,
          'health', project.operations_health_state,
          'open_incidents', (
            select count(*) from public.incidents incident
            where incident.project_id = project.id
              and incident.status in ('open', 'investigating', 'mitigated')
          ),
          'active_freezes', (
            select count(*) from public.release_freezes release_freeze
            where release_freeze.project_id = project.id and release_freeze.state = 'active'
          ),
          'open_runs', (
            select count(*) from public.agent_runs run
            where run.project_id = project.id
              and run.status in ('queued', 'running')
          ),
          'open_tasks', (
            select count(*) from public.tasks task
            where task.project_id = project.id
              and task.status in ('backlog', 'awaiting_approval', 'queued', 'in_progress', 'blocked')
          ),
          'draft_prs_in_period', (
            select count(*) from public.github_change_requests change_request
            where change_request.project_id = project.id
              and change_request.status = 'completed'
              and change_request.created_at >= period_start
          )
        ) as project_row
        from public.projects project
        where project.organization_id = p_organization_id
        order by
          case project.operations_health_state
            when 'critical' then 0 when 'degraded' then 1
            when 'unknown' then 2 when 'paused' then 3 else 4 end,
          project.name
        limit 100
      ) per_project
    ),
    'recurring_failures', recurring,
    'frozen_projects', frozen,
    'owner_decisions', decisions,
    'top_operational_risks', risks
  )
  into report_content;

  insert into public.reports (
    organization_id, type, status, title, summary, content, period_start, period_end, published_at
  )
  values (
    p_organization_id,
    'daily_ceo'::public.report_type,
    'published'::public.report_status,
    format('Daily operations report (%s hours)', hours),
    format(
      '%s open incident(s), %s frozen project(s), %s rollback decision(s) recorded. No deployment, rollback, or repair was executed: those executors are Not Connected.',
      report_content -> 'incidents' ->> 'open_now',
      pg_catalog.jsonb_array_length(frozen),
      report_content -> 'rollbacks' ->> 'recorded'
    ),
    report_content,
    period_start,
    now(),
    now()
  )
  returning * into report_record;

  perform public.record_operations_audit_event(
    p_organization_id, null, 'event.processed'::public.operations_audit_kind,
    'report', report_record.id, 'Daily operations report generated',
    pg_catalog.jsonb_build_object('period_hours', hours)
  );

  return next report_record;
end;
$function$;
