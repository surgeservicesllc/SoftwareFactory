-- The account carries the identity the provider actually signed in, and the
-- owner can rename the account itself.
--
-- "Claude account 1" is a slot label, not an identity. After a completed
-- sign-in the worker knows which provider account authenticated (the login
-- CLI records it locally, never as a secret), and that display identity now
-- lives on the row — shape-checked so nothing credential-like can land there.
-- Renaming is the owner-facing half: same constraints the create path
-- enforces, uniqueness included, with an activity event.
--
-- Every statement is idempotent: this file is on the surgical apply path
-- (scope=broker-functions) and may be replayed.

alter table public.ai_accounts add column if not exists provider_identity text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_accounts_provider_identity_shape'
      and conrelid = 'public.ai_accounts'::regclass
  ) then
    alter table public.ai_accounts add constraint ai_accounts_provider_identity_shape check (
      provider_identity is null
      or (
        char_length(provider_identity) between 1 and 120
        and not public.text_has_likely_secret(provider_identity)
      )
    );
  end if;
end
$$;

comment on column public.ai_accounts.provider_identity is
  'The display identity the provider reported at sign-in (an email address or workspace name). Never a credential; the shape check enforces it.';

-- ---------------------------------------------------------------------------
-- Renaming, for the console
-- ---------------------------------------------------------------------------

create or replace function public.rename_ai_account(
  p_organization_id uuid,
  p_ai_account_id uuid,
  p_display_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_updated integer;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'owner or admin role is required to rename an AI account';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception using errcode = '22023',
      message = 'the account name must be between 1 and 80 characters';
  end if;

  if public.text_has_likely_secret(v_name) then
    raise exception using errcode = '22023',
      message = 'that name looks like it contains a credential; choose another';
  end if;

  update public.ai_accounts a
  set display_name = v_name, updated_at = now()
  where a.id = p_ai_account_id and a.organization_id = p_organization_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'ai_account.changed', 'ai_account', p_ai_account_id,
    pg_catalog.format('Renamed AI account to %s', v_name),
    pg_catalog.jsonb_build_object('renamed', true)
  );

  return true;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = 'another account already uses that name';
end;
$function$;

revoke all on function public.rename_ai_account(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.rename_ai_account(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Identity, reported by the worker
-- ---------------------------------------------------------------------------

create or replace function public.set_ai_account_provider_identity(
  p_ai_account_id uuid,
  p_identity text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_identity text := pg_catalog.left(btrim(coalesce(p_identity, '')), 120);
  v_updated integer;
begin
  -- Sanitized rather than trusted: an empty or credential-shaped identity is
  -- refused without an error, because the sign-in it arrived from succeeded.
  if char_length(v_identity) = 0 then
    return false;
  end if;
  if public.text_has_likely_secret(v_identity) then
    return false;
  end if;

  update public.ai_accounts
  set provider_identity = v_identity, updated_at = now()
  where id = p_ai_account_id;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

revoke all on function public.set_ai_account_provider_identity(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_ai_account_provider_identity(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The list gains the identity column (return type change forces a recreate)
-- ---------------------------------------------------------------------------

drop function if exists public.list_ai_accounts(uuid);

create or replace function public.list_ai_accounts(p_organization_id uuid)
returns table (
  account_id uuid,
  provider public.bot_provider,
  auth_method text,
  display_name text,
  provider_identity text,
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
  select a.id, a.provider, a.auth_method, a.display_name, a.provider_identity,
         a.status, a.credential_purpose, a.last_verified_at, a.last_error,
         a.created_at, a.updated_at
  from public.ai_accounts a
  where a.organization_id = p_organization_id
  order by a.created_at;
end;
$function$;

revoke all on function public.list_ai_accounts(uuid) from public, anon, service_role;
grant execute on function public.list_ai_accounts(uuid) to authenticated;
