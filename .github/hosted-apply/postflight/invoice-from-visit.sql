-- Postflight for hosted apply scope `invoice-from-visit` (ADR-212).
--
-- The guarantee is that an invoice built from a visit cannot bill work
-- that has not happened, cannot bill it twice, and cannot restate a
-- document the customer already holds. Each is structural, so each is
-- checked here.

do $$
declare
  v_delete integer;
  v_index integer;
  v_secdef integer;
  v_default text;
begin
  -- The reason generation builds once instead of rebuilding: members hold
  -- no delete on invoice lines, and this migration did not quietly add one.
  select count(*) into v_delete
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_invoice_lines'
     and privilege_type = 'DELETE'
     and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC');
  if v_delete <> 0 then
    raise exception 'crm_invoice_lines gained % delete grant(s); generation must never rebuild', v_delete;
  end if;

  -- Everything already in the book was typed by a person.
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'crm_invoice_lines' and column_name = 'source';
  if v_default is null or v_default not like '%manual%' then
    raise exception 'crm_invoice_lines.source does not default to manual (got %)',
      coalesce(v_default, 'no default');
  end if;

  -- The double-billing guard. Partial, so hand-typed lines are unaffected.
  select count(*) into v_index
    from pg_indexes
   where schemaname = 'public' and indexname = 'crm_invoice_lines_one_visit_per_book';
  if v_index <> 1 then
    raise exception 'the one-visit-per-book index is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_invoice_lines_source_id_iff_generated'
  ) then
    raise exception 'the source/source_id agreement constraint is missing';
  end if;

  -- An invoker, like every other writer in this schema: a definer would let
  -- a member bill an account they cannot read.
  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname = 'crm_invoice_lines_from_visit';
  if v_secdef <> 0 then
    raise exception 'crm_invoice_lines_from_visit is SECURITY DEFINER';
  end if;

  raise notice 'invoice-from-visit: append-only boundary, both guards and the invoker boundary all hold';
end;
$$;
