-- Postflight for hosted apply scope `autopay-authorization` (ADR-218).
--
-- Two negatives to prove on hosted, and both are expressed as the ABSENCE
-- of a grant — which is exactly what hosted default privileges quietly
-- restore. That is why these are checked on every apply rather than
-- assumed from the migration having run once.
--
--   * Nothing can record that money moved, because no provider is
--     connected and `succeeded` has no writer but the gated function.
--   * A card number cannot be stored, because the schema refuses it.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_charge_write integer;
  v_mandate_write integer;
  v_secdef integer;
  v_succeeded integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_payment_instruments', 'crm_payment_mandates',
                       'crm_autopay_enrollments', 'crm_charge_attempts')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 4 then
    raise exception 'expected four autopay tables RLS-enabled and forced; found %', v_rls;
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('crm_payment_instruments', 'crm_payment_mandates',
                        'crm_autopay_enrollments', 'crm_charge_attempts')
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'the autopay tables carry % grant(s) outside authenticated', v_grants;
  end if;

  -- No UPDATE on charge attempts, for anybody. This is the only reason
  -- `succeeded` cannot be hand-written.
  select count(*) into v_charge_write
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_charge_attempts'
     and privilege_type in ('UPDATE', 'DELETE')
     and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC');
  if v_charge_write <> 0 then
    raise exception
      'crm_charge_attempts gained % update/delete grant(s); a charge could then claim it settled',
      v_charge_write;
  end if;

  -- A mandate that can be edited afterwards is not evidence of what the
  -- customer agreed to, which is the only thing it is for.
  select count(*) into v_mandate_write
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_payment_mandates'
     and privilege_type in ('UPDATE', 'DELETE')
     and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC');
  if v_mandate_write <> 0 then
    raise exception 'crm_payment_mandates gained % update/delete grant(s); a mandate must be frozen',
      v_mandate_write;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'crm_charge_attempts_succeeded_evidence'
  ) then
    raise exception 'a charge could claim it settled with nothing to check the claim against';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crm_payment_instruments_holder_no_pan'
  ) then
    raise exception 'the PAN refusal on the holder name is missing';
  end if;

  -- The detector itself has to be present AND correct: a function that
  -- exists but answers false to a card number is worse than none.
  if not public.text_has_likely_pan('4111 1111 1111 1111') then
    raise exception 'text_has_likely_pan does not recognise a spaced card number';
  end if;
  if public.text_has_likely_pan('M. Vance') then
    raise exception 'text_has_likely_pan refuses an ordinary name';
  end if;

  -- One live charge per invoice, or a customer is billed twice.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_charge_attempts_one_live_per_invoice_key'
  ) then
    raise exception 'the one-live-charge-per-invoice index is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_autopay_enrollments_one_live_key'
  ) then
    raise exception 'two live enrollments could race to charge the same invoice';
  end if;

  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_autopay_record_settlement';
  if v_secdef <> 1 then
    raise exception 'crm_autopay_record_settlement is not SECURITY DEFINER, so it cannot write succeeded';
  end if;

  -- The substantive check: nothing on hosted claims money moved, because
  -- nothing on hosted is connected to a processor.
  select count(*) into v_succeeded from public.crm_charge_attempts where state = 'succeeded';
  if v_succeeded <> 0 then
    raise exception '% charge(s) claim to have settled, but no processor is connected', v_succeeded;
  end if;

  raise notice 'autopay: mandates frozen, card numbers refused, settlement unreachable';
end;
$$;
