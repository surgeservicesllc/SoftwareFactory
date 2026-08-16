-- Renaming a bot changes its label and nothing else.
--
-- update_bot exists for reconfiguration and deliberately resets readiness —
-- a bot whose model or credential changed must prove itself again. A rename
-- proves nothing about connectivity, so a Ready bot stays Ready. Same
-- constraints as creation: trimmed, bounded, unique per organization, and
-- nothing credential-shaped.
--
-- Idempotent: this file is on the surgical apply path and may be replayed.

create or replace function public.rename_bot(
  p_organization_id uuid,
  p_bot_id uuid,
  p_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := public.assert_bot_fabric_manager(p_organization_id);
  v_name text := btrim(coalesce(p_name, ''));
  v_updated integer;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception using errcode = '22023',
      message = 'the bot name must be between 1 and 80 characters';
  end if;

  if public.text_has_likely_secret(v_name) then
    raise exception using errcode = '22023',
      message = 'that name looks like it contains a credential; choose another';
  end if;

  update public.bots b
  set name = v_name, updated_at = now()
  where b.id = p_bot_id and b.organization_id = p_organization_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    p_organization_id, v_actor, 'bot.updated'::public.activity_event_type, 'bot', p_bot_id,
    pg_catalog.format('Renamed bot to %s', v_name),
    pg_catalog.jsonb_build_object('renamed', true)
  );

  return true;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = 'another bot already uses that name';
end;
$function$;

revoke all on function public.rename_bot(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.rename_bot(uuid, uuid, text) to authenticated;
