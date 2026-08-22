-- Bind subscription bots to the exact AI account that owns their sealed
-- credential. This is forward-only: the legacy register_bot signature and
-- ACL remain untouched for API-key and custom-provider bots.

-- This migration is the EXPAND half of an expand/contract release. Refuse a
-- partial or replayed catalog before CREATE OR REPLACE or DROP TRIGGER can
-- hide it. The legacy application remains callable until the exact new
-- application has completed production cutover; removing those grants is a
-- separate, explicitly approved forward migration.
do $catalog_preflight$
declare
  v_existing text;
begin
  -- Freeze every legacy routine this EXPAND file preserves or delegates to
  -- before the first CREATE OR REPLACE. pg_get_functiondef is intentionally
  -- not hashed here: its deparser output changes between PostgreSQL releases.
  -- Canonical-LF prosrc plus the explicit contract/catalog fields below is
  -- stable across server versions and client line endings, while still
  -- failing closed on body, signature, return, default, owner, execution, or
  -- ACL drift.
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  if pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception using errcode = '55000',
      message = 'legacy bot routine roles are not the exact expected catalog before EXPAND';
  end if;

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_existing
  from (values
    ('public.register_bot(uuid,text,public.bot_provider,text,text,text,text)',
     '797dcd842e22e5f0ae6b8299f744b0b4', 'public.bots', true,
     'p_organization_id,p_name,p_provider,p_model,p_credential_ref,p_base_url,p_notes',
     '', 'NULL::text, NULL::text, NULL::text'),
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '80b547b7b722c57a9d2a262b67698be8', 'public.bot_assignments', true,
     'p_organization_id,p_bot_id,p_project_id,p_role_id', '', null),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '23b260247a4be4f4a8d8aa2497e1b6a2', 'public.bot_assignments', true,
     'p_organization_id,p_project_id,p_assignments', '', null),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     'daecfeb964d863373a2072cc62e1033e', 'public.bots', true,
     'p_organization_id,p_bot_id,p_readiness,p_detail', '', 'NULL::text'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     '55ec15132d903ace0300f2cbe32db6bd', 'pg_catalog.record', true,
     'p_organization_id,p_assignment_id,p_model,p_work_effort,assignment_id,model,work_effort',
     'i,i,i,i,t,t,t', 'NULL::text, NULL::text'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '0aaec47295f86adbeec784d288f24400', 'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_status', '', null),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     '7f51999309b645832d471ccebea94a9c', 'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_configuration,p_role_id,p_status', '',
     'NULL::uuid, NULL::public.bot_assignment_status')
  ) expected(
    signature, source_md5, result_type, returns_set,
    argument_names, argument_modes, argument_defaults
  )
  left join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  left join pg_catalog.pg_language routine_language
    on routine_language.oid = routine.prolang
  where routine.oid is null
     or routine_schema.nspname is distinct from 'public'
     or routine_language.lanname is distinct from 'plpgsql'
     or routine.prokind is distinct from 'f'
     or routine.provolatile is distinct from 'v'
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or pg_catalog.md5(pg_catalog.replace(
          pg_catalog.replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'
        )) is distinct from expected.source_md5
     or routine.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or routine.proretset is distinct from expected.returns_set
     or pg_catalog.array_to_string(routine.proargnames, ',')
          is distinct from expected.argument_names
     or coalesce(
          pg_catalog.array_to_string(routine.proargmodes, ','), ''
        ) is distinct from expected.argument_modes
     or coalesce((
          select pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid, null),
            ',' order by argument_type.ordinality
          )
          from pg_catalog.unnest(routine.proallargtypes)
            with ordinality argument_type(type_oid, ordinality)
        ), '') is distinct from case expected.signature
          when 'public.set_bot_assignment_execution(uuid,uuid,text,text)'
            then 'uuid,uuid,text,text,uuid,text,text'
          else ''
        end
     or pg_catalog.pg_get_expr(routine.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or routine.proisstrict is distinct from false
     or routine.proleakproof is distinct from false
     or routine.proparallel is distinct from 'u'
     or routine.procost is distinct from 100::real
     or routine.prorows is distinct from
          case when expected.returns_set then 1000::real else 0::real end
     or routine.provariadic <> 0
     or routine.prosupport <> 0
     or routine.probin is not null
     or routine.prosqlbody is not null
     or routine.protrftypes is not null
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl)) <> 2
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = pg_catalog.to_regrole('authenticated')::oid
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_existing is not null then
    raise exception using errcode = '55000',
      message = 'legacy bot routine catalog does not match the exact authenticated-only pre-EXPAND state',
      detail = v_existing;
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_existing
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine_schema.nspname = 'public'
    and routine.proname in (
      'register_bot', 'assign_bot', 'assign_bots_to_project',
      'record_bot_readiness', 'set_bot_assignment_execution',
      'update_bot_assignment', 'update_bot_assignment_configuration'
    )
    and routine.oid not in (
      'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'::pg_catalog.regprocedure,
      'public.assign_bot(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution(uuid,uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_existing is not null then
    raise exception using errcode = '55000',
      message = 'unexpected legacy bot routine overload exists before EXPAND',
      detail = v_existing;
  end if;

  -- Bound rows predate the new coherence trigger on some hosted catalogs.
  -- Validate them without calling a function this migration has not created
  -- yet, so any historical mismatch stops before the first DDL statement.
  if exists (
    select 1
    from public.bots b
    left join public.ai_accounts a
      on a.id = b.ai_account_id
    cross join lateral (values (
      case
        when a.provider = 'anthropic'::public.bot_provider
          and a.credential_purpose = 'claude'
          then 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN'
        when a.provider = 'anthropic'::public.bot_provider
          and a.credential_purpose ~ '^claude_([2-9]|[1-9][0-9]{1,3})$'
          then 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN'
            || pg_catalog.substr(a.credential_purpose, 7)
        when a.provider = 'openai'::public.bot_provider
          and a.credential_purpose = 'codex'
          then 'SOFTWAREFACTORY_CODEX_AUTH_JSON'
        when a.provider = 'openai'::public.bot_provider
          and a.credential_purpose ~ '^codex_([2-9]|[1-9][0-9]{1,3})$'
          then 'SOFTWAREFACTORY_CODEX_AUTH_JSON'
            || pg_catalog.substr(a.credential_purpose, 6)
        else null
      end
    )) expected(credential_ref)
    where b.ai_account_id is not null
      and (
        a.id is null
        or a.organization_id is distinct from b.organization_id
        or a.auth_method is distinct from 'subscription'
        or b.provider is distinct from a.provider
        or expected.credential_ref is null
        or b.credential_ref is distinct from expected.credential_ref
      )
  ) then
    raise exception using errcode = '55000',
      message = 'existing bot and AI account bindings are inconsistent before EXPAND';
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text || ' (expected ' || expected.signature || ')',
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_existing
  from (values
    ('ai_account_bot_credential_ref', 'public.ai_account_bot_credential_ref(public.bot_provider,text)'),
    ('enforce_bot_ai_account_binding', 'public.enforce_bot_ai_account_binding()'),
    ('ensure_ai_account_bot', 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'),
    ('increment_bot_revision', 'public.increment_bot_revision()'),
    ('increment_bot_assignment_revision', 'public.increment_bot_assignment_revision()'),
    ('assign_bots_to_project_checked', 'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'),
    ('update_bot_assignment_configuration_checked', 'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'),
    ('update_bot_assignment_checked', 'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'),
    ('set_bot_assignment_execution_checked', 'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'),
    ('record_bot_readiness_preserving_disabled', 'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)')
  ) expected(function_name, signature)
  join pg_catalog.pg_proc routine
    on routine.proname = expected.function_name
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
   and routine_schema.nspname = 'public';

  if v_existing is not null then
    raise exception using errcode = '55000',
      message = 'bot account binding function catalog is not clean before the forward migration';
  end if;

  select pg_catalog.string_agg(
    trigger_schema.nspname || '.' || trigger_relation.relname || '.' || trigger_row.tgname,
    ', ' order by trigger_schema.nspname, trigger_relation.relname, trigger_row.tgname
  )
  into v_existing
  from (values
    ('public.bots'::regclass, 'bots_ai_account_binding_coherent'),
    ('public.bots'::regclass, 'bots_increment_revision'),
    ('public.bot_assignments'::regclass, 'bot_assignments_increment_revision')
  ) expected(relation_id, trigger_name)
  join pg_catalog.pg_trigger trigger_row
    on trigger_row.tgname = expected.trigger_name
   and not trigger_row.tgisinternal
  join pg_catalog.pg_class trigger_relation
    on trigger_relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace trigger_schema
    on trigger_schema.oid = trigger_relation.relnamespace
   and trigger_schema.nspname = 'public';

  if v_existing is not null then
    raise exception using errcode = '55000',
      message = 'bot account binding trigger catalog is not clean before the forward migration';
  end if;

  select pg_catalog.string_agg(expected.column_name, ', ' order by expected.column_name)
  into v_existing
  from (values
    ('public.bots'::regclass, 'bots.revision'),
    ('public.bot_assignments'::regclass, 'bot_assignments.revision')
  ) expected(relation_id, column_name)
  join pg_catalog.pg_attribute column_row
    on column_row.attrelid = expected.relation_id
   and column_row.attname = pg_catalog.split_part(expected.column_name, '.', 2)
   and not column_row.attisdropped;

  if v_existing is not null then
    raise exception using errcode = '55000',
      message = 'bot account binding column catalog is not clean before the forward migration';
  end if;

  select pg_catalog.string_agg(expected.constraint_name, ', ' order by expected.constraint_name)
  into v_existing
  from (values
    ('public.bots'::regclass, 'bots_revision_positive'),
    ('public.bot_assignments'::regclass, 'bot_assignments_revision_positive')
  ) expected(relation_id, constraint_name)
  join pg_catalog.pg_constraint constraint_row
    on constraint_row.conrelid = expected.relation_id
   and constraint_row.conname = expected.constraint_name;

  if v_existing is not null then
    raise exception using errcode = '55000',
      message = 'bot account binding constraint catalog is not clean before the forward migration';
  end if;
end;
$catalog_preflight$;

create or replace function public.ai_account_bot_credential_ref(
  p_provider public.bot_provider,
  p_credential_purpose text
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $function$
declare
  v_base_purpose text;
  v_base_ref text;
  v_suffix text;
begin
  case p_provider
    when 'anthropic'::public.bot_provider then
      v_base_purpose := 'claude';
      v_base_ref := 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN';
    when 'openai'::public.bot_provider then
      v_base_purpose := 'codex';
      v_base_ref := 'SOFTWAREFACTORY_CODEX_AUTH_JSON';
    else
      raise exception using errcode = '22023',
        message = 'that provider has no subscription account binding';
  end case;

  if p_credential_purpose = v_base_purpose then
    return v_base_ref;
  end if;
  if p_credential_purpose ~ ('^' || v_base_purpose || '_([2-9]|[1-9][0-9]{1,3})$') then
    v_suffix := pg_catalog.substr(
      p_credential_purpose,
      pg_catalog.char_length(v_base_purpose) + 1
    );
    return v_base_ref || v_suffix;
  end if;

  raise exception using errcode = '22023',
    message = 'the AI account credential slot does not match its provider';
end;
$function$;

revoke all on function public.ai_account_bot_credential_ref(public.bot_provider, text)
  from public, anon, authenticated, service_role;

-- Abort rather than silently legitimizing any historical cross-account drift.
do $preflight$
begin
  if exists (
    select 1
    from public.bots b
    left join public.ai_accounts a
      on a.id = b.ai_account_id
    where b.ai_account_id is not null
      and (
        a.id is null
        or a.organization_id is distinct from b.organization_id
        or a.auth_method is distinct from 'subscription'
        or b.provider is distinct from a.provider
        or b.credential_ref is distinct from
          public.ai_account_bot_credential_ref(a.provider, a.credential_purpose)
      )
  ) then
    raise exception using errcode = '55000',
      message = 'existing bot and AI account bindings are inconsistent';
  end if;
end;
$preflight$;

create or replace function public.enforce_bot_ai_account_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_account record;
  v_expected_ref text;
begin
  if new.ai_account_id is null then
    return new;
  end if;

  select a.provider, a.auth_method, a.credential_purpose
  into v_account
  from public.ai_accounts a
  where a.id = new.ai_account_id
    and a.organization_id = new.organization_id;

  if not found then
    raise exception using errcode = '23503',
      message = 'the AI account does not belong to this organization';
  end if;
  if v_account.auth_method <> 'subscription' then
    raise exception using errcode = '22023',
      message = 'only a subscription AI account can be bound to a subscription bot';
  end if;

  v_expected_ref := public.ai_account_bot_credential_ref(
    v_account.provider,
    v_account.credential_purpose
  );
  if new.provider is distinct from v_account.provider
    or new.credential_ref is distinct from v_expected_ref then
    raise exception using errcode = '22023',
      message = 'the bot provider and credential slot must match its AI account';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_bot_ai_account_binding()
  from public, anon, authenticated, service_role;

drop trigger if exists bots_ai_account_binding_coherent on public.bots;
create trigger bots_ai_account_binding_coherent
before insert or update of organization_id, ai_account_id, provider, credential_ref
on public.bots
for each row execute function public.enforce_bot_ai_account_binding();

create or replace function public.ensure_ai_account_bot(
  p_organization_id uuid,
  p_ai_account_id uuid,
  p_provider public.bot_provider,
  p_name text,
  p_model text,
  p_additional boolean default false,
  p_base_url text default null,
  p_notes text default null
)
returns table (bot_id uuid, provision_outcome text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_account public.ai_accounts%rowtype;
  v_bot public.bots%rowtype;
  v_credential_ref text;
  v_legacy_count integer;
begin
  -- The account lock makes retry/idempotency decisions atomic without
  -- limiting how many specialized bots one account may intentionally back.
  select * into v_account
  from public.ai_accounts a
  where a.id = p_ai_account_id
    and a.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'that AI account does not exist in this organization';
  end if;
  if v_account.provider is distinct from p_provider then
    raise exception using errcode = '22023',
      message = 'the requested provider does not match the AI account';
  end if;
  if v_account.auth_method <> 'subscription' then
    raise exception using errcode = '22023',
      message = 'only a subscription AI account can provision this bot';
  end if;
  if v_account.status not in ('connected', 'needs_reauth') then
    raise exception using errcode = '55000',
      message = 'that AI account has no usable stored credential';
  end if;
  if not exists (
    select 1
    from public.provider_credentials c
    where c.organization_id = p_organization_id
      and c.purpose = v_account.credential_purpose
  ) then
    raise exception using errcode = '55000',
      message = 'that AI account has no stored credential';
  end if;

  v_credential_ref := public.ai_account_bot_credential_ref(
    v_account.provider,
    v_account.credential_purpose
  );

  if not coalesce(p_additional, false) then
    select * into v_bot
    from public.bots b
    where b.organization_id = p_organization_id
      and b.ai_account_id = p_ai_account_id
    order by b.created_at, b.id
    limit 1
    for update;

    if found then
      return query select v_bot.id, 'exists'::text;
      return;
    end if;

    select pg_catalog.count(*)::integer into v_legacy_count
    from public.bots b
    where b.organization_id = p_organization_id
      and b.ai_account_id is null
      and b.provider = v_account.provider
      and b.credential_ref = v_credential_ref;

    -- A single pre-identity bot is unambiguous and can be adopted without
    -- changing its public identity, readiness, assignments, or history.
    if v_legacy_count = 1 then
      update public.bots b
      set ai_account_id = p_ai_account_id,
          updated_at = pg_catalog.now()
      where b.organization_id = p_organization_id
        and b.ai_account_id is null
        and b.provider = v_account.provider
        and b.credential_ref = v_credential_ref
      returning b.* into v_bot;

      insert into public.activity_events (
        organization_id, actor_user_id, event_type, entity_type,
        entity_id, description, metadata
      ) values (
        p_organization_id, v_actor, 'bot.updated'::public.activity_event_type,
        'bot', v_bot.id, 'Bot linked to its exact AI account',
        pg_catalog.jsonb_build_object(
          'provider', v_bot.provider::text,
          'ai_account_id', v_bot.ai_account_id,
          'ai_account_linked', true,
          'credential_reference_present', true
        )
      );

      return query select v_bot.id, 'bound'::text;
      return;
    end if;
  end if;

  insert into public.bots (
    organization_id, name, provider, model, credential_ref, base_url,
    readiness, readiness_detail, last_checked_at, notes, ai_account_id, created_by
  ) values (
    p_organization_id,
    pg_catalog.btrim(p_name),
    v_account.provider,
    pg_catalog.btrim(p_model),
    v_credential_ref,
    nullif(pg_catalog.btrim(coalesce(p_base_url, '')), ''),
    'not_connected'::public.bot_readiness,
    null,
    null,
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    p_ai_account_id,
    v_actor
  )
  returning * into v_bot;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    p_organization_id, v_actor, 'bot.registered'::public.activity_event_type,
    'bot', v_bot.id, 'Bot registered for an exact AI account',
    pg_catalog.jsonb_build_object(
      'provider', v_bot.provider::text,
      'model', v_bot.model,
      'ai_account_id', v_bot.ai_account_id,
      'ai_account_linked', true,
      'credential_reference_present', true,
      'readiness', v_bot.readiness::text
    )
  );

  return query select v_bot.id, 'created'::text;
end;
$function$;

revoke all on function public.ensure_ai_account_bot(
  uuid, uuid, public.bot_provider, text, text, boolean, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.ensure_ai_account_bot(
  uuid, uuid, public.bot_provider, text, text, boolean, text, text
) to authenticated;

-- Readiness is evaluated outside PostgreSQL from server-only credential
-- evidence. Give every bot row a monotonic token so the recorder can prove
-- that the provider/model/credential/account snapshot it evaluated is still
-- the exact current row after it obtains the database lock.
alter table public.bots
  add column revision bigint not null default 1,
  add constraint bots_revision_positive check (revision > 0);

comment on column public.bots.revision is
  'Monotonic row revision used to reject stale server-side readiness evidence.';

create or replace function public.increment_bot_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if old.revision = 9223372036854775807 then
    raise exception using errcode = '54000',
      message = 'the bot revision cannot be advanced';
  end if;
  new.revision := old.revision + 1;
  return new;
end;
$function$;

revoke all on function public.increment_bot_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists bots_increment_revision on public.bots;
create trigger bots_increment_revision
before update on public.bots
for each row execute function public.increment_bot_revision();

-- A posting revision is the concurrency token carried by every roster read.
-- Unlike updated_at, it cannot collide when two writes share a transaction
-- timestamp. Existing rows begin at one and every subsequent update advances
-- the token in the same database transaction as the posting change.
alter table public.bot_assignments
  add column revision bigint not null default 1,
  add constraint bot_assignments_revision_positive check (revision > 0);

comment on column public.bot_assignments.revision is
  'Monotonic optimistic-concurrency token. Mutations must compare the selected revision while holding the assignment row lock.';

create or replace function public.increment_bot_assignment_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if old.revision = 9223372036854775807 then
    raise exception using errcode = '54000',
      message = 'the posting revision cannot be advanced';
  end if;
  new.revision := old.revision + 1;
  return new;
end;
$function$;

revoke all on function public.increment_bot_assignment_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists bot_assignments_increment_revision on public.bot_assignments;
create trigger bot_assignments_increment_revision
before update on public.bot_assignments
for each row execute function public.increment_bot_assignment_revision();

-- Validate the exact open-posting identity selected by the person while the
-- corresponding bot and assignment rows are locked. Locking bots in UUID
-- order also serializes two checked attempts to create a first posting.
create or replace function public.assign_bots_to_project_checked(
  p_organization_id uuid,
  p_project_id uuid,
  p_assignments jsonb
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_entry jsonb;
  v_bot_id uuid;
  v_expected_assignment_id uuid;
  v_expected_project_id uuid;
  v_expected_revision bigint;
  v_current public.bot_assignments%rowtype;
  v_has_current boolean;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_assignments, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023',
      message = 'a list of bot assignments is required';
  end if;
  if pg_catalog.jsonb_array_length(p_assignments) = 0 then
    raise exception using errcode = '22023',
      message = 'select at least one bot to assign';
  end if;
  if pg_catalog.jsonb_array_length(p_assignments) > 25 then
    raise exception using errcode = '22023',
      message = 'at most 25 bots may be assigned in one request';
  end if;

  -- Establish one deterministic lock order before inspecting any posting.
  for v_bot_id in
    select (entry.value ->> 'bot_id')::uuid
    from pg_catalog.jsonb_array_elements(p_assignments) entry
    order by 1
  loop
    if v_bot_id is null then
      raise exception using errcode = '22023',
        message = 'every assignment needs a bot';
    end if;
    perform 1
    from public.bots bot
    where bot.id = v_bot_id
      and bot.organization_id = p_organization_id
    for update;
    if not found then
      raise exception using errcode = 'P0002',
        message = 'bot was not found for this organization';
    end if;
  end loop;

  for v_entry in select value from pg_catalog.jsonb_array_elements(p_assignments)
  loop
    if not (v_entry ? 'expected_assignment_id')
      or not (v_entry ? 'expected_project_id')
      or not (v_entry ? 'expected_revision') then
      raise exception using errcode = '22023',
        message = 'every assignment needs its expected posting identity';
    end if;

    v_bot_id := (v_entry ->> 'bot_id')::uuid;
    v_expected_assignment_id := (v_entry ->> 'expected_assignment_id')::uuid;
    v_expected_project_id := (v_entry ->> 'expected_project_id')::uuid;
    v_expected_revision := (v_entry ->> 'expected_revision')::bigint;

    select assignment.* into v_current
    from public.bot_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.bot_id = v_bot_id
      and assignment.status <> 'released'::public.bot_assignment_status
    for update;
    v_has_current := found;

    if not v_has_current then
      if v_expected_assignment_id is not null
        or v_expected_project_id is not null
        or v_expected_revision is not null then
        raise exception using errcode = '40001',
          message = 'a selected bot''s current assignment changed; reload the roster before moving or reconfiguring it';
      end if;
    elsif v_expected_assignment_id is null
      or v_expected_project_id is null
      or v_expected_revision is null
      or v_current.id is distinct from v_expected_assignment_id
      or v_current.project_id is distinct from v_expected_project_id
      or v_current.revision is distinct from v_expected_revision then
      raise exception using errcode = '40001',
        message = 'a selected bot''s current assignment changed; reload the roster before moving or reconfiguring it';
    elsif v_current.status = 'paused'::public.bot_assignment_status then
      raise exception using errcode = '55000',
        message = 'a paused posting must be explicitly resumed before it can be assigned or moved';
    end if;
  end loop;

  return query
    select * from public.assign_bots_to_project(
      p_organization_id,
      p_project_id,
      p_assignments
    );
end;
$function$;

-- The single-posting checked functions retain every legacy mutation's
-- behavior and audit trail. The added wrapper only binds project and revision
-- under the row lock before delegating within this same transaction.
create or replace function public.update_bot_assignment_configuration_checked(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_expected_project_id uuid,
  p_expected_revision bigint,
  p_configuration jsonb,
  p_role_id uuid default null,
  p_status public.bot_assignment_status default null
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_current public.bot_assignments%rowtype;
begin
  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
    raise exception using errcode = '22023',
      message = 'the expected posting project and revision are required';
  end if;

  select assignment.* into v_current
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'assignment was not found for this organization';
  end if;
  if v_current.status = 'released'::public.bot_assignment_status then
    raise exception using errcode = '55000',
      message = 'released posting history is immutable';
  end if;
  if v_current.project_id is distinct from p_expected_project_id
    or v_current.revision is distinct from p_expected_revision then
    raise exception using errcode = '40001',
      message = 'the posting changed; reload it before making another change';
  end if;

  return query
    select * from public.update_bot_assignment_configuration(
      p_organization_id,
      p_assignment_id,
      p_configuration,
      p_role_id,
      p_status
    );
end;
$function$;

create or replace function public.update_bot_assignment_checked(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_expected_project_id uuid,
  p_expected_revision bigint,
  p_status public.bot_assignment_status
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_current public.bot_assignments%rowtype;
begin
  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
    raise exception using errcode = '22023',
      message = 'the expected posting project and revision are required';
  end if;

  select assignment.* into v_current
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'assignment was not found for this organization';
  end if;
  if v_current.status = 'released'::public.bot_assignment_status then
    raise exception using errcode = '55000',
      message = 'released posting history is immutable';
  end if;
  if v_current.project_id is distinct from p_expected_project_id
    or v_current.revision is distinct from p_expected_revision then
    raise exception using errcode = '40001',
      message = 'the posting changed; reload it before making another change';
  end if;

  return query
    select * from public.update_bot_assignment(
      p_organization_id,
      p_assignment_id,
      p_status
    );
end;
$function$;

create or replace function public.set_bot_assignment_execution_checked(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_expected_project_id uuid,
  p_expected_revision bigint,
  p_model text default null,
  p_work_effort text default null
)
returns setof public.bot_assignments
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_current public.bot_assignments%rowtype;
begin
  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
    raise exception using errcode = '22023',
      message = 'the expected posting project and revision are required';
  end if;

  select assignment.* into v_current
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'assignment was not found for this organization';
  end if;
  if v_current.status = 'released'::public.bot_assignment_status then
    raise exception using errcode = '55000',
      message = 'released posting history is immutable';
  end if;
  if v_current.project_id is distinct from p_expected_project_id
    or v_current.revision is distinct from p_expected_revision then
    raise exception using errcode = '40001',
      message = 'the posting changed; reload it before making another change';
  end if;

  perform 1
  from public.set_bot_assignment_execution(
    p_organization_id,
    p_assignment_id,
    p_model,
    p_work_effort
  );

  return query
    select assignment.*
    from public.bot_assignments assignment
    where assignment.id = p_assignment_id
      and assignment.organization_id = p_organization_id;
end;
$function$;

revoke all on function public.assign_bots_to_project_checked(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.update_bot_assignment_configuration_checked(
  uuid, uuid, uuid, bigint, jsonb, uuid, public.bot_assignment_status
) from public, anon, authenticated, service_role;
revoke all on function public.update_bot_assignment_checked(
  uuid, uuid, uuid, bigint, public.bot_assignment_status
) from public, anon, authenticated, service_role;
revoke all on function public.set_bot_assignment_execution_checked(
  uuid, uuid, uuid, bigint, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.assign_bots_to_project_checked(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.update_bot_assignment_configuration_checked(
  uuid, uuid, uuid, bigint, jsonb, uuid, public.bot_assignment_status
) to authenticated;
grant execute on function public.update_bot_assignment_checked(
  uuid, uuid, uuid, bigint, public.bot_assignment_status
) to authenticated;
grant execute on function public.set_bot_assignment_execution_checked(
  uuid, uuid, uuid, bigint, text, text
) to authenticated;

-- Credential checks are server evidence, not a browser-authored state change.
-- Only service_role may record them, and it must carry the exact bot identity,
-- configuration, and monotonic revision that the server evaluated. The
-- comparison happens under the row lock, so a stale check fails rather than
-- overwriting a concurrent edit. "disabled" remains a durable management stop.
create or replace function public.record_bot_readiness_preserving_disabled(
  p_organization_id uuid,
  p_bot_id uuid,
  p_actor_user_id uuid,
  p_expected_revision bigint,
  p_expected_ai_account_id uuid,
  p_expected_provider public.bot_provider,
  p_expected_model text,
  p_expected_credential_ref text,
  p_expected_base_url text,
  p_readiness public.bot_readiness,
  p_detail text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_current public.bots%rowtype;
  v_safe_detail text := nullif(pg_catalog.btrim(coalesce(p_detail, '')), '');
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
      and member.role in (
        'owner'::public.organization_member_role,
        'admin'::public.organization_member_role
      )
  ) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if p_expected_revision is null or p_expected_revision <= 0 then
    raise exception using errcode = '22023',
      message = 'the expected bot revision is required';
  end if;
  if p_readiness = 'disabled'::public.bot_readiness then
    raise exception using errcode = '22023',
      message = 'a readiness check cannot author the disabled management state';
  end if;
  if v_safe_detail is not null and public.text_has_likely_secret(v_safe_detail) then
    raise exception using errcode = '22023',
      message = 'readiness detail must not contain secret material';
  end if;

  select bot.* into v_current
  from public.bots bot
  where bot.id = p_bot_id
    and bot.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'bot was not found for this organization';
  end if;

  if v_current.revision is distinct from p_expected_revision
    or v_current.ai_account_id is distinct from p_expected_ai_account_id
    or v_current.provider is distinct from p_expected_provider
    or v_current.model is distinct from p_expected_model
    or v_current.credential_ref is distinct from p_expected_credential_ref
    or v_current.base_url is distinct from p_expected_base_url then
    raise exception using errcode = '40001',
      message = 'the bot configuration changed; reload it before recording readiness';
  end if;

  if v_current.readiness = 'disabled'::public.bot_readiness
    and p_readiness <> 'disabled'::public.bot_readiness then
    return next v_current;
    return;
  end if;

  update public.bots bot
  set readiness = p_readiness,
      readiness_detail = pg_catalog.left(v_safe_detail, 200),
      last_checked_at = pg_catalog.now()
  where bot.id = p_bot_id
    and bot.organization_id = p_organization_id
  returning bot.* into v_current;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type,
    entity_id, description, metadata
  ) values (
    p_organization_id,
    p_actor_user_id,
    'bot.readiness_checked'::public.activity_event_type,
    'bot',
    v_current.id,
    'Bot readiness recorded from server-side configuration evidence',
    pg_catalog.jsonb_build_object(
      'readiness', v_current.readiness::text,
      'evaluated_revision', p_expected_revision,
      'recorded_revision', v_current.revision,
      'credential_reference_present', v_current.credential_ref is not null,
      'executor_connected', false
    )
  );

  return next v_current;
end;
$function$;

revoke all on function public.record_bot_readiness_preserving_disabled(
  uuid, uuid, uuid, bigint, uuid, public.bot_provider,
  text, text, text, public.bot_readiness, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_bot_readiness_preserving_disabled(
  uuid, uuid, uuid, bigint, uuid, public.bot_provider,
  text, text, text, public.bot_readiness, text
) to service_role;

-- Fail closed on inherited ALTER DEFAULT PRIVILEGES or any other catalog
-- side effect. The protected apply runs this file as one transaction, so a
-- mismatch here rolls back every preceding EXPAND DDL statement.
do $expand_postflight$
declare
  v_bad text;
begin
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.ai_account_bot_credential_ref(public.bot_provider,text)',
     'afae78ba3750e372829dd50e1b48c5cb', 'i', 'none', 'pg_catalog.text', false,
     'p_provider,p_credential_purpose', '', null, true),
    ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)',
     '5ff06f065e241ad2baf5d7d5f576743a', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_project_id,p_assignments', '', null, false),
    ('public.enforce_bot_ai_account_binding()',
     '885b6c63c7f0b761d3ae99bdb416d6f4', 'v', 'none', 'pg_catalog.trigger', false,
     '', '', null, false),
    ('public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)',
     '3140ecd6b0d850732f96bdc5096b97e3', 'v', 'authenticated', 'pg_catalog.record', true,
     'p_organization_id,p_ai_account_id,p_provider,p_name,p_model,p_additional,p_base_url,p_notes,bot_id,provision_outcome',
     'i,i,i,i,i,i,i,i,t,t', 'false, NULL::text, NULL::text', false),
    ('public.increment_bot_assignment_revision()',
     '90320b19a6b41eb32b084a3b0db8ef21', 'v', 'none', 'pg_catalog.trigger', false,
     '', '', null, false),
    ('public.increment_bot_revision()',
     '154cf22e868e447c6f74aeb08508ad08', 'v', 'none', 'pg_catalog.trigger', false,
     '', '', null, false),
    ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
     '1132e6e0bed1697a7ccaa82006db35f5', 'v', 'service_role', 'public.bots', true,
     'p_organization_id,p_bot_id,p_actor_user_id,p_expected_revision,p_expected_ai_account_id,p_expected_provider,p_expected_model,p_expected_credential_ref,p_expected_base_url,p_readiness,p_detail',
     '', 'NULL::text', false),
    ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)',
     'd0c11a5c1e57878c9b1b5d8753ecb1fd', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_expected_project_id,p_expected_revision,p_model,p_work_effort',
     '', 'NULL::text, NULL::text', false),
    ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)',
     '5323b0adb327f3d3a19c9bdca220922e', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_expected_project_id,p_expected_revision,p_status',
     '', null, false),
    ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)',
     'eabefae63edf3d957ed8a0ad5e10d1bd', 'v', 'authenticated',
     'public.bot_assignments', true,
     'p_organization_id,p_assignment_id,p_expected_project_id,p_expected_revision,p_configuration,p_role_id,p_status',
     '', 'NULL::uuid, NULL::public.bot_assignment_status', false)
  ) expected(
    signature, source_md5, volatility, execute_role, result_type, returns_set,
    argument_names, argument_modes, argument_defaults, is_strict
  )
  left join pg_catalog.pg_proc routine
    on routine.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  left join pg_catalog.pg_language routine_language
    on routine_language.oid = routine.prolang
  where routine.oid is null
     or routine_schema.nspname is distinct from 'public'
     or routine_language.lanname is distinct from 'plpgsql'
     or routine.prokind is distinct from 'f'
     or routine.provolatile is distinct from expected.volatility::"char"
     or routine.prosecdef is distinct from true
     or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.pg_get_userbyid(routine.proowner) is distinct from 'postgres'
     or pg_catalog.md5(pg_catalog.replace(
          pg_catalog.replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n'
        )) is distinct from expected.source_md5
     or routine.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or routine.proretset is distinct from expected.returns_set
     or coalesce(
          pg_catalog.array_to_string(routine.proargnames, ','), ''
        ) is distinct from expected.argument_names
     or coalesce(
          pg_catalog.array_to_string(routine.proargmodes, ','), ''
        ) is distinct from expected.argument_modes
     or coalesce((
          select pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid, null),
            ',' order by argument_type.ordinality
          )
          from pg_catalog.unnest(routine.proallargtypes)
            with ordinality argument_type(type_oid, ordinality)
        ), '') is distinct from case expected.signature
          when 'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'
            then 'uuid,uuid,public.bot_provider,text,text,boolean,text,text,uuid,text'
          else ''
        end
     or pg_catalog.pg_get_expr(routine.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or routine.proisstrict is distinct from expected.is_strict
     or routine.proleakproof is distinct from false
     or routine.proparallel is distinct from 'u'
     or routine.procost is distinct from 100::real
     or routine.prorows is distinct from
          case when expected.returns_set then 1000::real else 0::real end
     or routine.provariadic <> 0
     or routine.prosupport <> 0
     or routine.probin is not null
     or routine.prosqlbody is not null
     or routine.protrftypes is not null
     or routine.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(routine.proacl))
          <> case when expected.execute_role = 'none' then 1 else 2 end
     or not exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantor = routine.proowner
         and acl.grantee = routine.proowner
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or (
       expected.execute_role <> 'none'
       and not exists (
         select 1
         from pg_catalog.aclexplode(routine.proacl) acl
         where acl.grantor = routine.proowner
           and acl.grantee = pg_catalog.to_regrole(expected.execute_role)::oid
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee <> routine.proowner
         and (
           expected.execute_role = 'none'
           or acl.grantee <> pg_catalog.to_regrole(expected.execute_role)::oid
         )
     )
     or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
     or (
       pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       is distinct from (expected.execute_role = 'authenticated')
     )
     or (
       pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
       is distinct from (expected.execute_role = 'service_role')
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(routine.proacl) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'new EXPAND function definition/security/ACL catalog is not exact',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace routine_schema
    on routine_schema.oid = routine.pronamespace
  where routine_schema.nspname = 'public'
    and routine.proname in (
      'ai_account_bot_credential_ref', 'assign_bots_to_project_checked',
      'enforce_bot_ai_account_binding', 'ensure_ai_account_bot',
      'increment_bot_assignment_revision', 'increment_bot_revision',
      'record_bot_readiness_preserving_disabled',
      'set_bot_assignment_execution_checked', 'update_bot_assignment_checked',
      'update_bot_assignment_configuration_checked'
    )
    and routine.oid not in (
      'public.ai_account_bot_credential_ref(public.bot_provider,text)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.enforce_bot_ai_account_binding()'::pg_catalog.regprocedure,
      'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)'::pg_catalog.regprocedure,
      'public.increment_bot_assignment_revision()'::pg_catalog.regprocedure,
      'public.increment_bot_revision()'::pg_catalog.regprocedure,
      'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected EXPAND helper or checked-function overload exists',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.identity, ', ' order by expected.identity)
  into v_bad
  from (values
    ('public.bot_assignments.revision', 'public.bot_assignments'::pg_catalog.regclass,
     'revision', 'bot_assignments_revision_positive'),
    ('public.bots.revision', 'public.bots'::pg_catalog.regclass,
     'revision', 'bots_revision_positive')
  ) expected(identity, relation_id, column_name, constraint_name)
  left join pg_catalog.pg_attribute column_row
    on column_row.attrelid = expected.relation_id
   and column_row.attname = expected.column_name
   and not column_row.attisdropped
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = column_row.attrelid
   and default_row.adnum = column_row.attnum
  left join pg_catalog.pg_constraint constraint_row
    on constraint_row.conrelid = expected.relation_id
   and constraint_row.conname = expected.constraint_name
  where column_row.attnum is null
     or column_row.atttypid <> 'pg_catalog.int8'::pg_catalog.regtype
     or not column_row.attnotnull
     or column_row.attidentity <> ''
     or column_row.attgenerated <> ''
     or default_row.oid is null
     or pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
          not in ('1', '1::bigint', '''1''::bigint')
     or constraint_row.oid is null
     or constraint_row.contype <> 'c'
     or not constraint_row.convalidated
     or constraint_row.connoinherit
     or pg_catalog.pg_get_constraintdef(constraint_row.oid) <> 'CHECK ((revision > 0))';

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'new EXPAND revision column or constraint catalog is not exact',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.identity, ', ' order by expected.identity)
  into v_bad
  from (values
    ('public.bot_assignments.bot_assignments_increment_revision',
     'public.bot_assignments'::pg_catalog.regclass,
     'bot_assignments_increment_revision', 19::smallint,
     'public.increment_bot_assignment_revision()'::pg_catalog.regprocedure,
     ''),
    ('public.bots.bots_ai_account_binding_coherent',
     'public.bots'::pg_catalog.regclass,
     'bots_ai_account_binding_coherent', 23::smallint,
     'public.enforce_bot_ai_account_binding()'::pg_catalog.regprocedure,
     'organization_id,ai_account_id,provider,credential_ref'),
    ('public.bots.bots_increment_revision',
     'public.bots'::pg_catalog.regclass,
     'bots_increment_revision', 19::smallint,
     'public.increment_bot_revision()'::pg_catalog.regprocedure,
     '')
  ) expected(identity, relation_id, trigger_name, trigger_type, function_id, update_columns)
  left join pg_catalog.pg_trigger trigger_row
    on trigger_row.tgrelid = expected.relation_id
   and trigger_row.tgname = expected.trigger_name
   and not trigger_row.tgisinternal
  where trigger_row.oid is null
     or trigger_row.tgenabled <> 'O'
     or trigger_row.tgtype <> expected.trigger_type
     or trigger_row.tgfoid <> expected.function_id
     or trigger_row.tgconstraint <> 0
     or trigger_row.tgparentid <> 0
     or trigger_row.tgconstrrelid <> 0
     or trigger_row.tgconstrindid <> 0
     or trigger_row.tgdeferrable
     or trigger_row.tginitdeferred
     or trigger_row.tgqual is not null
     or trigger_row.tgoldtable is not null
     or trigger_row.tgnewtable is not null
     or pg_catalog.octet_length(trigger_row.tgargs) <> 0
     or coalesce((
       select pg_catalog.string_agg(column_row.attname, ',' order by update_column.ordinality)
       from pg_catalog.unnest(trigger_row.tgattr::smallint[])
         with ordinality update_column(attnum, ordinality)
       join pg_catalog.pg_attribute column_row
         on column_row.attrelid = trigger_row.tgrelid
        and column_row.attnum = update_column.attnum
        and not column_row.attisdropped
     ), '') is distinct from expected.update_columns;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'new EXPAND trigger catalog is not exact',
      detail = v_bad;
  end if;
end;
$expand_postflight$;

-- EXPAND-phase compatibility: do not alter the six legacy mutator ACLs here.
-- The application currently on origin/main calls every one of them, so a
-- migration-first release must preserve their existing authenticated-only
-- EXECUTE grants until the exact checked-RPC application is serving. These
-- older calls do not carry revision tokens and record_bot_readiness does not
-- enforce the new service-only evidence contract. Their deliberate temporary
-- availability is the cutover tradeoff, not the final security posture.
-- Revoke them only in a separately reviewed, explicitly approved forward
-- CONTRACT migration after exact-app deployment and production acceptance.
