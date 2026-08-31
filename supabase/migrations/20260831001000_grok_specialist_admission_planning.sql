-- Deterministic specialist admission for Grok planner v3 (forward revision 01000).
--
-- Planner v1/v2 messages remain readable history. Only a v3 message carries
-- the complete Ready project roster needed to admit a new canonical graph.
-- The roster and its hashes are append-only evidence; this migration starts no
-- run, wakes no worker, and changes no autonomy or kill-switch state.

create table public.grok_specialist_admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  session_id uuid not null,
  message_id uuid not null,
  idempotency_key text not null
    check (pg_catalog.char_length(idempotency_key) between 8 and 128),
  roster_version smallint not null check (roster_version = 1),
  roster_ordinal smallint not null check (roster_ordinal between 1 and 64),
  assignment_id uuid not null,
  assignment_revision bigint not null check (assignment_revision > 0),
  bot_id uuid not null,
  bot_revision bigint not null check (bot_revision > 0),
  role_id uuid not null,
  role_updated_at timestamptz not null,
  role_capabilities_sha256 text not null
    check (role_capabilities_sha256 ~ '^[0-9a-f]{64}$'),
  capabilities jsonb not null,
  max_model_tier text not null
    check (max_model_tier in ('ECONOMY', 'STANDARD', 'STRONG')),
  ai_account_id uuid not null,
  ai_account_updated_at timestamptz not null,
  provider public.bot_provider not null,
  model text not null
    check (pg_catalog.char_length(pg_catalog.btrim(model)) between 1 and 128),
  credential_purpose text not null
    check (credential_purpose ~ '^[a-z][a-z0-9_]{1,62}$'),
  credential_ref text not null
    check (credential_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  provider_credential_id uuid not null,
  provider_credential_rotated_at timestamptz not null,
  provider_identity text,
  admission_sha256 text not null check (admission_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),

  constraint grok_specialist_admissions_session_fk
    foreign key (session_id, organization_id, project_id)
    references public.grok_sessions(id, organization_id, project_id) on delete restrict,
  constraint grok_specialist_admissions_message_fk
    foreign key (message_id, organization_id, session_id)
    references public.grok_messages(id, organization_id, session_id) on delete restrict,
  constraint grok_specialist_admissions_id_scope_unique
    unique (id, organization_id, project_id, session_id, message_id, assignment_id),
  constraint grok_specialist_admissions_message_ordinal_unique
    unique (message_id, roster_ordinal),
  constraint grok_specialist_admissions_message_assignment_unique
    unique (message_id, assignment_id),
  constraint grok_specialist_admissions_idempotency_shape
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint grok_specialist_admissions_capabilities_array
    check (
      pg_catalog.jsonb_typeof(capabilities) = 'array'
      and pg_catalog.jsonb_array_length(capabilities) between 1 and 12
      and pg_catalog.octet_length(capabilities::text) <= 2048
    ),
  constraint grok_specialist_admissions_capabilities_no_secret
    check (
      not public.jsonb_has_sensitive_keys(capabilities)
      and not public.text_has_likely_secret(capabilities::text)
    ),
  constraint grok_specialist_admissions_model_no_secret
    check (not public.text_has_likely_secret(model)),
  constraint grok_specialist_admissions_provider_identity_shape
    check (
      provider_identity is null
      or (
        pg_catalog.char_length(provider_identity) between 1 and 120
        and not public.text_has_likely_secret(provider_identity)
      )
    )
);

create index grok_specialist_admissions_session_idx
  on public.grok_specialist_admissions (session_id, roster_ordinal);
create index grok_specialist_admissions_assignment_idx
  on public.grok_specialist_admissions (organization_id, assignment_id, created_at desc);

comment on table public.grok_specialist_admissions is
  'Append-only planner-v3 proof of every Ready configured project posting. Explicit role wildcard capability is expanded to the fixed canonical capability vocabulary before storage.';
comment on column public.grok_specialist_admissions.credential_ref is
  'Safe server-side reference name only; provider credential material is never stored here.';

alter table public.grok_specialist_admissions enable row level security;
alter table public.grok_specialist_admissions force row level security;

create policy grok_specialist_admissions_select_members
  on public.grok_specialist_admissions for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.grok_specialist_admissions
  from public, anon, authenticated, service_role;

create trigger grok_specialist_admissions_immutable
before update or delete on public.grok_specialist_admissions
for each row execute function public.reject_grok_evidence_mutation();

create trigger grok_specialist_admissions_no_truncate
before truncate on public.grok_specialist_admissions
for each statement execute function public.reject_grok_evidence_mutation();

create function public.grok_specialist_admission_hash(
  p_admission public.grok_specialist_admissions
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
      'idempotencyKey', (p_admission).idempotency_key,
      'rosterVersion', (p_admission).roster_version,
      'rosterOrdinal', (p_admission).roster_ordinal,
      'assignmentId', (p_admission).assignment_id,
      'assignmentRevision', (p_admission).assignment_revision,
      'botId', (p_admission).bot_id,
      'botRevision', (p_admission).bot_revision,
      'roleId', (p_admission).role_id,
      'roleUpdatedAt', (p_admission).role_updated_at,
      'roleCapabilitiesSha256', (p_admission).role_capabilities_sha256,
      'capabilities', (p_admission).capabilities,
      'maxModelTier', (p_admission).max_model_tier,
      'aiAccountId', (p_admission).ai_account_id,
      'accountUpdatedAt', (p_admission).ai_account_updated_at,
      'provider', (p_admission).provider::text,
      'model', (p_admission).model,
      'credentialPurpose', (p_admission).credential_purpose,
      'credentialRef', (p_admission).credential_ref,
      'providerCredentialId', (p_admission).provider_credential_id,
      'providerCredentialRotatedAt', (p_admission).provider_credential_rotated_at,
      'providerIdentity', (p_admission).provider_identity,
      'createdBy', (p_admission).created_by
    )::text,
    'UTF8'
  )), 'hex');
$function$;

revoke all on function public.grok_specialist_admission_hash(
  public.grok_specialist_admissions
) from public, anon, authenticated, service_role;

-- Keep the application and database on one bounded capability vocabulary.
-- Unknown role labels are ignored, while an explicit wildcard expands to all
-- twelve known capabilities. The literal `*` never crosses admission.
create function public.normalize_grok_role_capabilities(
  p_capabilities jsonb
)
returns jsonb
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(mapped.capability order by mapped.capability),
    '[]'::jsonb
  )
  from (
    select distinct expanded.capability
      from pg_catalog.jsonb_array_elements_text(p_capabilities) declared(value)
      cross join lateral unnest(
        case pg_catalog.lower(pg_catalog.btrim(declared.value))
          when '*' then array[
            'planning', 'architecture', 'implementation', 'extraction',
            'review', 'security_review', 'qa', 'synthesis', 'reporting',
            'discovery', 'evaluation', 'decision'
          ]::text[]
          when 'planning' then array['planning']::text[]
          when 'architecture' then array['architecture']::text[]
          when 'implementation' then array['implementation']::text[]
          when 'coding' then array['implementation']::text[]
          when 'api' then array['implementation']::text[]
          when 'backend' then array['implementation']::text[]
          when 'frontend' then array['implementation']::text[]
          when 'ui' then array['implementation']::text[]
          when 'migrations' then array['implementation']::text[]
          when 'extraction' then array['extraction']::text[]
          when 'review' then array['review']::text[]
          when 'audit' then array['review']::text[]
          when 'security-review' then array['security_review']::text[]
          when 'security' then array['security_review']::text[]
          when 'authorization' then array['security_review']::text[]
          when 'secrets' then array['security_review']::text[]
          when 'qa' then array['qa']::text[]
          when 'testing' then array['qa']::text[]
          when 'tests' then array['qa']::text[]
          when 'validation' then array['qa']::text[]
          when 'regression' then array['qa']::text[]
          when 'coverage' then array['qa']::text[]
          when 'synthesis' then array['synthesis']::text[]
          when 'summarization' then array['synthesis']::text[]
          when 'reporting' then array['reporting']::text[]
          when 'discovery' then array['discovery']::text[]
          when 'research' then array['discovery']::text[]
          when 'evaluation' then array['evaluation']::text[]
          when 'decision' then array['decision']::text[]
          else array[]::text[]
        end
      ) expanded(capability)
  ) mapped;
$function$;

revoke all on function public.normalize_grok_role_capabilities(jsonb)
  from public, anon, authenticated, service_role;

create function public.record_grok_specialist_roster_v1_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_expected_event_sequence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_session public.grok_sessions;
  v_message public.grok_messages;
  v_roster jsonb;
  v_roster_sha256 text;
  v_entry jsonb;
  v_ordinal integer;
  v_assignment public.bot_assignments;
  v_bot public.bots;
  v_role public.bot_roles;
  v_account public.ai_accounts;
  v_credential public.provider_credentials;
  v_normalized_capabilities jsonb;
  v_expected_credential_ref text;
  v_role_capabilities_sha256 text;
  v_expected_roster_count integer;
  v_roster_is_complete boolean;
  v_existing_count integer;
  v_existing public.grok_specialist_admissions;
  v_new public.grok_specialist_admissions;
  v_event public.grok_events;
begin
  if p_requested_by is null
      or p_idempotency_key is null
      or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
      or p_expected_event_sequence is null
      or p_expected_event_sequence < 0
  then
    raise exception using errcode = '22023', message = 'invalid grok specialist roster input';
  end if;

  select session.* into v_session
    from public.grok_sessions session
   where session.id = p_session_id
     and session.organization_id = p_organization_id
   for update;
  if not found
      or v_session.project_id is distinct from p_project_id
      or v_session.created_by is distinct from p_requested_by
      or v_session.status is distinct from 'active'
  then
    raise exception using errcode = '42501',
      message = 'grok specialist roster owner, project, or active-session identity mismatch';
  end if;

  if not exists (
    select 1
      from public.organization_members member
     where member.organization_id = p_organization_id
       and member.user_id = p_requested_by
       and member.role = 'owner'::public.organization_member_role
  ) then
    raise exception using errcode = '42501', message = 'an exact organization owner request identity is required';
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
      or v_message.metadata #>> '{plan,planner,version}' is distinct from '3'
      or pg_catalog.jsonb_typeof(v_message.metadata #> '{plan,admissionRoster}') <> 'array'
  then
    raise exception using errcode = 'P0002', message = 'grok_plan_v3_roster_not_found';
  end if;

  v_roster := v_message.metadata #> '{plan,admissionRoster}';
  if pg_catalog.jsonb_array_length(v_roster) not between 1 and 64
      or exists (
        select 1
          from pg_catalog.jsonb_array_elements(v_roster) entry
         where pg_catalog.jsonb_typeof(entry.value) <> 'object'
            or not entry.value ?& array[
              'version', 'assignmentId', 'assignmentRevision', 'botId',
              'botRevision', 'roleId', 'roleUpdatedAt', 'aiAccountId',
              'credentialRef', 'credentialPurpose', 'providerIdentity',
              'accountUpdatedAt', 'provider', 'model', 'capabilities',
              'maxModelTier'
            ]
            or exists (
              select 1 from pg_catalog.jsonb_object_keys(entry.value) roster_key
               where roster_key not in (
                 'version', 'assignmentId', 'assignmentRevision', 'botId',
                 'botRevision', 'roleId', 'roleUpdatedAt', 'aiAccountId',
                 'credentialRef', 'credentialPurpose', 'providerIdentity',
                 'accountUpdatedAt', 'provider', 'model', 'capabilities',
                 'maxModelTier'
               )
            )
      )
  then
    raise exception using errcode = '22023', message = 'invalid grok specialist roster manifest';
  end if;

  if exists (
    select 1
      from (
        select entry.value ->> 'assignmentId' as assignment_id,
               pg_catalog.lag(entry.value ->> 'assignmentId') over (order by entry.ordinality) as prior_assignment_id
          from pg_catalog.jsonb_array_elements(v_roster) with ordinality entry(value, ordinality)
      ) ordered
     where ordered.prior_assignment_id is not null
       and ordered.prior_assignment_id >= ordered.assignment_id
  ) then
    raise exception using errcode = '22023',
      message = 'grok specialist roster must be uniquely ordered by assignment id';
  end if;

  -- Reject malformed scalars before any cast or source-row lock.
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(v_roster) entry
     where entry.value ->> 'version' <> '1'
        or not pg_catalog.pg_input_is_valid(entry.value ->> 'assignmentId', 'uuid')
        or not pg_catalog.pg_input_is_valid(entry.value ->> 'botId', 'uuid')
        or not pg_catalog.pg_input_is_valid(entry.value ->> 'roleId', 'uuid')
        or not pg_catalog.pg_input_is_valid(entry.value ->> 'aiAccountId', 'uuid')
        or coalesce(entry.value ->> 'assignmentRevision', '') !~ '^[1-9][0-9]{0,18}$'
        or (entry.value ->> 'assignmentRevision')::numeric > 9223372036854775807
        or coalesce(entry.value ->> 'botRevision', '') !~ '^[1-9][0-9]{0,18}$'
        or (entry.value ->> 'botRevision')::numeric > 9223372036854775807
        or not pg_catalog.pg_input_is_valid(entry.value ->> 'roleUpdatedAt', 'timestamp with time zone')
        or not pg_catalog.pg_input_is_valid(entry.value ->> 'accountUpdatedAt', 'timestamp with time zone')
        or entry.value ->> 'provider' not in ('anthropic', 'openai')
        or pg_catalog.char_length(pg_catalog.btrim(coalesce(entry.value ->> 'model', ''))) not between 1 and 128
        or coalesce(entry.value ->> 'credentialPurpose', '') !~ '^[a-z][a-z0-9_]{1,62}$'
        or coalesce(entry.value ->> 'credentialRef', '') !~ '^[A-Z][A-Z0-9_]{2,63}$'
        or entry.value ->> 'maxModelTier' not in ('ECONOMY', 'STANDARD', 'STRONG')
        or pg_catalog.jsonb_typeof(entry.value -> 'capabilities') <> 'array'
        or pg_catalog.jsonb_array_length(entry.value -> 'capabilities') not between 1 and 12
        or (entry.value -> 'capabilities') @> '["*"]'::jsonb
        or exists (
          select 1
            from pg_catalog.jsonb_array_elements_text(entry.value -> 'capabilities') capability(value)
           where capability.value not in (
             'planning', 'architecture', 'implementation', 'extraction',
             'review', 'security_review', 'qa', 'synthesis', 'reporting',
             'discovery', 'evaluation', 'decision'
           )
        )
        or (
          select pg_catalog.count(*)
            from pg_catalog.jsonb_array_elements_text(entry.value -> 'capabilities') capability(value)
        ) is distinct from (
          select pg_catalog.count(distinct capability.value)
            from pg_catalog.jsonb_array_elements_text(entry.value -> 'capabilities') capability(value)
        )
        or (
          select pg_catalog.jsonb_agg(capability.value order by capability.value)
            from pg_catalog.jsonb_array_elements_text(entry.value -> 'capabilities') capability(value)
        ) is distinct from entry.value -> 'capabilities'
        or (
          pg_catalog.jsonb_typeof(entry.value -> 'providerIdentity') <> 'null'
          and pg_catalog.char_length(entry.value ->> 'providerIdentity') not between 1 and 120
        )
        or public.text_has_likely_secret(entry.value ->> 'model')
        or (
          entry.value ->> 'providerIdentity' is not null
          and public.text_has_likely_secret(entry.value ->> 'providerIdentity')
        )
  ) then
    raise exception using errcode = '22023', message = 'invalid grok specialist roster entry';
  end if;

  -- Hold the project identity while proving the roster is the entire current
  -- Ready/configured set. The project-row lock also prevents a concurrent
  -- assignment insert from passing its project foreign-key check midway
  -- through this proof.
  perform project.id
    from public.projects project
   where project.id = p_project_id
     and project.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'grok roster project not found';
  end if;

  -- Provider credentials are keyed by organization/purpose rather than by the
  -- project row. A SHARE lock closes the otherwise-unlockable empty-key race
  -- where a missing credential could be inserted after the expected-set read.
  lock table public.provider_credentials in share mode;

  -- Lock every mutable source that can enter or leave the expected set before
  -- counting it. This includes open postings omitted from the submitted
  -- roster: one cannot become configured/Ready concurrently and evade the
  -- completeness proof. Stable id order makes competing admissions agree.
  perform assignment.id
    from public.bot_assignments assignment
   where assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
     and assignment.status <> 'released'::public.bot_assignment_status
   order by assignment.id
   for update;
  perform bot.id
    from public.bots bot
    join public.bot_assignments assignment
      on assignment.bot_id = bot.id
     and assignment.organization_id = bot.organization_id
   where assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
     and assignment.status <> 'released'::public.bot_assignment_status
   order by bot.id
   for update of bot;
  perform role_definition.id
    from public.bot_roles role_definition
    join public.bot_assignments assignment
      on assignment.role_id = role_definition.id
     and assignment.organization_id = role_definition.organization_id
   where assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
     and assignment.status <> 'released'::public.bot_assignment_status
   order by role_definition.id
   for update of role_definition;
  perform account.id
    from public.ai_accounts account
    join public.bots bot
      on bot.ai_account_id = account.id
     and bot.organization_id = account.organization_id
    join public.bot_assignments assignment
      on assignment.bot_id = bot.id
     and assignment.organization_id = bot.organization_id
   where assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
     and assignment.status <> 'released'::public.bot_assignment_status
   order by account.id
   for update of account;
  perform credential.id
    from public.provider_credentials credential
    join public.ai_accounts account
      on account.organization_id = credential.organization_id
     and account.credential_purpose = credential.purpose
    join public.bots bot
      on bot.ai_account_id = account.id
     and bot.organization_id = account.organization_id
    join public.bot_assignments assignment
      on assignment.bot_id = bot.id
     and assignment.organization_id = bot.organization_id
   where assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
     and assignment.status <> 'released'::public.bot_assignment_status
   order by credential.id
   for update of credential;

  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.bool_and(exists (
           select 1
             from pg_catalog.jsonb_array_elements(v_roster) roster_entry
            where roster_entry.value ->> 'assignmentId' = assignment.id::text
         )), true)
    into v_expected_roster_count, v_roster_is_complete
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
   where assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
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
     );
  if v_expected_roster_count is distinct from pg_catalog.jsonb_array_length(v_roster)
      or not v_roster_is_complete
  then
    raise exception using errcode = '55000',
      message = 'grok specialist roster is not the complete current Ready configured project roster';
  end if;

  select pg_catalog.count(*)::integer into v_existing_count
    from public.grok_specialist_admissions admission
   where admission.organization_id = p_organization_id
     and admission.session_id = p_session_id
     and admission.message_id = p_message_id;
  if v_existing_count not in (0, pg_catalog.jsonb_array_length(v_roster)) then
    raise exception using errcode = '22023',
      message = 'grok specialist roster replay conflicts with immutable evidence';
  end if;

  for v_entry, v_ordinal in
    select entry.value, entry.ordinality::integer
      from pg_catalog.jsonb_array_elements(v_roster) with ordinality entry(value, ordinality)
     order by entry.ordinality
  loop
    select assignment.* into v_assignment
      from public.bot_assignments assignment
     where assignment.id = (v_entry ->> 'assignmentId')::uuid
       and assignment.organization_id = p_organization_id
       and assignment.project_id = p_project_id;
    if not found
        or v_assignment.status is distinct from 'active'::public.bot_assignment_status
        or v_assignment.revision is distinct from (v_entry ->> 'assignmentRevision')::bigint
        or v_assignment.bot_id is distinct from (v_entry ->> 'botId')::uuid
        or v_assignment.role_id is distinct from (v_entry ->> 'roleId')::uuid
        or v_entry ->> 'maxModelTier' is distinct from (
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
        message = 'selected grok assignment identity or model tier changed before roster admission';
    end if;

    select bot.* into v_bot
      from public.bots bot
     where bot.id = (v_entry ->> 'botId')::uuid
       and bot.organization_id = p_organization_id;
    if not found
        or v_bot.revision is distinct from (v_entry ->> 'botRevision')::bigint
        or v_bot.ai_account_id is distinct from (v_entry ->> 'aiAccountId')::uuid
        or v_bot.provider is distinct from (v_entry ->> 'provider')::public.bot_provider
        or v_bot.readiness is distinct from 'ready'::public.bot_readiness
        or coalesce(v_assignment.model, v_bot.model) is distinct from pg_catalog.btrim(v_entry ->> 'model')
    then
      raise exception using errcode = '55000',
        message = 'selected grok bot identity changed or is not ready';
    end if;

    select role_definition.* into v_role
      from public.bot_roles role_definition
     where role_definition.id = (v_entry ->> 'roleId')::uuid
       and role_definition.organization_id = p_organization_id;
    if not found
        or v_role.updated_at is distinct from (v_entry ->> 'roleUpdatedAt')::timestamptz
    then
      raise exception using errcode = '42501',
        message = 'selected grok role identity changed before roster admission';
    end if;

    v_normalized_capabilities := public.normalize_grok_role_capabilities(
      v_role.capabilities
    );
    if v_normalized_capabilities is distinct from v_entry -> 'capabilities' then
      raise exception using errcode = '42501',
        message = 'selected grok role capabilities changed before roster admission';
    end if;

    select account.* into v_account
      from public.ai_accounts account
     where account.id = (v_entry ->> 'aiAccountId')::uuid
       and account.organization_id = p_organization_id;
    if not found
        or v_account.updated_at is distinct from (v_entry ->> 'accountUpdatedAt')::timestamptz
        or v_account.provider is distinct from (v_entry ->> 'provider')::public.bot_provider
        or v_account.auth_method is distinct from 'subscription'
        or v_account.status is distinct from 'connected'
        or v_account.credential_purpose is distinct from v_entry ->> 'credentialPurpose'
        or v_account.provider_identity is distinct from v_entry ->> 'providerIdentity'
    then
      raise exception using errcode = '55000',
        message = 'selected grok AI account identity changed or is not connected';
    end if;

    v_expected_credential_ref := public.ai_account_bot_credential_ref(
      v_account.provider, v_account.credential_purpose
    );
    if v_bot.credential_ref is distinct from v_expected_credential_ref
        or v_entry ->> 'credentialRef' is distinct from v_expected_credential_ref
    then
      raise exception using errcode = '55000',
        message = 'selected grok credential reference does not match its AI account';
    end if;

    select credential.* into v_credential
      from public.provider_credentials credential
     where credential.organization_id = p_organization_id
       and credential.purpose = v_account.credential_purpose;
    if not found then
      raise exception using errcode = '55000',
        message = 'selected grok AI account has no stored credential reference';
    end if;

    v_role_capabilities_sha256 := pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(v_role.capabilities::text, 'UTF8')
    ), 'hex');
    v_new.id := gen_random_uuid();
    v_new.organization_id := p_organization_id;
    v_new.project_id := p_project_id;
    v_new.session_id := p_session_id;
    v_new.message_id := p_message_id;
    v_new.idempotency_key := p_idempotency_key;
    v_new.roster_version := 1;
    v_new.roster_ordinal := v_ordinal;
    v_new.assignment_id := v_assignment.id;
    v_new.assignment_revision := v_assignment.revision;
    v_new.bot_id := v_bot.id;
    v_new.bot_revision := v_bot.revision;
    v_new.role_id := v_role.id;
    v_new.role_updated_at := v_role.updated_at;
    v_new.role_capabilities_sha256 := v_role_capabilities_sha256;
    v_new.capabilities := v_normalized_capabilities;
    v_new.max_model_tier := v_entry ->> 'maxModelTier';
    v_new.ai_account_id := v_account.id;
    v_new.ai_account_updated_at := v_account.updated_at;
    v_new.provider := v_account.provider;
    v_new.model := pg_catalog.btrim(v_entry ->> 'model');
    v_new.credential_purpose := v_account.credential_purpose;
    v_new.credential_ref := v_expected_credential_ref;
    v_new.provider_credential_id := v_credential.id;
    v_new.provider_credential_rotated_at := v_credential.rotated_at;
    v_new.provider_identity := v_account.provider_identity;
    v_new.created_by := p_requested_by;
    v_new.created_at := pg_catalog.now();
    v_new.admission_sha256 := public.grok_specialist_admission_hash(v_new);

    if v_existing_count = 0 then
      insert into public.grok_specialist_admissions values (v_new.*);
    else
      select admission.* into v_existing
        from public.grok_specialist_admissions admission
       where admission.organization_id = p_organization_id
         and admission.session_id = p_session_id
         and admission.message_id = p_message_id
         and admission.assignment_id = v_new.assignment_id;
      if not found
          or v_existing.project_id is distinct from v_new.project_id
          or v_existing.idempotency_key is distinct from v_new.idempotency_key
          or v_existing.roster_version is distinct from v_new.roster_version
          or v_existing.roster_ordinal is distinct from v_new.roster_ordinal
          or v_existing.assignment_revision is distinct from v_new.assignment_revision
          or v_existing.bot_id is distinct from v_new.bot_id
          or v_existing.bot_revision is distinct from v_new.bot_revision
          or v_existing.role_id is distinct from v_new.role_id
          or v_existing.role_updated_at is distinct from v_new.role_updated_at
          or v_existing.role_capabilities_sha256 is distinct from v_new.role_capabilities_sha256
          or v_existing.capabilities is distinct from v_new.capabilities
          or v_existing.max_model_tier is distinct from v_new.max_model_tier
          or v_existing.ai_account_id is distinct from v_new.ai_account_id
          or v_existing.ai_account_updated_at is distinct from v_new.ai_account_updated_at
          or v_existing.provider is distinct from v_new.provider
          or v_existing.model is distinct from v_new.model
          or v_existing.credential_purpose is distinct from v_new.credential_purpose
          or v_existing.credential_ref is distinct from v_new.credential_ref
          or v_existing.provider_credential_id is distinct from v_new.provider_credential_id
          or v_existing.provider_credential_rotated_at is distinct from v_new.provider_credential_rotated_at
          or v_existing.provider_identity is distinct from v_new.provider_identity
          or v_existing.created_by is distinct from v_new.created_by
          or v_existing.admission_sha256 is distinct from public.grok_specialist_admission_hash(v_existing)
      then
        raise exception using errcode = '22023',
          message = 'grok specialist roster replay conflicts with immutable evidence';
      end if;
    end if;
  end loop;

  v_roster_sha256 := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(v_roster::text, 'UTF8')
  ), 'hex');
  v_event := public.record_grok_event_as_server(
    p_organization_id,
    p_session_id,
    'roster.admitted',
    p_message_id,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'detail', 'The deterministic Ready-agent specialist roster was admitted without starting execution.',
      'messageId', p_message_id,
      'rosterCount', pg_catalog.jsonb_array_length(v_roster),
      'rosterSha256', v_roster_sha256,
      'workerWoken', false,
      'executionStarted', false
    ),
    p_expected_event_sequence,
    p_message_id,
    null
  );

  return pg_catalog.jsonb_build_object(
    'message_id', p_message_id,
    'roster_count', pg_catalog.jsonb_array_length(v_roster),
    'roster_sha256', v_roster_sha256,
    'replayed', v_existing_count > 0
  );
end;
$function$;

revoke all on function public.record_grok_specialist_roster_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_specialist_roster_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) to service_role;

-- Planner-v3 execution admissions point back to the immutable specialist row.
alter table public.grok_execution_admissions
  add column specialist_admission_id uuid;
alter table public.grok_execution_admissions
  add constraint grok_execution_admissions_specialist_fk
  foreign key (
    specialist_admission_id, organization_id, project_id, session_id,
    message_id, assignment_id
  ) references public.grok_specialist_admissions (
    id, organization_id, project_id, session_id, message_id, assignment_id
  ) on delete restrict;
create index grok_execution_admissions_specialist_idx
  on public.grok_execution_admissions (specialist_admission_id)
  where specialist_admission_id is not null;

create function public.grok_execution_admission_hash_v2(
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
      'schemaVersion', 2,
      'organizationId', (p_admission).organization_id,
      'projectId', (p_admission).project_id,
      'sessionId', (p_admission).session_id,
      'messageId', (p_admission).message_id,
      'graphLaunchId', (p_admission).graph_launch_id,
      'graphId', (p_admission).graph_id,
      'graphNodeId', (p_admission).graph_node_id,
      'nodeKey', (p_admission).node_key,
      'sourceTaskKey', (p_admission).source_task_key,
      'specialistAdmissionId', (p_admission).specialist_admission_id,
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

revoke all on function public.grok_execution_admission_hash_v2(
  public.grok_execution_admissions
) from public, anon, authenticated, service_role;

-- The 00900 claim fence calls this private current-evidence dispatcher rather
-- than changing the accepted immutable v1 hash helper. Planner-v3 rows must
-- match both the v2 digest and their exact immutable specialist admission.
create or replace function public.grok_current_execution_admission_hash(
  p_admission public.grok_execution_admissions
)
returns text
language plpgsql
stable
strict
parallel restricted
set search_path = pg_catalog
as $function$
declare
  v_specialist public.grok_specialist_admissions;
begin
  if (p_admission).specialist_admission_id is null then
    return public.grok_execution_admission_hash(p_admission);
  end if;

  select admission.* into v_specialist
    from public.grok_specialist_admissions admission
   where admission.id = (p_admission).specialist_admission_id
     and admission.organization_id = (p_admission).organization_id
     and admission.project_id = (p_admission).project_id
     and admission.session_id = (p_admission).session_id
     and admission.message_id = (p_admission).message_id
     and admission.assignment_id = (p_admission).assignment_id;
  if not found
      or (p_admission).source_task_key is distinct from
        'roster:' || v_specialist.assignment_id::text
      or (p_admission).assignment_revision is distinct from v_specialist.assignment_revision
      or (p_admission).bot_id is distinct from v_specialist.bot_id
      or (p_admission).bot_revision is distinct from v_specialist.bot_revision
      or (p_admission).role_id is distinct from v_specialist.role_id
      or (p_admission).role_updated_at is distinct from v_specialist.role_updated_at
      or (p_admission).role_capabilities_sha256 is distinct from v_specialist.role_capabilities_sha256
      or (p_admission).agent_capabilities is distinct from v_specialist.capabilities
      or (p_admission).agent_max_model_tier is distinct from v_specialist.max_model_tier
      or (p_admission).ai_account_id is distinct from v_specialist.ai_account_id
      or (p_admission).ai_account_updated_at is distinct from v_specialist.ai_account_updated_at
      or (p_admission).provider is distinct from v_specialist.provider
      or (p_admission).model is distinct from v_specialist.model
      or (p_admission).credential_purpose is distinct from v_specialist.credential_purpose
      or (p_admission).credential_ref is distinct from v_specialist.credential_ref
      or (p_admission).provider_credential_id is distinct from v_specialist.provider_credential_id
      or (p_admission).provider_credential_rotated_at is distinct from v_specialist.provider_credential_rotated_at
      or (p_admission).provider_identity is distinct from v_specialist.provider_identity
      or (p_admission).created_by is distinct from v_specialist.created_by
      or v_specialist.admission_sha256 is distinct from
        public.grok_specialist_admission_hash(v_specialist)
  then
    raise exception using errcode = '55000',
      message = 'grok execution admission does not match immutable specialist evidence';
  end if;

  return public.grok_execution_admission_hash_v2(p_admission);
end;
$function$;

revoke all on function public.grok_current_execution_admission_hash(
  public.grok_execution_admissions
) from public, anon, authenticated, service_role;

create function public.launch_grok_full_lifecycle_v3_as_server(
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
  p_roster_idempotency_key text,
  p_admissions jsonb
)
returns public.grok_graph_launches
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_message public.grok_messages;
  v_entry jsonb;
  v_node_input jsonb;
  v_matching_count integer;
  v_expected_count integer;
  v_admission_count integer;
  v_had_launch boolean;
  v_launch public.grok_graph_launches;
  v_graph_node public.graph_nodes;
  v_specialist public.grok_specialist_admissions;
  v_assignment public.bot_assignments;
  v_existing public.grok_execution_admissions;
  v_new public.grok_execution_admissions;
  v_lane text;
  v_node_key text;
  v_capability text;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_admissions, 'null'::jsonb)) <> 'array'
      or pg_catalog.jsonb_array_length(p_admissions) not between 1 and 64
      or pg_catalog.jsonb_typeof(coalesce(p_nodes, 'null'::jsonb)) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid grok v3 provider admission manifest';
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
      or v_message.metadata #>> '{plan,planner,version}' is distinct from '3'
      or v_message.metadata #>> '{plan,intent,kind}' not in ('build', 'fix', 'test')
  then
    raise exception using errcode = '55000',
      message = 'grok planner v3 intent has no admitted canonical runtime bridge';
  end if;

  -- Revalidate the entire roster under locks in this transaction. Exact replay
  -- returns the existing event before applying the sequence CAS.
  perform public.record_grok_specialist_roster_v1_as_server(
    p_organization_id, p_requested_by, p_project_id, p_session_id,
    p_message_id, p_roster_idempotency_key, 3
  );

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_admissions) admission
     where pg_catalog.jsonb_typeof(admission.value) <> 'object'
        or not admission.value ?& array[
          'version', 'lane', 'nodeKey', 'sourceRosterAssignmentId',
          'assignmentId', 'assignmentRevision', 'botId', 'botRevision',
          'roleId', 'roleUpdatedAt', 'agentCapabilities', 'agentMaxModelTier',
          'aiAccountId', 'accountUpdatedAt', 'provider', 'model',
          'credentialPurpose', 'credentialRef', 'providerIdentity', 'capability'
        ]
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(admission.value) admission_key
           where admission_key not in (
             'version', 'lane', 'nodeKey', 'sourceRosterAssignmentId',
             'assignmentId', 'assignmentRevision', 'botId', 'botRevision',
             'roleId', 'roleUpdatedAt', 'agentCapabilities', 'agentMaxModelTier',
             'aiAccountId', 'accountUpdatedAt', 'provider', 'model',
             'credentialPurpose', 'credentialRef', 'providerIdentity', 'capability'
           )
        )
  ) then
    raise exception using errcode = '22023', message = 'invalid grok v3 provider admission entry';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_admissions) admission
     group by admission.value ->> 'nodeKey' having pg_catalog.count(*) <> 1
  ) then
    raise exception using errcode = '22023', message = 'grok v3 provider admission node keys must be unique';
  end if;

  select pg_catalog.count(*)::integer into v_expected_count
    from pg_catalog.jsonb_array_elements(p_nodes) node
   where node.value ->> 'executor' = 'MODEL'
      or (
        node.value ->> 'executor' = 'ANCHOR'
        and node.value ->> 'node_key' = 'implement'
        and node.value ->> 'capability' = 'implementation'
      );
  if v_expected_count is distinct from pg_catalog.jsonb_array_length(p_admissions) then
    raise exception using errcode = '22023',
      message = 'every canonical provider lane requires exactly one v3 admission';
  end if;

  for v_entry in
    select admission.value from pg_catalog.jsonb_array_elements(p_admissions) admission
     order by admission.value ->> 'nodeKey'
  loop
    if v_entry ->> 'version' <> '2'
        or v_entry ->> 'lane' not in ('graph_model', 'phase1c')
        or coalesce(v_entry ->> 'nodeKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'sourceRosterAssignmentId', 'uuid')
        or not pg_catalog.pg_input_is_valid(v_entry ->> 'assignmentId', 'uuid')
        or v_entry ->> 'sourceRosterAssignmentId' is distinct from v_entry ->> 'assignmentId'
        or pg_catalog.char_length(pg_catalog.btrim(coalesce(v_entry ->> 'capability', ''))) not between 1 and 60
    then
      raise exception using errcode = '22023', message = 'invalid grok v3 provider admission entry';
    end if;

    v_lane := v_entry ->> 'lane';
    v_node_key := v_entry ->> 'nodeKey';
    v_capability := pg_catalog.btrim(v_entry ->> 'capability');
    select admission.* into v_specialist
      from public.grok_specialist_admissions admission
     where admission.organization_id = p_organization_id
       and admission.project_id = p_project_id
       and admission.session_id = p_session_id
       and admission.message_id = p_message_id
       and admission.assignment_id = (v_entry ->> 'sourceRosterAssignmentId')::uuid;
    if not found
        or v_specialist.assignment_revision is distinct from (v_entry ->> 'assignmentRevision')::bigint
        or v_specialist.bot_id is distinct from (v_entry ->> 'botId')::uuid
        or v_specialist.bot_revision is distinct from (v_entry ->> 'botRevision')::bigint
        or v_specialist.role_id is distinct from (v_entry ->> 'roleId')::uuid
        or v_specialist.role_updated_at is distinct from (v_entry ->> 'roleUpdatedAt')::timestamptz
        or v_specialist.capabilities is distinct from v_entry -> 'agentCapabilities'
        or v_specialist.max_model_tier is distinct from v_entry ->> 'agentMaxModelTier'
        or v_specialist.ai_account_id is distinct from (v_entry ->> 'aiAccountId')::uuid
        or v_specialist.ai_account_updated_at is distinct from (v_entry ->> 'accountUpdatedAt')::timestamptz
        or v_specialist.provider is distinct from (v_entry ->> 'provider')::public.bot_provider
        or v_specialist.model is distinct from pg_catalog.btrim(v_entry ->> 'model')
        or v_specialist.credential_purpose is distinct from v_entry ->> 'credentialPurpose'
        or v_specialist.credential_ref is distinct from v_entry ->> 'credentialRef'
        or v_specialist.provider_identity is distinct from v_entry ->> 'providerIdentity'
        or v_specialist.admission_sha256 is distinct from public.grok_specialist_admission_hash(v_specialist)
        or not (v_specialist.capabilities @> pg_catalog.jsonb_build_array(v_capability))
    then
      raise exception using errcode = '42501',
        message = 'grok v3 provider admission does not match the immutable specialist roster';
    end if;

    select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(node.value) -> 0
      into v_matching_count, v_node_input
      from pg_catalog.jsonb_array_elements(p_nodes) node
     where node.value ->> 'node_key' = v_node_key;
    if v_matching_count <> 1
        or v_node_input ->> 'capability' is distinct from v_capability
        or (
          (case v_specialist.max_model_tier when 'ECONOMY' then 1 when 'STANDARD' then 2 when 'STRONG' then 3 else -1 end)
          < (case v_node_input ->> 'model_tier' when 'NONE' then 0 when 'ECONOMY' then 1 when 'STANDARD' then 2 when 'STRONG' then 3 else 99 end)
        )
        or (
          v_lane = 'graph_model' and (
            v_node_input ->> 'executor' is distinct from 'MODEL'
            or v_specialist.provider is distinct from 'anthropic'::public.bot_provider
          )
        )
        or (
          v_lane = 'phase1c' and (
            v_node_key is distinct from 'implement'
            or v_node_input ->> 'executor' is distinct from 'ANCHOR'
            or v_capability is distinct from 'implementation'
            or v_specialist.provider is distinct from 'openai'::public.bot_provider
          )
        )
    then
      raise exception using errcode = '22023',
        message = 'grok v3 admission does not match its canonical graph node';
    end if;

    if v_lane = 'phase1c' then
      select assignment.* into v_assignment
        from public.bot_assignments assignment
       where assignment.id = v_specialist.assignment_id
         and assignment.organization_id = p_organization_id
         and assignment.project_id = p_project_id;
      if not found
          or v_assignment.repository_access is distinct from 'write'
          or not v_assignment.can_open_pull_request
          or v_assignment.can_merge_pull_request
          or v_assignment.pipeline_access not in ('assigned', 'all')
          or not v_assignment.requires_human_approval
      then
        raise exception using errcode = '42501',
          message = 'selected Phase 1C specialist lacks bounded draft pull request authority';
      end if;
    end if;
  end loop;

  select exists (
    select 1 from public.grok_graph_launches launch
     where launch.organization_id = p_organization_id
       and launch.session_id = p_session_id
       and launch.idempotency_key = p_idempotency_key
  ) into v_had_launch;

  -- The v1 launcher remains the single canonical graph constructor. Its public
  -- service-role grant stays revoked; this wrapper invokes it only after v3
  -- roster validation, and later refusal rolls the whole transaction back.
  v_launch := public.launch_grok_full_lifecycle_as_server(
    p_organization_id, p_requested_by, p_project_id, p_session_id,
    p_message_id, p_idempotency_key, p_goal, p_topology,
    p_topology_reasons, p_risk_level, p_requires_owner_approval,
    p_nodes, p_edges, p_budget, p_github_repository_id, p_base_branch,
    p_base_sha, p_required_check_names
  );

  select pg_catalog.count(*)::integer into v_admission_count
    from public.grok_execution_admissions admission
   where admission.organization_id = p_organization_id
     and admission.graph_id = v_launch.graph_id;
  if v_admission_count > 0 then
    if v_admission_count is distinct from pg_catalog.jsonb_array_length(p_admissions) then
      raise exception using errcode = '22023',
        message = 'grok v3 launch admission replay conflicts with immutable evidence';
    end if;
    for v_entry in
      select admission.value from pg_catalog.jsonb_array_elements(p_admissions) admission
       order by admission.value ->> 'nodeKey'
    loop
      select admission.* into v_existing
        from public.grok_execution_admissions admission
       where admission.organization_id = p_organization_id
         and admission.graph_id = v_launch.graph_id
         and admission.node_key = v_entry ->> 'nodeKey';
      if not found
          or v_existing.specialist_admission_id is null
          or v_existing.assignment_id is distinct from (v_entry ->> 'assignmentId')::uuid
          or v_existing.capability is distinct from v_entry ->> 'capability'
          or v_existing.admission_sha256 is distinct from public.grok_current_execution_admission_hash(v_existing)
      then
        raise exception using errcode = '22023',
          message = 'grok v3 launch admission replay conflicts with immutable evidence';
      end if;
    end loop;
    return v_launch;
  end if;
  if v_had_launch then
    raise exception using errcode = '55000',
      message = 'grok launch predates planner-v3 specialist admission evidence';
  end if;

  for v_entry in
    select admission.value from pg_catalog.jsonb_array_elements(p_admissions) admission
     order by admission.value ->> 'nodeKey'
  loop
    v_node_key := v_entry ->> 'nodeKey';
    select admission.* into v_specialist
      from public.grok_specialist_admissions admission
     where admission.organization_id = p_organization_id
       and admission.message_id = p_message_id
       and admission.assignment_id = (v_entry ->> 'assignmentId')::uuid;
    select node.* into v_graph_node
      from public.graph_nodes node
     where node.organization_id = p_organization_id
       and node.graph_id = v_launch.graph_id
       and node.node_key = v_node_key;
    if not found then
      raise exception using errcode = '55000',
        message = 'persisted canonical graph node does not match v3 provider admission';
    end if;

    v_new.id := gen_random_uuid();
    v_new.organization_id := p_organization_id;
    v_new.project_id := p_project_id;
    v_new.session_id := p_session_id;
    v_new.message_id := p_message_id;
    v_new.graph_launch_id := v_launch.id;
    v_new.graph_id := v_launch.graph_id;
    v_new.graph_node_id := v_graph_node.id;
    v_new.node_key := v_node_key;
    v_new.source_task_key := 'roster:' || v_specialist.assignment_id::text;
    v_new.lane := v_entry ->> 'lane';
    v_new.assignment_id := v_specialist.assignment_id;
    v_new.assignment_revision := v_specialist.assignment_revision;
    v_new.bot_id := v_specialist.bot_id;
    v_new.bot_revision := v_specialist.bot_revision;
    v_new.role_id := v_specialist.role_id;
    v_new.role_updated_at := v_specialist.role_updated_at;
    v_new.role_capabilities_sha256 := v_specialist.role_capabilities_sha256;
    v_new.agent_capabilities := v_specialist.capabilities;
    v_new.agent_max_model_tier := v_specialist.max_model_tier;
    v_new.ai_account_id := v_specialist.ai_account_id;
    v_new.ai_account_updated_at := v_specialist.ai_account_updated_at;
    v_new.provider := v_specialist.provider;
    v_new.model := v_specialist.model;
    v_new.credential_purpose := v_specialist.credential_purpose;
    v_new.credential_ref := v_specialist.credential_ref;
    v_new.provider_credential_id := v_specialist.provider_credential_id;
    v_new.provider_credential_rotated_at := v_specialist.provider_credential_rotated_at;
    v_new.provider_identity := v_specialist.provider_identity;
    v_new.capability := v_entry ->> 'capability';
    v_new.specialist_admission_id := v_specialist.id;
    v_new.created_by := p_requested_by;
    v_new.created_at := pg_catalog.now();
    v_new.admission_sha256 := public.grok_current_execution_admission_hash(v_new);
    insert into public.grok_execution_admissions values (v_new.*);
  end loop;

  return v_launch;
end;
$function$;

-- v1/v2 remain readable catalogue history but are not public execution paths.
revoke all on function public.launch_grok_full_lifecycle_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.launch_grok_full_lifecycle_v3_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_full_lifecycle_v3_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) to service_role;
