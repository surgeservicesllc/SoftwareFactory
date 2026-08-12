-- Recover the truthful terminal state when GitHub has already created a draft
-- pull request but the first database-completion call failed or its response
-- was lost. This does not add merge, deployment, or default-branch writes.

create or replace function public.recover_github_change_request_with_provider_evidence(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_recovery_reason text,
  p_head_branch text,
  p_commit_sha text,
  p_commit_url text,
  p_pull_request_id bigint,
  p_pull_request_number integer,
  p_pull_request_title text,
  p_pull_request_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  change_record public.github_change_requests%rowtype;
  project_record public.projects%rowtype;
  previous_claim_sub text;
begin
  if p_recovery_reason !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception using errcode = '22023', message = 'recovery reason is invalid';
  end if;
  if p_head_branch is null
    or char_length(btrim(p_head_branch)) not between 1 and 255
    or p_head_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'head branch evidence is invalid';
  end if;
  if p_commit_sha is null or p_commit_sha !~ '^[0-9a-fA-F]{40,64}$' then
    raise exception using errcode = '22023', message = 'commit SHA evidence is invalid';
  end if;
  if p_commit_url is null or p_commit_url !~ '^https://github\.com/' then
    raise exception using errcode = '22023', message = 'commit URL evidence is invalid';
  end if;
  if p_pull_request_id is null or p_pull_request_id <= 0
    or p_pull_request_number is null or p_pull_request_number <= 0
    or p_pull_request_title is null
    or char_length(btrim(p_pull_request_title)) not between 1 and 256
    or p_pull_request_title ~ '[[:cntrl:]]'
    or public.text_has_likely_secret(p_pull_request_title)
    or p_pull_request_url is null
    or p_pull_request_url !~ '^https://github\.com/' then
    raise exception using errcode = '22023', message = 'pull request evidence is invalid';
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
  if change_record.status = 'completed' then
    return true;
  end if;
  if change_record.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'GitHub change request is not recoverable';
  end if;

  select * into project_record
  from public.projects
  where id = change_record.project_id;
  if project_record.id is null then
    raise exception using errcode = '23514', message = 'GitHub change request project is missing';
  end if;

  update public.github_change_requests
  set status = 'completed',
      error_code = null,
      head_branch = p_head_branch,
      commit_sha = lower(p_commit_sha),
      commit_url = p_commit_url,
      external_pull_request_id = p_pull_request_id,
      pull_request_number = p_pull_request_number,
      pull_request_url = p_pull_request_url,
      completed_at = now()
  where id = change_record.id;

  -- Attribute the existing immutable pull-request trigger to the already
  -- authorized user even though this recovery RPC is server-only.
  previous_claim_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
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
      updated_at = now();
  exception when others then
    perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_claim_sub, ''), true);
    raise;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_claim_sub, ''), true);

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
    'GitHub change request completion recovered from provider evidence',
    pg_catalog.jsonb_build_object(
      'status', 'completed',
      'recovery_reason', p_recovery_reason,
      'repository_id', change_record.repository_id,
      'head_branch', p_head_branch,
      'commit_sha', lower(p_commit_sha),
      'pull_request_number', p_pull_request_number,
      'draft', true
    )
  );

  return true;
end;
$function$;

revoke all on function public.recover_github_change_request_with_provider_evidence(
  uuid, uuid, text, text, text, text, bigint, integer, text, text
) from public, anon, authenticated;
grant execute on function public.recover_github_change_request_with_provider_evidence(
  uuid, uuid, text, text, text, text, bigint, integer, text, text
) to service_role;

comment on function public.recover_github_change_request_with_provider_evidence(
  uuid, uuid, text, text, text, text, bigint, integer, text, text
) is 'Completes a reserved GitHub change request from actor-attributed branch, commit, and existing draft pull-request evidence after a lost/failed completion response. It cannot merge.';
