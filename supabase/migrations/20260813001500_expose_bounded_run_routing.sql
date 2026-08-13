-- Phase 1C/2A: expose bounded, tenant-scoped routing evidence with run detail.
--
-- This forward-only projection change does not authorize provider execution,
-- change a routing decision, or grant direct table access.  Command-backed
-- Phase 1C runs report the fixed server policy without manufacturing candidate
-- scores.  Phase 2A runs project only an allowlisted subset of their immutable
-- routing decision.

-- Phase 2A's catalogue and HTTP contract accept model identifiers up to 128
-- characters.  Migration 130007 inadvertently narrowed the assignment and run
-- storage checks to 120.  Restore the original bound without changing the
-- provider/model character policy or any authorization boundary.
alter table public.provider_agent_assignments
  drop constraint provider_agent_assignments_model_check;
alter table public.provider_agent_assignments
  add constraint provider_agent_assignments_model_check check (
    model is null or (
      char_length(btrim(model)) between 1 and 128
      and model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  );

alter table public.agent_runs
  drop constraint agent_runs_model_check;
alter table public.agent_runs
  add constraint agent_runs_model_check check (
    model is null or char_length(btrim(model)) between 1 and 128
  );

-- Catalogue identifiers and labels are browser-readable tenant metadata, not
-- a credential store. Close the legacy RPC/table gap that validated capability
-- JSON but allowed a credential-shaped string in model or display_name.
alter table public.provider_model_configurations
  add constraint provider_model_configurations_text_not_secret check (
    not public.text_has_likely_secret(model)
    and not public.text_has_likely_secret(display_name)
  );

alter table public.provider_routing_decisions
  add constraint provider_routing_decisions_policy_version_not_secret check (
    not public.text_has_likely_secret(policy_version)
  );

alter table public.provider_agent_assignments
  add constraint provider_agent_assignments_model_not_secret check (
    model is null or not public.text_has_likely_secret(model)
  );

alter table public.provider_routing_decisions
  add constraint provider_routing_decisions_selected_model_not_secret check (
    selected_model is null or not public.text_has_likely_secret(selected_model)
  );

create or replace function public.get_agent_run_detail(
  p_organization_id uuid, p_run_id uuid
)
returns table (detail jsonb)
language sql stable security definer set search_path = pg_catalog as $function$
  select jsonb_build_object(
    'id', run.id, 'status', run.status,
    'project', jsonb_build_object('id', project.id, 'name', project.name),
    'task', jsonb_build_object('id', task.id, 'title', task.title),
    'command', case when command.id is null then null else jsonb_build_object(
      'id', command.id, 'prompt', command.prompt
    ) end,
    'agent', jsonb_build_object('id', agent.id, 'name', agent.name, 'role', agent.role),
    'provider', run.provider, 'model', run.model, 'risk', run.risk_level,
    'routing', case
      when command.id is not null then jsonb_build_object(
        'source', 'PHASE1C_FIXED_POLICY',
        'policyVersion', 'phase1c-fixed-policy-v1',
        'reasons', jsonb_build_array(
          jsonb_build_object(
            'code', 'PHASE1C_FIXED_PROVIDER_MODEL',
            'provider', run.provider,
            'detail', format(
              'Phase 1C server policy fixed this run to %s / %s.',
              run.provider, run.model
            )
          ),
          jsonb_build_object(
            'code', 'LOGICAL_AGENT_ROLE_BOUND',
            'provider', null,
            'detail', format(
              'Logical agent role %s was bound separately from provider identity.',
              coalesce(run.logical_agent_role::text, agent.role::text)
            )
          )
        ),
        'candidates', '[]'::jsonb
      )
      when routing.id is not null then jsonb_build_object(
        'source', case when routing.source in (
          'OWNER_OVERRIDE', 'AGENT_ASSIGNMENT', 'PROJECT_DEFAULT', 'AUTO_SCORE', 'FALLBACK'
        ) then routing.source else null end,
        'policyVersion', case
          when routing.policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            and not public.text_has_likely_secret(routing.policy_version)
          then routing.policy_version
          else 'redacted'
        end,
        'reasons', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', reason.value ->> 'code',
            'provider', case when reason.value ->> 'provider' in ('openai', 'anthropic')
              then reason.value ->> 'provider' else null end,
            'detail', case
              when jsonb_typeof(reason.value -> 'detail') = 'string'
                and char_length(btrim(reason.value ->> 'detail')) between 1 and 500
                and not public.text_has_likely_secret(reason.value ->> 'detail')
              then left(reason.value ->> 'detail', 500)
              else 'Routing evidence detail was omitted by the bounded projection.'
            end
          ) order by reason.ordinality)
          from jsonb_array_elements(routing.reasons) with ordinality reason(value, ordinality)
          where reason.ordinality <= 20
            and jsonb_typeof(reason.value) = 'object'
            and reason.value ->> 'code' in (
              'OWNER_OVERRIDE_APPLIED', 'AGENT_ASSIGNMENT_APPLIED',
              'PROJECT_DEFAULT_APPLIED', 'AUTO_SCORE_SELECTED',
              'OVERRIDE_TARGET_UNAVAILABLE', 'ASSIGNMENT_TARGET_UNAVAILABLE',
              'PROJECT_DEFAULT_UNAVAILABLE', 'PROVIDER_NOT_CONNECTED',
              'PROVIDER_NOT_ALLOWED_BY_POLICY', 'CAPABILITY_NOT_DECLARED',
              'MODEL_NOT_AVAILABLE', 'EXCLUDED_BY_FALLBACK',
              'NO_ELIGIBLE_PROVIDER', 'RISK_ABOVE_PROJECT_CEILING',
              'FALLBACK_APPLIED', 'FALLBACK_NOT_PERMITTED_BY_POLICY',
              'FALLBACK_NOT_ELIGIBLE_FOR_ERROR'
            )
        ), '[]'::jsonb),
        'candidates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'provider', candidate.value ->> 'provider',
            'model', case
              when jsonb_typeof(candidate.value -> 'model') = 'string'
                and char_length(btrim(candidate.value ->> 'model')) between 1 and 128
                and not public.text_has_likely_secret(candidate.value ->> 'model')
              then left(candidate.value ->> 'model', 128)
              else null
            end,
            'eligible', (candidate.value ->> 'eligible')::boolean,
            'score', case
              when jsonb_typeof(candidate.value -> 'score') = 'number'
                and (candidate.value ->> 'score')::numeric between 0 and 1
              then (candidate.value ->> 'score')::numeric
              else null
            end,
            'ineligibleReasons', case
              when jsonb_typeof(candidate.value -> 'ineligibleReasons') = 'array'
              then coalesce((
                select jsonb_agg(ineligible.value #>> '{}' order by ineligible.ordinality)
                from jsonb_array_elements(candidate.value -> 'ineligibleReasons')
                  with ordinality ineligible(value, ordinality)
                where ineligible.ordinality <= 10
                  and jsonb_typeof(ineligible.value) = 'string'
                  and ineligible.value #>> '{}' in (
                    'EXCLUDED_BY_FALLBACK', 'PROVIDER_NOT_ALLOWED_BY_POLICY',
                    'PROVIDER_NOT_CONNECTED', 'CAPABILITY_NOT_DECLARED',
                    'MODEL_NOT_AVAILABLE'
                  )
              ), '[]'::jsonb)
              else '[]'::jsonb
            end
          ) order by candidate.ordinality)
          from jsonb_array_elements(routing.candidates)
            with ordinality candidate(value, ordinality)
          where candidate.ordinality <= 10
            and jsonb_typeof(candidate.value) = 'object'
            and candidate.value ->> 'provider' in ('openai', 'anthropic')
            and jsonb_typeof(candidate.value -> 'eligible') = 'boolean'
        ), '[]'::jsonb)
      )
      else null
    end,
    'providerRunReference', run.provider_run_reference,
    'baseBranch', run.base_branch, 'baseSha', run.base_sha,
    'headBranch', run.head_branch, 'headSha', run.head_sha,
    'attempt', run.attempt_number, 'maxAttempts', run.max_attempts,
    'startedAt', run.started_at, 'completedAt', run.completed_at,
    'createdAt', run.created_at,
    'durationMs', case when run.started_at is null then null
      else floor(extract(epoch from (coalesce(run.completed_at, now()) - run.started_at)) * 1000)::bigint end,
    'cancellationRequestedAt', run.cancellation_requested_at,
    'cancellable', run.status in ('queued'::public.run_status,'running'::public.run_status)
      and run.cancellation_requested_at is null,
    'retryable', run.status = 'failed'::public.run_status and run.retryable
      and run.attempt_number < run.max_attempts,
    'summary', run.result_summary, 'blocker', task.blocked_reason,
    'errorMessage', left(run.error_message, 1000),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id, 'stage', event.event_type, 'message', event.message,
      'details', event.details, 'occurredAt', event.occurred_at
    ) order by event.occurred_at asc) from (
      select source.* from public.phase1c_run_events source
      where source.run_id = run.id order by source.occurred_at desc limit 200
    ) event), '[]'::jsonb),
    'changedFiles', run.changed_files,
    'files', coalesce((select jsonb_agg(jsonb_build_object(
      'path', artifact.reference, 'status', artifact.metadata ->> 'status',
      'additions', artifact.metadata ->> 'additions', 'deletions', artifact.metadata ->> 'deletions'
    ) order by artifact.created_at asc) from (
      select source.* from public.phase1c_run_artifacts source
      where source.run_id = run.id and source.artifact_type = 'file'
      order by source.created_at desc limit 200
    ) artifact), '[]'::jsonb),
    'commits', coalesce((select jsonb_agg(jsonb_build_object(
      'sha', artifact.reference, 'message', artifact.metadata ->> 'message',
      'url', artifact.metadata ->> 'url'
    ) order by artifact.created_at asc) from (
      select source.* from public.phase1c_run_artifacts source
      where source.run_id = run.id and source.artifact_type = 'commit'
      order by source.created_at desc limit 100
    ) artifact), '[]'::jsonb),
    'validations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', validation.id, 'name', validation.name, 'command', validation.command,
      'status', validation.status, 'summary', validation.output_summary,
      'round', validation.validation_round,
      'durationMs', validation.duration_ms, 'createdAt', validation.created_at
    ) order by validation.created_at asc) from (
      select source.* from public.phase1c_run_validations source
      where source.run_id = run.id order by source.created_at desc limit 200
    ) validation), '[]'::jsonb),
    'pullRequest', (select jsonb_build_object(
      'number', pull.external_number, 'title', pull.title, 'state', pull.status,
      'draft', pull.status = 'draft'::public.pull_request_status, 'url', pull.url
    ) from public.pull_requests pull where pull.agent_run_id = run.id
      order by pull.created_at desc limit 1),
    'checks', run.checks,
    'ci', jsonb_build_object('checks', run.checks)
  )
  from public.agent_runs run
  join public.projects project
    on project.id = run.project_id and project.organization_id = run.organization_id
  join public.tasks task
    on task.id = run.task_id and task.organization_id = run.organization_id
  left join public.commands command
    on command.id = run.command_id and command.organization_id = run.organization_id
  join public.agents agent
    on agent.id = run.agent_id and agent.organization_id = run.organization_id
  left join public.provider_routing_decisions routing
    on routing.id = run.routing_decision_id
    and routing.organization_id = run.organization_id
    and routing.project_id = run.project_id
    and routing.task_id is not distinct from run.task_id
    and routing.agent_id is not distinct from run.agent_id
  where run.id = p_run_id and run.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id);
$function$;

revoke all on function public.get_agent_run_detail(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_agent_run_detail(uuid, uuid) to authenticated;

-- The bounded detail RPC above is the only browser boundary for immutable
-- routing reasons and candidates; raw provider-run event messages remain
-- server-only. Keep the model catalogue's tenant-scoped authenticated SELECT
-- used by provider settings, but close the older raw routing/event grants from
-- migration 130010 so unbounded JSON cannot bypass this projection.
revoke all on table public.provider_routing_decisions from authenticated;
revoke all on table public.provider_run_events from authenticated;
