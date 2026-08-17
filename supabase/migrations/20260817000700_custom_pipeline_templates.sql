-- Custom pipeline templates: create, edit, and delete — wired to the table
-- that has been waiting for them (owner goal 2026-08-17).
--
-- `graph_templates` has existed since the graph engine landed, with RLS and
-- member SELECT and no browser write path — and nothing ever wrote a row.
-- These three definer functions are that write path. A custom template is
-- stored in the audit-areas shape (the same builder eleven of the fourteen
-- built-in templates use), so the application can compile it through the
-- exact engine that compiles the built-ins; the API refuses a definition the
-- compiler refuses, which keeps every stored template genuinely runnable.
--
-- Owner-or-administrator writes, every transition audit-evented, and the
-- built-in code templates are untouched: they live in source, versioned by
-- review, and a custom template may not shadow a built-in slug.

alter type public.activity_event_type add value if not exists 'pipeline_template.created';
alter type public.activity_event_type add value if not exists 'pipeline_template.updated';
alter type public.activity_event_type add value if not exists 'pipeline_template.deleted';

create or replace function public.validate_pipeline_template_areas(p_areas jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  area jsonb;
  area_id text;
  area_job text;
  seen text[] := '{}';
begin
  if p_areas is null or jsonb_typeof(p_areas) <> 'array'
    or jsonb_array_length(p_areas) < 1 or jsonb_array_length(p_areas) > 12 then
    raise exception using errcode = '22023',
      message = 'a template needs between 1 and 12 areas';
  end if;
  for area in select * from jsonb_array_elements(p_areas) loop
    area_id := btrim(coalesce(area ->> 'id', ''));
    area_job := btrim(coalesce(area ->> 'job', ''));
    if area_id !~ '^[a-z0-9_]{1,40}$' then
      raise exception using errcode = '22023',
        message = 'each area id must be 1-40 characters of a-z, 0-9, or underscore';
    end if;
    if area_id = any(seen) then
      raise exception using errcode = '22023',
        message = format('area id %s appears twice', area_id);
    end if;
    seen := seen || area_id;
    if char_length(area_job) < 1 or char_length(area_job) > 500 then
      raise exception using errcode = '22023',
        message = 'each area needs a job of 1 to 500 characters';
    end if;
    if public.text_has_likely_secret(area_job) then
      raise exception using errcode = '22023',
        message = 'an area job looks like it contains a credential';
    end if;
  end loop;
end;
$function$;

revoke all on function public.validate_pipeline_template_areas(jsonb) from public, anon, authenticated;

create or replace function public.create_pipeline_template(
  p_organization_id uuid,
  p_slug text,
  p_name text,
  p_summary text,
  p_category text,
  p_capability text,
  p_areas jsonb,
  p_topology public.graph_topology
)
returns table (template_id uuid, slug text, version integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  trimmed_slug text := btrim(coalesce(p_slug, ''));
  trimmed_name text := btrim(coalesce(p_name, ''));
  trimmed_summary text := btrim(coalesce(p_summary, ''));
  new_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if trimmed_slug !~ '^[a-z0-9_]{1,60}$' then
    raise exception using errcode = '22023',
      message = 'the template key must be 1-60 characters of a-z, 0-9, or underscore';
  end if;
  if char_length(trimmed_name) < 1 or char_length(trimmed_name) > 160 then
    raise exception using errcode = '22023', message = 'a template name of 1 to 160 characters is required';
  end if;
  if char_length(trimmed_summary) < 1 or char_length(trimmed_summary) > 2000 then
    raise exception using errcode = '22023', message = 'a template summary of 1 to 2000 characters is required';
  end if;
  if p_category not in ('AUDIT', 'BUILD', 'REVIEW', 'INVESTIGATION') then
    raise exception using errcode = '22023', message = 'unknown template category';
  end if;
  if public.text_has_likely_secret(trimmed_name) or public.text_has_likely_secret(trimmed_summary) then
    raise exception using errcode = '22023', message = 'template details look like they contain a credential';
  end if;
  perform public.validate_pipeline_template_areas(p_areas);
  if exists (
    select 1 from public.graph_templates existing
    where existing.organization_id = p_organization_id
      and existing.slug = trimmed_slug and not existing.is_archived
  ) then
    raise exception using errcode = '23505',
      message = 'a template with this key already exists; edit it or pick another key';
  end if;

  insert into public.graph_templates (
    organization_id, slug, name, description, topology, definition, version, created_by
  ) values (
    p_organization_id, trimmed_slug, trimmed_name, trimmed_summary, p_topology,
    jsonb_build_object(
      'kind', 'audit_areas',
      'category', p_category,
      'capability', p_capability,
      'areas', p_areas
    ),
    1, caller_id
  ) returning id into new_id;

  perform public.record_activity_event(
    p_organization_id, null,
    'pipeline_template.created'::public.activity_event_type,
    'graph_template', new_id,
    format('Pipeline template %s created', trimmed_name),
    jsonb_build_object('slug', trimmed_slug, 'category', p_category, 'areaCount', jsonb_array_length(p_areas))
  );

  return query select new_id, trimmed_slug, 1;
end;
$function$;

revoke all on function public.create_pipeline_template(uuid, text, text, text, text, text, jsonb, public.graph_topology) from public, anon;
grant execute on function public.create_pipeline_template(uuid, text, text, text, text, text, jsonb, public.graph_topology) to authenticated;

create or replace function public.update_pipeline_template(
  p_organization_id uuid,
  p_template_id uuid,
  p_name text,
  p_summary text,
  p_category text,
  p_capability text,
  p_areas jsonb,
  p_topology public.graph_topology
)
returns table (template_id uuid, slug text, version integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  template_record public.graph_templates%rowtype;
  trimmed_name text := btrim(coalesce(p_name, ''));
  trimmed_summary text := btrim(coalesce(p_summary, ''));
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  select existing.* into template_record from public.graph_templates existing
  where existing.id = p_template_id and existing.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'template not found';
  end if;
  if template_record.is_archived then
    raise exception using errcode = '22023', message = 'this template was deleted';
  end if;
  if char_length(trimmed_name) < 1 or char_length(trimmed_name) > 160 then
    raise exception using errcode = '22023', message = 'a template name of 1 to 160 characters is required';
  end if;
  if char_length(trimmed_summary) < 1 or char_length(trimmed_summary) > 2000 then
    raise exception using errcode = '22023', message = 'a template summary of 1 to 2000 characters is required';
  end if;
  if p_category not in ('AUDIT', 'BUILD', 'REVIEW', 'INVESTIGATION') then
    raise exception using errcode = '22023', message = 'unknown template category';
  end if;
  if public.text_has_likely_secret(trimmed_name) or public.text_has_likely_secret(trimmed_summary) then
    raise exception using errcode = '22023', message = 'template details look like they contain a credential';
  end if;
  perform public.validate_pipeline_template_areas(p_areas);

  update public.graph_templates existing
  set name = trimmed_name,
      description = trimmed_summary,
      topology = p_topology,
      definition = jsonb_build_object(
        'kind', 'audit_areas',
        'category', p_category,
        'capability', p_capability,
        'areas', p_areas
      ),
      version = existing.version + 1,
      updated_at = now()
  where existing.id = p_template_id
  returning existing.* into template_record;

  perform public.record_activity_event(
    p_organization_id, null,
    'pipeline_template.updated'::public.activity_event_type,
    'graph_template', p_template_id,
    format('Pipeline template %s updated to v%s', trimmed_name, template_record.version),
    jsonb_build_object('slug', template_record.slug, 'version', template_record.version)
  );

  return query select template_record.id, template_record.slug, template_record.version;
end;
$function$;

revoke all on function public.update_pipeline_template(uuid, uuid, text, text, text, text, jsonb, public.graph_topology) from public, anon;
grant execute on function public.update_pipeline_template(uuid, uuid, text, text, text, text, jsonb, public.graph_topology) to authenticated;

create or replace function public.delete_pipeline_template(
  p_organization_id uuid,
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  template_record public.graph_templates%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  select existing.* into template_record from public.graph_templates existing
  where existing.id = p_template_id and existing.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'template not found';
  end if;

  -- Recorded before the delete; graphs planned from it keep their rows
  -- (graphs.template_id is ON DELETE SET NULL), so history survives the
  -- template.
  perform public.record_activity_event(
    p_organization_id, null,
    'pipeline_template.deleted'::public.activity_event_type,
    'graph_template', p_template_id,
    format('Pipeline template %s deleted', template_record.name),
    jsonb_build_object('slug', template_record.slug, 'version', template_record.version)
  );

  delete from public.graph_templates existing where existing.id = p_template_id;
end;
$function$;

revoke all on function public.delete_pipeline_template(uuid, uuid) from public, anon;
grant execute on function public.delete_pipeline_template(uuid, uuid) to authenticated;
