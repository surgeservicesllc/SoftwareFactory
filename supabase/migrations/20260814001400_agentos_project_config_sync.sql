-- `agentos.yml` push and pull.
--
-- `docs/AGENTOS_SPEC.md` §17 asks for a YAML file that mimics the online UI,
-- and §22 asks that a pushed file produce the same agents and template the UI
-- shows, with `pull` a no-op afterwards. Two functions carry that:
--
--   agentos_export_project_config   the whole configuration as one jsonb
--                                   document, shaped exactly like the file.
--   agentos_apply_project_config    the same document, applied.
--
-- Why RPCs rather than table writes. `authenticated` holds SELECT and nothing
-- else on every agentos_* table (20260814000300), so a CLI writing through
-- PostgREST could not insert a row even with a valid session. That is the
-- intended shape: applying a configuration has invariants that live here, in
-- one place, rather than in whichever client happens to be writing.
--
-- Three rules this file enforces that a client cannot be trusted to:
--
--   * Deleting is off by default. `p_prune` defaults to false, so a push adds
--     and updates but never removes. Rows the file does not mention are
--     reported back as `extra` so the caller can see the drift and decide.
--     A push that silently deleted an agent because someone edited a file on a
--     laptop is exactly the destructive default the policy forbids.
--   * A builtin template is never rewritten. The compound-engineer template
--     ships with the product; a file naming it is refused rather than merged.
--   * A repository grant resolves against repositories the GitHub App actually
--     installed. A file cannot invent repository access by naming a string.
--
-- Credentials are referenced by variable NAME only. The column constraints in
-- 20260814000300 already refuse a privileged or NEXT_PUBLIC_ name, and nothing
-- here resolves a name to a value.
--
-- Every local is `v_`-prefixed on purpose. A local named `agent_id` would
-- shadow the column of that name, turning `where agent_id = agent_id` into a
-- tautology that deletes every organization's grants rather than one agent's.

-- ---------------------------------------------------------------------------
-- Pull
-- ---------------------------------------------------------------------------

create or replace function public.agentos_export_project_config(
  p_organization_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_project_name text;
  v_document jsonb;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select p.name into v_project_name
  from public.projects p
  where p.id = p_project_id and p.organization_id = p_organization_id;

  if v_project_name is null then
    raise exception using errcode = '42704', message = 'project not found in this organization';
  end if;

  select jsonb_build_object(
    'project', v_project_name,

    'environments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', e.name,
        'networking', e.networking::text,
        'allowedHosts', to_jsonb(e.allowed_hosts)
      ) order by e.name)
      from public.agentos_environments e
      where e.organization_id = p_organization_id
    ), '[]'::jsonb),

    'mcpConnections', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', c.name,
        'displayName', c.display_name,
        'transport', c.transport,
        'endpoint', c.endpoint,
        -- The variable NAME. Its value is never read, here or anywhere.
        'credentialEnvVar', c.credential_env_var,
        'allowedOperations', to_jsonb(c.allowed_operations)
      )) order by c.name)
      from public.agentos_mcp_connections c
      where c.organization_id = p_organization_id
    ), '[]'::jsonb),

    'skills', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'slug', s.slug,
        'name', s.name,
        'kind', s.kind::text,
        'body', s.body,
        'filePath', s.file_path
      )) order by s.slug)
      from public.agentos_skills s
      where s.organization_id = p_organization_id
    ), '[]'::jsonb),

    'agents', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', a.name,
        'role', a.role::text,
        'description', a.description,
        'environment', env.name,
        'runner', coalesce(g.runner_preference, 'inherit'),
        'inboxAccess', coalesce(g.inbox_access, false),
        'mcpConnections', coalesce((
          select jsonb_agg(mc.name order by mc.name)
          from public.agentos_agent_mcp_grants am
          join public.agentos_mcp_connections mc on mc.id = am.mcp_connection_id
          where am.agent_id = a.id
        ), '[]'::jsonb),
        'skills', coalesce((
          select jsonb_agg(sk.slug order by sk.slug)
          from public.agentos_agent_skill_grants ag
          join public.agentos_skills sk on sk.id = ag.skill_id
          where ag.agent_id = a.id
        ), '[]'::jsonb),
        'repos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'repository', repo.full_name,
            'mountPath', rg.mount_path,
            'permission', rg.permission::text
          ) order by rg.mount_path)
          from public.agentos_agent_repo_grants rg
          join public.github_repositories repo on repo.id = rg.github_repository_id
          where rg.agent_id = a.id
        ), '[]'::jsonb),
        'filesystem', coalesce((
          select jsonb_agg(jsonb_build_object(
            'folderPath', fg.folder_path,
            'read', fg.can_read,
            'write', fg.can_write,
            'delete', fg.can_delete
          ) order by fg.folder_path)
          from public.agentos_agent_filesystem_grants fg
          where fg.agent_id = a.id
        ), '[]'::jsonb),
        'collaborators', coalesce((
          select jsonb_agg(peer.name order by peer.name)
          from public.agentos_agent_collaborators col
          join public.agents peer on peer.id = col.collaborator_agent_id
          where col.agent_id = a.id
        ), '[]'::jsonb)
      )) order by a.name)
      from public.agents a
      left join public.agentos_agent_grants g on g.agent_id = a.id
      left join public.agentos_environments env on env.id = g.environment_id
      where a.organization_id = p_organization_id and a.project_id = p_project_id
    ), '[]'::jsonb),

    'templates', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', t.name,
        'displayName', t.display_name,
        'description', t.description,
        'variables', to_jsonb(t.variables),
        -- Step order is the workflow, so it is emitted by index, never sorted
        -- by name the way the collections above are.
        'steps', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', st.name,
            'agent', st.agent_name,
            'prompt', st.prompt,
            'approvalGate', st.approval_gate,
            'humanStep', st.human_step
          ) order by st.step_index)
          from public.agentos_task_template_steps st
          where st.template_id = t.id
        ), '[]'::jsonb)
      )) order by t.name)
      from public.agentos_task_templates t
      where t.organization_id = p_organization_id
        -- A builtin ships with the product and `apply` refuses to redefine
        -- one. Exporting it would hand back a file that could not be pushed,
        -- which is the round trip breaking on any organization that seeded it.
        and not t.is_builtin
    ), '[]'::jsonb)
  ) into v_document;

  return v_document;
end;
$function$;

comment on function public.agentos_export_project_config(uuid, uuid) is
  'The organization configuration as an agentos.yml-shaped document. Credential references are variable names; no value is ever resolved.';

revoke all on function public.agentos_export_project_config(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.agentos_export_project_config(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Push
-- ---------------------------------------------------------------------------

create or replace function public.agentos_apply_project_config(
  p_organization_id uuid,
  p_project_id uuid,
  p_config jsonb,
  -- Off by default. A push adds and updates; removing something is a separate,
  -- explicit decision.
  p_prune boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_entry jsonb;
  v_step jsonb;
  v_environment_id uuid;
  v_connection_id uuid;
  v_skill_id uuid;
  v_agent_id uuid;
  v_peer_id uuid;
  v_template_id uuid;
  v_repository_id uuid;
  v_matches integer;
  v_step_number smallint;
  v_applied jsonb;
  v_extra jsonb;
  v_removed integer := 0;
begin
  -- Applying a configuration changes what agents may reach. That is a manage
  -- operation, not a member one.
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to apply a configuration';
  end if;

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.organization_id = p_organization_id
  ) then
    raise exception using errcode = '42704', message = 'project not found in this organization';
  end if;

  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'configuration must be an object';
  end if;

  -- -------------------------------------------------------------------------
  -- Environments
  -- -------------------------------------------------------------------------
  for v_entry in
    select item.value from jsonb_array_elements(coalesce(p_config -> 'environments', '[]'::jsonb)) as item
  loop
    insert into public.agentos_environments
      (organization_id, name, networking, allowed_hosts, created_by)
    values (
      p_organization_id,
      v_entry ->> 'name',
      coalesce(v_entry ->> 'networking', 'limited')::public.agentos_network_mode,
      coalesce(
        (select array_agg(host.value) from jsonb_array_elements_text(v_entry -> 'allowedHosts') as host),
        '{}'::text[]
      ),
      v_actor
    )
    on conflict (organization_id, name) do update
      set networking = excluded.networking,
          allowed_hosts = excluded.allowed_hosts,
          updated_at = now();
  end loop;

  -- -------------------------------------------------------------------------
  -- MCP connections
  -- -------------------------------------------------------------------------
  for v_entry in
    select item.value from jsonb_array_elements(coalesce(p_config -> 'mcpConnections', '[]'::jsonb)) as item
  loop
    insert into public.agentos_mcp_connections
      (organization_id, name, display_name, transport, endpoint, credential_env_var,
       allowed_operations, created_by)
    values (
      p_organization_id,
      v_entry ->> 'name',
      v_entry ->> 'displayName',
      v_entry ->> 'transport',
      v_entry ->> 'endpoint',
      v_entry ->> 'credentialEnvVar',
      coalesce(
        (select array_agg(op.value) from jsonb_array_elements_text(v_entry -> 'allowedOperations') as op),
        '{}'::text[]
      ),
      v_actor
    )
    on conflict (organization_id, name) do update
      set display_name = excluded.display_name,
          transport = excluded.transport,
          endpoint = excluded.endpoint,
          credential_env_var = excluded.credential_env_var,
          allowed_operations = excluded.allowed_operations,
          updated_at = now();
  end loop;

  -- -------------------------------------------------------------------------
  -- Skills
  -- -------------------------------------------------------------------------
  for v_entry in
    select item.value from jsonb_array_elements(coalesce(p_config -> 'skills', '[]'::jsonb)) as item
  loop
    insert into public.agentos_skills
      (organization_id, slug, name, kind, body, file_path, created_by)
    values (
      p_organization_id,
      v_entry ->> 'slug',
      v_entry ->> 'name',
      (v_entry ->> 'kind')::public.agentos_skill_kind,
      v_entry ->> 'body',
      v_entry ->> 'filePath',
      v_actor
    )
    on conflict (organization_id, slug) do update
      set name = excluded.name,
          kind = excluded.kind,
          body = excluded.body,
          file_path = excluded.file_path,
          updated_at = now();
  end loop;

  -- -------------------------------------------------------------------------
  -- Agents, first pass: the records and their non-referential grants
  -- -------------------------------------------------------------------------
  for v_entry in
    select item.value from jsonb_array_elements(coalesce(p_config -> 'agents', '[]'::jsonb)) as item
  loop
    -- `public.agents` has no unique key on (organization_id, name), so the
    -- match is done here and an ambiguity is refused rather than resolved by
    -- picking whichever row sorted first.
    select count(*) into v_matches
    from public.agents a
    where a.organization_id = p_organization_id
      and a.project_id = p_project_id
      and a.name = v_entry ->> 'name';

    if v_matches > 1 then
      raise exception using errcode = '22023',
        message = format('agent "%s" matches more than one record; rename one before pushing',
                         v_entry ->> 'name');
    end if;

    if v_matches = 1 then
      select a.id into v_agent_id
      from public.agents a
      where a.organization_id = p_organization_id
        and a.project_id = p_project_id
        and a.name = v_entry ->> 'name';

      update public.agents
        set role = coalesce(v_entry ->> 'role', 'custom')::public.agent_role,
            description = v_entry ->> 'description',
            updated_at = now()
      where id = v_agent_id;
    else
      insert into public.agents
        (organization_id, project_id, name, role, description, created_by)
      values (
        p_organization_id,
        p_project_id,
        v_entry ->> 'name',
        coalesce(v_entry ->> 'role', 'custom')::public.agent_role,
        v_entry ->> 'description',
        v_actor
      )
      returning id into v_agent_id;
    end if;

    v_environment_id := null;
    if v_entry ? 'environment' then
      select e.id into v_environment_id
      from public.agentos_environments e
      where e.organization_id = p_organization_id and e.name = v_entry ->> 'environment';

      if v_environment_id is null then
        raise exception using errcode = '23503',
          message = format('agent "%s" names environment "%s", which does not exist',
                           v_entry ->> 'name', v_entry ->> 'environment');
      end if;
    end if;

    insert into public.agentos_agent_grants
      (organization_id, agent_id, environment_id, inbox_access, runner_preference, created_by)
    values (
      p_organization_id,
      v_agent_id,
      v_environment_id,
      coalesce((v_entry ->> 'inboxAccess')::boolean, false),
      coalesce(v_entry ->> 'runner', 'inherit'),
      v_actor
    )
    on conflict (agent_id) do update
      set environment_id = excluded.environment_id,
          inbox_access = excluded.inbox_access,
          runner_preference = excluded.runner_preference,
          updated_at = now();

    -- The file is authoritative for an agent it names, so each grant set is
    -- replaced wholesale. Removing a capability by deleting a line is the
    -- behaviour an author expects, and merging would make that impossible.
    delete from public.agentos_agent_mcp_grants g where g.agent_id = v_agent_id;
    for v_connection_id in
      select c.id
      from jsonb_array_elements_text(coalesce(v_entry -> 'mcpConnections', '[]'::jsonb)) as wanted
      join public.agentos_mcp_connections c
        on c.organization_id = p_organization_id and c.name = wanted.value
    loop
      insert into public.agentos_agent_mcp_grants (organization_id, agent_id, mcp_connection_id)
      values (p_organization_id, v_agent_id, v_connection_id)
      on conflict (agent_id, mcp_connection_id) do nothing;
    end loop;

    delete from public.agentos_agent_skill_grants g where g.agent_id = v_agent_id;
    for v_skill_id in
      select s.id
      from jsonb_array_elements_text(coalesce(v_entry -> 'skills', '[]'::jsonb)) as wanted
      join public.agentos_skills s
        on s.organization_id = p_organization_id and s.slug = wanted.value
    loop
      insert into public.agentos_agent_skill_grants (organization_id, agent_id, skill_id)
      values (p_organization_id, v_agent_id, v_skill_id)
      on conflict (agent_id, skill_id) do nothing;
    end loop;

    delete from public.agentos_agent_filesystem_grants g where g.agent_id = v_agent_id;
    for v_step in
      select item.value from jsonb_array_elements(coalesce(v_entry -> 'filesystem', '[]'::jsonb)) as item
    loop
      insert into public.agentos_agent_filesystem_grants
        (organization_id, agent_id, folder_path, can_read, can_write, can_delete)
      values (
        p_organization_id, v_agent_id, v_step ->> 'folderPath',
        coalesce((v_step ->> 'read')::boolean, false),
        coalesce((v_step ->> 'write')::boolean, false),
        coalesce((v_step ->> 'delete')::boolean, false)
      );
    end loop;

    delete from public.agentos_agent_repo_grants g where g.agent_id = v_agent_id;
    for v_step in
      select item.value from jsonb_array_elements(coalesce(v_entry -> 'repos', '[]'::jsonb)) as item
    loop
      -- Repositories arrive from the GitHub App installation. A file that
      -- names one the installation never granted is refused; otherwise a YAML
      -- edit would be a way to widen repository access.
      select r.id into v_repository_id
      from public.github_repositories r
      where r.organization_id = p_organization_id and r.full_name = v_step ->> 'repository';

      if v_repository_id is null then
        raise exception using errcode = '23503',
          message = format('repository "%s" is not installed for this organization',
                           v_step ->> 'repository');
      end if;

      insert into public.agentos_agent_repo_grants
        (organization_id, agent_id, github_repository_id, mount_path, permission)
      values (
        p_organization_id, v_agent_id, v_repository_id, v_step ->> 'mountPath',
        coalesce(v_step ->> 'permission', 'git_read')::public.agentos_repo_permission
      );
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- Agents, second pass: collaborators
  -- -------------------------------------------------------------------------
  --
  -- Separate because a file may name a collaborator defined further down, and
  -- the first pass has only reached the agents above it.
  for v_entry in
    select item.value from jsonb_array_elements(coalesce(p_config -> 'agents', '[]'::jsonb)) as item
  loop
    select a.id into v_agent_id
    from public.agents a
    where a.organization_id = p_organization_id
      and a.project_id = p_project_id
      and a.name = v_entry ->> 'name';

    delete from public.agentos_agent_collaborators c where c.agent_id = v_agent_id;

    for v_peer_id in
      select peer.id
      from jsonb_array_elements_text(coalesce(v_entry -> 'collaborators', '[]'::jsonb)) as wanted
      join public.agents peer
        on peer.organization_id = p_organization_id
       and peer.project_id = p_project_id
       and peer.name = wanted.value
    loop
      insert into public.agentos_agent_collaborators
        (organization_id, agent_id, collaborator_agent_id)
      values (p_organization_id, v_agent_id, v_peer_id)
      on conflict (agent_id, collaborator_agent_id) do nothing;
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- Templates
  -- -------------------------------------------------------------------------
  for v_entry in
    select item.value from jsonb_array_elements(coalesce(p_config -> 'templates', '[]'::jsonb)) as item
  loop
    if exists (
      select 1 from public.agentos_task_templates t
      where t.organization_id = p_organization_id
        and t.name = v_entry ->> 'name'
        and t.is_builtin
    ) then
      -- A builtin ships with the product. Rewriting one from a file would let
      -- an edit change what every project's chains mean.
      raise exception using errcode = '42501',
        message = format('template "%s" is builtin and cannot be redefined from a file',
                         v_entry ->> 'name');
    end if;

    insert into public.agentos_task_templates
      (organization_id, name, display_name, description, variables, created_by)
    values (
      p_organization_id,
      v_entry ->> 'name',
      v_entry ->> 'displayName',
      v_entry ->> 'description',
      coalesce(
        (select array_agg(var.value) from jsonb_array_elements_text(v_entry -> 'variables') as var),
        '{}'::text[]
      ),
      v_actor
    )
    on conflict (organization_id, name) do update
      set display_name = excluded.display_name,
          description = excluded.description,
          variables = excluded.variables,
          updated_at = now()
    returning id into v_template_id;

    delete from public.agentos_task_template_steps s where s.template_id = v_template_id;

    v_step_number := 0;
    for v_step in
      select item.value from jsonb_array_elements(coalesce(v_entry -> 'steps', '[]'::jsonb)) as item
    loop
      v_step_number := v_step_number + 1;
      insert into public.agentos_task_template_steps
        (organization_id, template_id, step_index, name, agent_name, prompt,
         approval_gate, human_step)
      values (
        p_organization_id, v_template_id, v_step_number,
        v_step ->> 'name', v_step ->> 'agent', v_step ->> 'prompt',
        coalesce((v_step ->> 'approvalGate')::boolean, false),
        coalesce((v_step ->> 'humanStep')::boolean, false)
      );
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- Drift: what exists here that the file does not mention
  -- -------------------------------------------------------------------------
  select jsonb_build_object(
    'environments', coalesce((
      select jsonb_agg(e.name order by e.name)
      from public.agentos_environments e
      where e.organization_id = p_organization_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p_config -> 'environments', '[]'::jsonb)) as item
          where item.value ->> 'name' = e.name
        )
    ), '[]'::jsonb),
    'mcpConnections', coalesce((
      select jsonb_agg(c.name order by c.name)
      from public.agentos_mcp_connections c
      where c.organization_id = p_organization_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p_config -> 'mcpConnections', '[]'::jsonb)) as item
          where item.value ->> 'name' = c.name
        )
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(s.slug order by s.slug)
      from public.agentos_skills s
      where s.organization_id = p_organization_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p_config -> 'skills', '[]'::jsonb)) as item
          where item.value ->> 'slug' = s.slug
        )
    ), '[]'::jsonb),
    'agents', coalesce((
      select jsonb_agg(a.name order by a.name)
      from public.agents a
      where a.organization_id = p_organization_id
        and a.project_id = p_project_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p_config -> 'agents', '[]'::jsonb)) as item
          where item.value ->> 'name' = a.name
        )
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(t.name order by t.name)
      from public.agentos_task_templates t
      where t.organization_id = p_organization_id
        -- A builtin is never drift: the file was never allowed to define it.
        and not t.is_builtin
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p_config -> 'templates', '[]'::jsonb)) as item
          where item.value ->> 'name' = t.name
        )
    ), '[]'::jsonb)
  ) into v_extra;

  if p_prune then
    -- Only reached when the caller asked for it explicitly.
    delete from public.agents a
    where a.organization_id = p_organization_id
      and a.project_id = p_project_id
      and a.name in (select target.value from jsonb_array_elements_text(v_extra -> 'agents') as target);
    get diagnostics v_matches = row_count;
    v_removed := v_removed + v_matches;

    delete from public.agentos_task_templates t
    where t.organization_id = p_organization_id
      and not t.is_builtin
      and t.name in (select target.value from jsonb_array_elements_text(v_extra -> 'templates') as target);
    get diagnostics v_matches = row_count;
    v_removed := v_removed + v_matches;

    -- These three are referenced by grant tables with `on delete restrict` or
    -- `cascade` as declared in 20260814000300, so pruning one that is still in
    -- use fails loudly rather than quietly widening or narrowing an agent.
    delete from public.agentos_skills s
    where s.organization_id = p_organization_id
      and s.slug in (select target.value from jsonb_array_elements_text(v_extra -> 'skills') as target);
    get diagnostics v_matches = row_count;
    v_removed := v_removed + v_matches;

    delete from public.agentos_mcp_connections c
    where c.organization_id = p_organization_id
      and c.name in (select target.value from jsonb_array_elements_text(v_extra -> 'mcpConnections') as target);
    get diagnostics v_matches = row_count;
    v_removed := v_removed + v_matches;

    delete from public.agentos_environments e
    where e.organization_id = p_organization_id
      and e.name in (select target.value from jsonb_array_elements_text(v_extra -> 'environments') as target);
    get diagnostics v_matches = row_count;
    v_removed := v_removed + v_matches;

    v_extra := jsonb_build_object(
      'environments', '[]'::jsonb, 'mcpConnections', '[]'::jsonb, 'skills', '[]'::jsonb,
      'agents', '[]'::jsonb, 'templates', '[]'::jsonb
    );
  end if;

  v_applied := jsonb_build_object(
    'environments', jsonb_array_length(coalesce(p_config -> 'environments', '[]'::jsonb)),
    'mcpConnections', jsonb_array_length(coalesce(p_config -> 'mcpConnections', '[]'::jsonb)),
    'skills', jsonb_array_length(coalesce(p_config -> 'skills', '[]'::jsonb)),
    'agents', jsonb_array_length(coalesce(p_config -> 'agents', '[]'::jsonb)),
    'templates', jsonb_array_length(coalesce(p_config -> 'templates', '[]'::jsonb))
  );

  -- The audit event carries counts and names, never a prompt body or a
  -- credential reference.
  insert into public.activity_events
    (organization_id, project_id, actor_user_id, event_type, entity_type, entity_id,
     description, metadata)
  values (
    p_organization_id, p_project_id, v_actor,
    (case when p_prune then 'agentos.config_pruned' else 'agentos.config_applied' end)
      ::public.activity_event_type,
    'agentos_project_config', p_project_id,
    case when p_prune
      then format('Applied agentos.yml and pruned %s record(s)', v_removed)
      else 'Applied agentos.yml' end,
    jsonb_build_object('applied', v_applied, 'pruned', v_removed, 'extra', v_extra)
  );

  return jsonb_build_object(
    'applied', v_applied,
    'pruned', v_removed,
    -- Named so a caller can print it: until this is empty, a pull will differ
    -- from the file that was pushed.
    'extra', v_extra
  );
end;
$function$;

comment on function public.agentos_apply_project_config(uuid, uuid, jsonb, boolean) is
  'Applies an agentos.yml document. Adds and updates only; deleting requires p_prune, and rows the file omits are otherwise reported as drift. Builtin templates and uninstalled repositories are refused.';

revoke all on function public.agentos_apply_project_config(uuid, uuid, jsonb, boolean)
  from public, anon, service_role;
grant execute on function public.agentos_apply_project_config(uuid, uuid, jsonb, boolean) to authenticated;
