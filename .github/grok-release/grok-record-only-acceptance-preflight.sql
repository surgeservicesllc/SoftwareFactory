\set ON_ERROR_STOP on

-- These are public identities supplied through validated workflow inputs. They
-- become session-local settings so the PL/pgSQL verifier never interpolates
-- raw workflow text into executable SQL.
select pg_catalog.set_config(
  'softwarefactory.acceptance.account_email', :'account_email', false
) as account_email_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.project_id', :'project_id', false
) as project_id_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.project_name', :'project_name', false
) as project_name_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.repository', :'repository', false
) as repository_setting \gset
select pg_catalog.set_config(
  'softwarefactory.acceptance.default_branch', :'default_branch', false
) as default_branch_setting \gset

do $grok_record_only_preflight$
declare
  v_account_email text := pg_catalog.current_setting(
    'softwarefactory.acceptance.account_email'
  );
  v_project_id uuid := pg_catalog.current_setting(
    'softwarefactory.acceptance.project_id'
  )::uuid;
  v_project_name text := pg_catalog.current_setting(
    'softwarefactory.acceptance.project_name'
  );
  v_repository text := pg_catalog.current_setting(
    'softwarefactory.acceptance.repository'
  );
  v_default_branch text := pg_catalog.current_setting(
    'softwarefactory.acceptance.default_branch'
  );
  v_user_id uuid;
  v_organization_id uuid;
  v_user_count integer;
  v_claude_count integer;
  v_codex_count integer;
begin
  if pg_catalog.current_database() is distinct from 'postgres'
      or current_user is distinct from 'postgres'
      or pg_catalog.to_regnamespace('supabase_migrations') is null
  then
    raise exception 'grok_record_only_wrong_database_identity';
  end if;

  if (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct migration.version) = 2
      from supabase_migrations.schema_migrations migration
     where migration.version in ('20260831000900', '20260831001000')
  ) is distinct from true
  then
    raise exception 'grok_record_only_completion_ledger_not_exact';
  end if;
  if pg_catalog.to_regclass('public.grok_specialist_admissions') is null
      or pg_catalog.to_regclass('public.grok_execution_admissions') is null
      or pg_catalog.to_regprocedure(
        'public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
      ) is null
  then
    raise exception 'grok_record_only_planner_v3_catalog_missing';
  end if;

  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(account.id order by account.id))[1]
    into v_user_count, v_user_id
    from auth.users account
   where pg_catalog.lower(account.email) = pg_catalog.lower(v_account_email)
     and account.email_confirmed_at is not null
     and account.deleted_at is null;
  if v_user_count is distinct from 1 or v_user_id is null then
    raise exception 'grok_record_only_fake_account_not_exactly_one_confirmed_user';
  end if;

  select project.organization_id
    into v_organization_id
    from public.projects project
    join public.organization_members member
      on member.organization_id = project.organization_id
     and member.user_id = v_user_id
     and member.role = 'owner'::public.organization_member_role
   where project.id = v_project_id
     and project.name = v_project_name
     and project.github_repository = v_repository
     and project.default_branch = v_default_branch
     and project.status = 'active'::public.project_status;
  if not found or v_organization_id is null then
    raise exception 'grok_record_only_exact_owned_project_not_ready';
  end if;

  if exists (
    select 1 from public.organizations organization
     where coalesce(organization.autonomous_mode, false)
        or organization.autonomy_kill_switch_active is distinct from true
        or coalesce(organization.auto_plan, false)
        or coalesce(organization.auto_code, false)
        or coalesce(organization.auto_test, false)
        or coalesce(organization.auto_repair, false)
        or coalesce(organization.auto_review, false)
        or coalesce(organization.auto_approve, false)
        or coalesce(organization.auto_merge, false)
        or coalesce(organization.auto_deploy, false)
        or coalesce(organization.auto_rollback, false)
  ) or exists (
    select 1 from public.projects project
     where coalesce(project.autonomous_mode, false)
        or coalesce(project.auto_plan, false)
        or coalesce(project.auto_code, false)
        or coalesce(project.auto_test, false)
        or coalesce(project.auto_repair, false)
        or coalesce(project.auto_review, false)
        or coalesce(project.auto_approve, false)
        or coalesce(project.auto_merge, false)
        or coalesce(project.auto_deploy, false)
        or coalesce(project.auto_rollback, false)
  ) or exists (
    select 1 from public.phase1c_workers worker
     where worker.last_heartbeat_at > pg_catalog.now() - interval '10 minutes'
        or worker.last_heartbeat_at > pg_catalog.now() + interval '1 minute'
        or worker.current_run_id is not null
  ) or exists (
    select 1 from public.graph_runs graph_run
     where graph_run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs agent_run
     where agent_run.status = 'running'::public.run_status
  ) or exists (
    select 1 from public.grok_phase1c_submission_guards
  ) then
    raise exception 'grok_record_only_execution_containment_not_stopped';
  end if;

  with ready as (
    select bot.provider,
           assignment.repository_access,
           assignment.can_open_pull_request,
           assignment.can_merge_pull_request,
           assignment.pipeline_access,
           assignment.requires_human_approval
      from public.bot_assignments assignment
      join public.bots bot
        on bot.id = assignment.bot_id
       and bot.organization_id = assignment.organization_id
      join public.bot_roles role_definition
        on role_definition.id = assignment.role_id
       and role_definition.organization_id = assignment.organization_id
      join public.ai_accounts account
        on account.id = bot.ai_account_id
       and account.organization_id = bot.organization_id
       and account.provider = bot.provider
      join public.provider_credentials credential
        on credential.organization_id = account.organization_id
       and credential.purpose = account.credential_purpose
     where assignment.organization_id = v_organization_id
       and assignment.project_id = v_project_id
       and assignment.status = 'active'::public.bot_assignment_status
       and bot.provider in (
         'anthropic'::public.bot_provider,
         'openai'::public.bot_provider
       )
       and bot.readiness = 'ready'::public.bot_readiness
       and account.auth_method = 'subscription'
       and account.status = 'connected'
       and bot.credential_ref = public.ai_account_bot_credential_ref(
         account.provider, account.credential_purpose
       )
       and pg_catalog.btrim(coalesce(assignment.model, bot.model)) <> ''
       and pg_catalog.char_length(
         pg_catalog.btrim(coalesce(assignment.model, bot.model))
       ) <= 128
       and pg_catalog.jsonb_array_length(
         public.normalize_grok_role_capabilities(role_definition.capabilities)
       ) > 0
       and (
         assignment.preset is not null
         or pg_catalog.jsonb_array_length(assignment.responsibilities) > 0
         or pg_catalog.btrim(coalesce(assignment.instructions, '')) <> ''
         or pg_catalog.jsonb_array_length(assignment.tools) > 0
         or assignment.repository_access <> 'read'
         or assignment.branch_strategy <> 'per_task_branch'
         or assignment.can_open_pull_request
         or assignment.can_merge_pull_request
         or assignment.pipeline_access <> 'none'
         or assignment.environment_access <> 'none'
         or not assignment.requires_human_approval
         or assignment.max_concurrent_tasks <> 1
         or assignment.priority <> 2
         or pg_catalog.btrim(coalesce(assignment.model, '')) <> ''
         or assignment.work_effort <> 'medium'
       )
  )
  select pg_catalog.count(*) filter (
           where ready.provider = 'anthropic'::public.bot_provider
         )::integer,
         pg_catalog.count(*) filter (
           where ready.provider = 'openai'::public.bot_provider
             and ready.repository_access = 'write'
             and ready.can_open_pull_request
             and not ready.can_merge_pull_request
             and ready.pipeline_access in ('assigned', 'all')
             and ready.requires_human_approval
         )::integer
    into v_claude_count, v_codex_count
    from ready;
  if v_claude_count < 1 then
    raise exception 'grok_record_only_missing_ready_configured_claude_prerequisite';
  end if;
  if v_codex_count < 1 then
    raise exception 'grok_record_only_missing_ready_bounded_codex_prerequisite';
  end if;
end;
$grok_record_only_preflight$;

select 'grok-record-only-preflight-ok';
