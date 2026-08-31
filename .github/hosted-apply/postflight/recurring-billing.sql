-- Postflight for hosted apply scope `recurring-billing`.
--
-- THE CHECK THAT MATTERS IS THE INDEX. Everything else here is the usual
-- posture; `crm_invoices_plan_period_key` is the reason this migration
-- exists. Without it a service plan can be billed twice for the same
-- period, and the customer finds out from a statement.
--
-- It is asserted as a PARTIAL unique index specifically. A total index over
-- the same columns would look right in a catalogue listing and would in
-- fact refuse every hand-raised invoice, because those carry a null plan
-- and Postgres treats each null as distinct only under the partial form
-- this schema relies on.

do $$
declare
  v_table text;
  v_all text[] := array['crm_billing_runs', 'crm_dunning_notices'];
begin
  if (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity and c.relforcerowsecurity
        and c.relname = any(v_all)) <> 2 then
    raise exception 'the billing tables are missing or not under forced RLS';
  end if;

  foreach v_table in array v_all loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'billing records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;

  -- A collections action taken is final. The run needs UPDATE because the
  -- generator writes its own totals back; the notice never does.
  if has_table_privilege('authenticated', 'public.crm_dunning_notices', 'update') then
    raise exception 'a dunning notice is editable after the fact';
  end if;
  if not has_table_privilege('authenticated', 'public.crm_billing_runs', 'update') then
    raise exception 'the generator cannot write a run''s totals back';
  end if;

  -- The anti-double-bill guarantee, present and partial.
  if not exists (
    select 1 from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'crm_invoices_plan_period_key'
      and i.indisunique
      and i.indpred is not null
  ) then
    raise exception 'the one-invoice-per-plan-per-period index is missing or is not partial';
  end if;

  if (select count(*) from pg_trigger
       where tgname = 'crm_dunning_notices_check_account') <> 1 then
    raise exception 'the dunning account guard is missing';
  end if;

  -- The generator writes, so it must run as the caller: a definer would
  -- write into whatever book the caller named.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('crm_generate_due_invoices', 'crm_collections_worklist')
  ) then
    raise exception 'a billing function is a definer and could write across tenants';
  end if;
end
$$;
