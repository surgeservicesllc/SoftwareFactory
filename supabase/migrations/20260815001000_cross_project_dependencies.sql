-- Cross-project work becomes explicit, or it does not exist.
--
-- Portfolio goal 17 asks that work in one project may wait on work in another
-- only through a declared dependency. Half of that rule has been true since
-- Phase 1C: `submit_command` refuses `dependencyTaskIds` outside the command's
-- own project (with a deliberately generic error, so the boundary cannot
-- enumerate a tenant's tasks), which makes *implicit* cross-project coupling
-- impossible. And the claim path's dependency gate already joins prerequisites
-- by organization, not by project — the scheduler has been ready to respect a
-- cross-project edge since the day the gate landed. What never existed was an
-- authorized doorway that could create one.
--
-- These two functions are that doorway, shaped like every other Phase 2E owner
-- control: owner-only, reason required, an immutable activity event in *both*
-- projects (coupling is visible from each side), and instructive refusals for
-- every way the request could be dishonest — same-project pairs belong to
-- submission, terminal tasks cannot be gated or waited on, and cycles are
-- refused before they can deadlock a portfolio.
--
-- The edges live in the existing `task_dependencies` table, which the claim
-- path already consumes. No scheduler change is needed; that is the point.
--
-- `submit_command` is carried forward with one surgical change: its
-- idempotency replay check ("an unexplained extra edge is never silently
-- erased") now considers only same-project edges, because a cross-project
-- edge can only come from the declaration path below, which records its own
-- evidence. Without this, declaring a dependency would make an honest replay
-- of the originating command fail with a conflict the caller did nothing to
-- cause.

alter type public.activity_event_type add value if not exists 'task.cross_project_dependency_declared';
alter type public.activity_event_type add value if not exists 'task.cross_project_dependency_released';

create or replace function public.declare_cross_project_dependency(
  p_dependent_task_id uuid,
  p_prerequisite_task_id uuid,
  p_reason text default null
)
returns table (dependency_id uuid, dependent_task_id uuid, prerequisite_task_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  dependent_task public.tasks%rowtype;
  prerequisite_task public.tasks%rowtype;
  created_dependency_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  -- A cross-project coupling with no reason is the pause problem again: the
  -- one relationship nobody can explain later. Refused at the boundary.
  if trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'a dependency reason is required';
  end if;

  if p_dependent_task_id = p_prerequisite_task_id then
    raise exception using errcode = '22023',
      message = 'a task cannot depend on itself';
  end if;

  -- One deliberately generic failure for missing, cross-tenant, and non-owner
  -- lookups, matching submit_command's discipline: this boundary must not
  -- enumerate another tenant's tasks.
  select task.* into dependent_task
  from public.tasks task
  where task.id = p_dependent_task_id
    and public.is_organization_owner(task.organization_id)
  for update of task;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  select task.* into prerequisite_task
  from public.tasks task
  where task.id = p_prerequisite_task_id
    and task.organization_id = dependent_task.organization_id
  for update of task;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if dependent_task.project_id = prerequisite_task.project_id then
    raise exception using errcode = '22023',
      message = 'same-project dependencies are declared at submission (dependencyTaskIds); this control couples projects';
  end if;

  if dependent_task.status in (
    'completed'::public.task_status, 'failed'::public.task_status,
    'cancelled'::public.task_status
  ) then
    raise exception using errcode = '22023',
      message = 'the dependent task is terminal; a dependency cannot gate finished work';
  end if;

  if prerequisite_task.status in (
    'failed'::public.task_status, 'cancelled'::public.task_status
  ) then
    raise exception using errcode = '22023',
      message = 'the prerequisite task is terminal and will never complete; the dependency would block forever';
  end if;

  if prerequisite_task.status = 'completed'::public.task_status then
    raise exception using errcode = '22023',
      message = 'the prerequisite task is already complete; the dependency would gate nothing';
  end if;

  if exists (
    select 1 from public.task_dependencies dependency
    where dependency.task_id = p_dependent_task_id
      and dependency.depends_on_task_id = p_prerequisite_task_id
      and dependency.organization_id = dependent_task.organization_id
  ) then
    raise exception using errcode = '22023',
      message = 'this dependency is already declared';
  end if;

  -- A cycle would let two projects wait on each other forever, and the claim
  -- gate would truthfully withhold both. Refused by walking the prerequisite's
  -- own waits-on edges: if the dependent is reachable from the prerequisite,
  -- the new edge closes a loop. Depth-bounded; the portfolio has no honest
  -- dependency chain a hundred tasks deep.
  if exists (
    with recursive waits_on(task_id, depth) as (
      select dependency.depends_on_task_id, 1
      from public.task_dependencies dependency
      where dependency.task_id = p_prerequisite_task_id
        and dependency.organization_id = dependent_task.organization_id
      union all
      select dependency.depends_on_task_id, waits_on.depth + 1
      from public.task_dependencies dependency
      join waits_on on waits_on.task_id = dependency.task_id
      where dependency.organization_id = dependent_task.organization_id
        and waits_on.depth < 100
    )
    select 1 from waits_on where waits_on.task_id = p_dependent_task_id
  ) then
    raise exception using errcode = '22023',
      message = 'this dependency would create a cycle';
  end if;

  insert into public.task_dependencies (
    organization_id, task_id, depends_on_task_id, created_by
  ) values (
    dependent_task.organization_id, p_dependent_task_id,
    p_prerequisite_task_id, caller_id
  )
  returning id into created_dependency_id;

  -- Coupling is recorded on both sides: the waiting project learns what it
  -- waits on, and the prerequisite project learns who waits on it.
  perform public.record_activity_event(
    dependent_task.organization_id, dependent_task.project_id,
    'task.cross_project_dependency_declared'::public.activity_event_type,
    'task', dependent_task.id,
    'Cross-project dependency declared: this project''s task now waits on another project',
    jsonb_build_object(
      'reason', trimmed_reason,
      'prerequisiteTaskId', prerequisite_task.id,
      'prerequisiteProjectId', prerequisite_task.project_id
    )
  );
  perform public.record_activity_event(
    prerequisite_task.organization_id, prerequisite_task.project_id,
    'task.cross_project_dependency_declared'::public.activity_event_type,
    'task', prerequisite_task.id,
    'Cross-project dependency declared: another project''s task now waits on this project',
    jsonb_build_object(
      'reason', trimmed_reason,
      'dependentTaskId', dependent_task.id,
      'dependentProjectId', dependent_task.project_id
    )
  );

  return query select created_dependency_id, dependent_task.id, prerequisite_task.id;
end;
$function$;

create or replace function public.release_cross_project_dependency(
  p_dependent_task_id uuid,
  p_prerequisite_task_id uuid,
  p_reason text default null
)
returns table (dependency_id uuid, dependent_task_id uuid, prerequisite_task_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  trimmed_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  dependent_task public.tasks%rowtype;
  prerequisite_task public.tasks%rowtype;
  released_dependency_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  -- Releasing a coupling is as consequential as declaring one: the waiting
  -- project starts. The reason is recorded, not optional.
  if trimmed_reason is null then
    raise exception using errcode = '22023',
      message = 'a release reason is required';
  end if;

  select task.* into dependent_task
  from public.tasks task
  where task.id = p_dependent_task_id
    and public.is_organization_owner(task.organization_id)
  for update of task;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  select task.* into prerequisite_task
  from public.tasks task
  where task.id = p_prerequisite_task_id
    and task.organization_id = dependent_task.organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  -- Same-project edges are submission evidence, guarded by submit_command's
  -- replay comparison. This control releases only the coupling it can create.
  if dependent_task.project_id = prerequisite_task.project_id then
    raise exception using errcode = '22023',
      message = 'same-project dependencies are submission evidence and are not released here';
  end if;

  delete from public.task_dependencies dependency
  where dependency.task_id = p_dependent_task_id
    and dependency.depends_on_task_id = p_prerequisite_task_id
    and dependency.organization_id = dependent_task.organization_id
  returning dependency.id into released_dependency_id;
  if released_dependency_id is null then
    raise exception using errcode = 'P0002', message = 'dependency not found';
  end if;

  perform public.record_activity_event(
    dependent_task.organization_id, dependent_task.project_id,
    'task.cross_project_dependency_released'::public.activity_event_type,
    'task', dependent_task.id,
    'Cross-project dependency released: this project''s task no longer waits on another project',
    jsonb_build_object(
      'reason', trimmed_reason,
      'prerequisiteTaskId', prerequisite_task.id,
      'prerequisiteProjectId', prerequisite_task.project_id
    )
  );
  perform public.record_activity_event(
    prerequisite_task.organization_id, prerequisite_task.project_id,
    'task.cross_project_dependency_released'::public.activity_event_type,
    'task', prerequisite_task.id,
    'Cross-project dependency released: another project''s task no longer waits on this project',
    jsonb_build_object(
      'reason', trimmed_reason,
      'dependentTaskId', dependent_task.id,
      'dependentProjectId', dependent_task.project_id
    )
  );

  return query select released_dependency_id, dependent_task.id, prerequisite_task.id;
end;
$function$;

-- submit_command, carried forward from 20260813001100 with one change in the
-- idempotency replay comparison, marked below. Everything else is verbatim.
create or replace function public.submit_command(
  p_project_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid, task_id uuid, command_state public.command_status,
  task_state public.task_status, requires_owner_approval boolean, was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  command_type_value text;
  normalized_prompt text := lower(btrim(coalesce(p_prompt, '')));
  normalized_parameters jsonb;
  normalized_criteria jsonb;
  dependency_ids jsonb;
  risk_floor public.risk_level;
  effective_risk public.risk_level;
  project_record public.projects%rowtype;
  submission record;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if jsonb_typeof(coalesce(p_parameters, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_parameters, '{}'::jsonb)::text) > 65536
    or public.jsonb_has_sensitive_keys(coalesce(p_parameters, '{}'::jsonb))
    or (select array_agg(parameter_key order by parameter_key)
        from jsonb_object_keys(coalesce(p_parameters, '{}'::jsonb)) parameter_key)
      is distinct from array[
        'acceptanceCriteria','agentRole','budget','commandType','dependencyTaskIds',
        'executionMode','model','plan','provider','repositoryBinding','riskAssessment'
      ]::text[] then
    raise exception using errcode = '22023',
      message = 'invalid or unsupported Phase 1C command parameters';
  end if;

  command_type_value := p_parameters ->> 'commandType';
  if command_type_value not in (
    'fix_bug','build_feature','audit','test','mobile','security','performance','other'
  ) or jsonb_typeof(p_parameters -> 'acceptanceCriteria') <> 'array'
    or jsonb_array_length(p_parameters -> 'acceptanceCriteria') > 12
    or exists (
      select 1 from jsonb_array_elements(p_parameters -> 'acceptanceCriteria') criterion
      where jsonb_typeof(criterion) <> 'string'
        or char_length(btrim(criterion #>> '{}')) not between 3 and 500
        or criterion #>> '{}' is distinct from btrim(criterion #>> '{}')
        or public.text_has_likely_secret(criterion #>> '{}')
    )
    or jsonb_array_length(p_parameters -> 'acceptanceCriteria') is distinct from (
      select count(distinct criterion #>> '{}')::integer
      from jsonb_array_elements(p_parameters -> 'acceptanceCriteria') criterion
    ) then
    raise exception using errcode = '22023',
      message = 'invalid or unsupported Phase 1C command parameters';
  end if;

  normalized_criteria := p_parameters -> 'acceptanceCriteria';
  if jsonb_array_length(normalized_criteria) = 0 then
    normalized_criteria := jsonb_build_array(case command_type_value
      when 'fix_bug' then
        'The reported defect is fixed and verified without unrelated regressions.'
      when 'build_feature' then
        'The requested feature works as described and passes applicable validation.'
      when 'audit' then
        'The audit findings are documented with cited evidence and prioritized follow-up.'
      when 'test' then
        'The requested test coverage passes and protects the specified behavior.'
      when 'mobile' then
        'The requested mobile behavior is verified at supported responsive widths.'
      when 'security' then
        'The requested security change is verified against the applicable authorization boundary.'
      when 'performance' then
        'The requested performance improvement is measured and preserves existing behavior.'
      else
        'The requested outcome is implemented and verified without unrelated changes.'
    end);
  end if;

  dependency_ids := p_parameters -> 'dependencyTaskIds';
  if jsonb_typeof(dependency_ids) <> 'array'
    or jsonb_array_length(dependency_ids) > 20
    or exists (
      select 1 from jsonb_array_elements(dependency_ids) dependency
      where jsonb_typeof(dependency) <> 'string'
        or dependency #>> '{}' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or exists (
      select 1 from (
        select dependency #>> '{}' as dependency_id,
          lag(dependency #>> '{}') over (order by dependency_order) as previous_id
        from jsonb_array_elements(dependency_ids)
          with ordinality listed(dependency, dependency_order)
      ) ordered
      where ordered.previous_id is not null
        and ordered.dependency_id <= ordered.previous_id
    ) then
    raise exception using errcode = '22023', message = 'invalid command dependencies';
  end if;

  select project.* into project_record
  from public.projects project
  where project.id = p_project_id
    and public.is_organization_owner(project.organization_id);
  if not found then
    raise exception using errcode = '42501',
      message = 'only an organization owner may submit a command';
  end if;

  -- Use one deliberately generic failure for missing, cross-tenant,
  -- cross-project, failed, and cancelled IDs so this boundary cannot enumerate
  -- another tenant's tasks.
  if jsonb_array_length(dependency_ids) <> (
    select count(*)::integer
    from public.tasks dependency_task
    where dependency_task.id in (
      select (dependency #>> '{}')::uuid
      from jsonb_array_elements(dependency_ids) dependency
    )
      and dependency_task.organization_id = project_record.organization_id
      and dependency_task.project_id = project_record.id
      and dependency_task.status not in (
        'failed'::public.task_status, 'cancelled'::public.task_status
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid command dependencies';
  end if;

  normalized_parameters := jsonb_set(
    p_parameters, '{acceptanceCriteria}', normalized_criteria, true
  );
  select normalized_prompt || ' '
    || coalesce(string_agg(lower(criterion #>> '{}'), ' '), '')
  into normalized_prompt
  from jsonb_array_elements(normalized_criteria) criterion;

  risk_floor := case
    when command_type_value = 'security'
      or normalized_prompt ~ '(\mauth\M|authentication|authorization|oauth|session|cookie|rbac|permission|secret|credential|password|private[ _-]?key|api[ _-]?key|token|rls|row[ -]?level security|service[ _-]?role|production database|delete production|drop table|truncate|dns|domain ownership|billing|payment|money|auto[ -]?(merge|deploy|rollback|approve)|branch protection)'
      then 'red'::public.risk_level
    when command_type_value in ('fix_bug','build_feature','mobile','performance','other')
      or normalized_prompt ~ '(schema|migration|database|dependency|package(\.json)?|lockfile|upgrade|api|backend|frontend|component|route|workflow|configuration|refactor|feature|bug|performance|mobile|accessibility)'
      then 'yellow'::public.risk_level
    else 'green'::public.risk_level
  end;
  effective_risk := greatest(
    coalesce(p_requested_risk, 'green'::public.risk_level), risk_floor
  );
  normalized_parameters := jsonb_set(
    normalized_parameters, '{riskAssessment}',
    coalesce(normalized_parameters -> 'riskAssessment', '{}'::jsonb)
      || jsonb_build_object(
        'effectiveRisk', effective_risk::text,
        'classificationSource', 'database_policy'
      ), true
  );
  normalized_parameters := jsonb_set(
    normalized_parameters, '{agentRole}', to_jsonb(case command_type_value
      when 'audit' then 'qa' when 'test' then 'qa' when 'mobile' then 'frontend'
      when 'security' then 'security' when 'performance' then 'performance'
      when 'build_feature' then 'architect' when 'fix_bug' then 'backend'
      else 'orchestrator' end), true
  );

  select * into submission
  from public.submit_command_phase1a_internal(
    p_project_id, p_prompt, effective_risk, normalized_parameters, p_idempotency_key
  );

  -- The idempotency comparison above includes the normalized criteria and the
  -- exact canonical dependency array. Replays may repair a missing edge, but
  -- an unexplained extra edge is never silently erased.
  --
  -- THE ONE CHANGE in this carry-forward: only same-project edges count as
  -- submission evidence here. A cross-project edge can only exist through
  -- declare_cross_project_dependency, which is owner-authorized and records
  -- its own activity evidence in both projects — it is explained elsewhere,
  -- and must not fail an honest replay of the originating command.
  if exists (
    select 1 from public.task_dependencies dependency
    join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
      and prerequisite.organization_id = dependency.organization_id
    where dependency.task_id = submission.task_id
      and dependency.organization_id = project_record.organization_id
      and prerequisite.project_id = project_record.id
      and dependency.depends_on_task_id not in (
        select (requested #>> '{}')::uuid
        from jsonb_array_elements(dependency_ids) requested
      )
  ) then
    raise exception using errcode = '55000',
      message = 'idempotent command dependency evidence conflicts';
  end if;

  insert into public.task_dependencies (
    organization_id, task_id, depends_on_task_id, created_by
  )
  select project_record.organization_id, submission.task_id,
    (dependency #>> '{}')::uuid, caller_id
  from jsonb_array_elements(dependency_ids) dependency
  on conflict on constraint task_dependencies_unique do nothing;

  return query select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created;
end;
$function$;

revoke all on function public.declare_cross_project_dependency(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_cross_project_dependency(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.declare_cross_project_dependency(uuid, uuid, text) to authenticated;
grant execute on function public.release_cross_project_dependency(uuid, uuid, text) to authenticated;
