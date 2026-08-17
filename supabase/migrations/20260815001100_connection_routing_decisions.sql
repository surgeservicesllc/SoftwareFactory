-- Identity-routing decisions become durable evidence.
--
-- Phase 2D row 27: the Identity Router's answer — selection or refusal, with
-- every rejected candidate and its named reason — was returned to the caller
-- and then forgotten. A routing decision that only lives in one HTTP response
-- cannot be audited, compared week to week, or used to answer "why did work
-- run on that account?" after the fact.
--
-- This mirrors `scheduling_decisions` (Phase 2E) and
-- `provider_routing_decisions` (Phase 2A) deliberately: append-only, org-owned
-- under RLS, readable by members, writable only through one definer function
-- with the same secret-hygiene checks every other evidence writer has. A
-- refusal is evidence on its own — recording only selections would make the
-- audit read as if the router never said no.

create table public.connection_routing_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,

  capability text not null references public.connection_capability_types(capability),

  decision text not null check (decision in ('SELECTED', 'REFUSED')),

  -- Present on a selection; a refusal names a code instead.
  connection_id uuid,
  refusal_code text check (refusal_code ~ '^[A-Z][A-Z_]{2,63}$'),
  used_fallback boolean not null default false,

  considered_count integer not null check (considered_count between 0 and 100),

  -- Every candidate the router rejected, with its named reason. Ids and codes
  -- only — the router never returns secrets, and the check holds it to that.
  rejected jsonb not null default '[]'::jsonb check (
    jsonb_typeof(rejected) = 'array'
    and jsonb_array_length(rejected) <= 100
    and octet_length(rejected::text) <= 16384
    and not public.jsonb_has_sensitive_keys(rejected)
  ),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint connection_routing_decisions_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint connection_routing_decisions_connection_fk
    foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,

  -- A selection without a connection selected nothing; a refusal without a
  -- code explains nothing. Either would be a row that lies about itself.
  constraint connection_routing_decisions_shape check (
    (decision = 'SELECTED' and connection_id is not null and refusal_code is null)
    or (decision = 'REFUSED' and connection_id is null and refusal_code is not null)
  )
);

comment on table public.connection_routing_decisions is
  'Append-only record of Identity Router decisions: which connection was selected for a project and capability, or why the router refused, with every rejected candidate and its named reason.';

create index connection_routing_decisions_recent_idx
  on public.connection_routing_decisions (organization_id, created_at desc);
create index connection_routing_decisions_project_idx
  on public.connection_routing_decisions (project_id, created_at desc);

alter table public.connection_routing_decisions enable row level security;
alter table public.connection_routing_decisions force row level security;

create policy connection_routing_decisions_select_members
  on public.connection_routing_decisions for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.connection_routing_decisions from anon, authenticated, service_role;
grant select on table public.connection_routing_decisions to authenticated;

create or replace function public.connection_routing_decisions_are_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'connection_routing_decisions is append-only';
end;
$function$;

create trigger connection_routing_decisions_no_update
  before update or delete on public.connection_routing_decisions
  for each row execute function public.connection_routing_decisions_are_append_only();

create or replace function public.record_connection_routing_decision(
  p_project_id uuid,
  p_capability text,
  p_decision text,
  p_connection_id uuid default null,
  p_refusal_code text default null,
  p_used_fallback boolean default false,
  p_considered_count integer default 0,
  p_rejected jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  decision_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  -- The same generic lookup failure submit_command uses: this boundary must
  -- not confirm a foreign project's existence.
  select project.* into project_record
  from public.projects project
  where project.id = p_project_id
    and public.is_organization_owner(project.organization_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  -- A selected connection must be the caller's organization's connection; the
  -- composite foreign key enforces it, and this check turns that violation
  -- into the same generic refusal instead of a constraint error.
  if p_connection_id is not null and not exists (
    select 1 from public.connections connection
    where connection.id = p_connection_id
      and connection.organization_id = project_record.organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'connection not found';
  end if;

  insert into public.connection_routing_decisions (
    organization_id, project_id, capability, decision, connection_id,
    refusal_code, used_fallback, considered_count, rejected, created_by
  ) values (
    project_record.organization_id, p_project_id, p_capability, p_decision,
    p_connection_id, p_refusal_code, coalesce(p_used_fallback, false),
    coalesce(p_considered_count, 0), coalesce(p_rejected, '[]'::jsonb), caller_id
  )
  returning id into decision_id;

  return decision_id;
end;
$function$;

revoke all on function public.connection_routing_decisions_are_append_only()
  from public, anon, authenticated, service_role;
revoke all on function public.record_connection_routing_decision(
  uuid, text, text, uuid, text, boolean, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_connection_routing_decision(
  uuid, text, text, uuid, text, boolean, integer, jsonb
) to authenticated;
