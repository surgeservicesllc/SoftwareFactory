-- AI accounts as a first-class domain, and the broker sessions that sign them in.
--
-- Until now a "connected Claude subscription" was a sealed credential row and a
-- bot pointing at an environment variable name. That works, but it leaves the
-- account itself implicit: nothing records which human sign-in produced the
-- credential, whether it still verifies, or which bots depend on it. Deleting
-- ambiguity is the point of this migration:
--
--   * `ai_accounts` is the identity: one row per provider sign-in, carrying
--     status, verification timestamps, and the vault purpose its credential
--     lives under. It stores no secret — the credential stays in
--     `provider_credentials`, sealed, linked only by (organization_id, purpose).
--   * `ai_auth_sessions` is the broker: the state machine a worker drives while
--     it runs the provider's real login on the operator's behalf. The browser
--     never sees a token and never runs a command; it watches this row change
--     state and, when the provider hands the person a confirmation code, posts
--     that code here (sealed) for the worker to collect.
--   * `bots.ai_account_id` ties execution to identity. Existing bots keep
--     working exactly as before — the column is nullable, and a null reads as
--     "no AI account attached" in the console rather than as breakage.
--
-- The session state machine, in the order a healthy sign-in walks it:
--
--   pending      the person clicked Connect; no worker has picked it up
--   initializing a worker claimed it and is starting the provider CLI
--   awaiting_user the CLI produced a login URL; the person is signing in
--   authenticated the person posted the provider's confirmation code back
--   verifying    the worker is checking the minted credential actually works
--   connected    the credential is sealed in the vault; the account is live
--
-- and the terminal failures: failed (worker error), expired (nobody finished
-- in time), revoked (superseded or cancelled). Every transition is made by a
-- narrow definer function that also writes an activity event, so the audit
-- trail is a side effect of the only way to move.

alter type public.activity_event_type add value if not exists 'ai_account.changed';

-- ---------------------------------------------------------------------------
-- The account
-- ---------------------------------------------------------------------------

create table public.ai_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.bot_provider not null,
  -- How this account authenticates. A subscription account is signed in by the
  -- broker below; an api_key account is configured by an operator and never
  -- opens a session.
  auth_method text not null default 'subscription'
    check (auth_method in ('subscription', 'api_key')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'needs_reauth', 'disconnected', 'revoked')),
  -- The vault purpose this account's credential is sealed under. The account
  -- row never holds the credential; it holds the name of the slot that does.
  credential_purpose text not null check (credential_purpose ~ '^[a-z][a-z0-9_]{1,62}$'),
  last_verified_at timestamptz,
  -- Worker- and probe-reported, human-readable, and shape-checked so a token
  -- pasted into an error message can never land here.
  last_error text check (
    last_error is null
    or (char_length(last_error) <= 500 and not public.text_has_likely_secret(last_error))
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,

  constraint ai_accounts_id_organization_unique unique (id, organization_id),
  constraint ai_accounts_display_name_unique unique (organization_id, display_name),
  -- One account per credential slot. Two accounts sharing a purpose would be
  -- two identities overwriting one credential — the collision this table
  -- exists to prevent.
  constraint ai_accounts_purpose_unique unique (organization_id, credential_purpose),
  constraint ai_accounts_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint ai_accounts_metadata_no_sensitive_data check (
    not public.jsonb_has_sensitive_keys(metadata)
  ),
  constraint ai_accounts_revocation_coherent check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

comment on table public.ai_accounts is
  'One row per provider sign-in. Holds identity and lifecycle only; the credential itself stays sealed in provider_credentials under credential_purpose.';

create index ai_accounts_organization_idx
  on public.ai_accounts (organization_id, provider);

-- ---------------------------------------------------------------------------
-- The broker session
-- ---------------------------------------------------------------------------

create table public.ai_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ai_account_id uuid not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'initializing', 'awaiting_user', 'authenticated',
      'verifying', 'connected', 'failed', 'expired', 'revoked'
    )),
  -- The provider's own login URL, captured from the CLI the worker runs. It is
  -- what the person's browser opens; it never carries a credential of ours.
  login_url text check (
    login_url is null
    or (login_url ~ '^https://' and char_length(login_url) <= 2048)
  ),
  -- The confirmation code the provider showed the person, sealed by the server
  -- before it is stored. Only the worker's definer function reads it back, and
  -- what it reads is still an envelope only the credential key opens.
  relay_code_sealed text check (
    relay_code_sealed is null
    or (
      char_length(relay_code_sealed) between 24 and 8192
      and relay_code_sealed ~ '^v[0-9]+\.'
      and not public.text_has_likely_secret(relay_code_sealed)
    )
  ),
  worker_id text check (
    worker_id is null or worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  ),
  claimed_at timestamptz,
  -- The worker's liveness signal while it holds this session. Honest staleness
  -- for the console: a session whose heartbeat stops is shown as stuck, not
  -- as quietly progressing.
  heartbeat_at timestamptz,
  failure_reason text check (
    failure_reason is null
    or (char_length(failure_reason) <= 500 and not public.text_has_likely_secret(failure_reason))
  ),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same-organization enforcement by construction rather than by trigger.
  constraint ai_auth_sessions_account_fk foreign key (ai_account_id, organization_id)
    references public.ai_accounts (id, organization_id) on delete cascade,
  -- A login is human-paced, so the ceiling is minutes rather than the vault
  -- code's ten — but it is still a ceiling, enforced here rather than trusted
  -- to the caller that inserts.
  constraint ai_auth_sessions_bounded_life check (
    expires_at > created_at and expires_at <= created_at + interval '30 minutes'
  ),
  constraint ai_auth_sessions_claim_coherent check (
    (claimed_at is null) = (worker_id is null)
  )
);

comment on table public.ai_auth_sessions is
  'Broker state machine for signing an AI account in. The browser watches status; the worker drives it; the sealed relay code is the only sensitive column and only a service-role definer function returns it.';

-- One live sign-in per account. Opening a new one revokes the old rather than
-- letting two workers race the same account's login.
create unique index ai_auth_sessions_one_open
  on public.ai_auth_sessions (ai_account_id)
  where status in ('pending', 'initializing', 'awaiting_user', 'authenticated', 'verifying');

-- The worker's claim scan: oldest unclaimed first, without walking terminals.
create index ai_auth_sessions_claimable_idx
  on public.ai_auth_sessions (created_at)
  where status = 'pending';

create index ai_auth_sessions_organization_idx
  on public.ai_auth_sessions (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Bots gain an identity reference
-- ---------------------------------------------------------------------------

alter table public.bots add column ai_account_id uuid;

-- NO ACTION rather than RESTRICT so an organization cascade, which removes
-- accounts and bots in the same statement, checks the constraint once at the
-- end instead of tripping over its own ordering.
alter table public.bots add constraint bots_ai_account_fk
  foreign key (ai_account_id, organization_id)
  references public.ai_accounts (id, organization_id);

comment on column public.bots.ai_account_id is
  'The AI account this bot executes as. Null means no account attached — legacy bots keep working and the console asks for an account rather than failing.';

create index bots_ai_account_idx
  on public.bots (ai_account_id)
  where ai_account_id is not null;

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------

alter table public.ai_accounts enable row level security;
alter table public.ai_accounts force row level security;
alter table public.ai_auth_sessions enable row level security;
alter table public.ai_auth_sessions force row level security;

-- No direct table access for any role. Reads go through projections below;
-- every mutation is a definer function that writes an activity event. FORCE
-- RLS means even the table owner is subject to this.
revoke all on table public.ai_accounts from anon, authenticated, service_role;
revoke all on table public.ai_auth_sessions from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading, for the console
-- ---------------------------------------------------------------------------

create or replace function public.list_ai_accounts(p_organization_id uuid)
returns table (
  account_id uuid,
  provider public.bot_provider,
  auth_method text,
  display_name text,
  status text,
  credential_purpose text,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select a.id, a.provider, a.auth_method, a.display_name, a.status,
         a.credential_purpose, a.last_verified_at, a.last_error,
         a.created_at, a.updated_at
  from public.ai_accounts a
  where a.organization_id = p_organization_id
  order by a.created_at;
end;
$function$;

revoke all on function public.list_ai_accounts(uuid) from public, anon, service_role;
grant execute on function public.list_ai_accounts(uuid) to authenticated;

-- The browser's polling view of a sign-in. The sealed relay code is not in the
-- returns clause, so no future edit to this body can leak it without also
-- changing the signature.
create or replace function public.read_ai_auth_session(
  p_organization_id uuid,
  p_session_id uuid
)
returns table (
  session_id uuid,
  session_account_id uuid,
  status text,
  login_url text,
  failure_reason text,
  heartbeat_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select s.id, s.ai_account_id, s.status, s.login_url, s.failure_reason,
         s.heartbeat_at, s.expires_at, s.updated_at
  from public.ai_auth_sessions s
  where s.organization_id = p_organization_id and s.id = p_session_id;
end;
$function$;

revoke all on function public.read_ai_auth_session(uuid, uuid) from public, anon, service_role;
grant execute on function public.read_ai_auth_session(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Owner-side lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_ai_account(
  p_organization_id uuid,
  p_provider public.bot_provider,
  p_auth_method text,
  p_display_name text,
  p_credential_purpose text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  -- An AI account changes what the factory can do with money and code, so this
  -- is a manage operation rather than a member one.
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to add an AI account';
  end if;

  insert into public.ai_accounts
    (organization_id, provider, auth_method, display_name, credential_purpose, created_by)
  values (
    p_organization_id, p_provider, p_auth_method, btrim(p_display_name),
    p_credential_purpose, v_actor
  )
  returning id into v_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_account', v_id,
    format('Added AI account %s', btrim(p_display_name)),
    pg_catalog.jsonb_build_object(
      'provider', p_provider::text,
      'auth_method', p_auth_method,
      'purpose', p_credential_purpose
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.create_ai_account(uuid, public.bot_provider, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_ai_account(uuid, public.bot_provider, text, text, text)
  to authenticated;

create or replace function public.open_ai_auth_session(
  p_organization_id uuid,
  p_ai_account_id uuid,
  p_ttl_seconds integer default 900
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_account record;
  v_id uuid;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to connect an AI account';
  end if;

  select * into v_account
  from public.ai_accounts a
  where a.id = p_ai_account_id and a.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'that AI account does not exist';
  end if;
  if v_account.status = 'revoked' then
    raise exception using errcode = '42501', message = 'a revoked AI account cannot be signed in';
  end if;
  if v_account.auth_method <> 'subscription' then
    raise exception using errcode = '22023',
      message = 'only subscription accounts sign in through the broker';
  end if;

  -- Clicking Connect twice must supersede the pending sign-in, not queue a
  -- second worker onto the same account.
  update public.ai_auth_sessions s
  set status = 'revoked', updated_at = now()
  where s.ai_account_id = p_ai_account_id
    and s.status in ('pending', 'initializing', 'awaiting_user', 'authenticated', 'verifying');

  insert into public.ai_auth_sessions
    (organization_id, ai_account_id, expires_at, created_by)
  values (
    p_organization_id, p_ai_account_id,
    now() + pg_catalog.make_interval(secs => least(greatest(p_ttl_seconds, 300), 1800)),
    v_actor
  )
  returning id into v_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_auth_session', v_id,
    format('Started sign-in for %s', v_account.display_name),
    pg_catalog.jsonb_build_object('ai_account_id', p_ai_account_id, 'purpose', v_account.credential_purpose)
  );

  return v_id;
end;
$function$;

revoke all on function public.open_ai_auth_session(uuid, uuid, integer)
  from public, anon, service_role;
grant execute on function public.open_ai_auth_session(uuid, uuid, integer) to authenticated;

-- The person finished the provider's login page and it showed a confirmation
-- code. The server seals that code and parks it here for the worker.
create or replace function public.attach_ai_auth_relay_code(
  p_organization_id uuid,
  p_session_id uuid,
  p_relay_code_sealed text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_session record;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to continue a sign-in';
  end if;

  select * into v_session
  from public.ai_auth_sessions s
  where s.id = p_session_id and s.organization_id = p_organization_id
  for update;

  if not found or v_session.status <> 'awaiting_user' or v_session.expires_at <= now() then
    return false;
  end if;

  update public.ai_auth_sessions
  set relay_code_sealed = p_relay_code_sealed, status = 'authenticated', updated_at = now()
  where id = p_session_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_auth_session', p_session_id,
    'Confirmation code received; completing sign-in',
    pg_catalog.jsonb_build_object('ai_account_id', v_session.ai_account_id)
  );

  return true;
end;
$function$;

revoke all on function public.attach_ai_auth_relay_code(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.attach_ai_auth_relay_code(uuid, uuid, text) to authenticated;

create or replace function public.disconnect_ai_account(
  p_organization_id uuid,
  p_ai_account_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_account record;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to disconnect an AI account';
  end if;

  select * into v_account
  from public.ai_accounts a
  where a.id = p_ai_account_id and a.organization_id = p_organization_id
  for update;

  if not found or v_account.status in ('disconnected', 'revoked') then
    return false;
  end if;

  update public.ai_auth_sessions s
  set status = 'revoked', updated_at = now()
  where s.ai_account_id = p_ai_account_id
    and s.status in ('pending', 'initializing', 'awaiting_user', 'authenticated', 'verifying');

  -- Disconnecting removes the sealed credential, not just the label. An
  -- account that says "disconnected" while its token still works would be the
  -- dishonest state this repository refuses.
  delete from public.provider_credentials c
  where c.organization_id = p_organization_id
    and c.purpose = v_account.credential_purpose;

  update public.ai_accounts
  set status = 'disconnected', updated_at = now()
  where id = p_ai_account_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_account', p_ai_account_id,
    format('Disconnected %s', v_account.display_name),
    pg_catalog.jsonb_build_object('purpose', v_account.credential_purpose)
  );

  return true;
end;
$function$;

revoke all on function public.disconnect_ai_account(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.disconnect_ai_account(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker-side lifecycle
-- ---------------------------------------------------------------------------
--
-- None of these are callable by a browser role. The worker holds the server's
-- privileged connection; the boundary that matters is the table grant, revoked
-- above — even holding the service-role key, these narrow functions are the
-- only way to touch a session.

create or replace function public.claim_ai_auth_session(p_worker_id text)
returns table (
  claimed_session_id uuid,
  claimed_organization_id uuid,
  claimed_account_id uuid,
  claimed_provider public.bot_provider,
  claimed_purpose text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
  v_account record;
begin
  select * into v_session
  from public.ai_auth_sessions s
  where s.status = 'pending' and s.expires_at > now()
  order by s.created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  select * into v_account from public.ai_accounts a where a.id = v_session.ai_account_id;

  update public.ai_auth_sessions
  set status = 'initializing', worker_id = p_worker_id,
      claimed_at = now(), heartbeat_at = now(), updated_at = now()
  where id = v_session.id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    v_session.organization_id, v_session.created_by, 'ai_account.changed',
    'ai_auth_session', v_session.id,
    format('A worker picked up the sign-in for %s', v_account.display_name),
    pg_catalog.jsonb_build_object('worker_id', p_worker_id)
  );

  return query select v_session.id, v_session.organization_id,
    v_account.id, v_account.provider, v_account.credential_purpose;
end;
$function$;

revoke all on function public.claim_ai_auth_session(text)
  from public, anon, authenticated;
grant execute on function public.claim_ai_auth_session(text) to service_role;

create or replace function public.report_ai_auth_login_url(
  p_session_id uuid,
  p_login_url text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
begin
  select * into v_session
  from public.ai_auth_sessions s
  where s.id = p_session_id
  for update;

  if not found or v_session.status <> 'initializing' or v_session.expires_at <= now() then
    return false;
  end if;

  update public.ai_auth_sessions
  set login_url = p_login_url, status = 'awaiting_user',
      heartbeat_at = now(), updated_at = now()
  where id = p_session_id;

  -- The URL itself stays out of the audit trail: it can carry provider state
  -- parameters that are nobody's business a year later.
  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    v_session.organization_id, v_session.created_by, 'ai_account.changed',
    'ai_auth_session', p_session_id,
    'Provider login is ready; waiting for the person to sign in',
    pg_catalog.jsonb_build_object('ai_account_id', v_session.ai_account_id)
  );

  return true;
end;
$function$;

revoke all on function public.report_ai_auth_login_url(uuid, text)
  from public, anon, authenticated;
grant execute on function public.report_ai_auth_login_url(uuid, text) to service_role;

-- The worker's poll for the person's confirmation code. Volatile because a
-- successful read is also a liveness signal.
create or replace function public.read_ai_auth_relay_code(p_session_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
begin
  select * into v_session
  from public.ai_auth_sessions s
  where s.id = p_session_id
  for update;

  if not found or v_session.expires_at <= now() then
    return null;
  end if;

  update public.ai_auth_sessions
  set heartbeat_at = now(), updated_at = now()
  where id = p_session_id;

  if v_session.status <> 'authenticated' then
    return null;
  end if;

  return v_session.relay_code_sealed;
end;
$function$;

revoke all on function public.read_ai_auth_relay_code(uuid)
  from public, anon, authenticated;
grant execute on function public.read_ai_auth_relay_code(uuid) to service_role;

create or replace function public.mark_ai_auth_session_verifying(p_session_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_updated integer;
begin
  update public.ai_auth_sessions
  set status = 'verifying', heartbeat_at = now(), updated_at = now()
  where id = p_session_id and status = 'authenticated' and expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

revoke all on function public.mark_ai_auth_session_verifying(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_ai_auth_session_verifying(uuid) to service_role;

-- The finish line: the worker verified the minted credential and posts it
-- sealed. One statement each for the session, the vault, and the account, so
-- there is no order in which a crash leaves "connected" without a credential.
create or replace function public.complete_ai_auth_session(
  p_session_id uuid,
  p_sealed_envelope text
)
returns table (connected_organization_id uuid, connected_purpose text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
  v_account record;
begin
  select * into v_session
  from public.ai_auth_sessions s
  where s.id = p_session_id
  for update;

  if not found
    or v_session.status not in ('authenticated', 'verifying')
    or v_session.expires_at <= now()
  then
    raise exception using errcode = '42501',
      message = 'that sign-in is not in a completable state; start a new one';
  end if;

  select * into v_account
  from public.ai_accounts a
  where a.id = v_session.ai_account_id
  for update;

  update public.ai_auth_sessions
  set status = 'connected', heartbeat_at = now(), updated_at = now()
  where id = p_session_id;

  insert into public.provider_credentials
    (organization_id, purpose, sealed_envelope, source, created_by)
  values (
    v_session.organization_id, v_account.credential_purpose, p_sealed_envelope,
    'connect_session', v_session.created_by
  )
  on conflict (organization_id, purpose) do update
    set sealed_envelope = excluded.sealed_envelope,
        source = excluded.source,
        rotated_at = now(),
        last_verified_at = null;

  update public.ai_accounts
  set status = 'connected', last_verified_at = now(), last_error = null, updated_at = now()
  where id = v_account.id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    v_session.organization_id, v_session.created_by, 'ai_account.changed',
    'ai_account', v_account.id,
    format('Connected %s', v_account.display_name),
    pg_catalog.jsonb_build_object('purpose', v_account.credential_purpose)
  );

  return query select v_session.organization_id, v_account.credential_purpose;
end;
$function$;

revoke all on function public.complete_ai_auth_session(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_ai_auth_session(uuid, text) to service_role;

create or replace function public.fail_ai_auth_session(
  p_session_id uuid,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
  v_reason text;
begin
  select * into v_session
  from public.ai_auth_sessions s
  where s.id = p_session_id
  for update;

  if not found
    or v_session.status in ('connected', 'failed', 'expired', 'revoked')
  then
    return false;
  end if;

  -- Sanitized before storage rather than rejected after: a worker reporting a
  -- failure that happens to contain a token shape should not itself fail.
  v_reason := pg_catalog.left(coalesce(p_reason, 'The sign-in failed.'), 500);
  if public.text_has_likely_secret(v_reason) then
    v_reason := 'The sign-in failed. The provider''s message was withheld because it looked like it contained a credential.';
  end if;

  update public.ai_auth_sessions
  set status = 'failed', failure_reason = v_reason, heartbeat_at = now(), updated_at = now()
  where id = p_session_id;

  update public.ai_accounts
  set last_error = v_reason, updated_at = now()
  where id = v_session.ai_account_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    v_session.organization_id, v_session.created_by, 'ai_account.changed',
    'ai_auth_session', p_session_id,
    'Sign-in failed',
    pg_catalog.jsonb_build_object('ai_account_id', v_session.ai_account_id)
  );

  return true;
end;
$function$;

revoke all on function public.fail_ai_auth_session(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_ai_auth_session(uuid, text) to service_role;

-- Housekeeping the worker (or any scheduled caller) runs: sessions nobody
-- finished stop pretending to be in progress.
create or replace function public.expire_ai_auth_sessions()
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_count integer;
begin
  with expired as (
    update public.ai_auth_sessions s
    set status = 'expired', updated_at = now()
    where s.status in ('pending', 'initializing', 'awaiting_user', 'authenticated', 'verifying')
      and s.expires_at <= now()
    returning s.id, s.organization_id, s.created_by, s.ai_account_id
  )
  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  select e.organization_id, e.created_by, 'ai_account.changed', 'ai_auth_session', e.id,
         'Sign-in expired before it finished',
         pg_catalog.jsonb_build_object('ai_account_id', e.ai_account_id)
  from expired e;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.expire_ai_auth_sessions()
  from public, anon, authenticated;
grant execute on function public.expire_ai_auth_sessions() to service_role;

-- Reauth demotion, driven by the verification loop when a stored credential
-- stops working. Service-role because the prober is the server, not a person.
create or replace function public.mark_ai_account_needs_reauth(
  p_organization_id uuid,
  p_ai_account_id uuid,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_account record;
  v_reason text;
begin
  select * into v_account
  from public.ai_accounts a
  where a.id = p_ai_account_id and a.organization_id = p_organization_id
  for update;

  if not found or v_account.status in ('disconnected', 'revoked') then
    return false;
  end if;

  v_reason := pg_catalog.left(coalesce(p_reason, 'The stored sign-in no longer works.'), 500);
  if public.text_has_likely_secret(v_reason) then
    v_reason := 'The stored sign-in no longer works.';
  end if;

  update public.ai_accounts
  set status = 'needs_reauth', last_error = v_reason, updated_at = now()
  where id = p_ai_account_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_account.created_by, 'ai_account.changed',
    'ai_account', p_ai_account_id,
    format('%s needs to be signed in again', v_account.display_name),
    pg_catalog.jsonb_build_object('purpose', v_account.credential_purpose)
  );

  return true;
end;
$function$;

revoke all on function public.mark_ai_account_needs_reauth(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_ai_account_needs_reauth(uuid, uuid, text) to service_role;
