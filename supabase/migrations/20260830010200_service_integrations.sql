-- ---------------------------------------------------------------------------
-- Increment 17 — the provider integration registry (ADR-207).
--
-- Nine capabilities the competitors sell cannot be finished by writing
-- code: SMS and email delivery, card and ACH processing, GPS telemetry,
-- accounting sync, telephony, reviews, and route optimization by drive
-- time. Every one needs an account somebody has to open and pay for.
--
-- What CAN be built is everything up to the credential — and, more
-- importantly, the thing that makes shipping them honest: one place that
-- knows, per provider, whether this workspace can actually do it. Without
-- that, "Not Connected" is a hard-coded string in a component, and the day
-- somebody connects Twilio it stays a hard-coded string.
--
-- THE ONE RULE THIS FILE EXISTS TO ENFORCE:
--
--   `live` is DERIVED, never stored.
--
-- A member can enable a provider. A member cannot make it live. Live means
-- a sealed credential for its purpose actually exists in
-- `provider_credentials`, and the only way to answer that is to look. Give
-- this table a `status` column somebody can set to 'connected' and the
-- page will eventually say Connected while nothing works — which is the
-- exact class of lie this repository has spent sixteen increments
-- refusing.
--
-- This table therefore stores NO credential and NO status. It stores which
-- provider, what it is called, whether an owner has switched it on, and
-- the PURPOSE NAME that addresses the sealed vault. A connection record is
-- metadata plus a reference to server-side secret material.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_integration_provider as enum (
    'sms', 'email', 'card_payments', 'gps_telemetry',
    'accounting', 'telephony', 'reviews', 'mapping'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_service_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.crm_integration_provider not null,

  -- The vault purpose this provider's credential is filed under. It is a
  -- NAME, not a secret: `provider_credentials` holds the sealed envelope,
  -- no browser role can read it, and the seal is bound to this string.
  --
  -- The shape check alone is not enough. A lower-case, underscored token —
  -- `sk_live_abcdef...` is exactly that shape — would pass it, so the
  -- secret guard sits on this column too. Every free-text column in this
  -- table is guarded; a purpose name is the least likely place somebody
  -- pastes a key and therefore the worst place to leave unguarded.
  credential_purpose text not null
    check (credential_purpose ~ '^[a-z][a-z0-9_]{1,62}$')
    check (not public.text_has_likely_secret(credential_purpose)),

  -- What an operator calls this connection. Never a key, and the secret
  -- guard refuses anything that looks like one.
  display_label text check (display_label is null or char_length(btrim(display_label)) between 1 and 120),

  -- An owner's switch. This is the ONLY thing a member controls, and on
  -- its own it does nothing: see crm_integration_status().
  enabled boolean not null default false,

  -- Non-secret provider settings — a sender id, a region, a from-address.
  -- Bounded, and secret-guarded like every other free text in this schema.
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and char_length(settings::text) <= 4000),

  last_checked_at timestamptz,
  -- What the last verification attempt said, when it failed. A provider
  -- that is refusing us is not the same as one nobody has connected, and
  -- the page has to be able to say which.
  last_error text check (last_error is null or char_length(last_error) between 1 and 500),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_service_integrations_label_no_secret
    check (not public.text_has_likely_secret(display_label)),
  constraint crm_service_integrations_error_no_secret
    check (not public.text_has_likely_secret(last_error)),
  -- The settings blob is the likeliest place for somebody to paste a key
  -- "just for now". Refuse it at the schema rather than discovering it in
  -- a database dump.
  constraint crm_service_integrations_settings_no_secret
    check (not public.text_has_likely_secret(settings::text))
);

create unique index if not exists crm_service_integrations_org_provider_key
  on public.crm_service_integrations (organization_id, provider);
create unique index if not exists crm_service_integrations_org_id_key
  on public.crm_service_integrations (organization_id, id);

-- ---------------------------------------------------------------------------
-- The status read. Every provider, always — including the ones nobody has
-- configured, because a capability the workspace does not have is exactly
-- what a page needs to be told about.
--
-- SECURITY DEFINER, and this one needs justifying because most reads in
-- this chain are not. It must look at `provider_credentials`, which no
-- browser role holds SELECT on by design (that is what keeps the sealed
-- envelope unreadable). So the presence check has to happen as the owner —
-- and the function returns `credential_present boolean`, never the
-- envelope, never the purpose's contents. The membership check is
-- explicit and first, exactly as list_provider_credentials does it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_integration_status(p_organization_id uuid)
returns table (
  provider public.crm_integration_provider,
  configured boolean,
  enabled boolean,
  credential_present boolean,
  live boolean,
  display_label text,
  last_checked_at timestamptz,
  last_error text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select
    p.provider,
    i.id is not null,
    coalesce(i.enabled, false),
    c.id is not null,
    -- The whole point. Both halves, and neither is a stored column:
    -- an owner switched it on AND a sealed credential is really there.
    coalesce(i.enabled, false) and c.id is not null,
    i.display_label,
    i.last_checked_at,
    i.last_error
  from unnest(enum_range(null::public.crm_integration_provider)) as p(provider)
  left join public.crm_service_integrations i
    on i.organization_id = p_organization_id and i.provider = p.provider
  left join public.provider_credentials c
    on c.organization_id = p_organization_id and c.purpose = i.credential_purpose
  order by p.provider;
end;
$$;

revoke all on function public.crm_integration_status(uuid) from public, anon, service_role;
grant execute on function public.crm_integration_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The single question every gated feature asks before it acts.
--
-- One provider, one boolean, and it is the same derivation as above so the
-- page and the send path can never disagree. A feature that branches on
-- anything else — a settings flag, a component constant — is a feature
-- that will one day claim to have sent something.
-- ---------------------------------------------------------------------------

create or replace function public.crm_integration_live(
  p_organization_id uuid,
  p_provider public.crm_integration_provider
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_live boolean;
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select i.enabled and c.id is not null
    into v_live
    from public.crm_service_integrations i
    left join public.provider_credentials c
      on c.organization_id = i.organization_id and c.purpose = i.credential_purpose
   where i.organization_id = p_organization_id and i.provider = p_provider;

  -- No row at all means nobody has configured it, which is not live and is
  -- not an error. false, never null: a caller writing `if not live` must
  -- not fall through on a null.
  return coalesce(v_live, false);
end;
$$;

revoke all on function public.crm_integration_live(uuid, public.crm_integration_provider)
  from public, anon, service_role;
grant execute on function public.crm_integration_live(uuid, public.crm_integration_provider)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. Configuring an integration is an ordinary member
-- write; the credential behind it is not in this table and is governed by
-- the vault's own rules.
--
-- Deletable, unlike most of this schema, and deliberately: removing an
-- integration a workspace never used is housekeeping, not history. What
-- must not disappear is the CREDENTIAL, and forgetting that is the vault's
-- `forget_provider_credential`, which is audited on its own terms.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'drop trigger if exists crm_service_integrations_set_updated_at on public.crm_service_integrations';
  execute 'create trigger crm_service_integrations_set_updated_at
             before update on public.crm_service_integrations
             for each row execute function public.set_updated_at()';

  execute 'alter table public.crm_service_integrations enable row level security';
  execute 'alter table public.crm_service_integrations force row level security';
  execute 'revoke all on table public.crm_service_integrations
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_service_integrations_select_member on public.crm_service_integrations';
  execute 'create policy crm_service_integrations_select_member on public.crm_service_integrations
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_service_integrations_insert_member on public.crm_service_integrations';
  execute 'create policy crm_service_integrations_insert_member on public.crm_service_integrations
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_service_integrations_update_member on public.crm_service_integrations';
  execute 'create policy crm_service_integrations_update_member on public.crm_service_integrations
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_service_integrations_delete_member on public.crm_service_integrations';
  execute 'create policy crm_service_integrations_delete_member on public.crm_service_integrations
             for delete to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'grant select, insert, update, delete on table public.crm_service_integrations to authenticated';
end;
$$;
