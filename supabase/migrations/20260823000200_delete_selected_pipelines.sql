-- Deleting a chosen few pipelines, rather than all of them.
--
-- `clear_all_pipelines` (20260822000800) is the whole-list decision. The
-- Pipelines page needed the smaller one: tick the rows you mean and remove
-- exactly those. Same authority, same refusals, same audit vocabulary --
-- only the row set differs, so the two can never drift into disagreeing about
-- what is safe to delete.
--
-- Deliberately unchanged from the clear: live work is never deleted, run
-- history is never taken by surprise, a reason is mandatory, and only an
-- owner or admin may press it. An explicit selection is not a licence to
-- reach past those rules -- it is a smaller blast radius for the same rules.
--
-- Adds no enum label (the existing `command.pipelines_cleared` event carries
-- both, distinguished by its metadata) and replaces no existing function.

do $preflight$
begin
  if to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)') is not null then
    raise exception using errcode = '55000',
      message = '20260823000200 preflight: delete_selected_pipelines already exists; this file is forward-only';
  end if;
  if to_regclass('public.commands') is null
    or to_regclass('public.tasks') is null
    or to_regclass('public.agent_runs') is null
    or to_regclass('public.activity_events') is null
    or to_regprocedure('public.can_manage_organization(uuid)') is null then
    raise exception using errcode = '55000',
      message = '20260823000200 preflight: a prerequisite table or function is missing';
  end if;
  if not exists (
    select 1 from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    where enum_type.typname = 'activity_event_type'
      and enum_value.enumlabel = 'command.pipelines_cleared'
  ) then
    raise exception using errcode = '55000',
      message = '20260823000200 preflight: the command.pipelines_cleared activity label is missing';
  end if;
end;
$preflight$;

create function public.delete_selected_pipelines(
  p_organization_id uuid,
  p_command_ids uuid[],
  p_reason text,
  p_include_commands_with_runs boolean default false
)
returns table (
  deleted_count integer,
  kept_running integer,
  kept_with_runs integer,
  not_found integer
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
  v_kept_running integer := 0;
  v_kept_runs integer := 0;
  v_matched integer := 0;
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

  -- A selection is a list of distinct rows somebody ticked. Deduplicating
  -- here keeps the counts honest when the same id arrives twice.
  select array_agg(distinct id) into v_ids
    from unnest(coalesce(p_command_ids, '{}'::uuid[])) as id
   where id is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception using errcode = '22023',
      message = 'select at least one pipeline to delete';
  end if;
  -- An upper bound so this cannot quietly become clear-all wearing a
  -- selection's clothes; a page shows far fewer rows than this at once.
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
  loop
    v_matched := v_matched + 1;

    if v_command.status in ('queued'::public.command_status, 'running'::public.command_status) then
      v_kept_running := v_kept_running + 1;
      continue;
    end if;

    -- Two hops of cascade rather than one: this command's tasks, and those
    -- tasks' runs. Same rule as the whole-list clear, same real cost.
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
    format('Selected pipelines deleted: %s removed of %s selected, %s left running, %s left with run history.',
           v_removed, array_length(v_ids, 1), v_kept_running, v_kept_runs),
    pg_catalog.jsonb_build_object(
      'scope', 'selection',
      'reason', left(btrim(p_reason), 400),
      'selected_count', array_length(v_ids, 1),
      'deleted_count', v_removed,
      'kept_running', v_kept_running,
      'kept_with_runs', v_kept_runs,
      -- Ids the caller named that this organization does not hold. Counted,
      -- never echoed: a foreign id must not learn whether it exists.
      'not_found', array_length(v_ids, 1) - v_matched,
      'included_commands_with_runs', coalesce(p_include_commands_with_runs, false)
    )
  );

  return query select v_removed, v_kept_running, v_kept_runs,
                      array_length(v_ids, 1) - v_matched;
end;
$function$;

comment on function public.delete_selected_pipelines(uuid, uuid[], text, boolean) is
  'Deletes exactly the pipelines (commands) named by id in this organization, under the same refusals as clear_all_pipelines: owner or admin only, a reason of ten characters or more, never live work, and never run history unless explicitly included.';

revoke all on function public.delete_selected_pipelines(uuid, uuid[], text, boolean)
  from public, anon, service_role;
grant execute on function public.delete_selected_pipelines(uuid, uuid[], text, boolean)
  to authenticated;

do $postflight$
begin
  if to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)') is null then
    raise exception using errcode = '55000',
      message = '20260823000200 postflight: the function was not created';
  end if;
  if not (select prosecdef from pg_proc
           where oid = to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)')) then
    raise exception using errcode = '55000',
      message = '20260823000200 postflight: the function is not SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE')
    or has_function_privilege('service_role', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE')
    or not has_function_privilege('authenticated', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE') then
    raise exception using errcode = '55000',
      message = '20260823000200 postflight: the execute grants are not owner+authenticated only';
  end if;
end;
$postflight$;
