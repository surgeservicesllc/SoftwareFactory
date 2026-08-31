-- Postflight for hosted apply scope `service-integrations`.
--
-- One claim, re-proved on hosted: this table cannot make a provider look
-- connected. It holds no credential and no status, and `live` is derived
-- from the sealed vault every time it is asked.

do $$
declare
  v_constraint text;
begin
  if not exists (
    select 1 from pg_class
     where oid = 'public.crm_service_integrations'::regclass
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'row level security is not forced on crm_service_integrations';
  end if;

  if has_table_privilege('anon', 'public.crm_service_integrations', 'select') then
    raise exception 'crm_service_integrations is readable by anon';
  end if;

  -- There is no status column, and there must never be one: a stored
  -- status is a status somebody can set without a credential behind it.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_service_integrations'
       and column_name in ('status', 'live', 'connected', 'sealed_envelope', 'api_key', 'secret')
  ) then
    raise exception
      'crm_service_integrations grew a stored status or credential column; live must stay derived';
  end if;

  -- Every free-text column is secret-guarded, purpose name included.
  foreach v_constraint in array array[
    'crm_service_integrations_label_no_secret',
    'crm_service_integrations_error_no_secret',
    'crm_service_integrations_settings_no_secret'
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.crm_service_integrations'::regclass and conname = v_constraint
    ) then
      raise exception 'the secret guard % is missing', v_constraint;
    end if;
  end loop;
end
$$;

-- The derivation itself: both functions must be definers (they read the
-- vault, which no browser role holds SELECT on) and neither may return the
-- envelope. The RETURNS clause is the structural guarantee.
do $$
declare
  v_role text;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('crm_integration_status', 'crm_integration_live')
       and not p.prosecdef
  ) then
    raise exception 'an integration function is not a definer and could not read the vault at all';
  end if;

  if (select pg_get_function_result(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'crm_integration_status')
     ~* '(envelope|sealed|secret|api_key)' then
    raise exception 'crm_integration_status can return credential material';
  end if;

  foreach v_role in array array['anon', 'service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('crm_integration_status', 'crm_integration_live')
         and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'an integration function is executable by %', v_role;
    end if;
  end loop;

  -- And the vault stays unreadable, which is what made the definers
  -- necessary. If this ever passes, the definers were never the guard.
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.provider_credentials', 'select') then
      raise exception 'provider_credentials became readable by %', v_role;
    end if;
  end loop;
end
$$;
