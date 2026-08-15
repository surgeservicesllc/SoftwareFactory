-- Phase 2D: make the connection registry describe capability, health, and
-- capacity, so more than one account per provider becomes routable rather than
-- merely storable.
--
-- The existing model was built for one connection per provider per
-- organization. With one, "the GitHub connection" is unambiguous and the
-- provider column is effectively the identity. With two, three things that were
-- previously invisible all become load-bearing at once: which capability a
-- connection actually supplies, whether it is healthy enough to be chosen right
-- now, and whether it has room to take more work.
--
-- This migration adds exactly those, plus the project-side declaration of what
-- a mapping is *for*. It authorizes nothing on its own: no connection gains a
-- capability, no project gains a mapping, and every existing row keeps the
-- behavior it had.
--
-- Health is a new column rather than three new `connection_status` values.
-- Lifecycle and health are different axes that were being carried by one
-- column, which is why `error` had come to mean rate-limited, unreachable, and
-- credential-rejected at the same time. A router must tell those apart: one is
-- worth retrying, one is worth waiting on, and one needs an owner. Keeping
-- `connection_status` as the lifecycle also means no existing branch on it
-- changes meaning under this migration.

-- ---------------------------------------------------------------------------
-- 1. Capability vocabulary
-- ---------------------------------------------------------------------------

-- A closed vocabulary, because the whole point of goal 9 is that an agent asks
-- for a capability instead of naming an account. Free-form strings would let a
-- caller invent a capability that no connection can ever satisfy, and the
-- failure would surface as "no eligible connection" rather than "you asked for
-- something that does not exist".
create table public.connection_capability_types (
  capability text primary key check (capability ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  created_at timestamptz not null default now()
);

comment on table public.connection_capability_types is
  'Closed vocabulary of capabilities a connection may supply. A capability an agent can request but no connection can declare is a configuration error, not an empty result.';

insert into public.connection_capability_types (capability, description) values
  ('repository.read', 'Read repository metadata, branches, commits, checks, and file contents.'),
  ('repository.write', 'Create an isolated branch, commit, and draft pull request. Never the default branch.'),
  ('deploy.preview', 'Read or create non-production preview deployments.'),
  ('deploy.production', 'Read production deployment state and post-deploy validation evidence.'),
  ('database.read', 'Read control-plane data for a mapped project.'),
  ('database.migrate', 'Apply schema migrations. Owner-approved paths only.'),
  ('inference.advisory', 'Produce a structured analysis artifact. Cannot mutate a repository.'),
  ('worker.execute', 'Run a sandboxed implementation worker that ends at a draft pull request.');

alter table public.connection_capability_types enable row level security;
alter table public.connection_capability_types force row level security;

-- The vocabulary is not tenant data; every authenticated caller may read it so
-- a surface can explain what a project still needs. Nobody may write it from a
-- browser: adding a capability is a schema decision.
create policy connection_capability_types_read on public.connection_capability_types
  for select to authenticated using (true);

grant select on public.connection_capability_types to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Connection capabilities, health, and capacity
-- ---------------------------------------------------------------------------

alter table public.connections
  add column capabilities jsonb not null default '[]'::jsonb,
  add column health text not null default 'offline',
  add column health_checked_at timestamptz,
  add column max_concurrency integer,
  add column active_leases integer not null default 0;

comment on column public.connections.capabilities is
  'Capabilities this connection supplies, as a JSON array of connection_capability_types values. Empty means the connection is registered but routable for nothing.';
comment on column public.connections.health is
  'Runtime observation, distinct from the connection_status lifecycle. offline until something actually verifies it.';
comment on column public.connections.max_concurrency is
  'Provider or owner concurrency ceiling. Null means unknown, which the router treats as unlimited only when no lease accounting exists.';
comment on column public.connections.active_leases is
  'Work currently in flight against this connection. Maintained by lease acquisition and release, never by a browser.';

alter table public.connections
  add constraint connections_health_known check (
    health in ('connected', 'degraded', 'offline', 'unauthorized', 'error', 'disabled')
  ),
  add constraint connections_capabilities_array check (jsonb_typeof(capabilities) = 'array'),
  add constraint connections_capabilities_bounded check (jsonb_array_length(capabilities) <= 32),
  add constraint connections_capabilities_no_sensitive_data check (
    not public.jsonb_has_sensitive_keys(capabilities)
  ),
  add constraint connections_max_concurrency_positive check (
    max_concurrency is null or max_concurrency between 1 and 1000
  ),
  add constraint connections_active_leases_non_negative check (active_leases >= 0),
  add constraint connections_active_leases_within_ceiling check (
    max_concurrency is null or active_leases <= max_concurrency
  );

-- Every element must be a known capability. A trigger rather than a CHECK
-- because the vocabulary lives in a table, and a CHECK cannot read one.
create or replace function public.validate_connection_capabilities()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  unknown_capability text;
begin
  if new.capabilities = '[]'::jsonb then return new; end if;

  select value #>> '{}' into unknown_capability
  from pg_catalog.jsonb_array_elements(new.capabilities) as element(value)
  where pg_catalog.jsonb_typeof(value) <> 'string'
     or not exists (
       select 1 from public.connection_capability_types known
       where known.capability = value #>> '{}'
     )
  limit 1;

  if unknown_capability is not null then
    raise exception using
      errcode = '23514',
      message = 'unknown connection capability: ' || unknown_capability;
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_connection_capabilities()
  from public, anon, authenticated, service_role;

create trigger connections_validate_capabilities
  before insert or update of capabilities on public.connections
  for each row execute function public.validate_connection_capabilities();

-- Existing GitHub connections already do repository work. Declaring it makes
-- the current behavior expressible to the router rather than changing it.
update public.connections
set capabilities = '["repository.read", "repository.write"]'::jsonb,
    health = case
      when status = 'connected'::public.connection_status then 'connected'
      when status = 'disabled'::public.connection_status then 'disabled'
      when status = 'error'::public.connection_status then 'error'
      else 'offline'
    end,
    health_checked_at = last_verified_at
where provider = 'github'::public.connection_provider;

-- Non-GitHub connections keep an empty capability set: nothing in this tree
-- routes through them yet, and claiming otherwise would be the exact
-- "green UI is not proof" failure this repository keeps guarding against.
update public.connections
set health = case
      when status = 'disabled'::public.connection_status then 'disabled'
      when status = 'error'::public.connection_status then 'error'
      else 'offline'
    end,
    health_checked_at = last_verified_at
where provider <> 'github'::public.connection_provider;

-- ---------------------------------------------------------------------------
-- 3. What a project mapping is for
-- ---------------------------------------------------------------------------

alter table public.project_connections
  add column capability text references public.connection_capability_types(capability),
  add column priority integer not null default 100;

comment on column public.project_connections.capability is
  'The capability this mapping authorizes for this project. Null is a legacy mapping: readable, but never routable, because the router refuses to infer purpose.';
comment on column public.project_connections.priority is
  'Preference order among eligible connections for the same capability. Lower is preferred. Equal priorities are a configuration ambiguity the router refuses rather than breaks arbitrarily.';

alter table public.project_connections
  add constraint project_connections_priority_bounded check (priority between 1 and 1000);

-- A project may map several connections to one capability so that fallback has
-- somewhere to go, so this is deliberately not unique on (project, capability).
create unique index project_connections_capability_unique
  on public.project_connections (project_id, capability, connection_id)
  where capability is not null;

create index connections_routing_idx
  on public.connections (organization_id, provider, health)
  where status = 'connected'::public.connection_status;

create index project_connections_routing_idx
  on public.project_connections (project_id, capability, priority)
  where capability is not null;

-- ---------------------------------------------------------------------------
-- 4. Reading the registry safely
-- ---------------------------------------------------------------------------

-- The router runs server-side, but surfaces need the same view without ever
-- seeing `secret_reference`. This projection omits it entirely rather than
-- relying on a caller to select the right columns.
create or replace function public.list_project_connection_identities(
  p_project_id uuid
)
returns table (
  connection_id uuid,
  provider public.connection_provider,
  account_label text,
  capability text,
  priority integer,
  status public.connection_status,
  health text,
  health_checked_at timestamptz,
  max_concurrency integer,
  active_leases integer
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    connection.id,
    connection.provider,
    connection.external_account_label,
    link.capability,
    link.priority,
    connection.status,
    connection.health,
    connection.health_checked_at,
    connection.max_concurrency,
    connection.active_leases
  from public.project_connections link
  join public.connections connection
    on connection.id = link.connection_id
   and connection.organization_id = link.organization_id
  where link.project_id = p_project_id
    and public.can_access_project(p_project_id)
  order by link.capability nulls last, link.priority, connection.created_at;
$function$;

revoke all on function public.list_project_connection_identities(uuid)
  from public, anon, authenticated, service_role;
-- Authenticated only, deliberately. The projection gates on
-- `can_access_project`, which reads `auth.uid()`; under `service_role` that is
-- null, so the grant would return nothing while still widening the audited
-- service-role surface. A server-side caller that must bypass membership needs
-- its own explicitly designed path, not this one.
grant execute on function public.list_project_connection_identities(uuid)
  to authenticated;

comment on function public.list_project_connection_identities(uuid) is
  'Caller-scoped connection identities for one project. Never exposes secret_reference. Membership is enforced inside the function, not by the caller, so it is authenticated-only by design.';
