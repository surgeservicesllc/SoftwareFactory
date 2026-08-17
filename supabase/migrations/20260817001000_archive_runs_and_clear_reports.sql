-- Archiving a run, and the end of a report's life.
--
-- Two surfaces, and the same question asked of each: what is the *reversible*
-- way to make something stop appearing, and what is the destructive one?
--
-- **Runs.** `delete_agent_run` (20260817000300) is the destructive answer, and
-- it is deliberately hard to reach: owner-only, reason required, live leases
-- refused, external evidence kept unless detachment is explicit. What was
-- missing is the other half. A finished run someone has dealt with should be
-- able to leave the list without its evidence being destroyed, and until now
-- the only way to clear the page was to delete.
--
-- Archiving is therefore a separate column rather than a reuse of
-- `review_status`. Those answer different questions — "what did a person decide
-- about this run" versus "should it still be in the list" — and a run can
-- reasonably be `resolved` *and* archived. Folding them together would mean
-- archiving a run silently rewrote its triage.
--
-- **Reports.** `report_status` has had `archived` since the control-plane
-- schema; nothing ever set it. So archiving a report is a status change, not a
-- new column. Deletion is genuinely available here in a way it is not for
-- projects or evidence tables: nothing references `reports`, so a deleted
-- report orphans nothing. The audit event is still written first, in a table
-- with no key back to the report, so the record of the removal survives it.

-- ---------------------------------------------------------------------------
-- Archiving a run
-- ---------------------------------------------------------------------------

alter table public.agent_runs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

comment on column public.agent_runs.archived_at is
  'When this run was taken out of the default list. Separate from review_status on purpose: a run can be resolved and archived, and archiving must not rewrite what a person decided about it.';

create index if not exists agent_runs_archived_idx
  on public.agent_runs (organization_id, archived_at)
  where archived_at is not null;

create or replace function public.set_agent_run_archived(
  p_organization_id uuid,
  p_run_id uuid,
  p_archived boolean,
  p_reason text default null
)
returns table (run_id uuid, archived_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_record public.agent_runs%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  -- Owner or administrator, not owner-only: archiving destroys nothing and is
  -- reversible by anyone who can do it, so it does not need the bar deletion
  -- has.
  if not public.has_organization_role(
    p_organization_id,
    array['owner'::public.organization_member_role, 'admin'::public.organization_member_role]
  ) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if trimmed_reason is not null and (
    char_length(trimmed_reason) > 400 or public.text_has_likely_secret(trimmed_reason)
  ) then
    raise exception using errcode = '22023',
      message = 'the reason is too long or contains a credential';
  end if;

  select * into run_record from public.agent_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'run not found';
  end if;

  -- Work still in flight is not finished with, and hiding it would hide the
  -- thing most worth watching. Cancel it first if it should stop.
  if p_archived and run_record.status in (
    'queued'::public.run_status, 'running'::public.run_status
  ) then
    raise exception using errcode = '55000',
      message = 'this run has not finished; cancel it before archiving it';
  end if;

  update public.agent_runs run
  set archived_at = case when p_archived then now() end,
    archived_by = case when p_archived then auth.uid() end,
    updated_at = now()
  where run.id = p_run_id
  returning run.* into run_record;

  perform public.record_activity_event(
    run_record.organization_id, run_record.project_id,
    case when p_archived then 'run.archived'::public.activity_event_type
      else 'run.unarchived'::public.activity_event_type end,
    'agent_run', run_record.id,
    case when p_archived then 'Run archived' else 'Run restored to the list' end,
    jsonb_build_object('reason', coalesce(trimmed_reason, ''),
      'runStatus', run_record.status::text)
  );

  return query select run_record.id, run_record.archived_at;
end;
$function$;

comment on function public.set_agent_run_archived(uuid, uuid, boolean, text) is
  'Takes a finished run out of the default list, or puts it back. Destroys nothing; refuses work that has not finished.';

-- ---------------------------------------------------------------------------
-- Archiving and deleting a report
-- ---------------------------------------------------------------------------

create or replace function public.set_report_archived(
  p_organization_id uuid,
  p_report_id uuid,
  p_archived boolean,
  p_reason text default null
)
returns table (report_id uuid, status public.report_status)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  report_record public.reports%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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
  if trimmed_reason is not null and (
    char_length(trimmed_reason) > 400 or public.text_has_likely_secret(trimmed_reason)
  ) then
    raise exception using errcode = '22023',
      message = 'the reason is too long or contains a credential';
  end if;

  select * into report_record from public.reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'report not found';
  end if;

  -- Unarchiving restores `published` when the report had been published, and
  -- `draft` otherwise. Reading that from `published_at` rather than guessing
  -- keeps a published report from quietly reverting to a draft.
  update public.reports report
  set status = case
      when p_archived then 'archived'::public.report_status
      when report.published_at is not null then 'published'::public.report_status
      else 'draft'::public.report_status
    end,
    updated_at = now()
  where report.id = p_report_id
  returning report.* into report_record;

  perform public.record_activity_event(
    report_record.organization_id, report_record.project_id,
    case when p_archived then 'report.archived'::public.activity_event_type
      else 'report.unarchived'::public.activity_event_type end,
    'report', report_record.id,
    case when p_archived then 'Report archived' else 'Report restored' end,
    jsonb_build_object('reason', coalesce(trimmed_reason, ''),
      'reportType', report_record.type::text)
  );

  return query select report_record.id, report_record.status;
end;
$function$;

comment on function public.set_report_archived(uuid, uuid, boolean, text) is
  'Moves a report to the archived status or back to the status it held before. Uses the report_status value that has existed since the control-plane schema and was never set.';

create or replace function public.delete_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_reason text
)
returns table (deleted_report_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  report_record public.reports%rowtype;
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  -- Owner-only, matching `delete_agent_run`: this is the destructive verb.
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may delete a report';
  end if;
  if trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'a reason is required to delete a report';
  end if;
  if char_length(trimmed_reason) > 400 or public.text_has_likely_secret(trimmed_reason) then
    raise exception using errcode = '22023',
      message = 'the deletion reason is too long or contains a credential';
  end if;

  select * into report_record from public.reports report
  where report.id = p_report_id and report.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'report not found';
  end if;

  -- Recorded before the row goes, in a table with no key back to it, so the
  -- account of the deletion outlives the report. The whole statement rolls
  -- back together if the delete fails, so this never claims a removal that
  -- did not happen.
  perform public.record_activity_event(
    report_record.organization_id, report_record.project_id,
    'report.deleted'::public.activity_event_type,
    'report', report_record.id,
    'Report deleted by the organization owner',
    jsonb_build_object(
      'reason', trimmed_reason,
      'reportType', report_record.type::text,
      'reportStatus', report_record.status::text,
      'title', left(report_record.title, 240),
      'createdAt', report_record.created_at
    )
  );

  delete from public.reports where id = p_report_id;

  return query select p_report_id;
end;
$function$;

comment on function public.delete_report(uuid, uuid, text) is
  'Owner-only deletion of one report, recorded before it happens. Nothing references reports, so a deleted report orphans nothing.';

-- Clearing every archived report, one at a time through the per-report path.
--
-- Deliberately archived-only. "Clear" on a page of reports must not mean "and
-- also the ones you have not looked at": archiving first is the step that makes
-- the intent explicit, and it is reversible right up until this is called.
create or replace function public.delete_archived_reports(
  p_organization_id uuid,
  p_reason text
)
returns table (deleted_count integer, kept_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  report_row record;
  removed integer := 0;
  kept integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may clear archived reports';
  end if;

  for report_row in
    select report.id from public.reports report
    where report.organization_id = p_organization_id
      and report.status = 'archived'::public.report_status
    order by report.created_at
  loop
    begin
      -- The per-report path re-checks every rule on every call, so this cannot
      -- drift from it.
      perform public.delete_report(p_organization_id, report_row.id, p_reason);
      removed := removed + 1;
    exception
      when others then
        -- Counted rather than raised: one refusal must not abandon the rest,
        -- and the caller is told how many stayed.
        kept := kept + 1;
    end;
  end loop;

  return query select removed, kept;
end;
$function$;

comment on function public.delete_archived_reports(uuid, text) is
  'Deletes every archived report through the per-report path, counting any it refused. Archived-only: clearing must not reach reports nobody has triaged.';

revoke all on function public.set_agent_run_archived(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_report_archived(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_report(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_archived_reports(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.set_agent_run_archived(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.set_report_archived(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.delete_report(uuid, uuid, text) to authenticated;
grant execute on function public.delete_archived_reports(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Keep archived runs out of the default list
-- ---------------------------------------------------------------------------

-- Dropped and recreated rather than replaced: the return type gains a column
-- and the signature gains a parameter. The parameter has a default, so the
-- existing two-argument call sites keep working unchanged and simply stop
-- seeing archived runs — which is the point of archiving them.
--
-- One function, not two. An overload would be routed by PostgREST on name
-- alone, and `migration-object-collisions` refuses overloads in this schema
-- for exactly that reason.
drop function if exists public.list_agent_runs(uuid, integer);
create function public.list_agent_runs(
  p_organization_id uuid,
  p_limit integer default 50,
  p_include_archived boolean default false
)
returns table (
  id uuid, status public.run_status, started_at timestamptz,
  completed_at timestamptz, created_at timestamptz,
  task_id uuid, task_title text, agent_id uuid, agent_name text,
  project_id uuid, project_name text, risk_level public.risk_level,
  provider text, model text, branch_name text, review_status text,
  archived_at timestamptz
)
language sql stable security definer set search_path = pg_catalog as $function$
  select run.id, run.status, run.started_at, run.completed_at, run.created_at,
    task.id, task.title, agent.id, agent.name, project.id, project.name,
    run.risk_level, run.provider, run.model, run.head_branch, run.review_status,
    run.archived_at
  from public.agent_runs run
  left join public.tasks task
    on task.id = run.task_id and task.organization_id = run.organization_id
  left join public.agents agent
    on agent.id = run.agent_id and agent.organization_id = run.organization_id
  left join public.projects project
    on project.id = run.project_id and project.organization_id = run.organization_id
  where run.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
    and (coalesce(p_include_archived, false) or run.archived_at is null)
  order by run.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

revoke all on function public.list_agent_runs(uuid, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.list_agent_runs(uuid, integer, boolean) to authenticated;
