-- Least-privilege row security for every table exposed through the public schema.
-- Helper functions are SECURITY DEFINER only to avoid recursive membership-policy
-- evaluation. Every helper derives the caller from auth.uid(); no user id is accepted.

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = target_organization_id
        and member.user_id = auth.uid()
    );
$function$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.organization_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = target_organization_id
        and member.user_id = auth.uid()
        and member.role = any (allowed_roles)
    );
$function$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select public.has_organization_role(
    target_organization_id,
    array['owner'::public.organization_member_role, 'admin'::public.organization_member_role]
  );
$function$;

create or replace function public.is_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select public.has_organization_role(
    target_organization_id,
    array['owner'::public.organization_member_role]
  );
$function$;

create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.projects project
      join public.organization_members member
        on member.organization_id = project.organization_id
      where project.id = target_project_id
        and member.user_id = auth.uid()
    );
$function$;

create or replace function public.can_manage_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.projects project
      join public.organization_members member
        on member.organization_id = project.organization_id
      where project.id = target_project_id
        and member.user_id = auth.uid()
        and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
    );
$function$;

create or replace function public.shares_organization_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select auth.uid() is not null
    and (
      target_user_id = auth.uid()
      or exists (
        select 1
        from public.organization_members caller_membership
        join public.organization_members target_membership
          on target_membership.organization_id = caller_membership.organization_id
        where caller_membership.user_id = auth.uid()
          and target_membership.user_id = target_user_id
      )
    );
$function$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, public.organization_member_role[]) from public;
revoke all on function public.can_manage_organization(uuid) from public;
revoke all on function public.is_organization_owner(uuid) from public;
revoke all on function public.can_access_project(uuid) from public;
revoke all on function public.can_manage_project(uuid) from public;
revoke all on function public.shares_organization_with(uuid) from public;
revoke all on function public.text_has_likely_secret(text) from public;
revoke all on function public.jsonb_has_sensitive_keys(jsonb) from public;
revoke all on function public.jsonb_has_sensitive_keys_internal(jsonb, integer) from public, anon, authenticated;

grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, public.organization_member_role[]) to authenticated;
grant execute on function public.can_manage_organization(uuid) to authenticated;
grant execute on function public.is_organization_owner(uuid) to authenticated;
grant execute on function public.can_access_project(uuid) to authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;
grant execute on function public.shares_organization_with(uuid) to authenticated;
grant execute on function public.text_has_likely_secret(text) to authenticated;
grant execute on function public.jsonb_has_sensitive_keys(jsonb) to authenticated;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.projects enable row level security;
alter table public.projects force row level security;
alter table public.connections enable row level security;
alter table public.connections force row level security;
alter table public.project_connections enable row level security;
alter table public.project_connections force row level security;
alter table public.agents enable row level security;
alter table public.agents force row level security;
alter table public.commands enable row level security;
alter table public.commands force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_runs force row level security;
alter table public.pull_requests enable row level security;
alter table public.pull_requests force row level security;
alter table public.deployments enable row level security;
alter table public.deployments force row level security;
alter table public.test_runs enable row level security;
alter table public.test_runs force row level security;
alter table public.incidents enable row level security;
alter table public.incidents force row level security;
alter table public.reports enable row level security;
alter table public.reports force row level security;
alter table public.activity_events enable row level security;
alter table public.activity_events force row level security;
alter table public.policies enable row level security;
alter table public.policies force row level security;
alter table public.approvals enable row level security;
alter table public.approvals force row level security;

create policy profiles_select_shared_organization
  on public.profiles for select to authenticated
  using (public.shares_organization_with(id));
create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy organizations_select_members
  on public.organizations for select to authenticated
  using (public.is_organization_member(id));
create policy organizations_insert_creator
  on public.organizations for insert to authenticated
  with check (auth.uid() is not null and created_by = auth.uid());
create policy organizations_update_managers
  on public.organizations for update to authenticated
  using (public.can_manage_organization(id))
  with check (public.can_manage_organization(id));

create policy organization_members_select_members
  on public.organization_members for select to authenticated
  using (public.is_organization_member(organization_id));
create policy organization_members_insert_managers
  on public.organization_members for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_organization_owner(organization_id)
      or (
        public.can_manage_organization(organization_id)
        and role in ('member'::public.organization_member_role, 'viewer'::public.organization_member_role)
      )
    )
  );
create policy organization_members_update_managers
  on public.organization_members for update to authenticated
  using (
    public.is_organization_owner(organization_id)
    or (public.can_manage_organization(organization_id) and role <> 'owner'::public.organization_member_role)
  )
  with check (
    public.is_organization_owner(organization_id)
    or (
      public.can_manage_organization(organization_id)
      and role in ('member'::public.organization_member_role, 'viewer'::public.organization_member_role)
    )
  );
create policy organization_members_delete_owners
  on public.organization_members for delete to authenticated
  using (public.is_organization_owner(organization_id));

create policy projects_select_members
  on public.projects for select to authenticated
  using (public.is_organization_member(organization_id));
create policy projects_insert_managers
  on public.projects for insert to authenticated
  with check (public.can_manage_organization(organization_id) and created_by = auth.uid());
create policy projects_update_managers
  on public.projects for update to authenticated
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));

create policy connections_select_members
  on public.connections for select to authenticated
  using (public.is_organization_member(organization_id));
create policy connections_insert_managers
  on public.connections for insert to authenticated
  with check (public.can_manage_organization(organization_id) and created_by = auth.uid());
create policy connections_update_managers
  on public.connections for update to authenticated
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));
create policy connections_delete_owners
  on public.connections for delete to authenticated
  using (public.is_organization_owner(organization_id));

create policy project_connections_select_members
  on public.project_connections for select to authenticated
  using (public.is_organization_member(organization_id));
create policy project_connections_insert_managers
  on public.project_connections for insert to authenticated
  with check (
    public.can_manage_organization(organization_id)
    and public.can_access_project(project_id)
    and created_by = auth.uid()
  );
create policy project_connections_update_managers
  on public.project_connections for update to authenticated
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));
create policy project_connections_delete_managers
  on public.project_connections for delete to authenticated
  using (public.can_manage_organization(organization_id));

create policy agents_select_members
  on public.agents for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agents_insert_managers
  on public.agents for insert to authenticated
  with check (public.can_manage_organization(organization_id) and created_by = auth.uid());
create policy agents_update_managers
  on public.agents for update to authenticated
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));
create policy agents_delete_owners
  on public.agents for delete to authenticated
  using (public.is_organization_owner(organization_id));

create policy commands_select_members
  on public.commands for select to authenticated
  using (public.is_organization_member(organization_id));
create policy tasks_select_members
  on public.tasks for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agent_runs_select_members
  on public.agent_runs for select to authenticated
  using (public.is_organization_member(organization_id));
create policy pull_requests_select_members
  on public.pull_requests for select to authenticated
  using (public.is_organization_member(organization_id));
create policy deployments_select_members
  on public.deployments for select to authenticated
  using (public.is_organization_member(organization_id));
create policy test_runs_select_members
  on public.test_runs for select to authenticated
  using (public.is_organization_member(organization_id));
create policy incidents_select_members
  on public.incidents for select to authenticated
  using (public.is_organization_member(organization_id));
create policy reports_select_members
  on public.reports for select to authenticated
  using (public.is_organization_member(organization_id));
create policy activity_events_select_members
  on public.activity_events for select to authenticated
  using (public.is_organization_member(organization_id));
create policy approvals_select_members
  on public.approvals for select to authenticated
  using (public.is_organization_member(organization_id));

create policy policies_select_members
  on public.policies for select to authenticated
  using (public.is_organization_member(organization_id));
create policy policies_insert_managers
  on public.policies for insert to authenticated
  with check (public.can_manage_organization(organization_id) and created_by = auth.uid());
create policy policies_update_managers
  on public.policies for update to authenticated
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.organization_members from anon, authenticated;
revoke all on table public.projects from anon, authenticated;
revoke all on table public.connections from anon, authenticated;
revoke all on table public.project_connections from anon, authenticated;
revoke all on table public.agents from anon, authenticated;
revoke all on table public.commands from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.agent_runs from anon, authenticated;
revoke all on table public.pull_requests from anon, authenticated;
revoke all on table public.deployments from anon, authenticated;
revoke all on table public.test_runs from anon, authenticated;
revoke all on table public.incidents from anon, authenticated;
revoke all on table public.reports from anon, authenticated;
revoke all on table public.activity_events from anon, authenticated;
revoke all on table public.policies from anon, authenticated;
revoke all on table public.approvals from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update on table public.organizations to authenticated;
grant select, insert, update, delete on table public.organization_members to authenticated;
grant select, insert, update on table public.projects to authenticated;
grant select, insert, update, delete on table public.connections to authenticated;
grant select, insert, update, delete on table public.project_connections to authenticated;
grant select, insert, update, delete on table public.agents to authenticated;
grant select on table public.commands to authenticated;
grant select on table public.tasks to authenticated;
grant select on table public.agent_runs to authenticated;
grant select on table public.pull_requests to authenticated;
grant select on table public.deployments to authenticated;
grant select on table public.test_runs to authenticated;
grant select on table public.incidents to authenticated;
grant select on table public.reports to authenticated;
grant select on table public.activity_events to authenticated;
grant select, insert, update on table public.policies to authenticated;
grant select on table public.approvals to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_organization_reassignment() from public, anon, authenticated;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
revoke all on function public.bootstrap_organization_owner() from public, anon, authenticated;
revoke all on function public.reject_sensitive_row_data() from public, anon, authenticated;

comment on function public.is_organization_member(uuid) is
  'RLS helper tied to auth.uid(); callers cannot inspect membership on behalf of another user.';
comment on function public.can_access_project(uuid) is
  'RLS helper tied to auth.uid(); returns true only for a member of the project organization.';
