-- Detector findings become ledger proposals: the last build in Phase 3's
-- ordered plan (automated intake).
--
-- `detect_factory_improvements` names what should change;
-- `record_improvement_proposal` refuses anything without a baseline. This
-- function is the pipe between them, and it deliberately automates *only the
-- paperwork*:
--
--   - Every proposal it records is machine-authored but owner-decided: the
--     decision entry stays a separate, human call. Nothing here accepts,
--     implements, or evaluates anything.
--   - The prediction is formulaic on purpose, and falsifiable because it
--     names the finding's own metric ("the occurrence count stops rising",
--     "the standing count reaches zero"). A machine that invented richer
--     predictions would be predicting its own imagination.
--   - The baseline is captured at proposal time by the same
--     `capture_improvement_baseline` the manual path uses, with the finding's
--     evidence attached, so the before-picture is real telemetry plus the
--     exact signal that triggered the proposal.
--   - A finding already proposed and still undecided (or accepted) is
--     skipped, not re-proposed — re-proposing the same subject every run
--     would flood the ledger with duplicates of an open question.
--
-- The constitution's zero-token rule holds by construction: everything here
-- is deterministic SQL over stored telemetry. No model call decides what to
-- propose.

create or replace function public.propose_improvements_from_detections(
  p_project_id uuid default null
)
returns table (proposal_id uuid, detector text, subject text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  detection jsonb;
  baseline jsonb;
  finding jsonb;
  finding_title text;
  finding_prediction text;
  created_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  -- Ownership, tenancy and the generic not-found are enforced by the two
  -- functions this one composes; a non-owner fails at the first call below.
  detection := public.detect_factory_improvements(p_project_id);
  baseline := public.capture_improvement_baseline(p_project_id);

  for finding in select * from jsonb_array_elements(detection -> 'findings')
  loop
    -- One open proposal per detector/subject pair. "Open" means proposed and
    -- not yet rejected — a rejected proposal may honestly be re-raised later
    -- if the signal persists, but an undecided or accepted one may not be
    -- duplicated.
    if exists (
      select 1
      from public.improvement_ledger proposal
      where proposal.entry_type = 'proposal'
        and proposal.title = left('Detected: ' || (finding ->> 'detector') || ' — ' || (finding ->> 'subject'), 200)
        and not exists (
          select 1 from public.improvement_ledger decision
          where decision.proposal_id = proposal.proposal_id
            and decision.entry_type = 'decision'
            and decision.decision = 'rejected'
        )
    ) then
      continue;
    end if;

    finding_title := left('Detected: ' || (finding ->> 'detector') || ' — ' || (finding ->> 'subject'), 200);
    finding_prediction := case finding ->> 'detector'
      when 'recurring_failure' then
        'The fingerprint''s occurrence count stops rising for a full fourteen-day window.'
      when 'flaky_tests' then
        'The named test kind records a window with terminal runs and zero failures.'
      when 'unnecessary_ai_node' then
        'The node is executed deterministically, and the model-call count for it drops to zero.'
      when 'provider_underperformance' then
        'The named provider/model pair''s failure share drops below half in the next measured window.'
      else
        'The named standing count returns to zero and stays there for a window.'
    end;

    created_id := public.record_improvement_proposal(
      p_project_id,
      finding_title,
      left((finding ->> 'recommendation') || ' Evidence at detection: '
        || (finding -> 'evidence')::text, 4000),
      finding_prediction,
      baseline || jsonb_build_object('detection', finding),
      jsonb_build_array(finding_prediction),
      'factory-constitution-v1'
    );

    return query select created_id, finding ->> 'detector', finding ->> 'subject';
  end loop;
end;
$function$;

revoke all on function public.propose_improvements_from_detections(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.propose_improvements_from_detections(uuid) to authenticated;
