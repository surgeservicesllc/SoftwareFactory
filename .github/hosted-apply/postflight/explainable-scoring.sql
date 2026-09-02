-- Postflight for hosted apply scope `explainable-scoring` (ADR-229).
--
-- A score is a sum of named rules with the fact printed beside each one,
-- and an assignment is a history line naming the postal code that
-- matched. Each check here is a way that stops being true: a browser role
-- with a grant it should not hold, an override naming a rule that does not
-- exist, the engine or the matcher running as somebody other than the
-- caller, the on-create assignment trigger missing, or the defaults
-- drifting from the twenty-seven this release ships.

do $$
declare
  v_grants integer;
  v_defaults integer;
  v_unknown integer;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'crm_scoring_rules'
       and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'crm_scoring_rules is not RLS-enabled and forced';
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_scoring_rules'
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'crm_scoring_rules carries % grant(s) outside authenticated', v_grants;
  end if;

  select count(*) into v_defaults from public.crm_scoring_defaults();
  if v_defaults <> 27 then
    raise exception 'expected 27 default scoring rules; found %', v_defaults;
  end if;

  -- Every override names a rule the defaults know.
  select count(*) into v_unknown
    from public.crm_scoring_rules o
   where not exists (
     select 1 from public.crm_scoring_defaults() d
      where d.model = o.model and d.rule_key = o.rule_key);
  if v_unknown <> 0 then
    raise exception '% override(s) name a rule that does not exist', v_unknown;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'crm_scoring_rules_known') then
    raise exception 'the rule-known trigger is missing; an override could name a rule that does not exist';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_accounts_assign_on_create') then
    raise exception 'the on-create assignment trigger is missing';
  end if;

  -- The engine, the matcher and the backfill read and write as the caller.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('crm_score_accounts', 'crm_effective_scoring_rules',
                         'crm_territory_for_address', 'crm_assign_accounts_by_postal')
  ) then
    raise exception 'a scoring or assignment function is SECURITY DEFINER; they must run as the caller';
  end if;
  -- The on-create writer is the one definer, and it is not callable.
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'crm_account_assign_on_create'
       and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC')
  ) then
    raise exception 'crm_account_assign_on_create is callable by a browser role';
  end if;

  raise notice 'explainable scoring: 27 defaults, overrides name real rules, engine and matcher read as the caller';
end;
$$;
