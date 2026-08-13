-- Close browser access to sensitive control-plane columns and expose only
-- bounded tenant-scoped list RPCs. Every RPC derives identity from auth.uid().

revoke select on table public.agents from authenticated;
revoke select on table public.commands from authenticated;
revoke select on table public.tasks from authenticated;
revoke select on table public.agent_runs from authenticated;
revoke select on table public.reports from authenticated;

create or replace function public.list_agents(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  role public.agent_role,
  description text,
  status public.agent_status,
  provider text,
  model text,
  last_run_at timestamptz,
  capabilities jsonb
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select agent.id, agent.name, agent.role, left(agent.description, 1000), agent.status,
    agent.provider, agent.model, agent.last_run_at,
    case
      when pg_catalog.octet_length(agent.capabilities::text) <= 8192 then agent.capabilities
      else '[]'::jsonb
    end
  from public.agents agent
  where agent.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by agent.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_tasks(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  title text,
  status public.task_status,
  risk_level public.risk_level,
  requires_owner_approval boolean,
  priority smallint,
  created_at timestamptz,
  project_id uuid,
  project_name text,
  assigned_agent_id uuid,
  agent_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select task.id, task.title, task.status, task.risk_level,
    task.requires_owner_approval, task.priority, task.created_at,
    project.id, project.name, agent.id, agent.name
  from public.tasks task
  left join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  left join public.agents agent
    on agent.id = task.assigned_agent_id and agent.organization_id = task.organization_id
  where task.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by task.priority desc, task.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_agent_runs(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  status public.run_status,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  task_id uuid,
  task_title text,
  agent_id uuid,
  agent_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select run.id, run.status, run.started_at, run.completed_at, run.created_at,
    task.id, task.title, agent.id, agent.name
  from public.agent_runs run
  left join public.tasks task
    on task.id = run.task_id and task.organization_id = run.organization_id
  left join public.agents agent
    on agent.id = run.agent_id and agent.organization_id = run.organization_id
  where run.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by run.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_reports(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  type public.report_type,
  status public.report_status,
  title text,
  summary text,
  period_start timestamptz,
  period_end timestamptz,
  published_at timestamptz,
  created_at timestamptz,
  project_id uuid,
  project_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select report.id, report.type, report.status, report.title, left(report.summary, 1000),
    report.period_start, report.period_end, report.published_at, report.created_at,
    project.id, project.name
  from public.reports report
  left join public.projects project
    on project.id = report.project_id and project.organization_id = report.organization_id
  where report.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by report.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

create or replace function public.list_commands(
  p_organization_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  prompt text,
  requested_risk public.risk_level,
  status public.command_status,
  submitted_at timestamptz,
  completed_at timestamptz,
  project_id uuid,
  project_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select command.id, command.prompt, command.requested_risk, command.status,
    command.submitted_at, command.completed_at, project.id, project.name
  from public.commands command
  left join public.projects project
    on project.id = command.project_id and project.organization_id = command.organization_id
  where command.organization_id = p_organization_id
    and public.is_organization_member(p_organization_id)
  order by command.submitted_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

revoke all on function public.list_agents(uuid, integer) from public, anon;
revoke all on function public.list_tasks(uuid, integer) from public, anon;
revoke all on function public.list_agent_runs(uuid, integer) from public, anon;
revoke all on function public.list_reports(uuid, integer) from public, anon;
revoke all on function public.list_commands(uuid, integer) from public, anon;

grant execute on function public.list_agents(uuid, integer) to authenticated;
grant execute on function public.list_tasks(uuid, integer) to authenticated;
grant execute on function public.list_agent_runs(uuid, integer) to authenticated;
grant execute on function public.list_reports(uuid, integer) to authenticated;
grant execute on function public.list_commands(uuid, integer) to authenticated;

comment on function public.list_agents(uuid, integer) is
  'Caller-bound, tenant-scoped agent list that omits ownership and audit columns.';
comment on function public.list_tasks(uuid, integer) is
  'Caller-bound, tenant-scoped task list that omits input and result payloads.';
comment on function public.list_agent_runs(uuid, integer) is
  'Caller-bound, tenant-scoped run list that omits provider references, payloads, and raw errors.';
comment on function public.list_reports(uuid, integer) is
  'Caller-bound, tenant-scoped report list that omits report content.';
comment on function public.list_commands(uuid, integer) is
  'Caller-bound, tenant-scoped command list that omits parameters and idempotency data.';
