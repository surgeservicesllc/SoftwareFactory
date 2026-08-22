-- AgentOS isolation model.
--
-- Implements the least-privilege rules in docs/AGENTOS_SPEC.md §5, which that
-- spec states are product requirements rather than suggestions. The shape here
-- exists so that "this agent cannot do that" is a fact the database enforces,
-- not a sentence in a prompt.
--
-- Four ideas, in dependency order:
--
--   environments      the second wall. A `limited` environment names the hosts a
--                     session may reach. Nothing else is reachable, whatever
--                     tools happen to be attached.
--   mcp_connections   a tool endpoint plus a *reference* to a credential. The
--                     value never lands here; only the name of the server-side
--                     variable holding it.
--   skills            prompt or file capabilities attached per agent.
--   agent_grants      the default-deny join. An agent has nothing until a row
--                     here says otherwise, and read/write/delete are separate
--                     verbs so "can write" never silently implies "can delete".
--
-- This migration grants no execution authority. It creates no worker, connects
-- no provider, and relaxes no Phase 1D control. Every table is tenant-scoped
-- with RLS and FORCE RLS, browser access is read-only, and `service_role`
-- receives no table privileges, so the verified `026` ACL matrix is unchanged.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type public.agentos_network_mode as enum ('open', 'limited');
create type public.agentos_skill_kind as enum ('prompt', 'file');
create type public.agentos_repo_permission as enum ('git_read', 'git_write');

-- CHECK constraints cannot contain a subquery, so the per-element hostname test
-- lives in an immutable function the constraint can call.
create or replace function public.agentos_hosts_are_bare_hostnames(p_hosts text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(
    bool_and(host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
    true
  )
  from unnest(coalesce(p_hosts, '{}'::text[])) as host;
$function$;

comment on function public.agentos_hosts_are_bare_hostnames(text[]) is
  'True when every entry is a bare hostname. A scheme, port, path, or wildcard would widen the network wall in a way the proxy cannot honestly enforce.';

-- ---------------------------------------------------------------------------
-- Environments: the network wall
-- ---------------------------------------------------------------------------

create table public.agentos_environments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  networking public.agentos_network_mode not null default 'limited',
  allowed_hosts text[] not null default '{}'::text[],
  description text check (description is null or char_length(description) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_environments_name_unique unique (organization_id, name),
  constraint agentos_environments_id_organization_unique unique (id, organization_id),
  -- A limited environment with no hosts is the safe reading of "limited": it
  -- reaches nothing. An open environment must not carry a list that implies a
  -- restriction it does not apply.
  constraint agentos_environments_open_has_no_allowlist check (
    networking <> 'open' or cardinality(allowed_hosts) = 0
  ),
  constraint agentos_environments_hosts_bounded check (cardinality(allowed_hosts) <= 50),
  constraint agentos_environments_hosts_are_hostnames check (
    public.agentos_hosts_are_bare_hostnames(allowed_hosts)
  )
);

comment on table public.agentos_environments is
  'Network policy for a session. A limited environment blocks every host absent from allowed_hosts, independently of which MCP connections an agent holds.';
comment on column public.agentos_environments.allowed_hosts is
  'Bare hostnames. Empty under `limited` means the session reaches nothing, which is the safe reading rather than an oversight.';

-- ---------------------------------------------------------------------------
-- MCP connections: endpoints plus credential references
-- ---------------------------------------------------------------------------

create table public.agentos_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (name ~ '^[a-z][a-z0-9_-]{0,62}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  transport text not null check (transport in ('stdio', 'http', 'builtin')),
  endpoint text check (endpoint is null or char_length(endpoint) <= 500),
  -- The NAME of a server-side variable, never its value. Same rule the bot
  -- fabric follows: a connection record is metadata plus a reference.
  credential_env_var text check (
    credential_env_var is null
    or credential_env_var ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  allowed_operations text[] not null default '{}'::text[],
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_mcp_name_unique unique (organization_id, name),
  constraint agentos_mcp_id_organization_unique unique (id, organization_id),
  constraint agentos_mcp_operations_bounded check (cardinality(allowed_operations) <= 100),
  -- Refuse the privileged names outright. A leaked prompt asking for one of
  -- these should fail at the schema, not at review.
  constraint agentos_mcp_credential_not_privileged check (
    credential_env_var is null
    or credential_env_var not in (
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_DB_URL',
      'DATABASE_URL',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'GITHUB_STATE_SECRET',
      'VERCEL_TOKEN',
      'WORKER_TICK_SECRET',
      'CRON_SECRET'
    )
  ),
  -- NEXT_PUBLIC_ variables reach the browser by definition, so one can never
  -- be a credential.
  constraint agentos_mcp_credential_not_public check (
    credential_env_var is null or credential_env_var not like 'NEXT\_PUBLIC\_%'
  ),
  constraint agentos_mcp_endpoint_https check (
    endpoint is null or transport <> 'http' or endpoint ~ '^https://'
  )
);

comment on column public.agentos_mcp_connections.credential_env_var is
  'Name of a server-side environment variable. The value is resolved only on the server and only to a presence boolean; it never enters this table, a browser response, or a log.';

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------

create table public.agentos_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{0,62}$'),
  kind public.agentos_skill_kind not null,
  body text check (body is null or char_length(body) <= 20000),
  file_path text check (file_path is null or char_length(file_path) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_skills_slug_unique unique (organization_id, slug),
  constraint agentos_skills_id_organization_unique unique (id, organization_id),
  -- Exactly one source: a prompt carries a body, a file carries a path.
  constraint agentos_skills_source_matches_kind check (
    (kind = 'prompt' and body is not null and file_path is null)
    or (kind = 'file' and file_path is not null and body is null)
  ),
  constraint agentos_skills_body_no_secret check (
    body is null or not public.text_has_likely_secret(body)
  )
);

-- ---------------------------------------------------------------------------
-- Agent grants: default deny
-- ---------------------------------------------------------------------------
--
-- One row per agent. Absence of a row means the agent has nothing, which is why
-- the resolver below returns a deny-everything envelope for an ungranted agent
-- rather than raising.

create table public.agentos_agent_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  agent_id uuid not null,
  environment_id uuid,
  inbox_access boolean not null default false,
  runner_preference text not null default 'inherit'
    check (runner_preference in ('cloud', 'local', 'inherit')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_agent_grants_agent_unique unique (agent_id),
  constraint agentos_agent_grants_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint agentos_agent_grants_environment_fk foreign key (environment_id, organization_id)
    references public.agentos_environments(id, organization_id) on delete restrict
);

create table public.agentos_agent_mcp_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  agent_id uuid not null,
  mcp_connection_id uuid not null,
  created_at timestamptz not null default now(),

  constraint agentos_agent_mcp_unique unique (agent_id, mcp_connection_id),
  constraint agentos_agent_mcp_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint agentos_agent_mcp_connection_fk foreign key (mcp_connection_id, organization_id)
    references public.agentos_mcp_connections(id, organization_id) on delete cascade
);

create table public.agentos_agent_skill_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  agent_id uuid not null,
  skill_id uuid not null,
  created_at timestamptz not null default now(),

  constraint agentos_agent_skill_unique unique (agent_id, skill_id),
  constraint agentos_agent_skill_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint agentos_agent_skill_skill_fk foreign key (skill_id, organization_id)
    references public.agentos_skills(id, organization_id) on delete cascade
);

create table public.agentos_agent_repo_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  agent_id uuid not null,
  github_repository_id uuid not null,
  mount_path text not null check (mount_path ~ '^/[A-Za-z0-9._/-]{0,200}$'),
  permission public.agentos_repo_permission not null default 'git_read',
  created_at timestamptz not null default now(),

  constraint agentos_agent_repo_unique unique (agent_id, github_repository_id),
  constraint agentos_agent_repo_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint agentos_agent_repo_repository_fk foreign key (github_repository_id, organization_id)
    references public.github_repositories(id, organization_id) on delete cascade,
  -- Traversal out of the mount is refused here rather than in whichever caller
  -- happens to build the path.
  constraint agentos_agent_repo_mount_no_traversal check (mount_path !~ '\.\.')
);

-- Filesystem grants keep the three verbs separate on purpose. The spec is
-- explicit that an agent which "can write" still cannot delete unless delete
-- was granted, because unlimited filesystem access is what wipes the disk.
create table public.agentos_agent_filesystem_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  agent_id uuid not null,
  folder_path text not null check (folder_path ~ '^/[A-Za-z0-9._/-]{0,200}$'),
  can_read boolean not null default false,
  can_write boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),

  constraint agentos_agent_fs_unique unique (agent_id, folder_path),
  constraint agentos_agent_fs_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint agentos_agent_fs_no_traversal check (folder_path !~ '\.\.'),
  -- A row granting nothing is indistinguishable from no row, and reads as a
  -- grant at a glance. Refuse it so the table cannot lie.
  constraint agentos_agent_fs_grants_something check (can_read or can_write or can_delete),
  -- Delete without read is not a capability anyone means to grant.
  constraint agentos_agent_fs_delete_implies_read check (not can_delete or can_read),
  constraint agentos_agent_fs_write_implies_read check (not can_write or can_read)
);

-- The only spawn path. An agent may start a subtask only as an agent named
-- here; anything else is refused.
create table public.agentos_agent_collaborators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  agent_id uuid not null,
  collaborator_agent_id uuid not null,
  created_at timestamptz not null default now(),

  constraint agentos_agent_collaborator_unique unique (agent_id, collaborator_agent_id),
  constraint agentos_agent_collaborator_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  constraint agentos_agent_collaborator_target_fk foreign key (collaborator_agent_id, organization_id)
    references public.agents(id, organization_id) on delete cascade,
  -- Self-spawn is an unbounded loop wearing a collaboration list.
  constraint agentos_agent_collaborator_not_self check (agent_id <> collaborator_agent_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index agentos_environments_org_idx on public.agentos_environments (organization_id, name);
create index agentos_mcp_org_idx on public.agentos_mcp_connections (organization_id, name);
create index agentos_skills_org_idx on public.agentos_skills (organization_id, slug);
create index agentos_agent_grants_org_idx on public.agentos_agent_grants (organization_id, agent_id);
create index agentos_agent_mcp_agent_idx on public.agentos_agent_mcp_grants (organization_id, agent_id);
create index agentos_agent_skill_agent_idx on public.agentos_agent_skill_grants (organization_id, agent_id);
create index agentos_agent_repo_agent_idx on public.agentos_agent_repo_grants (organization_id, agent_id);
create index agentos_agent_fs_agent_idx on public.agentos_agent_filesystem_grants (organization_id, agent_id);
create index agentos_agent_collaborator_agent_idx on public.agentos_agent_collaborators (organization_id, agent_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.agentos_environments enable row level security;
alter table public.agentos_environments force row level security;
alter table public.agentos_mcp_connections enable row level security;
alter table public.agentos_mcp_connections force row level security;
alter table public.agentos_skills enable row level security;
alter table public.agentos_skills force row level security;
alter table public.agentos_agent_grants enable row level security;
alter table public.agentos_agent_grants force row level security;
alter table public.agentos_agent_mcp_grants enable row level security;
alter table public.agentos_agent_mcp_grants force row level security;
alter table public.agentos_agent_skill_grants enable row level security;
alter table public.agentos_agent_skill_grants force row level security;
alter table public.agentos_agent_repo_grants enable row level security;
alter table public.agentos_agent_repo_grants force row level security;
alter table public.agentos_agent_filesystem_grants enable row level security;
alter table public.agentos_agent_filesystem_grants force row level security;
alter table public.agentos_agent_collaborators enable row level security;
alter table public.agentos_agent_collaborators force row level security;

create policy agentos_environments_select_members
  on public.agentos_environments for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_mcp_select_members
  on public.agentos_mcp_connections for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_skills_select_members
  on public.agentos_skills for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_agent_grants_select_members
  on public.agentos_agent_grants for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_agent_mcp_select_members
  on public.agentos_agent_mcp_grants for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_agent_skill_select_members
  on public.agentos_agent_skill_grants for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_agent_repo_select_members
  on public.agentos_agent_repo_grants for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_agent_fs_select_members
  on public.agentos_agent_filesystem_grants for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_agent_collaborator_select_members
  on public.agentos_agent_collaborators for select to authenticated
  using (public.is_organization_member(organization_id));

-- Browser sessions read; every write goes through an audited routine. No
-- service_role table privileges are granted, so the verified ACL matrix from
-- migration 026 is unchanged.
revoke all on table public.agentos_environments from anon, authenticated;
revoke all on table public.agentos_mcp_connections from anon, authenticated;
revoke all on table public.agentos_skills from anon, authenticated;
revoke all on table public.agentos_agent_grants from anon, authenticated;
revoke all on table public.agentos_agent_mcp_grants from anon, authenticated;
revoke all on table public.agentos_agent_skill_grants from anon, authenticated;
revoke all on table public.agentos_agent_repo_grants from anon, authenticated;
revoke all on table public.agentos_agent_filesystem_grants from anon, authenticated;
revoke all on table public.agentos_agent_collaborators from anon, authenticated;

grant select on table public.agentos_environments to authenticated;
grant select on table public.agentos_mcp_connections to authenticated;
grant select on table public.agentos_skills to authenticated;
grant select on table public.agentos_agent_grants to authenticated;
grant select on table public.agentos_agent_mcp_grants to authenticated;
grant select on table public.agentos_agent_skill_grants to authenticated;
grant select on table public.agentos_agent_repo_grants to authenticated;
grant select on table public.agentos_agent_filesystem_grants to authenticated;
grant select on table public.agentos_agent_collaborators to authenticated;

-- ---------------------------------------------------------------------------
-- Grant resolution
-- ---------------------------------------------------------------------------
--
-- One place that answers "what may this agent do", so a caller cannot assemble
-- a more generous answer by reading the tables in a different order. An agent
-- with no grant row resolves to deny-everything rather than an error, because
-- "not configured" and "not allowed" must behave identically.

create or replace function public.agentos_resolved_agent_grants(p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  agent_record record;
  grant_record record;
  grant_configured boolean := false;
  environment_id uuid;
  environment_name text;
  environment_networking public.agentos_network_mode := 'limited'::public.agentos_network_mode;
  environment_hosts text[] := '{}'::text[];
  environment_configured boolean := false;
  result jsonb;
begin
  select a.id, a.organization_id, a.name, a.role
    into agent_record
    from public.agents a
   where a.id = p_agent_id;

  if not found then
    raise exception using errcode = '42501', message = 'the agent does not exist or is not visible';
  end if;

  if not public.is_organization_member(agent_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select * into grant_record
    from public.agentos_agent_grants g
   where g.agent_id = p_agent_id;
  -- Capture immediately: the environment lookup below overwrites `found`.
  grant_configured := found;

  if grant_configured and grant_record.environment_id is not null then
    select e.id, e.name, e.networking, e.allowed_hosts
      into environment_id, environment_name, environment_networking, environment_hosts
      from public.agentos_environments e
     where e.id = grant_record.environment_id;
    environment_configured := found;
  end if;

  result := jsonb_build_object(
    'agentId', agent_record.id,
    'agentName', agent_record.name,
    'configured', grant_configured,
    'inboxAccess', case when grant_configured then grant_record.inbox_access else false end,
    'runnerPreference', case when grant_configured then grant_record.runner_preference else 'inherit' end,
    -- No environment is the closed reading: reach nothing.
    'environment', jsonb_build_object(
      'id', environment_id,
      'name', environment_name,
      'networking', environment_networking,
      'allowedHosts', to_jsonb(environment_hosts),
      'configured', environment_configured
    ),
    'mcpConnections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'name', m.name, 'transport', m.transport,
               'allowedOperations', to_jsonb(m.allowed_operations),
               -- Presence only. The value is never read here.
               'credentialConfigured', m.credential_env_var is not null
             ) order by m.name)
        from public.agentos_agent_mcp_grants ag
        join public.agentos_mcp_connections m on m.id = ag.mcp_connection_id
       where ag.agent_id = p_agent_id
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'kind', s.kind) order by s.slug)
        from public.agentos_agent_skill_grants ag
        join public.agentos_skills s on s.id = ag.skill_id
       where ag.agent_id = p_agent_id
    ), '[]'::jsonb),
    'repos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'repositoryId', ag.github_repository_id,
               'mountPath', ag.mount_path,
               'permission', ag.permission
             ) order by ag.mount_path)
        from public.agentos_agent_repo_grants ag
       where ag.agent_id = p_agent_id
    ), '[]'::jsonb),
    'filesystem', coalesce((
      select jsonb_agg(jsonb_build_object(
               'folderPath', ag.folder_path,
               'canRead', ag.can_read,
               'canWrite', ag.can_write,
               'canDelete', ag.can_delete
             ) order by ag.folder_path)
        from public.agentos_agent_filesystem_grants ag
       where ag.agent_id = p_agent_id
    ), '[]'::jsonb),
    'collaborators', coalesce((
      select jsonb_agg(ag.collaborator_agent_id order by ag.collaborator_agent_id)
        from public.agentos_agent_collaborators ag
       where ag.agent_id = p_agent_id
    ), '[]'::jsonb)
  );

  return result;
end;
$function$;

comment on function public.agentos_resolved_agent_grants(uuid) is
  'The single answer to what an agent may do. An unconfigured agent resolves to deny-everything, so "not configured" and "not allowed" behave identically.';

revoke all on function public.agentos_resolved_agent_grants(uuid) from public, anon, service_role;
grant execute on function public.agentos_resolved_agent_grants(uuid) to authenticated;
