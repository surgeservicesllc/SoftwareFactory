-- Selecting a pipeline and pressing delete now stops it and deletes it.
--
-- 20260823000200 borrowed the whole-list clear's rule that live work is never
-- touched, and that rule was wrong for an explicit selection: the owner ticked
-- two pipelines that had sat `queued` for hours - waiting for a worker that,
-- being record-only, will never come - and was told "0 pipelines deleted.
-- Kept: 2 still running." A rule that protects work in flight had become a
-- rule that protects rows nobody can ever finish.
--
-- So a selection now means stop, then delete. What that does NOT mean:
--
--   * It is not a licence to destroy evidence. A command whose tasks carry
--     agent runs still needs the explicit include flag, exactly as before, and
--     a command cited by the improvement ledger is never deleted at all.
--   * It is not a race with a worker. The agent runs are locked FOR UPDATE
--     before they are cancelled, and `claim_phase1c_run` selects with
--     `FOR UPDATE ... SKIP LOCKED`, so a claim in flight cannot take a run
--     this transaction is about to cancel - it skips it and the delete wins.
--   * It does not delete an analysis run. `command_analysis_graphs` restricts
--     deletion; the link row goes, and the graph, its run and its artifacts
--     survive intact and stay readable under Graph runs. Nothing recorded by
--     a bot is lost when its originating request is removed.
--
-- Cancelling is safe against this schema's own guards: the two RED-block
-- triggers rewrite a status only when it moves INTO queued/running/succeeded,
-- and the Phase 1C planners fire on INSERT, so a move to `cancelled` passes
-- through both untouched.

do $preflight$
begin
  if to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)') is null then
    raise exception using errcode = '55000',
      message = '20260823000300 preflight: 20260823000200 must be applied first';
  end if;
  if to_regclass('public.commands') is null
    or to_regclass('public.tasks') is null
    or to_regclass('public.agent_runs') is null
    or to_regclass('public.activity_events') is null
    or to_regprocedure('public.can_manage_organization(uuid)') is null then
    raise exception using errcode = '55000',
      message = '20260823000300 preflight: a prerequisite table or function is missing';
  end if;
end;
$preflight$;

-- One name, one selection-delete path. The return shape changes (stopped_count
-- replaces kept_running, and two new counts appear), which PostgreSQL cannot
-- express through CREATE OR REPLACE, so the old body is dropped rather than
-- left beside the new one for a caller to find later.
drop function public.delete_selected_pipelines(uuid, uuid[], text, boolean);

create function public.delete_selected_pipelines(
  p_organization_id uuid,
  p_command_ids uuid[],
  p_reason text,
  p_include_commands_with_runs boolean default false
)
returns table (
  deleted_count integer,
  stopped_count integer,
  kept_with_runs integer,
  kept_with_evidence integer,
  not_found integer,
  unlinked_analyses integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_ids uuid[];
  v_command record;
  v_removed integer := 0;
  v_stopped integer := 0;
  v_kept_runs integer := 0;
  v_kept_evidence integer := 0;
  v_unlinked integer := 0;
  v_matched integer := 0;
  v_cited boolean;
  v_link_count integer;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an owner or admin may delete pipelines';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception using errcode = '22023',
      message = 'a reason of at least 10 characters is required';
  end if;

  select array_agg(distinct id) into v_ids
    from unnest(coalesce(p_command_ids, '{}'::uuid[])) as id
   where id is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception using errcode = '22023',
      message = 'select at least one pipeline to delete';
  end if;
  if array_length(v_ids, 1) > 200 then
    raise exception using errcode = '22023',
      message = 'select 200 pipelines or fewer at a time';
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
       and c.id = any(v_ids)
     order by c.created_at
     for update
  loop
    v_matched := v_matched + 1;

    -- Stop first, and stop whatever the outcome below turns out to be: a
    -- pipeline the owner selected should not still be waiting for a worker
    -- afterwards, even in the cases where its rows are kept.
    if v_command.status in ('queued'::public.command_status, 'running'::public.command_status) then
      perform 1
        from public.agent_runs r
        join public.tasks t on t.id = r.task_id
       where t.command_id = v_command.id
         and r.status in ('queued'::public.run_status, 'running'::public.run_status)
         for update of r;

      update public.agent_runs r
         set status = 'cancelled'::public.run_status,
             completed_at = coalesce(r.completed_at, now())
        from public.tasks t
       where t.id = r.task_id
         and t.command_id = v_command.id
         and r.status in ('queued'::public.run_status, 'running'::public.run_status);

      update public.tasks t
         set status = 'cancelled'::public.task_status
       where t.command_id = v_command.id
         and t.status not in (
           'completed'::public.task_status,
           'failed'::public.task_status,
           'cancelled'::public.task_status
         );

      update public.commands c
         set status = 'cancelled'::public.command_status,
             completed_at = coalesce(c.completed_at, now())
       where c.id = v_command.id;

      v_stopped := v_stopped + 1;
    end if;

    -- Unchanged: a command whose tasks carry runs is not deleted by surprise,
    -- because that cascade walks past every guard in delete_agent_run.
    if v_command.has_runs and not coalesce(p_include_commands_with_runs, false) then
      v_kept_runs := v_kept_runs + 1;
      continue;
    end if;

    -- The improvement ledger cites commands as evidence for a proposal or a
    -- measurement. That citation is the point of the row, so a cited command
    -- is never deleted, with or without the flag.
    v_cited := false;
    if to_regclass('public.improvement_ledger') is not null then
      execute 'select exists (select 1 from public.improvement_ledger l where l.command_id = $1)'
        into v_cited using v_command.id;
    end if;
    if v_cited then
      v_kept_evidence := v_kept_evidence + 1;
      continue;
    end if;

    -- Association rows that only restrict. Removing the analysis link keeps
    -- the graph, its run and its artifacts - the bot's work outlives the
    -- request that asked for it. Both tables are addressed dynamically because
    -- a database may hold either, both, or neither.
    if to_regclass('public.command_analysis_graphs') is not null then
      execute 'delete from public.command_analysis_graphs where command_id = $1' using v_command.id;
      get diagnostics v_link_count = row_count;
      v_unlinked := v_unlinked + v_link_count;
    end if;
    if to_regclass('public.factory_command_routes') is not null then
      execute 'delete from public.factory_command_routes where command_id = $1' using v_command.id;
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
    format('Selected pipelines deleted: %s removed of %s selected, %s stopped first, %s left with run history, %s left as cited evidence.',
           v_removed, array_length(v_ids, 1), v_stopped, v_kept_runs, v_kept_evidence),
    pg_catalog.jsonb_build_object(
      'scope', 'selection',
      'reason', left(btrim(p_reason), 400),
      'selected_count', array_length(v_ids, 1),
      'deleted_count', v_removed,
      'stopped_count', v_stopped,
      'kept_with_runs', v_kept_runs,
      'kept_with_evidence', v_kept_evidence,
      'not_found', array_length(v_ids, 1) - v_matched,
      'unlinked_analyses', v_unlinked,
      'included_commands_with_runs', coalesce(p_include_commands_with_runs, false)
    )
  );

  return query select v_removed, v_stopped, v_kept_runs, v_kept_evidence,
                      array_length(v_ids, 1) - v_matched, v_unlinked;
end;
$function$;

comment on function public.delete_selected_pipelines(uuid, uuid[], text, boolean) is
  'Stops and deletes exactly the pipelines named by id in this organization. Live work is cancelled first (agent runs locked FOR UPDATE, so a concurrent claim skips them), analysis graph links are removed while the graphs and artifacts survive, run history still requires the explicit include flag, and a command cited by the improvement ledger is never deleted.';

revoke all on function public.delete_selected_pipelines(uuid, uuid[], text, boolean)
  from public, anon, service_role;
grant execute on function public.delete_selected_pipelines(uuid, uuid[], text, boolean)
  to authenticated;

do $postflight$
begin
  if to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)') is null then
    raise exception using errcode = '55000',
      message = '20260823000300 postflight: the function was not created';
  end if;
  if not (select prosecdef from pg_proc
           where oid = to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)')) then
    raise exception using errcode = '55000',
      message = '20260823000300 postflight: the function is not SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE')
    or has_function_privilege('service_role', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE')
    or not has_function_privilege('authenticated', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE') then
    raise exception using errcode = '55000',
      message = '20260823000300 postflight: the execute grants are not owner+authenticated only';
  end if;
end;
$postflight$;
