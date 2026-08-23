-- A routed command could never be deleted by anyone, ever.
--
-- `factory_command_routes` (20260821000400) carries a BEFORE UPDATE OR DELETE
-- trigger that raises unconditionally - "factory command routing evidence is
-- immutable" - and its foreign key to `commands` is ON DELETE RESTRICT. Put
-- together, those two rules do not make routing evidence immutable; they make
-- the COMMAND immortal. The owner pressed delete on two pipelines and got the
-- trigger's message back, with no path forward from any surface.
--
-- The fix keeps the guarantee the guard was written for and drops the one it
-- never meant to make:
--
--   * Routing evidence is still never EDITED. An UPDATE is refused exactly as
--     before, with the same message and errcode.
--   * A DELETE is refused exactly as before, EXCEPT inside the audited
--     pipeline delete, which announces itself with a transaction-local
--     setting only that SECURITY DEFINER function sets.
--
-- Why that is not a hole: `factory_command_routes` has no grants at all -
-- `revoke all ... from public, anon, authenticated, service_role` - so no
-- browser or worker role can reach the table with or without the setting. The
-- trigger's real job is discipline between definer functions, and this names
-- the one function allowed to release a route: the one that is deleting the
-- route's own command, under owner-or-admin, with a recorded reason, in the
-- same transaction.
--
-- The route count lands in the audit event rather than the return shape, so
-- the console keeps the columns it already reads.

do $preflight$
begin
  if to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)') is null then
    raise exception using errcode = '55000',
      message = '20260823000400 preflight: 20260823000300 must be applied first';
  end if;
end;
$preflight$;

-- Tolerant of a database that does not hold 20260821000400: the guard is only
-- redefined where it exists.
do $guard$
begin
  if to_regprocedure('public.reject_factory_command_route_mutation()') is null then
    raise notice '20260823000400: routing guard absent; nothing to relax';
    return;
  end if;

  execute $fn$
    create or replace function public.reject_factory_command_route_mutation()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $function$
    begin
      -- Evidence is never edited, under any caller.
      if TG_OP = 'DELETE'
        and coalesce(current_setting('softwarefactory.pipeline_delete', true), '') = 'on' then
        return old;
      end if;
      raise exception using
        errcode = '55000',
        message = 'factory command routing evidence is immutable';
    end;
    $function$;
  $fn$;

  execute 'revoke all on function public.reject_factory_command_route_mutation()'
       || ' from public, anon, authenticated, service_role';
end;
$guard$;

-- The delete function gains exactly one behaviour: it announces the audited
-- release around the route delete, and counts what it released.
create or replace function public.delete_selected_pipelines(
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
  v_released integer := 0;
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

    if v_command.has_runs and not coalesce(p_include_commands_with_runs, false) then
      v_kept_runs := v_kept_runs + 1;
      continue;
    end if;

    v_cited := false;
    if to_regclass('public.improvement_ledger') is not null then
      execute 'select exists (select 1 from public.improvement_ledger l where l.command_id = $1)'
        into v_cited using v_command.id;
    end if;
    if v_cited then
      v_kept_evidence := v_kept_evidence + 1;
      continue;
    end if;

    if to_regclass('public.command_analysis_graphs') is not null then
      execute 'delete from public.command_analysis_graphs where command_id = $1' using v_command.id;
      get diagnostics v_link_count = row_count;
      v_unlinked := v_unlinked + v_link_count;
    end if;

    if to_regclass('public.factory_command_routes') is not null then
      -- Announce the audited release, delete, then withdraw it immediately so
      -- the permission covers this one statement and not the rest of the
      -- transaction.
      perform set_config('softwarefactory.pipeline_delete', 'on', true);
      execute 'delete from public.factory_command_routes where command_id = $1' using v_command.id;
      get diagnostics v_link_count = row_count;
      v_released := v_released + v_link_count;
      perform set_config('softwarefactory.pipeline_delete', 'off', true);
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
      'released_routes', v_released,
      'included_commands_with_runs', coalesce(p_include_commands_with_runs, false)
    )
  );

  return query select v_removed, v_stopped, v_kept_runs, v_kept_evidence,
                      array_length(v_ids, 1) - v_matched, v_unlinked;
end;
$function$;

comment on function public.delete_selected_pipelines(uuid, uuid[], text, boolean) is
  'Stops and deletes exactly the pipelines named by id in this organization. Live work is cancelled first, analysis graph links are removed while the graphs and artifacts survive, routing evidence is released under an announced transaction-local permission the routing guard honours only for this function, run history still requires the explicit include flag, and a command cited by the improvement ledger is never deleted.';

revoke all on function public.delete_selected_pipelines(uuid, uuid[], text, boolean)
  from public, anon, service_role;
grant execute on function public.delete_selected_pipelines(uuid, uuid[], text, boolean)
  to authenticated;

do $postflight$
begin
  if to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)') is null then
    raise exception using errcode = '55000',
      message = '20260823000400 postflight: the function is missing';
  end if;
  if has_function_privilege('anon', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE')
    or has_function_privilege('service_role', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE')
    or not has_function_privilege('authenticated', to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)'), 'EXECUTE') then
    raise exception using errcode = '55000',
      message = '20260823000400 postflight: the execute grants are not owner+authenticated only';
  end if;
  -- The routing table must still be unreachable by every client role.
  if to_regclass('public.factory_command_routes') is not null
    and (has_table_privilege('authenticated', 'public.factory_command_routes', 'DELETE')
      or has_table_privilege('anon', 'public.factory_command_routes', 'DELETE')
      or has_table_privilege('service_role', 'public.factory_command_routes', 'DELETE')) then
    raise exception using errcode = '55000',
      message = '20260823000400 postflight: a client role can reach factory_command_routes directly';
  end if;
end;
$postflight$;
