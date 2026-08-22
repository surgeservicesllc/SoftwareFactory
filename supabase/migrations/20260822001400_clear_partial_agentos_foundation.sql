-- Forward-only cleanup for a partially applied AgentOS isolation foundation.
--
-- Hosted records 20260814000300_agentos_isolation_model as applied, but only
-- a fragment of its objects exist: protected-chain run 32600709789 stopped at
-- 20260822000900's first in-file guard with "expected 0 or 32 named objects;
-- found 4". The history row was recorded around a partial autocommit apply,
-- the known mixed-era pattern. 20260822000900 restores the complete
-- foundation, but only from a proven all-absent state - it refuses a mixed
-- one, and rightly: a fragment's fingerprint is ambiguous.
--
-- This migration returns the foundation to the proven-absent state by
-- dropping whatever strict subset of the 32 named objects exists, under
-- fail-closed guards: a complete foundation (32) and a clean absence (0) are
-- both no-ops, every remnant table must be empty, and every drop uses
-- RESTRICT semantics so any dependency from outside the roster aborts the
-- whole transaction instead of cascading through it. Nothing here can touch
-- a live or restored foundation.

do $cleanup$
declare
  v_present integer;
  v_after integer;
  v_table text;
  v_rows bigint;
  v_tables constant text[] := array[
    -- Children before parents, so plain DROP TABLE needs no CASCADE.
    'agentos_agent_collaborators', 'agentos_agent_filesystem_grants',
    'agentos_agent_repo_grants', 'agentos_agent_skill_grants',
    'agentos_agent_mcp_grants', 'agentos_agent_grants',
    'agentos_skills', 'agentos_mcp_connections', 'agentos_environments'
  ];
  v_enum text;
  v_enums constant text[] := array[
    'agentos_network_mode', 'agentos_skill_kind', 'agentos_repo_permission'
  ];
begin
  set local search_path = pg_catalog;

  select
    (select count(*)
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e'
        and t.typname in (
          'agentos_network_mode', 'agentos_skill_kind', 'agentos_repo_permission'
        ))
    +
    (select count(*)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
          'agentos_agent_grants', 'agentos_agent_mcp_grants',
          'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
          'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
        ))
    +
    (select count(*)
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'agentos_hosts_are_bare_hostnames', 'agentos_resolved_agent_grants'
        ))
    +
    (select count(*)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'i'
        and c.relname in (
          'agentos_environments_org_idx', 'agentos_mcp_org_idx',
          'agentos_skills_org_idx', 'agentos_agent_grants_org_idx',
          'agentos_agent_mcp_agent_idx', 'agentos_agent_skill_agent_idx',
          'agentos_agent_repo_agent_idx', 'agentos_agent_fs_agent_idx',
          'agentos_agent_collaborator_agent_idx'
        ))
    +
    (select count(*)
       from (values
         ('agentos_environments_select_members', 'public.agentos_environments'),
         ('agentos_mcp_select_members', 'public.agentos_mcp_connections'),
         ('agentos_skills_select_members', 'public.agentos_skills'),
         ('agentos_agent_grants_select_members', 'public.agentos_agent_grants'),
         ('agentos_agent_mcp_select_members', 'public.agentos_agent_mcp_grants'),
         ('agentos_agent_skill_select_members', 'public.agentos_agent_skill_grants'),
         ('agentos_agent_repo_select_members', 'public.agentos_agent_repo_grants'),
         ('agentos_agent_fs_select_members', 'public.agentos_agent_filesystem_grants'),
         ('agentos_agent_collaborator_select_members', 'public.agentos_agent_collaborators')
       ) expected(policy_name, relation_name)
       join pg_policy p
         on p.polname = expected.policy_name
        and p.polrelid = to_regclass(expected.relation_name))
  into v_present;

  -- A complete foundation is live or restored: not this migration's business.
  -- A clean absence is already the state 20260822000900 requires.
  if v_present = 0 or v_present = 32 then
    return;
  end if;

  -- Every remnant table must be empty. A partial apply that somehow captured
  -- data is not a remnant, and destroying it is not cleanup.
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('select count(*) from public.%I', v_table) into v_rows;
      if v_rows <> 0 then
        raise exception using errcode = '55000',
          message = '20260822001400: a partial AgentOS remnant table holds rows; refusing to drop it',
          detail = format('%s has %s rows', v_table, v_rows);
      end if;
    end if;
  end loop;

  -- Children before parents; DROP TABLE removes its own indexes and policies.
  -- No CASCADE anywhere: a dependency from outside the roster aborts.
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop table public.%I', v_table);
    end if;
  end loop;

  if to_regprocedure('public.agentos_resolved_agent_grants(uuid)') is not null then
    drop function public.agentos_resolved_agent_grants(uuid);
  end if;
  if to_regprocedure('public.agentos_hosts_are_bare_hostnames(text[])') is not null then
    drop function public.agentos_hosts_are_bare_hostnames(text[]);
  end if;

  foreach v_enum in array v_enums loop
    if to_regtype('public.' || v_enum) is not null then
      execute format('drop type public.%I', v_enum);
    end if;
  end loop;

  select
    (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname in ('agentos_network_mode', 'agentos_skill_kind', 'agentos_repo_permission'))
    + (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
            'agentos_agent_grants', 'agentos_agent_mcp_grants',
            'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
            'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'))
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('agentos_hosts_are_bare_hostnames', 'agentos_resolved_agent_grants'))
  into v_after;

  if v_after <> 0 then
    raise exception using errcode = '55000',
      message = '20260822001400: the partial AgentOS foundation was not fully cleared',
      detail = format('%s named objects remain', v_after);
  end if;
end
$cleanup$;
