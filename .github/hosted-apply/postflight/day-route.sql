-- Postflight for hosted apply scope `day-route` (ADR-220).
--
-- What a route prevents is somebody driving to the wrong place. Each check
-- here is one way that happens: a technician holding two orders for one
-- morning, a visit appearing on two routes, two stops claiming the same
-- position so "stop 3 of 9" means nothing.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_wrongday integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_routes', 'crm_route_stops')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 2 then
    raise exception 'expected both route tables RLS-enabled and forced; found %', v_rls;
  end if;

  -- Hosted default privileges grant ALL on every new table, so this is
  -- checked on every apply rather than assumed from the migration.
  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('crm_routes', 'crm_route_stops')
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'the route tables carry % grant(s) outside authenticated', v_grants;
  end if;

  -- A route is a record of where somebody was sent; cancelling is a status.
  -- Scoped to the browser roles: role_table_grants also reports the table
  -- OWNER's own privileges, which always include delete, so an unscoped
  -- check here fails on a perfectly correct schema.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'crm_routes'
       and privilege_type = 'DELETE'
       and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC')
  ) then
    raise exception 'crm_routes gained a delete grant; a route that ran must stay readable';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_routes_one_per_technician_day_key'
  ) then
    raise exception 'a technician could hold two routes for one morning';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_route_stops_route_position_key'
  ) then
    raise exception 'two stops could claim the same position, so "stop 3 of 9" would mean nothing';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'crm_route_stops_work_order_key'
  ) then
    raise exception 'one visit could sit on two routes';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'crm_route_stops_belong'
  ) then
    raise exception 'the day-and-technician check is missing; a direct insert could route a visit to the wrong day';
  end if;

  -- The sequencer must stay an INVOKER: it edits a dispatcher's own working
  -- state and has no business running as the owner.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_route_set_order'
  ) then
    raise exception 'crm_route_set_order is SECURITY DEFINER; it has no need of that authority';
  end if;

  -- And the substantive one: no stop sits on a day its route is not for.
  select count(*) into v_wrongday
    from public.crm_route_stops s
    join public.crm_routes r
      on r.organization_id = s.organization_id and r.id = s.route_id
    join public.crm_work_orders w
      on w.organization_id = s.organization_id and w.id = s.work_order_id
   where (w.scheduled_start at time zone 'UTC')::date <> r.route_date;
  if v_wrongday <> 0 then
    raise exception '% stop(s) are scheduled for a different day than their route', v_wrongday;
  end if;

  raise notice 'day route: one route per technician per day, one route per visit, stops numbered from one';
end;
$$;
