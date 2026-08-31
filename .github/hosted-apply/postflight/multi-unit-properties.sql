-- Postflight for hosted apply scope `multi-unit-properties` (ADR-215).
--
-- The guarantee is that a unit named by a visit, a station, a sighting or a
-- plan belongs to the property that row already names. That is carried by a
-- COMPOSITE foreign key, and it is the whole difference between a unit level
-- and a label that can attribute a treatment to the wrong home.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_composite integer;
  v_bare integer;
  v_secdef integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'crm_property_units'
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 1 then
    raise exception 'crm_property_units is not RLS-enabled and forced';
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_property_units'
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'crm_property_units carries % grant(s) outside authenticated', v_grants;
  end if;

  -- Four references, each on three columns. A two-column version would let a
  -- work order at one site name a unit of another.
  select count(*) into v_composite
    from pg_constraint
   where conname in (
           'crm_work_orders_unit_same_property',
           'crm_devices_unit_same_property',
           'crm_pest_sightings_unit_same_property',
           'crm_service_plans_unit_same_property')
     and contype = 'f'
     and array_length(conkey, 1) = 3;
  if v_composite <> 4 then
    raise exception 'expected 4 three-column unit references, found %', v_composite;
  end if;

  -- And each must null only the door. A bare SET NULL on a composite key
  -- nulls every referencing column, two of which are NOT NULL, so deleting a
  -- unit would fail rather than detach.
  select count(*) into v_bare
    from pg_constraint
   where conname in (
           'crm_work_orders_unit_same_property',
           'crm_devices_unit_same_property',
           'crm_pest_sightings_unit_same_property',
           'crm_service_plans_unit_same_property')
     and confdeltype = 'n'
     and coalesce(array_length(confdelsetcols, 1), 0) <> 1;
  if v_bare <> 0 then
    raise exception '% unit reference(s) would null more than the door on delete', v_bare;
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_property_units_label_key'
  ) then
    raise exception 'the one-row-per-door index is missing';
  end if;

  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname = 'crm_property_unit_coverage';
  if v_secdef <> 0 then
    raise exception 'crm_property_unit_coverage is SECURITY DEFINER';
  end if;

  raise notice 'multi-unit: composite references, column-list detach, one row per door, invoker boundary';
end;
$$;
