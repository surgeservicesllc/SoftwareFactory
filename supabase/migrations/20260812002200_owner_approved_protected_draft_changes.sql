-- Protected repository files require an explicit, short-lived owner decision.
-- This migration records the exact RED intent before any provider write. The
-- record is deliberately not a generic JSON approval: every authorized field
-- is typed, bounded, tenant-bound, and immutable.

-- Reservations receive a short lease so a process crash before the first
-- provider write cannot strand an idempotency key forever. Reclamation is a
-- separate exact-intent RPC below and is forbidden once any provider evidence
-- has been recorded.
alter table public.github_change_requests
  add column reservation_expires_at timestamptz,
  add column provider_execution_started_at timestamptz;

update public.github_change_requests
set reservation_expires_at = coalesce(updated_at, created_at) + interval '5 minutes';

alter table public.github_change_requests
  alter column reservation_expires_at set default (now() + interval '5 minutes'),
  alter column reservation_expires_at set not null;

alter table public.github_change_requests
  add constraint github_change_requests_reservation_expiry_valid
  check (reservation_expires_at > created_at),
  add constraint github_change_requests_provider_execution_timing
  check (
    provider_execution_started_at is null
    or provider_execution_started_at >= created_at
  );

create table public.github_protected_change_approvals (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  connection_id uuid not null,
  repository_id uuid not null,
  path text not null check (
    char_length(path) between 1 and 1024
    and path = btrim(path)
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '^/|/$|//|[[:cntrl:]]'
    and pg_catalog.strpos(path, E'\\') = 0
  ),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  expected_blob_sha text not null check (expected_blob_sha ~ '^[0-9a-f]{40,64}$'),
  base_branch text not null check (
    char_length(base_branch) between 1 and 255
    and base_branch = btrim(base_branch)
    and base_branch !~ '[[:cntrl:]]'
  ),
  risk_classification public.risk_level not null default 'red'::public.risk_level
    check (risk_classification = 'red'::public.risk_level),
  provider_action text not null default 'draft_pull_request'
    check (provider_action = 'draft_pull_request'),
  default_branch_write_allowed boolean not null default false
    check (not default_branch_write_allowed),
  merge_allowed boolean not null default false check (not merge_allowed),
  deploy_allowed boolean not null default false check (not deploy_allowed),
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  approver_user_id uuid not null references auth.users(id) on delete restrict,
  executor_user_id uuid not null references auth.users(id) on delete restrict,
  confirmation_text text not null check (
    confirmation_text = 'APPROVE RED DRAFT PR FOR ' || path
  ),
  rationale text not null check (
    char_length(rationale) between 20 and 500
    and rationale = btrim(rationale)
    and not public.text_has_likely_secret(rationale)
  ),
  rollback_plan text not null check (
    char_length(rollback_plan) between 20 and 500
    and rollback_plan = btrim(rollback_plan)
    and not public.text_has_likely_secret(rollback_plan)
  ),
  requested_at timestamptz not null,
  decided_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint github_protected_change_approvals_change_unique unique (change_request_id),
  constraint github_protected_change_approvals_change_fk
    foreign key (change_request_id, organization_id)
    references public.github_change_requests(id, organization_id) on delete restrict,
  constraint github_protected_change_approvals_project_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint github_protected_change_approvals_connection_fk
    foreign key (connection_id, organization_id)
    references public.connections(id, organization_id) on delete restrict,
  constraint github_protected_change_approvals_repository_fk
    foreign key (repository_id, organization_id)
    references public.github_repositories(id, organization_id) on delete restrict,
  constraint github_protected_change_approvals_decision_timing check (
    decided_at >= requested_at
    and expires_at > decided_at
    and expires_at <= requested_at + interval '15 minutes'
  ),
  constraint github_protected_change_approvals_same_owner check (
    requester_user_id = approver_user_id
    and approver_user_id = executor_user_id
  )
);

create index github_protected_change_approvals_org_time_idx
  on public.github_protected_change_approvals (organization_id, requested_at desc);

create or replace function public.reject_github_protected_change_approval_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'protected GitHub change approvals are immutable';
end;
$function$;

revoke all on function public.reject_github_protected_change_approval_mutation()
  from public, anon, authenticated, service_role;

create trigger github_protected_change_approvals_append_only
  before update or delete on public.github_protected_change_approvals
  for each row execute function public.reject_github_protected_change_approval_mutation();

alter table public.github_protected_change_approvals enable row level security;
alter table public.github_protected_change_approvals force row level security;

create policy github_protected_change_approvals_select_owners
  on public.github_protected_change_approvals
  for select
  to authenticated
  using (public.is_organization_owner(organization_id));

revoke all on table public.github_protected_change_approvals
  from public, anon, authenticated, service_role;
grant select on table public.github_protected_change_approvals to authenticated;

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
  if exists (
    select 1
    from public.github_protected_change_approvals approval
    where approval.change_request_id = change_record.id
      and approval.expires_at <= statement_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'protected change approval expired before provider execution';
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

create or replace function public.reclaim_expired_github_change_reservation(
  p_organization_id uuid,
  p_request_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_repository_id uuid,
  p_idempotency_key text,
  p_expected_execution_nonce uuid,
  p_new_execution_nonce uuid,
  p_content_sha256 text,
  p_path text,
  p_expected_blob_sha text,
  p_base_branch text,
  p_title text,
  p_commit_message text
)
returns setof public.github_change_requests
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  change_record public.github_change_requests%rowtype;
  approval_expiry timestamptz;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = caller_id
      and member.role in (
        'owner'::public.organization_member_role,
        'admin'::public.organization_member_role
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  select request.*
  into strict change_record
  from public.github_change_requests request
  where request.id = p_request_id
    and request.organization_id = p_organization_id
  for update;

  if change_record.created_by <> caller_id
    or change_record.project_id <> p_project_id
    or change_record.connection_id <> p_connection_id
    or change_record.repository_id <> p_repository_id
    or change_record.idempotency_key <> p_idempotency_key
    or change_record.execution_nonce <> p_expected_execution_nonce
    or change_record.content_sha256 <> p_content_sha256
    or change_record.path <> p_path
    or change_record.expected_blob_sha <> p_expected_blob_sha
    or change_record.base_branch <> p_base_branch
    or change_record.title <> p_title
    or change_record.commit_message <> p_commit_message then
    raise exception using
      errcode = '23505',
      message = 'reservation reclaim does not match the exact original intent';
  end if;
  if change_record.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'only a reserved change can be reclaimed';
  end if;
  if change_record.reservation_expires_at > statement_timestamp() then
    raise exception using errcode = '55000', message = 'change reservation is still active';
  end if;
  if change_record.head_branch is not null
    or change_record.provider_execution_started_at is not null
    or change_record.commit_sha is not null
    or change_record.commit_url is not null
    or change_record.external_pull_request_id is not null
    or change_record.pull_request_number is not null
    or change_record.pull_request_url is not null then
    raise exception using
      errcode = '55000',
      message = 'a change with provider evidence cannot be reclaimed';
  end if;
  if p_new_execution_nonce is null
    or p_new_execution_nonce = p_expected_execution_nonce then
    raise exception using errcode = '22023', message = 'a new execution nonce is required';
  end if;

  select approval.expires_at
  into approval_expiry
  from public.github_protected_change_approvals approval
  where approval.change_request_id = change_record.id;
  if approval_expiry is not null and approval_expiry <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'protected change approval expired before reservation reclaim';
  end if;

  update public.github_change_requests request
  set execution_nonce = p_new_execution_nonce,
      reservation_expires_at = case
        when approval_expiry is null then statement_timestamp() + interval '5 minutes'
        else least(statement_timestamp() + interval '5 minutes', approval_expiry)
      end
  where request.id = change_record.id
  returning request.* into strict change_record;

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
    'Expired GitHub change reservation safely reclaimed',
    pg_catalog.jsonb_build_object(
      'github_event_type', 'github.change_reservation_reclaimed',
      'status', 'reserved'
    )
  );

  return next change_record;
  return;
end;
$function$;

revoke all on function public.reclaim_expired_github_change_reservation(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.reclaim_expired_github_change_reservation(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  text, text
) to authenticated;

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

  -- The existing reservation boundary revalidates every live tenant, project,
  -- connection, installation, repository, branch, digest, and metadata field.
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

  if not found then
    select approval.*
    into strict existing_approval
    from public.github_protected_change_approvals approval
    where approval.change_request_id = change_record.id;

    if existing_approval.organization_id <> p_organization_id
      or existing_approval.project_id <> p_project_id
      or existing_approval.connection_id <> p_connection_id
      or existing_approval.repository_id <> p_repository_id
      or existing_approval.path <> p_path
      or existing_approval.content_sha256 <> p_content_sha256
      or existing_approval.expected_blob_sha <> p_expected_blob_sha
      or existing_approval.base_branch <> p_base_branch
      or existing_approval.requester_user_id <> caller_id
      or existing_approval.approver_user_id <> caller_id
      or existing_approval.executor_user_id <> caller_id
      or existing_approval.confirmation_text <> p_confirmation_text
      or existing_approval.rationale <> p_rationale
      or existing_approval.rollback_plan <> p_rollback_plan then
      raise exception using
        errcode = '23505',
        message = 'idempotency key was already used for a different protected approval';
    end if;
    approval_record := existing_approval;
  else
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

comment on table public.github_protected_change_approvals is
  'Immutable, owner-only evidence for an exact short-lived RED authorization to create a draft pull request. It never authorizes merge, deploy, or a default-branch write.';
comment on function public.begin_github_change_provider_execution(uuid, uuid) is
  'Marks the fail-closed boundary immediately before the first provider write. An execution-marked reservation can never be lease-reclaimed.';
comment on function public.reclaim_expired_github_change_reservation(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  text, text
) is
  'Reclaims an expired pre-provider reservation only for the original requester and exact immutable intent. Any branch, commit, or pull-request evidence permanently blocks reclamation.';
comment on function public.reserve_owner_approved_protected_github_change(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text, text, text,
  text, text, text
) is
  'Atomically reserves an exact protected-file change and records immutable requested/approved owner evidence before provider execution. It cannot call GitHub, merge, deploy, or write the default branch.';
