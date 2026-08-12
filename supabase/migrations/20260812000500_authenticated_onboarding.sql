-- Authenticated organization onboarding for Phase 1B.
--
-- This additive migration introduces a narrowly scoped RPC that derives the
-- caller exclusively from auth.uid(). It creates an organization, relies on
-- the existing owner-bootstrap trigger, and relies on the existing immutable
-- organization.created activity event. It does not use or require service-role
-- credentials and does not weaken any existing RLS policy.

create or replace function public.onboard_authenticated_organization(
  p_name text,
  p_slug text default null
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_role public.organization_member_role,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(coalesce(p_name, ''));
  normalized_slug text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_slug, ''))
  );
  slug_base text;
  new_organization_id uuid := pg_catalog.gen_random_uuid();
  organization_record public.organizations%rowtype;
  membership_role public.organization_member_role;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  if pg_catalog.char_length(normalized_name) < 1
    or pg_catalog.char_length(normalized_name) > 120 then
    raise exception using
      errcode = '22023',
      message = 'organization name must contain 1 to 120 characters';
  end if;

  if normalized_slug = '' then
    slug_base := pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(normalized_name),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '-'
    );
    if slug_base = '' then
      slug_base := 'organization';
    end if;

    normalized_slug := pg_catalog.left(slug_base, 54)
      || '-'
      || pg_catalog.left(pg_catalog.md5(caller_id::text), 8);
  end if;

  if pg_catalog.char_length(normalized_slug) > 63
    or normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception using
      errcode = '22023',
      message = 'organization slug must be lowercase letters, numbers, and single hyphens, up to 63 characters';
  end if;

  -- Serialize a single slug without locking unrelated onboarding requests.
  -- This makes concurrent retries deterministic instead of surfacing a race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_slug, 0)
  );

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.slug = normalized_slug;

  if found then
    select member.role
    into membership_role
    from public.organization_members member
    where member.organization_id = organization_record.id
      and member.user_id = caller_id;

    if organization_record.created_by = caller_id
      and organization_record.name = normalized_name
      and membership_role = 'owner'::public.organization_member_role then
      return query select
        organization_record.id,
        organization_record.name,
        organization_record.slug,
        membership_role,
        false;
      return;
    end if;

    raise exception using
      errcode = '23505',
      message = 'organization slug is already in use';
  end if;

  insert into public.profiles (id)
  values (caller_id)
  on conflict (id) do nothing;

  insert into public.organizations (id, name, slug, created_by)
  values (new_organization_id, normalized_name, normalized_slug, caller_id)
  returning * into organization_record;

  select member.role
  into membership_role
  from public.organization_members member
  where member.organization_id = organization_record.id
    and member.user_id = caller_id;

  if membership_role is distinct from 'owner'::public.organization_member_role then
    raise exception using
      errcode = '42501',
      message = 'organization owner membership was not established';
  end if;

  return query select
    organization_record.id,
    organization_record.name,
    organization_record.slug,
    membership_role,
    true;
end;
$function$;

revoke all on function public.onboard_authenticated_organization(text, text)
  from public, anon;
grant execute on function public.onboard_authenticated_organization(text, text)
  to authenticated;

comment on function public.onboard_authenticated_organization(text, text) is
  'Authenticated, idempotent organization onboarding. Creates an owner membership and immutable organization.created audit event; never accepts a user id or credential.';

-- Reassert the protected tables used by onboarding. These statements are
-- intentionally redundant and guarantee that later environment drift cannot
-- make onboarding reachable without row security.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
