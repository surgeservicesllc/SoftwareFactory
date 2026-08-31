-- Postflight for hosted apply scope `wdo-inspections`.
--
-- An NPMA-33 is a legal document. What this file re-proves on hosted is
-- not that the tables exist but that the three things protecting the
-- document survived the apply.

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_wdo_inspections', 'crm_wdo_findings'] loop
    if not exists (
      select 1 from pg_class
       where oid = ('public.' || v_table)::regclass
         and relrowsecurity and relforcerowsecurity
    ) then
      raise exception 'row level security is not forced on %', v_table;
    end if;

    -- A WDO report is the record somebody relied on. It is superseded,
    -- never erased, and the guarantee is the ABSENCE of the grant —
    -- hosted grants ALL by default, so this only means something because
    -- the migration revoked it first.
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception '% became deletable by authenticated', v_table;
    end if;

    if has_table_privilege('anon', 'public.' || v_table, 'select') then
      raise exception '% is readable by anon', v_table;
    end if;
  end loop;
end
$$;

-- 1. The headline column cannot be skipped.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_wdo_inspections'
       and column_name = 'visible_evidence' and is_nullable = 'YES'
  ) then
    raise exception
      'crm_wdo_inspections.visible_evidence became nullable; an unanswered report could then read as a clean one';
  end if;

  -- 2. Half a coordinate is a mark nobody can place.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_wdo_findings'::regclass
       and conname = 'crm_wdo_findings_position_complete'
  ) then
    raise exception 'the paired-coordinate constraint is missing';
  end if;

  -- 3. The two triggers that freeze an issued document.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.crm_wdo_inspections'::regclass
       and tgname = 'crm_wdo_inspections_guard_issued' and not tgisinternal
  ) then
    raise exception 'the issued-report freeze trigger is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.crm_wdo_findings'::regclass
       and tgname = 'crm_wdo_findings_guard_issued' and not tgisinternal
  ) then
    raise exception 'the issued-findings freeze trigger is missing';
  end if;
end
$$;

-- The two polarities, again, and in opposite directions on purpose.
do $$
declare
  v_role text;
begin
  -- The summary aggregates a whole book; a definer would aggregate every
  -- tenant's at once. Issuing acts as the member issuing, under their RLS.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('crm_wdo_summary', 'crm_wdo_issue_report')
       and p.prosecdef
  ) then
    raise exception 'a WDO staff function is a definer and would read across tenants';
  end if;

  -- The portal reads narrow to one account for a caller who is NOT a
  -- member. An invoker there would silently return nothing.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('crm_portal_wdo_reports', 'crm_portal_wdo_findings')
       and not p.prosecdef
  ) then
    raise exception 'a WDO portal projection is not a definer and would return nothing';
  end if;

  foreach v_role in array array['anon', 'service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('crm_wdo_summary', 'crm_wdo_issue_report',
                           'crm_portal_wdo_reports', 'crm_portal_wdo_findings')
         and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'a WDO function is executable by %', v_role;
    end if;
  end loop;
end
$$;
