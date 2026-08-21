-- Selecting a pipeline for a project, and making the selection stick.
--
-- "Use" on a template card had nowhere to write to. It opened a dialog that
-- planned a graph, which is a different and heavier act: planning schedules
-- work. What was missing is the light one — recording that a project's
-- factory runs this pipeline — so the AI Factory journey could show what was
-- chosen instead of calling the step done because a project happened to
-- exist.
--
-- A project may select many pipelines, built-in or custom. A built-in is
-- identified by its code key and carries no row in graph_templates; a custom
-- one carries both its key and the template id, so deleting the template
-- takes its selections with it. Selection is routing intent, never
-- execution: nothing here dispatches a bot or spends a token.

alter type public.activity_event_type add value if not exists 'pipeline.selected';
alter type public.activity_event_type add value if not exists 'pipeline.deselected';

create table if not exists public.project_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  -- The template's stable key: a built-in's code key, or a custom template's
  -- slug. Custom slugs may not shadow a built-in key, so one key names one
  -- template within an organization.
  template_key text not null check (template_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  -- Set for a custom template only. A built-in lives in source, versioned by
  -- review, and has no row to point at.
  template_id uuid references public.graph_templates(id) on delete cascade,
  selected_by uuid not null references auth.users(id) on delete restrict,
  selected_at timestamptz not null default now(),

  constraint project_pipelines_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint project_pipelines_unique unique (project_id, template_key)
);

comment on table public.project_pipelines is
  'Which pipeline templates a project runs. Selection is routing intent recorded by a person; it dispatches nothing.';

create index if not exists project_pipelines_project_idx
  on public.project_pipelines (project_id, selected_at desc);

create index if not exists project_pipelines_organization_idx
  on public.project_pipelines (organization_id, selected_at desc);

create index if not exists project_pipelines_template_idx
  on public.project_pipelines (template_id)
  where template_id is not null;

alter table public.project_pipelines enable row level security;
alter table public.project_pipelines force row level security;

-- No browser write path and no service-role read path: selections are read
-- and written through the definer functions below, under the caller's own
-- identity, so an organization boundary is never crossed by a widened grant.
revoke all on table public.project_pipelines from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

/*
 * Selecting is idempotent: pressing Use on a template already selected
 * returns the existing row rather than raising, because a person pressing a
 * toggle twice has expressed one intention, not an error. Deselecting an
 * unselected template is likewise a no-op that reports it changed nothing.
 */
create or replace function public.select_project_pipeline(
  p_organization_id uuid,
  p_project_id uuid,
  p_template_key text
)
returns table (
  pipeline_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  pipeline_selected_at timestamptz,
  pipeline_created boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_key text := btrim(coalesce(p_template_key, ''));
  v_project public.projects%rowtype;
  v_template_id uuid;
  v_existing public.project_pipelines%rowtype;
  v_new public.project_pipelines%rowtype;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if v_key !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception using errcode = '22023',
      message = 'a template key is 1-80 characters of a-z, 0-9, or underscore';
  end if;

  -- Two callers pressing Use on the same template must not both insert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:project-pipeline:' || p_project_id::text || ':' || v_key,
      0
    )
  );

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'project was not found';
  end if;
  if v_project.status = 'archived'::public.project_status then
    raise exception using errcode = '55000',
      message = 'an archived project cannot change its pipelines';
  end if;

  -- A custom template must belong to this organization and still be live. A
  -- key with no row is a built-in, which the application validates against
  -- the compiled set before it ever gets here.
  select template.id into v_template_id
  from public.graph_templates template
  where template.organization_id = p_organization_id
    and template.slug = v_key
    and template.is_archived = false
  order by template.version desc
  limit 1;

  select existing.* into v_existing
  from public.project_pipelines existing
  where existing.project_id = p_project_id
    and existing.template_key = v_key;
  if found then
    -- Already selected. Report the row that is there, and record nothing:
    -- an audit trail of unchanged state is noise, not evidence.
    return query
    select v_existing.id, v_existing.template_key, v_existing.template_id,
           v_existing.selected_at, false;
    return;
  end if;

  insert into public.project_pipelines
    (organization_id, project_id, template_key, template_id, selected_by)
  values (p_organization_id, p_project_id, v_key, v_template_id, v_caller)
  returning * into v_new;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    p_project_id,
    v_caller,
    'pipeline.selected'::public.activity_event_type,
    'project_pipeline',
    v_new.id,
    'Pipeline template selected for the project. Selection is routing intent, not execution.',
    pg_catalog.jsonb_build_object(
      'template_key', v_key,
      'template_id', v_template_id,
      'built_in', v_template_id is null
    )
  );

  return query
  select v_new.id, v_new.template_key, v_new.template_id, v_new.selected_at, true;
end;
$function$;

create or replace function public.deselect_project_pipeline(
  p_organization_id uuid,
  p_project_id uuid,
  p_template_key text
)
returns table (pipeline_removed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_key text := btrim(coalesce(p_template_key, ''));
  v_removed public.project_pipelines%rowtype;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'softwarefactory:project-pipeline:' || p_project_id::text || ':' || v_key,
      0
    )
  );

  delete from public.project_pipelines existing
  where existing.organization_id = p_organization_id
    and existing.project_id = p_project_id
    and existing.template_key = v_key
  returning * into v_removed;
  if not found then
    return query select false;
    return;
  end if;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id,
    p_project_id,
    v_caller,
    'pipeline.deselected'::public.activity_event_type,
    'project_pipeline',
    v_removed.id,
    'Pipeline template removed from the project. Graphs already planned from it keep their records.',
    pg_catalog.jsonb_build_object(
      'template_key', v_removed.template_key,
      'template_id', v_removed.template_id,
      'built_in', v_removed.template_id is null
    )
  );

  return query select true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- Every selection in the organization, for a console that shows several
-- projects at once. A member may read; only an owner or administrator writes.
create or replace function public.list_project_pipelines(p_organization_id uuid)
returns table (
  pipeline_id uuid,
  pipeline_project_id uuid,
  pipeline_template_key text,
  pipeline_template_id uuid,
  pipeline_selected_at timestamptz,
  pipeline_template_name text
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
  select
    selection.id,
    selection.project_id,
    selection.template_key,
    selection.template_id,
    selection.selected_at,
    template.name
  from public.project_pipelines selection
  left join public.graph_templates template
    on template.id = selection.template_id
  where selection.organization_id = p_organization_id
  order by selection.selected_at asc, selection.template_key asc;
end;
$function$;

revoke all on function public.select_project_pipeline(uuid, uuid, text)
  from public, anon, service_role;
revoke all on function public.deselect_project_pipeline(uuid, uuid, text)
  from public, anon, service_role;
revoke all on function public.list_project_pipelines(uuid)
  from public, anon, service_role;

grant execute on function public.select_project_pipeline(uuid, uuid, text) to authenticated;
grant execute on function public.deselect_project_pipeline(uuid, uuid, text) to authenticated;
grant execute on function public.list_project_pipelines(uuid) to authenticated;
