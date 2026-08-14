-- Serialize two concurrent-write races in the Phase 1E operations plane.
--
-- Both were found by running the workflows from genuinely parallel connections
-- against a real PostgreSQL server. The rest of the suite runs on PGlite, which
-- is single-connection, so neither could surface there.
--
-- 1. `open_production_incident` locked an *existing* open incident before
--    folding a repeat signal into it, but when no incident existed yet there was
--    no row to lock. Simultaneous first signals therefore both reached the
--    INSERT and one lost to `incidents_open_fingerprint_unique`. It failed
--    closed — no duplicate incident was ever created — but the losing signal was
--    dropped entirely rather than counted, and the caller saw a raw 23505. A
--    burst of simultaneous failures is precisely the real-world case, and
--    undercounting occurrences understates incident pressure.
--
-- 2. `record_rollback_decision` read `max(attempt) + 1` without locking the
--    incident, so concurrent decisions computed the same attempt number and
--    collided on `rollback_operations_incident_attempt_unique`. Also fail-closed,
--    also opaque. `create_repair_attempt` already locked the incident before
--    allocating its attempt number; this brings rollback to the same rule.
--
-- No schema, privilege, or policy changes.

create or replace function public.open_production_incident(
  p_project_id uuid,
  p_fingerprint text,
  p_title text,
  p_sev public.incident_sev,
  p_source public.production_signal_kind,
  p_symptoms text,
  p_impact text,
  p_monitor_id uuid default null,
  p_deployment_id uuid default null,
  p_commit_sha text default null,
  p_evidence jsonb default '{}'::jsonb
)
returns table (
  incident_id uuid,
  incident_sev_level public.incident_sev,
  incident_status_value public.incident_status,
  occurrences integer,
  deduplicated boolean,
  freeze_applied boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
  incident_record public.incidents%rowtype;
  was_deduplicated boolean := false;
  was_frozen boolean := false;
  escalated_sev public.incident_sev;
  resolved boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into project_record from public.projects where id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.can_manage_organization(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;

  -- Two passes at most. If a concurrent transaction wins the race to create the
  -- incident, the second pass finds its committed row and folds into it, so the
  -- signal is counted instead of lost.
  for pass in 1..2 loop
    select existing.* into incident_record
    from public.incidents existing
    where existing.project_id = p_project_id
      and existing.fingerprint = p_fingerprint
      and existing.status in ('open', 'investigating', 'mitigated')
    for update;

    if found then
      was_deduplicated := true;
      -- Repeated signals raise pressure on the same incident rather than
      -- creating a second one. Severity may only move upward here.
      escalated_sev := least(incident_record.sev, p_sev);

      update public.incidents
      set occurrence_count = incident_record.occurrence_count + 1,
        last_signal_at = now(),
        sev = escalated_sev,
        severity = public.incident_sev_to_severity(escalated_sev),
        evidence = incident_record.evidence || coalesce(p_evidence, '{}'::jsonb)
      where id = incident_record.id
      returning * into incident_record;

      perform public.record_operations_audit_event(
        project_record.organization_id, p_project_id,
        'incident.deduplicated'::public.operations_audit_kind,
        'incident', incident_record.id,
        format('Repeat signal folded into incident (%s occurrences)', incident_record.occurrence_count),
        pg_catalog.jsonb_build_object('fingerprint', p_fingerprint, 'sev', incident_record.sev)
      );

      resolved := true;
      exit;
    end if;

    begin
      insert into public.incidents (
        organization_id, project_id, deployment_id, title, description, severity, status,
        sev, source, monitor_id, fingerprint, symptoms, impact, commit_sha, evidence,
        detected_at, first_signal_at, last_signal_at, auto_created, created_by
      )
      values (
        project_record.organization_id, p_project_id, p_deployment_id, p_title, p_symptoms,
        public.incident_sev_to_severity(p_sev), 'open'::public.incident_status,
        p_sev, p_source, p_monitor_id, p_fingerprint, p_symptoms, p_impact, p_commit_sha,
        coalesce(p_evidence, '{}'::jsonb), now(), now(), now(), true, auth.uid()
      )
      returning * into incident_record;

      perform public.record_operations_audit_event(
        project_record.organization_id, p_project_id,
        'incident.created'::public.operations_audit_kind,
        'incident', incident_record.id, format('%s incident opened: %s', upper(p_sev::text), p_title),
        pg_catalog.jsonb_build_object('sev', p_sev, 'source', p_source, 'fingerprint', p_fingerprint)
      );

      perform public.enqueue_operations_event(
        project_record.organization_id, p_project_id, 'incident.created',
        format('incident:%s:created', incident_record.id),
        pg_catalog.jsonb_build_object('incident_id', incident_record.id, 'sev', p_sev)
      );

      resolved := true;
      exit;
    exception when unique_violation then
      -- A concurrent transaction created this incident between the lookup and
      -- the insert. Loop once more to deduplicate into its committed row.
      if pass = 2 then
        raise;
      end if;
    end;
  end loop;

  if not resolved then
    raise exception using
      errcode = '40001',
      message = 'the incident could not be opened or deduplicated; retry the signal';
  end if;

  -- Automatic protection. A SEV1/SEV2 production failure freezes autonomous
  -- releases immediately; investigation and repair work remain available.
  if incident_record.sev in ('sev1', 'sev2') then
    was_frozen := public.freeze_project_releases(
      p_project_id,
      'SEVERE_PRODUCTION_FAILURE',
      format('Autonomous releases frozen by %s incident.', upper(incident_record.sev::text)),
      incident_record.id,
      true
    );
  end if;

  perform public.evaluate_project_health(p_project_id);

  return query select incident_record.id, incident_record.sev, incident_record.status,
    incident_record.occurrence_count, was_deduplicated, was_frozen;
end;
$function$;

comment on function public.open_production_incident(uuid, text, text, public.incident_sev, public.production_signal_kind, text, text, uuid, uuid, text, jsonb) is
  'Opens or deduplicates a production incident. A simultaneous first signal that loses the insert race is folded into the winning incident on a second pass, so a burst of identical failures is counted rather than dropped.';

create or replace function public.record_rollback_decision(
  p_incident_id uuid,
  p_eligible boolean,
  p_blocked_reason text,
  p_eligibility jsonb,
  p_from_deployment_id uuid default null,
  p_to_deployment_id uuid default null
)
returns setof public.rollback_operations
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  incident_record public.incidents%rowtype;
  next_attempt smallint;
  rollback_record public.rollback_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  -- Lock the incident before allocating an attempt number, so concurrent
  -- decisions queue behind each other and receive successive attempts.
  select * into incident_record
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'incident not found';
  end if;

  if not public.is_organization_owner(incident_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may record a rollback decision';
  end if;

  select coalesce(max(existing.attempt), 0) + 1 into next_attempt
  from public.rollback_operations existing
  where existing.incident_id = p_incident_id;

  if next_attempt > 3 then
    raise exception using errcode = '23514', message = 'the bounded rollback attempt limit was reached';
  end if;

  insert into public.rollback_operations (
    organization_id, project_id, incident_id, from_deployment_id, to_deployment_id,
    state, attempt, eligible, blocked_reason, eligibility, requested_by
  )
  values (
    incident_record.organization_id, incident_record.project_id, p_incident_id,
    p_from_deployment_id, p_to_deployment_id,
    case when p_eligible then 'evaluated'::public.rollback_state else 'blocked'::public.rollback_state end,
    next_attempt, p_eligible,
    case when p_eligible then null else coalesce(p_blocked_reason, 'INELIGIBLE') end,
    coalesce(p_eligibility, '{}'::jsonb), auth.uid()
  )
  returning * into rollback_record;

  perform public.record_operations_audit_event(
    incident_record.organization_id, incident_record.project_id,
    case when p_eligible then 'rollback.evaluated'::public.operations_audit_kind
      else 'rollback.blocked'::public.operations_audit_kind end,
    'rollback_operation', rollback_record.id,
    case when p_eligible then 'Rollback evaluated as eligible' else left(coalesce(p_blocked_reason, 'INELIGIBLE'), 500) end,
    pg_catalog.jsonb_build_object('attempt', next_attempt, 'eligible', p_eligible)
  );

  perform public.enqueue_operations_event(
    incident_record.organization_id, incident_record.project_id, 'rollback.started',
    format('rollback:%s:started', rollback_record.id),
    pg_catalog.jsonb_build_object('rollback_id', rollback_record.id, 'eligible', p_eligible)
  );

  return next rollback_record;
end;
$function$;

comment on function public.record_rollback_decision(uuid, boolean, text, jsonb, uuid, uuid) is
  'Owner-only rollback decision record. The incident row is locked before the attempt number is allocated, so concurrent decisions receive successive attempts instead of colliding on the attempt uniqueness index.';

revoke all on function public.open_production_incident(uuid, text, text, public.incident_sev, public.production_signal_kind, text, text, uuid, uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.open_production_incident(uuid, text, text, public.incident_sev, public.production_signal_kind, text, text, uuid, uuid, text, jsonb) to authenticated;

revoke all on function public.record_rollback_decision(uuid, boolean, text, jsonb, uuid, uuid) from public, anon, service_role;
grant execute on function public.record_rollback_decision(uuid, boolean, text, jsonb, uuid, uuid) to authenticated;
