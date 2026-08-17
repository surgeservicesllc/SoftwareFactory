-- Many bots on one project, each configured independently.
--
-- `bot_assignments` already carried the relationship — which bot serves which
-- project, in which role — and `assign_bot` already moved one bot at a time.
-- What it could not express is the part that makes several bots on one project
-- useful rather than merely possible: what each one is responsible for, what it
-- is allowed to touch, how much of it may run at once, and who has to say yes
-- first. Without that, "assign three bots" means three identical bots.
--
-- Two rules are structural here rather than advisory, because a permission
-- model that can be talked out of is not one:
--
--   * Authority is nested. Opening a pull request requires write access to the
--     repository; merging one requires being able to open it. A configuration
--     that grants the outer authority without the inner is rejected by the
--     database, not normalized into something plausible.
--   * Elevated authority keeps its human. Merging a pull request and reaching
--     production both force `requires_human_approval` to stay on, matching
--     `policies/AUTO_MERGE_POLICY.md`: Phase 1 has no autonomous merge or
--     deployment authority, and a row here must not imply otherwise.
--
-- Defaults are least privilege: read the repository, open nothing, touch no
-- pipeline or environment, one task at a time, approval required.
--
-- Assignment remains routing intent. Nothing in this migration connects an
-- executor, and the activity events it writes say so.

-- ---------------------------------------------------------------------------
-- A value-level safety test for the short string arrays this table stores.
--
-- `jsonb_has_sensitive_keys` inspects object *keys*, which says nothing about
-- an array of plain strings. Responsibilities and tool names are exactly that,
-- and they are browser-readable, so they get a check of their own. Immutable so
-- a CHECK constraint may call it.
-- ---------------------------------------------------------------------------
create or replace function public.jsonb_string_array_is_safe(
  input_value jsonb,
  max_entries integer,
  max_length integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  item jsonb;
  entry_text text;
begin
  if input_value is null then
    return true;
  end if;
  if jsonb_typeof(input_value) <> 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(input_value) > max_entries then
    return false;
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(input_value)
  loop
    if jsonb_typeof(item) <> 'string' then
      return false;
    end if;
    entry_text := item #>> '{}';
    if pg_catalog.btrim(entry_text) = '' or char_length(entry_text) > max_length then
      return false;
    end if;
    if public.text_has_likely_secret(entry_text) then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

revoke all on function public.jsonb_string_array_is_safe(jsonb, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The per-assignment configuration.
--
-- Text with CHECK rather than new enum types: these vocabularies are expected
-- to grow (a new pipeline scope, a new environment tier), and widening a check
-- is an ordinary forward migration where widening an enum is not reversible.
-- ---------------------------------------------------------------------------
alter table public.bot_assignments
  add column if not exists preset text,
  add column if not exists responsibilities jsonb not null default '[]'::jsonb,
  add column if not exists instructions text,
  add column if not exists repository_access text not null default 'read',
  add column if not exists branch_strategy text not null default 'per_task_branch',
  add column if not exists can_open_pull_request boolean not null default false,
  add column if not exists can_merge_pull_request boolean not null default false,
  add column if not exists pipeline_access text not null default 'none',
  add column if not exists environment_access text not null default 'none',
  add column if not exists tools jsonb not null default '[]'::jsonb,
  add column if not exists requires_human_approval boolean not null default true,
  add column if not exists max_concurrent_tasks integer not null default 1,
  add column if not exists priority integer not null default 2;

do $bot_assignment_configuration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_preset_shape'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_preset_shape check (
        preset is null or preset ~ '^[a-z][a-z0-9-]{1,38}$'
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_responsibilities_safe'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_responsibilities_safe check (
        public.jsonb_string_array_is_safe(responsibilities, 12, 160)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_tools_safe'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_tools_safe check (
        public.jsonb_string_array_is_safe(tools, 16, 60)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_instructions_bounded'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_instructions_bounded check (
        instructions is null or (
          char_length(instructions) between 1 and 4000
          and not public.text_has_likely_secret(instructions)
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_repository_access_known'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_repository_access_known check (
        repository_access in ('none', 'read', 'write')
      );
  end if;

  -- No direct default-branch option exists because the platform has no such
  -- authority: every published change is an isolated branch and a draft pull
  -- request. Offering the value would describe a capability that is absent.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_branch_strategy_known'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_branch_strategy_known check (
        branch_strategy in ('per_task_branch', 'shared_project_branch')
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_pipeline_access_known'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_pipeline_access_known check (
        pipeline_access in ('none', 'assigned', 'all')
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_environment_access_known'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_environment_access_known check (
        environment_access in ('none', 'preview', 'production')
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_concurrency_bounded'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_concurrency_bounded check (
        max_concurrent_tasks between 1 and 10
      );
  end if;

  -- P0 through P3, the same ladder the portfolio scheduler already arbitrates.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_priority_bounded'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_priority_bounded check (priority between 0 and 3);
  end if;

  -- Authority is nested: a bot that cannot write cannot open a pull request,
  -- and one that cannot open cannot merge. Enforced here so no caller — route,
  -- script, or future worker — can assemble an incoherent grant.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_authority_nested'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_authority_nested check (
        (not can_open_pull_request or repository_access = 'write')
        and (not can_merge_pull_request or can_open_pull_request)
      );
  end if;

  -- Elevated authority keeps its human. `policies/AUTO_MERGE_POLICY.md` gives
  -- Phase 1 no autonomous merge or production authority; a stored row must not
  -- be able to claim otherwise.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'bot_assignments_elevated_requires_approval'
  ) then
    alter table public.bot_assignments
      add constraint bot_assignments_elevated_requires_approval check (
        requires_human_approval
        or (not can_merge_pull_request and environment_access <> 'production')
      );
  end if;
end
$bot_assignment_configuration$;

comment on column public.bot_assignments.preset is
  'The role preset this configuration started from, kept for display only; the stored columns are authoritative.';
comment on column public.bot_assignments.requires_human_approval is
  'Whether work from this bot needs a person before it lands. Forced on for merge or production authority.';

create index if not exists bot_assignments_project_priority_idx
  on public.bot_assignments (project_id, priority, assigned_at)
  where status <> 'released'::public.bot_assignment_status;

-- ---------------------------------------------------------------------------
-- Reading one configuration out of a jsonb payload.
--
-- Shared by the bulk assign and the single reconfigure so both apply exactly
-- the same validation. Unknown keys are ignored rather than rejected: the
-- payload is assembled server-side from a validated schema, and the columns'
-- own constraints are the boundary that matters.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_bot_assignment_configuration(p_configuration jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  source jsonb := coalesce(p_configuration, '{}'::jsonb);
  instructions text;
begin
  if jsonb_typeof(source) <> 'object' then
    raise exception using errcode = '22023',
      message = 'bot configuration must be an object';
  end if;

  instructions := nullif(
    pg_catalog.btrim(coalesce(source ->> 'instructions', '')), ''
  );

  return pg_catalog.jsonb_build_object(
    'preset', nullif(pg_catalog.btrim(coalesce(source ->> 'preset', '')), ''),
    'responsibilities', coalesce(source -> 'responsibilities', '[]'::jsonb),
    'instructions', instructions,
    'repository_access', coalesce(nullif(source ->> 'repository_access', ''), 'read'),
    'branch_strategy', coalesce(nullif(source ->> 'branch_strategy', ''), 'per_task_branch'),
    'can_open_pull_request', coalesce((source ->> 'can_open_pull_request')::boolean, false),
    'can_merge_pull_request', coalesce((source ->> 'can_merge_pull_request')::boolean, false),
    'pipeline_access', coalesce(nullif(source ->> 'pipeline_access', ''), 'none'),
    'environment_access', coalesce(nullif(source ->> 'environment_access', ''), 'none'),
    'tools', coalesce(source -> 'tools', '[]'::jsonb),
    'requires_human_approval', coalesce((source ->> 'requires_human_approval')::boolean, true),
    'max_concurrent_tasks', coalesce((source ->> 'max_concurrent_tasks')::integer, 1),
    'priority', coalesce((source ->> 'priority')::integer, 2)
  );
end;
$function$;

revoke all on function public.normalize_bot_assignment_configuration(jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assign several bots to one project, atomically.
--
-- One transaction for the whole batch is the point. Assigning four bots as
-- four calls can half-succeed, leaving a project staffed by whichever ones
-- happened to land before the failure — and the person who asked has no way to
-- tell which. Here the batch either lands whole or changes nothing.
--
-- A bot already posted to this project is reconfigured rather than refused, so
-- re-running the same assignment is idempotent. A bot posted elsewhere moves,
-- because a bot holds at most one open posting — the invariant the partial
-- unique index has always enforced. Both cases are recorded distinctly.
-- ---------------------------------------------------------------------------
create or replace function public.assign_bots_to_project(
  p_organization_id uuid,
  p_project_id uuid,
  p_assignments jsonb
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_entry jsonb;
  v_bot_id uuid;
  v_role_id uuid;
  v_configuration jsonb;
  v_seen uuid[] := array[]::uuid[];
  v_assignment public.bot_assignments%rowtype;
  v_previous_project_id uuid;
  v_transition public.activity_event_type;
  v_readiness public.bot_readiness;
begin
  if jsonb_typeof(coalesce(p_assignments, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023',
      message = 'a list of bot assignments is required';
  end if;
  if pg_catalog.jsonb_array_length(p_assignments) = 0 then
    raise exception using errcode = '22023',
      message = 'select at least one bot to assign';
  end if;
  -- Bounded so one request cannot hold write locks across an unbounded roster.
  if pg_catalog.jsonb_array_length(p_assignments) > 25 then
    raise exception using errcode = '22023',
      message = 'at most 25 bots may be assigned in one request';
  end if;

  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id
      and project.status <> 'archived'::public.project_status
  ) then
    raise exception using errcode = 'P0002',
      message = 'project was not found for this organization';
  end if;

  for v_entry in select value from pg_catalog.jsonb_array_elements(p_assignments)
  loop
    v_bot_id := (v_entry ->> 'bot_id')::uuid;
    v_role_id := (v_entry ->> 'role_id')::uuid;

    if v_bot_id is null or v_role_id is null then
      raise exception using errcode = '22023',
        message = 'every assignment needs a bot and a role';
    end if;

    -- The same bot twice in one payload would apply two configurations to one
    -- posting, and the last one silently wins. Refused rather than resolved.
    if v_bot_id = any (v_seen) then
      raise exception using errcode = '22023',
        message = 'the same bot was selected more than once';
    end if;
    v_seen := v_seen || v_bot_id;

    select bot.readiness into v_readiness
    from public.bots bot
    where bot.id = v_bot_id and bot.organization_id = p_organization_id;

    if not found then
      raise exception using errcode = 'P0002',
        message = 'bot was not found for this organization';
    end if;
    -- A disabled bot is a durable statement that it must not be given work.
    -- Live credential state is checked by the caller, which can see the vault;
    -- this is the part the database itself can be certain of.
    if v_readiness = 'disabled'::public.bot_readiness then
      raise exception using errcode = '22023',
        message = 'a disabled bot cannot be assigned';
    end if;

    if not exists (
      select 1 from public.bot_roles role_definition
      where role_definition.id = v_role_id
        and role_definition.organization_id = p_organization_id
    ) then
      raise exception using errcode = 'P0002',
        message = 'role was not found for this organization';
    end if;

    v_configuration := public.normalize_bot_assignment_configuration(v_entry);

    select assignment.project_id into v_previous_project_id
    from public.bot_assignments assignment
    where assignment.bot_id = v_bot_id
      and assignment.organization_id = p_organization_id
      and assignment.status <> 'released'::public.bot_assignment_status
    for update;

    if v_previous_project_id is null then
      insert into public.bot_assignments (
        organization_id, bot_id, project_id, role_id, created_by,
        preset, responsibilities, instructions, repository_access, branch_strategy,
        can_open_pull_request, can_merge_pull_request, pipeline_access,
        environment_access, tools, requires_human_approval, max_concurrent_tasks, priority
      ) values (
        p_organization_id, v_bot_id, p_project_id, v_role_id, v_caller_id,
        v_configuration ->> 'preset',
        v_configuration -> 'responsibilities',
        v_configuration ->> 'instructions',
        v_configuration ->> 'repository_access',
        v_configuration ->> 'branch_strategy',
        (v_configuration ->> 'can_open_pull_request')::boolean,
        (v_configuration ->> 'can_merge_pull_request')::boolean,
        v_configuration ->> 'pipeline_access',
        v_configuration ->> 'environment_access',
        v_configuration -> 'tools',
        (v_configuration ->> 'requires_human_approval')::boolean,
        (v_configuration ->> 'max_concurrent_tasks')::integer,
        (v_configuration ->> 'priority')::integer
      )
      returning * into v_assignment;
      v_transition := 'bot.assigned'::public.activity_event_type;
    else
      update public.bot_assignments assignment
      set
        project_id = p_project_id,
        role_id = v_role_id,
        status = 'active'::public.bot_assignment_status,
        assigned_at = now(),
        released_at = null,
        preset = v_configuration ->> 'preset',
        responsibilities = v_configuration -> 'responsibilities',
        instructions = v_configuration ->> 'instructions',
        repository_access = v_configuration ->> 'repository_access',
        branch_strategy = v_configuration ->> 'branch_strategy',
        can_open_pull_request = (v_configuration ->> 'can_open_pull_request')::boolean,
        can_merge_pull_request = (v_configuration ->> 'can_merge_pull_request')::boolean,
        pipeline_access = v_configuration ->> 'pipeline_access',
        environment_access = v_configuration ->> 'environment_access',
        tools = v_configuration -> 'tools',
        requires_human_approval = (v_configuration ->> 'requires_human_approval')::boolean,
        max_concurrent_tasks = (v_configuration ->> 'max_concurrent_tasks')::integer,
        priority = (v_configuration ->> 'priority')::integer
      where assignment.bot_id = v_bot_id
        and assignment.organization_id = p_organization_id
        and assignment.status <> 'released'::public.bot_assignment_status
      returning * into v_assignment;
      v_transition := case
        when v_previous_project_id is distinct from p_project_id
          then 'bot.moved'::public.activity_event_type
        else 'bot.assignment_changed'::public.activity_event_type
      end;
    end if;

    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    ) values (
      p_organization_id,
      v_assignment.project_id,
      v_caller_id,
      v_transition,
      'bot_assignment',
      v_assignment.id,
      'Bot assigned to project with its configuration. Assignment is routing intent, not execution.',
      pg_catalog.jsonb_build_object(
        'bot_id', v_assignment.bot_id,
        'role_id', v_assignment.role_id,
        'preset', v_assignment.preset,
        'previous_project_id', v_previous_project_id,
        'repository_access', v_assignment.repository_access,
        'can_open_pull_request', v_assignment.can_open_pull_request,
        'can_merge_pull_request', v_assignment.can_merge_pull_request,
        'pipeline_access', v_assignment.pipeline_access,
        'environment_access', v_assignment.environment_access,
        'requires_human_approval', v_assignment.requires_human_approval,
        'max_concurrent_tasks', v_assignment.max_concurrent_tasks,
        'priority', v_assignment.priority,
        'executor_connected', false
      )
    );

    return next v_assignment;
  end loop;

  return;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Change one posting's configuration, or its status, after the fact.
--
-- Status and configuration travel together because pausing a bot while editing
-- what it may touch is one intent, and splitting it into two calls leaves a
-- window where the new permissions are live and the pause is not.
-- ---------------------------------------------------------------------------
create or replace function public.update_bot_assignment_configuration(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_configuration jsonb,
  p_role_id uuid default null,
  p_status public.bot_assignment_status default null
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_assignment public.bot_assignments%rowtype;
  v_configuration jsonb := public.normalize_bot_assignment_configuration(p_configuration);
  v_status public.bot_assignment_status;
begin
  select assignment.* into v_assignment
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'assignment was not found for this organization';
  end if;

  v_status := coalesce(p_status, v_assignment.status);

  -- A released posting is a closed record. Reopening it would rewrite history
  -- that the activity feed already reported; assign the bot again instead.
  if v_assignment.status = 'released'::public.bot_assignment_status then
    raise exception using errcode = '22023',
      message = 'this posting was released; assign the bot again to bring it back';
  end if;

  if p_role_id is not null and not exists (
    select 1 from public.bot_roles role_definition
    where role_definition.id = p_role_id
      and role_definition.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002',
      message = 'role was not found for this organization';
  end if;

  update public.bot_assignments assignment
  set
    role_id = coalesce(p_role_id, assignment.role_id),
    status = v_status,
    released_at = case
      when v_status = 'released'::public.bot_assignment_status then now()
      else null
    end,
    preset = v_configuration ->> 'preset',
    responsibilities = v_configuration -> 'responsibilities',
    instructions = v_configuration ->> 'instructions',
    repository_access = v_configuration ->> 'repository_access',
    branch_strategy = v_configuration ->> 'branch_strategy',
    can_open_pull_request = (v_configuration ->> 'can_open_pull_request')::boolean,
    can_merge_pull_request = (v_configuration ->> 'can_merge_pull_request')::boolean,
    pipeline_access = v_configuration ->> 'pipeline_access',
    environment_access = v_configuration ->> 'environment_access',
    tools = v_configuration -> 'tools',
    requires_human_approval = (v_configuration ->> 'requires_human_approval')::boolean,
    max_concurrent_tasks = (v_configuration ->> 'max_concurrent_tasks')::integer,
    priority = (v_configuration ->> 'priority')::integer
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
  returning * into v_assignment;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    v_assignment.project_id,
    v_caller_id,
    'bot.assignment_changed'::public.activity_event_type,
    'bot_assignment',
    v_assignment.id,
    'Bot posting reconfigured. Assignment is routing intent, not execution.',
    pg_catalog.jsonb_build_object(
      'bot_id', v_assignment.bot_id,
      'role_id', v_assignment.role_id,
      'status', v_assignment.status::text,
      'repository_access', v_assignment.repository_access,
      'can_open_pull_request', v_assignment.can_open_pull_request,
      'can_merge_pull_request', v_assignment.can_merge_pull_request,
      'pipeline_access', v_assignment.pipeline_access,
      'environment_access', v_assignment.environment_access,
      'requires_human_approval', v_assignment.requires_human_approval,
      'max_concurrent_tasks', v_assignment.max_concurrent_tasks,
      'priority', v_assignment.priority,
      'executor_connected', false
    )
  );

  return next v_assignment;
end;
$function$;

revoke all on function public.assign_bots_to_project(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.update_bot_assignment_configuration(
  uuid, uuid, jsonb, uuid, public.bot_assignment_status
) from public, anon, authenticated;

grant execute on function public.assign_bots_to_project(uuid, uuid, jsonb) to authenticated;
grant execute on function public.update_bot_assignment_configuration(
  uuid, uuid, jsonb, uuid, public.bot_assignment_status
) to authenticated;
