-- Postflight for hosted apply scope `field-offline-queue`.
--
-- The guarantee is that a field write cannot land twice and cannot vanish.
-- Both halves are structural, so both are checked here.

do $$
begin
  if not exists (
    select 1 from pg_class
     where oid = 'public.crm_field_submissions'::regclass
       and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'row level security is not forced on crm_field_submissions';
  end if;

  -- THE lock. Without this unique index the whole idempotency story is a
  -- read-then-write race, and two retries through a tunnel become two
  -- completed visits.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_field_submissions_org_token_key'
  ) then
    raise exception 'the client-token unique index is missing; replays would duplicate';
  end if;
  if not (select indisunique from pg_index
           where indexrelid = 'public.crm_field_submissions_org_token_key'::regclass) then
    raise exception 'the client-token index exists but is not unique';
  end if;

  -- A submission is the proof a field write arrived. Deleting one would
  -- make recorded work look unsent, and re-sending it is exactly what the
  -- token was meant to prevent.
  if has_table_privilege('authenticated', 'public.crm_field_submissions', 'delete') then
    raise exception 'crm_field_submissions became deletable';
  end if;
  if has_table_privilege('anon', 'public.crm_field_submissions', 'select') then
    raise exception 'crm_field_submissions is readable by anon';
  end if;

  -- A device clock claiming the future is refused at the door rather than
  -- silently clamped into something plausible.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_field_submissions'::regclass
       and conname = 'crm_field_submissions_sync_after_event'
  ) then
    raise exception 'the clock-skew constraint is missing';
  end if;
end
$$;

-- The completion trigger must DEFER to a supplied moment. If it goes back
-- to stamping now() unconditionally, every offline visit is recorded as
-- happening when the van found signal — and completed_at feeds technician
-- productivity, route density and recurring invoice service dates.
do $$
declare
  v_source text;
begin
  select pg_get_functiondef(p.oid) into v_source
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crm_work_order_set_completed_at';

  if v_source is null then
    raise exception 'the completion trigger function is missing';
  end if;
  if v_source !~ 'coalesce\s*\(\s*new\.completed_at' then
    raise exception
      'crm_work_order_set_completed_at no longer defers to a supplied completed_at; offline visits would be stamped at sync time';
  end if;
end
$$;

-- Every field function stays an INVOKER: the caller is a member and the
-- tables already carry policies, so a definer would widen authority for
-- nothing.
do $$
declare
  v_role text;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'crm_field_%' and p.prosecdef
  ) then
    raise exception 'a field function became a definer';
  end if;

  foreach v_role in array array['anon', 'service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'crm_field_%'
         and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'a field function is executable by %', v_role;
    end if;
  end loop;
end
$$;
