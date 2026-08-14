-- Forward repair for the bot-fabric mutation functions published by 130004.
-- NULLIF is PostgreSQL conditional syntax, not a function in pg_catalog, so it
-- must not be schema-qualified. Keep the existing signatures, definer/search
-- path boundary, behavior, and authenticated-only execute ACL unchanged.

create or replace function public.register_bot(
  p_organization_id uuid,
  p_name text,
  p_provider public.bot_provider,
  p_model text,
  p_credential_ref text default null,
  p_base_url text default null,
  p_notes text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
begin
  insert into public.bots (
    organization_id, name, provider, model, credential_ref, base_url, notes, created_by
  ) values (
    p_organization_id,
    pg_catalog.btrim(p_name),
    p_provider,
    pg_catalog.btrim(p_model),
    public.normalize_bot_credential_ref(p_credential_ref),
    nullif(pg_catalog.btrim(coalesce(p_base_url, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    caller_id
  )
  returning * into bot_record;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.registered'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot registered in the fabric',
    pg_catalog.jsonb_build_object(
      'provider', bot_record.provider::text,
      'model', bot_record.model,
      'credential_reference_present', bot_record.credential_ref is not null,
      'readiness', bot_record.readiness::text
    )
  );

  return next bot_record;
end;
$function$;

create or replace function public.update_bot(
  p_organization_id uuid,
  p_bot_id uuid,
  p_name text,
  p_model text,
  p_credential_ref text default null,
  p_base_url text default null,
  p_notes text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
begin
  update public.bots
  set
    name = pg_catalog.btrim(p_name),
    model = pg_catalog.btrim(p_model),
    credential_ref = public.normalize_bot_credential_ref(p_credential_ref),
    base_url = nullif(pg_catalog.btrim(coalesce(p_base_url, '')), ''),
    notes = nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    readiness = 'not_connected'::public.bot_readiness,
    readiness_detail = null,
    last_checked_at = null
  where id = p_bot_id
    and organization_id = p_organization_id
  returning * into bot_record;

  if not found then
    raise exception using errcode = 'P0002', message = 'bot was not found for this organization';
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.updated'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot configuration updated; readiness reset pending a new check',
    pg_catalog.jsonb_build_object(
      'provider', bot_record.provider::text,
      'model', bot_record.model,
      'credential_reference_present', bot_record.credential_ref is not null
    )
  );

  return next bot_record;
end;
$function$;

create or replace function public.record_bot_readiness(
  p_organization_id uuid,
  p_bot_id uuid,
  p_readiness public.bot_readiness,
  p_detail text default null
)
returns setof public.bots
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := public.assert_bot_fabric_manager(p_organization_id);
  bot_record public.bots%rowtype;
  safe_detail text := nullif(pg_catalog.btrim(coalesce(p_detail, '')), '');
begin
  if safe_detail is not null and public.text_has_likely_secret(safe_detail) then
    raise exception using errcode = '22023', message = 'readiness detail must not contain secret material';
  end if;

  update public.bots
  set
    readiness = p_readiness,
    readiness_detail = pg_catalog.left(safe_detail, 200),
    last_checked_at = now()
  where id = p_bot_id
    and organization_id = p_organization_id
  returning * into bot_record;

  if not found then
    raise exception using errcode = 'P0002', message = 'bot was not found for this organization';
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    caller_id,
    'bot.readiness_checked'::public.activity_event_type,
    'bot',
    bot_record.id,
    'Bot readiness recorded from server-side configuration evidence',
    pg_catalog.jsonb_build_object(
      'readiness', bot_record.readiness::text,
      'credential_reference_present', bot_record.credential_ref is not null,
      'executor_connected', false
    )
  );

  return next bot_record;
end;
$function$;

revoke all on function public.register_bot(uuid, text, public.bot_provider, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_bot(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_bot_readiness(uuid, uuid, public.bot_readiness, text) from public, anon, authenticated;

grant execute on function public.register_bot(uuid, text, public.bot_provider, text, text, text, text) to authenticated;
grant execute on function public.update_bot(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.record_bot_readiness(uuid, uuid, public.bot_readiness, text) to authenticated;
