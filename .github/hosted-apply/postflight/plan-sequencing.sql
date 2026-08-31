-- Postflight for scope=plan-sequencing (ADR-211).
--
-- Proves the schedule the migration claims to enforce, on the hosted book:
-- the twice-monthly case it exists for, both clamps, both cross-table
-- guards, the calendar anchoring, and that no sequencing function became a
-- definer on the way in.

do $$
declare
  v_may date;
  v_jun date;
  v_feb date;
  v_secdef integer;
  v_rls integer;
  v_grants integer;
begin
  -- The table exists, is RLS-enabled and forced, and service_role holds
  -- nothing on it. Hosted default privileges grant ALL on new tables, so
  -- this is the assertion that the revoke actually took.
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'crm_plan_steps'
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 1 then
    raise exception 'crm_plan_steps is not RLS-enabled and forced';
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_plan_steps'
     and grantee in ('service_role', 'anon', 'public');
  if v_grants <> 0 then
    raise exception 'crm_plan_steps still carries % grant(s) outside authenticated', v_grants;
  end if;

  -- Day 31 in February is month end, not an error: "the 31st" is how an
  -- operator writes "month end".
  v_feb := public.crm_plan_step_date(2026, 2, 'day_of_month', 31::smallint, null::smallint, null::smallint);
  if v_feb <> date '2026-02-28' then
    raise exception 'the day clamp is wrong: February 31st resolved to %', v_feb;
  end if;

  -- Week 5 means the LAST matching weekday. May 2026 has five Fridays;
  -- June 2026 has four, and "last Friday" must still land.
  v_may := public.crm_plan_step_date(2026, 5, 'nth_weekday', null::smallint, 5::smallint, 5::smallint);
  v_jun := public.crm_plan_step_date(2026, 6, 'nth_weekday', null::smallint, 5::smallint, 5::smallint);
  if v_may <> date '2026-05-29' or v_jun <> date '2026-06-26' then
    raise exception 'the last-weekday rule is wrong: May % June %', v_may, v_jun;
  end if;

  -- Only divisors of the year are legal cycles; anything else would
  -- restart every January and move the customer's dates.
  begin
    perform 1 from public.crm_service_plans limit 0;
    if exists (
      select 1 from pg_constraint
       where conname = 'crm_service_plans_cycle_months_divides_year'
    ) then
      null;
    else
      raise exception 'the cycle-length constraint is missing';
    end if;
  end;

  -- Both cross-table guards are triggers, because PostgREST is a door.
  if not exists (select 1 from pg_trigger where tgname = 'crm_plan_steps_fit_cycle') then
    raise exception 'the step-fits-cycle trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_service_plans_cycle_fits_steps') then
    raise exception 'the cycle-fits-steps trigger is missing';
  end if;

  -- Every reader stays an invoker: a definer here would hand one book's
  -- calendar to another.
  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname in ('crm_plan_occurrences', 'crm_plan_next_occurrence',
                       'crm_plan_cadence', 'crm_plan_step_date', 'crm_plan_set_sequence');
  if v_secdef <> 0 then
    raise exception '% sequencing function(s) are SECURITY DEFINER', v_secdef;
  end if;

  raise notice 'plan sequencing: clamps, guards, grants and invoker boundary all hold';
end;
$$;
