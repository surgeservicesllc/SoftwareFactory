-- Upsert newly granted repository metadata from a signed GitHub webhook before
-- the existing idempotent delivery processor records the selection change.
-- This service-role-only function stores metadata, never provider credentials.

create or replace function public.reconcile_github_repository_grants(
  p_organization_id uuid,
  p_installation_id uuid,
  p_repositories jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  installation_record public.github_installations%rowtype;
  repository_payload jsonb;
  reconciled_count integer := 0;
begin
  if p_organization_id is null or p_installation_id is null then
    raise exception using errcode = '22023', message = 'organization and installation are required';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_repositories, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_array_length(coalesce(p_repositories, '[]'::jsonb)) > 500 then
    raise exception using errcode = '22023', message = 'repository metadata must be a bounded array';
  end if;

  select * into installation_record
  from public.github_installations installation
  where installation.id = p_installation_id
    and installation.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'GitHub installation was not found';
  end if;
  if installation_record.status <> 'active' then
    raise exception using errcode = '55000', message = 'GitHub installation is not active';
  end if;

  for repository_payload in
    select value
    from pg_catalog.jsonb_array_elements(coalesce(p_repositories, '[]'::jsonb))
  loop
    if pg_catalog.jsonb_typeof(repository_payload) <> 'object'
      or public.jsonb_has_sensitive_keys(repository_payload) then
      raise exception using errcode = '22023', message = 'repository metadata is invalid';
    end if;

    insert into public.github_repositories (
      organization_id,
      installation_id,
      external_repository_id,
      node_id,
      owner_login,
      name,
      full_name,
      default_branch,
      html_url,
      private,
      visibility,
      archived,
      disabled,
      selected,
      permissions,
      github_updated_at,
      pushed_at,
      last_synced_at
    ) values (
      p_organization_id,
      p_installation_id,
      (repository_payload ->> 'id')::bigint,
      repository_payload ->> 'node_id',
      repository_payload ->> 'owner_login',
      repository_payload ->> 'name',
      repository_payload ->> 'full_name',
      repository_payload ->> 'default_branch',
      repository_payload ->> 'html_url',
      coalesce((repository_payload ->> 'private')::boolean, true),
      repository_payload ->> 'visibility',
      coalesce((repository_payload ->> 'archived')::boolean, false),
      coalesce((repository_payload ->> 'disabled')::boolean, false),
      true,
      coalesce(repository_payload -> 'permissions', '{}'::jsonb),
      (repository_payload ->> 'updated_at')::timestamptz,
      nullif(repository_payload ->> 'pushed_at', '')::timestamptz,
      now()
    )
    on conflict on constraint github_repositories_external_unique do update set
      node_id = excluded.node_id,
      owner_login = excluded.owner_login,
      name = excluded.name,
      full_name = excluded.full_name,
      default_branch = excluded.default_branch,
      html_url = excluded.html_url,
      private = excluded.private,
      visibility = excluded.visibility,
      archived = excluded.archived,
      disabled = excluded.disabled,
      selected = true,
      permissions = excluded.permissions,
      github_updated_at = excluded.github_updated_at,
      pushed_at = excluded.pushed_at,
      last_synced_at = now();
    reconciled_count := reconciled_count + 1;
  end loop;

  update public.github_installations
  set last_synced_at = now()
  where id = installation_record.id;

  return reconciled_count;
end;
$function$;

revoke all on function public.reconcile_github_repository_grants(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_github_repository_grants(uuid, uuid, jsonb)
  to service_role;

comment on function public.reconcile_github_repository_grants(uuid, uuid, jsonb) is
  'Reconciles bounded repository metadata from a verified installation_repositories webhook. Service-role only; stores no token or credential.';
