-- Durable command routing for the AI Factory.
--
-- A project pipeline selection and a bot assignment are mutable intent. A
-- command route is historical evidence: which exact selection, posting, bot,
-- role, model, and permission snapshot authorized this command at submission
-- time. The evidence therefore deliberately does not foreign-key back to
-- project_pipelines, bot_assignments, bots, roles, or templates. Those records
-- may later be deselected, released, retired, removed, or edited; none of
-- those lifecycle actions may erase or rewrite what routed an earlier command.
--
-- Nothing here starts a worker, releases a kill switch, or widens autonomy.
-- submit_factory_command delegates command/task creation to the existing
-- submit_command boundary and adds only an atomic, immutable routing record.

alter type public.activity_event_type add value if not exists 'command.routed';

-- The triple is already unique because commands.id is the primary key. Naming
-- the exact composite relationship lets the routing table enforce that its
-- command, project, and tenant can never disagree, even under privileged SQL.
alter table public.commands
  add constraint commands_id_project_organization_unique
  unique (id, project_id, organization_id);

create table public.factory_command_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  command_id uuid not null,
  project_pipeline_id uuid not null,
  pipeline_template_key text not null
    check (pipeline_template_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  pipeline_template_id uuid,
  assignment_id uuid not null,
  bot_id uuid not null,
  role_id uuid not null,
  routing_snapshot jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint factory_command_routes_command_scope_fk
    foreign key (command_id, project_id, organization_id)
    references public.commands (id, project_id, organization_id) on delete restrict,
  constraint factory_command_routes_one_route_per_command unique (command_id),
  constraint factory_command_routes_snapshot_object
    check (jsonb_typeof(routing_snapshot) = 'object'),
  constraint factory_command_routes_snapshot_bounded
    check (octet_length(routing_snapshot::text) <= 65536),
  constraint factory_command_routes_snapshot_safe
    check (not public.jsonb_has_sensitive_keys(routing_snapshot))
);

comment on table public.factory_command_routes is
  'Immutable tenant-scoped evidence of the selected pipeline and bot posting that routed a command. It starts no execution and survives later selection or roster changes.';

create index factory_command_routes_project_idx
  on public.factory_command_routes (project_id, created_at desc);
create index factory_command_routes_assignment_idx
  on public.factory_command_routes (assignment_id, created_at desc);
create index factory_command_routes_pipeline_idx
  on public.factory_command_routes (project_pipeline_id, created_at desc);

alter table public.factory_command_routes enable row level security;
alter table public.factory_command_routes force row level security;

-- There is intentionally no direct browser or service-role table path. The
-- two bounded definer functions below expose only routing candidates and the
-- one route created in the current command transaction.
revoke all on table public.factory_command_routes
  from public, anon, authenticated, service_role;

create or replace function public.reject_factory_command_route_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'factory command routing evidence is immutable';
end;
$function$;

revoke all on function public.reject_factory_command_route_mutation()
  from public, anon, authenticated, service_role;

create trigger factory_command_routes_immutable
before update or delete on public.factory_command_routes
for each row execute function public.reject_factory_command_route_mutation();

-- Candidate rows are intentionally richer than a boolean eligibility answer.
-- The server feeds them through the reviewed TypeScript router so every
-- refusal remains explainable, while submit_factory_command rechecks the same
-- mutable facts under a lock before it persists anything.
create or replace function public.list_factory_command_routing_candidates(
  p_organization_id uuid,
  p_project_id uuid,
  p_template_key text
)
returns table (
  project_pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  assignment_id uuid,
  bot_id uuid,
  bot_name text,
  role_id uuid,
  role_slug text,
  role_risk_ceiling public.risk_level,
  assignment_status public.bot_assignment_status,
  is_configured boolean,
  current_readiness public.bot_readiness,
  ai_account_status text,
  provider public.bot_provider,
  model text,
  assignment_model text,
  work_effort text,
  assignment_config jsonb,
  assigned_pipeline_keys text[],
  in_flight integer,
  max_concurrent_tasks integer,
  has_capacity boolean,
  assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_template_key text := pg_catalog.btrim(coalesce(p_template_key, ''));
  v_project public.projects%rowtype;
  v_selection public.project_pipelines%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.status = 'active'::public.project_status;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'active project was not found for this organization';
  end if;

  select selection.* into v_selection
  from public.project_pipelines selection
  where selection.organization_id = p_organization_id
    and selection.project_id = p_project_id
    and selection.template_key = v_template_key;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'selected project pipeline was not found';
  end if;

  return query
  select
    v_selection.id,
    v_selection.template_key,
    v_selection.template_id,
    assignment.id,
    bot.id,
    bot.name,
    role_definition.id,
    role_definition.slug,
    role_definition.risk_ceiling,
    assignment.status,
    not (
      assignment.preset is null
      and assignment.responsibilities = '[]'::jsonb
      and pg_catalog.btrim(coalesce(assignment.instructions, '')) = ''
      and assignment.repository_access = 'read'
      and assignment.branch_strategy = 'per_task_branch'
      and assignment.can_open_pull_request = false
      and assignment.can_merge_pull_request = false
      and assignment.pipeline_access = 'none'
      and assignment.environment_access = 'none'
      and assignment.tools = '[]'::jsonb
      and assignment.requires_human_approval = true
      and assignment.max_concurrent_tasks = 1
      and assignment.priority = 2
      and assignment.model is null
      and assignment.work_effort = 'medium'
    ),
    case
      when bot.ai_account_id is not null
        and coalesce(account.status, '') <> 'connected'
        then 'not_connected'::public.bot_readiness
      else bot.readiness
    end,
    account.status,
    bot.provider,
    coalesce(assignment.model, bot.model),
    assignment.model,
    assignment.work_effort,
    pg_catalog.jsonb_build_object(
      'preset', assignment.preset,
      'responsibilities', assignment.responsibilities,
      'instructions', assignment.instructions,
      'repositoryAccess', assignment.repository_access,
      'branchStrategy', assignment.branch_strategy,
      'canOpenPullRequest', assignment.can_open_pull_request,
      'canMergePullRequest', assignment.can_merge_pull_request,
      'pipelineAccess', assignment.pipeline_access,
      'environmentAccess', assignment.environment_access,
      'tools', assignment.tools,
      'requiresHumanApproval', assignment.requires_human_approval,
      'maxConcurrentTasks', assignment.max_concurrent_tasks,
      'priority', assignment.priority
    ),
    array(
      select scope.template_key
      from public.project_pipelines scope
      where scope.organization_id = p_organization_id
        and scope.project_id = p_project_id
      order by scope.template_key
    ),
    (
      select pg_catalog.count(*)::integer
      from public.factory_command_routes route
      join public.commands command
        on command.id = route.command_id
       and command.organization_id = route.organization_id
      where route.organization_id = p_organization_id
        and route.assignment_id = assignment.id
        and command.status in (
          'submitted'::public.command_status,
          'awaiting_approval'::public.command_status,
          'queued'::public.command_status,
          'running'::public.command_status
        )
    ),
    assignment.max_concurrent_tasks,
    (
      select pg_catalog.count(*)::integer < assignment.max_concurrent_tasks
      from public.factory_command_routes route
      join public.commands command
        on command.id = route.command_id
       and command.organization_id = route.organization_id
      where route.organization_id = p_organization_id
        and route.assignment_id = assignment.id
        and command.status in (
          'submitted'::public.command_status,
          'awaiting_approval'::public.command_status,
          'queued'::public.command_status,
          'running'::public.command_status
        )
    ),
    assignment.assigned_at
  from public.bot_assignments assignment
  join public.bots bot
    on bot.id = assignment.bot_id
   and bot.organization_id = assignment.organization_id
  join public.bot_roles role_definition
    on role_definition.id = assignment.role_id
   and role_definition.organization_id = assignment.organization_id
  left join public.ai_accounts account
    on account.id = bot.ai_account_id
   and account.organization_id = bot.organization_id
  where assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
  order by assignment.priority asc, assignment.assigned_at asc, assignment.id asc;
end;
$function$;

-- Create the command and its immutable route in one transaction. Any routing
-- failure rolls back submit_command's command/task/run writes. Replays verify
-- route identity and the full canonical live snapshot before capacity, so a
-- same-key retry never asks for a second slot while a changed route fails
-- closed instead of silently rewriting history.
create or replace function public.submit_factory_command(
  p_organization_id uuid,
  p_project_id uuid,
  p_project_pipeline_id uuid,
  p_assignment_id uuid,
  p_prompt text,
  p_requested_risk public.risk_level default 'green'::public.risk_level,
  p_parameters jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns table (
  command_id uuid,
  task_id uuid,
  command_state public.command_status,
  task_state public.task_status,
  requires_owner_approval boolean,
  was_created boolean,
  route_id uuid,
  project_pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  assignment_id uuid,
  bot_id uuid,
  role_id uuid,
  routing_snapshot jsonb
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_project public.projects%rowtype;
  v_selection public.project_pipelines%rowtype;
  v_template public.graph_templates%rowtype;
  v_assignment public.bot_assignments%rowtype;
  v_bot public.bots%rowtype;
  v_role public.bot_roles%rowtype;
  v_account_status text;
  v_current_readiness public.bot_readiness;
  v_resolved_model text;
  v_effective_risk public.risk_level;
  v_configuration jsonb;
  v_snapshot jsonb;
  v_submission record;
  v_existing_route public.factory_command_routes%rowtype;
  v_route public.factory_command_routes%rowtype;
  v_in_flight integer;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may submit a command';
  end if;

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.status = 'active'::public.project_status;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'active project was not found for this organization';
  end if;

  -- Hold the selected intent row until the route snapshot is durable. A later
  -- deselection remains allowed because factory_command_routes keeps ids and
  -- snapshots, not a deletion-cascading foreign key back to this row.
  select selection.* into v_selection
  from public.project_pipelines selection
  where selection.id = p_project_pipeline_id
    and selection.organization_id = p_organization_id
    and selection.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'selected project pipeline was not found';
  end if;

  -- Serializing on the posting makes count-then-insert a real capacity gate,
  -- not two concurrent callers both observing the same final free slot.
  select assignment.* into v_assignment
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
  for update;
  if not found or v_assignment.status <> 'active'::public.bot_assignment_status then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not active for this project';
  end if;

  select bot.* into v_bot
  from public.bots bot
  where bot.id = v_assignment.bot_id
    and bot.organization_id = p_organization_id
  for update;
  select role_definition.* into v_role
  from public.bot_roles role_definition
  where role_definition.id = v_assignment.role_id
    and role_definition.organization_id = p_organization_id
  for update;
  if v_bot.id is null or v_role.id is null then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not active for this project';
  end if;

  if v_assignment.preset is null
    and v_assignment.responsibilities = '[]'::jsonb
    and pg_catalog.btrim(coalesce(v_assignment.instructions, '')) = ''
    and v_assignment.repository_access = 'read'
    and v_assignment.branch_strategy = 'per_task_branch'
    and v_assignment.can_open_pull_request = false
    and v_assignment.can_merge_pull_request = false
    and v_assignment.pipeline_access = 'none'
    and v_assignment.environment_access = 'none'
    and v_assignment.tools = '[]'::jsonb
    and v_assignment.requires_human_approval = true
    and v_assignment.max_concurrent_tasks = 1
    and v_assignment.priority = 2
    and v_assignment.model is null
    and v_assignment.work_effort = 'medium' then
    raise exception using errcode = '55000',
      message = 'selected bot assignment is not configured';
  end if;
  if v_assignment.repository_access <> 'write' then
    raise exception using errcode = '55000',
      message = 'selected bot assignment cannot write the repository';
  end if;
  if not v_assignment.can_open_pull_request then
    raise exception using errcode = '55000',
      message = 'selected bot assignment cannot open pull requests';
  end if;
  if v_assignment.pipeline_access not in ('assigned', 'all') then
    raise exception using errcode = '55000',
      message = 'selected bot assignment cannot run this pipeline';
  end if;
  v_resolved_model := coalesce(v_assignment.model, v_bot.model);
  if pg_catalog.btrim(coalesce(p_parameters ->> 'provider', '')) <> v_bot.provider::text
    or pg_catalog.btrim(coalesce(p_parameters ->> 'model', '')) <> v_resolved_model then
    raise exception using errcode = '55000',
      message = 'selected bot does not match command execution provider and model';
  end if;

  if v_bot.ai_account_id is not null then
    select account.status into v_account_status
    from public.ai_accounts account
    where account.id = v_bot.ai_account_id
      and account.organization_id = p_organization_id
    for update;
  end if;
  v_current_readiness := case
    when v_bot.ai_account_id is not null
      and coalesce(v_account_status, '') <> 'connected'
      then 'not_connected'::public.bot_readiness
    else v_bot.readiness
  end;
  if v_current_readiness <> 'ready'::public.bot_readiness then
    raise exception using errcode = '55000', message = 'selected bot is not ready';
  end if;

  if v_selection.template_id is not null then
    select template.* into v_template
    from public.graph_templates template
    where template.id = v_selection.template_id
      and template.organization_id = p_organization_id
      and template.slug = v_selection.template_key
      and template.is_archived = false
    for update;
    if not found then
      raise exception using errcode = 'P0002',
        message = 'selected project pipeline was not found';
    end if;
  end if;

  select pg_catalog.count(*)::integer into v_in_flight
  from public.factory_command_routes route
  join public.commands command
    on command.id = route.command_id
   and command.organization_id = route.organization_id
  where route.organization_id = p_organization_id
    and route.assignment_id = v_assignment.id
    and command.status in (
      'submitted'::public.command_status,
      'awaiting_approval'::public.command_status,
      'queued'::public.command_status,
      'running'::public.command_status
    );

  v_configuration := pg_catalog.jsonb_build_object(
    'preset', v_assignment.preset,
    'responsibilities', v_assignment.responsibilities,
    'instructions', v_assignment.instructions,
    'repositoryAccess', v_assignment.repository_access,
    'branchStrategy', v_assignment.branch_strategy,
    'canOpenPullRequest', v_assignment.can_open_pull_request,
    'canMergePullRequest', v_assignment.can_merge_pull_request,
    'pipelineAccess', v_assignment.pipeline_access,
    'environmentAccess', v_assignment.environment_access,
    'tools', v_assignment.tools,
    'requiresHumanApproval', v_assignment.requires_human_approval,
    'maxConcurrentTasks', v_assignment.max_concurrent_tasks,
    'priority', v_assignment.priority
  );
  -- Mutable selection, assignment, provider, and readiness validation happens
  -- before the existing authoritative submit. Because this is one transaction,
  -- a later effective-risk, route, or capacity refusal rolls every delegated
  -- command/task/run write back automatically.
  select * into v_submission
  from public.submit_command(
    p_project_id,
    p_prompt,
    p_requested_risk,
    p_parameters,
    p_idempotency_key
  );

  -- submit_command owns the policy that raises a caller's requested risk from
  -- the normalized command type, prompt, and acceptance criteria. Read back
  -- that persisted result rather than trusting the caller's lower bound. The
  -- row lock keeps the effective command evidence stable through route insert.
  select command.requested_risk into v_effective_risk
  from public.commands command
  where command.id = v_submission.command_id
    and command.organization_id = p_organization_id
    and command.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'submitted command risk evidence was not found';
  end if;

  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'command', pg_catalog.jsonb_build_object(
      'effectiveRisk', v_effective_risk::text
    ),
    'project', pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id
    ),
    'pipeline', pg_catalog.jsonb_build_object(
      'selectionId', v_selection.id,
      'templateKey', v_selection.template_key,
      'templateId', v_selection.template_id,
      'template', case when v_selection.template_id is null then null else
        pg_catalog.jsonb_build_object(
          'name', v_template.name,
          'version', v_template.version,
          'topology', v_template.topology::text,
          'definition', v_template.definition,
          'defaultBudget', v_template.default_budget
        ) end
    ),
    'assignment', pg_catalog.jsonb_build_object(
      'assignmentId', v_assignment.id,
      'status', v_assignment.status::text,
      'botId', v_bot.id,
      'botName', v_bot.name,
      'provider', v_bot.provider::text,
      'model', v_resolved_model,
      'modelOverride', v_assignment.model,
      'workEffort', v_assignment.work_effort,
      'currentReadiness', v_current_readiness::text,
      'aiAccountStatus', v_account_status,
      'roleId', v_role.id,
      'roleSlug', v_role.slug,
      'roleRiskCeiling', v_role.risk_ceiling::text,
      'config', v_configuration
    )
  );

  select route.* into v_existing_route
  from public.factory_command_routes route
  where route.command_id = v_submission.command_id;
  if found then
    -- Both the persisted effective risk and the role ceiling are part of the
    -- immutable snapshot. Exact replay therefore proves the same risk gate
    -- that was enforced when the route was first inserted, while any later
    -- role or command drift remains an idempotency conflict rather than a
    -- rewrite of historical evidence.
    if v_existing_route.organization_id <> p_organization_id
      or v_existing_route.project_id <> p_project_id
      or v_existing_route.project_pipeline_id <> v_selection.id
      or v_existing_route.pipeline_template_key <> v_selection.template_key
      or v_existing_route.pipeline_template_id is distinct from v_selection.template_id
      or v_existing_route.assignment_id <> v_assignment.id
      or v_existing_route.bot_id <> v_bot.id
      or v_existing_route.role_id <> v_role.id
      or v_existing_route.routing_snapshot <> v_snapshot then
      raise exception using errcode = '22023',
        message = 'idempotent factory command routing evidence conflicts';
    end if;
    v_route := v_existing_route;
  else
    -- A command created before this routing boundary has no trustworthy
    -- historical assignment snapshot. Attaching today's roster state to it
    -- would manufacture evidence, so an idempotent replay may verify but may
    -- never backfill a missing route.
    if not v_submission.was_created::boolean then
      raise exception using errcode = '22023',
        message = 'idempotent command predates factory routing evidence';
    end if;
    if v_role.risk_ceiling < v_effective_risk then
      raise exception using errcode = '55000',
        message = 'selected bot role risk ceiling is too low';
    end if;
    if v_in_flight >= v_assignment.max_concurrent_tasks then
      raise exception using errcode = '55000',
        message = 'selected bot assignment is at its concurrency limit';
    end if;

    insert into public.factory_command_routes (
      organization_id, project_id, command_id,
      project_pipeline_id, pipeline_template_key, pipeline_template_id,
      assignment_id, bot_id, role_id, routing_snapshot, created_by
    ) values (
      p_organization_id, p_project_id, v_submission.command_id,
      v_selection.id, v_selection.template_key, v_selection.template_id,
      v_assignment.id, v_bot.id, v_role.id, v_snapshot, v_caller
    )
    returning * into v_route;

    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    ) values (
      p_organization_id,
      p_project_id,
      v_caller,
      'command.routed'::public.activity_event_type,
      'factory_command_route',
      v_route.id,
      'Command routed through a selected project pipeline to an active bot posting. Execution was not started.',
      pg_catalog.jsonb_build_object(
        'command_id', v_submission.command_id,
        'project_pipeline_id', v_selection.id,
        'pipeline_template_key', v_selection.template_key,
        'assignment_id', v_assignment.id,
        'bot_id', v_bot.id,
        'role_id', v_role.id,
        'worker_started', false,
        'autonomy_changed', false
      )
    );
  end if;

  return query select
    v_submission.command_id::uuid,
    v_submission.task_id::uuid,
    v_submission.command_state::public.command_status,
    v_submission.task_state::public.task_status,
    v_submission.requires_owner_approval::boolean,
    v_submission.was_created::boolean,
    v_route.id,
    v_route.project_pipeline_id,
    v_route.pipeline_template_key,
    v_route.pipeline_template_id,
    v_route.assignment_id,
    v_route.bot_id,
    v_route.role_id,
    v_route.routing_snapshot;
end;
$function$;

-- Resolve an already-routed idempotent command from its immutable evidence,
-- before any caller consults today's repository base, roster, readiness, or
-- capacity. The row shape extends submit_factory_command's exact projection
-- with the canonical stored parameters and a bounded current repository name:
-- command/task states, was_created=false, route identity/snapshot,
-- command_parameters, repository_full_name.
create or replace function public.resolve_factory_command_replay(
  p_organization_id uuid,
  p_project_id uuid,
  p_pipeline_template_key text,
  p_prompt text,
  p_requested_risk public.risk_level,
  p_command_type text,
  p_acceptance_criteria jsonb,
  p_dependency_task_ids jsonb,
  p_idempotency_key text
)
returns table (
  command_id uuid,
  task_id uuid,
  command_state public.command_status,
  task_state public.task_status,
  requires_owner_approval boolean,
  was_created boolean,
  route_id uuid,
  project_pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  assignment_id uuid,
  bot_id uuid,
  role_id uuid,
  routing_snapshot jsonb,
  command_parameters jsonb,
  repository_full_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_pipeline_template_key text := pg_catalog.btrim(coalesce(p_pipeline_template_key, ''));
  v_prompt text := pg_catalog.btrim(coalesce(p_prompt, ''));
  v_command_type text := pg_catalog.btrim(coalesce(p_command_type, ''));
  v_idempotency_key text := pg_catalog.btrim(coalesce(p_idempotency_key, ''));
  v_acceptance_criteria jsonb := coalesce(p_acceptance_criteria, 'null'::jsonb);
  v_dependency_task_ids jsonb := coalesce(p_dependency_task_ids, 'null'::jsonb);
  v_command public.commands%rowtype;
  v_task public.tasks%rowtype;
  v_route public.factory_command_routes%rowtype;
  v_repository_full_name text;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may resolve a factory command replay';
  end if;

  if v_pipeline_template_key !~ '^[a-z][a-z0-9_]{0,79}$'
    or char_length(v_prompt) not between 1 and 4000
    or public.text_has_likely_secret(v_prompt)
    or v_command_type not in (
      'fix_bug', 'build_feature', 'audit', 'test', 'mobile',
      'security', 'performance', 'other'
    )
    or p_requested_risk is null
    or char_length(v_idempotency_key) not between 8 and 128
    or v_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023',
      message = 'invalid factory command replay intent';
  end if;

  if pg_catalog.jsonb_typeof(v_acceptance_criteria) <> 'array'
    or pg_catalog.octet_length(v_acceptance_criteria::text) > 8192 then
    raise exception using errcode = '22023',
      message = 'invalid factory command replay intent';
  end if;
  if pg_catalog.jsonb_array_length(v_acceptance_criteria) > 12
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_acceptance_criteria) criterion
      where pg_catalog.jsonb_typeof(criterion) <> 'string'
        or char_length(pg_catalog.btrim(criterion #>> '{}')) not between 3 and 500
        or criterion #>> '{}' is distinct from pg_catalog.btrim(criterion #>> '{}')
        or public.text_has_likely_secret(criterion #>> '{}')
    )
    or pg_catalog.jsonb_array_length(v_acceptance_criteria) is distinct from (
      select pg_catalog.count(distinct criterion #>> '{}')::integer
      from pg_catalog.jsonb_array_elements(v_acceptance_criteria) criterion
    ) then
    raise exception using errcode = '22023',
      message = 'invalid factory command replay intent';
  end if;

  if pg_catalog.jsonb_typeof(v_dependency_task_ids) <> 'array'
    or pg_catalog.octet_length(v_dependency_task_ids::text) > 4096 then
    raise exception using errcode = '22023',
      message = 'invalid factory command replay intent';
  end if;
  if pg_catalog.jsonb_array_length(v_dependency_task_ids) > 20
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_dependency_task_ids) dependency
      where pg_catalog.jsonb_typeof(dependency) <> 'string'
        or dependency #>> '{}' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from (
        select dependency #>> '{}' as dependency_id,
          pg_catalog.lag(dependency #>> '{}') over (order by dependency_order) as previous_id
        from pg_catalog.jsonb_array_elements(v_dependency_task_ids)
          with ordinality listed(dependency, dependency_order)
      ) ordered
      where ordered.previous_id is not null
        and ordered.dependency_id <= ordered.previous_id
    ) then
    raise exception using errcode = '22023',
      message = 'invalid factory command replay intent';
  end if;

  -- Caller, project, and key are all part of the lookup. A key owned by a
  -- different user, project, or tenant is indistinguishable from no key.
  select command.* into v_command
  from public.commands command
  where command.organization_id = p_organization_id
    and command.project_id = p_project_id
    and command.submitted_by = v_caller
    and command.idempotency_key = v_idempotency_key;
  if not found then
    return;
  end if;

  select route.* into v_route
  from public.factory_command_routes route
  where route.command_id = v_command.id
    and route.organization_id = p_organization_id
    and route.project_id = p_project_id;
  if not found then
    raise exception using errcode = '22023',
      message = 'idempotent command predates factory routing evidence';
  end if;

  if v_command.prompt <> v_prompt
    or v_command.parameters ->> 'commandType' is distinct from v_command_type
    or v_command.parameters -> 'acceptanceCriteria' is distinct from v_acceptance_criteria
    or v_command.parameters -> 'dependencyTaskIds' is distinct from v_dependency_task_ids
    or v_command.parameters #>> '{riskAssessment,requestedRisk}'
      is distinct from p_requested_risk::text
    or v_route.pipeline_template_key <> v_pipeline_template_key then
    raise exception using errcode = '22023',
      message = 'idempotency key was already used for a different factory command intent';
  end if;

  select task.* into v_task
  from public.tasks task
  where task.organization_id = p_organization_id
    and task.project_id = p_project_id
    and task.command_id = v_command.id
  order by task.created_at asc, task.id asc
  limit 1;
  if not found then
    raise exception using errcode = '55000',
      message = 'factory command replay task evidence was not found';
  end if;

  select pg_catalog.left(repository.full_name, 201) into v_repository_full_name
  from public.project_connections link
  join public.github_repositories repository
    on repository.id = link.github_repository_id
   and repository.organization_id = link.organization_id
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and link.is_primary
  order by link.updated_at desc, link.id asc
  limit 1;
  if not found then
    select pg_catalog.left(project.github_repository, 201) into v_repository_full_name
    from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id;
  end if;

  return query select
    v_command.id,
    v_task.id,
    v_command.status,
    v_task.status,
    v_task.requires_owner_approval,
    false,
    v_route.id,
    v_route.project_pipeline_id,
    v_route.pipeline_template_key,
    v_route.pipeline_template_id,
    v_route.assignment_id,
    v_route.bot_id,
    v_route.role_id,
    v_route.routing_snapshot,
    v_command.parameters,
    v_repository_full_name;
end;
$function$;

revoke all on function public.list_factory_command_routing_candidates(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.resolve_factory_command_replay(
  uuid, uuid, text, text, public.risk_level, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;

grant execute on function public.list_factory_command_routing_candidates(uuid, uuid, text)
  to authenticated;
grant execute on function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) to authenticated;
grant execute on function public.resolve_factory_command_replay(
  uuid, uuid, text, text, public.risk_level, text, jsonb, jsonb, text
) to authenticated;

comment on function public.list_factory_command_routing_candidates(uuid, uuid, text) is
  'Member-scoped candidate projection for one exact selected project pipeline. It exposes no credentials and returns no sentinel row when the roster is empty.';
comment on function public.submit_factory_command(
  uuid, uuid, uuid, uuid, text, public.risk_level, jsonb, text
) is
  'Atomically applies submit_command semantics and records or verifies one immutable selected-pipeline-to-bot route. It never dispatches a worker or changes autonomy.';
comment on function public.resolve_factory_command_replay(
  uuid, uuid, text, text, public.risk_level, text, jsonb, jsonb, text
) is
  'Owner- and caller-scoped exact idempotency resolver. It returns an immutable factory route plus canonical command parameters without revalidating mutable repository base state, assignment readiness, or capacity.';
