-- Make every terminal GitHub file-change transition attributable and auditable.
-- This migration does not widen repository permissions or add merge/deploy behavior.

create or replace function public.complete_github_change_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_head_branch text,
  p_commit_sha text,
  p_commit_url text,
  p_pull_request_id bigint,
  p_pull_request_number integer,
  p_pull_request_title text,
  p_pull_request_url text
)
returns table (
  change_request_id uuid,
  pull_request_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := p_actor_user_id;
  change_record public.github_change_requests%rowtype;
  project_record public.projects%rowtype;
  repository_record public.github_repositories%rowtype;
  pull_request_record_id uuid;
  previous_claim_sub text;
begin
  select * into change_record
  from public.github_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'GitHub change request was not found';
  end if;
  if caller_id is null or not exists (
    select 1
    from public.projects project
    join public.organization_members member on member.organization_id = project.organization_id
    where project.id = change_record.project_id
      and member.user_id = caller_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'project owner or administrator access is required';
  end if;
  if change_record.status = 'completed' then
    select id into pull_request_record_id
    from public.pull_requests
    where project_id = change_record.project_id
      and external_number = change_record.pull_request_number;
    return query select change_record.id, pull_request_record_id;
    return;
  end if;
  if change_record.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'GitHub change request is not active';
  end if;

  select * into project_record from public.projects where id = change_record.project_id;
  select * into repository_record from public.github_repositories where id = change_record.repository_id;
  if repository_record.id is null
    or lower(project_record.github_repository) <> lower(repository_record.full_name)
    or change_record.connection_id <> (
      select installation.connection_id
      from public.github_installations installation
      where installation.id = repository_record.installation_id
    ) then
    raise exception using errcode = '23514', message = 'GitHub change request target is inconsistent';
  end if;

  update public.github_change_requests
  set status = 'completed',
      head_branch = p_head_branch,
      commit_sha = lower(p_commit_sha),
      commit_url = p_commit_url,
      external_pull_request_id = p_pull_request_id,
      pull_request_number = p_pull_request_number,
      pull_request_url = p_pull_request_url,
      completed_at = now(),
      error_code = null
  where id = change_record.id;

  -- The pull-request audit trigger uses auth.uid(). This RPC is invoked by the
  -- server-only service role, so temporarily bind the already-authorized actor
  -- for this transaction and restore the original claim immediately afterward.
  previous_claim_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', caller_id::text, true);
  begin
    insert into public.pull_requests (
      organization_id,
      project_id,
      repository,
      external_number,
      title,
      url,
      head_branch,
      base_branch,
      status,
      risk_level,
      opened_at
    ) values (
      change_record.organization_id,
      change_record.project_id,
      project_record.github_repository,
      p_pull_request_number,
      p_pull_request_title,
      p_pull_request_url,
      p_head_branch,
      change_record.base_branch,
      'draft'::public.pull_request_status,
      'yellow'::public.risk_level,
      now()
    )
    on conflict (project_id, repository, external_number) do update set
      title = excluded.title,
      url = excluded.url,
      head_branch = excluded.head_branch,
      base_branch = excluded.base_branch,
      status = 'draft'::public.pull_request_status,
      updated_at = now()
    returning id into pull_request_record_id;
  exception when others then
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      coalesce(previous_claim_sub, ''),
      true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    coalesce(previous_claim_sub, ''),
    true
  );

  insert into public.activity_events (
    organization_id,
    project_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    change_record.organization_id,
    change_record.project_id,
    caller_id,
    'project.updated'::public.activity_event_type,
    'github_change_request',
    change_record.id,
    'GitHub change request completed with a draft pull request',
    pg_catalog.jsonb_build_object(
      'status', 'completed',
      'repository_id', change_record.repository_id,
      'head_branch', p_head_branch,
      'commit_sha', lower(p_commit_sha),
      'pull_request_number', p_pull_request_number,
      'draft', true
    )
  );

  return query select change_record.id, pull_request_record_id;
end;
$function$;

create or replace function public.fail_github_change_request_with_evidence(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_error_code text,
  p_head_branch text,
  p_commit_sha text,
  p_commit_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  change_record public.github_change_requests%rowtype;
begin
  if p_error_code !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception using errcode = '22023', message = 'error code is invalid';
  end if;
  if p_head_branch is not null and (
    char_length(btrim(p_head_branch)) not between 1 and 255
    or p_head_branch ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'head branch evidence is invalid';
  end if;
  if p_commit_sha is not null and p_commit_sha !~ '^[0-9a-fA-F]{40,64}$' then
    raise exception using errcode = '22023', message = 'commit SHA evidence is invalid';
  end if;
  if p_commit_url is not null and p_commit_url !~ '^https://github\.com/' then
    raise exception using errcode = '22023', message = 'commit URL evidence is invalid';
  end if;

  select * into change_record
  from public.github_change_requests
  where id = p_request_id
  for update;
  if not found then
    return false;
  end if;
  if p_actor_user_id is null or not exists (
    select 1
    from public.projects project
    join public.organization_members member on member.organization_id = project.organization_id
    where project.id = change_record.project_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner'::public.organization_member_role, 'admin'::public.organization_member_role)
  ) then
    raise exception using errcode = '42501', message = 'project owner or administrator access is required';
  end if;
  if change_record.status <> 'reserved' then
    return true;
  end if;

  update public.github_change_requests
  set status = 'failed',
      error_code = p_error_code,
      head_branch = coalesce(p_head_branch, head_branch),
      commit_sha = coalesce(lower(p_commit_sha), commit_sha),
      commit_url = coalesce(p_commit_url, commit_url)
  where id = p_request_id;

  insert into public.activity_events (
    organization_id,
    project_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    change_record.organization_id,
    change_record.project_id,
    p_actor_user_id,
    'project.updated'::public.activity_event_type,
    'github_change_request',
    change_record.id,
    'GitHub change request failed before draft pull request completion',
    pg_catalog.jsonb_build_object(
      'status', 'failed',
      'error_code', p_error_code,
      'repository_id', change_record.repository_id,
      'head_branch', p_head_branch,
      'commit_sha', lower(p_commit_sha)
    )
  );

  return true;
end;
$function$;

-- Preserve the original server-only RPC signature for callers that have no
-- partial provider evidence while still guaranteeing a failed audit event.
create or replace function public.fail_github_change_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  return public.fail_github_change_request_with_evidence(
    p_actor_user_id,
    p_request_id,
    p_error_code,
    null,
    null,
    null
  );
end;
$function$;

revoke all on function public.complete_github_change_request(uuid, uuid, text, text, text, bigint, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_github_change_request(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_github_change_request_with_evidence(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_github_change_request(uuid, uuid, text, text, text, bigint, integer, text, text)
  to service_role;
grant execute on function public.fail_github_change_request(uuid, uuid, text)
  to service_role;
grant execute on function public.fail_github_change_request_with_evidence(uuid, uuid, text, text, text, text)
  to service_role;

comment on function public.complete_github_change_request(uuid, uuid, text, text, text, bigint, integer, text, text) is
  'Records an isolated branch/commit/draft PR and emits actor-attributed immutable pull-request and GitHub change-request evidence. It cannot merge.';
comment on function public.fail_github_change_request_with_evidence(uuid, uuid, text, text, text, text) is
  'Fails a reserved GitHub change request, persists bounded branch/commit evidence when known, and emits an actor-attributed immutable event.';
