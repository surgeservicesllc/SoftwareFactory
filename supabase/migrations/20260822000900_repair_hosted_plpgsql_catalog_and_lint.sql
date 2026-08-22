-- Forward-only 00900 containment for the hosted PL/pgSQL catalog.
--
-- The hosted ledger claimed the AgentOS isolation migration while every object
-- owned by that migration was absent.  This file accepts exactly two states:
-- the complete, fingerprinted foundation or the complete absence of every
-- foundation object.  A mixed or drifted catalog aborts before any lint repair.
-- No worker, executor, provider, autonomy, action, or kill-switch state changes.

create temporary table _sf_20260822000900_foundation_state (
  state text primary key check (state in ('absent', 'full'))
) on commit preserve rows;

do $preflight$
declare
  v_present integer;
  v_bad text;
begin
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  if pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('service_role') is null
    or pg_catalog.to_regclass('auth.users') is null
    or pg_catalog.to_regclass('public.organizations') is null
    or pg_catalog.to_regclass('public.agents') is null
    or pg_catalog.to_regclass('public.github_repositories') is null
    or pg_catalog.to_regprocedure('public.text_has_likely_secret(text)') is null
    or pg_catalog.to_regprocedure('public.is_organization_member(uuid)') is null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation prerequisites are not the exact expected catalog';
  end if;

  select
    (select pg_catalog.count(*)
       from pg_catalog.pg_type t
       join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname in (
          'agentos_network_mode', 'agentos_skill_kind',
          'agentos_repo_permission'
        ))
    +
    (select pg_catalog.count(*)
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
          'agentos_agent_grants', 'agentos_agent_mcp_grants',
          'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
          'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
        ))
    +
    (select pg_catalog.count(*)
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'agentos_hosts_are_bare_hostnames',
          'agentos_resolved_agent_grants'
        ))
    +
    (select pg_catalog.count(*)
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'i'
        and c.relname in (
          'agentos_environments_org_idx', 'agentos_mcp_org_idx',
          'agentos_skills_org_idx', 'agentos_agent_grants_org_idx',
          'agentos_agent_mcp_agent_idx', 'agentos_agent_skill_agent_idx',
          'agentos_agent_repo_agent_idx', 'agentos_agent_fs_agent_idx',
          'agentos_agent_collaborator_agent_idx'
        ))
    +
    (select pg_catalog.count(*)
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
       join pg_catalog.pg_policy p
         on p.polname = expected.policy_name
        and p.polrelid = pg_catalog.to_regclass(expected.relation_name))
  into v_present;

  if v_present = 0 then
    insert into _sf_20260822000900_foundation_state values ('absent');
  elsif v_present = 32 then
    insert into _sf_20260822000900_foundation_state values ('full');
  else
    raise exception using errcode = '55000',
      message = 'AgentOS foundation catalog is mixed or partially restored',
      detail = pg_catalog.format('expected 0 or 32 named objects; found %s', v_present);
  end if;

  -- Refuse same-name objects outside public, wrong relation kinds, and helper
  -- overloads.  They would make either the absence or full-state fingerprint
  -- ambiguous even when the raw named-object count happened to match.
  select pg_catalog.string_agg(identity, ', ' order by identity)
  into v_bad
  from (
    select n.nspname || '.' || t.typname as identity
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where t.typname in (
      'agentos_network_mode', 'agentos_skill_kind', 'agentos_repo_permission'
    ) and n.nspname <> 'public'
    union all
    select n.nspname || '.' || c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    ) and (n.nspname <> 'public' or c.relkind <> 'r')
    union all
    select p.oid::pg_catalog.regprocedure::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname in (
      'agentos_hosts_are_bare_hostnames', 'agentos_resolved_agent_grants'
    ) and (
      n.nspname <> 'public'
      or p.oid not in (
        coalesce(pg_catalog.to_regprocedure(
          'public.agentos_hosts_are_bare_hostnames(text[])'), 0),
        coalesce(pg_catalog.to_regprocedure(
          'public.agentos_resolved_agent_grants(uuid)'), 0)
      )
    )
  ) unexpected;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation has an ambiguous object identity',
      detail = v_bad;
  end if;
end;
$preflight$;

-- Types and the constraint helper must precede the tables.  They are created
-- only for the proven all-absent state; a complete foundation is not replaced.
do $restore_types$
begin
  if exists (
    select 1 from _sf_20260822000900_foundation_state where state = 'absent'
  ) then
    execute 'create type public.agentos_network_mode as enum (''open'', ''limited'')';
    execute 'create type public.agentos_skill_kind as enum (''prompt'', ''file'')';
    execute 'create type public.agentos_repo_permission as enum (''git_read'', ''git_write'')';

    execute $ddl$
create function public.agentos_hosts_are_bare_hostnames(p_hosts text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $body$
  select coalesce(
    bool_and(host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
    true
  )
  from unnest(coalesce(p_hosts, '{}'::text[])) as host;
$body$
    $ddl$;
    -- Hosted default privileges must not add role-specific grants.  Preserve
    -- the original effective owner + PUBLIC execute posture explicitly.
    revoke all on function public.agentos_hosts_are_bare_hostnames(text[])
      from public, anon, authenticated, service_role;
    grant execute on function public.agentos_hosts_are_bare_hostnames(text[])
      to public;
  end if;
end;
$restore_types$;

-- One version-stable catalog projection validates both the already-complete
-- path (before any table statement) and the restored path (after creation).
-- It deliberately hashes prosrc rather than pg_get_functiondef output.
create function pg_temp._sf_20260822000900_validate_foundation()
returns void
language plpgsql
set search_path = pg_catalog
as $validator$
declare
  v_owner oid;
  v_bad text;
  v_hash text;
  v_count integer;
begin
  select c.relowner into v_owner
  from pg_catalog.pg_class c
  where c.oid = 'public.agents'::pg_catalog.regclass;

  if v_owner is null or pg_catalog.to_regrole(current_user)::oid <> v_owner then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation owner does not match the migration identity';
  end if;

  select pg_catalog.string_agg(expected.type_name, ', ' order by expected.type_name)
  into v_bad
  from (values
    ('agentos_network_mode', array['open', 'limited']::text[]),
    ('agentos_repo_permission', array['git_read', 'git_write']::text[]),
    ('agentos_skill_kind', array['prompt', 'file']::text[])
  ) expected(type_name, labels)
  left join pg_catalog.pg_type t
    on t.typnamespace = 'public'::pg_catalog.regnamespace
   and t.typname = expected.type_name
  where t.oid is null
     or t.typtype <> 'e'
     or t.typcategory <> 'E'
     or t.typowner <> v_owner
     or t.typacl is not null
     or t.typnotnull
     or t.typbasetype <> 0
     or (select pg_catalog.array_agg(e.enumlabel::text order by e.enumsortorder)
         from pg_catalog.pg_enum e where e.enumtypid = t.oid)
          is distinct from expected.labels;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation enum catalog is not exact', detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.agentos_hosts_are_bare_hostnames(text[])',
     'sql', 'i', false, '3058bd76e37881fdb008df71e18988be',
     array['search_path=pg_catalog']::text[], 'public', 'pg_catalog.bool', 'p_hosts',
     'True when every entry is a bare hostname. A scheme, port, path, or wildcard would widen the network wall in a way the proxy cannot honestly enforce.'),
    ('public.agentos_resolved_agent_grants(uuid)',
     'plpgsql', 's', true, 'a11033983d4ed0d766e96687c799dce6',
     array['search_path=pg_catalog']::text[], 'authenticated', 'pg_catalog.jsonb', 'p_agent_id',
     'The single answer to what an agent may do. An unconfigured agent resolves to deny-everything, so "not configured" and "not allowed" behave identically.')
  ) expected(signature, language_name, volatility, security_definer,
             source_md5, config, execute_role, result_type, argument_name,
             object_comment)
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid is null
     or p.proowner <> v_owner
     or l.lanname is distinct from expected.language_name
     or p.prokind <> 'f'
     or p.provolatile <> expected.volatility::"char"
     or p.prosecdef <> expected.security_definer
     or p.proconfig is distinct from expected.config
     or p.proisstrict
     or p.proleakproof
     or p.proretset
     or p.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or p.pronargs is distinct from 1
     or p.pronargdefaults is distinct from 0
     or coalesce(pg_catalog.array_to_string(p.proargnames, ','), '')
          is distinct from expected.argument_name
     or coalesce(pg_catalog.array_to_string(p.proargmodes, ','), '') <> ''
     or p.proallargtypes is not null
     or p.proargdefaults is not null
     or p.proparallel <> 'u'
     or p.procost is distinct from 100::real
     or p.prorows is distinct from 0::real
     or p.provariadic <> 0
     or p.prosupport <> 0
     or p.probin is not null
     or p.prosqlbody is not null
     or p.protrftypes is not null
     or pg_catalog.obj_description(p.oid, 'pg_proc')
          is distinct from expected.object_comment
     or pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) <> expected.source_md5
     or (
       expected.execute_role = 'public'
       and (
         p.proacl is not null
         and (
             (select pg_catalog.count(*)
              from pg_catalog.aclexplode(p.proacl)) <> 2
             or not exists (
               select 1 from pg_catalog.aclexplode(p.proacl) acl
               where acl.grantee = p.proowner
                 and acl.grantor = p.proowner
                 and acl.privilege_type = 'EXECUTE'
                 and not acl.is_grantable
             )
             or not exists (
               select 1 from pg_catalog.aclexplode(p.proacl) acl
               where acl.grantee = 0
                 and acl.grantor = p.proowner
                 and acl.privilege_type = 'EXECUTE'
                 and not acl.is_grantable
             )
             or exists (
               select 1 from pg_catalog.aclexplode(p.proacl) acl
             where acl.grantee not in (0, p.proowner)
             )
         )
       )
     )
     or (
       expected.execute_role = 'authenticated'
       and (
         p.proacl is null
         or (select pg_catalog.count(*) from pg_catalog.aclexplode(p.proacl)) <> 2
         or not exists (
           select 1 from pg_catalog.aclexplode(p.proacl) acl
           where acl.grantee = p.proowner
             and acl.grantor = p.proowner
             and acl.privilege_type = 'EXECUTE'
             and not acl.is_grantable
         )
         or not exists (
           select 1 from pg_catalog.aclexplode(p.proacl) acl
           where acl.grantee = pg_catalog.to_regrole('authenticated')::oid
             and acl.grantor = p.proowner
             and acl.privilege_type = 'EXECUTE'
             and not acl.is_grantable
         )
         or pg_catalog.has_function_privilege(
              'anon', expected.signature, 'EXECUTE')
         or pg_catalog.has_function_privilege(
              'service_role', expected.signature, 'EXECUTE')
       )
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation function catalog is not exact', detail = v_bad;
  end if;

  select pg_catalog.string_agg(c.relname, ', ' order by c.relname)
  into v_bad
  from pg_catalog.pg_class c
  where c.oid = any(array[
    'public.agentos_environments'::pg_catalog.regclass,
    'public.agentos_mcp_connections'::pg_catalog.regclass,
    'public.agentos_skills'::pg_catalog.regclass,
    'public.agentos_agent_grants'::pg_catalog.regclass,
    'public.agentos_agent_mcp_grants'::pg_catalog.regclass,
    'public.agentos_agent_skill_grants'::pg_catalog.regclass,
    'public.agentos_agent_repo_grants'::pg_catalog.regclass,
    'public.agentos_agent_filesystem_grants'::pg_catalog.regclass,
    'public.agentos_agent_collaborators'::pg_catalog.regclass
  ])
    and (
      c.relkind <> 'r'
      or c.relpersistence <> 'p'
      or c.relowner <> v_owner
      or not c.relrowsecurity
      or not c.relforcerowsecurity
      or c.relispartition
      or c.relacl is null
      or exists (
        select 1 from pg_catalog.aclexplode(c.relacl) acl
        where acl.grantor <> c.relowner
           or acl.grantee not in (
          c.relowner, pg_catalog.to_regrole('authenticated')::oid
        )
           or (acl.grantee = pg_catalog.to_regrole('authenticated')::oid
               and (acl.privilege_type <> 'SELECT' or acl.is_grantable))
      )
      or not exists (
        select 1 from pg_catalog.aclexplode(c.relacl) acl
        where acl.grantee = pg_catalog.to_regrole('authenticated')::oid
          and acl.grantor = c.relowner
          and acl.privilege_type = 'SELECT'
          and not acl.is_grantable
      )
      or not pg_catalog.has_table_privilege(
        'authenticated', c.oid,
        'SELECT'
      )
      or pg_catalog.has_table_privilege(
        'authenticated', c.oid,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
      or pg_catalog.has_table_privilege(
        'anon', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
      or pg_catalog.has_table_privilege(
        'service_role', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
      or not pg_catalog.has_any_column_privilege(
        'authenticated', c.oid, 'SELECT'
      )
      or pg_catalog.has_any_column_privilege(
        'authenticated', c.oid, 'INSERT,UPDATE,REFERENCES'
      )
      or pg_catalog.has_any_column_privilege(
        'anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
      )
      or pg_catalog.has_any_column_privilege(
        'service_role', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
      )
      or exists (
        select 1
        from pg_catalog.pg_attribute a
        where a.attrelid = c.oid
          and a.attnum > 0
          and not a.attisdropped
          and a.attacl is not null
      )
      or exists (
        (select acl.privilege_type, acl.is_grantable
         from pg_catalog.aclexplode(pg_catalog.acldefault('r', c.relowner)) acl
         where acl.grantee = c.relowner)
        except
        (select acl.privilege_type, acl.is_grantable
         from pg_catalog.aclexplode(c.relacl) acl
         where acl.grantee = c.relowner)
      )
      or exists (
        (select acl.privilege_type, acl.is_grantable
         from pg_catalog.aclexplode(c.relacl) acl
         where acl.grantee = c.relowner)
        except
        (select acl.privilege_type, acl.is_grantable
         from pg_catalog.aclexplode(pg_catalog.acldefault('r', c.relowner)) acl
         where acl.grantee = c.relowner)
      )
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation table security catalog is not exact', detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    table_row.relname || '.' || trigger_row.tgname,
    ', ' order by table_row.relname, trigger_row.tgname
  )
  into v_bad
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class table_row on table_row.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace table_schema on table_schema.oid = table_row.relnamespace
  where table_schema.nspname = 'public'
    and table_row.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    )
    and not trigger_row.tgisinternal;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation has an unexpected user trigger', detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    table_row.relname || '.' || rewrite_row.rulename,
    ', ' order by table_row.relname, rewrite_row.rulename
  )
  into v_bad
  from pg_catalog.pg_rewrite rewrite_row
  join pg_catalog.pg_class table_row on table_row.oid = rewrite_row.ev_class
  join pg_catalog.pg_namespace table_schema on table_schema.oid = table_row.relnamespace
  where table_schema.nspname = 'public'
    and table_row.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    )
    and rewrite_row.rulename <> '_RETURN';

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation has an unexpected rewrite rule', detail = v_bad;
  end if;

  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':',
           c.relname, a.attnum, a.attname, a.atttypid::pg_catalog.regtype::text,
           a.atttypmod, a.attnotnull, a.attidentity::text,
           a.attgenerated::text,
           coalesce(collation_schema.nspname || '.' || coll.collname, '-'),
           coalesce(a.attacl::text, '<null>'),
           coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '<null>')),
         '|' order by c.relname, a.attnum)), pg_catalog.count(*)::integer
  into v_hash, v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a
    on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d
    on d.adrelid = c.oid and d.adnum = a.attnum
  left join pg_catalog.pg_collation coll on coll.oid = a.attcollation
  left join pg_catalog.pg_namespace collation_schema
    on collation_schema.oid = coll.collnamespace
  where n.nspname = 'public'
    and c.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    );
  if v_count <> 69 or v_hash <> '8b8eb4ed00a49a11d6c113c2ecd1e63a' then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation column/default catalog is not exact',
      detail = pg_catalog.format('count=%s hash=%s', v_count, v_hash);
  end if;

  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':',
           c.relname, con.conname, con.contype::text, con.condeferrable,
           con.condeferred, con.convalidated, con.confupdtype::text,
           con.confdeltype::text, con.confmatchtype::text,
           coalesce(con.confrelid::pg_catalog.regclass::text, '-'),
           pg_catalog.pg_get_constraintdef(con.oid)),
         '|' order by c.relname, con.conname)), pg_catalog.count(*)::integer
  into v_hash, v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_constraint con
    on con.conrelid = c.oid and con.contype <> 'n'
  where n.nspname = 'public'
    and c.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    );
  if v_count <> 74 or v_hash <> 'f9ce6697abd8c099e40277d8b28c841e' then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation constraint/FK catalog is not exact',
      detail = pg_catalog.format('count=%s hash=%s', v_count, v_hash);
  end if;

  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':',
           tab.relname, idx.relname, i.indisunique, i.indisprimary,
           i.indisexclusion, i.indimmediate, i.indisvalid, i.indisready,
           pg_catalog.pg_get_indexdef(i.indexrelid)),
         '|' order by tab.relname, idx.relname)), pg_catalog.count(*)::integer
  into v_hash, v_count
  from pg_catalog.pg_index i
  join pg_catalog.pg_class tab on tab.oid = i.indrelid
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = tab.relnamespace
  where n.nspname = 'public'
    and tab.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    );
  if v_count <> 30 or v_hash <> 'a488e9b0e17f52b0dab6a3f3739ef4b5' then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation index catalog is not exact',
      detail = pg_catalog.format('count=%s hash=%s', v_count, v_hash);
  end if;

  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':',
           c.relname, p.polname, p.polpermissive, p.polcmd::text,
           array(select pg_catalog.pg_get_userbyid(role_id)
                 from pg_catalog.unnest(p.polroles) role_id order by 1)::text,
           coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '<null>'),
           coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '<null>')),
         '|' order by c.relname, p.polname)), pg_catalog.count(*)::integer
  into v_hash, v_count
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    );
  if v_count <> 9 or v_hash <> 'ae82e3adf6e2be6a9cb77b6556556612' then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation policy catalog is not exact',
      detail = pg_catalog.format('count=%s hash=%s', v_count, v_hash);
  end if;

  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws(':',
           c.relname,
           coalesce(pg_catalog.obj_description(c.oid, 'pg_class'), '<null>'),
           coalesce(pg_catalog.col_description(c.oid, a.attnum), '<null>')),
         '|' order by c.relname, a.attnum)), pg_catalog.count(*)::integer
  into v_hash, v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a
    on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public'
    and c.relname in (
      'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
      'agentos_agent_grants', 'agentos_agent_mcp_grants',
      'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
      'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
    );
  if v_count <> 69 or v_hash <> '493a2ddd03194e65ac4fbc35285e5db9' then
    raise exception using errcode = '55000',
      message = 'AgentOS foundation comment catalog is not exact',
      detail = pg_catalog.format('count=%s hash=%s', v_count, v_hash);
  end if;
end;
$validator$;

do $full_state_gate$
begin
  if exists (
    select 1 from _sf_20260822000900_foundation_state where state = 'full'
  ) then
    perform pg_temp._sf_20260822000900_validate_foundation();
  end if;
end;
$full_state_gate$;

create table if not exists public.agentos_environments (
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
  constraint agentos_environments_open_has_no_allowlist check (
    networking <> 'open' or cardinality(allowed_hosts) = 0
  ),
  constraint agentos_environments_hosts_bounded check (cardinality(allowed_hosts) <= 50),
  constraint agentos_environments_hosts_are_hostnames check (
    public.agentos_hosts_are_bare_hostnames(allowed_hosts)
  )
);

create table if not exists public.agentos_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (name ~ '^[a-z][a-z0-9_-]{0,62}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  transport text not null check (transport in ('stdio', 'http', 'builtin')),
  endpoint text check (endpoint is null or char_length(endpoint) <= 500),
  credential_env_var text check (
    credential_env_var is null or credential_env_var ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  allowed_operations text[] not null default '{}'::text[],
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agentos_mcp_name_unique unique (organization_id, name),
  constraint agentos_mcp_id_organization_unique unique (id, organization_id),
  constraint agentos_mcp_operations_bounded check (cardinality(allowed_operations) <= 100),
  constraint agentos_mcp_credential_not_privileged check (
    credential_env_var is null or credential_env_var not in (
      'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'DATABASE_URL',
      'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_STATE_SECRET',
      'VERCEL_TOKEN', 'WORKER_TICK_SECRET', 'CRON_SECRET'
    )
  ),
  constraint agentos_mcp_credential_not_public check (
    credential_env_var is null or credential_env_var not like 'NEXT\_PUBLIC\_%'
  ),
  constraint agentos_mcp_endpoint_https check (
    endpoint is null or transport <> 'http' or endpoint ~ '^https://'
  )
);

create table if not exists public.agentos_skills (
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
  constraint agentos_skills_source_matches_kind check (
    (kind = 'prompt' and body is not null and file_path is null)
    or (kind = 'file' and file_path is not null and body is null)
  ),
  constraint agentos_skills_body_no_secret check (
    body is null or not public.text_has_likely_secret(body)
  )
);

create table if not exists public.agentos_agent_grants (
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

create table if not exists public.agentos_agent_mcp_grants (
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

create table if not exists public.agentos_agent_skill_grants (
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

create table if not exists public.agentos_agent_repo_grants (
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
  constraint agentos_agent_repo_mount_no_traversal check (mount_path !~ '\.\.')
);

create table if not exists public.agentos_agent_filesystem_grants (
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
  constraint agentos_agent_fs_grants_something check (can_read or can_write or can_delete),
  constraint agentos_agent_fs_delete_implies_read check (not can_delete or can_read),
  constraint agentos_agent_fs_write_implies_read check (not can_write or can_read)
);

create table if not exists public.agentos_agent_collaborators (
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
  constraint agentos_agent_collaborator_not_self check (agent_id <> collaborator_agent_id)
);

create index if not exists agentos_environments_org_idx
  on public.agentos_environments (organization_id, name);
create index if not exists agentos_mcp_org_idx
  on public.agentos_mcp_connections (organization_id, name);
create index if not exists agentos_skills_org_idx
  on public.agentos_skills (organization_id, slug);
create index if not exists agentos_agent_grants_org_idx
  on public.agentos_agent_grants (organization_id, agent_id);
create index if not exists agentos_agent_mcp_agent_idx
  on public.agentos_agent_mcp_grants (organization_id, agent_id);
create index if not exists agentos_agent_skill_agent_idx
  on public.agentos_agent_skill_grants (organization_id, agent_id);
create index if not exists agentos_agent_repo_agent_idx
  on public.agentos_agent_repo_grants (organization_id, agent_id);
create index if not exists agentos_agent_fs_agent_idx
  on public.agentos_agent_filesystem_grants (organization_id, agent_id);
create index if not exists agentos_agent_collaborator_agent_idx
  on public.agentos_agent_collaborators (organization_id, agent_id);

do $restore_security$
begin
  if exists (
    select 1 from _sf_20260822000900_foundation_state where state = 'absent'
  ) then
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

    revoke all on table public.agentos_environments
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_mcp_connections
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_skills
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_agent_grants
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_agent_mcp_grants
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_agent_skill_grants
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_agent_repo_grants
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_agent_filesystem_grants
      from public, anon, authenticated, service_role;
    revoke all on table public.agentos_agent_collaborators
      from public, anon, authenticated, service_role;

    grant select on table public.agentos_environments to authenticated;
    grant select on table public.agentos_mcp_connections to authenticated;
    grant select on table public.agentos_skills to authenticated;
    grant select on table public.agentos_agent_grants to authenticated;
    grant select on table public.agentos_agent_mcp_grants to authenticated;
    grant select on table public.agentos_agent_skill_grants to authenticated;
    grant select on table public.agentos_agent_repo_grants to authenticated;
    grant select on table public.agentos_agent_filesystem_grants to authenticated;
    grant select on table public.agentos_agent_collaborators to authenticated;

    comment on function public.agentos_hosts_are_bare_hostnames(text[]) is
      'True when every entry is a bare hostname. A scheme, port, path, or wildcard would widen the network wall in a way the proxy cannot honestly enforce.';
    comment on table public.agentos_environments is
      'Network policy for a session. A limited environment blocks every host absent from allowed_hosts, independently of which MCP connections an agent holds.';
    comment on column public.agentos_environments.allowed_hosts is
      'Bare hostnames. Empty under `limited` means the session reaches nothing, which is the safe reading rather than an oversight.';
    comment on column public.agentos_mcp_connections.credential_env_var is
      'Name of a server-side environment variable. The value is resolved only on the server and only to a presence boolean; it never enters this table, a browser response, or a log.';

    execute $ddl$
create function public.agentos_resolved_agent_grants(p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $body$
declare
  agent_record record;
  grant_record record;
  grant_configured boolean := false;
  environment_id uuid;
  environment_name text;
  environment_networking public.agentos_network_mode := 'limited';
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
$body$
    $ddl$;

    comment on function public.agentos_resolved_agent_grants(uuid) is
      'The single answer to what an agent may do. An unconfigured agent resolves to deny-everything, so "not configured" and "not allowed" behave identically.';
    revoke all on function public.agentos_resolved_agent_grants(uuid)
      from public, anon, service_role;
    grant execute on function public.agentos_resolved_agent_grants(uuid)
      to authenticated;
  end if;
end;
$restore_security$;

select pg_temp._sf_20260822000900_validate_foundation();

-- Freeze every routine before replacing source.  The guard stores the exact
-- catalog row (minus only prosrc and the two intentional volatility changes),
-- plus the effective ACL.  Postflight requires the same OID, owner, signature,
-- SECURITY DEFINER posture, search_path, raw proacl, and effective grants.
create temporary table _sf_20260822000900_function_guard (
  signature text primary key,
  routine_oid oid not null,
  catalog_without_source_or_volatility jsonb not null,
  effective_acl jsonb not null,
  expected_source text not null,
  expected_volatility "char" not null
) on commit preserve rows;

do $function_preflight$
declare
  v_owner oid := (
    select c.relowner from pg_catalog.pg_class c
    where c.oid = 'public.agents'::pg_catalog.regclass
  );
  v_bad text;
begin
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);

  -- 00900 intentionally follows CONTRACT: four checked-wrapper bodies change
  -- below, so applying this file first would invalidate 00300's frozen
  -- preflight.  Require the complete owner-only legacy ACL state as catalog
  -- evidence instead of trusting filename order or a ledger row.
  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.assign_bot(uuid,uuid,uuid,uuid)',
     '80b547b7b722c57a9d2a262b67698be8', 'public.bot_assignments', true,
     4, 0, 'p_organization_id,p_bot_id,p_project_id,p_role_id', '', '', null),
    ('public.assign_bots_to_project(uuid,uuid,jsonb)',
     '23b260247a4be4f4a8d8aa2497e1b6a2', 'public.bot_assignments', true,
     3, 0, 'p_organization_id,p_project_id,p_assignments', '', '', null),
    ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)',
     'daecfeb964d863373a2072cc62e1033e', 'public.bots', true,
     4, 1, 'p_organization_id,p_bot_id,p_readiness,p_detail', '', '', 'NULL::text'),
    ('public.set_bot_assignment_execution(uuid,uuid,text,text)',
     '55ec15132d903ace0300f2cbe32db6bd', 'pg_catalog.record', true,
     4, 2,
     'p_organization_id,p_assignment_id,p_model,p_work_effort,assignment_id,model,work_effort',
     'i,i,i,i,t,t,t', 'uuid,uuid,text,text,uuid,text,text',
     'NULL::text, NULL::text'),
    ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)',
     '0aaec47295f86adbeec784d288f24400', 'public.bot_assignments', true,
     3, 0, 'p_organization_id,p_assignment_id,p_status', '', '', null),
    ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)',
     '7f51999309b645832d471ccebea94a9c', 'public.bot_assignments', true,
     5, 2, 'p_organization_id,p_assignment_id,p_configuration,p_role_id,p_status',
     '', '', 'NULL::uuid, NULL::public.bot_assignment_status')
  ) expected(
    signature, source_md5, result_type, returns_set,
    argument_count, default_count, argument_names, argument_modes,
    all_argument_types, argument_defaults
  )
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  left join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid is null
     or n.nspname is distinct from 'public'
     or l.lanname is distinct from 'plpgsql'
     or pg_catalog.pg_get_userbyid(p.proowner) is distinct from 'postgres'
     or p.proowner <> v_owner
     or p.prokind is distinct from 'f'
     or p.provolatile is distinct from 'v'
     or p.prosecdef is distinct from true
     or p.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          p.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
          is distinct from expected.source_md5
     or p.prorettype is distinct from pg_catalog.to_regtype(expected.result_type)
     or p.proretset is distinct from expected.returns_set
     or p.pronargs is distinct from expected.argument_count
     or p.pronargdefaults is distinct from expected.default_count
     or coalesce(pg_catalog.array_to_string(p.proargnames, ','), '')
          is distinct from expected.argument_names
     or coalesce(pg_catalog.array_to_string(p.proargmodes, ','), '')
          is distinct from expected.argument_modes
     or coalesce((
          select pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid, null),
            ',' order by argument_type.ordinality
          )
          from pg_catalog.unnest(p.proallargtypes)
            with ordinality argument_type(type_oid, ordinality)
        ), '') is distinct from expected.all_argument_types
     or pg_catalog.pg_get_expr(p.proargdefaults, 0)
          is distinct from expected.argument_defaults
     or p.proisstrict is distinct from false
     or p.proleakproof is distinct from false
     or p.proparallel is distinct from 'u'
     or p.procost is distinct from 100::real
     or p.prorows is distinct from
          case when expected.returns_set then 1000::real else 0::real end
     or p.provariadic <> 0
     or p.prosupport <> 0
     or p.probin is not null
     or p.prosqlbody is not null
     or p.protrftypes is not null
     or p.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(p.proacl)) <> 1
     or not exists (
       select 1 from pg_catalog.aclexplode(p.proacl) acl
       where acl.grantee = p.proowner and acl.grantor = p.proowner
         and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
     )
     or exists (
       select 1 from pg_catalog.aclexplode(p.proacl) acl
       where acl.grantor <> p.proowner
          or acl.grantee <> p.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
     )
     or pg_catalog.has_function_privilege(
          'anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
          'authenticated', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
          'service_role', expected.signature, 'EXECUTE');

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '00900 requires the exact 00300 CONTRACT catalog first',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'assign_bot', 'assign_bots_to_project', 'record_bot_readiness',
      'set_bot_assignment_execution', 'update_bot_assignment',
      'update_bot_assignment_configuration'
    )
    and p.oid not in (
      'public.assign_bot(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution(uuid,uuid,text,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = '00900 found an unexpected legacy bot mutator overload',
      detail = v_bad;
  end if;

  select pg_catalog.string_agg(expected.signature, ', ' order by expected.signature)
  into v_bad
  from (values
    ('public.agentos_apply_project_config(uuid,uuid,jsonb,boolean)',
     'cfc8efe543fbebebda8a2e643f91e487', 'v', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     '6a672a030491e7379a01e24b28a8b8d7', 'cd8a1292080b231b3e9a85d440b02023',
     'f75cd9cd32d176e36c7255f121387c97'),
    ('public.agentos_export_project_config(uuid,uuid)',
     '863ca595c22d6e036032161e2b447315', 's', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     'd6deabc3ac0c4d235f7dd0ad04d7dd0c', 'cd8a1292080b231b3e9a85d440b02023',
     '49af7f5da1f63fbb12c52e89c81ae446'),
    ('public.agentos_list_agent_grants(uuid,integer)',
     'ad0721957db42e486c2dab484cc8260c', 's', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     '493fee08153e6ab50fc8a2c83108a210', 'bafb571f7c83051dc1e25a85bcab765b',
     'c7bdcbf48e76a11da39b5dde14eba14f'),
    ('public.agentos_record_trigger_delivery(uuid,text,jsonb,boolean)',
     '9aa2f2f83beb0b28e29f2b37e1a91d4e', 'v', true,
     array['search_path=pg_catalog']::text[], 'service_role',
     '8cfa3e98d40daeab991ba0135da8db1e', 'cd8a1292080b231b3e9a85d440b02023',
     'c6f6df3c444a98bb57f77d0052da44cb'),
    ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)',
     '5ff06f065e241ad2baf5d7d5f576743a', 'v', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     'ae9d7af6a0c78059a6a8b6693765704a', '6c1a861a61d1e78eb1a5a4fc2d6460b7',
     '972ba462e06d56885860d179ad59706f'),
    ('public.audit_factory_health(uuid)',
     '18bbb7f45cb5fe4b9d9d3b45f06076c2', 's', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     'd79fef321f595b80c3c23e713a7ce423', 'cd8a1292080b231b3e9a85d440b02023',
     'fda3d299611d1adf37527279f0ba6e1e'),
    ('public.capture_improvement_baseline(uuid)',
     '2c7693b411e87f73433dcf0b5d117c9c', 's', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     'd79fef321f595b80c3c23e713a7ce423', 'cd8a1292080b231b3e9a85d440b02023',
     'fda3d299611d1adf37527279f0ba6e1e'),
    ('public.claim_provider_connect_session(text,text)',
     '9961e16bbe95da08903caac340633bca', 'v', true,
     array['search_path=pg_catalog']::text[], 'service_role',
     '6c4654f1612525e6c5b714ddea7050f1', 'd39f7431a65f34513eed0e6ad46e5ab0',
     '8992610aa5f3749a013a3bdf9f7d4fef'),
    ('public.list_factory_command_routing_candidates(uuid,uuid,text)',
     '20f9edba1651974ca0ef256293269d81', 's', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     '8da5b51883446c9d2785f6a7bd261b8a', '10c54a69f85156ba2a64e9d229e3ccef',
     '17919dac57b41b75fe0793ad660063cc'),
    ('public.normalize_bot_assignment_configuration(jsonb)',
     '643e307fdd9f98479bbe54d6f29c3623', 'i', false,
     array['search_path=pg_catalog']::text[], 'none',
     '1772e507ebf1500556561fe25ca48b3c', 'cd8a1292080b231b3e9a85d440b02023',
     '451c6919550f1ebe87eb5ec83b50366b'),
    ('public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])',
     '5c78babb546ecec96e81878a3c02ac0f', 'v', true,
     array['search_path=public, pg_temp']::text[], 'authenticated',
     '1c7bb9c86f02507a76d24fc2911387a2', 'dca150e997a47d6e579413ace8b530be',
     '8d7877b6de24358edd3e75981eb5411f'),
    ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)',
     'd0c11a5c1e57878c9b1b5d8753ecb1fd', 'v', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     'b25ef1fa546a2cbf04b61d7bb11ae620', '6c1a861a61d1e78eb1a5a4fc2d6460b7',
     '813ab274df60a32d50ddeeb5b1d0ca01'),
    ('public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
     'aea5da3473dd612f066e0e6fa3a76dd0', 'v', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     'd26b290cf64925268afb5c660f108bc7', '037cd4bec7412124d8268264a680208e',
     'b779f9c2f2c4d0cf086f6d67b85a457c'),
    ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)',
     '5323b0adb327f3d3a19c9bdca220922e', 'v', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     '83e81045a400cf5c90b3d35b163cb682', '6c1a861a61d1e78eb1a5a4fc2d6460b7',
     '7aae20f9ed9251fe3e32530baaf32ddb'),
    ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)',
     'eabefae63edf3d957ed8a0ad5e10d1bd', 'v', true,
     array['search_path=pg_catalog']::text[], 'authenticated',
     '5319d9505b65230c8d3e7274206f1d9d', '6c1a861a61d1e78eb1a5a4fc2d6460b7',
     '61cbc7ff7cb5a849b6021cdca5012449'),
    ('public.validate_pipeline_template_areas(jsonb)',
     'd10799c81d59269ae5cd6bcd2a5e5d27', 'i', false,
     array['search_path=pg_catalog']::text[], 'none',
     'cbf9bd42cf404b21da0c0fd554aed7bd', 'cab8111fd0b710a336c898e539090e34',
     '0d286e56441a0a9e377719309b75a912')
  ) expected(signature, source_md5, volatility, security_definer, config,
             execute_role, arguments_md5, result_md5, contract_md5)
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.signature)
  left join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  left join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid is null
     or n.nspname is distinct from 'public'
     or pg_catalog.pg_get_userbyid(p.proowner) is distinct from 'postgres'
     or p.proowner <> v_owner
     or l.lanname is distinct from 'plpgsql'
     or p.prokind <> 'f'
     or p.provolatile <> expected.volatility::"char"
     or p.prosecdef <> expected.security_definer
     or p.proconfig is distinct from expected.config
     or p.proisstrict
     or p.proleakproof
     or p.proparallel <> 'u'
     or p.provariadic <> 0
     or p.prosupport <> 0
     or p.probin is not null
     or p.prosqlbody is not null
     or pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
          p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) <> expected.source_md5
     or pg_catalog.md5(pg_catalog.pg_get_function_identity_arguments(p.oid))
          <> expected.arguments_md5
     or pg_catalog.md5(pg_catalog.pg_get_function_result(p.oid))
          <> expected.result_md5
     or pg_catalog.md5(pg_catalog.jsonb_build_array(
          n.nspname,
          l.lanname,
          pg_catalog.pg_get_userbyid(p.proowner),
          p.prokind::text,
          pg_catalog.format_type(p.prorettype, null),
          p.proretset,
          p.pronargs,
          p.pronargdefaults,
          coalesce(pg_catalog.array_to_string(p.proargnames, ','), ''),
          coalesce(pg_catalog.array_to_string(p.proargmodes, ','), ''),
          coalesce((
            select pg_catalog.string_agg(
              pg_catalog.format_type(argument_type.type_oid, null),
              ',' order by argument_type.ordinality
            )
            from pg_catalog.unnest(p.proallargtypes)
              with ordinality argument_type(type_oid, ordinality)
          ), ''),
          coalesce(pg_catalog.pg_get_expr(p.proargdefaults, 0), ''),
          p.proisstrict,
          p.proleakproof,
          p.prosecdef,
          p.proparallel::text,
          p.provariadic = 0,
          p.procost::text,
          p.prorows::text,
          p.prosupport = 0,
          p.probin is null,
          p.prosqlbody is null,
          p.protrftypes is null,
          p.proconfig,
          p.proacl is null
        )::text) is distinct from expected.contract_md5
     or p.proacl is null
     or (select pg_catalog.count(*) from pg_catalog.aclexplode(p.proacl))
          <> case when expected.execute_role = 'none' then 1 else 2 end
     or not exists (
       select 1 from pg_catalog.aclexplode(p.proacl) acl
       where acl.grantee = p.proowner and acl.grantor = p.proowner
         and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
     )
     or (
       expected.execute_role <> 'none'
       and not exists (
         select 1 from pg_catalog.aclexplode(p.proacl) acl
         where acl.grantee = pg_catalog.to_regrole(expected.execute_role)::oid
           and acl.grantor = p.proowner
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
     )
     or exists (
       select 1 from pg_catalog.aclexplode(p.proacl) acl
       where acl.grantor <> p.proowner
          or acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantee not in (
            p.proowner,
            case when expected.execute_role = 'none' then p.proowner
                 else pg_catalog.to_regrole(expected.execute_role)::oid end
          )
     )
     or pg_catalog.has_function_privilege(
          'anon', expected.signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
          'authenticated', expected.signature, 'EXECUTE')
          is distinct from (expected.execute_role = 'authenticated')
     or pg_catalog.has_function_privilege(
          'service_role', expected.signature, 'EXECUTE')
          is distinct from (expected.execute_role = 'service_role')
     or exists (
       select 1 from pg_catalog.aclexplode(p.proacl) acl
       where acl.grantee = 0
     );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'hosted PL/pgSQL lint containment preflight failed', detail = v_bad;
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'agentos_apply_project_config', 'agentos_export_project_config',
      'agentos_list_agent_grants', 'agentos_record_trigger_delivery',
      'assign_bots_to_project_checked',
      'audit_factory_health', 'capture_improvement_baseline',
      'claim_provider_connect_session',
      'list_factory_command_routing_candidates',
      'normalize_bot_assignment_configuration', 'record_claim_anchoring',
      'set_bot_assignment_execution_checked', 'submit_factory_command',
      'update_bot_assignment_checked',
      'update_bot_assignment_configuration_checked',
      'validate_pipeline_template_areas'
    )
    and p.oid not in (
      'public.agentos_apply_project_config(uuid,uuid,jsonb,boolean)'::pg_catalog.regprocedure,
      'public.agentos_export_project_config(uuid,uuid)'::pg_catalog.regprocedure,
      'public.agentos_list_agent_grants(uuid,integer)'::pg_catalog.regprocedure,
      'public.agentos_record_trigger_delivery(uuid,text,jsonb,boolean)'::pg_catalog.regprocedure,
      'public.assign_bots_to_project_checked(uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'public.audit_factory_health(uuid)'::pg_catalog.regprocedure,
      'public.capture_improvement_baseline(uuid)'::pg_catalog.regprocedure,
      'public.claim_provider_connect_session(text,text)'::pg_catalog.regprocedure,
      'public.list_factory_command_routing_candidates(uuid,uuid,text)'::pg_catalog.regprocedure,
      'public.normalize_bot_assignment_configuration(jsonb)'::pg_catalog.regprocedure,
      'public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])'::pg_catalog.regprocedure,
      'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'::pg_catalog.regprocedure,
      'public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'::pg_catalog.regprocedure,
      'public.validate_pipeline_template_areas(jsonb)'::pg_catalog.regprocedure
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected hosted PL/pgSQL lint target overload exists before repair',
      detail = v_bad;
  end if;

  insert into _sf_20260822000900_function_guard (
    signature, routine_oid, catalog_without_source_or_volatility,
    effective_acl, expected_source, expected_volatility
  )
  select
    expected.signature,
    p.oid,
    pg_catalog.to_jsonb(p) - 'prosrc' - 'provolatile',
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'grantor', acl.grantor,
               'grantee', acl.grantee,
               'privilege', acl.privilege_type,
               'grantable', acl.is_grantable
             ) order by acl.grantor, acl.grantee, acl.privilege_type)
      from pg_catalog.aclexplode(coalesce(
        p.proacl, pg_catalog.acldefault('f', p.proowner)
      )) acl
    ), '[]'::jsonb),
    p.prosrc,
    case when expected.signature in (
      'public.normalize_bot_assignment_configuration(jsonb)',
      'public.validate_pipeline_template_areas(jsonb)'
    ) then 's'::"char" else p.provolatile end
  from (values
    ('public.agentos_apply_project_config(uuid,uuid,jsonb,boolean)'),
    ('public.agentos_export_project_config(uuid,uuid)'),
    ('public.agentos_list_agent_grants(uuid,integer)'),
    ('public.agentos_record_trigger_delivery(uuid,text,jsonb,boolean)'),
    ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)'),
    ('public.audit_factory_health(uuid)'),
    ('public.capture_improvement_baseline(uuid)'),
    ('public.claim_provider_connect_session(text,text)'),
    ('public.list_factory_command_routing_candidates(uuid,uuid,text)'),
    ('public.normalize_bot_assignment_configuration(jsonb)'),
    ('public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])'),
    ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'),
    ('public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)'),
    ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'),
    ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'),
    ('public.validate_pipeline_template_areas(jsonb)')
  ) expected(signature)
  join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.signature);
end;
$function_preflight$;

create function pg_temp._sf_20260822000900_replace_source(
  p_signature text,
  p_old text,
  p_new text,
  p_expected_occurrences integer default 1
)
returns void
language plpgsql
set search_path = pg_catalog
as $replace$
declare
  v_oid oid := pg_catalog.to_regprocedure(p_signature);
  v_raw_source text;
  v_source text;
  v_occurrences integer;
begin
  select guard.expected_source
  into v_raw_source
  from _sf_20260822000900_function_guard guard
  where guard.signature = p_signature
    and guard.routine_oid = v_oid;

  if v_oid is null or v_raw_source is null or p_old is null or p_old = '' then
    raise exception using errcode = '55000',
      message = 'lint containment source replacement target is invalid',
      detail = p_signature;
  end if;

  v_source := pg_catalog.replace(pg_catalog.replace(
    v_raw_source, E'\r\n', E'\n'), E'\r', E'\n');

  v_occurrences := (
    pg_catalog.length(v_source)
      - pg_catalog.length(pg_catalog.replace(v_source, p_old, ''))
  ) / pg_catalog.length(p_old);
  if v_occurrences <> p_expected_occurrences then
    raise exception using errcode = '55000',
      message = 'lint containment source replacement did not match exactly',
      detail = pg_catalog.format('%s expected %s occurrence(s), found %s',
        p_signature, p_expected_occurrences, v_occurrences);
  end if;

  v_source := pg_catalog.replace(v_source, p_old, p_new);

  update _sf_20260822000900_function_guard
  set expected_source = v_source
  where signature = p_signature;
  if not found then
    raise exception using errcode = '55000',
      message = 'lint containment function guard is missing', detail = p_signature;
  end if;
end;
$replace$;

-- Unused-variable warnings: retain every authorization and locking behavior,
-- but use PERFORM where the selected row value was never consumed.
select pg_temp._sf_20260822000900_replace_source(
  'public.agentos_record_trigger_delivery(uuid,text,jsonb,boolean)',
  $old$  existing public.agentos_trigger_deliveries;
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.agentos_record_trigger_delivery(uuid,text,jsonb,boolean)',
  $old$    select * into existing
      from public.agentos_trigger_deliveries
$old$,
  $new$    perform 1
      from public.agentos_trigger_deliveries
$new$
);

select pg_temp._sf_20260822000900_replace_source(
  'public.list_factory_command_routing_candidates(uuid,uuid,text)',
  $old$  v_project public.projects%rowtype;
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.list_factory_command_routing_candidates(uuid,uuid,text)',
  $old$  select project.* into v_project
  from public.projects project
$old$,
  $new$  perform 1
  from public.projects project
$new$
);

select pg_temp._sf_20260822000900_replace_source(
  'public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
  $old$  v_project public.projects%rowtype;
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)',
  $old$  select project.* into v_project
  from public.projects project
$old$,
  $new$  perform 1
  from public.projects project
$new$
);

-- The checked wrappers still run the manager assertion first; only the unused
-- assignment target is removed.
select pg_temp._sf_20260822000900_replace_source(
  'public.assign_bots_to_project_checked(uuid,uuid,jsonb)',
  $old$  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.assign_bots_to_project_checked(uuid,uuid,jsonb)',
  $old$begin
  if pg_catalog.jsonb_typeof(coalesce(p_assignments, 'null'::jsonb)) <> 'array' then
$old$,
  $new$begin
  perform public.assert_bot_fabric_manager(p_organization_id);

  if pg_catalog.jsonb_typeof(coalesce(p_assignments, 'null'::jsonb)) <> 'array' then
$new$
);

select pg_temp._sf_20260822000900_replace_source(
  'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)',
  $old$  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)',
  $old$begin
  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
$old$,
  $new$begin
  perform public.assert_bot_fabric_manager(p_organization_id);

  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
$new$
);

select pg_temp._sf_20260822000900_replace_source(
  'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)',
  $old$  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)',
  $old$begin
  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
$old$,
  $new$begin
  perform public.assert_bot_fabric_manager(p_organization_id);

  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
$new$
);

select pg_temp._sf_20260822000900_replace_source(
  'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)',
  $old$  v_caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
$old$,
  ''
);
select pg_temp._sf_20260822000900_replace_source(
  'public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)',
  $old$begin
  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
$old$,
  $new$begin
  perform public.assert_bot_fabric_manager(p_organization_id);

  if p_expected_project_id is null or p_expected_revision is null or p_expected_revision <= 0 then
$new$
);

-- Typed empty arrays remove PostgreSQL's text-to-array coercion warnings.
select pg_temp._sf_20260822000900_replace_source(
  'public.capture_improvement_baseline(uuid)',
  $old$  unavailable text[] := '{}';$old$,
  $new$  unavailable text[] := '{}'::text[];$new$
);
select pg_temp._sf_20260822000900_replace_source(
  'public.audit_factory_health(uuid)',
  $old$  scores numeric[] := '{}';$old$,
  $new$  scores numeric[] := '{}'::numeric[];$new$
);
select pg_temp._sf_20260822000900_replace_source(
  'public.validate_pipeline_template_areas(jsonb)',
  $old$  seen text[] := '{}';$old$,
  $new$  seen text[] := '{}'::text[];$new$
);

-- Name the exact uniqueness constraint so RETURNS TABLE output names cannot
-- collide with INSERT target-column names in PL/pgSQL resolution.
select pg_temp._sf_20260822000900_replace_source(
  'public.claim_provider_connect_session(text,text)',
  $old$  on conflict (organization_id, purpose) do update
$old$,
  $new$  on conflict on constraint provider_credentials_one_per_purpose do update
$new$
);

-- Freeze the offered evidence as JSON instead of a temporary relation.  This
-- preserves the original one-snapshot semantics while giving the linter a
-- statically resolvable recordset.
select pg_temp._sf_20260822000900_replace_source(
  'public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])',
  $old$  v_acceptable_kinds text;
$old$,
  $new$  v_acceptable_kinds text;
  v_anchor_snapshot jsonb;
$new$
);
select pg_temp._sf_20260822000900_replace_source(
  'public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])',
  $old$  -- Anchors must belong to the same organization and the same run. Evidence
  -- borrowed from another run is not evidence about this one.
  create temporary table if not exists _offered_anchors (
    id uuid primary key,
    kind public.anchor_kind not null,
    passed boolean
  ) on commit drop;
  delete from _offered_anchors;

  insert into _offered_anchors (id, kind, passed)
  select a.id, a.kind, a.passed
    from public.graph_anchors a
   where a.id = any(p_anchor_ids)
     and a.organization_id = v_node_run.organization_id
     and a.graph_run_id = v_node_run.graph_run_id;
$old$,
  $new$  -- Anchors must belong to the same organization and the same run. Evidence
  -- borrowed from another run is not evidence about this one. Capture the
  -- exact offered set once, matching the original temporary-table snapshot.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'passed', a.passed
         ) order by a.id), '[]'::jsonb)
    into v_anchor_snapshot
    from public.graph_anchors a
   where a.id = any(p_anchor_ids)
     and a.organization_id = v_node_run.organization_id
     and a.graph_run_id = v_node_run.graph_run_id;
$new$
);
select pg_temp._sf_20260822000900_replace_source(
  'public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])',
  $old$    from _offered_anchors o
$old$,
  $new$    from pg_catalog.jsonb_to_recordset(v_anchor_snapshot)
      as o(id uuid, kind public.anchor_kind, passed boolean)
$new$,
  4
);

-- These routines call STABLE catalog/text helpers; STABLE is the narrowest
-- truthful volatility.  No signature, body, owner, path, or grant changes.
alter function public.normalize_bot_assignment_configuration(jsonb) stable;
alter function public.validate_pipeline_template_areas(jsonb) stable;

do $apply_sources$
declare
  guarded record;
  v_raw_source text;
  v_definition text;
begin
  for guarded in
    select * from _sf_20260822000900_function_guard order by signature
  loop
    select p.prosrc, pg_catalog.pg_get_functiondef(p.oid)
    into v_raw_source, v_definition
    from pg_catalog.pg_proc p
    where p.oid = guarded.routine_oid;

    if v_raw_source is null
      or pg_catalog.to_regprocedure(guarded.signature) <> guarded.routine_oid then
      raise exception using errcode = '55000',
        message = 'lint containment function identity changed before replacement',
        detail = guarded.signature;
    end if;

    if v_raw_source is distinct from guarded.expected_source then
      execute pg_catalog.replace(
        v_definition, v_raw_source, guarded.expected_source
      );
    end if;
  end loop;
end;
$apply_sources$;

do $postflight$
declare
  v_bad text;
begin
  select pg_catalog.string_agg(guard.signature, ', ' order by guard.signature)
  into v_bad
  from _sf_20260822000900_function_guard guard
  left join pg_catalog.pg_proc p on p.oid = guard.routine_oid
  where p.oid is null
     or pg_catalog.to_regprocedure(guard.signature) <> guard.routine_oid
     or (pg_catalog.to_jsonb(p) - 'prosrc' - 'provolatile')
          is distinct from guard.catalog_without_source_or_volatility
     or p.provolatile <> guard.expected_volatility
     or p.prosrc is distinct from guard.expected_source
     or coalesce((
       select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'grantor', acl.grantor,
                'grantee', acl.grantee,
                'privilege', acl.privilege_type,
                'grantable', acl.is_grantable
              ) order by acl.grantor, acl.grantee, acl.privilege_type)
       from pg_catalog.aclexplode(coalesce(
         p.proacl, pg_catalog.acldefault('f', p.proowner)
       )) acl
     ), '[]'::jsonb) is distinct from guard.effective_acl;

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'hosted PL/pgSQL lint containment postflight failed',
      detail = v_bad;
  end if;

  -- No same-name overload may remain outside the exact guarded identities.
  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'agentos_apply_project_config', 'agentos_export_project_config',
      'agentos_list_agent_grants', 'agentos_record_trigger_delivery',
      'assign_bots_to_project_checked',
      'audit_factory_health', 'capture_improvement_baseline',
      'claim_provider_connect_session',
      'list_factory_command_routing_candidates',
      'normalize_bot_assignment_configuration', 'record_claim_anchoring',
      'set_bot_assignment_execution_checked', 'submit_factory_command',
      'update_bot_assignment_checked',
      'update_bot_assignment_configuration_checked',
      'validate_pipeline_template_areas'
    )
    and not exists (
      select 1
      from _sf_20260822000900_function_guard guard
      where guard.routine_oid = p.oid
    );

  if v_bad is not null then
    raise exception using errcode = '55000',
      message = 'unexpected hosted PL/pgSQL lint target overload exists',
      detail = v_bad;
  end if;

  perform pg_temp._sf_20260822000900_validate_foundation();
end;
$postflight$;

-- psql applies this migration in autocommit mode during the real-PostgreSQL
-- integration path. Keep cross-statement guards alive until postflight, then
-- remove every session-local helper explicitly so no later migration can
-- observe or reuse stale guard state.
drop function pg_temp._sf_20260822000900_replace_source(text, text, text, integer);
drop function pg_temp._sf_20260822000900_validate_foundation();
drop table pg_temp._sf_20260822000900_function_guard;
drop table pg_temp._sf_20260822000900_foundation_state;
