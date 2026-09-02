-- ---------------------------------------------------------------------------
-- Increment 36 — conversation routing (ADR-240).
--
-- HubSpot routes conversations by rules nobody can read back. A request
-- that lands on the help desk should land on a PERSON, and the reason it
-- landed on them should be a sentence: the branch manager of the territory
-- the customer's address is in; failing that the territory's rep; failing
-- that the least-loaded CSR; failing that nobody, said plainly.
--
-- This file adds:
--
--   crm_portal_requests.assignee_employee_id / assigned_at / assigned_by
--   crm_request_suggested_assignee()   the suggestion, with the reason and
--                                      the load printed; nothing stored
--   crm_request_assign()               the assignment, recorded on the
--                                      account's timeline by name
--   crm_request_queue()                every open request with who has it,
--                                      and the suggestion for those nobody
--                                      has, oldest unassigned first
--   crm_my_employee()                  the caller's own staff record, for
--                                      "mine"
--
-- No rule table, deliberately: a rule that cannot be explained in a
-- sentence is a rule nobody will trust when it is wrong. The order above
-- is the rule, and every suggestion says which step chose it.
-- ---------------------------------------------------------------------------

alter table public.crm_portal_requests
  add column if not exists assignee_employee_id uuid,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null;

alter table public.crm_portal_requests drop constraint if exists crm_portal_requests_assignee_same_org;
alter table public.crm_portal_requests add constraint crm_portal_requests_assignee_same_org
  foreign key (organization_id, assignee_employee_id)
  references public.crm_employees (organization_id, id) on delete set null;

alter table public.crm_portal_requests drop constraint if exists crm_portal_requests_assignment_whole;
alter table public.crm_portal_requests add constraint crm_portal_requests_assignment_whole
  check ((assignee_employee_id is null) = (assigned_at is null));

create index if not exists crm_portal_requests_assignee_idx
  on public.crm_portal_requests (organization_id, assignee_employee_id)
  where assignee_employee_id is not null;

-- The caller's own staff record, if one is linked to their login.
create or replace function public.crm_my_employee()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select e.id from public.crm_employees e
   where e.user_id = auth.uid() and e.active
   order by e.created_at
   limit 1;
$$;

revoke all on function public.crm_my_employee() from public, anon, service_role;
grant execute on function public.crm_my_employee() to authenticated;

-- Open requests one person holds. STABLE, INVOKER: the load a member sees
-- is the load under their RLS.
create or replace function public.crm_request_open_load(p_organization uuid, p_employee uuid)
returns integer
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select count(*)::integer
    from public.crm_portal_requests r
   where r.organization_id = p_organization
     and r.assignee_employee_id = p_employee
     and r.status not in ('resolved', 'declined');
$$;

revoke all on function public.crm_request_open_load(uuid, uuid) from public, anon, service_role;
grant execute on function public.crm_request_open_load(uuid, uuid) to authenticated;
-- The suggestion. Reads as the caller; a request the caller cannot see
-- yields no row.
create or replace function public.crm_request_suggested_assignee(
  p_organization uuid,
  p_request uuid
)
returns table (
  employee_id uuid,
  employee_name text,
  role public.crm_employee_role,
  reason text,
  territory_code text,
  postal_code text,
  open_requests integer
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_address text;
  v_territory record;
  v_branch_name text;
  v_employee record;
begin
  select a.billing_address into v_address
    from public.crm_portal_requests r
    join public.crm_accounts a on a.id = r.account_id
   where r.organization_id = p_organization and r.id = p_request;
  if not found then
    return;
  end if;

  select t.* into v_territory
    from public.crm_territory_for_address(p_organization, v_address) t
   limit 1;

  if v_territory.territory_id is not null then
    select b.name into v_branch_name from public.crm_branches b where b.id = v_territory.branch_id;

    select e.id, e.first_name || coalesce(' ' || e.last_name, '') as name, e.role into v_employee
      from public.crm_employees e
     where e.organization_id = p_organization and e.active
       and e.role = 'branch_manager' and e.branch_id = v_territory.branch_id
     order by e.last_name nulls last, e.first_name
     limit 1;
    if found then
      employee_id := v_employee.id; employee_name := v_employee.name; role := v_employee.role;
      territory_code := v_territory.code; postal_code := v_territory.postal_code;
      open_requests := public.crm_request_open_load(p_organization, v_employee.id);
      reason := format('branch manager of %s; the address''s postal code %s is in territory %s',
                       coalesce(v_branch_name, 'the branch'), v_territory.postal_code, v_territory.code);
      return next;
      return;
    end if;

    if v_territory.rep_id is not null then
      select e.id, e.first_name || coalesce(' ' || e.last_name, '') as name, e.role into v_employee
        from public.crm_employees e
       where e.organization_id = p_organization and e.active and e.id = v_territory.rep_id;
      if found then
        employee_id := v_employee.id; employee_name := v_employee.name; role := v_employee.role;
        territory_code := v_territory.code; postal_code := v_territory.postal_code;
        open_requests := public.crm_request_open_load(p_organization, v_employee.id);
        reason := format('rep for territory %s (postal code %s); %s has no active branch manager',
                         v_territory.code, v_territory.postal_code, coalesce(v_branch_name, 'the branch'));
        return next;
        return;
      end if;
    end if;
  end if;

  select e.id, e.first_name || coalesce(' ' || e.last_name, '') as name, e.role,
         public.crm_request_open_load(p_organization, e.id) as load
    into v_employee
    from public.crm_employees e
   where e.organization_id = p_organization and e.active and e.role in ('csr', 'dispatcher')
   order by public.crm_request_open_load(p_organization, e.id), e.last_name nulls last, e.first_name
   limit 1;
  if found then
    employee_id := v_employee.id; employee_name := v_employee.name; role := v_employee.role;
    territory_code := v_territory.code; postal_code := v_territory.postal_code;
    open_requests := v_employee.load;
    reason := case
      when v_territory.territory_id is null
        then format('least-loaded %s (%s open); the address matches no active territory',
                    replace(v_employee.role::text, '_', ' '), v_employee.load)
      else format('least-loaded %s (%s open); territory %s has no active branch manager or rep',
                  replace(v_employee.role::text, '_', ' '), v_employee.load, v_territory.code)
    end;
    return next;
    return;
  end if;

  employee_id := null; employee_name := null; role := null;
  territory_code := v_territory.code; postal_code := v_territory.postal_code;
  open_requests := null;
  reason := case
    when v_territory.territory_id is null
      then 'nobody: the address matches no active territory and no active CSR or dispatcher is on the book'
    else format('nobody: territory %s has no active branch manager or rep, and no active CSR or dispatcher is on the book', v_territory.code)
  end;
  return next;
end;
$$;

revoke all on function public.crm_request_suggested_assignee(uuid, uuid) from public, anon, service_role;
grant execute on function public.crm_request_suggested_assignee(uuid, uuid) to authenticated;

-- The assignment, recorded by name. Null unassigns.
create or replace function public.crm_request_assign(
  p_organization uuid,
  p_request uuid,
  p_employee uuid
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_account uuid;
  v_name text;
begin
  if p_employee is not null then
    select e.first_name || coalesce(' ' || e.last_name, '') into v_name
      from public.crm_employees e
     where e.organization_id = p_organization and e.id = p_employee and e.active;
    if not found then
      raise exception 'that person is not an active member of staff in this workspace'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  update public.crm_portal_requests r
     set assignee_employee_id = p_employee,
         assigned_at = case when p_employee is null then null else now() end,
         assigned_by = case when p_employee is null then null else auth.uid() end
   where r.organization_id = p_organization and r.id = p_request
   returning r.account_id into v_account;
  if not found then
    raise exception 'no such request in this workspace' using errcode = 'no_data_found';
  end if;

  insert into public.crm_timeline_events (organization_id, account_id, kind, summary, actor_user_id)
  values (p_organization, v_account, 'note',
          case when p_employee is null then 'Request unassigned.' else format('Request assigned to %s.', v_name) end,
          auth.uid());
  return p_request;
end;
$$;

revoke all on function public.crm_request_assign(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.crm_request_assign(uuid, uuid, uuid) to authenticated;

-- Every open request, who has it, and the suggestion for those nobody has.
create or replace function public.crm_request_queue(p_organization uuid)
returns table (
  request_id uuid,
  account_id uuid,
  account_name text,
  kind public.crm_request_kind,
  status public.crm_request_status,
  summary text,
  submitted_at timestamptz,
  waiting_minutes integer,
  assignee_employee_id uuid,
  assignee_name text,
  assigned_at timestamptz,
  suggested_employee_id uuid,
  suggested_name text,
  suggested_reason text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select r.id, r.account_id, a.name, r.kind, r.status, r.summary, r.submitted_at,
         (extract(epoch from (now() - r.submitted_at)) / 60)::integer,
         r.assignee_employee_id,
         case when e.id is null then null else e.first_name || coalesce(' ' || e.last_name, '') end,
         r.assigned_at,
         s.employee_id, s.employee_name, s.reason
    from public.crm_portal_requests r
    join public.crm_accounts a on a.id = r.account_id
    left join public.crm_employees e on e.id = r.assignee_employee_id
    left join lateral (
      select * from public.crm_request_suggested_assignee(p_organization, r.id)
       where r.assignee_employee_id is null
    ) s on true
   where r.organization_id = p_organization
     and r.status not in ('resolved', 'declined')
   order by (r.assignee_employee_id is null) desc, r.submitted_at
   limit 500;
$$;

revoke all on function public.crm_request_queue(uuid) from public, anon, service_role;
grant execute on function public.crm_request_queue(uuid) to authenticated;
