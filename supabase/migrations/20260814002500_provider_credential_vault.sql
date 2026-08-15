-- Sealed provider credentials, and the one-time sessions that fill them.
--
-- Until now this repository refused to store a credential at all: a connection
-- record was metadata plus the NAME of a server-side environment variable. That
-- worked because every credential was an API key an operator could paste into a
-- dashboard.
--
-- A subscription OAuth token is not that. It is minted by a login flow, it
-- rotates, and there is no operator step where it could be typed anywhere. So
-- "sign in with your Claude subscription" is impossible without somewhere to put
-- the result. This is that place, under conditions that keep the original
-- guarantee intact:
--
--   * The stored value is a sealed envelope from `lib/server/secret-box.ts`,
--     encrypted under a key held in the environment. A database dump alone,
--     including one taken by someone with full SQL access, is inert.
--   * No browser role can read the envelope column. `authenticated` holds no
--     SELECT on either table; presence is published through a projection that
--     cannot return ciphertext because it does not select it.
--   * Only the server, running as a definer function, ever handles the value.
--
-- The connect session is the other half. A person clicks "sign in", the server
-- mints a single-use code, and the operator's own machine — running the
-- provider's real login — posts the resulting token back against that code.
-- The code is stored as a SHA-256 digest, never in the clear, so the table
-- cannot be read to impersonate a pending sign-in.

create table public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Matches the `purpose` passed to sealSecret. The seal is bound to this
  -- string, so a Claude token cannot be opened as the Codex one even if the
  -- row is edited.
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{1,62}$'),
  sealed_envelope text not null check (
    char_length(sealed_envelope) between 24 and 8192
    -- Shape check only. It says nothing about whether the seal opens, which is
    -- the application's job, but it does refuse an obviously unsealed paste.
    and sealed_envelope ~ '^v[0-9]+\.'
  ),
  -- How the credential arrived, for the audit trail. Never the value.
  source text not null default 'connect_session'
    check (source in ('connect_session', 'environment_import')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  last_verified_at timestamptz,

  constraint provider_credentials_one_per_purpose unique (organization_id, purpose),
  -- The seal is opaque, so a plaintext token here would be a bug rather than an
  -- attack. Refuse it at the schema so the bug cannot land quietly.
  constraint provider_credentials_not_plaintext check (
    not public.text_has_likely_secret(sealed_envelope)
  )
);

comment on table public.provider_credentials is
  'Sealed provider credentials. The envelope is encrypted under a key outside the database and is never readable by a browser role; a dump on its own is inert.';
comment on column public.provider_credentials.sealed_envelope is
  'Output of sealSecret(). Bound to (organization_id, purpose) by both key derivation and additional authenticated data, so it cannot be moved between tenants or purposes.';

create table public.provider_connect_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- SHA-256 of the connect code. The code itself is shown once, to the person
  -- who asked for it, and never stored — so reading this table cannot let
  -- anyone claim a pending session.
  code_digest text not null check (code_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint provider_connect_sessions_digest_unique unique (code_digest),
  -- A session that lives too long is a bearer credential nobody remembers
  -- issuing. Fifteen minutes is the ceiling, enforced here rather than trusted
  -- to the caller that inserts.
  constraint provider_connect_sessions_short_lived check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  ),
  constraint provider_connect_sessions_claim_coherent check (
    (claimed_at is null) = (claimed_by is null)
  )
);

-- One open session per purpose. Without this, a stale unclaimed code stays
-- valid alongside a fresh one, and a person who clicked twice would leave a
-- second working credential path behind them.
create unique index provider_connect_sessions_one_open
  on public.provider_connect_sessions (organization_id, purpose)
  where claimed_at is null;

create index provider_connect_sessions_expiry_idx
  on public.provider_connect_sessions (expires_at)
  where claimed_at is null;

comment on table public.provider_connect_sessions is
  'Single-use, short-lived sign-in sessions. The code is stored only as a digest; reading this table cannot let anyone claim a pending sign-in.';

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------

alter table public.provider_credentials enable row level security;
alter table public.provider_credentials force row level security;
alter table public.provider_connect_sessions enable row level security;
alter table public.provider_connect_sessions force row level security;

-- Deliberately no policy grants SELECT on the envelope to any browser role.
-- The only reader is a definer function below. FORCE RLS means even the table
-- owner is subject to this.
revoke all on table public.provider_credentials from anon, authenticated, service_role;
revoke all on table public.provider_connect_sessions from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Presence, for the console
-- ---------------------------------------------------------------------------

create or replace function public.list_provider_credentials(p_organization_id uuid)
returns table (
  purpose text,
  configured boolean,
  source text,
  rotated_at timestamptz,
  last_verified_at timestamptz
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

  -- The envelope is not in the returns clause, so no future edit to this body
  -- can leak it without also changing the signature.
  return query
  select c.purpose, true, c.source, c.rotated_at, c.last_verified_at
  from public.provider_credentials c
  where c.organization_id = p_organization_id
  order by c.purpose;
end;
$function$;

revoke all on function public.list_provider_credentials(uuid) from public, anon, service_role;
grant execute on function public.list_provider_credentials(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening a sign-in
-- ---------------------------------------------------------------------------

create or replace function public.open_provider_connect_session(
  p_organization_id uuid,
  p_purpose text,
  p_code_digest text,
  p_ttl_seconds integer default 600
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
  -- Signing a provider in changes what the factory can do with money and code,
  -- so it is a manage operation rather than a member one.
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to connect a provider';
  end if;

  -- Clicking "sign in" twice must replace the pending session, not accumulate
  -- codes. The old one stops working the moment a new one is issued.
  delete from public.provider_connect_sessions s
  where s.organization_id = p_organization_id
    and s.purpose = p_purpose
    and s.claimed_at is null;

  insert into public.provider_connect_sessions
    (organization_id, purpose, code_digest, expires_at, created_by)
  values (
    p_organization_id, p_purpose, p_code_digest,
    now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 900)),
    v_actor
  )
  returning id into v_id;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'connection.changed', 'provider_connect_session', v_id,
    format('Started a sign-in for %s', p_purpose),
    jsonb_build_object('purpose', p_purpose)
  );

  return v_id;
end;
$function$;

revoke all on function public.open_provider_connect_session(uuid, text, text, integer)
  from public, anon, service_role;
grant execute on function public.open_provider_connect_session(uuid, text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Claiming a sign-in
-- ---------------------------------------------------------------------------
--
-- Called by the server after the operator's machine posts a sealed token. The
-- lookup is by digest, so the code never travels to the database in the clear
-- and an exact-match index does the comparison rather than application code.

-- Resolving a pending sign-in, without claiming it.
--
-- Sealing happens in the application, and the seal is bound to the session's
-- organization and purpose — which only the database knows. So the server has
-- to ask before it can encrypt. This answers that and nothing else: it never
-- returns the digest, never mutates, and applies the same validity rules the
-- claim does, so an expired or spent code is refused here too.
--
-- Racing this against a claim is safe. The claim re-validates under a row lock,
-- so a session that is taken between these two calls simply fails to claim.
create or replace function public.resolve_provider_connect_session(
  p_code_digest text
)
returns table (session_organization_id uuid, session_purpose text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  return query
  select s.organization_id, s.purpose
  from public.provider_connect_sessions s
  where s.code_digest = p_code_digest
    and s.claimed_at is null
    and s.expires_at > now();
end;
$function$;

revoke all on function public.resolve_provider_connect_session(text)
  from public, anon, authenticated;
grant execute on function public.resolve_provider_connect_session(text) to service_role;

create or replace function public.claim_provider_connect_session(
  p_code_digest text,
  p_sealed_envelope text
)
-- Prefixed because a RETURNS TABLE column name becomes a plpgsql variable, and
-- a bare `organization_id` here would shadow the real column in the ON CONFLICT
-- clause below — which PostgreSQL rejects as ambiguous.
returns table (claimed_organization_id uuid, claimed_purpose text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
begin
  -- Locked, because two posts racing the same code must not both succeed.
  select * into v_session
  from public.provider_connect_sessions s
  where s.code_digest = p_code_digest
  for update;

  -- One message for every failure. Distinguishing "no such code" from "expired"
  -- from "already used" tells someone probing codes which guesses were close.
  if not found
    or v_session.claimed_at is not null
    or v_session.expires_at <= now()
  then
    raise exception using errcode = '42501',
      message = 'that sign-in link is not valid; start a new one';
  end if;

  update public.provider_connect_sessions
    set claimed_at = now(), claimed_by = v_session.created_by
  where id = v_session.id;

  insert into public.provider_credentials
    (organization_id, purpose, sealed_envelope, source, created_by)
  values (
    v_session.organization_id, v_session.purpose, p_sealed_envelope,
    'connect_session', v_session.created_by
  )
  on conflict (organization_id, purpose) do update
    set sealed_envelope = excluded.sealed_envelope,
        source = excluded.source,
        rotated_at = now(),
        -- A replaced credential has not been verified yet, and carrying the old
        -- timestamp forward would make a fresh token look already-checked.
        last_verified_at = null;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    v_session.organization_id, v_session.created_by, 'connection.changed',
    'provider_credential', v_session.id,
    format('Completed sign-in for %s', v_session.purpose),
    jsonb_build_object('purpose', v_session.purpose)
  );

  return query select v_session.organization_id, v_session.purpose;
end;
$function$;

-- Not callable by any browser role. The claim arrives at a server route holding
-- a code rather than a session, so there is no signed-in caller to authorize;
-- the code itself is the authorization, and it is checked inside the function.
--
-- `service_role` is granted because it is the server's only privileged identity
-- and the route has to call something. The boundary that matters is the table
-- grant, revoked above: even holding the service-role key, the only way to
-- reach this data is through these two narrow functions rather than by
-- selecting the column.
revoke all on function public.claim_provider_connect_session(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_provider_connect_session(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Reading a credential back, and retiring one
-- ---------------------------------------------------------------------------

create or replace function public.read_provider_credential(
  p_organization_id uuid,
  p_purpose text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_envelope text;
begin
  select c.sealed_envelope into v_envelope
  from public.provider_credentials c
  where c.organization_id = p_organization_id and c.purpose = p_purpose;

  return v_envelope;
end;
$function$;

-- The only function that returns ciphertext. No browser role may call it; the
-- server may, through its privileged connection. What it returns is still
-- sealed, so reaching it is not the same as reading a credential — opening the
-- envelope needs SOFTWAREFACTORY_CREDENTIAL_KEY, which lives outside the
-- database entirely.
revoke all on function public.read_provider_credential(uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_provider_credential(uuid, text) to service_role;

create or replace function public.forget_provider_credential(
  p_organization_id uuid,
  p_purpose text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_removed integer;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to disconnect a provider';
  end if;

  delete from public.provider_credentials c
  where c.organization_id = p_organization_id and c.purpose = p_purpose;
  get diagnostics v_removed = row_count;

  if v_removed > 0 then
    insert into public.activity_events
      (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
    values (
      p_organization_id, v_actor, 'connection.changed', 'provider_credential', null,
      format('Disconnected %s', p_purpose),
      jsonb_build_object('purpose', p_purpose)
    );
  end if;

  return v_removed > 0;
end;
$function$;

revoke all on function public.forget_provider_credential(uuid, text)
  from public, anon, service_role;
grant execute on function public.forget_provider_credential(uuid, text) to authenticated;
