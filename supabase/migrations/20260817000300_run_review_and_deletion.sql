-- The Runs page becomes editable, and a run can be deleted.
--
-- Until now `/solutions/runs` could read a run, cancel it, and retry it. There
-- was no way to record what a person decided about a run, and no way to remove
-- one. Both are added here, and both are shaped by the same question: which
-- parts of a run belong to the factory and which belong to the person reading
-- it?
--
-- **What is not editable, and why.** Provider, model, timings, usage, outputs,
-- artifacts, branch and SHA are evidence of something that happened. Making
-- them editable would not be a feature; it would be a way to make the console
-- state things that are not true, which is the one thing this repository is
-- most careful about. They stay read-only, and the console says so rather than
-- offering a disabled field with no explanation.
--
-- **What is editable.** The human layer on top of the evidence: a triage
-- status and a note. That is the part a person owns, and it was missing
-- entirely — a failed run could be investigated and resolved with no way to
-- record that anywhere near the run.
--
-- **Deletion** is the genuinely destructive one, and it is built to three
-- rules. A run holding a live lease is refused, because deleting the row a
-- worker is still writing to is a race, not a decision. A run whose work
-- produced independent facts — a pull request, a deployment, a test run — is
-- refused by default, because those things exist outside this database and
-- deleting the run would orphan them silently. And the deletion is recorded
-- *before* it happens, in a table with no foreign key back to the run, so the
-- record of the removal outlives the thing removed.

-- ---------------------------------------------------------------------------
-- The human layer
-- ---------------------------------------------------------------------------

-- Written to be re-runnable. The hosted ledger has documented drift — DDL that
-- is live with no history row — so an apply may have to be repeated or run
-- surgically, and a migration that only works once cannot be part of that.
alter table public.agent_runs
  add column if not exists review_status text not null default 'unreviewed',
  add column if not exists review_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

alter table public.agent_runs
  drop constraint if exists agent_runs_review_status_known,
  drop constraint if exists agent_runs_review_note_bounded,
  drop constraint if exists agent_runs_review_is_attributed;

alter table public.agent_runs
  add constraint agent_runs_review_status_known check (
    review_status in ('unreviewed', 'acknowledged', 'investigating', 'resolved', 'ignored')
  ),
  add constraint agent_runs_review_note_bounded check (
    review_note is null or (
      char_length(btrim(review_note)) between 1 and 2000
      and not public.text_has_likely_secret(review_note)
    )
  ),
  -- A review that names nobody and no time is an assertion with no author.
  -- Both are set together by the function below, or neither is set.
  add constraint agent_runs_review_is_attributed check (
    (review_status = 'unreviewed' and review_note is null
      and reviewed_at is null and reviewed_by is null)
    or (reviewed_at is not null)
  );

comment on column public.agent_runs.review_status is
  'What a person decided about this run. The run''s own evidence is not editable; this is the layer that is.';
comment on column public.agent_runs.review_note is
  'A human note on the run, bounded and refused if it looks like it contains a credential.';

create index if not exists agent_runs_review_idx
  on public.agent_runs (organization_id, review_status)
  where review_status <> 'unreviewed';

-- ---------------------------------------------------------------------------
-- An audit row must outlive its subject
-- ---------------------------------------------------------------------------

-- `scheduling_decisions` is append-only: its trigger refuses UPDATE and DELETE.
-- That makes every `on delete` action impossible — `cascade` and `set null`
-- both fire it — so a run with a scheduling decision could never be deleted at
-- all while this key existed.
--
-- Dropping the key is the right answer rather than a workaround. The row
-- records that a scheduler assigned a particular run to a particular worker at
-- a particular moment, and that remains exactly as true after the run is
-- deleted. An audit record that disappears when someone deletes the thing it
-- audits is not an audit record. The column keeps the id it recorded.
alter table public.scheduling_decisions
  drop constraint if exists scheduling_decisions_run_fk;

comment on column public.scheduling_decisions.run_id is
  'The run this decision assigned. Deliberately not a foreign key: this is an append-only audit row and must survive deletion of the run it describes.';

-- ---------------------------------------------------------------------------
-- The one exception to append-only evidence
-- ---------------------------------------------------------------------------

-- `phase1c_run_events`, `_artifacts` and `_validations` refuse every UPDATE and
-- DELETE, which is why a run could not be deleted at all: its evidence rows
-- hold `on delete restrict` keys back to it, and the trigger refused to let
-- them go.
--
-- Rather than weaken the rule, the rule gains one narrow, announced exception.
-- `delete_agent_run` publishes the exact run it is removing in a
-- transaction-local setting, and only a DELETE of evidence belonging to *that*
-- run is allowed through. Every UPDATE is still refused unconditionally — the
-- point of append-only is that history is not rewritten, and deleting a run
-- outright under owner authority, with the deletion recorded first, is not
-- rewriting it.
--
-- This cannot be reached by a caller who could not already do it: `authenticated`
-- holds no DELETE on any of the three tables, so the only way to reach the
-- trigger at all is through a SECURITY DEFINER function, and `delete_agent_run`
-- is the only one that deletes evidence.
create or replace function public.reject_phase1c_evidence_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $function$
begin
  if tg_op = 'DELETE'
    and nullif(current_setting('softwarefactory.deleting_run_id', true), '') = old.run_id::text
  then
    return old;
  end if;
  raise exception using errcode = '55000',
    message = 'Phase 1C execution evidence is append-only';
end;
$function$;

revoke all on function public.reject_phase1c_evidence_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Editing a run's review
-- ---------------------------------------------------------------------------

create or replace function public.update_agent_run_review(
  p_organization_id uuid,
  p_run_id uuid,
  p_review_status text,
  p_review_note text default null
)
returns table (
  run_id uuid,
  review_status text,
  review_note text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  trimmed_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  previous_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role, 'admin'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if p_review_status is null or p_review_status not in (
    'unreviewed', 'acknowledged', 'investigating', 'resolved', 'ignored'
  ) then
    raise exception using errcode = '22023', message = 'unknown review status';
  end if;
  -- Checked here as well as by the column constraint so the caller gets a
  -- named refusal rather than a constraint violation it has to interpret.
  if trimmed_note is not null and public.text_has_likely_secret(trimmed_note) then
    raise exception using errcode = '22023',
      message = 'a review note cannot contain a credential';
  end if;
  if trimmed_note is not null and char_length(trimmed_note) > 2000 then
    raise exception using errcode = '22023',
      message = 'a review note is limited to 2000 characters';
  end if;

  select * into run_record from public.agent_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;

  previous_status := run_record.review_status;

  update public.agent_runs run
  set review_status = p_review_status,
    -- Clearing the status back to unreviewed clears the note with it, so a
    -- stale note cannot outlive the finding it described.
    review_note = case when p_review_status = 'unreviewed' then null else trimmed_note end,
    reviewed_at = case when p_review_status = 'unreviewed' then null else now() end,
    reviewed_by = case when p_review_status = 'unreviewed' then null else auth.uid() end,
    updated_at = now()
  where run.id = p_run_id
  returning run.* into run_record;

  perform public.record_activity_event(
    run_record.organization_id, run_record.project_id,
    'run.review_updated'::public.activity_event_type,
    'agent_run', run_record.id,
    'Run review set to ' || p_review_status,
    jsonb_build_object('from', previous_status, 'to', p_review_status,
      'hasNote', trimmed_note is not null)
  );

  return query select run_record.id, run_record.review_status,
    run_record.review_note, run_record.reviewed_at;
end;
$function$;

comment on function public.update_agent_run_review(uuid, uuid, text, text) is
  'Owner/admin edit of the human layer on a run: triage status and note. The run''s own execution evidence is never editable.';

-- ---------------------------------------------------------------------------
-- Deleting a run
-- ---------------------------------------------------------------------------

create or replace function public.delete_agent_run(
  p_organization_id uuid,
  p_run_id uuid,
  p_reason text,
  -- Default OFF. With it off, a run whose work produced a pull request, a
  -- deployment or a test run is refused. With it on, the owner has said
  -- explicitly that those records should be kept and unlinked rather than the
  -- deletion being abandoned. Nothing outside this database is ever touched:
  -- a real pull request on GitHub is unaffected either way.
  p_detach_evidence boolean default false
)
returns table (
  deleted_run_id uuid,
  detached_pull_requests integer,
  detached_deployments integer,
  detached_test_runs integer,
  deleted_events integer,
  deleted_artifacts integer,
  deleted_validations integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  bound_pull_requests integer;
  bound_deployments integer;
  bound_test_runs integer;
  removed_events integer := 0;
  removed_artifacts integer := 0;
  removed_validations integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  -- Deleting execution evidence is the most destructive thing this console can
  -- do, so it is owner-only rather than owner-or-admin like the edit above.
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may delete a run';
  end if;
  if trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'a reason is required to delete a run';
  end if;
  if char_length(trimmed_reason) > 400 or public.text_has_likely_secret(trimmed_reason) then
    raise exception using errcode = '22023',
      message = 'the deletion reason is too long or contains a credential';
  end if;

  select * into run_record from public.agent_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;

  -- A worker still holding this lease is mid-write. Deleting the row underneath
  -- it is a race with a live process, not a decision about a finished record.
  if run_record.status = 'running'::public.run_status
    and run_record.lease_expires_at is not null
    and run_record.lease_expires_at > now() then
    raise exception using errcode = '55000',
      message = 'this run holds a live worker lease; cancel it and let the lease end first';
  end if;
  if run_record.status = 'queued'::public.run_status then
    raise exception using errcode = '55000',
      message = 'this run is queued for execution; cancel it before deleting it';
  end if;

  select count(*) into bound_pull_requests from public.pull_requests pull
    where pull.agent_run_id = p_run_id;
  select count(*) into bound_deployments from public.deployments deployment
    where deployment.agent_run_id = p_run_id;
  select count(*) into bound_test_runs from public.test_runs test_run
    where test_run.agent_run_id = p_run_id;

  if not p_detach_evidence
    and bound_pull_requests + bound_deployments + bound_test_runs > 0 then
    raise exception using errcode = '23503', message = format(
      'this run produced records that exist outside it (%s pull request(s), %s deployment(s), %s test run(s)); delete it with detachment to keep them and unlink them',
      bound_pull_requests, bound_deployments, bound_test_runs
    );
  end if;

  -- Recorded before anything is removed, and in a table with no foreign key
  -- back to the run, so the account of the deletion survives it. If any step
  -- below fails the whole statement rolls back, including this row — the audit
  -- never claims a deletion that did not happen.
  perform public.record_activity_event(
    run_record.organization_id, run_record.project_id,
    'run.deleted'::public.activity_event_type,
    'agent_run', run_record.id,
    'Run deleted by the organization owner',
    jsonb_build_object(
      'reason', trimmed_reason,
      'runStatus', run_record.status::text,
      'provider', run_record.provider,
      'model', run_record.model,
      'attempt', run_record.attempt_number,
      'detachedPullRequests', bound_pull_requests,
      'detachedDeployments', bound_deployments,
      'detachedTestRuns', bound_test_runs,
      'createdAt', run_record.created_at,
      'completedAt', run_record.completed_at
    )
  );

  if p_detach_evidence then
    update public.pull_requests set agent_run_id = null, updated_at = now()
      where agent_run_id = p_run_id;
    update public.deployments set agent_run_id = null, updated_at = now()
      where agent_run_id = p_run_id;
    update public.test_runs set agent_run_id = null
      where agent_run_id = p_run_id;
  end if;

  -- These three are the run's own account of itself. They describe nothing
  -- that exists without it, so they go with it rather than being orphaned.
  -- Announced to the append-only trigger by exact run id, and withdrawn
  -- immediately afterwards so the exception cannot outlive these three
  -- statements even within the same transaction.
  perform set_config('softwarefactory.deleting_run_id', p_run_id::text, true);
  delete from public.phase1c_run_validations where run_id = p_run_id;
  get diagnostics removed_validations = row_count;
  delete from public.phase1c_run_artifacts where run_id = p_run_id;
  get diagnostics removed_artifacts = row_count;
  delete from public.phase1c_run_events where run_id = p_run_id;
  get diagnostics removed_events = row_count;
  perform set_config('softwarefactory.deleting_run_id', '', true);

  delete from public.agent_runs where id = p_run_id;

  return query select p_run_id, bound_pull_requests, bound_deployments,
    bound_test_runs, removed_events, removed_artifacts, removed_validations;
end;
$function$;

comment on function public.delete_agent_run(uuid, uuid, text, boolean) is
  'Owner-only deletion of a run and its own evidence. Refuses a live lease or a queued run, refuses by default when independent records are bound, and records the deletion before performing it.';

-- ---------------------------------------------------------------------------
-- Show the review on the run detail
-- ---------------------------------------------------------------------------

-- Rebuilt from `20260813001500` with four keys added and nothing else changed,
-- so the console can render and edit the review without a second round trip.
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
    'ci', jsonb_build_object('checks', run.checks),
    -- The human layer, so the console can render and edit it without a second
    -- round trip, and `deletable` so the delete control is shown to the person
    -- who can actually use it rather than offered to everyone and then refused.
    'reviewStatus', run.review_status,
    'reviewNote', run.review_note,
    'reviewedAt', run.reviewed_at,
    'deletable', public.is_organization_owner(p_organization_id)
      and run.status <> 'queued'::public.run_status
      and not (
        run.status = 'running'::public.run_status
        and run.lease_expires_at is not null
        and run.lease_expires_at > now()
      )
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

revoke all on function public.update_agent_run_review(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_agent_run(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.update_agent_run_review(uuid, uuid, text, text) to authenticated;
grant execute on function public.delete_agent_run(uuid, uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Show the review in the list, not only on the detail
-- ---------------------------------------------------------------------------

-- A triage state that is only visible after opening a run is a triage state
-- nobody uses: the question a person actually has on this page is "which of
-- these has anyone looked at", and answering it by opening fifty runs is not
-- answering it.
--
-- The return type gains a column, so this is a drop and recreate rather than a
-- replace. Everything else about the projection is unchanged. IF EXISTS,
-- because 20260817001000 later supersedes this signature entirely: on a
-- surgical re-run the old function is already gone, and the recreate below
-- is itself dropped again by 001000 later in the same sequence.
drop function if exists public.list_agent_runs(uuid, integer);
create function public.list_agent_runs(
  p_organization_id uuid, p_limit integer default 50
)
returns table (
  id uuid, status public.run_status, started_at timestamptz,
  completed_at timestamptz, created_at timestamptz,
  task_id uuid, task_title text, agent_id uuid, agent_name text,
  project_id uuid, project_name text, risk_level public.risk_level,
  provider text, model text, branch_name text, review_status text
)
language sql stable security definer set search_path = pg_catalog as $function$
  select run.id, run.status, run.started_at, run.completed_at, run.created_at,
    task.id, task.title, agent.id, agent.name, project.id, project.name,
    run.risk_level, run.provider, run.model, run.head_branch, run.review_status
  from public.agent_runs run
  left join public.tasks task
    on task.id = run.task_id and task.organization_id = run.organization_id
  left join public.agents agent
    on agent.id = run.agent_id and agent.organization_id = run.organization_id
  left join public.projects project
    on project.id = run.project_id and project.organization_id = run.organization_id
  where run.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by run.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

revoke all on function public.list_agent_runs(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_agent_runs(uuid, integer) to authenticated;
