-- Postflight for hosted apply scope `equipment-fleet`.
--
-- The fleet follows the IPM stations: an append-only ledger with state as a
-- projection of it. So the checks that matter are the ones that would let
-- the roster disagree with its own history — an UPDATE grant on the ledger,
-- or a missing projection trigger.

do $$
declare
  v_table text;
  v_all text[] := array['crm_equipment', 'crm_equipment_events'];
begin
  if (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity and c.relforcerowsecurity
        and c.relname = any(v_all)) <> 2 then
    raise exception 'the fleet tables are missing or not under forced RLS';
  end if;

  foreach v_table in array v_all loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'fleet records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;

  -- The ledger takes rows and gives them back. An UPDATE here would let a
  -- meter reading be rewritten after the fact, and the asset's state is
  -- derived from these rows.
  if has_table_privilege('authenticated', 'public.crm_equipment_events', 'update') then
    raise exception 'the equipment ledger is editable';
  end if;
  -- The asset's description is editable; its history is not.
  if not has_table_privilege('authenticated', 'public.crm_equipment', 'update') then
    raise exception 'an asset cannot be corrected';
  end if;

  -- Both projections. Without the first, an asset can predate its own
  -- record; without the second, status and assignment are whatever a route
  -- last wrote.
  if (select count(*) from pg_trigger
       where tgname in ('crm_equipment_record_acquired', 'crm_equipment_events_apply')) <> 2 then
    raise exception 'a fleet projection trigger is missing';
  end if;

  -- Case-insensitive, so one sticker is one asset however it was typed.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_equipment_org_tag_key'
       and indexdef ilike '%upper%'
  ) then
    raise exception 'the asset tag index is missing or is not case-insensitive';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_fleet_status'
  ) then
    raise exception 'the fleet report is a definer and would read across tenants';
  end if;
end
$$;
