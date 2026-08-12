-- Transactional workflows, immutable audit events, and RED execution gates.
-- Phase 1A persists control-plane intent only; no function in this migration starts
-- an agent, changes production, merges code, or deploys software.

create or replace function public.record_activity_event(
  target_organization_id uuid,
  target_project_id uuid,
  target_event_type public.activity_event_type,
  target_entity_type text,
  target_entity_id uuid,
  target_description text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  event_id uuid;
begin
  if target_organization_id is null then
    raise exception using errcode = '23502', message = 'organization is required for activity events';
  end if;

  if public.jsonb_has_sensitive_keys(coalesce(target_metadata, '{}'::jsonb)) then
    raise exception using errcode = '23514', message = 'activity metadata contains sensitive data';
  end if;

  insert into public.activity_events (
    organization_id,
    project_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    metadata
  )
  values (
    target_organization_id,
    target_project_id,
    auth.uid(),
    target_event_type,
    target_entity_type,
    target_entity_id,
    target_description,
    coalesce(target_metadata, '{}'::jsonb)
  )
  returning id into event_id;

  return event_id;
end;
$function$;

create or replace function public.audit_organization_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.record_activity_event(
    new.id,
    null,
    'organization.created'::public.activity_event_type,
    'organization',
    new.id,
    'Organization created',
    pg_catalog.jsonb_build_object('name', new.name)
  );
  return new;
end;
$function$;

create or replace function public.audit_project_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.created'::public.activity_event_type,
      'project',
      new.id,
      'Project created',
      pg_catalog.jsonb_build_object('name', new.name, 'status', new.status)
    );
    return new;
  end if;

  perform public.record_activity_event(
    new.organization_id,
    new.id,
    'project.updated'::public.activity_event_type,
    'project',
    new.id,
    'Project updated',
    pg_catalog.jsonb_build_object('name', new.name, 'status', new.status)
  );

  if new.autonomous_mode is distinct from old.autonomous_mode then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.autonomous_mode_changed'::public.activity_event_type,
      'project',
      new.id,
      'Autonomous mode changed',
      pg_catalog.jsonb_build_object('from', old.autonomous_mode, 'to', new.autonomous_mode)
    );
  end if;

  if new.maximum_autonomous_risk is distinct from old.maximum_autonomous_risk then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.risk_authorization_changed'::public.activity_event_type,
      'project',
      new.id,
      'Maximum autonomous risk changed',
      pg_catalog.jsonb_build_object('from', old.maximum_autonomous_risk, 'to', new.maximum_autonomous_risk)
    );
  end if;

  if row(new.auto_approve, new.auto_merge, new.auto_deploy, new.auto_rollback)
    is distinct from row(old.auto_approve, old.auto_merge, old.auto_deploy, old.auto_rollback) then
    perform public.record_activity_event(
      new.organization_id,
      new.id,
      'project.automation_controls_changed'::public.activity_event_type,
      'project',
      new.id,
      'Automation controls changed',
      pg_catalog.jsonb_build_object(
        'auto_approve', new.auto_approve,
        'auto_merge', new.auto_merge,
        'auto_deploy', new.auto_deploy,
        'auto_rollback', new.auto_rollback
      )
    );
  end if;

  return new;
end;
$function$;

create or replace function public.audit_connection_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  connection_row public.connections%rowtype;
begin
  connection_row := case when tg_op = 'DELETE' then old else new end;

  perform public.record_activity_event(
    connection_row.organization_id,
    null,
    'connection.changed'::public.activity_event_type,
    'connection',
    connection_row.id,
    'Connection changed',
    pg_catalog.jsonb_build_object(
      'operation', pg_catalog.lower(tg_op),
      'provider', connection_row.provider,
      'status', connection_row.status,
      'name', connection_row.name
    )
  );

  return connection_row;
end;
$function$;

create or replace function public.audit_project_connection_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  link_row public.project_connections%rowtype;
begin
  link_row := case when tg_op = 'DELETE' then old else new end;

  perform public.record_activity_event(
    link_row.organization_id,
    link_row.project_id,
    'connection.changed'::public.activity_event_type,
    'project_connection',
    link_row.id,
    'Project connection changed',
    pg_catalog.jsonb_build_object(
      'operation', pg_catalog.lower(tg_op),
      'connection_id', link_row.connection_id,
      'is_primary', link_row.is_primary
    )
  );

  return link_row;
end;
$function$;

create or replace function public.audit_command_submitted()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.record_activity_event(
    new.organization_id,
    new.project_id,
    'command.submitted'::public.activity_event_type,
    'command',
    new.id,
    'Bot Manager command submitted',
    pg_catalog.jsonb_build_object('risk', new.requested_risk, 'status', new.status)
  );
  return new;
end;
$function$;

create or replace function public.audit_task_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.record_activity_event(
    new.organization_id,
    new.project_id,
    'task.created'::public.activity_event_type,
    'task',
    new.id,
    'Task created',
    pg_catalog.jsonb_build_object('risk', new.risk_level, 'status', new.status, 'command_id', new.command_id)
  );
  return new;
end;
$function$;

create or replace function public.audit_agent_started()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.status = 'running'::public.run_status
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.record_activity_event(
      new.organization_id,
      new.project_id,
      'agent.started'::public.activity_event_type,
      'agent_run',
      new.id,
      'Agent run started',
      pg_catalog.jsonb_build_object('agent_id', new.agent_id, 'task_id', new.task_id)
    );
  end if;
  return new;
end;
$function$;

create or replace function public.audit_pull_request_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform public.record_activity_event(
    new.organization_id,
    new.project_id,
    'pull_request.created'::public.activity_event_type,
    'pull_request',
    new.id,
    'Pull request created',
    pg_catalog.jsonb_build_object(
      'repository', new.repository,
      'number', new.external_number,
      'status', new.status
    )
  );
  return new;
end;
$function$;

create or replace function public.audit_deployment_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.status = 'in_progress'::public.deployment_status
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.record_activity_event(
      new.organization_id,
      new.project_id,
      'deployment.started'::public.activity_event_type,
      'deployment',
      new.id,
      'Deployment started',
      pg_catalog.jsonb_build_object('environment', new.environment, 'commit_sha', new.commit_sha)
    );
  end if;

  if (
    new.status = 'rolling_back'::public.deployment_status
    and (tg_op = 'INSERT' or old.status is distinct from new.status)
  ) or (
    tg_op = 'INSERT' and new.rollback_of_deployment_id is not null
  ) then
    perform public.record_activity_event(
      new.organization_id,
      new.project_id,
      'deployment.rollback_initiated'::public.activity_event_type,
      'deployment',
      new.id,
      'Rollback initiated',
      pg_catalog.jsonb_build_object('rollback_of_deployment_id', new.rollback_of_deployment_id)
    );
  end if;

  return new;
end;
$function$;

create or replace function public.audit_approval_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.record_activity_event(
      new.organization_id,
      new.project_id,
      'approval.requested'::public.activity_event_type,
      'approval',
      new.id,
      'Owner approval requested',
      pg_catalog.jsonb_build_object('kind', new.kind, 'task_id', new.task_id, 'command_id', new.command_id)
    );
  elsif new.status is distinct from old.status and new.status <> 'pending'::public.approval_status then
    perform public.record_activity_event(
      new.organization_id,
      new.project_id,
      'approval.decided'::public.activity_event_type,
      'approval',
      new.id,
      'Owner approval decided',
      pg_catalog.jsonb_build_object('kind', new.kind, 'decision', new.status)
    );
  end if;
  return new;
end;
$function$;

create or replace function public.reject_activity_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000', message = 'activity events are append-only';
end;
$function$;

create or replace function public.protect_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  remaining_owner_count integer;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception using errcode = '23514', message = 'organization membership user_id is immutable';
  end if;

  if old.role = 'owner'::public.organization_member_role
    and (tg_op = 'DELETE' or new.role <> 'owner'::public.organization_member_role) then
    -- Serialize owner removals/demotions per organization so two concurrent
    -- transactions cannot both observe the other owner and remove the last two.
    perform 1
    from public.organizations organization
    where organization.id = old.organization_id
    for update;

    select count(*)
    into remaining_owner_count
    from public.organization_members member
    where member.organization_id = old.organization_id
      and member.role = 'owner'::public.organization_member_role
      and member.id <> old.id;

    if remaining_owner_count = 0 then
      raise exception using errcode = '23514', message = 'an organization must retain at least one owner';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function public.enforce_safe_project_controls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if new.autonomous_mode
      or new.maximum_autonomous_risk <> 'green'::public.risk_level
      or new.auto_approve
      or new.auto_merge
      or new.auto_deploy
      or new.auto_rollback then
      raise exception using
        errcode = '23514',
        message = 'new projects must start with autonomous and destructive controls disabled';
    end if;
    return new;
  end if;

  if row(
    new.autonomous_mode,
    new.maximum_autonomous_risk,
    new.auto_approve,
    new.auto_merge,
    new.auto_deploy,
    new.auto_rollback
  ) is distinct from row(
    old.autonomous_mode,
    old.maximum_autonomous_risk,
    old.auto_approve,
    old.auto_merge,
    old.auto_deploy,
    old.auto_rollback
  ) and not public.is_organization_owner(old.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may change autonomous controls';
  end if;

  return new;
end;
$function$;

create or replace function public.has_valid_owner_approval(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from public.approvals approval
    join public.organization_members owner_membership
      on owner_membership.organization_id = approval.organization_id
      and owner_membership.user_id = approval.decided_by
      and owner_membership.role = 'owner'::public.organization_member_role
    where approval.task_id = target_task_id
      and approval.kind = 'red_task_execution'::public.approval_kind
      and approval.status = 'approved'::public.approval_status
      and approval.decided_at is not null
      and (approval.expires_at is null or approval.expires_at > now())
  );
$function$;

create or replace function public.enforce_red_task_execution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.command_id is distinct from old.command_id
      or new.created_by is distinct from old.created_by
      or new.risk_level is distinct from old.risk_level then
      raise exception using errcode = '23514', message = 'task ownership, source, and risk are immutable';
    end if;
  end if;

  if new.risk_level = 'red'::public.risk_level and (
    (new.status = 'in_progress'::public.task_status
      and (tg_op = 'INSERT' or old.status is distinct from new.status))
    or
    (new.status = 'completed'::public.task_status
      and (tg_op = 'INSERT' or old.status not in ('in_progress'::public.task_status, 'completed'::public.task_status)))
  ) and not public.has_valid_owner_approval(new.id) then
    raise exception using errcode = '42501', message = 'RED task execution requires an unexpired approval decided by an organization owner';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_red_agent_run_execution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_is_red boolean;
begin
  if tg_op = 'UPDATE' and (
    new.project_id is distinct from old.project_id
    or new.task_id is distinct from old.task_id
    or new.agent_id is distinct from old.agent_id
  ) then
    raise exception using errcode = '23514', message = 'agent run project, task, and agent are immutable';
  end if;

  select task.risk_level = 'red'::public.risk_level
  into target_is_red
  from public.tasks task
  where task.id = new.task_id;

  if coalesce(target_is_red, false) and (
    (new.status = 'running'::public.run_status
      and (tg_op = 'INSERT' or old.status is distinct from new.status))
    or
    (new.status = 'succeeded'::public.run_status
      and (tg_op = 'INSERT' or old.status not in ('running'::public.run_status, 'succeeded'::public.run_status)))
  ) and not public.has_valid_owner_approval(new.task_id) then
    raise exception using errcode = '42501', message = 'an agent cannot execute a RED task without owner approval';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_approval_decision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending'::public.approval_status
      or new.decided_by is not null
      or new.decided_at is not null then
      raise exception using errcode = '23514', message = 'approvals must be created in the pending state';
    end if;
    if auth.uid() is not null and new.requested_by <> auth.uid() then
      raise exception using errcode = '42501', message = 'requested_by must match the authenticated user';
    end if;
    return new;
  end if;

  if new.project_id is distinct from old.project_id
    or new.task_id is distinct from old.task_id
    or new.command_id is distinct from old.command_id
    or new.kind is distinct from old.kind
    or new.requested_by is distinct from old.requested_by
    or new.requested_at is distinct from old.requested_at then
    raise exception using errcode = '23514', message = 'approval scope and request details are immutable';
  end if;

  if old.status <> 'pending'::public.approval_status and new.status is distinct from old.status then
    raise exception using errcode = '23514', message = 'a decided approval cannot be reopened or changed';
  end if;

  if new.status is distinct from old.status then
    if new.status not in ('approved'::public.approval_status, 'rejected'::public.approval_status, 'cancelled'::public.approval_status) then
      raise exception using errcode = '23514', message = 'invalid approval decision transition';
    end if;
    if auth.uid() is null
      or new.decided_by is distinct from auth.uid()
      or not public.is_organization_owner(new.organization_id) then
      raise exception using errcode = '42501', message = 'only an authenticated organization owner may decide an approval';
    end if;
    new.decided_at := now();
  end if;

  return new;
end;
$function$;

create trigger organizations_audit_created
  after insert on public.organizations
  for each row execute function public.audit_organization_created();
create trigger projects_safe_controls
  before insert or update on public.projects
  for each row execute function public.enforce_safe_project_controls();
create trigger projects_audit_change
  after insert or update on public.projects
  for each row execute function public.audit_project_change();
create trigger connections_audit_change
  after insert or update or delete on public.connections
  for each row execute function public.audit_connection_change();
create trigger project_connections_audit_change
  after insert or update or delete on public.project_connections
  for each row execute function public.audit_project_connection_change();
create trigger commands_audit_submitted
  after insert on public.commands
  for each row execute function public.audit_command_submitted();
create trigger tasks_red_execution_gate
  before insert or update on public.tasks
  for each row execute function public.enforce_red_task_execution();
create trigger tasks_audit_created
  after insert on public.tasks
  for each row execute function public.audit_task_created();
create trigger agent_runs_red_execution_gate
  before insert or update on public.agent_runs
  for each row execute function public.enforce_red_agent_run_execution();
create trigger agent_runs_audit_started
  after insert or update on public.agent_runs
  for each row execute function public.audit_agent_started();
create trigger pull_requests_audit_created
  after insert on public.pull_requests
  for each row execute function public.audit_pull_request_created();
create trigger deployments_audit_change
  after insert or update on public.deployments
  for each row execute function public.audit_deployment_change();
create trigger approvals_decision_guard
  before insert or update on public.approvals
  for each row execute function public.enforce_approval_decision();
create trigger approvals_audit_change
  after insert or update on public.approvals
  for each row execute function public.audit_approval_change();
create trigger organization_members_owner_guard
  before update or delete on public.organization_members
  for each row execute function public.protect_organization_owner();
create trigger activity_events_append_only
  before update or delete on public.activity_events
  for each row execute function public.reject_activity_event_mutation();

create or replace function public.submit_command(
  p_project_id uuid,
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
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  existing_command public.commands%rowtype;
  normalized_prompt text := btrim(coalesce(p_prompt, ''));
  normalized_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  new_command_id uuid;
  new_task_id uuid;
  new_command_state public.command_status;
  new_task_state public.task_status;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if char_length(normalized_prompt) < 1 or char_length(normalized_prompt) > 4000 then
    raise exception using errcode = '22023', message = 'command prompt must contain 1 to 4000 characters';
  end if;

  if public.text_has_likely_secret(normalized_prompt)
    or public.jsonb_has_sensitive_keys(coalesce(p_parameters, '{}'::jsonb)) then
    raise exception using errcode = '22023', message = 'commands cannot contain credentials or sensitive keys';
  end if;

  if jsonb_typeof(coalesce(p_parameters, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'command parameters must be a JSON object';
  end if;

  if normalized_idempotency_key is not null and (
    char_length(normalized_idempotency_key) < 8
    or char_length(normalized_idempotency_key) > 128
    or normalized_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
  ) then
    raise exception using errcode = '22023', message = 'invalid idempotency key';
  end if;

  select project.*
  into project_record
  from public.projects project
  where project.id = p_project_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '55000', message = 'commands cannot be submitted to an archived project';
  end if;

  if not public.has_organization_role(
    project_record.organization_id,
    array[
      'owner'::public.organization_member_role,
      'admin'::public.organization_member_role,
      'member'::public.organization_member_role
    ]
  ) then
    raise exception using errcode = '42501', message = 'project command access denied';
  end if;

  if normalized_idempotency_key is not null then
    select command.*
    into existing_command
    from public.commands command
    where command.submitted_by = caller_id
      and command.project_id = p_project_id
      and command.idempotency_key = normalized_idempotency_key;

    if found then
      if existing_command.prompt <> normalized_prompt
        or existing_command.requested_risk <> p_requested_risk
        or existing_command.parameters <> coalesce(p_parameters, '{}'::jsonb) then
        raise exception using errcode = '22023', message = 'idempotency key was already used for a different command';
      end if;

      select task.id, task.status
      into new_task_id, new_task_state
      from public.tasks task
      where task.command_id = existing_command.id
      order by task.created_at
      limit 1;

      return query select
        existing_command.id,
        new_task_id,
        existing_command.status,
        new_task_state,
        existing_command.requested_risk = 'red'::public.risk_level,
        false;
      return;
    end if;
  end if;

  new_command_state := case
    when p_requested_risk = 'red'::public.risk_level then 'awaiting_approval'::public.command_status
    else 'queued'::public.command_status
  end;
  new_task_state := case
    when p_requested_risk = 'red'::public.risk_level then 'awaiting_approval'::public.task_status
    else 'queued'::public.task_status
  end;

  insert into public.commands (
    organization_id,
    project_id,
    submitted_by,
    prompt,
    requested_risk,
    status,
    parameters,
    idempotency_key
  )
  values (
    project_record.organization_id,
    project_record.id,
    caller_id,
    normalized_prompt,
    p_requested_risk,
    new_command_state,
    coalesce(p_parameters, '{}'::jsonb),
    normalized_idempotency_key
  )
  on conflict (submitted_by, project_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into new_command_id;

  if new_command_id is null then
    select command.*
    into existing_command
    from public.commands command
    where command.submitted_by = caller_id
      and command.project_id = p_project_id
      and command.idempotency_key = normalized_idempotency_key;

    if not found then
      raise exception using errcode = '40001', message = 'command submission conflicted; retry with the same idempotency key';
    end if;

    if existing_command.prompt <> normalized_prompt
      or existing_command.requested_risk <> p_requested_risk
      or existing_command.parameters <> coalesce(p_parameters, '{}'::jsonb) then
      raise exception using errcode = '22023', message = 'idempotency key was already used for a different command';
    end if;

    select task.id, task.status
    into new_task_id, new_task_state
    from public.tasks task
    where task.command_id = existing_command.id
    order by task.created_at
    limit 1;

    return query select
      existing_command.id,
      new_task_id,
      existing_command.status,
      new_task_state,
      existing_command.requested_risk = 'red'::public.risk_level,
      false;
    return;
  end if;

  insert into public.tasks (
    organization_id,
    project_id,
    command_id,
    title,
    description,
    status,
    risk_level,
    input,
    created_by
  )
  values (
    project_record.organization_id,
    project_record.id,
    new_command_id,
    left(normalized_prompt, 240),
    'Created from a Bot Manager command. No execution has started.',
    new_task_state,
    p_requested_risk,
    coalesce(p_parameters, '{}'::jsonb),
    caller_id
  )
  returning id into new_task_id;

  if p_requested_risk = 'red'::public.risk_level then
    insert into public.approvals (
      organization_id,
      project_id,
      task_id,
      command_id,
      kind,
      status,
      requested_by,
      request_reason
    )
    values (
      project_record.organization_id,
      project_record.id,
      new_task_id,
      new_command_id,
      'red_task_execution'::public.approval_kind,
      'pending'::public.approval_status,
      caller_id,
      'RED risk execution requires explicit organization owner approval.'
    );
  end if;

  return query select
    new_command_id,
    new_task_id,
    new_command_state,
    new_task_state,
    p_requested_risk = 'red'::public.risk_level,
    true;
end;
$function$;

create or replace function public.update_project_controls(
  p_project_id uuid,
  p_autonomous_mode boolean default null,
  p_maximum_autonomous_risk public.risk_level default null,
  p_auto_approve boolean default null,
  p_auto_merge boolean default null,
  p_auto_deploy boolean default null,
  p_auto_rollback boolean default null,
  p_expected_updated_at timestamptz default null
)
returns table (
  project_id uuid,
  autonomous_mode boolean,
  maximum_autonomous_risk public.risk_level,
  auto_approve boolean,
  auto_merge boolean,
  auto_deploy boolean,
  auto_rollback boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  project_record public.projects%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if p_autonomous_mode is null
    and p_maximum_autonomous_risk is null
    and p_auto_approve is null
    and p_auto_merge is null
    and p_auto_deploy is null
    and p_auto_rollback is null then
    raise exception using errcode = '22023', message = 'at least one control must be supplied';
  end if;

  select project.*
  into project_record
  from public.projects project
  where project.id = p_project_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if not public.is_organization_owner(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may change project controls';
  end if;

  if p_expected_updated_at is not null and project_record.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'project controls changed since they were read';
  end if;

  update public.projects project
  set
    autonomous_mode = coalesce(p_autonomous_mode, project.autonomous_mode),
    maximum_autonomous_risk = coalesce(p_maximum_autonomous_risk, project.maximum_autonomous_risk),
    auto_approve = coalesce(p_auto_approve, project.auto_approve),
    auto_merge = coalesce(p_auto_merge, project.auto_merge),
    auto_deploy = coalesce(p_auto_deploy, project.auto_deploy),
    auto_rollback = coalesce(p_auto_rollback, project.auto_rollback)
  where project.id = p_project_id
  returning project.* into project_record;

  return query select
    project_record.id,
    project_record.autonomous_mode,
    project_record.maximum_autonomous_risk,
    project_record.auto_approve,
    project_record.auto_merge,
    project_record.auto_deploy,
    project_record.auto_rollback,
    project_record.updated_at;
end;
$function$;

create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision public.approval_status,
  p_decision_notes text default null
)
returns table (
  approval_id uuid,
  approval_state public.approval_status,
  task_id uuid,
  command_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  approval_record public.approvals%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if p_decision not in ('approved'::public.approval_status, 'rejected'::public.approval_status) then
    raise exception using errcode = '22023', message = 'decision must be approved or rejected';
  end if;

  select approval.*
  into approval_record
  from public.approvals approval
  where approval.id = p_approval_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'approval not found';
  end if;

  if approval_record.status <> 'pending'::public.approval_status then
    raise exception using errcode = '55000', message = 'approval has already been decided';
  end if;

  if not public.is_organization_owner(approval_record.organization_id) then
    raise exception using errcode = '42501', message = 'only an organization owner may decide an approval';
  end if;

  update public.approvals approval
  set
    status = p_decision,
    decided_by = auth.uid(),
    decision_notes = nullif(btrim(p_decision_notes), '')
  where approval.id = p_approval_id
  returning approval.* into approval_record;

  if approval_record.kind = 'red_task_execution'::public.approval_kind then
    if p_decision = 'approved'::public.approval_status then
      update public.tasks task
      set status = 'queued'::public.task_status
      where task.id = approval_record.task_id
        and task.status = 'awaiting_approval'::public.task_status;

      update public.commands command
      set status = 'queued'::public.command_status
      where command.id = approval_record.command_id
        and command.status = 'awaiting_approval'::public.command_status;
    else
      update public.tasks task
      set status = 'cancelled'::public.task_status,
          completed_at = now()
      where task.id = approval_record.task_id
        and task.status = 'awaiting_approval'::public.task_status;

      update public.commands command
      set status = 'cancelled'::public.command_status,
          completed_at = now()
      where command.id = approval_record.command_id
        and command.status = 'awaiting_approval'::public.command_status;
    end if;
  end if;

  return query select
    approval_record.id,
    approval_record.status,
    approval_record.task_id,
    approval_record.command_id;
end;
$function$;

revoke all on function public.record_activity_event(uuid, uuid, public.activity_event_type, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.audit_organization_created() from public, anon, authenticated;
revoke all on function public.audit_project_change() from public, anon, authenticated;
revoke all on function public.audit_connection_change() from public, anon, authenticated;
revoke all on function public.audit_project_connection_change() from public, anon, authenticated;
revoke all on function public.audit_command_submitted() from public, anon, authenticated;
revoke all on function public.audit_task_created() from public, anon, authenticated;
revoke all on function public.audit_agent_started() from public, anon, authenticated;
revoke all on function public.audit_pull_request_created() from public, anon, authenticated;
revoke all on function public.audit_deployment_change() from public, anon, authenticated;
revoke all on function public.audit_approval_change() from public, anon, authenticated;
revoke all on function public.reject_activity_event_mutation() from public, anon, authenticated;
revoke all on function public.protect_organization_owner() from public, anon, authenticated;
revoke all on function public.enforce_safe_project_controls() from public, anon, authenticated;
revoke all on function public.has_valid_owner_approval(uuid) from public, anon, authenticated;
revoke all on function public.enforce_red_task_execution() from public, anon, authenticated;
revoke all on function public.enforce_red_agent_run_execution() from public, anon, authenticated;
revoke all on function public.enforce_approval_decision() from public, anon, authenticated;

revoke all on function public.submit_command(uuid, text, public.risk_level, jsonb, text) from public, anon;
revoke all on function public.update_project_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, timestamptz) from public, anon;
revoke all on function public.decide_approval(uuid, public.approval_status, text) from public, anon;
grant execute on function public.submit_command(uuid, text, public.risk_level, jsonb, text) to authenticated;
grant execute on function public.update_project_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, timestamptz) to authenticated;
grant execute on function public.decide_approval(uuid, public.approval_status, text) to authenticated;

comment on function public.submit_command(uuid, text, public.risk_level, jsonb, text) is
  'Atomically persists one command and its initial task. RED submissions also request owner approval. It never starts execution.';
comment on function public.update_project_controls(uuid, boolean, public.risk_level, boolean, boolean, boolean, boolean, timestamptz) is
  'Owner-only audited project-control update with optional optimistic concurrency. It does not execute work.';
comment on function public.decide_approval(uuid, public.approval_status, text) is
  'Owner-only approval decision. Approval moves a RED task to queued but does not start execution.';
