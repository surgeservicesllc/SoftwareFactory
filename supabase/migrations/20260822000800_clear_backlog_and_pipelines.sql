-- Clearing the Backlog page and the All Pipelines page in one action each.
--
-- Both are destructive, and both are more destructive than they look. The
-- foreign keys cascade:
--
--   commands --> tasks --> agent_runs
--
-- all `on delete cascade`. So `delete from commands` does not just clear the
-- pipelines list: it deletes those commands' tasks, and those tasks' runs, and
-- with them every approval, repair attempt, routing decision, task dependency,
-- inbox item and chain step keyed to them. `delete_agent_run` (20260817000300)
-- exists precisely because deleting a run is a decision with rules — owner
-- only, reason required, external evidence preserved unless detachment is
-- explicit — and a cascade walks straight past all of them.
--
-- So neither function below deletes anything whose removal would take run
-- history with it, unless the caller says so explicitly. That flag defaults to
-- false, which is this repository's rule for destructive controls, and the
-- functions return counts so the surface can say what it kept and why rather
-- than reporting a clean sweep that did not happen.
--
-- Live work is never touched at all, by construction: running and queued rows
-- do not enter the loop. There is no flag for that one, because deleting a row
-- a worker currently holds a lease on corrupts an execution in flight.

-- ---------------------------------------------------------------------------
-- The backlog
-- ---------------------------------------------------------------------------

create or replace function public.clear_backlog_tasks(
  p_organization_id uuid,
  p_reason text,
  p_include_tasks_with_runs boolean default false
)
returns table (
  deleted_count integer,
  kept_running integer,
  kept_with_runs integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_task record;
  v_removed integer := 0;
  v_kept_running integer := 0;
  v_kept_runs integer := 0;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  -- Owner or admin. Clearing a shared workspace's backlog is not a member's
  -- decision to make on everyone else's behalf.
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an owner or admin may clear the backlog';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception using errcode = '22023',
      message = 'a reason of at least 10 characters is required';
  end if;

  for v_task in
    select t.id, t.status,
           exists (select 1 from public.agent_runs r where r.task_id = t.id) as has_runs
      from public.tasks t
     where t.organization_id = p_organization_id
     order by t.created_at
  loop
    -- Live work, skipped by construction. A worker may hold a lease on it.
    if v_task.status in ('queued'::public.task_status, 'in_progress'::public.task_status) then
      v_kept_running := v_kept_running + 1;
      continue;
    end if;

    -- Deleting this would cascade into agent_runs and take run history with
    -- it, bypassing every rule delete_agent_run enforces.
    if v_task.has_runs and not coalesce(p_include_tasks_with_runs, false) then
      v_kept_runs := v_kept_runs + 1;
      continue;
    end if;

    delete from public.tasks where id = v_task.id;
    v_removed := v_removed + 1;
  end loop;

  -- Recorded whatever the outcome, including a run that deleted nothing: the
  -- attempt is the auditable fact, not just its effect.
  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, description, metadata
  ) values (
    p_organization_id,
    v_caller,
    'task.backlog_cleared'::public.activity_event_type,
    'task',
    format('Backlog cleared: %s removed, %s left running, %s left with run history.',
           v_removed, v_kept_running, v_kept_runs),
    pg_catalog.jsonb_build_object(
      'reason', left(btrim(p_reason), 400),
      'deleted_count', v_removed,
      'kept_running', v_kept_running,
      'kept_with_runs', v_kept_runs,
      'included_tasks_with_runs', coalesce(p_include_tasks_with_runs, false)
    )
  );

  return query select v_removed, v_kept_running, v_kept_runs;
end;
$function$;

revoke all on function public.clear_backlog_tasks(uuid, text, boolean) from public, anon;
grant execute on function public.clear_backlog_tasks(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- All Pipelines
-- ---------------------------------------------------------------------------

create or replace function public.clear_all_pipelines(
  p_organization_id uuid,
  p_reason text,
  p_include_commands_with_runs boolean default false
)
returns table (
  deleted_count integer,
  kept_running integer,
  kept_with_runs integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_command record;
  v_removed integer := 0;
  v_kept_running integer := 0;
  v_kept_runs integer := 0;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an owner or admin may clear the pipelines list';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception using errcode = '22023',
      message = 'a reason of at least 10 characters is required';
  end if;

  for v_command in
    select c.id, c.status,
           exists (
             select 1
               from public.tasks t
               join public.agent_runs r on r.task_id = t.id
              where t.command_id = c.id
           ) as has_runs
      from public.commands c
     where c.organization_id = p_organization_id
     order by c.created_at
  loop
    if v_command.status in ('queued'::public.command_status, 'running'::public.command_status) then
      v_kept_running := v_kept_running + 1;
      continue;
    end if;

    -- Two hops of cascade rather than one: this command's tasks, and those
    -- tasks' runs. Same rule, larger blast radius.
    if v_command.has_runs and not coalesce(p_include_commands_with_runs, false) then
      v_kept_runs := v_kept_runs + 1;
      continue;
    end if;

    delete from public.commands where id = v_command.id;
    v_removed := v_removed + 1;
  end loop;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, description, metadata
  ) values (
    p_organization_id,
    v_caller,
    'command.pipelines_cleared'::public.activity_event_type,
    'command',
    format('Pipelines cleared: %s removed, %s left running, %s left with run history.',
           v_removed, v_kept_running, v_kept_runs),
    pg_catalog.jsonb_build_object(
      'reason', left(btrim(p_reason), 400),
      'deleted_count', v_removed,
      'kept_running', v_kept_running,
      'kept_with_runs', v_kept_runs,
      'included_commands_with_runs', coalesce(p_include_commands_with_runs, false)
    )
  );

  return query select v_removed, v_kept_running, v_kept_runs;
end;
$function$;

revoke all on function public.clear_all_pipelines(uuid, text, boolean) from public, anon;
grant execute on function public.clear_all_pipelines(uuid, text, boolean) to authenticated;
