-- Owner-safe configuration for the public project URL observed by Full
-- Lifecycle Step 10. This is deliberately separate from a provider's exact
-- deployment URL: the provider URL proves deployment lineage, while this
-- stable public URL is the address customers and post-deploy probes reach.
--
-- The projects table has always carried production_url, but its original
-- CHECK required only an https:// prefix and no supported writer existed.
-- This forward migration adds a fail-closed value predicate, strengthens the
-- column constraint, and exposes one owner/admin RPC. Existing project detail
-- RPC identity and signature remain unchanged.

create or replace function public.project_production_url_is_safe(candidate text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  remainder text;
  authority text;
  hostname text;
  octets integer[];
begin
  if candidate is null then
    return false;
  end if;
  if candidate is distinct from btrim(candidate)
    or char_length(candidate) < 9
    or char_length(candidate) > 208
    or public.text_has_likely_secret(candidate)
    or candidate !~ '^https://'
    or candidate ~ '[[:space:][:cntrl:]]'
    or position('?' in candidate) > 0
    or position('#' in candidate) > 0
    or position(chr(92) in candidate) > 0 then
    return false;
  end if;

  remainder := substring(candidate from 9);
  authority := split_part(remainder, '/', 1);
  if authority = ''
    or position('@' in authority) > 0
    or left(authority, 1) = '['
    or right(authority, 1) = ']' then
    -- Literal IPv6 is refused rather than incompletely classifying its private
    -- and mapped-address forms. Public DNS names may still resolve to IPv6;
    -- the probe's connection-bound guarded lookup checks the actual address.
    return false;
  end if;

  if position(':' in authority) > 0 then
    if right(authority, 4) <> ':443'
      or position(':' in left(authority, char_length(authority) - 4)) > 0 then
      return false;
    end if;
    hostname := lower(left(authority, char_length(authority) - 4));
  else
    hostname := lower(authority);
  end if;

  if hostname = ''
    or char_length(hostname) > 253
    or right(hostname, 1) = '.'
    or hostname = 'localhost'
    or hostname ~ '\.(localhost|local|internal|lan|home)$' then
    return false;
  end if;

  if hostname ~ '^[0-9.]+$' then
    -- Only canonical dotted-decimal IPv4 is admitted. This rejects compact,
    -- octal and hexadecimal spellings that URL parsers can reinterpret as a
    -- loopback/private address after a textual check.
    if hostname !~ '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$' then
      return false;
    end if;
    octets := array[
      split_part(hostname, '.', 1)::integer,
      split_part(hostname, '.', 2)::integer,
      split_part(hostname, '.', 3)::integer,
      split_part(hostname, '.', 4)::integer
    ];
    if octets[1] > 255 or octets[2] > 255 or octets[3] > 255 or octets[4] > 255
      or octets[1] in (0, 10, 127)
      or (octets[1] = 100 and octets[2] between 64 and 127)
      or (octets[1] = 169 and octets[2] = 254)
      or (octets[1] = 172 and octets[2] between 16 and 31)
      or (octets[1] = 192 and octets[2] = 168)
      or (octets[1] = 198 and octets[2] in (18, 19))
      or octets[1] >= 224 then
      return false;
    end if;
  elsif hostname !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    -- A bare intranet label is not a public hostname.
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function public.project_production_url_is_safe(text)
  from public, anon, authenticated, service_role;

alter table public.projects
  add constraint projects_production_url_public_https
  check (
    production_url is null
    or public.project_production_url_is_safe(production_url)
  ) not valid;

alter table public.projects
  validate constraint projects_production_url_public_https;

create or replace function public.set_project_production_url(
  p_organization_id uuid,
  p_project_id uuid,
  p_production_url text
)
returns table (project_id uuid, production_url text, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record public.projects%rowtype;
  normalized_url text := nullif(rtrim(btrim(coalesce(p_production_url, '')), '/'), '');
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select project.* into project_record
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not public.can_manage_organization(project_record.organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if project_record.status = 'archived'::public.project_status then
    raise exception using errcode = '22023',
      message = 'an archived project is a record; restore it before changing its production URL';
  end if;
  if normalized_url is not null
    and not public.project_production_url_is_safe(normalized_url) then
    raise exception using errcode = '22023',
      message = 'use a public HTTPS URL without credentials, query parameters, fragments, private hosts, localhost, or non-standard ports';
  end if;

  -- Avoid creating an audit event for a no-op replay. A real change goes
  -- through the existing projects_audit_change trigger and therefore records
  -- one immutable project.updated activity event.
  if project_record.production_url is not distinct from normalized_url then
    return query select project_record.id, project_record.production_url,
      project_record.updated_at;
    return;
  end if;

  update public.projects project
  set production_url = normalized_url,
      updated_at = now()
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  returning project.* into project_record;

  return query select project_record.id, project_record.production_url,
    project_record.updated_at;
end;
$function$;

revoke all on function public.set_project_production_url(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.set_project_production_url(uuid, uuid, text)
  to authenticated;

comment on function public.set_project_production_url(uuid, uuid, text) is
  'Owner/admin-only public production URL configuration. Refuses archived projects and unsafe targets; the existing project audit trigger records real changes.';

do $postflight$
declare
  projects_rls boolean;
  projects_force_rls boolean;
begin
  select relation.relrowsecurity, relation.relforcerowsecurity
    into projects_rls, projects_force_rls
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = 'projects';

  if projects_rls is distinct from true or projects_force_rls is distinct from true then
    raise exception 'projects RLS must remain enabled and forced';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.projects'::regclass
      and trigger_row.tgname = 'projects_audit_change'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgfoid = 'public.audit_project_change()'::regprocedure
      and trigger_row.tgtype = 21
      and trigger_row.tgnargs = 0
      and trigger_row.tgqual is null
      and not trigger_row.tgdeferrable
      and not trigger_row.tginitdeferred
  ) then
    raise exception 'projects_audit_change exact metadata must remain unchanged';
  end if;
  if to_regprocedure('public.update_project_details(uuid,text,text)') is null then
    raise exception 'the compatible three-argument project detail RPC is missing';
  end if;
end;
$postflight$;
