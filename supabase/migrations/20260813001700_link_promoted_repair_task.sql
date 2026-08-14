-- Link a promoted Phase 1E repair attempt to the Phase 1C task it became.
--
-- Command assembly deliberately lives in TypeScript (`lib/operations/promotion.ts`)
-- so Phase 1C's exact-key parameter contract keeps a single source of truth in
-- `createPhase1CExecutionPlan`. This function does only the part that must be
-- transactional and privileged: re-validate the preconditions and record the
-- link, since `authenticated` holds no UPDATE on `repair_attempts`.
--
-- It re-checks everything the route checked. The route's checks are for a useful
-- error message; these are the ones that actually hold, because a route can be
-- bypassed and a SECURITY DEFINER function cannot.

create or replace function public.link_repair_promotion(
  p_repair_id uuid,
  p_task_id uuid
)
returns table (
  repair_id uuid,
  task_id uuid,
  state public.repair_state,
  assignment_status text,
  linked boolean,
  blocked_reason text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  repair_record public.repair_attempts%rowtype;
  project_record public.projects%rowtype;
  task_record public.tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into repair_record from public.repair_attempts where id = p_repair_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'repair attempt not found';
  end if;

  -- Promotion starts a Codex engineering command, so it carries the same
  -- owner-only requirement as submitting one directly.
  if not public.is_organization_owner(repair_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may promote repair work';
  end if;

  select * into task_record from public.tasks where id = p_task_id;
  if not found or task_record.organization_id <> repair_record.organization_id then
    raise exception using errcode = '42501', message = 'the task does not belong to this organization';
  end if;

  if task_record.project_id <> repair_record.project_id then
    raise exception using errcode = '23514', message = 'the task belongs to a different project';
  end if;

  select * into project_record from public.projects where id = repair_record.project_id;

  -- The emergency stop halts everything, repair included. A release freeze does
  -- not: a frozen project still needs repair, which is exactly why freezing
  -- removes only release authority.
  if project_record.autonomous_operations_stopped then
    return query select repair_record.id, repair_record.task_id, repair_record.state,
      repair_record.assignment_status, false,
      'Autonomous operations are stopped for this organization.'::text;
    return;
  end if;

  if repair_record.state in ('succeeded', 'escalated') then
    return query select repair_record.id, repair_record.task_id, repair_record.state,
      repair_record.assignment_status, false,
      'This repair attempt already reached a terminal state.'::text;
    return;
  end if;

  -- "Already promoted" is the 'assigned' state, which only promotion sets.
  -- Not task_id: create_repair_attempt already points that at the bare backlog
  -- task. Not assignment_status either: promotion sets it to 'pending'.
  if repair_record.state = 'assigned'::public.repair_state then
    return query select repair_record.id, repair_record.task_id, repair_record.state,
      repair_record.assignment_status, false,
      'This repair attempt is already promoted.'::text;
    return;
  end if;

  -- Repair work is only as good as the diagnosis behind it. Promoting an
  -- undiagnosed incident hands a worker an instruction nobody derived.
  if repair_record.diagnosis_id is null then
    return query select repair_record.id, repair_record.task_id, repair_record.state,
      repair_record.assignment_status, false,
      'This repair attempt has no diagnosis to act on.'::text;
    return;
  end if;

  update public.repair_attempts
  set task_id = p_task_id,
    state = 'assigned'::public.repair_state,
    assignment_status = 'pending',
    blocked_reason = null
  where id = p_repair_id
  returning * into repair_record;

  perform public.record_operations_audit_event(
    repair_record.organization_id, repair_record.project_id,
    'repair.created'::public.operations_audit_kind,
    'repair_attempt', repair_record.id,
    'Repair work promoted into the execution queue',
    pg_catalog.jsonb_build_object('task_id', p_task_id, 'attempt', repair_record.attempt_number)
  );

  return query select repair_record.id, repair_record.task_id, repair_record.state,
    repair_record.assignment_status, true, null::text;
end;
$function$;

comment on function public.link_repair_promotion(uuid, uuid) is
  'Owner-only link between a Phase 1E repair attempt and the Phase 1C task it was promoted into. Re-validates the emergency stop, terminal state, double promotion, and diagnosis requirements, because a route can be bypassed and this cannot.';

revoke all on function public.link_repair_promotion(uuid, uuid) from public, anon, service_role;
grant execute on function public.link_repair_promotion(uuid, uuid) to authenticated;
