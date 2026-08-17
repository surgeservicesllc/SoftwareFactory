-- Each posting chooses its model and its work effort (owner order,
-- 2026-08-17: "for each Bot Assigned, need to also be able to choose the
-- Model (Fable 5, Opus 5, etc.) and Work Effort").
--
-- A bot carries a default model; a posting may override it for that project,
-- and names how hard the bot should think while working there. Both are
-- per-posting execution preferences, so they live on `bot_assignments`
-- beside the role and permissions the configuration round added — set
-- through one small owner/admin operation rather than by widening the batch
-- assign function, and recorded like every other assignment change.

alter table public.bot_assignments
  add column if not exists model text,
  add column if not exists work_effort text not null default 'medium';

alter table public.bot_assignments
  drop constraint if exists bot_assignments_model_shape,
  drop constraint if exists bot_assignments_work_effort_known;
alter table public.bot_assignments
  add constraint bot_assignments_model_shape check (
    model is null or (
      char_length(model) between 1 and 128
      and model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  add constraint bot_assignments_work_effort_known check (
    work_effort in ('low', 'medium', 'high', 'max')
  );

comment on column public.bot_assignments.model is
  'Per-posting model override. Null means the bot''s own default model; bounded to an identifier shape so it can never carry a credential.';
comment on column public.bot_assignments.work_effort is
  'How hard the posting should think: low, medium, high, or max.';

create or replace function public.set_bot_assignment_execution(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_model text default null,
  p_work_effort text default null
)
returns table (assignment_id uuid, model text, work_effort text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  assignment_record public.bot_assignments%rowtype;
  trimmed_model text := nullif(btrim(coalesce(p_model, '')), '');
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.can_manage_organization(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'organization owner or administrator access is required';
  end if;
  if trimmed_model is not null and (
    char_length(trimmed_model) > 128
    or trimmed_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ) then
    raise exception using errcode = '22023',
      message = 'the model must be a plain identifier of up to 128 characters';
  end if;
  if p_work_effort is not null
    and p_work_effort not in ('low', 'medium', 'high', 'max') then
    raise exception using errcode = '22023',
      message = 'work effort must be low, medium, high, or max';
  end if;

  select assignment.* into assignment_record
  from public.bot_assignments assignment
  where assignment.id = p_assignment_id
    and assignment.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'assignment not found';
  end if;
  if assignment_record.status = 'released'::public.bot_assignment_status then
    raise exception using errcode = '22023',
      message = 'a released posting cannot be configured; assign the bot again first';
  end if;

  update public.bot_assignments assignment
  set model = case when p_model is null then assignment.model else trimmed_model end,
      work_effort = coalesce(p_work_effort, assignment.work_effort)
  where assignment.id = p_assignment_id
  returning assignment.* into assignment_record;

  insert into public.activity_events (
    organization_id, project_id, actor_user_id, event_type,
    entity_type, entity_id, description, metadata
  ) values (
    p_organization_id, assignment_record.project_id, caller_id,
    'bot.assignment_changed'::public.activity_event_type,
    'bot_assignment', assignment_record.id,
    'Posting execution preferences changed',
    jsonb_build_object(
      'model', assignment_record.model,
      'workEffort', assignment_record.work_effort
    )
  );

  return query select assignment_record.id, assignment_record.model, assignment_record.work_effort;
end;
$function$;

revoke all on function public.set_bot_assignment_execution(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_bot_assignment_execution(uuid, uuid, text, text) to authenticated;
