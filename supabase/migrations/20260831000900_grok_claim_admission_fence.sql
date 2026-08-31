-- Revalidate immutable Grok provider admissions at every resume and worker
-- claim boundary. Existing launch evidence remains append-only; this forward
-- migration only adds current-identity assertions and protocol-v3 wrappers.
-- No worker, autonomy switch, automatic action, or kill switch is changed.

create function public.grok_current_execution_admission_hash(
  p_admission public.grok_execution_admissions
)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $function$
  select public.grok_execution_admission_hash(p_admission);
$function$;

revoke all on function public.grok_current_execution_admission_hash(
  public.grok_execution_admissions
) from public, anon, authenticated, service_role;

create function public.assert_current_grok_execution_admissions(
  p_graph_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph public.graphs;
  v_launch public.grok_graph_launches;
  v_admission public.grok_execution_admissions;
  v_assignment public.bot_assignments;
  v_bot public.bots;
  v_role public.bot_roles;
  v_account public.ai_accounts;
  v_credential public.provider_credentials;
  v_node public.graph_nodes;
  v_expected_credential_ref text;
  v_expected_count integer;
  v_actual_count integer;
begin
  select graph.* into v_graph
    from public.graphs graph
   where graph.id = p_graph_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok admission graph not found';
  end if;

  select launch.* into v_launch
    from public.grok_graph_launches launch
   where launch.graph_id = v_graph.id
     and launch.organization_id = v_graph.organization_id
     and launch.project_id = v_graph.project_id
   for update;
  if not found then
    -- Non-Grok graphs retain their existing worker path. A Grok graph can
    -- never lose this row because the launch relationship is RESTRICT-bound.
    return false;
  end if;

  select pg_catalog.count(*)::integer into v_expected_count
    from public.graph_nodes node
   where node.graph_id = v_graph.id
     and node.organization_id = v_graph.organization_id
     and (
       node.executor = 'MODEL'::public.graph_node_executor
       or (
         node.executor = 'ANCHOR'::public.graph_node_executor
         and node.node_key = 'implement'
         and node.capability = 'implementation'
       )
     );
  select pg_catalog.count(*)::integer into v_actual_count
    from public.grok_execution_admissions admission
   where admission.graph_id = v_graph.id
     and admission.organization_id = v_graph.organization_id;
  if v_expected_count < 1 or v_actual_count is distinct from v_expected_count then
    raise exception using errcode = '55000',
      message = 'grok execution admission set is incomplete';
  end if;

  -- Lock every mutable source set in one deterministic order before comparing
  -- any row. A concurrent bot/account/credential change therefore wins before
  -- the claim or after it, never halfway through the admission decision.
  perform assignment.id
    from public.bot_assignments assignment
    join public.grok_execution_admissions admission
      on admission.assignment_id = assignment.id
     and admission.organization_id = assignment.organization_id
   where admission.graph_id = v_graph.id
   order by assignment.id
   for update of assignment;
  perform bot.id
    from public.bots bot
    join public.grok_execution_admissions admission
      on admission.bot_id = bot.id
     and admission.organization_id = bot.organization_id
   where admission.graph_id = v_graph.id
   order by bot.id
   for update of bot;
  perform role_definition.id
    from public.bot_roles role_definition
    join public.grok_execution_admissions admission
      on admission.role_id = role_definition.id
     and admission.organization_id = role_definition.organization_id
   where admission.graph_id = v_graph.id
   order by role_definition.id
   for update of role_definition;
  perform account.id
    from public.ai_accounts account
    join public.grok_execution_admissions admission
      on admission.ai_account_id = account.id
     and admission.organization_id = account.organization_id
   where admission.graph_id = v_graph.id
   order by account.id
   for update of account;
  perform credential.id
    from public.provider_credentials credential
    join public.grok_execution_admissions admission
      on admission.provider_credential_id = credential.id
     and admission.organization_id = credential.organization_id
   where admission.graph_id = v_graph.id
   order by credential.id
   for update of credential;

  for v_admission in
    select admission.*
      from public.grok_execution_admissions admission
     where admission.graph_id = v_graph.id
       and admission.organization_id = v_graph.organization_id
     order by admission.node_key
  loop
    if v_admission.project_id is distinct from v_graph.project_id
        or v_admission.session_id is distinct from v_launch.session_id
        or v_admission.message_id is distinct from v_launch.message_id
        or v_admission.graph_launch_id is distinct from v_launch.id
        or v_admission.admission_sha256 is distinct from
          public.grok_current_execution_admission_hash(v_admission)
    then
      raise exception using errcode = '55000',
        message = 'grok execution admission evidence changed';
    end if;

    select node.* into v_node
      from public.graph_nodes node
     where node.id = v_admission.graph_node_id
       and node.organization_id = v_admission.organization_id
       and node.graph_id = v_admission.graph_id
       and node.node_key = v_admission.node_key;
    if not found
        or v_node.capability is distinct from v_admission.capability
        or (
          v_admission.lane = 'graph_model'
          and (
            v_node.executor is distinct from 'MODEL'::public.graph_node_executor
            or v_admission.provider is distinct from 'anthropic'::public.bot_provider
          )
        )
        or (
          v_admission.lane = 'phase1c'
          and (
            v_node.executor is distinct from 'ANCHOR'::public.graph_node_executor
            or v_node.node_key is distinct from 'implement'
            or v_node.capability is distinct from 'implementation'
            or v_admission.provider is distinct from 'openai'::public.bot_provider
          )
        )
    then
      raise exception using errcode = '55000',
        message = 'grok execution admission no longer matches its graph node';
    end if;

    select assignment.* into v_assignment
      from public.bot_assignments assignment
     where assignment.id = v_admission.assignment_id
       and assignment.organization_id = v_admission.organization_id
       and assignment.project_id = v_admission.project_id;
    if not found
        or v_assignment.status is distinct from 'active'::public.bot_assignment_status
        or v_assignment.revision is distinct from v_admission.assignment_revision
        or v_assignment.bot_id is distinct from v_admission.bot_id
        or v_assignment.role_id is distinct from v_admission.role_id
        or v_admission.agent_max_model_tier is distinct from (
          case v_assignment.work_effort
            when 'low' then 'ECONOMY'
            when 'medium' then 'STANDARD'
            when 'high' then 'STRONG'
            when 'max' then 'STRONG'
            else null
          end
        )
    then
      raise exception using errcode = '55000',
        message = 'grok assignment admission is stale';
    end if;

    select bot.* into v_bot
      from public.bots bot
     where bot.id = v_admission.bot_id
       and bot.organization_id = v_admission.organization_id;
    if not found
        or v_bot.revision is distinct from v_admission.bot_revision
        or v_bot.ai_account_id is distinct from v_admission.ai_account_id
        or v_bot.provider is distinct from v_admission.provider
        or v_bot.readiness is distinct from 'ready'::public.bot_readiness
        or coalesce(v_assignment.model, v_bot.model) is distinct from v_admission.model
    then
      raise exception using errcode = '55000', message = 'grok bot admission is stale';
    end if;

    select role_definition.* into v_role
      from public.bot_roles role_definition
     where role_definition.id = v_admission.role_id
       and role_definition.organization_id = v_admission.organization_id;
    if not found
        or v_role.updated_at is distinct from v_admission.role_updated_at
        or pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(v_role.capabilities::text, 'UTF8')
        ), 'hex') is distinct from v_admission.role_capabilities_sha256
    then
      raise exception using errcode = '55000', message = 'grok role admission is stale';
    end if;

    select account.* into v_account
      from public.ai_accounts account
     where account.id = v_admission.ai_account_id
       and account.organization_id = v_admission.organization_id;
    if not found
        or v_account.updated_at is distinct from v_admission.ai_account_updated_at
        or v_account.provider is distinct from v_admission.provider
        or v_account.auth_method is distinct from 'subscription'
        or v_account.status is distinct from 'connected'
        or v_account.credential_purpose is distinct from v_admission.credential_purpose
        or v_account.provider_identity is distinct from v_admission.provider_identity
    then
      raise exception using errcode = '55000',
        message = 'grok AI account admission is stale';
    end if;

    v_expected_credential_ref := public.ai_account_bot_credential_ref(
      v_account.provider,
      v_account.credential_purpose
    );
    if v_bot.credential_ref is distinct from v_expected_credential_ref
        or v_admission.credential_ref is distinct from v_expected_credential_ref
    then
      raise exception using errcode = '55000',
        message = 'grok credential reference admission is stale';
    end if;

    select credential.* into v_credential
      from public.provider_credentials credential
     where credential.id = v_admission.provider_credential_id
       and credential.organization_id = v_admission.organization_id
       and credential.purpose = v_admission.credential_purpose;
    if not found
        or v_credential.rotated_at is distinct from
          v_admission.provider_credential_rotated_at
    then
      raise exception using errcode = '55000',
        message = 'grok sealed credential admission is stale';
    end if;

    if v_admission.lane = 'phase1c'
        and (
          v_assignment.repository_access is distinct from 'write'
          or not v_assignment.can_open_pull_request
          or v_assignment.can_merge_pull_request
          or v_assignment.pipeline_access not in ('assigned', 'all')
          or not v_assignment.requires_human_approval
        )
    then
      raise exception using errcode = '42501',
        message = 'grok Phase 1C admission authority changed';
    end if;
  end loop;

  return true;
end;
$function$;

revoke all on function public.assert_current_grok_execution_admissions(uuid)
  from public, anon, authenticated, service_role;

create function public.grok_execution_admission_projection(
  p_admission public.grok_execution_admissions
)
returns jsonb
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $function$
  select pg_catalog.jsonb_build_object(
    'id', (p_admission).id,
    'lane', (p_admission).lane,
    'provider', (p_admission).provider::text,
    'model', (p_admission).model,
    'credential_purpose', (p_admission).credential_purpose,
    'credential_ref', (p_admission).credential_ref,
    'provider_credential_id', (p_admission).provider_credential_id,
    'provider_credential_rotated_at', (p_admission).provider_credential_rotated_at,
    'ai_account_id', (p_admission).ai_account_id,
    'admission_sha256', (p_admission).admission_sha256
  );
$function$;

revoke all on function public.grok_execution_admission_projection(
  public.grok_execution_admissions
) from public, anon, authenticated, service_role;

create function public.attach_current_grok_admissions_to_claim(
  p_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph_id uuid;
  v_nodes jsonb;
begin
  if p_claim is null then return null; end if;
  if coalesce(p_claim ->> 'graph_id', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(p_claim -> 'nodes') <> 'array'
  then
    raise exception using errcode = '55000', message = 'graph claim admission projection is invalid';
  end if;
  v_graph_id := (p_claim ->> 'graph_id')::uuid;
  if not public.assert_current_grok_execution_admissions(v_graph_id) then
    return p_claim || pg_catalog.jsonb_build_object('grok_admission_required', false);
  end if;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(
    case when admission.id is null then node.value else
      node.value || pg_catalog.jsonb_build_object(
        'execution_admission', public.grok_execution_admission_projection(admission)
      )
    end order by node.ordinality
  ), '[]'::jsonb)
    into v_nodes
    from pg_catalog.jsonb_array_elements(p_claim -> 'nodes')
      with ordinality node(value, ordinality)
    left join public.grok_execution_admissions admission
      on admission.graph_id = v_graph_id
     and admission.graph_node_id = (node.value ->> 'node_id')::uuid;

  return pg_catalog.jsonb_set(p_claim, '{nodes}', v_nodes, false)
    || pg_catalog.jsonb_build_object('grok_admission_required', true);
end;
$function$;

revoke all on function public.attach_current_grok_admissions_to_claim(jsonb)
  from public, anon, authenticated, service_role;

create function public.claim_planned_graph_v3(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare v_claim jsonb;
begin
  if p_protocol_version is distinct from 3 then
    raise exception using errcode = '0A000', message = 'graph worker protocol version 3 is required';
  end if;
  v_claim := public.claim_planned_graph_v2(
    p_worker_id, p_supported_executors, p_repository_full_name,
    p_required_check_names, 2
  );
  return public.attach_current_grok_admissions_to_claim(v_claim);
end;
$function$;

create function public.claim_planned_graph_by_id_v3(
  p_worker_id text,
  p_supported_executors text[],
  p_repository_full_name text,
  p_required_check_names jsonb,
  p_target_graph_id uuid,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare v_claim jsonb;
begin
  if p_protocol_version is distinct from 3 then
    raise exception using errcode = '0A000', message = 'graph worker protocol version 3 is required';
  end if;
  v_claim := public.claim_planned_graph_by_id_v2(
    p_worker_id, p_supported_executors, p_repository_full_name,
    p_required_check_names, p_target_graph_id, 2
  );
  return public.attach_current_grok_admissions_to_claim(v_claim);
end;
$function$;

revoke all on function public.claim_planned_graph_v2(text, text[], text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_planned_graph_by_id_v2(text, text[], text, jsonb, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_planned_graph_v3(text, text[], text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_planned_graph_by_id_v3(text, text[], text, jsonb, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_planned_graph_v3(text, text[], text, jsonb, integer)
  to service_role;
grant execute on function public.claim_planned_graph_by_id_v3(text, text[], text, jsonb, uuid, integer)
  to service_role;

create function public.attach_current_grok_admission_to_phase1c_claim(
  p_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_bridge public.graph_phase1c_bridges;
  v_admission public.grok_execution_admissions;
  v_grok_admission_required boolean;
begin
  if p_claim is null then return null; end if;
  select bridge.* into v_bridge
    from public.graph_phase1c_bridges bridge
   where bridge.command_id = (p_claim ->> 'command_id')::uuid
     and bridge.organization_id = (p_claim ->> 'organization_id')::uuid;
  if not found then return p_claim; end if;

  v_grok_admission_required := public.assert_current_grok_execution_admissions(v_bridge.graph_id);
  if not v_grok_admission_required then
    return p_claim;
  end if;
  select admission.* into v_admission
    from public.grok_execution_admissions admission
   where admission.graph_id = v_bridge.graph_id
     and admission.organization_id = v_bridge.organization_id
     and admission.graph_node_id = v_bridge.implementation_node_id
     and admission.lane = 'phase1c';
  if not found
      or v_bridge.task_id is distinct from (p_claim ->> 'task_id')::uuid
      or v_admission.provider::text is distinct from p_claim ->> 'provider'
      or v_admission.model is distinct from p_claim ->> 'model'
  then
    raise exception using errcode = '55000',
      message = 'Phase 1C claim does not match its current Grok admission';
  end if;
  return p_claim || pg_catalog.jsonb_build_object(
    'execution_admission', public.grok_execution_admission_projection(v_admission)
  );
end;
$function$;

revoke all on function public.attach_current_grok_admission_to_phase1c_claim(jsonb)
  from public, anon, authenticated, service_role;

-- Fail closed before replacing any reviewed legacy boundary. This prevents a
-- forward migration from silently overwriting intervening source or authority
-- drift in the command, attachment, or run-queue path.
do $grok_phase1c_submission_preflight$
declare
  v_expected record;
  v_routine oid;
  v_acl_count integer;
begin
  for v_expected in
    select * from (values
      ('public.submit_command(uuid,text,public.risk_level,jsonb,text)',
       '024c3aa1f74d976fb7a8a6d7138cd9fb', true),
      ('public.queue_phase1c_run_for_task()',
       '4737eba3e8490632fdd89c6d06fece82', false),
      ('public.attach_graph_phase1c_command_for_approved_gate(uuid,uuid,uuid)',
       '7b19dd52b62f2116488fced8f3f6b60d', false),
      ('public.submit_and_attach_graph_phase1c_command(uuid,jsonb)',
       'e562c865f2e571863d48f3cfafce2087', true)
    ) expected(signature, source_md5, authenticated_execute)
  loop
    v_routine := pg_catalog.to_regprocedure(v_expected.signature);
    select pg_catalog.count(*)::integer into v_acl_count
      from pg_catalog.aclexplode(coalesce(
        (select routine.proacl from pg_catalog.pg_proc routine
          where routine.oid = v_routine),
        pg_catalog.acldefault('f', (
          select routine.proowner from pg_catalog.pg_proc routine
           where routine.oid = v_routine
        ))
      )) privilege;
    if v_routine is null or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = v_routine
         and routine.prosecdef
         and routine.provolatile = 'v'
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege(
           'authenticated', routine.oid, 'EXECUTE'
         ) = v_expected.authenticated_execute
         and not pg_catalog.has_function_privilege(
           'service_role', routine.oid, 'EXECUTE'
         )
         and not exists (
           select 1
             from pg_catalog.aclexplode(coalesce(
               routine.proacl,
               pg_catalog.acldefault('f', routine.proowner)
             )) privilege
            where privilege.grantor <> routine.proowner
               or privilege.privilege_type <> 'EXECUTE'
               or privilege.is_grantable
               or privilege.grantee not in (
                 routine.proowner,
                 case when v_expected.authenticated_execute
                   then pg_catalog.to_regrole('authenticated')::oid
                   else routine.proowner
                 end
               )
         )
    ) or v_acl_count <> (
      case when v_expected.authenticated_execute then 2 else 1 end
    )
    then
      raise exception using errcode = '55000',
        message = 'Grok Phase 1C submission input source or authority drifted',
        detail = v_expected.signature;
    end if;
  end loop;
end;
$grok_phase1c_submission_preflight$;

-- One-use transaction capabilities let the exact approved Grok bridge carry
-- its admitted OpenAI model through the legacy Phase 1C persistence triggers.
-- Browser callers cannot create or read these rows, and a successful bridge
-- submission consumes its row before returning.
create table public.grok_phase1c_submission_guards (
  token uuid primary key,
  caller_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  bridge_id uuid not null,
  admission_id uuid not null,
  authorized_parameters jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '5 minutes'),
  constraint grok_phase1c_submission_guard_parameters_object
    check (pg_catalog.jsonb_typeof(authorized_parameters) = 'object'),
  constraint grok_phase1c_submission_guard_parameters_bounded
    check (pg_catalog.octet_length(authorized_parameters::text) <= 65536),
  constraint grok_phase1c_submission_guard_parameters_safe
    check (not public.jsonb_has_sensitive_keys(authorized_parameters)),
  constraint grok_phase1c_submission_guard_lifetime
    check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  constraint grok_phase1c_submission_guard_caller_fk
    foreign key (caller_id) references auth.users(id) on delete restrict,
  constraint grok_phase1c_submission_guard_organization_fk
    foreign key (organization_id)
    references public.organizations(id) on delete restrict,
  constraint grok_phase1c_submission_guard_admission_fk
    foreign key (admission_id)
    references public.grok_execution_admissions(id) on delete restrict,
  constraint grok_phase1c_submission_guard_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint grok_phase1c_submission_guard_bridge_fk
    foreign key (bridge_id, organization_id)
    references public.graph_phase1c_bridges(id, organization_id) on delete restrict,
  constraint grok_phase1c_submission_guard_bridge_unique
    unique (bridge_id, organization_id)
);

create index grok_phase1c_submission_guards_project_expiry_idx
  on public.grok_phase1c_submission_guards (
    organization_id, project_id, expires_at, token
  );
create index grok_phase1c_submission_guards_admission_idx
  on public.grok_phase1c_submission_guards (admission_id);

comment on table public.grok_phase1c_submission_guards is
  'Private one-use transaction capabilities binding an owner, tenant, graph bridge, exact current Phase 1C admission, idempotency identity, and canonical parameters. Successful submissions leave no row.';

alter table public.grok_phase1c_submission_guards enable row level security;
alter table public.grok_phase1c_submission_guards force row level security;
revoke all on table public.grok_phase1c_submission_guards
  from public, anon, authenticated, service_role;

create function public.is_current_grok_phase1c_submission_authorized(
  p_organization_id uuid,
  p_project_id uuid,
  p_idempotency_key text,
  p_parameters jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_graph_id uuid;
begin
  select bridge.graph_id into v_graph_id
      from public.grok_phase1c_submission_guards guard
      join public.graph_phase1c_bridges bridge
        on bridge.id = guard.bridge_id
       and bridge.organization_id = guard.organization_id
       and bridge.project_id = guard.project_id
      join public.grok_execution_admissions admission
        on admission.id = guard.admission_id
       and admission.organization_id = guard.organization_id
       and admission.project_id = guard.project_id
       and admission.graph_id = bridge.graph_id
       and admission.graph_node_id = bridge.implementation_node_id
       and admission.lane = 'phase1c'
      join public.grok_graph_launches launch
        on launch.id = admission.graph_launch_id
       and launch.organization_id = admission.organization_id
       and launch.project_id = admission.project_id
       and launch.graph_id = admission.graph_id
     where guard.token::text = pg_catalog.current_setting(
       'softwarefactory.grok_phase1c_submission_token', true
     )
       and guard.caller_id = auth.uid()
       and guard.organization_id = p_organization_id
       and guard.project_id = p_project_id
       and guard.expires_at > pg_catalog.now()
       and bridge.state = 'GRAPH_READY'
       and bridge.command_id is null
       and bridge.task_id is null
       and p_idempotency_key = 'graph-phase1c:' || bridge.id::text
       and pg_catalog.jsonb_typeof(p_parameters) = 'object'
       and not p_parameters ? '_factoryRecordOnlyAuthorization'
       and not p_parameters ? '_grokPhase1CAuthorization'
       and guard.authorized_parameters = p_parameters
       and guard.authorized_parameters ->> 'executionMode' = 'manual'
       and admission.provider = 'openai'::public.bot_provider
       and admission.model = guard.authorized_parameters ->> 'model'
       and guard.authorized_parameters ->> 'provider' = 'openai';
  if not found then
    return false;
  end if;
  return public.assert_current_grok_execution_admissions(v_graph_id);
end;
$function$;

revoke all on function public.is_current_grok_phase1c_submission_authorized(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

do $grok_phase1c_submission_triggers$
declare
  v_routine record;
  v_definition text;
  v_original text;
  v_old text;
  v_new text;
begin
  for v_routine in
    select * from (values
      ('public.normalize_phase1c_command()',
       'cd28d70a40e860660461700926e97830', 'normalize'),
      ('public.plan_phase1c_task_and_run()',
       '2de7070bb9359ce7ad45516da2956a4b', 'plan')
    ) expected(signature, source_md5, kind)
  loop
    if not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = pg_catalog.to_regprocedure(v_routine.signature)
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_routine.source_md5
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
         and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
    ) then
      raise exception using errcode = '55000',
        message = 'Grok Phase 1C submission trigger source or authority drifted';
    end if;
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_routine.signature))
      into v_definition;
    v_definition := pg_catalog.replace(pg_catalog.replace(
      v_definition, E'\r\n', E'\n'
    ), E'\r', E'\n');
    v_original := v_definition;
    if v_routine.kind = 'normalize' then
      v_old := $old$        new.parameters ->> 'provider' <> 'openai'
        or new.parameters ->> 'model' <> 'gpt-5.3-codex'$old$;
      v_new := $new$        new.parameters ->> 'provider' is distinct from 'openai'
        or (
          new.parameters ->> 'model' is distinct from 'gpt-5.3-codex'
          and not public.is_current_grok_phase1c_submission_authorized(
            new.organization_id,
            new.project_id,
            new.idempotency_key,
            new.parameters
          )
        )$new$;
    else
      v_old := $old$    or (execution_mode_value = 'manual' and (provider_text <> 'openai' or model_text <> 'gpt-5.3-codex'))$old$;
      v_new := $new$    or (
      execution_mode_value = 'manual'
      and (
        provider_text is distinct from 'openai'
        or (
          model_text is distinct from 'gpt-5.3-codex'
          and not public.is_current_grok_phase1c_submission_authorized(
            new.organization_id,
            new.project_id,
            command_record.idempotency_key,
            command_record.parameters
          )
        )
      )
    )$new$;
    end if;
    v_old := pg_catalog.replace(pg_catalog.replace(
      v_old, E'\r\n', E'\n'
    ), E'\r', E'\n');
    v_new := pg_catalog.replace(pg_catalog.replace(
      v_new, E'\r\n', E'\n'
    ), E'\r', E'\n');
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
    if v_definition = v_original
        or pg_catalog.strpos(
          v_definition, 'is_current_grok_phase1c_submission_authorized'
        ) = 0
    then
      raise exception using errcode = '55000',
        message = 'Grok Phase 1C submission trigger rewrite did not match';
    end if;
    execute v_definition;
  end loop;
end;
$grok_phase1c_submission_triggers$;

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
  v_caller uuid := auth.uid();
  v_execution_mode text := coalesce(p_parameters ->> 'executionMode', '');
  v_record_only_token text := p_parameters ->> '_factoryRecordOnlyAuthorization';
  v_grok_token text := p_parameters ->> '_grokPhase1CAuthorization';
  v_parameters jsonb := coalesce(p_parameters, '{}'::jsonb)
    - '_factoryRecordOnlyAuthorization' - '_grokPhase1CAuthorization';
begin
  if p_parameters ? '_factoryRecordOnlyAuthorization'
      and p_parameters ? '_grokPhase1CAuthorization'
  then
    raise exception using errcode = '22023',
      message = 'Phase 1C execution configuration is not supported';
  end if;
  if v_execution_mode = 'record_only' then
    if v_caller is null
      or coalesce(v_record_only_token, '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_parameters ? '_grokPhase1CAuthorization' then
      raise exception using errcode = '22023',
        message = 'Phase 1C execution configuration is not supported';
    end if;
    delete from public.factory_record_only_submission_guards guard
     where guard.token = v_record_only_token::uuid
       and guard.caller_id = v_caller
       and guard.project_id = p_project_id
       and guard.authorized_parameters = v_parameters;
    if not found then
      raise exception using errcode = '22023',
        message = 'Phase 1C execution configuration is not supported';
    end if;
  elsif p_parameters ? '_grokPhase1CAuthorization' then
    if v_caller is null
      or v_execution_mode is distinct from 'manual'
      or coalesce(v_grok_token, '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (
        select 1
          from public.grok_phase1c_submission_guards guard
          join public.graph_phase1c_bridges bridge
            on bridge.id = guard.bridge_id
           and bridge.organization_id = guard.organization_id
           and bridge.project_id = guard.project_id
         where guard.token::text = v_grok_token
           and guard.caller_id = v_caller
           and guard.project_id = p_project_id
           and guard.authorized_parameters = v_parameters
           and guard.expires_at > pg_catalog.now()
           and p_idempotency_key = 'graph-phase1c:' || bridge.id::text
      )
    then
      raise exception using errcode = '22023',
        message = 'Phase 1C execution configuration is not supported';
    end if;
    perform pg_catalog.set_config(
      'softwarefactory.grok_phase1c_submission_token', v_grok_token, true
    );
  elsif p_parameters ? '_factoryRecordOnlyAuthorization'
      or p_parameters ? '_grokPhase1CAuthorization'
  then
    raise exception using errcode = '22023',
      message = 'Phase 1C execution configuration is not supported';
  end if;

  return query
  select submission.command_id, submission.task_id,
    submission.command_state, submission.task_state,
    submission.requires_owner_approval, submission.was_created
  from public.submit_command_phase1c_normalized_internal(
    p_project_id,
    p_prompt,
    p_requested_risk,
    case
      when v_execution_mode = 'record_only'
        or p_parameters ? '_grokPhase1CAuthorization'
        then v_parameters
      else p_parameters
    end,
    p_idempotency_key
  ) submission;
end;
$function$;

revoke all on function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) to authenticated;
comment on function public.submit_command(
  uuid, text, public.risk_level, jsonb, text
) is
  'Persists legacy fixed manual Codex commands and exact current Grok Phase 1C OpenAI commands only through a private one-use bridge admission. Reserved capability fields never persist.';

-- A bridge-bound command must continue to match the exact live implementation
-- admission whenever it is attached or later crosses the queued-run boundary.
create function public.validate_current_grok_phase1c_command_route(
  p_bridge_id uuid,
  p_command_id uuid,
  p_organization_id uuid,
  p_project_id uuid,
  p_idempotency_key text,
  p_parameters jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_bridge public.graph_phase1c_bridges;
  v_admission public.grok_execution_admissions;
begin
  select bridge.* into v_bridge
    from public.graph_phase1c_bridges bridge
   where bridge.id = p_bridge_id
     and bridge.organization_id = p_organization_id
     and bridge.project_id = p_project_id
     and (bridge.command_id is null or bridge.command_id = p_command_id)
   for update;
  if not found then
    return false;
  end if;
  if not public.assert_current_grok_execution_admissions(v_bridge.graph_id) then
    return false;
  end if;
  select admission.* into v_admission
    from public.grok_execution_admissions admission
   where admission.graph_id = v_bridge.graph_id
     and admission.organization_id = v_bridge.organization_id
     and admission.project_id = v_bridge.project_id
     and admission.graph_node_id = v_bridge.implementation_node_id
     and admission.lane = 'phase1c';
  if not found
      or p_idempotency_key is distinct from
        ('graph-phase1c:' || v_bridge.id::text)
      or p_parameters #>> '{executionMode}' is distinct from 'manual'
      or p_parameters #>> '{provider}' is distinct from 'openai'
      or v_admission.provider is distinct from 'openai'::public.bot_provider
      or p_parameters #>> '{model}' is distinct from v_admission.model
  then
    raise exception using errcode = '55000',
      message = 'Phase 1C command does not match its current Grok admission';
  end if;
  return true;
end;
$function$;

revoke all on function public.validate_current_grok_phase1c_command_route(
  uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.attach_graph_phase1c_command_for_approved_gate(
  p_bridge_id uuid,
  p_command_id uuid,
  p_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  command_record public.commands%rowtype;
  task_record public.tasks%rowtype;
  v_is_grok boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = p_bridge_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'graph Phase 1C bridge not found';
  end if;
  if not public.is_organization_owner(bridge_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required';
  end if;
  select exists (
    select 1 from public.grok_graph_launches launch
     where launch.graph_id = bridge_record.graph_id
       and launch.organization_id = bridge_record.organization_id
       and launch.project_id = bridge_record.project_id
  ) into v_is_grok;

  if public.graph_phase1c_bridge_state_rank(bridge_record.state) >=
      public.graph_phase1c_bridge_state_rank('COMMAND_RECORDED') then
    if bridge_record.command_id = p_command_id and bridge_record.task_id = p_task_id then
      select * into command_record
        from public.commands command
       where command.id = p_command_id
         and command.organization_id = bridge_record.organization_id
         and command.project_id = bridge_record.project_id;
      if not found then
        raise exception using errcode = '23514',
          message = 'attached command no longer belongs to the bridge tenant project';
      end if;
      if v_is_grok and not public.validate_current_grok_phase1c_command_route(
          bridge_record.id,
          command_record.id,
          command_record.organization_id,
          command_record.project_id,
          command_record.idempotency_key,
          command_record.parameters
        )
      then
        raise exception using errcode = '55000',
          message = 'Grok bridge command has no current execution admission';
      end if;
      return bridge_record.id;
    end if;
    raise exception using errcode = '55000',
      message = 'bridge command and task identity is already fixed';
  end if;
  if bridge_record.state <> 'GRAPH_READY' then
    raise exception using errcode = '55000',
      message = 'bridge is not ready for command attachment';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = bridge_record.graph_id
    and graph.organization_id = bridge_record.organization_id
    and graph.project_id = bridge_record.project_id;
  if not found
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or graph_record.github_repository_id is null
    or graph_record.base_branch is null
    or graph_record.base_sha is null
  then
    raise exception using errcode = '55000',
      message = 'exact persisted full_lifecycle v2 release identity is required';
  end if;

  select * into command_record
  from public.commands command
  where command.id = p_command_id
    and command.organization_id = bridge_record.organization_id
    and command.project_id = bridge_record.project_id
  for update;
  if not found then
    raise exception using errcode = '23514',
      message = 'command does not belong to the bridge tenant project';
  end if;

  select * into task_record
  from public.tasks task
  where task.id = p_task_id
    and task.organization_id = bridge_record.organization_id
    and task.project_id = bridge_record.project_id
  for update;
  if not found or task_record.command_id is distinct from command_record.id then
    raise exception using errcode = '23514',
      message = 'task does not belong to the bridge command';
  end if;

  if command_record.submitted_by is distinct from auth.uid()
    or command_record.idempotency_key is distinct from
      ('graph-phase1c:' || bridge_record.id::text)
    or command_record.command_type is distinct from 'build_feature'
    or command_record.requested_risk is distinct from graph_record.risk_level
    or command_record.parameters #>> '{executionMode}' is distinct from 'manual'
    or command_record.parameters #>> '{repositoryBinding,repositoryId}' is distinct from
      graph_record.github_repository_id::text
    or command_record.parameters #>> '{repositoryBinding,baseBranch}' is distinct from
      graph_record.base_branch
    or command_record.parameters #>> '{repositoryBinding,baseSha}' is distinct from
      graph_record.base_sha
    or command_record.status not in (
      'submitted'::public.command_status,
      'awaiting_approval'::public.command_status,
      'queued'::public.command_status
    )
    or task_record.created_by is distinct from command_record.submitted_by
    or task_record.risk_level is distinct from command_record.requested_risk
    or task_record.status not in (
      'backlog'::public.task_status,
      'awaiting_approval'::public.task_status,
      'queued'::public.task_status
    )
  then
    raise exception using errcode = '23514',
      message = 'command and task do not match the approved graph release contract';
  end if;

  if v_is_grok and not public.validate_current_grok_phase1c_command_route(
      bridge_record.id,
      command_record.id,
      command_record.organization_id,
      command_record.project_id,
      command_record.idempotency_key,
      command_record.parameters
    )
  then
    raise exception using errcode = '55000',
      message = 'Grok bridge command has no current execution admission';
  end if;

  update public.graph_phase1c_bridges
  set command_id = command_record.id,
      task_id = task_record.id,
      state = 'COMMAND_RECORDED'
  where id = bridge_record.id;

  return bridge_record.id;
end;
$function$;

revoke all on function public.attach_graph_phase1c_command_for_approved_gate(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
comment on function public.attach_graph_phase1c_command_for_approved_gate(
  uuid, uuid, uuid
) is
  'Privately attaches an owner-approved command/task pair. Grok bridges revalidate the exact current implementation admission and provider/model; legacy bridges retain the fixed Codex contract.';

create or replace function public.queue_phase1c_run_for_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  command_record public.commands%rowtype;
  binding jsonb;
  v_bridge_id uuid;
  v_guard_authorized boolean;
  v_is_grok boolean;
begin
  if new.command_id is null or new.status <> 'queued'::public.task_status then return new; end if;
  select command.* into command_record from public.commands command
  where command.id = new.command_id and command.organization_id = new.organization_id;
  if not found or command_record.requested_risk = 'red'::public.risk_level then return new; end if;
  if command_record.parameters ->> 'executionMode' = 'record_only' then return new; end if;

  v_guard_authorized := public.is_current_grok_phase1c_submission_authorized(
    command_record.organization_id,
    command_record.project_id,
    command_record.idempotency_key,
    command_record.parameters
  );
  if not v_guard_authorized then
    select bridge.id, exists (
      select 1 from public.grok_graph_launches launch
       where launch.graph_id = bridge.graph_id
         and launch.organization_id = bridge.organization_id
         and launch.project_id = bridge.project_id
    ) into v_bridge_id, v_is_grok
      from public.graph_phase1c_bridges bridge
     where bridge.command_id = command_record.id
       and bridge.organization_id = command_record.organization_id
       and bridge.project_id = command_record.project_id
     for update;
    if found and v_is_grok then
      if not public.validate_current_grok_phase1c_command_route(
          v_bridge_id,
          command_record.id,
          command_record.organization_id,
          command_record.project_id,
          command_record.idempotency_key,
          command_record.parameters
        )
      then
        raise exception using errcode = '55000',
          message = 'Grok Phase 1C queued run has no current execution admission';
      end if;
    end if;
    if (not found or not coalesce(v_is_grok, false))
      and (command_record.parameters ->> 'provider' is distinct from 'openai'
       or command_record.parameters ->> 'model' is distinct from 'gpt-5.3-codex'
      ) then
      raise exception using errcode = '55000',
        message = 'Phase 1C queued run has no current execution admission';
    end if;
  end if;

  binding := command_record.parameters -> 'repositoryBinding';
  insert into public.agent_runs (
    organization_id, project_id, task_id, command_id, agent_id, status,
    input, connection_id, github_repository_id, risk_level, logical_agent_role,
    provider, model, base_branch, base_sha, max_attempts
  ) values (
    new.organization_id, new.project_id, new.id, new.command_id, new.assigned_agent_id,
    'queued'::public.run_status,
    pg_catalog.jsonb_build_object(
      'commandType', command_record.command_type,
      'acceptanceCriteria', command_record.acceptance_criteria,
      'plan', command_record.execution_plan
    ),
    (binding ->> 'connectionId')::uuid,
    (binding ->> 'repositoryId')::uuid,
    command_record.requested_risk,
    (command_record.parameters ->> 'agentRole')::public.agent_role,
    command_record.parameters ->> 'provider',
    command_record.parameters ->> 'model',
    binding ->> 'baseBranch',
    pg_catalog.lower(binding ->> 'baseSha'),
    2
  );
  return new;
end;
$function$;

revoke all on function public.queue_phase1c_run_for_task()
  from public, anon, authenticated, service_role;
comment on function public.queue_phase1c_run_for_task() is
  'Queues a run only for legacy fixed Codex execution or an exact current Grok Phase 1C OpenAI admission. Record-only work never creates a run, and delayed Grok queueing revalidates admission.';

create or replace function public.submit_and_attach_graph_phase1c_command(
  p_bridge_id uuid,
  p_parameters jsonb
)
returns table (
  bridge_id uuid,
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
  bridge_record public.graph_phase1c_bridges%rowtype;
  graph_record public.graphs%rowtype;
  artifact_record public.graph_artifacts%rowtype;
  admission_record public.grok_execution_admissions%rowtype;
  submission_record record;
  canonical_prompt text;
  expected_intent_sha256 text;
  canonical_parameters jsonb := p_parameters;
  guard_token uuid;
  grok_admission_required boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if p_parameters ? '_factoryRecordOnlyAuthorization'
      or p_parameters ? '_grokPhase1CAuthorization'
  then
    raise exception using errcode = '22023',
      message = 'reserved Phase 1C authorization fields are not accepted';
  end if;

  select * into bridge_record
  from public.graph_phase1c_bridges bridge
  where bridge.id = p_bridge_id
  for update;
  if not found or not public.is_organization_owner(bridge_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner access is required';
  end if;

  select * into graph_record
  from public.graphs graph
  where graph.id = bridge_record.graph_id
    and graph.organization_id = bridge_record.organization_id
    and graph.project_id = bridge_record.project_id;
  if not found
    or not graph_record.is_lifecycle
    or graph_record.template_key is distinct from 'full_lifecycle'
    or graph_record.template_version is distinct from 2
    or graph_record.risk_level is distinct from 'yellow'::public.risk_level
    or graph_record.github_repository_id is null
    or graph_record.base_branch is null
    or graph_record.base_sha is null
  then
    raise exception using errcode = '23514',
      message = 'exact persisted full lifecycle release identity is required';
  end if;

  grok_admission_required := public.assert_current_grok_execution_admissions(
    graph_record.id
  );
  if grok_admission_required then
    select admission.* into admission_record
      from public.grok_execution_admissions admission
     where admission.graph_id = bridge_record.graph_id
       and admission.organization_id = bridge_record.organization_id
       and admission.project_id = bridge_record.project_id
       and admission.graph_node_id = bridge_record.implementation_node_id
       and admission.lane = 'phase1c';
    if not found
      or admission_record.provider is distinct from 'openai'::public.bot_provider
      or admission_record.model is null
      or admission_record.model is distinct from pg_catalog.btrim(admission_record.model)
      or pg_catalog.char_length(admission_record.model) not between 1 and 128
      or admission_record.model ~ '[[:cntrl:]]'
    then
      raise exception using errcode = '55000',
        message = 'Grok Phase 1C admission has no exact OpenAI route';
    end if;
    canonical_parameters := coalesce(p_parameters, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'executionMode', 'manual',
        'provider', 'openai',
        'model', admission_record.model
      );
  end if;

  select * into artifact_record
  from public.graph_artifacts artifact
  where artifact.id = bridge_record.architecture_artifact_id
    and artifact.organization_id = bridge_record.organization_id
    and artifact.graph_run_id = bridge_record.graph_run_id
    and artifact.kind = 'RAW'::public.graph_artifact_kind;
  if not found then
    raise exception using errcode = '23514',
      message = 'approved architecture artifact identity is missing';
  end if;

  expected_intent_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'version', 1,
        'goal', graph_record.goal,
        'architecture', artifact_record.payload
      )::text,
      'UTF8'
    )),
    'hex'
  );
  if bridge_record.architecture_intent_sha256 is distinct from expected_intent_sha256 then
    raise exception using errcode = '55000',
      message = 'approved architecture intent digest does not match stored evidence';
  end if;

  canonical_prompt :=
    'Implement the exact architecture approved by the owner in this full lifecycle.' || E'\n' ||
    'Work only in the connected repository snapshot recorded below. Produce a validated draft pull request; do not merge or deploy.' || E'\n\n' ||
    'Goal:' || E'\n' || pg_catalog.btrim(graph_record.goal) || E'\n\n' ||
    'Approved architecture:' || E'\n' || artifact_record.payload::text || E'\n\n' ||
    'Architecture intent SHA-256: ' || expected_intent_sha256 || E'\n' ||
    'Preserve unrelated behavior and report validation evidence.';
  if pg_catalog.char_length(canonical_prompt) not between 1 and 4000
    or public.text_has_likely_secret(canonical_prompt)
    or public.jsonb_has_sensitive_keys(artifact_record.payload)
  then
    raise exception using errcode = '22023',
      message = 'approved architecture cannot be represented as a safe bounded Phase 1C command';
  end if;

  if grok_admission_required then
    -- Match the authoritative normalization performed by the unchanged
    -- Phase 1C persistence core so the one-use capability binds the exact row
    -- seen by both command and task triggers, not merely the browser input.
    canonical_parameters := pg_catalog.jsonb_set(
      canonical_parameters,
      '{riskAssessment}',
      coalesce(canonical_parameters -> 'riskAssessment', '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'effectiveRisk', graph_record.risk_level::text,
          'classificationSource', 'database_policy'
        ),
      true
    );
    guard_token := gen_random_uuid();
    insert into public.grok_phase1c_submission_guards (
      token, caller_id, organization_id, project_id, bridge_id,
      admission_id, authorized_parameters
    ) values (
      guard_token, auth.uid(), bridge_record.organization_id,
      bridge_record.project_id, bridge_record.id, admission_record.id,
      canonical_parameters
    );
  end if;

  select * into submission_record
  from public.submit_command(
    graph_record.project_id,
    canonical_prompt,
    graph_record.risk_level,
    case when guard_token is null then canonical_parameters else
      canonical_parameters || pg_catalog.jsonb_build_object(
        '_grokPhase1CAuthorization', guard_token::text
      )
    end,
    'graph-phase1c:' || bridge_record.id::text
  );
  if not found then
    raise exception using errcode = '55000',
      message = 'Phase 1C command submission returned no identity';
  end if;
  if guard_token is not null then
    delete from public.grok_phase1c_submission_guards guard
     where guard.token = guard_token
       and guard.bridge_id = bridge_record.id
       and guard.admission_id = admission_record.id
       and guard.authorized_parameters = canonical_parameters;
    if not found then
      raise exception using errcode = '55000',
        message = 'Grok Phase 1C submission authorization was not consumed';
    end if;
  end if;

  perform public.attach_graph_phase1c_command_for_approved_gate(
    bridge_record.id,
    submission_record.command_id,
    submission_record.task_id
  );

  return query select
    bridge_record.id,
    submission_record.command_id,
    submission_record.task_id,
    submission_record.command_state,
    submission_record.task_state,
    submission_record.requires_owner_approval,
    submission_record.was_created;
end;
$function$;

revoke all on function public.submit_and_attach_graph_phase1c_command(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_and_attach_graph_phase1c_command(uuid, jsonb)
  to authenticated;
comment on function public.submit_and_attach_graph_phase1c_command(uuid, jsonb) is
  'Atomically derives approved architecture identity, revalidates current Grok admissions, canonicalizes the exact admitted Phase 1C OpenAI model, records and queues without dispatching a worker, consumes its private guard, and attaches the command. Non-Grok bridges retain the reviewed fixed model.';

-- The legacy selector fixed every Phase 1C worker to one Codex model. Keep the
-- selector's reviewed state machine intact, but allow its private callers to
-- pass any bounded OpenAI model and require an explicit Grok/legacy scope. The
-- v3 wrappers below are the only service-role entry points after this migration.
do $phase1c_selector_scope$
declare
  v_selector_oid oid := pg_catalog.to_regprocedure(
    'public.claim_phase1c_run_target_budget_internal(text,text,text,integer,uuid)'
  );
  v_definition text;
  v_original text;
begin
  if v_selector_oid is null or not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = v_selector_oid
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
       and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
         routine.prosrc, E'\r\n', E'\n'
       ), E'\r', E'\n')) = 'c5344ba089c00fffcc263a1253087ab9'
       and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE')
  ) then
    raise exception using errcode = '55000',
      message = 'Phase 1C admission selector source or authority drifted';
  end if;

  select pg_catalog.pg_get_functiondef(v_selector_oid) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
$old$p_provider <> 'openai' or p_model <> 'gpt-5.3-codex'$old$,
$new$p_provider is distinct from 'openai'
      or p_model is null
      or p_model is distinct from pg_catalog.btrim(p_model)
      or pg_catalog.char_length(p_model) not between 1 and 128
      or p_model ~ '[[:cntrl:]]'
$new$
  );
  v_definition := pg_catalog.replace(
    v_definition,
$old$  for exhausted_run in$old$,
$new$  if pg_catalog.current_setting('softwarefactory.phase1c_claim_scope', true)
      not in ('grok', 'legacy')
  then
    raise exception using errcode = '42501', message = 'Phase 1C claim scope is required';
  end if;
  for exhausted_run in$new$
  );
  v_definition := pg_catalog.replace(
    v_definition,
$old$where (p_target_command_id is null or run.command_id = p_target_command_id)$old$,
$new$where (p_target_command_id is null or run.command_id = p_target_command_id)
      and (
        (
          pg_catalog.current_setting('softwarefactory.phase1c_claim_scope', true) = 'grok'
          and exists (
            select 1
              from public.graph_phase1c_bridges bridge
              join public.grok_graph_launches launch
                on launch.graph_id = bridge.graph_id
               and launch.organization_id = bridge.organization_id
               and launch.project_id = bridge.project_id
             where bridge.command_id = run.command_id
               and bridge.organization_id = run.organization_id
               and bridge.project_id = run.project_id
          )
        )
        or (
          pg_catalog.current_setting('softwarefactory.phase1c_claim_scope', true) = 'legacy'
          and not exists (
            select 1
              from public.graph_phase1c_bridges bridge
              join public.grok_graph_launches launch
                on launch.graph_id = bridge.graph_id
               and launch.organization_id = bridge.organization_id
               and launch.project_id = bridge.project_id
             where bridge.command_id = run.command_id
               and bridge.organization_id = run.organization_id
               and bridge.project_id = run.project_id
          )
        )
      )$new$
  );
  if v_definition = v_original
      or pg_catalog.strpos(v_definition, 'Phase 1C claim scope is required') = 0
      or pg_catalog.strpos(v_definition, 'softwarefactory.phase1c_claim_scope') = 0
  then
    raise exception using errcode = '55000',
      message = 'Phase 1C admission selector rewrite did not match';
  end if;
  execute v_definition;
end;
$phase1c_selector_scope$;

create function public.current_grok_phase1c_claim_route(
  p_target_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_bridge public.graph_phase1c_bridges;
  v_admission public.grok_execution_admissions;
begin
  if p_target_command_id is null then
    return null;
  end if;
  select bridge.* into v_bridge
    from public.graph_phase1c_bridges bridge
    join public.grok_graph_launches launch
      on launch.graph_id = bridge.graph_id
     and launch.organization_id = bridge.organization_id
     and launch.project_id = bridge.project_id
   where bridge.command_id = p_target_command_id;
  if not found then
    return null;
  end if;

  if not public.assert_current_grok_execution_admissions(v_bridge.graph_id) then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C route lost its immutable launch';
  end if;
  select admission.* into v_admission
    from public.grok_execution_admissions admission
   where admission.graph_id = v_bridge.graph_id
     and admission.organization_id = v_bridge.organization_id
     and admission.graph_node_id = v_bridge.implementation_node_id
     and admission.lane = 'phase1c';
  if not found
      or v_admission.provider is distinct from 'openai'::public.bot_provider
      or v_admission.model is null
      or v_admission.model is distinct from pg_catalog.btrim(v_admission.model)
      or pg_catalog.char_length(v_admission.model) not between 1 and 128
      or v_admission.model ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C admission has no exact OpenAI route';
  end if;
  if exists (
    select 1
      from public.agent_runs run
     where run.command_id = p_target_command_id
       and run.organization_id = v_bridge.organization_id
       and run.project_id = v_bridge.project_id
       and run.status in ('queued'::public.run_status, 'running'::public.run_status)
       and (
         run.provider is distinct from 'openai'
         or run.model is distinct from v_admission.model
       )
  ) then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C run does not match its exact admission';
  end if;
  return pg_catalog.jsonb_build_object(
    'command_id', p_target_command_id,
    'provider', 'openai',
    'model', v_admission.model
  );
end;
$function$;

revoke all on function public.current_grok_phase1c_claim_route(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.claim_phase1c_run_target_internal(
  p_worker_id text, p_provider text, p_model text,
  p_lease_seconds integer,
  p_target_command_id uuid
)
returns table (
  run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
  command_id uuid, agent_id uuid, prompt text, command_type text,
  requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
  connection_id uuid, repository_id uuid, internal_installation_id uuid,
  external_installation_id bigint, app_id bigint, external_repository_id bigint,
  repository_full_name text, base_branch text, base_sha text,
  lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
  cancellation_requested boolean, logical_agent_role text, provider text, model text,
  maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
  maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
  owner_approval_id uuid, owner_approval_expires_at timestamptz,
  recovery_head_branch text, recovery_head_sha text,
  recovery_pull_request_number integer, recovery_pull_request_url text,
  recovery_provider_run_reference text, recovery_usage jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_route jsonb;
  v_exact_model text;
begin
  if p_target_command_id is null then
    raise exception using errcode = '22023', message = 'an exact target command id is required';
  end if;
  if p_provider is distinct from 'openai' then
    raise exception using errcode = '22023', message = 'unsupported worker provider';
  end if;
  v_route := public.current_grok_phase1c_claim_route(p_target_command_id);
  if v_route is null then
    if p_model is distinct from 'gpt-5.3-codex' then
      raise exception using errcode = '22023',
        message = 'legacy Phase 1C claims require the fixed Codex model';
    end if;
    v_exact_model := p_model;
    perform pg_catalog.set_config('softwarefactory.phase1c_claim_scope', 'legacy', true);
  else
    v_exact_model := v_route ->> 'model';
    perform pg_catalog.set_config('softwarefactory.phase1c_claim_scope', 'grok', true);
  end if;
  return query
  select claimed.*
    from public.claim_phase1c_run_target_budget_internal(
      p_worker_id, 'openai', v_exact_model, p_lease_seconds, p_target_command_id
    ) claimed;
end;
$function$;

create or replace function public.claim_phase1c_run_budget_internal(
  p_worker_id text, p_provider text, p_model text,
  p_lease_seconds integer default 120
)
returns table (
  run_id uuid, organization_id uuid, project_id uuid, task_id uuid,
  command_id uuid, agent_id uuid, prompt text, command_type text,
  requested_risk public.risk_level, acceptance_criteria jsonb, plan jsonb,
  connection_id uuid, repository_id uuid, internal_installation_id uuid,
  external_installation_id bigint, app_id bigint, external_repository_id bigint,
  repository_full_name text, base_branch text, base_sha text,
  lease_token uuid, lease_expires_at timestamptz, attempt_number integer,
  cancellation_requested boolean, logical_agent_role text, provider text, model text,
  maximum_duration_ms integer, maximum_turns integer, maximum_input_tokens integer,
  maximum_output_tokens integer, maximum_repair_attempts integer, ci_timeout_ms integer,
  owner_approval_id uuid, owner_approval_expires_at timestamptz,
  recovery_head_branch text, recovery_head_sha text,
  recovery_pull_request_number integer, recovery_pull_request_url text,
  recovery_provider_run_reference text, recovery_usage jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_candidate record;
begin
  if p_provider is distinct from 'openai' then
    raise exception using errcode = '22023', message = 'unsupported worker provider';
  end if;
  for v_candidate in
    select candidate.command_id
      from (
        select distinct on (run.command_id)
          run.command_id, run.created_at, run.id
          from public.agent_runs run
          join public.graph_phase1c_bridges bridge
            on bridge.command_id = run.command_id
           and bridge.organization_id = run.organization_id
           and bridge.project_id = run.project_id
          join public.grok_graph_launches launch
            on launch.graph_id = bridge.graph_id
           and launch.organization_id = bridge.organization_id
           and launch.project_id = bridge.project_id
         where run.status = 'queued'::public.run_status
            or (
              run.status = 'running'::public.run_status
              and run.lease_expires_at < pg_catalog.now()
            )
         order by run.command_id, run.created_at, run.id
      ) candidate
     order by candidate.created_at, candidate.id, candidate.command_id
     limit 100
  loop
    return query
    select claimed.*
      from public.claim_phase1c_run_target_internal(
        p_worker_id, 'openai', p_model, p_lease_seconds, v_candidate.command_id
      ) claimed;
    if found then
      return;
    end if;
  end loop;

  if p_model is distinct from 'gpt-5.3-codex' then
    raise exception using errcode = '22023',
      message = 'legacy Phase 1C claims require the fixed Codex model';
  end if;
  perform pg_catalog.set_config('softwarefactory.phase1c_claim_scope', 'legacy', true);
  return query
  select claimed.*
    from public.claim_phase1c_run_target_budget_internal(
      p_worker_id, p_provider, p_model, p_lease_seconds, null
    ) claimed;
end;
$function$;

revoke all on function public.claim_phase1c_run_target_budget_internal(
  text, text, text, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_target_internal(
  text, text, text, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_budget_internal(
  text, text, text, integer
) from public, anon, authenticated, service_role;

create function public.claim_phase1c_run_v3(
  p_worker_id text,
  p_provider text,
  p_model text,
  p_lease_seconds integer,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare v_claim jsonb;
begin
  if p_protocol_version is distinct from 3 then
    raise exception using errcode = '0A000', message = 'Phase 1C worker protocol version 3 is required';
  end if;
  select pg_catalog.to_jsonb(claimed) into v_claim
    from public.claim_phase1c_run_v2(
      p_worker_id, p_provider, p_model, p_lease_seconds, 2
    ) claimed;
  return public.attach_current_grok_admission_to_phase1c_claim(v_claim);
end;
$function$;

create function public.claim_phase1c_run_by_command_v3(
  p_worker_id text,
  p_provider text,
  p_model text,
  p_lease_seconds integer,
  p_target_command_id uuid,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare v_claim jsonb;
begin
  if p_protocol_version is distinct from 3 then
    raise exception using errcode = '0A000', message = 'Phase 1C worker protocol version 3 is required';
  end if;
  select pg_catalog.to_jsonb(claimed) into v_claim
    from public.claim_phase1c_run_by_command_v2(
      p_worker_id, p_provider, p_model, p_lease_seconds,
      p_target_command_id, 2
    ) claimed;
  return public.attach_current_grok_admission_to_phase1c_claim(v_claim);
end;
$function$;

revoke all on function public.claim_phase1c_run_v2(text, text, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_by_command_v2(text, text, text, integer, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_v3(text, text, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run_by_command_v3(text, text, text, integer, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_phase1c_run_v3(text, text, text, integer, integer)
  to service_role;
grant execute on function public.claim_phase1c_run_by_command_v3(text, text, text, integer, uuid, integer)
  to service_role;

create function public.read_grok_execution_credential_as_worker(
  p_organization_id uuid,
  p_admission_id uuid,
  p_admission_sha256 text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_admission public.grok_execution_admissions;
  v_envelope text;
begin
  select admission.* into v_admission
    from public.grok_execution_admissions admission
   where admission.id = p_admission_id
     and admission.organization_id = p_organization_id;
  if not found
      or p_admission_sha256 is distinct from v_admission.admission_sha256
      or p_admission_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '42501', message = 'grok execution admission identity mismatch';
  end if;
  perform public.assert_current_grok_execution_admissions(v_admission.graph_id);
  select credential.sealed_envelope into v_envelope
    from public.provider_credentials credential
   where credential.id = v_admission.provider_credential_id
     and credential.organization_id = v_admission.organization_id
     and credential.purpose = v_admission.credential_purpose
     and credential.rotated_at = v_admission.provider_credential_rotated_at;
  if not found then
    raise exception using errcode = '55000', message = 'grok admitted credential is no longer current';
  end if;
  return v_envelope;
end;
$function$;

revoke all on function public.read_grok_execution_credential_as_worker(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.read_grok_execution_credential_as_worker(uuid, uuid, text)
  to service_role;

create function public.apply_grok_graph_control_v2_as_owner(
  p_organization_id uuid,
  p_session_id uuid,
  p_graph_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key text
)
returns table (
  intent_id uuid, organization_id uuid, project_id uuid, session_id uuid,
  graph_id uuid, action text, state text, idempotency_key text, replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null
      or not public.has_organization_role(
        p_organization_id,
        array['owner'::public.organization_member_role]
      )
      or not exists (
        select 1
          from public.grok_sessions session
          join public.grok_graph_launches launch
            on launch.session_id = session.id
           and launch.organization_id = session.organization_id
           and launch.project_id = session.project_id
         where session.id = p_session_id
           and session.organization_id = p_organization_id
           and launch.graph_id = p_graph_id
      )
  then
    raise exception using errcode = '42501', message = 'Grok graph control is not authorized';
  end if;
  if p_action = 'resume' then
    if not public.assert_current_grok_execution_admissions(p_graph_id) then
      raise exception using errcode = '55000', message = 'Grok resume requires current execution admissions';
    end if;
  end if;
  return query select * from public.apply_grok_graph_control_as_owner(
    p_organization_id, p_session_id, p_graph_id, p_action, p_reason, p_idempotency_key
  );
end;
$function$;

create function public.set_graph_pause_as_member_v2(
  p_organization_id uuid,
  p_graph_id uuid,
  p_paused boolean
)
returns public.graphs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null
      or not public.is_organization_member(p_organization_id)
      or not exists (
        select 1 from public.graphs graph
         where graph.id = p_graph_id
           and graph.organization_id = p_organization_id
      )
  then
    raise exception using errcode = '42501', message = 'Graph pause control is not authorized';
  end if;
  if p_paused is false then
    perform public.assert_current_grok_execution_admissions(p_graph_id);
  end if;
  return public.set_graph_pause_as_member(p_organization_id, p_graph_id, p_paused);
end;
$function$;

create function public.assert_grok_graph_admission_as_member(
  p_organization_id uuid,
  p_graph_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id)
      or not exists (
        select 1 from public.graphs graph
         where graph.id = p_graph_id and graph.organization_id = p_organization_id
      )
  then
    raise exception using errcode = '42501', message = 'graph admission read is not authorized';
  end if;
  return public.assert_current_grok_execution_admissions(p_graph_id);
end;
$function$;

revoke all on function public.apply_grok_graph_control_as_owner(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_graph_pause_as_member(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_grok_graph_control_v2_as_owner(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_graph_pause_as_member_v2(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_grok_graph_admission_as_member(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_grok_graph_control_v2_as_owner(uuid, uuid, uuid, text, text, text)
  to authenticated;
grant execute on function public.set_graph_pause_as_member_v2(uuid, uuid, boolean)
  to authenticated;
grant execute on function public.assert_grok_graph_admission_as_member(uuid, uuid)
  to authenticated;

do $postflight$
declare
  v_expected record;
  v_routine oid;
  v_acl_count integer;
  v_function_count integer := 0;
begin
  if not exists (
    select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace space on space.oid = relation.relnamespace
     where space.nspname = 'public'
       and relation.relname = 'grok_execution_admissions'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) or not exists (
    select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace space on space.oid = relation.relnamespace
     where space.nspname = 'public'
       and relation.relname = 'grok_phase1c_submission_guards'
       and relation.relkind = 'r'
       and relation.relrowsecurity
       and relation.relforcerowsecurity
       and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
       and not exists (
         select 1
           from pg_catalog.aclexplode(coalesce(
             relation.relacl,
             pg_catalog.acldefault('r', relation.relowner)
           )) privilege
          where privilege.grantor <> relation.relowner
             or privilege.grantee <> relation.relowner
             or privilege.is_grantable
       )
  ) or exists (
    select 1 from pg_catalog.pg_policy policy
     where policy.polrelid = 'public.grok_phase1c_submission_guards'::pg_catalog.regclass
  ) or exists (
    select 1 from pg_catalog.pg_attribute attribute
     where attribute.attrelid =
       'public.grok_phase1c_submission_guards'::pg_catalog.regclass
       and attribute.attnum > 0
       and not attribute.attisdropped
       and attribute.attacl is not null
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.grok_phase1c_submission_guards', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.grok_phase1c_submission_guards', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.grok_phase1c_submission_guards', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'anon', 'public.grok_phase1c_submission_guards', 'INSERT,UPDATE,DELETE'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.grok_phase1c_submission_guards', 'INSERT,UPDATE,DELETE'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.grok_phase1c_submission_guards', 'INSERT,UPDATE,DELETE'
  ) or (select pg_catalog.count(*)
          from public.grok_phase1c_submission_guards) <> 0
  then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C guard relation authority postflight failed';
  end if;

  if (select pg_catalog.count(*)
        from pg_catalog.pg_attribute attribute
       where attribute.attrelid =
         'public.grok_phase1c_submission_guards'::pg_catalog.regclass
         and attribute.attnum > 0 and not attribute.attisdropped) <> 9
    or exists (
      select 1
        from (values
          ('token', 'uuid'),
          ('caller_id', 'uuid'),
          ('organization_id', 'uuid'),
          ('project_id', 'uuid'),
          ('bridge_id', 'uuid'),
          ('admission_id', 'uuid'),
          ('authorized_parameters', 'jsonb'),
          ('created_at', 'timestamp with time zone'),
          ('expires_at', 'timestamp with time zone')
        ) expected(column_name, data_type)
        left join pg_catalog.pg_attribute attribute
          on attribute.attrelid =
            'public.grok_phase1c_submission_guards'::pg_catalog.regclass
         and attribute.attname = expected.column_name
         and attribute.attnum > 0
         and not attribute.attisdropped
         and attribute.attnotnull
         and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) =
           expected.data_type
       where attribute.attnum is null
    )
  then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C guard column postflight failed';
  end if;

  if (select pg_catalog.count(*)
        from pg_catalog.pg_constraint constraint_record
       where constraint_record.conrelid =
         'public.grok_phase1c_submission_guards'::pg_catalog.regclass
         and constraint_record.contype <> 'n') <> 11
    or exists (
      select 1
        from (values
          ('grok_phase1c_submission_guard_admission_fk', 'f'::"char",
           'FOREIGN KEY (admission_id) REFERENCES grok_execution_admissions(id) ON DELETE RESTRICT'),
          ('grok_phase1c_submission_guard_bridge_fk', 'f'::"char",
           'FOREIGN KEY (bridge_id, organization_id) REFERENCES graph_phase1c_bridges(id, organization_id) ON DELETE RESTRICT'),
          ('grok_phase1c_submission_guard_bridge_unique', 'u'::"char",
           'UNIQUE (bridge_id, organization_id)'),
          ('grok_phase1c_submission_guard_caller_fk', 'f'::"char",
           'FOREIGN KEY (caller_id) REFERENCES auth.users(id) ON DELETE RESTRICT'),
          ('grok_phase1c_submission_guard_lifetime', 'c'::"char",
           'CHECK (expires_at > created_at AND expires_at <= (created_at + ''00:05:00''::interval))'),
          ('grok_phase1c_submission_guard_organization_fk', 'f'::"char",
           'FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT'),
          ('grok_phase1c_submission_guard_parameters_bounded', 'c'::"char",
           'CHECK (octet_length(authorized_parameters::text) <= 65536)'),
          ('grok_phase1c_submission_guard_parameters_object', 'c'::"char",
           'CHECK (jsonb_typeof(authorized_parameters) = ''object''::text)'),
          ('grok_phase1c_submission_guard_parameters_safe', 'c'::"char",
           'CHECK (NOT jsonb_has_sensitive_keys(authorized_parameters))'),
          ('grok_phase1c_submission_guard_project_fk', 'f'::"char",
           'FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT'),
          ('grok_phase1c_submission_guards_pkey', 'p'::"char",
           'PRIMARY KEY (token)')
        ) expected(constraint_name, constraint_type, definition)
        left join pg_catalog.pg_constraint constraint_record
          on constraint_record.conrelid =
            'public.grok_phase1c_submission_guards'::pg_catalog.regclass
         and constraint_record.conname = expected.constraint_name
         and constraint_record.contype = expected.constraint_type
         and constraint_record.convalidated
         and pg_catalog.pg_get_constraintdef(
           constraint_record.oid, true
         ) = expected.definition
       where constraint_record.oid is null
    )
  then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C guard constraint postflight failed';
  end if;

  if (select pg_catalog.count(*)
        from pg_catalog.pg_index index_record
       where index_record.indrelid =
         'public.grok_phase1c_submission_guards'::pg_catalog.regclass) <> 4
    or exists (
      select 1
        from (values
          ('grok_phase1c_submission_guard_bridge_unique', true, false,
           'CREATE UNIQUE INDEX grok_phase1c_submission_guard_bridge_unique ON public.grok_phase1c_submission_guards USING btree (bridge_id, organization_id)'),
          ('grok_phase1c_submission_guards_admission_idx', false, false,
           'CREATE INDEX grok_phase1c_submission_guards_admission_idx ON public.grok_phase1c_submission_guards USING btree (admission_id)'),
          ('grok_phase1c_submission_guards_pkey', true, true,
           'CREATE UNIQUE INDEX grok_phase1c_submission_guards_pkey ON public.grok_phase1c_submission_guards USING btree (token)'),
          ('grok_phase1c_submission_guards_project_expiry_idx', false, false,
           'CREATE INDEX grok_phase1c_submission_guards_project_expiry_idx ON public.grok_phase1c_submission_guards USING btree (organization_id, project_id, expires_at, token)')
        ) expected(index_name, is_unique, is_primary, definition)
        left join pg_catalog.pg_class index_relation
          on index_relation.relname = expected.index_name
         and index_relation.relnamespace =
           'public'::pg_catalog.regnamespace
        left join pg_catalog.pg_index index_record
          on index_record.indexrelid = index_relation.oid
         and index_record.indrelid =
           'public.grok_phase1c_submission_guards'::pg_catalog.regclass
         and index_record.indisunique = expected.is_unique
         and index_record.indisprimary = expected.is_primary
         and index_record.indisvalid
         and index_record.indisready
         and pg_catalog.pg_get_indexdef(index_record.indexrelid) =
           expected.definition
       where index_record.indexrelid is null
    )
  then
    raise exception using errcode = '55000',
      message = 'Grok Phase 1C guard index postflight failed';
  end if;

  for v_expected in
    select * from (values
      ('public.grok_current_execution_admission_hash(public.grok_execution_admissions)',
       '5d3611423811e3609dd9f2fc3f2f981a', 'i'::"char", false, null::text, null::text),
      ('public.assert_current_grok_execution_admissions(uuid)',
       'b5dc9166e99634eaa409801055a27d4b', 'v'::"char", true, null, null),
      ('public.grok_execution_admission_projection(public.grok_execution_admissions)',
       'a85f407323a331e54d8d16123c46281f', 'i'::"char", false, null, null),
      ('public.attach_current_grok_admissions_to_claim(jsonb)',
       '0e4a0ba5d0941f6cb43ecee3a23aecbb', 'v'::"char", true, null, null),
      ('public.claim_planned_graph_v3(text,text[],text,jsonb,integer)',
       '4a6da8bed8d1fdda17f11df00d549817', 'v'::"char", true, 'service_role', null),
      ('public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)',
       'f83873aa19703d2c61553026d4141a4c', 'v'::"char", true, 'service_role', null),
      ('public.attach_current_grok_admission_to_phase1c_claim(jsonb)',
       '48f84aba274b2e6316331de8e3fca796', 'v'::"char", true, null, null),
      ('public.is_current_grok_phase1c_submission_authorized(uuid,uuid,text,jsonb)',
       '9878cd04b1d77710cdea3a346e03978f', 'v'::"char", true, null, null),
      ('public.normalize_phase1c_command()',
       'c788b5e2a450a2f061dba63697c10651', 'v'::"char", true, null, null),
      ('public.plan_phase1c_task_and_run()',
       '4ace11525e1e5dacf07f97ed638fffe9', 'v'::"char", true, null, null),
      ('public.submit_command(uuid,text,public.risk_level,jsonb,text)',
       'dda8c6c952852557e13009d0c0e6d26d', 'v'::"char", true, 'authenticated',
       'Persists legacy fixed manual Codex commands and exact current Grok Phase 1C OpenAI commands only through a private one-use bridge admission. Reserved capability fields never persist.'),
      ('public.validate_current_grok_phase1c_command_route(uuid,uuid,uuid,uuid,text,jsonb)',
       'db18ecc80459735c05ceea87eae233dc', 'v'::"char", true, null, null),
      ('public.attach_graph_phase1c_command_for_approved_gate(uuid,uuid,uuid)',
       '3c4b38576896b0867336771a0bab23d2', 'v'::"char", true, null,
       'Privately attaches an owner-approved command/task pair. Grok bridges revalidate the exact current implementation admission and provider/model; legacy bridges retain the fixed Codex contract.'),
      ('public.queue_phase1c_run_for_task()',
       '92238f58e7abbab0ec3c883293394e6b', 'v'::"char", true, null,
       'Queues a run only for legacy fixed Codex execution or an exact current Grok Phase 1C OpenAI admission. Record-only work never creates a run, and delayed Grok queueing revalidates admission.'),
      ('public.submit_and_attach_graph_phase1c_command(uuid,jsonb)',
       'eabe7aea908e4475fe4f89d0480e4826', 'v'::"char", true, 'authenticated',
       'Atomically derives approved architecture identity, revalidates current Grok admissions, canonicalizes the exact admitted Phase 1C OpenAI model, records and queues without dispatching a worker, consumes its private guard, and attaches the command. Non-Grok bridges retain the reviewed fixed model.'),
      ('public.claim_phase1c_run_target_budget_internal(text,text,text,integer,uuid)',
       '2e25eefc2d119d54449a3bbe6a9e413f', 'v'::"char", true, null, null),
      ('public.current_grok_phase1c_claim_route(uuid)',
       'b0b70d6a53f60006c104ba46a1043f92', 'v'::"char", true, null, null),
      ('public.claim_phase1c_run_target_internal(text,text,text,integer,uuid)',
       '77d940d7d9be73dadd06d7f12fe0528c', 'v'::"char", true, null, null),
      ('public.claim_phase1c_run_budget_internal(text,text,text,integer)',
       '00cf400d3eba41e5d5b0ca74586a9234', 'v'::"char", true, null, null),
      ('public.claim_phase1c_run_v3(text,text,text,integer,integer)',
       'ef8803cb5ec809266b8fdf6f048b1a2f', 'v'::"char", true, 'service_role', null),
      ('public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)',
       '14c204c6c9d8da1ed6038d0f56942be8', 'v'::"char", true, 'service_role', null),
      ('public.read_grok_execution_credential_as_worker(uuid,uuid,text)',
       '28124a10dd724bbc09bae2e2d37e9069', 'v'::"char", true, 'service_role', null),
      ('public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)',
       '33742a47dbacb81f9d18d5381b78287d', 'v'::"char", true, 'authenticated', null),
      ('public.set_graph_pause_as_member_v2(uuid,uuid,boolean)',
       'fc9d4fbf5474a296e368cb7e3aba0755', 'v'::"char", true, 'authenticated', null),
      ('public.assert_grok_graph_admission_as_member(uuid,uuid)',
       '93b62aff4f3f1cf0721861058cd20f52', 'v'::"char", true, 'authenticated', null)
    ) expected(
      signature, source_md5, volatility, security_definer,
      exposed_role, object_comment
    )
  loop
    v_function_count := v_function_count + 1;
    v_routine := pg_catalog.to_regprocedure(v_expected.signature);
    select pg_catalog.count(*)::integer into v_acl_count
      from pg_catalog.aclexplode(coalesce(
        (select routine.proacl from pg_catalog.pg_proc routine
          where routine.oid = v_routine),
        pg_catalog.acldefault('f', (
          select routine.proowner from pg_catalog.pg_proc routine
           where routine.oid = v_routine
        ))
      )) privilege;
    if v_routine is null or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid = v_routine
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
         and routine.prosecdef = v_expected.security_definer
         and routine.provolatile = v_expected.volatility
         and routine.proconfig = array['search_path=pg_catalog']::text[]
         and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'
         ), E'\r', E'\n')) = v_expected.source_md5
         and (
           v_expected.object_comment is null
           or pg_catalog.obj_description(routine.oid, 'pg_proc') =
             v_expected.object_comment
         )
         and not pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
         and pg_catalog.has_function_privilege(
           'authenticated', routine.oid, 'EXECUTE'
         ) = coalesce(
           v_expected.exposed_role = 'authenticated', false
         )
         and pg_catalog.has_function_privilege(
           'service_role', routine.oid, 'EXECUTE'
         ) = coalesce(
           v_expected.exposed_role = 'service_role', false
         )
         and not exists (
           select 1
             from pg_catalog.aclexplode(coalesce(
               routine.proacl,
               pg_catalog.acldefault('f', routine.proowner)
             )) privilege
            where privilege.grantor <> routine.proowner
               or privilege.privilege_type <> 'EXECUTE'
               or privilege.is_grantable
               or privilege.grantee not in (
                 routine.proowner,
                 case when v_expected.exposed_role is not null
                   then pg_catalog.to_regrole(v_expected.exposed_role)::oid
                   else routine.proowner
                 end
               )
         )
    ) or v_acl_count <> (
      case when v_expected.exposed_role is null then 1 else 2 end
    )
    then
      raise exception using errcode = '55000',
        message = 'Grok claim admission function postflight failed',
        detail = v_expected.signature;
    end if;
  end loop;

  if v_function_count <> 25
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_phase1c_run_v2(text,text,text,integer,integer)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_phase1c_run_by_command_v2(text,text,text,integer,uuid,integer)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.apply_grok_graph_control_as_owner(uuid,uuid,uuid,text,text,text)',
      'EXECUTE'
    )
  then
    raise exception using errcode = '55000',
      message = 'Grok claim admission legacy ACL postflight failed';
  end if;
end;
$postflight$;
