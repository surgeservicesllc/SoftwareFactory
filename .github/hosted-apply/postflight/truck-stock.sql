-- Postflight for hosted apply scope `truck-stock` (ADR-213).
--
-- The guarantee is that no location can hold a negative amount of a
-- regulated chemical, and that the stock ledger and the compliance log
-- cannot tell two stories about one treatment. Both are structural.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_write integer;
  v_secdef integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'crm_stock_movements'
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 1 then
    raise exception 'crm_stock_movements is not RLS-enabled and forced';
  end if;

  -- Hosted default privileges grant ALL on new tables; this proves the
  -- revoke took and that no role outside authenticated can reach it.
  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_stock_movements'
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'crm_stock_movements carries % grant(s) outside authenticated', v_grants;
  end if;

  -- Append-only: a movement is what happened to a regulated product, and a
  -- correction is another movement rather than an edit.
  select count(*) into v_write
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_stock_movements'
     and privilege_type in ('UPDATE', 'DELETE')
     and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC');
  if v_write <> 0 then
    raise exception 'crm_stock_movements gained % update/delete grant(s)', v_write;
  end if;

  -- One application draws stock once, however often a field sync replays.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'crm_stock_movements_one_draw_per_application'
  ) then
    raise exception 'the one-draw-per-application index is missing';
  end if;

  -- The shape constraints: each kind fills exactly the sides it means.
  if not exists (select 1 from pg_constraint where conname = 'crm_stock_movements_shape') then
    raise exception 'the movement shape constraint is missing';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crm_stock_movements_application_iff_consumption'
  ) then
    raise exception 'the application/consumption agreement constraint is missing';
  end if;

  -- Both readers and the writer stay invokers: a definer would let a member
  -- move stock in a book they cannot read.
  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname in ('crm_stock_on_hand', 'crm_stock_record_movement');
  if v_secdef <> 0 then
    raise exception '% stock function(s) are SECURITY DEFINER', v_secdef;
  end if;

  raise notice 'truck stock: append-only ledger, both guards and the invoker boundary all hold';
end;
$$;
