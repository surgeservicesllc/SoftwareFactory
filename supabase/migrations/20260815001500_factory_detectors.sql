-- The detectors: Phase 3 goals 12, 13, 17, 19 and 21.
--
-- Each detector mines one telemetry stream for a specific, named signal and
-- follows the optimizer's evidence-threshold discipline: below its stated
-- sample floor it *abstains by name* rather than reporting on noise, and a
-- finding always carries the evidence that produced it. A detection is a
-- proposal candidate — it feeds `record_improvement_proposal`, whose baseline
-- rule then forces the "before" picture to be captured before anything
-- changes. Detection never mutates anything.
--
-- The five signals, each grounded in what the schema can actually prove:
--
--   recurring_failure          incidents whose fingerprint keeps coming back
--                              (the dedupe counter is the evidence).
--   flaky_tests                a test kind that both passed and failed in the
--                              same window — same input, different outcome.
--   unnecessary_ai_node        a model-executed graph node that completes in
--                              under a second, repeatedly: behaviour that
--                              looks like a lookup, priced like a model call.
--                              The finding names a *candidate* for a
--                              deterministic rewrite, not a verdict.
--   provider_underperformance  a provider/model pair failing at least half
--                              of a meaningful sample of terminal runs.
--   tech_debt                  inventory facts, not statistics: legacy
--                              unlabelled connection mappings, commands stuck
--                              in submitted for a week, improvements accepted
--                              a week ago and never implemented. Zero is a
--                              real answer here, so these never abstain.

create or replace function public.detect_factory_improvements(
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
  findings jsonb := '[]'::jsonb;
  abstentions jsonb := '[]'::jsonb;
  finding record;
  sample integer;
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
        message = 'an organization membership is required to run the detectors';
    end if;
  end if;

  -- recurring_failure: at least three occurrences of one fingerprint.
  select count(*) into sample
  from public.incidents incident
  where incident.organization_id = organization_record
    and (p_project_id is null or incident.project_id = p_project_id)
    and incident.fingerprint is not null;
  if sample = 0 then
    abstentions := abstentions || jsonb_build_array(jsonb_build_object(
      'detector', 'recurring_failure',
      'reason', 'no fingerprinted incident exists to mine for recurrence'));
  else
    for finding in
      select incident.fingerprint, max(incident.occurrence_count) as occurrences,
        max(incident.severity::text) as severity
      from public.incidents incident
      where incident.organization_id = organization_record
        and (p_project_id is null or incident.project_id = p_project_id)
        and incident.fingerprint is not null
      group by incident.fingerprint
      having max(incident.occurrence_count) >= 3
    loop
      findings := findings || jsonb_build_array(jsonb_build_object(
        'detector', 'recurring_failure',
        'subject', finding.fingerprint,
        'evidence', jsonb_build_object(
          'occurrences', finding.occurrences, 'severity', finding.severity),
        'recommendation',
          'This failure keeps coming back under one fingerprint; propose a root-cause fix with the incident history as baseline.'));
    end loop;
  end if;

  -- flaky_tests: one kind, both outcomes, at least four terminal runs.
  for finding in
    select test.kind::text as kind,
      count(*) filter (where test.status = 'passed'::public.test_run_status) as passed,
      count(*) filter (where test.status = 'failed'::public.test_run_status) as failed,
      count(*) as terminal
    from public.test_runs test
    where test.organization_id = organization_record
      and (p_project_id is null or test.project_id = p_project_id)
      and test.created_at >= window_start
      and test.status in ('passed'::public.test_run_status, 'failed'::public.test_run_status)
    group by test.kind
  loop
    if finding.terminal < 4 then
      abstentions := abstentions || jsonb_build_array(jsonb_build_object(
        'detector', 'flaky_tests',
        'reason', format('only %s terminal %s runs in the window; four are needed before flakiness is a claim',
          finding.terminal, finding.kind)));
    elsif finding.passed > 0 and finding.failed > 0 then
      findings := findings || jsonb_build_array(jsonb_build_object(
        'detector', 'flaky_tests',
        'subject', finding.kind,
        'evidence', jsonb_build_object(
          'passed', finding.passed, 'failed', finding.failed, 'terminal', finding.terminal),
        'recommendation',
          'The same suite kind both passed and failed in one window; propose stabilising it with the pass/fail split as baseline.'));
    end if;
  end loop;
  if not exists (
    select 1 from public.test_runs test
    where test.organization_id = organization_record
      and (p_project_id is null or test.project_id = p_project_id)
      and test.created_at >= window_start
      and test.status in ('passed'::public.test_run_status, 'failed'::public.test_run_status)
  ) then
    abstentions := abstentions || jsonb_build_array(jsonb_build_object(
      'detector', 'flaky_tests',
      'reason', 'no terminal test run exists in the window'));
  end if;

  -- unnecessary_ai_node: model-executed, repeatedly sub-second.
  select count(*) into sample
  from public.node_runs node_run
  where node_run.organization_id = organization_record
    and node_run.provider is not null
    and node_run.state = 'COMPLETED'::public.graph_node_state
    and node_run.created_at >= window_start;
  if sample = 0 then
    abstentions := abstentions || jsonb_build_array(jsonb_build_object(
      'detector', 'unnecessary_ai_node',
      'reason', 'no model-executed graph node has completed in the window'));
  else
    for finding in
      select node_run.node_id, count(*) as completions,
        max(node_run.latency_ms) as slowest_ms
      from public.node_runs node_run
      where node_run.organization_id = organization_record
        and node_run.provider is not null
        and node_run.state = 'COMPLETED'::public.graph_node_state
        and node_run.created_at >= window_start
        and node_run.latency_ms is not null
      group by node_run.node_id
      having count(*) >= 3 and max(node_run.latency_ms) < 1000
    loop
      findings := findings || jsonb_build_array(jsonb_build_object(
        'detector', 'unnecessary_ai_node',
        'subject', finding.node_id::text,
        'evidence', jsonb_build_object(
          'completions', finding.completions, 'slowestMs', finding.slowest_ms),
        'recommendation',
          'This node behaves like a lookup and is priced like a model call; propose a deterministic rewrite as a candidate, with its run history as baseline.'));
    end loop;
  end if;

  -- provider_underperformance: at least five terminal runs, at least half failing.
  select count(*) into sample
  from public.agent_runs run
  where run.organization_id = organization_record
    and (p_project_id is null or run.project_id = p_project_id)
    and run.created_at >= window_start
    and run.status in ('succeeded'::public.run_status, 'failed'::public.run_status);
  if sample < 5 then
    abstentions := abstentions || jsonb_build_array(jsonb_build_object(
      'detector', 'provider_underperformance',
      'reason', format('only %s terminal runs in the window; five are needed before a provider claim', sample)));
  else
    for finding in
      select run.provider, run.model,
        count(*) filter (where run.status = 'failed'::public.run_status) as failed,
        count(*) as terminal
      from public.agent_runs run
      where run.organization_id = organization_record
        and (p_project_id is null or run.project_id = p_project_id)
        and run.created_at >= window_start
        and run.status in ('succeeded'::public.run_status, 'failed'::public.run_status)
      group by run.provider, run.model
      having count(*) >= 5
        and count(*) filter (where run.status = 'failed'::public.run_status) * 2 >= count(*)
    loop
      findings := findings || jsonb_build_array(jsonb_build_object(
        'detector', 'provider_underperformance',
        'subject', finding.provider || '/' || finding.model,
        'evidence', jsonb_build_object('failed', finding.failed, 'terminal', finding.terminal),
        'recommendation',
          'This provider/model pair fails at least half its runs; propose a routing or configuration change with the failure rate as baseline.'));
    end loop;
  end if;

  -- tech_debt: inventory facts. Zero is a real answer; these never abstain.
  for finding in
    select 'legacy_unlabelled_mappings' as item, count(*) as total
    from public.project_connections mapping
    where mapping.organization_id = organization_record
      and (p_project_id is null or mapping.project_id = p_project_id)
      and mapping.capability is null
    union all
    select 'commands_stuck_submitted', count(*)
    from public.commands command
    where command.organization_id = organization_record
      and (p_project_id is null or command.project_id = p_project_id)
      and command.status = 'submitted'::public.command_status
      and command.created_at < now() - interval '7 days'
    union all
    select 'improvements_accepted_unimplemented', count(*)
    from public.improvement_ledger decision_entry
    where decision_entry.organization_id = organization_record
      and decision_entry.entry_type = 'decision'
      and decision_entry.decision = 'accepted'
      and decision_entry.created_at < now() - interval '7 days'
      and not exists (
        select 1 from public.improvement_ledger implementation_entry
        where implementation_entry.proposal_id = decision_entry.proposal_id
          and implementation_entry.entry_type = 'implementation')
  loop
    if finding.total > 0 then
      findings := findings || jsonb_build_array(jsonb_build_object(
        'detector', 'tech_debt',
        'subject', finding.item,
        'evidence', jsonb_build_object('count', finding.total),
        'recommendation',
          'A standing inventory item is non-zero; propose clearing it with the count as baseline.'));
    end if;
  end loop;

  return jsonb_build_object(
    'policyVersion', 'factory-detectors-v1',
    'window', jsonb_build_object('days', 14, 'generatedAt', now()),
    'findings', findings,
    'abstentions', abstentions
  );
end;
$function$;

revoke all on function public.detect_factory_improvements(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.detect_factory_improvements(uuid) to authenticated;
