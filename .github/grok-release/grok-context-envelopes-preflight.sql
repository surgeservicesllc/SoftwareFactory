\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'softwarefactory.context_release.operation', :'operation', false
) as operation_setting \gset
select pg_catalog.set_config(
  'softwarefactory.context_release.unrelated_ledger_sha256',
  :'unrelated_ledger_sha256',
  false
) as unrelated_ledger_setting \gset

do $grok_context_release_preflight$
declare
  v_operation text := pg_catalog.current_setting(
    'softwarefactory.context_release.operation'
  );
  v_ledger_count integer;
  v_unrelated_ledger_sha256 text;
begin
  if v_operation not in ('probe', 'apply', 'verify') then
    raise exception 'grok_context_release_operation_invalid';
  end if;
  if pg_catalog.current_database() is distinct from 'postgres'
      or current_user is distinct from 'postgres'
      or pg_catalog.to_regnamespace('supabase_migrations') is null
  then
    raise exception 'grok_context_release_database_identity_mismatch';
  end if;

  if exists (
    select 1
      from (values
        ('20260831000100'), ('20260831000200'), ('20260831000300'),
        ('20260831000400'), ('20260831000500'), ('20260831000600'),
        ('20260831000700'), ('20260831000800'), ('20260831000900'),
        ('20260831001000')
      ) expected(version)
     where (select pg_catalog.count(*)
              from supabase_migrations.schema_migrations migration
             where migration.version = expected.version) <> 1
  )
      or pg_catalog.to_regclass('public.grok_specialist_admissions') is null
      or pg_catalog.to_regclass('public.grok_execution_admissions') is null
      or pg_catalog.to_regprocedure(
        'public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.reject_grok_evidence_mutation()'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.project_production_url_is_safe(text)'
      ) is null
      or pg_catalog.to_regprocedure(
        'public.append_grok_message_internal(uuid,uuid,text,text,jsonb,text,bigint,uuid,uuid)'
      ) is null
  then
    raise exception 'grok_context_release_prerequisite_ledger_or_catalog_mismatch';
  end if;

  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(migration)
             order by migration.version), '[]'::jsonb)::text,
           'UTF8'
         )), 'hex')
    into v_unrelated_ledger_sha256
    from supabase_migrations.schema_migrations migration
   where migration.version <> '20260831001100';
  if v_unrelated_ledger_sha256 is distinct from pg_catalog.current_setting(
    'softwarefactory.context_release.unrelated_ledger_sha256'
  ) then
    raise exception 'grok_context_release_unrelated_ledger_changed';
  end if;

  select pg_catalog.count(*)::integer
    into v_ledger_count
    from supabase_migrations.schema_migrations
   where version = '20260831001100';
  if v_operation in ('probe', 'apply') then
    if v_ledger_count <> 0
        or pg_catalog.to_regclass('public.grok_context_envelopes') is not null
        or pg_catalog.to_regclass('public.grok_context_items') is not null
        or pg_catalog.to_regprocedure(
          'public.record_grok_context_envelope_internal(uuid,uuid,uuid,uuid,jsonb,text,bigint,uuid,boolean)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.record_grok_context_envelope_as_server(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,boolean)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.append_grok_follow_up_context(uuid,uuid,uuid,text,jsonb,text,bigint,bigint,uuid)'
        ) is not null
        or pg_catalog.to_regprocedure(
          'public.list_grok_context_envelopes(uuid,uuid,integer)'
        ) is not null
    then
      raise exception 'grok_context_release_absent_ledger_or_catalog_mismatch';
    end if;
  elsif v_ledger_count <> 1 then
    raise exception 'grok_context_release_verify_ledger_mismatch';
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
    raise exception 'grok_context_release_safety_state_not_stopped';
  end if;
end;
$grok_context_release_preflight$;

select 'grok-context-release-preflight-ok';
