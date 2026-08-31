\set ON_ERROR_STOP on

select pg_catalog.set_config('softwarefactory.causal.account_email', :'account_email', false) as account_email_setting \gset
select pg_catalog.set_config('softwarefactory.causal.project_id', :'project_id', false) as project_id_setting \gset
select pg_catalog.set_config('softwarefactory.causal.project_name', :'project_name', false) as project_name_setting \gset
select pg_catalog.set_config('softwarefactory.causal.repository', :'repository', false) as repository_setting \gset
select pg_catalog.set_config('softwarefactory.causal.default_branch', :'default_branch', false) as default_branch_setting \gset
select pg_catalog.set_config('softwarefactory.causal.goal', :'goal', false) as goal_setting \gset

do $grok_causal_preflight$
declare
  v_user_id uuid;
  v_organization_id uuid;
  v_project_id uuid := pg_catalog.current_setting('softwarefactory.causal.project_id')::uuid;
  v_claude integer;
  v_codex integer;
begin
  if pg_catalog.current_database() is distinct from 'postgres'
      or current_user is distinct from 'postgres'
      or pg_catalog.to_regnamespace('supabase_migrations') is null
  then raise exception 'grok_causal_wrong_database_identity'; end if;

  if (
    select pg_catalog.count(*) = 21 and pg_catalog.count(distinct migration.version) = 21
      from supabase_migrations.schema_migrations migration
     where migration.version = any (array[
       '20260831000100', '20260831000200', '20260831000300',
       '20260831000400', '20260831000500', '20260831000600',
       '20260831000700', '20260831000800', '20260831000900', '20260831001000',
       '20260831001100', '20260831001200', '20260831001300',
       '20260831001400', '20260831001500', '20260831001600',
       '20260831001700', '20260831001800', '20260831001900',
       '20260831002000', '20260831002100'
     ]::text[])
  ) is distinct from true then
    raise exception 'grok_causal_required_ledger_not_exact';
  end if;
  if pg_catalog.to_regclass('public.grok_graph_wake_intents') is null
      or pg_catalog.to_regclass('public.grok_graph_wake_dispatch_attempts') is null
      or pg_catalog.to_regclass('public.grok_graph_wake_receipts') is null
      or pg_catalog.to_regclass('public.grok_execution_admissions') is null
      or pg_catalog.to_regprocedure(
        'public.read_grok_graph_wake_state_as_owner(uuid,uuid,uuid)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.resolve_graph_execution_target_as_worker(uuid,integer)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)'
      ) is null
  then raise exception 'grok_causal_runtime_catalog_missing'; end if;

  if (
    select pg_catalog.count(*) = 2
      and pg_catalog.bool_and(function_definition.prosecdef)
      and pg_catalog.bool_and(
        function_definition.proconfig = array['search_path=pg_catalog']::text[]
      )
      and pg_catalog.bool_and(pg_catalog.has_function_privilege(
        'service_role', function_definition.oid, 'EXECUTE'
      ))
      and pg_catalog.bool_and(not pg_catalog.has_function_privilege(
        'authenticated', function_definition.oid, 'EXECUTE'
      ))
      and pg_catalog.bool_and(not pg_catalog.has_function_privilege(
        'anon', function_definition.oid, 'EXECUTE'
      ))
      from pg_catalog.pg_proc function_definition
     where function_definition.oid = any (array[
       pg_catalog.to_regprocedure(
         'public.resolve_graph_execution_target_as_worker(uuid,integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)'
       )
     ]::pg_catalog.oid[])
  ) is distinct from true or exists (
    select 1
      from pg_catalog.pg_proc function_definition
      cross join lateral pg_catalog.aclexplode(coalesce(
        function_definition.proacl,
        pg_catalog.acldefault('f', function_definition.proowner)
      )) access_control
     where function_definition.oid = any (array[
       pg_catalog.to_regprocedure(
         'public.resolve_graph_execution_target_as_worker(uuid,integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)'
       )
     ]::pg_catalog.oid[])
       and access_control.privilege_type = 'EXECUTE'
       and access_control.grantee not in (
         function_definition.proowner,
         (select role_definition.oid from pg_catalog.pg_roles role_definition
           where role_definition.rolname = 'service_role')
       )
  ) then raise exception 'grok_causal_runtime_catalog_or_acl_mismatch'; end if;

  select account.id into strict v_user_id
    from auth.users account
   where pg_catalog.lower(account.email) = pg_catalog.lower(
     pg_catalog.current_setting('softwarefactory.causal.account_email')
   )
     and account.email_confirmed_at is not null
     and account.deleted_at is null;

  select project.organization_id into strict v_organization_id
    from public.projects project
    join public.organization_members member
      on member.organization_id = project.organization_id
     and member.user_id = v_user_id
     and member.role = 'owner'::public.organization_member_role
    join public.project_connections link
      on link.project_id = project.id
     and link.organization_id = project.organization_id
     and link.is_primary
    join public.connections connection
      on connection.id = link.connection_id
     and connection.organization_id = link.organization_id
     and connection.provider = 'github'::public.connection_provider
     and connection.status = 'connected'::public.connection_status
    join public.github_repositories repository
      on repository.id = link.github_repository_id
     and repository.organization_id = link.organization_id
     and repository.selected and not repository.archived and not repository.disabled
    join public.github_installations installation
      on installation.id = repository.installation_id
     and installation.organization_id = repository.organization_id
     and installation.connection_id = connection.id
     and installation.status = 'active'
     and installation.suspended_at is null and installation.deleted_at is null
     and installation.external_installation_id > 0 and installation.app_id > 0
   where project.id = v_project_id
     and project.name = pg_catalog.current_setting('softwarefactory.causal.project_name')
     and project.github_repository = pg_catalog.current_setting('softwarefactory.causal.repository')
     and project.default_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
     and project.status = 'active'::public.project_status
     and repository.full_name = pg_catalog.current_setting('softwarefactory.causal.repository')
     and repository.default_branch = pg_catalog.current_setting('softwarefactory.causal.default_branch')
     and repository.external_repository_id > 0;

  if exists (
    select 1 from public.organizations organization
     where organization.id = v_organization_id
       and (coalesce(organization.autonomous_mode, false)
         or organization.autonomy_kill_switch_active is distinct from true
         or coalesce(organization.auto_plan, false)
         or coalesce(organization.auto_code, false)
         or coalesce(organization.auto_test, false)
         or coalesce(organization.auto_repair, false)
         or coalesce(organization.auto_review, false)
         or coalesce(organization.auto_approve, false)
         or coalesce(organization.auto_merge, false)
         or coalesce(organization.auto_deploy, false)
         or coalesce(organization.auto_rollback, false))
  ) or exists (
    select 1 from public.projects project
     where project.id = v_project_id
       and (coalesce(project.autonomous_mode, false)
         or coalesce(project.auto_plan, false)
         or coalesce(project.auto_code, false)
         or coalesce(project.auto_test, false)
         or coalesce(project.auto_repair, false)
         or coalesce(project.auto_review, false)
         or coalesce(project.auto_approve, false)
         or coalesce(project.auto_merge, false)
         or coalesce(project.auto_deploy, false)
         or coalesce(project.auto_rollback, false))
  ) or exists (
    select 1 from public.graph_runs run where run.state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs run where run.status = 'running'::public.run_status
  ) or exists (
    select 1 from public.phase1c_workers worker where worker.current_run_id is not null
  ) then raise exception 'grok_causal_safety_or_isolation_mismatch'; end if;

  if exists (
    select 1 from public.grok_messages message
     where message.role = 'user' and message.content = pg_catalog.current_setting('softwarefactory.causal.goal')
  ) then raise exception 'grok_causal_goal_identity_already_exists'; end if;

  with ready as (
    select bot.provider, assignment.repository_access, assignment.can_open_pull_request,
           assignment.can_merge_pull_request, assignment.pipeline_access,
           assignment.requires_human_approval
      from public.bot_assignments assignment
      join public.bots bot on bot.id = assignment.bot_id
       and bot.organization_id = assignment.organization_id
      join public.bot_roles role_definition on role_definition.id = assignment.role_id
       and role_definition.organization_id = assignment.organization_id
      join public.ai_accounts account on account.id = bot.ai_account_id
       and account.organization_id = bot.organization_id and account.provider = bot.provider
      join public.provider_credentials credential on credential.organization_id = account.organization_id
       and credential.purpose = account.credential_purpose
     where assignment.organization_id = v_organization_id
       and assignment.project_id = v_project_id
       and assignment.status = 'active'::public.bot_assignment_status
       and bot.readiness = 'ready'::public.bot_readiness
       and account.auth_method = 'subscription' and account.status = 'connected'
       and bot.credential_ref = public.ai_account_bot_credential_ref(
         account.provider, account.credential_purpose
       )
       and pg_catalog.btrim(coalesce(assignment.model, bot.model)) <> ''
       and pg_catalog.jsonb_array_length(
         public.normalize_grok_role_capabilities(role_definition.capabilities)
       ) > 0
  )
  select pg_catalog.count(*) filter (
           where ready.provider = 'anthropic'::public.bot_provider
         )::integer,
         pg_catalog.count(*) filter (
           where ready.provider = 'openai'::public.bot_provider
             and ready.repository_access = 'write'
             and ready.can_open_pull_request and not ready.can_merge_pull_request
             and ready.pipeline_access in ('assigned', 'all')
             and ready.requires_human_approval
         )::integer
    into v_claude, v_codex from ready;
  if v_claude < 1 or v_codex < 1 then
    raise exception 'grok_causal_ready_provider_roster_mismatch';
  end if;
end;
$grok_causal_preflight$;

select 'grok-causal-preflight-ok';
