-- Close three integrity gaps at the trusted database boundary:
--   1. detect opaque values assigned to generic sensitive environment keys;
--   2. bind every protected approval snapshot to its exact reserved change;
--   3. serialize project linking by stable tenant/repository identity.

create or replace function public.text_has_likely_secret(input_text text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  assignment_line text;
  assignment_match text[];
  credential_match text[];
  assignment_key text;
  assigned_value text;
begin
  if input_text is null then
    return false;
  end if;

  if input_text ~ '(?i)(-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sk_(live|test)_[A-Za-z0-9]{16,}|sb_secret_[A-Za-z0-9_-]{20,}|vercel_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})' then
    return true;
  end if;

  foreach assignment_line in array pg_catalog.regexp_split_to_array(input_text, E'\\r?\\n')
  loop
    assignment_match := pg_catalog.regexp_match(
      assignment_line,
      $assignment$^[[:space:]]*(?:(?:export[[:space:]]+)?(?:const|let|var)[[:space:]]+|export[[:space:]]+)?["']?([A-Z][A-Z0-9_]*)["']?[[:space:]]*[:=][[:space:]]*(.*)[[:space:]]*$assignment$,
      'i'
    );
    if assignment_match is null then
      continue;
    end if;

    assignment_key := pg_catalog.upper(
      pg_catalog.regexp_replace(assignment_match[1], '[^A-Z0-9]', '', 'gi')
    );
    if assignment_key not in (
      'ACCESSTOKEN',
      'APIKEY',
      'AUTHORIZATION',
      'BEARER',
      'CLIENTSECRET',
      'CREDENTIAL',
      'CREDENTIALS',
      'PASSWORD',
      'PASSWD',
      'PRIVATEKEY',
      'PRIVATEKEYBASE64',
      'REFRESHTOKEN',
      'SERVICEROLEKEY',
      'SIGNINGSECRET',
      'WEBHOOKSECRET'
    ) and assignment_key !~ '(PASSWORD|APIKEY|PRIVATEKEY|PRIVATEKEYBASE64|CREDENTIAL|SERVICEROLEKEY|SECRETACCESSKEY|SECRETKEY|SECRET|TOKEN)$'
      and assignment_key !~ '(URL|DSN)$' then
      continue;
    end if;

    assigned_value := pg_catalog.btrim(assignment_match[2], E' \t,;');
    assigned_value := pg_catalog.btrim(
      pg_catalog.regexp_replace(assigned_value, '[[:space:]]+#.*$', '')
    );
    if pg_catalog.char_length(assigned_value) >= 2
      and pg_catalog.left(assigned_value, 1) = pg_catalog.right(assigned_value, 1)
      and pg_catalog.left(assigned_value, 1) in ('"', '''') then
      assigned_value := pg_catalog.btrim(
        pg_catalog.substr(assigned_value, 2, pg_catalog.char_length(assigned_value) - 2)
      );
    end if;

    if assigned_value = '' then
      continue;
    end if;
    if assigned_value ~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}[:cntrl:]]+\}\}|\{\{[^{}[:cntrl:]]+\}\}|\[[[:space:]]*(REDACTED|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|NOT[-_ ]?SET|UNSET)[[:space:]]*\]|(YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)([-_ ][A-Z0-9]+)*|X{3,}|(process[.]env[.]|env[.])[A-Z_][A-Z0-9_]*)$' then
      continue;
    end if;

    if assignment_key ~ '(URL|DSN)$'
      and assignment_key not in (
        'ACCESSTOKEN', 'APIKEY', 'AUTHORIZATION', 'BEARER', 'CLIENTSECRET',
        'CREDENTIAL', 'CREDENTIALS', 'PASSWORD', 'PASSWD', 'PRIVATEKEY',
        'PRIVATEKEYBASE64', 'REFRESHTOKEN', 'SERVICEROLEKEY', 'SIGNINGSECRET',
        'WEBHOOKSECRET'
      )
      and assignment_key !~ '(PASSWORD|APIKEY|PRIVATEKEY|PRIVATEKEYBASE64|CREDENTIAL|SERVICEROLEKEY|SECRETACCESSKEY|SECRETKEY|SECRET|TOKEN)$' then
      credential_match := pg_catalog.regexp_match(
        assigned_value,
        '^[A-Z][A-Z0-9+.-]*://[^/:[:space:]@]+:([^@[:space:]]+)@[^[:space:]/]+',
        'i'
      );
      if credential_match is null
        or credential_match[1] ~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}[:cntrl:]]+\}\}|\{\{[^{}[:cntrl:]]+\}\}|(YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)([-_ ][A-Z0-9]+)*|X{3,})$' then
        continue;
      end if;
    end if;

    return true;
  end loop;

  -- Compact JSON/object literals can contain several assignments on one line,
  -- so inspect every quoted key/value pair instead of only the first line key.
  for assignment_match in
    select json_match
    from pg_catalog.regexp_matches(
      input_text,
      $json$["']([A-Z][A-Z0-9_]*)["'][[:space:]]*:[[:space:]]*(["'])([^"'[:cntrl:]]*)\2$json$,
      'gi'
    ) as json_match
  loop
    assignment_key := pg_catalog.upper(
      pg_catalog.regexp_replace(assignment_match[1], '[^A-Z0-9]', '', 'gi')
    );
    assigned_value := pg_catalog.btrim(assignment_match[3]);
    if assigned_value = ''
      or assigned_value ~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}[:cntrl:]]+\}\}|\{\{[^{}[:cntrl:]]+\}\}|(YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)([-_ ][A-Z0-9]+)*|X{3,})$' then
      continue;
    end if;
    if assignment_key in (
      'ACCESSTOKEN', 'APIKEY', 'AUTHORIZATION', 'BEARER', 'CLIENTSECRET',
      'CREDENTIAL', 'CREDENTIALS', 'PASSWORD', 'PASSWD', 'PRIVATEKEY',
      'PRIVATEKEYBASE64', 'REFRESHTOKEN', 'SERVICEROLEKEY', 'SIGNINGSECRET',
      'WEBHOOKSECRET'
    ) or assignment_key ~ '(PASSWORD|APIKEY|PRIVATEKEY|PRIVATEKEYBASE64|CREDENTIAL|SERVICEROLEKEY|SECRETACCESSKEY|SECRETKEY|SECRET|TOKEN)$' then
      return true;
    end if;
    if assignment_key ~ '(URL|DSN)$' then
      credential_match := pg_catalog.regexp_match(
        assigned_value,
        '^[A-Z][A-Z0-9+.-]*://[^/:[:space:]@]+:([^@[:space:]]+)@[^[:space:]/]+',
        'i'
      );
      if credential_match is not null
        and credential_match[1] !~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|X{3,})$' then
        return true;
      end if;
    end if;
  end loop;

  return false;
end;
$function$;

revoke all on function public.text_has_likely_secret(text)
  from public, anon, authenticated, service_role;
grant execute on function public.text_has_likely_secret(text)
  to authenticated;

comment on function public.text_has_likely_secret(text) is
  'Detects common plaintext credentials and non-placeholder generic PASSWORD, CLIENT_SECRET, and PRIVATE_KEY_BASE64 assignments.';

create or replace function public.validate_github_protected_change_approval_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  change_record public.github_change_requests%rowtype;
begin
  select request.*
  into change_record
  from public.github_change_requests request
  where request.id = new.change_request_id
    and request.organization_id = new.organization_id
  for key share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'protected approval has no tenant-bound change request';
  end if;

  if change_record.project_id is distinct from new.project_id
    or change_record.connection_id is distinct from new.connection_id
    or change_record.repository_id is distinct from new.repository_id
    or change_record.path is distinct from new.path
    or change_record.content_sha256 is distinct from new.content_sha256
    or change_record.expected_blob_sha is distinct from new.expected_blob_sha
    or change_record.base_branch is distinct from new.base_branch
    or change_record.created_by is distinct from new.requester_user_id
    or new.requester_user_id is distinct from new.approver_user_id
    or new.approver_user_id is distinct from new.executor_user_id then
    raise exception using
      errcode = '23514',
      message = 'protected approval snapshot does not match its change request';
  end if;

  if change_record.status <> 'reserved'
    or change_record.provider_execution_started_at is not null
    or change_record.head_branch is not null
    or change_record.commit_sha is not null
    or change_record.commit_url is not null
    or change_record.external_pull_request_id is not null
    or change_record.pull_request_number is not null
    or change_record.pull_request_url is not null then
    raise exception using
      errcode = '55000',
      message = 'protected approval must precede provider execution';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_github_protected_change_approval_snapshot()
  from public, anon, authenticated, service_role;

create trigger github_protected_change_approvals_validate_snapshot
  before insert on public.github_protected_change_approvals
  for each row execute function public.validate_github_protected_change_approval_snapshot();

create or replace function public.begin_github_change_provider_execution(
  p_request_id uuid,
  p_execution_nonce uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  change_record public.github_change_requests%rowtype;
  approval_record public.github_protected_change_approvals%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select request.*
  into strict change_record
  from public.github_change_requests request
  where request.id = p_request_id
  for update;

  if change_record.created_by <> caller_id
    or change_record.execution_nonce <> p_execution_nonce
    or not exists (
      select 1
      from public.organization_members member
      where member.organization_id = change_record.organization_id
        and member.user_id = caller_id
        and member.role in (
          'owner'::public.organization_member_role,
          'admin'::public.organization_member_role
        )
    ) then
    raise exception using errcode = '42501', message = 'change execution is not authorized';
  end if;
  if change_record.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'change request is not reserved';
  end if;

  select approval.*
  into approval_record
  from public.github_protected_change_approvals approval
  where approval.change_request_id = change_record.id;

  if found then
    if approval_record.organization_id is distinct from change_record.organization_id
      or approval_record.project_id is distinct from change_record.project_id
      or approval_record.connection_id is distinct from change_record.connection_id
      or approval_record.repository_id is distinct from change_record.repository_id
      or approval_record.path is distinct from change_record.path
      or approval_record.content_sha256 is distinct from change_record.content_sha256
      or approval_record.expected_blob_sha is distinct from change_record.expected_blob_sha
      or approval_record.base_branch is distinct from change_record.base_branch
      or approval_record.requester_user_id is distinct from change_record.created_by
      or approval_record.approver_user_id is distinct from caller_id
      or approval_record.executor_user_id is distinct from caller_id then
      raise exception using
        errcode = '23514',
        message = 'protected approval snapshot does not match provider execution intent';
    end if;
    if approval_record.expires_at <= statement_timestamp() then
      raise exception using errcode = '55000', message = 'protected change approval expired before provider execution';
    end if;
  end if;

  if change_record.reservation_expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'change reservation expired before provider execution';
  end if;
  if change_record.head_branch is not null
    or change_record.commit_sha is not null
    or change_record.commit_url is not null
    or change_record.external_pull_request_id is not null
    or change_record.pull_request_number is not null
    or change_record.pull_request_url is not null then
    raise exception using errcode = '55000', message = 'provider evidence already exists';
  end if;

  if change_record.provider_execution_started_at is null then
    update public.github_change_requests request
    set provider_execution_started_at = statement_timestamp()
    where request.id = change_record.id;

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
      'GitHub change entered provider execution boundary',
      pg_catalog.jsonb_build_object(
        'github_event_type', 'github.change_provider_execution_started',
        'status', 'reserved'
      )
    );
  end if;

  return true;
end;
$function$;

revoke all on function public.begin_github_change_provider_execution(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_github_change_provider_execution(uuid, uuid)
  to authenticated;

create or replace function public.reserve_owner_approved_protected_github_change(
  p_organization_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_repository_id uuid,
  p_idempotency_key text,
  p_execution_nonce uuid,
  p_content_sha256 text,
  p_path text,
  p_expected_blob_sha text,
  p_base_branch text,
  p_title text,
  p_commit_message text,
  p_confirmation_text text,
  p_rationale text,
  p_rollback_plan text
)
returns setof public.github_change_requests
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  decision_time timestamptz := statement_timestamp();
  change_record public.github_change_requests%rowtype;
  approval_record public.github_protected_change_approvals%rowtype;
  existing_approval public.github_protected_change_approvals%rowtype;
  approval_created boolean := false;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = caller_id
      and member.role = 'owner'::public.organization_member_role
  ) then
    raise exception using
      errcode = '42501',
      message = 'an active organization owner must approve this protected change';
  end if;

  if p_confirmation_text is distinct from ('APPROVE RED DRAFT PR FOR ' || p_path) then
    raise exception using errcode = '22023', message = 'protected change confirmation does not match';
  end if;
  if p_rationale is null
    or char_length(p_rationale) not between 20 and 500
    or p_rationale <> btrim(p_rationale)
    or public.text_has_likely_secret(p_rationale) then
    raise exception using errcode = '22023', message = 'protected change rationale is invalid';
  end if;
  if p_rollback_plan is null
    or char_length(p_rollback_plan) not between 20 and 500
    or p_rollback_plan <> btrim(p_rollback_plan)
    or public.text_has_likely_secret(p_rollback_plan) then
    raise exception using errcode = '22023', message = 'protected change rollback plan is invalid';
  end if;

  select request.*
  into strict change_record
  from public.reserve_github_change_request(
    p_organization_id,
    p_project_id,
    p_connection_id,
    p_repository_id,
    p_idempotency_key,
    p_execution_nonce,
    p_content_sha256,
    p_path,
    p_expected_blob_sha,
    p_base_branch,
    p_title,
    p_commit_message
  ) request;

  -- reserve_github_change_request intentionally returns an existing key. Do
  -- not attach approval evidence until every returned field and its creator
  -- have been proven to be the exact requested intent.
  if change_record.organization_id is distinct from p_organization_id
    or change_record.project_id is distinct from p_project_id
    or change_record.connection_id is distinct from p_connection_id
    or change_record.repository_id is distinct from p_repository_id
    or change_record.idempotency_key is distinct from p_idempotency_key
    or change_record.content_sha256 is distinct from p_content_sha256
    or change_record.path is distinct from p_path
    or change_record.expected_blob_sha is distinct from p_expected_blob_sha
    or change_record.base_branch is distinct from p_base_branch
    or change_record.title is distinct from p_title
    or change_record.commit_message is distinct from p_commit_message
    or change_record.created_by is distinct from caller_id then
    raise exception using
      errcode = '23505',
      message = 'idempotency key was already used for a different protected change intent';
  end if;

  select approval.*
  into existing_approval
  from public.github_protected_change_approvals approval
  where approval.change_request_id = change_record.id;

  if found then
    approval_record := existing_approval;
  else
    if change_record.status <> 'reserved'
      or change_record.provider_execution_started_at is not null
      or change_record.head_branch is not null
      or change_record.commit_sha is not null
      or change_record.commit_url is not null
      or change_record.external_pull_request_id is not null
      or change_record.pull_request_number is not null
      or change_record.pull_request_url is not null then
      raise exception using
        errcode = '55000',
        message = 'protected approval cannot be attached after provider execution';
    end if;

    insert into public.github_protected_change_approvals (
      change_request_id,
      organization_id,
      project_id,
      connection_id,
      repository_id,
      path,
      content_sha256,
      expected_blob_sha,
      base_branch,
      requester_user_id,
      approver_user_id,
      executor_user_id,
      confirmation_text,
      rationale,
      rollback_plan,
      requested_at,
      decided_at,
      expires_at
    ) values (
      change_record.id,
      p_organization_id,
      p_project_id,
      p_connection_id,
      p_repository_id,
      p_path,
      p_content_sha256,
      p_expected_blob_sha,
      p_base_branch,
      caller_id,
      caller_id,
      caller_id,
      p_confirmation_text,
      p_rationale,
      p_rollback_plan,
      decision_time,
      decision_time,
      decision_time + interval '15 minutes'
    )
    on conflict (change_request_id) do nothing
    returning * into approval_record;

    approval_created := found;
    if not approval_created then
      select approval.*
      into strict approval_record
      from public.github_protected_change_approvals approval
      where approval.change_request_id = change_record.id;
    end if;
  end if;

  if approval_record.organization_id is distinct from p_organization_id
    or approval_record.project_id is distinct from p_project_id
    or approval_record.connection_id is distinct from p_connection_id
    or approval_record.repository_id is distinct from p_repository_id
    or approval_record.path is distinct from p_path
    or approval_record.content_sha256 is distinct from p_content_sha256
    or approval_record.expected_blob_sha is distinct from p_expected_blob_sha
    or approval_record.base_branch is distinct from p_base_branch
    or approval_record.requester_user_id is distinct from caller_id
    or approval_record.approver_user_id is distinct from caller_id
    or approval_record.executor_user_id is distinct from caller_id
    or approval_record.confirmation_text is distinct from p_confirmation_text
    or approval_record.rationale is distinct from p_rationale
    or approval_record.rollback_plan is distinct from p_rollback_plan then
    raise exception using
      errcode = '23505',
      message = 'idempotency key was already used for a different protected approval';
  end if;

  if approval_created then
    insert into public.activity_events (
      organization_id,
      project_id,
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      description,
      metadata,
      occurred_at
    ) values
    (
      p_organization_id,
      p_project_id,
      caller_id,
      'approval.requested'::public.activity_event_type,
      'github_protected_change_approval',
      approval_record.id,
      'RED protected GitHub draft change approval requested',
      pg_catalog.jsonb_build_object(
        'approval_id', approval_record.id,
        'change_request_id', change_record.id,
        'risk', 'red',
        'status', 'pending'
      ),
      decision_time
    ),
    (
      p_organization_id,
      p_project_id,
      caller_id,
      'approval.decided'::public.activity_event_type,
      'github_protected_change_approval',
      approval_record.id,
      'RED protected GitHub draft change approved by owner',
      pg_catalog.jsonb_build_object(
        'approval_id', approval_record.id,
        'change_request_id', change_record.id,
        'decision', 'approved',
        'expires_at', approval_record.expires_at,
        'risk', 'red'
      ),
      decision_time
    );
  end if;

  if approval_record.expires_at <= statement_timestamp()
    and change_record.status = 'reserved' then
    raise exception using errcode = '55000', message = 'protected change approval expired';
  end if;

  return next change_record;
  return;
end;
$function$;

revoke all on function public.reserve_owner_approved_protected_github_change(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text,
  text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_owner_approved_protected_github_change(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text,
  text, text, text
) to authenticated;

-- Refuse to install the serialized linking boundary over already-ambiguous
-- active data. Archived projects intentionally do not occupy the repository.
do $migration$
begin
  if exists (
    select 1
    from public.project_connections link
    join public.projects project
      on project.id = link.project_id
     and project.organization_id = link.organization_id
    where link.github_repository_id is not null
      and project.status <> 'archived'::public.project_status
    group by link.organization_id, link.github_repository_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'multiple non-archived projects are linked to one GitHub repository';
  end if;
end;
$migration$;

create or replace function public.connect_github_project(
  p_organization_id uuid,
  p_connection_id uuid,
  p_external_repository_id bigint,
  p_name text,
  p_description text default null,
  p_default_branch text default null
)
returns table (
  project_id uuid,
  project_name text,
  github_repository text,
  default_branch text,
  project_status public.project_status,
  connection_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  repository_record record;
  created_project public.projects%rowtype;
  resolved_branch text;
  expected_branch text := nullif(btrim(coalesce(p_default_branch, '')), '');
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner or administrator access is required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'project name is invalid';
  end if;

  select
    repository.id,
    repository.full_name,
    repository.default_branch,
    installation.status as installation_status,
    installation.suspended_at,
    installation.deleted_at,
    repository.archived,
    repository.disabled,
    repository.selected
  into repository_record
  from public.github_repositories repository
  join public.github_installations installation
    on installation.id = repository.installation_id
   and installation.organization_id = repository.organization_id
  join public.connections connection
    on connection.id = installation.connection_id
   and connection.organization_id = installation.organization_id
  where repository.organization_id = p_organization_id
    and installation.connection_id = p_connection_id
    and repository.external_repository_id = p_external_repository_id
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status;

  if not found then
    raise exception using errcode = 'P0002', message = 'selected GitHub repository was not found';
  end if;

  -- A stable tenant/repository lock makes the active-link check and inserts one
  -- serial operation without preventing archived projects from being relinked.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || repository_record.id::text,
      0
    )
  );

  -- Refresh mutable provider state after waiting for the advisory lock.
  select
    repository.id,
    repository.full_name,
    repository.default_branch,
    installation.status as installation_status,
    installation.suspended_at,
    installation.deleted_at,
    repository.archived,
    repository.disabled,
    repository.selected
  into strict repository_record
  from public.github_repositories repository
  join public.github_installations installation
    on installation.id = repository.installation_id
   and installation.organization_id = repository.organization_id
  join public.connections connection
    on connection.id = installation.connection_id
   and connection.organization_id = installation.organization_id
  where repository.id = repository_record.id
    and repository.organization_id = p_organization_id
    and installation.connection_id = p_connection_id
    and repository.external_repository_id = p_external_repository_id
    and connection.provider = 'github'::public.connection_provider
    and connection.status = 'connected'::public.connection_status;

  if repository_record.installation_status <> 'active'
    or repository_record.suspended_at is not null
    or repository_record.deleted_at is not null
    or not repository_record.selected
    or repository_record.archived
    or repository_record.disabled then
    raise exception using errcode = '55000', message = 'selected GitHub repository is not available';
  end if;

  if exists (
    select 1
    from public.project_connections link
    join public.projects project
      on project.id = link.project_id
     and project.organization_id = link.organization_id
    where link.organization_id = p_organization_id
      and link.github_repository_id = repository_record.id
      and project.status <> 'archived'::public.project_status
  ) then
    raise exception using
      errcode = '23505',
      message = 'GitHub repository is already linked to a non-archived project';
  end if;

  if expected_branch is not null
    and expected_branch is distinct from repository_record.default_branch then
    raise exception using errcode = '40001', message = 'repository default branch changed; reload before connecting the project';
  end if;
  resolved_branch := repository_record.default_branch;
  if char_length(resolved_branch) not between 1 and 255 or resolved_branch ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'synchronized repository default branch is invalid';
  end if;

  insert into public.projects (
    organization_id,
    name,
    description,
    status,
    github_repository,
    default_branch,
    created_by
  ) values (
    p_organization_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    'active'::public.project_status,
    repository_record.full_name,
    resolved_branch,
    caller_id
  )
  returning * into created_project;

  insert into public.project_connections (
    organization_id,
    project_id,
    connection_id,
    github_repository_id,
    is_primary,
    created_by
  ) values (
    p_organization_id,
    created_project.id,
    p_connection_id,
    repository_record.id,
    true,
    caller_id
  );

  return query
  select
    created_project.id,
    created_project.name,
    created_project.github_repository,
    created_project.default_branch,
    created_project.status,
    p_connection_id;
end;
$function$;

revoke all on function public.connect_github_project(uuid, uuid, bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_github_project(uuid, uuid, bigint, text, text, text)
  to authenticated;

comment on function public.connect_github_project(uuid, uuid, bigint, text, text, text) is
  'Serializes stable repository linking, permits relinking only after every prior project for the repository is archived, and persists synchronized provider metadata.';
