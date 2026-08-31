-- Immutable provider admission for Grok's canonical Full Lifecycle bridge.
--
-- A planner-selected bot is routing intent until the database proves the
-- exact posting, bot, role, AI account, provider model and credential
-- reference still agree under row locks. This migration records that proof
-- atomically with the already-paused canonical graph. It stores reference
-- names only; provider credential material never enters this table or RPC.
--
-- This is an admission boundary, not a claim or execution boundary. No graph
-- run, node run, provider request, worker dispatch or autonomy switch is
-- created or changed here.

-- The launch and graph-node rows already have individually sufficient keys,
-- but these composites let the admission row prove the whole tenant/session/
-- graph/node relationship in the catalogue rather than through function code.
do $grok_provider_admission_keys$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.grok_graph_launches'::pg_catalog.regclass
       and conname = 'grok_graph_launches_admission_scope_unique'
  ) then
    alter table public.grok_graph_launches
      add constraint grok_graph_launches_admission_scope_unique
      unique (id, organization_id, project_id, session_id, message_id, graph_id);
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.graph_nodes'::pg_catalog.regclass
       and conname = 'graph_nodes_admission_scope_unique'
  ) then
    alter table public.graph_nodes
      add constraint graph_nodes_admission_scope_unique
      unique (id, organization_id, graph_id, node_key);
  end if;
end;
$grok_provider_admission_keys$;

create table public.grok_execution_admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid not null,
  graph_launch_id uuid not null,
  graph_id uuid not null,
  graph_node_id uuid not null,
  node_key text not null,
  source_task_key text not null,
  -- graph_model is executed, in a later authorized slice, by the graph MODEL
  -- worker. phase1c is only the exact canonical implement ANCHOR and must be
  -- carried into the separate Phase 1C bridge before that writer may run.
  lane text not null check (lane in ('graph_model', 'phase1c')),
  assignment_id uuid not null,
  assignment_revision bigint not null check (assignment_revision > 0),
  bot_id uuid not null,
  bot_revision bigint not null check (bot_revision > 0),
  role_id uuid not null,
  role_updated_at timestamptz not null,
  role_capabilities_sha256 text not null
    check (role_capabilities_sha256 ~ '^[0-9a-f]{64}$'),
  agent_capabilities jsonb not null,
  agent_max_model_tier text not null
    check (agent_max_model_tier in ('ECONOMY', 'STANDARD', 'STRONG')),
  ai_account_id uuid not null,
  ai_account_updated_at timestamptz not null,
  provider public.bot_provider not null,
  model text not null check (pg_catalog.char_length(pg_catalog.btrim(model)) between 1 and 128),
  credential_purpose text not null
    check (credential_purpose ~ '^[a-z][a-z0-9_]{1,62}$'),
  credential_ref text not null
    check (credential_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  -- Server-derived credential version identity. These are snapshots only:
  -- the sealed envelope never crosses this boundary or enters the hash.
  provider_credential_id uuid not null,
  provider_credential_rotated_at timestamptz not null,
  provider_identity text,
  capability text not null
    check (pg_catalog.char_length(pg_catalog.btrim(capability)) between 1 and 60),
  admission_sha256 text not null check (admission_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),

  constraint grok_execution_admissions_id_scope_unique
    unique (id, organization_id, session_id, graph_id),
  constraint grok_execution_admissions_graph_node_unique
    unique (graph_id, node_key),
  constraint grok_execution_admissions_graph_node_id_unique
    unique (graph_node_id),
  constraint grok_execution_admissions_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_execution_admissions_launch_fk
    foreign key (
      graph_launch_id, organization_id, project_id, session_id, message_id, graph_id
    ) references public.grok_graph_launches (
      id, organization_id, project_id, session_id, message_id, graph_id
    ) on delete restrict,
  constraint grok_execution_admissions_graph_node_fk
    foreign key (graph_node_id, organization_id, graph_id, node_key)
    references public.graph_nodes(id, organization_id, graph_id, node_key) on delete restrict,
  -- Assignment, bot, role, account and credential ids are immutable validated
  -- snapshots, deliberately not foreign keys. Existing owner disconnect and
  -- removal boundaries physically delete or rotate those live rows: RESTRICT
  -- would break that behavior, while CASCADE would destroy this evidence. The
  -- launch RPC locks and exact-validates every source row before insert.
  constraint grok_execution_admissions_node_key_shape
    check (node_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  constraint grok_execution_admissions_source_task_key_shape
    check (source_task_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  constraint grok_execution_admissions_lane_identity
    check (
      (lane = 'graph_model' and provider = 'anthropic'::public.bot_provider)
      or (
        lane = 'phase1c'
        and provider = 'openai'::public.bot_provider
        and node_key = 'implement'
        and capability = 'implementation'
      )
    ),
  constraint grok_execution_admissions_agent_capabilities_array
    check (
      pg_catalog.jsonb_typeof(agent_capabilities) = 'array'
      and pg_catalog.jsonb_array_length(agent_capabilities) between 1 and 32
    ),
  constraint grok_execution_admissions_agent_capabilities_bounded
    check (pg_catalog.octet_length(agent_capabilities::text) <= 4096),
  constraint grok_execution_admissions_agent_capabilities_no_secret
    check (
      not public.jsonb_has_sensitive_keys(agent_capabilities)
      and not public.text_has_likely_secret(agent_capabilities::text)
    ),
  constraint grok_execution_admissions_model_no_secret
    check (not public.text_has_likely_secret(model)),
  constraint grok_execution_admissions_provider_identity_shape
    check (
      provider_identity is null
      or (
        pg_catalog.char_length(provider_identity) between 1 and 120
        and not public.text_has_likely_secret(provider_identity)
      )
    )
);

create index grok_execution_admissions_session_created_idx
  on public.grok_execution_admissions (session_id, created_at, id);
create index grok_execution_admissions_assignment_idx
  on public.grok_execution_admissions (organization_id, assignment_id, created_at desc);
create index grok_execution_admissions_account_idx
  on public.grok_execution_admissions (organization_id, ai_account_id, created_at desc);

comment on table public.grok_execution_admissions is
  'Append-only proof that one canonical Grok provider lane was bound to an exact locked posting, bot, role and AI account before graph launch. No credential value is stored.';
comment on column public.grok_execution_admissions.lane is
  'graph_model is direct MODEL-worker admission; phase1c is only a future handoff identity for the canonical implement ANCHOR.';
comment on column public.grok_execution_admissions.credential_ref is
  'Safe reference name only. The referenced provider credential remains sealed server-side.';
comment on column public.grok_execution_admissions.provider_credential_id is
  'Server-derived id of the sealed credential row admitted under lock; no credential value is stored.';
comment on column public.grok_execution_admissions.provider_credential_rotated_at is
  'Server-derived rotation version of the sealed credential admitted under lock.';
comment on column public.grok_execution_admissions.admission_sha256 is
  'SHA-256 of the canonical immutable identity manifest, excluding row id and the row creation timestamp.';

alter table public.grok_execution_admissions enable row level security;
alter table public.grok_execution_admissions force row level security;

create policy grok_execution_admissions_select_members
  on public.grok_execution_admissions for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.grok_execution_admissions
  from public, anon, authenticated, service_role;

create trigger grok_execution_admissions_immutable
before update or delete on public.grok_execution_admissions
for each row execute function public.reject_grok_evidence_mutation();

create trigger grok_execution_admissions_no_truncate
before truncate on public.grok_execution_admissions
for each statement execute function public.reject_grok_evidence_mutation();

-- One canonical hash implementation is shared by first insert and replay.
-- The helper receives only the admission composite and is executable by no
-- application role.
create function public.grok_execution_admission_hash(
  p_admission public.grok_execution_admissions
)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $function$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'organizationId', (p_admission).organization_id,
      'projectId', (p_admission).project_id,
      'sessionId', (p_admission).session_id,
      'messageId', (p_admission).message_id,
      'graphLaunchId', (p_admission).graph_launch_id,
      'graphId', (p_admission).graph_id,
      'graphNodeId', (p_admission).graph_node_id,
      'nodeKey', (p_admission).node_key,
      'sourceTaskKey', (p_admission).source_task_key,
      'lane', (p_admission).lane,
      'assignmentId', (p_admission).assignment_id,
      'assignmentRevision', (p_admission).assignment_revision,
      'botId', (p_admission).bot_id,
      'botRevision', (p_admission).bot_revision,
      'roleId', (p_admission).role_id,
      'roleUpdatedAt', (p_admission).role_updated_at,
      'roleCapabilitiesSha256', (p_admission).role_capabilities_sha256,
      'agentCapabilities', (p_admission).agent_capabilities,
      'agentMaxModelTier', (p_admission).agent_max_model_tier,
      'aiAccountId', (p_admission).ai_account_id,
      'accountUpdatedAt', (p_admission).ai_account_updated_at,
      'provider', (p_admission).provider::text,
      'model', (p_admission).model,
      'credentialPurpose', (p_admission).credential_purpose,
      'credentialRef', (p_admission).credential_ref,
      'providerCredentialId', (p_admission).provider_credential_id,
      'providerCredentialRotatedAt', (p_admission).provider_credential_rotated_at,
      'providerIdentity', (p_admission).provider_identity,
      'capability', (p_admission).capability,
      'createdBy', (p_admission).created_by
    )::text,
    'UTF8'
  )), 'hex');
$function$;

revoke all on function public.grok_execution_admission_hash(
  public.grok_execution_admissions
) from public, anon, authenticated, service_role;

create function public.launch_grok_full_lifecycle_v2_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb,
  p_github_repository_id uuid,
  p_base_branch text,
  p_base_sha text,
  p_required_check_names jsonb,
  p_admissions jsonb
)
returns public.grok_graph_launches
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_message public.grok_messages;
  v_launch public.grok_graph_launches;
  v_preexisting_launch public.grok_graph_launches;
  v_had_launch boolean := false;
  v_entry jsonb;
  v_plan_task jsonb;
  v_node_input jsonb;
  v_lane text;
  v_node_key text;
  v_source_task_key text;
  v_assignment_id uuid;
  v_assignment_revision bigint;
  v_bot_id uuid;
  v_bot_revision bigint;
  v_role_id uuid;
  v_role_updated_at timestamptz;
  v_agent_capabilities jsonb;
  v_agent_max_model_tier text;
  v_ai_account_id uuid;
  v_account_updated_at timestamptz;
  v_provider public.bot_provider;
  v_model text;
  v_credential_purpose text;
  v_credential_ref text;
  v_provider_identity text;
  v_capability text;
  v_assignment public.bot_assignments;
  v_bot public.bots;
  v_role public.bot_roles;
  v_account public.ai_accounts;
  v_credential public.provider_credentials;
  v_graph_node public.graph_nodes;
  v_existing_admission public.grok_execution_admissions;
  v_new_admission public.grok_execution_admissions;
  v_expected_credential_ref text;
  v_role_capabilities_sha256 text;
  v_role_normalized_capabilities jsonb;
  v_admission_count integer;
  v_expected_count integer;
  v_matching_count integer;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_admissions, 'null'::jsonb)) <> 'array'
      or pg_catalog.jsonb_array_length(p_admissions) not between 1 and 64
      or pg_catalog.jsonb_typeof(coalesce(p_nodes, 'null'::jsonb)) <> 'array'
  then
    raise exception using errcode = '22023',
      message = 'invalid grok provider admission manifest';
  end if;

  select message.* into v_message
    from public.grok_messages message
   where message.id = p_message_id
     and message.organization_id = p_organization_id
     and message.project_id = p_project_id
     and message.session_id = p_session_id
     and message.role = 'assistant'
     and message.metadata ->> 'kind' = 'grok.plan';
  if not found
      or v_message.metadata #>> '{plan,planner,version}' is distinct from '2'
      or pg_catalog.jsonb_typeof(v_message.metadata #> '{plan,dag,tasks}') <> 'array'
  then
    raise exception using errcode = 'P0002', message = 'grok_plan_v2_message_not_found';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     where pg_catalog.jsonb_typeof(admission.value) <> 'object'
        or not admission.value ?& array[
          'version', 'lane', 'nodeKey', 'sourceTaskKey',
          'assignmentId', 'assignmentRevision', 'botId', 'botRevision',
          'roleId', 'roleUpdatedAt', 'agentCapabilities', 'agentMaxModelTier',
          'aiAccountId', 'accountUpdatedAt', 'provider', 'model',
          'credentialPurpose', 'credentialRef', 'providerIdentity', 'capability'
        ]
        or exists (
          select 1
            from pg_catalog.jsonb_object_keys(admission.value) manifest_key
           where manifest_key not in (
             'version', 'lane', 'nodeKey', 'sourceTaskKey',
             'assignmentId', 'assignmentRevision', 'botId', 'botRevision',
             'roleId', 'roleUpdatedAt', 'agentCapabilities', 'agentMaxModelTier',
             'aiAccountId', 'accountUpdatedAt', 'provider', 'model',
             'credentialPurpose', 'credentialRef', 'providerIdentity', 'capability'
           )
        )
  ) then
    raise exception using errcode = '22023',
      message = 'invalid grok provider admission entry';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     group by admission.value ->> 'nodeKey'
    having pg_catalog.count(*) <> 1
  ) then
    raise exception using errcode = '22023',
      message = 'grok provider admission node keys must be unique';
  end if;

  select pg_catalog.count(*)::integer into v_expected_count
    from pg_catalog.jsonb_array_elements(p_nodes) node
   where node.value ->> 'executor' = 'MODEL'
      or (
        node.value ->> 'executor' = 'ANCHOR'
        and node.value ->> 'node_key' = 'implement'
        and node.value ->> 'capability' = 'implementation'
      );
  if v_expected_count is distinct from pg_catalog.jsonb_array_length(p_admissions)
      or exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_nodes) node
         where node.value ->> 'executor' = 'MODEL'
           and not exists (
             select 1
               from pg_catalog.jsonb_array_elements(p_admissions) admission
              where admission.value ->> 'lane' = 'graph_model'
                and admission.value ->> 'nodeKey' = node.value ->> 'node_key'
           )
      )
      or not exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_admissions) admission
         where admission.value ->> 'lane' = 'phase1c'
           and admission.value ->> 'nodeKey' = 'implement'
      )
  then
    raise exception using errcode = '22023',
      message = 'every canonical provider lane requires exactly one admission';
  end if;

  -- Validate shape plus the immutable planner task before reading mutable
  -- roster rows. This proves the service caller cannot replace the planner's
  -- selected identity with a different currently-ready bot.
  for v_entry in
    select admission.value
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     order by admission.value ->> 'assignmentId', admission.value ->> 'nodeKey'
  loop
    if v_entry ->> 'version' <> '1'
        or v_entry ->> 'lane' not in ('graph_model', 'phase1c')
        or coalesce(v_entry ->> 'nodeKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
        or coalesce(v_entry ->> 'sourceTaskKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'assignmentId', 'uuid')
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'botId', 'uuid')
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'roleId', 'uuid')
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'aiAccountId', 'uuid')
        or coalesce(v_entry ->> 'assignmentRevision', '') !~ '^[1-9][0-9]{0,18}$'
        or (v_entry ->> 'assignmentRevision')::numeric > 9223372036854775807
        or coalesce(v_entry ->> 'botRevision', '') !~ '^[1-9][0-9]{0,18}$'
        or (v_entry ->> 'botRevision')::numeric > 9223372036854775807
        or not pg_catalog.pg_input_is_valid(
          v_entry ->> 'roleUpdatedAt', 'timestamp with time zone'
        )
        or not pg_catalog.pg_input_is_valid(
          v_entry ->> 'accountUpdatedAt', 'timestamp with time zone'
        )
        or pg_catalog.jsonb_typeof(v_entry -> 'agentCapabilities') <> 'array'
        or pg_catalog.jsonb_array_length(v_entry -> 'agentCapabilities') not between 1 and 32
        or exists (
          select 1
            from pg_catalog.jsonb_array_elements(v_entry -> 'agentCapabilities') capability
           where pg_catalog.jsonb_typeof(capability.value) <> 'string'
              or pg_catalog.char_length(capability.value #>> '{}') not between 1 and 60
        )
        or v_entry ->> 'agentMaxModelTier' not in ('ECONOMY', 'STANDARD', 'STRONG')
        or v_entry ->> 'provider' not in ('anthropic', 'openai')
        or pg_catalog.char_length(pg_catalog.btrim(coalesce(v_entry ->> 'model', ''))) not between 1 and 128
        or coalesce(v_entry ->> 'credentialPurpose', '') !~ '^[a-z][a-z0-9_]{1,62}$'
        or coalesce(v_entry ->> 'credentialRef', '') !~ '^[A-Z][A-Z0-9_]{2,63}$'
        or pg_catalog.char_length(pg_catalog.btrim(coalesce(v_entry ->> 'capability', ''))) not between 1 and 60
        or (
          pg_catalog.jsonb_typeof(v_entry -> 'providerIdentity') <> 'null'
          and pg_catalog.char_length(v_entry ->> 'providerIdentity') not between 1 and 120
        )
        or public.text_has_likely_secret(v_entry ->> 'model')
        or public.text_has_likely_secret(v_entry ->> 'capability')
        or (
          v_entry ->> 'providerIdentity' is not null
          and public.text_has_likely_secret(v_entry ->> 'providerIdentity')
        )
        or public.jsonb_has_sensitive_keys(v_entry -> 'agentCapabilities')
        or public.text_has_likely_secret((v_entry -> 'agentCapabilities')::text)
    then
      raise exception using errcode = '22023',
        message = 'invalid grok provider admission entry';
    end if;

    v_lane := v_entry ->> 'lane';
    v_node_key := v_entry ->> 'nodeKey';
    v_source_task_key := v_entry ->> 'sourceTaskKey';
    v_assignment_id := (v_entry ->> 'assignmentId')::uuid;
    v_assignment_revision := (v_entry ->> 'assignmentRevision')::bigint;
    v_bot_id := (v_entry ->> 'botId')::uuid;
    v_bot_revision := (v_entry ->> 'botRevision')::bigint;
    v_role_id := (v_entry ->> 'roleId')::uuid;
    v_role_updated_at := (v_entry ->> 'roleUpdatedAt')::timestamptz;
    v_agent_capabilities := v_entry -> 'agentCapabilities';
    v_agent_max_model_tier := v_entry ->> 'agentMaxModelTier';
    v_ai_account_id := (v_entry ->> 'aiAccountId')::uuid;
    v_account_updated_at := (v_entry ->> 'accountUpdatedAt')::timestamptz;
    v_provider := (v_entry ->> 'provider')::public.bot_provider;
    v_model := pg_catalog.btrim(v_entry ->> 'model');
    v_credential_purpose := v_entry ->> 'credentialPurpose';
    v_credential_ref := v_entry ->> 'credentialRef';
    v_provider_identity := v_entry ->> 'providerIdentity';
    v_capability := pg_catalog.btrim(v_entry ->> 'capability');

    if not (
      v_agent_capabilities @> pg_catalog.jsonb_build_array(v_capability)
      or v_agent_capabilities @> '["*"]'::jsonb
    ) then
      raise exception using errcode = '42501',
        message = 'selected grok agent does not declare the canonical capability';
    end if;

    select pg_catalog.count(*)::integer,
           pg_catalog.jsonb_agg(node.value) -> 0
      into v_matching_count, v_node_input
      from pg_catalog.jsonb_array_elements(p_nodes) node
     where node.value ->> 'node_key' = v_node_key;
    if v_matching_count <> 1
        or v_node_input ->> 'capability' is distinct from v_capability
        or v_node_input ->> 'model_tier' not in ('NONE', 'ECONOMY', 'STANDARD', 'STRONG')
        or (
          (case v_agent_max_model_tier
             when 'ECONOMY' then 1
             when 'STANDARD' then 2
             when 'STRONG' then 3
             else -1
           end) < (case v_node_input ->> 'model_tier'
             when 'NONE' then 0
             when 'ECONOMY' then 1
             when 'STANDARD' then 2
             when 'STRONG' then 3
             else 99
           end)
        )
        or (
          v_lane = 'graph_model'
          and (
            v_node_input ->> 'executor' is distinct from 'MODEL'
            or v_provider is distinct from 'anthropic'::public.bot_provider
          )
        )
        or (
          v_lane = 'phase1c'
          and (
            v_node_key is distinct from 'implement'
            or v_node_input ->> 'executor' is distinct from 'ANCHOR'
            or v_capability is distinct from 'implementation'
            or v_provider is distinct from 'openai'::public.bot_provider
          )
        )
    then
      raise exception using errcode = '22023',
        message = 'grok admission does not match its canonical graph node';
    end if;

    select pg_catalog.count(*)::integer,
           pg_catalog.jsonb_agg(task.value) -> 0
      into v_matching_count, v_plan_task
      from pg_catalog.jsonb_array_elements(v_message.metadata #> '{plan,dag,tasks}') task
     where task.value ->> 'id' = v_source_task_key;
    if v_matching_count <> 1
        or v_plan_task ->> 'agentId' is distinct from v_assignment_id::text
        or v_plan_task ->> 'assignmentId' is distinct from v_assignment_id::text
        or v_plan_task ->> 'assignmentRevision' is distinct from v_assignment_revision::text
        or v_plan_task ->> 'botId' is distinct from v_bot_id::text
        or v_plan_task ->> 'botRevision' is distinct from v_bot_revision::text
        or v_plan_task ->> 'roleId' is distinct from v_role_id::text
        or not pg_catalog.pg_input_is_valid(
          v_plan_task ->> 'roleUpdatedAt', 'timestamp with time zone'
        )
        or (v_plan_task ->> 'roleUpdatedAt')::timestamptz is distinct from v_role_updated_at
        or v_plan_task -> 'agentCapabilities' is distinct from v_agent_capabilities
        or v_plan_task ->> 'agentMaxModelTier' is distinct from v_agent_max_model_tier
        or v_plan_task ->> 'aiAccountId' is distinct from v_ai_account_id::text
        or not pg_catalog.pg_input_is_valid(
          v_plan_task ->> 'accountUpdatedAt', 'timestamp with time zone'
        )
        or (v_plan_task ->> 'accountUpdatedAt')::timestamptz is distinct from v_account_updated_at
        or v_plan_task ->> 'credentialPurpose' is distinct from v_credential_purpose
        or v_plan_task ->> 'credentialRef' is distinct from v_credential_ref
        or v_plan_task ->> 'providerIdentity' is distinct from v_provider_identity
        or v_plan_task ->> 'provider' is distinct from v_provider::text
        or v_plan_task ->> 'model' is distinct from v_model
        or (
          v_lane = 'graph_model'
          and v_plan_task ->> 'lane' is distinct from 'claude_read_only'
        )
        or (
          v_lane = 'phase1c'
          and (
            v_plan_task ->> 'lane' is distinct from 'codex_workspace'
            or v_plan_task ->> 'capability' is distinct from 'implementation'
          )
        )
    then
      raise exception using errcode = '22023',
        message = 'grok admission does not match the immutable planner task';
    end if;
  end loop;

  select launch.* into v_preexisting_launch
    from public.grok_graph_launches launch
   where launch.organization_id = p_organization_id
     and launch.session_id = p_session_id
     and launch.idempotency_key = p_idempotency_key;
  v_had_launch := found;

  if not v_had_launch then
    -- Deterministic whole-set locking prevents two admissions from deadlocking
    -- when they share a role/account but select different postings.
    perform assignment.id
      from public.bot_assignments assignment
     where assignment.organization_id = p_organization_id
       and assignment.project_id = p_project_id
       and exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_admissions) admission
        where (admission.value ->> 'assignmentId')::uuid = assignment.id
     )
     order by assignment.id
     for update;
    perform bot.id
      from public.bots bot
     where bot.organization_id = p_organization_id
       and exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_admissions) admission
        where (admission.value ->> 'botId')::uuid = bot.id
     )
     order by bot.id
     for update;
    perform role_definition.id
      from public.bot_roles role_definition
     where role_definition.organization_id = p_organization_id
       and exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_admissions) admission
        where (admission.value ->> 'roleId')::uuid = role_definition.id
     )
     order by role_definition.id
     for update;
    perform account.id
      from public.ai_accounts account
     where account.organization_id = p_organization_id
       and exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_admissions) admission
        where (admission.value ->> 'aiAccountId')::uuid = account.id
     )
     order by account.id
     for update;
    perform credential.id
      from public.provider_credentials credential
     where credential.organization_id = p_organization_id
       and exists (
         select 1
           from pg_catalog.jsonb_array_elements(p_admissions) admission
          where admission.value ->> 'credentialPurpose' = credential.purpose
       )
     order by credential.id
     for update;

    for v_entry in
      select admission.value
        from pg_catalog.jsonb_array_elements(p_admissions) admission
       order by admission.value ->> 'assignmentId', admission.value ->> 'nodeKey'
    loop
      v_lane := v_entry ->> 'lane';
      v_assignment_id := (v_entry ->> 'assignmentId')::uuid;
      v_assignment_revision := (v_entry ->> 'assignmentRevision')::bigint;
      v_bot_id := (v_entry ->> 'botId')::uuid;
      v_bot_revision := (v_entry ->> 'botRevision')::bigint;
      v_role_id := (v_entry ->> 'roleId')::uuid;
      v_role_updated_at := (v_entry ->> 'roleUpdatedAt')::timestamptz;
      v_agent_capabilities := v_entry -> 'agentCapabilities';
      v_agent_max_model_tier := v_entry ->> 'agentMaxModelTier';
      v_ai_account_id := (v_entry ->> 'aiAccountId')::uuid;
      v_account_updated_at := (v_entry ->> 'accountUpdatedAt')::timestamptz;
      v_provider := (v_entry ->> 'provider')::public.bot_provider;
      v_model := pg_catalog.btrim(v_entry ->> 'model');
      v_credential_purpose := v_entry ->> 'credentialPurpose';
      v_credential_ref := v_entry ->> 'credentialRef';
      v_provider_identity := v_entry ->> 'providerIdentity';
      v_capability := pg_catalog.btrim(v_entry ->> 'capability');

      select assignment.* into v_assignment
        from public.bot_assignments assignment
       where assignment.id = v_assignment_id
         and assignment.organization_id = p_organization_id
         and assignment.project_id = p_project_id;
      if not found
          or v_assignment.status is distinct from 'active'::public.bot_assignment_status
          or v_assignment.revision is distinct from v_assignment_revision
          or v_assignment.bot_id is distinct from v_bot_id
          or v_assignment.role_id is distinct from v_role_id
          or v_agent_max_model_tier is distinct from (
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
          message = 'selected grok assignment identity or model tier changed before admission';
      end if;

      select bot.* into v_bot
        from public.bots bot
       where bot.id = v_bot_id
         and bot.organization_id = p_organization_id;
      if not found
          or v_bot.revision is distinct from v_bot_revision
          or v_bot.ai_account_id is distinct from v_ai_account_id
          or v_bot.provider is distinct from v_provider
          or v_bot.readiness is distinct from 'ready'::public.bot_readiness
          or coalesce(v_assignment.model, v_bot.model) is distinct from v_model
      then
        raise exception using errcode = '55000',
          message = 'selected grok bot identity changed or is not ready';
      end if;

      select role_definition.* into v_role
        from public.bot_roles role_definition
       where role_definition.id = v_role_id
         and role_definition.organization_id = p_organization_id;
      if not found
          or v_role.updated_at is distinct from v_role_updated_at
      then
        raise exception using errcode = '42501',
          message = 'selected grok role identity changed before admission';
      end if;

      -- This is deliberately the same alias map used by
      -- session-store.ts/CAPABILITY_ALIASES. The database re-derives the
      -- sorted, de-duplicated canonical set from the locked role instead of
      -- trusting the planner's normalized snapshot on its own.
      select coalesce(
               pg_catalog.jsonb_agg(mapped.capability order by mapped.capability),
               '[]'::jsonb
             )
        into v_role_normalized_capabilities
        from (
          select distinct
            case pg_catalog.lower(pg_catalog.btrim(declared.value))
              when 'planning' then 'planning'
              when 'architecture' then 'architecture'
              when 'implementation' then 'implementation'
              when 'coding' then 'implementation'
              when 'api' then 'implementation'
              when 'backend' then 'implementation'
              when 'frontend' then 'implementation'
              when 'ui' then 'implementation'
              when 'migrations' then 'implementation'
              when 'extraction' then 'extraction'
              when 'review' then 'review'
              when 'audit' then 'review'
              when 'security-review' then 'security_review'
              when 'security' then 'security_review'
              when 'authorization' then 'security_review'
              when 'secrets' then 'security_review'
              when 'qa' then 'qa'
              when 'testing' then 'qa'
              when 'tests' then 'qa'
              when 'validation' then 'qa'
              when 'regression' then 'qa'
              when 'coverage' then 'qa'
              when 'synthesis' then 'synthesis'
              when 'summarization' then 'synthesis'
              when 'reporting' then 'reporting'
              when 'discovery' then 'discovery'
              when 'research' then 'discovery'
              when 'evaluation' then 'evaluation'
              when 'decision' then 'decision'
              else null
            end as capability
          from pg_catalog.jsonb_array_elements_text(v_role.capabilities) declared(value)
        ) mapped
       where mapped.capability is not null;
      if v_role_normalized_capabilities is distinct from v_agent_capabilities then
        raise exception using errcode = '42501',
          message = 'selected grok role capabilities changed before admission';
      end if;

      select account.* into v_account
        from public.ai_accounts account
       where account.id = v_ai_account_id
         and account.organization_id = p_organization_id;
      if not found
          or v_account.updated_at is distinct from v_account_updated_at
          or v_account.provider is distinct from v_provider
          or v_account.auth_method is distinct from 'subscription'
          or v_account.status is distinct from 'connected'
          or v_account.credential_purpose is distinct from v_credential_purpose
          or v_account.provider_identity is distinct from v_provider_identity
      then
        raise exception using errcode = '55000',
          message = 'selected grok AI account identity changed or is not connected';
      end if;

      v_expected_credential_ref := public.ai_account_bot_credential_ref(
        v_account.provider,
        v_account.credential_purpose
      );
      if v_bot.credential_ref is distinct from v_expected_credential_ref
          or v_credential_ref is distinct from v_expected_credential_ref
      then
        raise exception using errcode = '55000',
          message = 'selected grok credential reference does not match its AI account';
      end if;

      select credential.* into v_credential
        from public.provider_credentials credential
       where credential.organization_id = p_organization_id
         and credential.purpose = v_credential_purpose;
      if not found then
        raise exception using errcode = '55000',
          message = 'selected grok AI account has no stored credential reference';
      end if;

      if v_lane = 'phase1c'
          and (
            v_assignment.repository_access is distinct from 'write'
            or not v_assignment.can_open_pull_request
            or v_assignment.can_merge_pull_request
            or v_assignment.pipeline_access not in ('assigned', 'all')
            or not v_assignment.requires_human_approval
          )
      then
        raise exception using errcode = '42501',
          message = 'selected Phase 1C posting lacks the bounded draft pull request authority';
      end if;
    end loop;
  end if;

  -- The old launcher remains the single graph-construction implementation.
  -- This SECURITY DEFINER wrapper can invoke it after the public service-role
  -- grant is removed; any later refusal rolls its writes back atomically.
  v_launch := public.launch_grok_full_lifecycle_as_server(
    p_organization_id,
    p_requested_by,
    p_project_id,
    p_session_id,
    p_message_id,
    p_idempotency_key,
    p_goal,
    p_topology,
    p_topology_reasons,
    p_risk_level,
    p_requires_owner_approval,
    p_nodes,
    p_edges,
    p_budget,
    p_github_repository_id,
    p_base_branch,
    p_base_sha,
    p_required_check_names
  );

  select pg_catalog.count(*)::integer into v_admission_count
    from public.grok_execution_admissions admission
   where admission.graph_id = v_launch.graph_id
     and admission.organization_id = p_organization_id;

  if v_admission_count > 0 then
    if v_admission_count is distinct from pg_catalog.jsonb_array_length(p_admissions) then
      raise exception using errcode = '22023',
        message = 'grok launch admission replay conflicts with immutable evidence';
    end if;
    for v_entry in
      select admission.value
        from pg_catalog.jsonb_array_elements(p_admissions) admission
       order by admission.value ->> 'nodeKey'
    loop
      select admission.* into v_existing_admission
        from public.grok_execution_admissions admission
       where admission.graph_id = v_launch.graph_id
         and admission.organization_id = p_organization_id
         and admission.node_key = v_entry ->> 'nodeKey';
      if not found
          or v_existing_admission.project_id is distinct from p_project_id
          or v_existing_admission.session_id is distinct from p_session_id
          or v_existing_admission.message_id is distinct from p_message_id
          or v_existing_admission.graph_launch_id is distinct from v_launch.id
          or v_existing_admission.source_task_key is distinct from v_entry ->> 'sourceTaskKey'
          or v_existing_admission.lane is distinct from v_entry ->> 'lane'
          or v_existing_admission.assignment_id is distinct from (v_entry ->> 'assignmentId')::uuid
          or v_existing_admission.assignment_revision is distinct from (v_entry ->> 'assignmentRevision')::bigint
          or v_existing_admission.bot_id is distinct from (v_entry ->> 'botId')::uuid
          or v_existing_admission.bot_revision is distinct from (v_entry ->> 'botRevision')::bigint
          or v_existing_admission.role_id is distinct from (v_entry ->> 'roleId')::uuid
          or v_existing_admission.role_updated_at is distinct from (v_entry ->> 'roleUpdatedAt')::timestamptz
          or v_existing_admission.agent_capabilities is distinct from v_entry -> 'agentCapabilities'
          or v_existing_admission.agent_max_model_tier is distinct from v_entry ->> 'agentMaxModelTier'
          or v_existing_admission.ai_account_id is distinct from (v_entry ->> 'aiAccountId')::uuid
          or v_existing_admission.ai_account_updated_at is distinct from (v_entry ->> 'accountUpdatedAt')::timestamptz
          or v_existing_admission.provider is distinct from (v_entry ->> 'provider')::public.bot_provider
          or v_existing_admission.model is distinct from pg_catalog.btrim(v_entry ->> 'model')
          or v_existing_admission.credential_purpose is distinct from v_entry ->> 'credentialPurpose'
          or v_existing_admission.credential_ref is distinct from v_entry ->> 'credentialRef'
          or v_existing_admission.provider_identity is distinct from v_entry ->> 'providerIdentity'
          or v_existing_admission.capability is distinct from pg_catalog.btrim(v_entry ->> 'capability')
          or v_existing_admission.created_by is distinct from p_requested_by
          or v_existing_admission.admission_sha256 is distinct from
            public.grok_execution_admission_hash(v_existing_admission)
      then
        raise exception using errcode = '22023',
          message = 'grok launch admission replay conflicts with immutable evidence';
      end if;
    end loop;
    return v_launch;
  end if;

  -- An older launch without admissions cannot be given today's mutable bot
  -- identity after the fact. Start a new idempotency key/plan instead.
  if v_had_launch then
    raise exception using errcode = '55000',
      message = 'grok launch predates immutable provider admission evidence';
  end if;

  for v_entry in
    select admission.value
      from pg_catalog.jsonb_array_elements(p_admissions) admission
     order by admission.value ->> 'nodeKey'
  loop
    v_node_key := v_entry ->> 'nodeKey';
    v_source_task_key := v_entry ->> 'sourceTaskKey';
    v_lane := v_entry ->> 'lane';
    v_assignment_id := (v_entry ->> 'assignmentId')::uuid;
    v_assignment_revision := (v_entry ->> 'assignmentRevision')::bigint;
    v_bot_id := (v_entry ->> 'botId')::uuid;
    v_bot_revision := (v_entry ->> 'botRevision')::bigint;
    v_role_id := (v_entry ->> 'roleId')::uuid;
    v_role_updated_at := (v_entry ->> 'roleUpdatedAt')::timestamptz;
    v_agent_capabilities := v_entry -> 'agentCapabilities';
    v_agent_max_model_tier := v_entry ->> 'agentMaxModelTier';
    v_ai_account_id := (v_entry ->> 'aiAccountId')::uuid;
    v_account_updated_at := (v_entry ->> 'accountUpdatedAt')::timestamptz;
    v_provider := (v_entry ->> 'provider')::public.bot_provider;
    v_model := pg_catalog.btrim(v_entry ->> 'model');
    v_credential_purpose := v_entry ->> 'credentialPurpose';
    v_credential_ref := v_entry ->> 'credentialRef';
    v_provider_identity := v_entry ->> 'providerIdentity';
    v_capability := pg_catalog.btrim(v_entry ->> 'capability');

    select node.* into v_graph_node
      from public.graph_nodes node
     where node.organization_id = p_organization_id
       and node.graph_id = v_launch.graph_id
       and node.node_key = v_node_key;
    if not found
        or v_graph_node.capability is distinct from v_capability
        or (
          v_lane = 'graph_model'
          and v_graph_node.executor is distinct from 'MODEL'::public.graph_node_executor
        )
        or (
          v_lane = 'phase1c'
          and v_graph_node.executor is distinct from 'ANCHOR'::public.graph_node_executor
        )
    then
      raise exception using errcode = '55000',
        message = 'persisted canonical graph node does not match provider admission';
    end if;

    select role_definition.* into v_role
      from public.bot_roles role_definition
     where role_definition.id = v_role_id
       and role_definition.organization_id = p_organization_id;
    v_role_capabilities_sha256 := pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(v_role.capabilities::text, 'UTF8')
    ), 'hex');

    select credential.* into v_credential
      from public.provider_credentials credential
     where credential.organization_id = p_organization_id
       and credential.purpose = v_credential_purpose;
    if not found then
      raise exception using errcode = '55000',
        message = 'admitted provider credential disappeared before evidence insert';
    end if;

    v_new_admission.id := gen_random_uuid();
    v_new_admission.organization_id := p_organization_id;
    v_new_admission.project_id := p_project_id;
    v_new_admission.session_id := p_session_id;
    v_new_admission.message_id := p_message_id;
    v_new_admission.graph_launch_id := v_launch.id;
    v_new_admission.graph_id := v_launch.graph_id;
    v_new_admission.graph_node_id := v_graph_node.id;
    v_new_admission.node_key := v_node_key;
    v_new_admission.source_task_key := v_source_task_key;
    v_new_admission.lane := v_lane;
    v_new_admission.assignment_id := v_assignment_id;
    v_new_admission.assignment_revision := v_assignment_revision;
    v_new_admission.bot_id := v_bot_id;
    v_new_admission.bot_revision := v_bot_revision;
    v_new_admission.role_id := v_role_id;
    v_new_admission.role_updated_at := v_role_updated_at;
    v_new_admission.role_capabilities_sha256 := v_role_capabilities_sha256;
    v_new_admission.agent_capabilities := v_agent_capabilities;
    v_new_admission.agent_max_model_tier := v_agent_max_model_tier;
    v_new_admission.ai_account_id := v_ai_account_id;
    v_new_admission.ai_account_updated_at := v_account_updated_at;
    v_new_admission.provider := v_provider;
    v_new_admission.model := v_model;
    v_new_admission.credential_purpose := v_credential_purpose;
    v_new_admission.credential_ref := v_credential_ref;
    v_new_admission.provider_credential_id := v_credential.id;
    v_new_admission.provider_credential_rotated_at := v_credential.rotated_at;
    v_new_admission.provider_identity := v_provider_identity;
    v_new_admission.capability := v_capability;
    v_new_admission.created_by := p_requested_by;
    v_new_admission.created_at := pg_catalog.now();
    v_new_admission.admission_sha256 :=
      public.grok_execution_admission_hash(v_new_admission);

    insert into public.grok_execution_admissions (
      id, organization_id, project_id, session_id, message_id,
      graph_launch_id, graph_id, graph_node_id, node_key, source_task_key, lane,
      assignment_id, assignment_revision, bot_id, bot_revision,
      role_id, role_updated_at, role_capabilities_sha256, agent_capabilities,
      agent_max_model_tier,
      ai_account_id, ai_account_updated_at, provider, model,
      credential_purpose, credential_ref, provider_credential_id,
      provider_credential_rotated_at, provider_identity, capability,
      admission_sha256, created_by, created_at
    ) values (
      v_new_admission.id, v_new_admission.organization_id,
      v_new_admission.project_id, v_new_admission.session_id,
      v_new_admission.message_id, v_new_admission.graph_launch_id,
      v_new_admission.graph_id, v_new_admission.graph_node_id,
      v_new_admission.node_key, v_new_admission.source_task_key,
      v_new_admission.lane, v_new_admission.assignment_id,
      v_new_admission.assignment_revision, v_new_admission.bot_id,
      v_new_admission.bot_revision, v_new_admission.role_id,
      v_new_admission.role_updated_at,
      v_new_admission.role_capabilities_sha256,
      v_new_admission.agent_capabilities,
      v_new_admission.agent_max_model_tier,
      v_new_admission.ai_account_id,
      v_new_admission.ai_account_updated_at, v_new_admission.provider,
      v_new_admission.model, v_new_admission.credential_purpose,
      v_new_admission.credential_ref,
      v_new_admission.provider_credential_id,
      v_new_admission.provider_credential_rotated_at,
      v_new_admission.provider_identity,
      v_new_admission.capability, v_new_admission.admission_sha256,
      v_new_admission.created_by, v_new_admission.created_at
    );
  end loop;

  return v_launch;
end;
$function$;

-- The old bridge remains an implementation detail of v2. service_role can no
-- longer create a Grok graph without the immutable provider admission set.
revoke all on function public.launch_grok_full_lifecycle_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.launch_grok_full_lifecycle_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_full_lifecycle_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb, jsonb
) to service_role;
