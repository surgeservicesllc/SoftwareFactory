-- Phase 2E: give each project its own logical agents.
--
-- The defect this fixes is not visible in any single project, which is why it
-- survived Phase 1C intact.
--
-- `claim_phase1c_run` refuses to start a run whose agent already holds a live
-- lease. That rule is correct — `agents.current_assignment` names one task, so
-- an agent running in two places is misreporting at least one of them. But the
-- logical roster was organization-wide: one QA, one Backend, one Frontend for
-- the whole factory. Two projects each asking for a feature therefore contend
-- for the same Backend agent and run strictly one after another, whatever the
-- portfolio ceilings say and however many workers are idle.
--
-- So the portfolio could be given priorities, focus, ceilings and a reserve,
-- and still execute exactly one project at a time. Goal 16 — independent work
-- may execute concurrently — was unreachable while the roster was shared.
--
-- The fix does not touch the exclusion rule, and does not add a table:
-- `agents.project_id` has existed since the control-plane schema. The
-- organization-wide roster row remains the definition of a role, and a
-- project-scoped agent is cloned from it the first time that project asks for
-- that role. Existing organization-wide rows are left exactly as they are.

create or replace function public.plan_phase1c_task_and_run()
returns trigger language plpgsql security definer set search_path = pg_catalog as $function$
declare
  command_record public.commands%rowtype;
  binding jsonb;
  budget jsonb;
  role_text text;
  provider_text text;
  model_text text;
  repository_record record;
  agent_record public.agents%rowtype;
begin
  if new.command_id is null then return new; end if;

  select command.* into command_record from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found then return new; end if;
  new.acceptance_criteria := command_record.acceptance_criteria;
  if command_record.requested_risk = 'red'::public.risk_level then return new; end if;
  if command_record.requested_risk not in ('green'::public.risk_level, 'yellow'::public.risk_level)
    or new.status <> 'queued'::public.task_status then
    raise exception using errcode = '55000', message = 'only queued manual GREEN or YELLOW commands enter Phase 1C';
  end if;

  binding := command_record.parameters -> 'repositoryBinding';
  budget := command_record.parameters -> 'budget';
  role_text := command_record.parameters ->> 'agentRole';
  provider_text := command_record.parameters ->> 'provider';
  model_text := command_record.parameters ->> 'model';
  if jsonb_typeof(binding) <> 'object' or jsonb_typeof(budget) <> 'object'
    or role_text not in ('orchestrator','product','architect','frontend','backend','database','qa','security','performance','release','ceo_reporter')
    or provider_text <> 'openai' or model_text <> 'gpt-5.3-codex'
    or coalesce(binding ->> 'repositoryId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'connectionId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'installationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or coalesce(binding ->> 'externalInstallationId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'externalRepositoryId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'appId', '') !~ '^[1-9][0-9]{0,18}$'
    or coalesce(binding ->> 'baseSha', '') !~ '^[0-9a-fA-F]{40}$'
    or char_length(coalesce(binding ->> 'baseBranch', '')) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'Phase 1C execution binding is incomplete';
  end if;

  select project.id as project_id into repository_record
  from public.projects project
  join public.project_connections link on link.project_id = project.id
    and link.organization_id = project.organization_id and link.is_primary
  join public.connections connection on connection.id = link.connection_id
    and connection.organization_id = link.organization_id
  join public.github_installations installation on installation.connection_id = connection.id
    and installation.organization_id = connection.organization_id
  join public.github_repositories repository on repository.id = link.github_repository_id
    and repository.installation_id = installation.id and repository.organization_id = link.organization_id
  where project.id = new.project_id and project.organization_id = new.organization_id
    and project.status = 'active'::public.project_status
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status
    and installation.status = 'active' and installation.suspended_at is null
    and repository.selected and not repository.archived and not repository.disabled
    and repository.id = (binding ->> 'repositoryId')::uuid
    and connection.id = (binding ->> 'connectionId')::uuid
    and installation.id = (binding ->> 'installationId')::uuid
    and installation.external_installation_id = (binding ->> 'externalInstallationId')::bigint
    and repository.external_repository_id = (binding ->> 'externalRepositoryId')::bigint
    and installation.app_id = (binding ->> 'appId')::bigint
    and repository.default_branch = binding ->> 'baseBranch'
    and project.github_repository = repository.full_name
    and project.default_branch = repository.default_branch;
  if not found then
    raise exception using errcode = '55000', message = 'Phase 1C repository binding changed before queueing';
  end if;

  -- One logical agent per role per *project*, rather than one per role per
  -- organization.
  --
  -- The scheduler refuses a second concurrent run for one agent, and it is
  -- right to: `agents.current_assignment` names a single task, so an agent in
  -- two places at once would be lying about one of them. But with a single
  -- shared roster, that correct rule means two projects doing the same kind of
  -- work serialise against each other no matter how much capacity the
  -- portfolio has — the portfolio concurrency goal defeated by an identity
  -- detail rather than by any real constraint.
  --
  -- `agents.project_id` already exists for exactly this. The shared roster row
  -- stays the definition of a role; a project-scoped agent is cloned from it on
  -- first use, so names, descriptions and capabilities are still declared in
  -- one place.
  select agent.* into agent_record from public.agents agent
  where agent.organization_id = new.organization_id
    and agent.project_id = new.project_id
    and agent.role = role_text::public.agent_role
    and agent.provider is null and agent.model is null
  order by agent.created_at asc limit 1 for update;

  if not found then
    select agent.* into agent_record from public.agents agent
    where agent.organization_id = new.organization_id and agent.project_id is null
      and agent.role = role_text::public.agent_role
      and agent.name = case role_text
        when 'ceo_reporter' then 'CEO Reporter'
        when 'qa' then 'QA'
        else initcap(replace(role_text, '_', ' ')) end
      and agent.provider is null and agent.model is null
    order by agent.created_at asc limit 1 for update;
    if not found then
      perform public.initialize_standard_logical_agent_roster(
        new.organization_id,
        command_record.submitted_by
      );
      select agent.* into agent_record from public.agents agent
      where agent.organization_id = new.organization_id and agent.project_id is null
        and agent.role = role_text::public.agent_role
        and agent.name = case role_text
          when 'ceo_reporter' then 'CEO Reporter'
          when 'qa' then 'QA'
          else initcap(replace(role_text, '_', ' ')) end
        and agent.provider is null and agent.model is null
      order by agent.created_at asc limit 1 for update;
    end if;
    if not found then
      raise exception using errcode = '55000', message = 'standard logical agent roster is unavailable';
    end if;

    insert into public.agents (
      organization_id, project_id, name, role, description, status,
      provider, model, capabilities, created_by
    ) values (
      new.organization_id, new.project_id, agent_record.name, agent_record.role,
      agent_record.description, 'idle'::public.agent_status, null, null,
      agent_record.capabilities, command_record.submitted_by
    )
    returning * into agent_record;
  end if;
  new.assigned_agent_id := agent_record.id;
  return new;
end;
$function$;
revoke all on function public.plan_phase1c_task_and_run()
  from public, anon, authenticated, service_role;

comment on function public.plan_phase1c_task_and_run() is
  'Binds a queued Phase 1C task to a project-scoped logical agent cloned from the organization roster, so two projects can execute the same role concurrently.';
