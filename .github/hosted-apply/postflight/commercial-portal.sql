-- Postflight for hosted apply scope `commercial-portal`.
--
-- The polarity here is the OPPOSITE of the dashboards, and getting it
-- backwards is the whole risk in this scope. Every commercial projection
-- MUST be a definer: it reaches crm_portal_account_for() to resolve the
-- caller to one account, and a portal user is not a member of the
-- organization whose data they are reading, so an invoker would return
-- nothing at all. What makes that safe is not the invoker/definer flag but
-- the resolver staying unreachable, which is re-proved below.

do $$
declare
  v_role text;
  v_reads text[] := array[
    'crm_portal_sites', 'crm_portal_devices', 'crm_portal_device_trend',
    'crm_portal_conditions', 'crm_portal_safety_library', 'crm_portal_inspections',
    'crm_portal_report_sighting'
  ];
  v_missing text;
begin
  foreach v_missing in array v_reads loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_missing
    ) then
      raise exception 'commercial portal function % is missing', v_missing;
    end if;
  end loop;

  -- Every one of them is a definer, deliberately.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_reads) and not p.prosecdef
  ) then
    raise exception 'a commercial portal projection is not a definer and would return nothing';
  end if;

  -- And every one of them is reachable ONLY by a signed-in caller.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_reads)
       and not has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    raise exception 'a commercial portal projection is not reachable by authenticated';
  end if;

  foreach v_role in array array['anon', 'service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(v_reads)
         and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'a commercial portal projection is executable by %', v_role;
    end if;
  end loop;

  -- The load-bearing one, restated at every apply that touches the portal:
  -- the resolver takes a uuid, so anybody who could execute it could ask
  -- about a login that is not theirs. Nobody gets execute on it.
  foreach v_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'crm_portal_account_for'
         and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'the portal resolver became executable by %', v_role;
    end if;
  end loop;
end
$$;

-- The provenance column, its same-organization key, and the RLS posture of
-- the table it landed on. Adding a column must not have loosened anything.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_pest_sightings'
       and column_name = 'reported_by_portal_user_id'
  ) then
    raise exception 'crm_pest_sightings.reported_by_portal_user_id is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_pest_sightings'::regclass
       and conname = 'crm_pest_sightings_portal_user_same_org'
  ) then
    raise exception 'the sighting provenance key does not pin the organization';
  end if;

  if not exists (
    select 1 from pg_class
     where oid = 'public.crm_pest_sightings'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'row level security is not forced on crm_pest_sightings';
  end if;

  -- A sighting is corrected, never erased. The absence of the grant is the
  -- guarantee, so it is checked rather than assumed.
  if has_table_privilege('authenticated', 'public.crm_pest_sightings', 'delete') then
    raise exception 'crm_pest_sightings became deletable by authenticated';
  end if;
end
$$;
