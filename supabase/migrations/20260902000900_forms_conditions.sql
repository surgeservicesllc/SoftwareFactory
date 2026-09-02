-- ---------------------------------------------------------------------------
-- Increment 34 — the form asks the next question (ADR-238).
--
-- PestPac's forms "lack conditional logic"; WorkWave triggers a form from
-- the service type only in a paid tier. Both are the same sentence: the
-- form should know what to ask next, and the visit should know which
-- form it needs, without a person remembering either.
--
-- This file adds:
--
--   crm_form_fields.depends_on_field_id / show_when
--       a question asked only when an EARLIER question on the same
--       template was answered a certain way: answered, is_true,
--       is_false, equals <value>, any_of [<values>]. Earlier-only is
--       what makes a cycle impossible.
--   crm_form_condition_met() / crm_form_question_asked()
--       the rule, as arithmetic over the answers present; a question
--       whose parent is itself unasked is unasked
--   crm_form_instance_questions()
--       every question of a form with `asked` and `answered` computed
--       live, so the page and the database agree on what is being asked
--   crm_check_form_completeness()   (replaced)
--       "completed" counts only the required questions that are ASKED
--   crm_form_answers_check_asked
--       an answer to a question the form is not asking is refused
--   crm_form_templates.trigger_service_types + crm_work_orders_assign_forms
--       a visit whose service type a template names gets that form
--       assigned the moment the visit is created, once
--
-- An answer hidden by a later change of its parent is kept, not deleted:
-- it is not shown and not counted, and reappears if the condition is met
-- again. A form never silently loses what somebody wrote.
-- ---------------------------------------------------------------------------

alter table public.crm_form_fields
  add column if not exists depends_on_field_id uuid,
  add column if not exists show_when jsonb;

alter table public.crm_form_fields drop constraint if exists crm_form_fields_condition_whole;
alter table public.crm_form_fields add constraint crm_form_fields_condition_whole
  check ((depends_on_field_id is null) = (show_when is null));

alter table public.crm_form_fields drop constraint if exists crm_form_fields_condition_not_self;
alter table public.crm_form_fields add constraint crm_form_fields_condition_not_self
  check (depends_on_field_id is distinct from id);

alter table public.crm_form_fields drop constraint if exists crm_form_fields_depends_on_same_org;
alter table public.crm_form_fields add constraint crm_form_fields_depends_on_same_org
  foreign key (organization_id, depends_on_field_id)
  references public.crm_form_fields (organization_id, id) on delete cascade;

-- The condition's shape: an op, and exactly the operand that op takes.
alter table public.crm_form_fields drop constraint if exists crm_form_fields_show_when_shape;
alter table public.crm_form_fields add constraint crm_form_fields_show_when_shape
  check (
    show_when is null
    or (
      jsonb_typeof(show_when) = 'object'
      and pg_column_size(show_when) <= 8000
      -- Every operand test is wrapped so a missing key reads as false, never
      -- as the NULL a CHECK would wave through.
      and coalesce((show_when->>'op') in ('answered', 'is_true', 'is_false', 'equals', 'any_of'), false)
      and ((show_when->>'op') <> 'equals'
           or coalesce(jsonb_typeof(show_when->'value') = 'string'
                       and char_length(show_when->>'value') between 1 and 4000, false))
      and ((show_when->>'op') <> 'any_of'
           or coalesce(jsonb_typeof(show_when->'values') = 'array'
                       and jsonb_array_length(show_when->'values') between 1 and 100, false))
      and ((show_when->>'op') in ('equals', 'any_of')
           or (not (show_when ? 'value') and not (show_when ? 'values')))
    )
  );

create index if not exists crm_form_fields_depends_on_idx
  on public.crm_form_fields (organization_id, depends_on_field_id)
  where depends_on_field_id is not null;

-- A condition points at an earlier question on the same template, and its
-- op fits that question's type. Checked on the child when it is written,
-- and on a parent whose position moves past a child.
create or replace function public.crm_check_field_condition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_parent record;
  v_op text;
begin
  if new.depends_on_field_id is not null then
    select f.template_id, f.position, f.field_type::text as field_type
      into v_parent
      from public.crm_form_fields f
     where f.id = new.depends_on_field_id;
    if v_parent is null then
      raise exception 'the question this one depends on does not exist'
        using errcode = 'foreign_key_violation';
    end if;
    if v_parent.template_id <> new.template_id then
      raise exception 'a question can only depend on a question of the same form'
        using errcode = 'check_violation';
    end if;
    if v_parent.position >= new.position then
      raise exception 'a question can only depend on an earlier question'
        using errcode = 'check_violation';
    end if;
    v_op := new.show_when->>'op';
    if v_op in ('is_true', 'is_false') and v_parent.field_type <> 'boolean' then
      raise exception 'is_true and is_false apply to a yes/no question'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.position <> old.position and exists (
    select 1 from public.crm_form_fields child
     where child.depends_on_field_id = new.id and child.position <= new.position
  ) then
    raise exception 'a question cannot move past one that depends on it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_check_field_condition()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_form_fields_check_condition on public.crm_form_fields;
create trigger crm_form_fields_check_condition
  before insert or update on public.crm_form_fields
  for each row execute function public.crm_check_field_condition();

-- The rule. `a` is the parent's answer row, or null when there is none.
create or replace function public.crm_form_condition_met(p_show_when jsonb, a public.crm_form_answers)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case p_show_when->>'op'
    when 'answered' then a.id is not null
    when 'is_true' then coalesce(a.value_boolean, false)
    when 'is_false' then a.id is not null and a.value_boolean = false
    when 'equals' then a.id is not null and (
         (a.value_text is not null and a.value_text = p_show_when->>'value')
      or (a.value_number is not null and a.value_number::text = p_show_when->>'value')
      or (a.value_date is not null and a.value_date::text = p_show_when->>'value')
      or (a.value_boolean is not null and a.value_boolean::text = p_show_when->>'value')
      or (a.value_options is not null and (p_show_when->>'value') = any(a.value_options))
    )
    when 'any_of' then a.id is not null and (
         (a.value_text is not null and a.value_text in (select jsonb_array_elements_text(p_show_when->'values')))
      or (a.value_number is not null and a.value_number::text in (select jsonb_array_elements_text(p_show_when->'values')))
      or (a.value_date is not null and a.value_date::text in (select jsonb_array_elements_text(p_show_when->'values')))
      or (a.value_boolean is not null and a.value_boolean::text in (select jsonb_array_elements_text(p_show_when->'values')))
      or (a.value_options is not null and a.value_options && array(select jsonb_array_elements_text(p_show_when->'values')))
    )
    else false
  end;
$$;

revoke all on function public.crm_form_condition_met(jsonb, public.crm_form_answers) from public, anon, service_role;
grant execute on function public.crm_form_condition_met(jsonb, public.crm_form_answers) to authenticated;

-- Is this question asked on this form, given the answers so far? Walks up
-- the chain of conditions; an unasked parent makes every descendant
-- unasked. The chain is finite because a condition only points earlier.
create or replace function public.crm_form_question_asked(p_instance uuid, p_field uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_depends uuid;
  v_show_when jsonb;
  v_answer public.crm_form_answers;
  v_depth integer := 0;
begin
  select f.depends_on_field_id, f.show_when into v_depends, v_show_when
    from public.crm_form_fields f where f.id = p_field;
  if not found then
    return false;
  end if;
  while v_depends is not null loop
    v_depth := v_depth + 1;
    if v_depth > 500 then
      return false;
    end if;
    select a.* into v_answer
      from public.crm_form_answers a
     where a.instance_id = p_instance and a.field_id = v_depends;
    if not found then
      v_answer := null;
    end if;
    if not public.crm_form_condition_met(v_show_when, v_answer) then
      return false;
    end if;
    select f.depends_on_field_id, f.show_when into v_depends, v_show_when
      from public.crm_form_fields f where f.id = v_depends;
  end loop;
  return true;
end;
$$;

revoke all on function public.crm_form_question_asked(uuid, uuid) from public, anon, service_role;
grant execute on function public.crm_form_question_asked(uuid, uuid) to authenticated;

-- Every question of a form, in order, with what is asked and what is
-- answered computed live under the caller's RLS.
create or replace function public.crm_form_instance_questions(p_instance uuid)
returns table (
  field_id uuid,
  field_position integer,
  label text,
  field_type public.crm_field_type,
  required boolean,
  help_text text,
  options text[],
  depends_on_field_id uuid,
  depends_on_label text,
  show_when jsonb,
  asked boolean,
  answered boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select f.id, f.position, f.label, f.field_type, f.required, f.help_text, f.options,
         f.depends_on_field_id, parent.label, f.show_when,
         public.crm_form_question_asked(p_instance, f.id),
         exists (select 1 from public.crm_form_answers a where a.instance_id = p_instance and a.field_id = f.id)
    from public.crm_form_instances i
    join public.crm_form_fields f on f.template_id = i.template_id
    left join public.crm_form_fields parent on parent.id = f.depends_on_field_id
   where i.id = p_instance
   order by f.position;
$$;

revoke all on function public.crm_form_instance_questions(uuid) from public, anon, service_role;
grant execute on function public.crm_form_instance_questions(uuid) to authenticated;

-- "Completed" counts only the required questions the form is asking.
create or replace function public.crm_check_form_completeness()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_missing integer;
begin
  if new.status <> 'completed' then
    return new;
  end if;
  select count(*) into v_missing
    from public.crm_form_fields f
   where f.template_id = new.template_id
     and f.required
     and public.crm_form_question_asked(new.id, f.id)
     and not exists (
       select 1 from public.crm_form_answers a
        where a.instance_id = new.id and a.field_id = f.id
     );
  if v_missing > 0 then
    raise exception '% required question(s) are unanswered', v_missing
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- An answer to a question the form is not asking, given the answers
-- already given, is refused: the parent is answered first.
create or replace function public.crm_check_answer_asked()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.crm_form_question_asked(new.instance_id, new.field_id) then
    raise exception 'that question is not asked on this form, given the answers so far'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_check_answer_asked()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_form_answers_check_asked on public.crm_form_answers;
create trigger crm_form_answers_check_asked
  before insert or update on public.crm_form_answers
  for each row execute function public.crm_check_answer_asked();

-- ---------------------------------------------------------------------------
-- The visit knows which form it needs.
-- ---------------------------------------------------------------------------

alter table public.crm_form_templates
  add column if not exists trigger_service_types text[] not null default '{}';

-- A CHECK cannot hold a subquery, so the per-entry bound is a function.
create or replace function public.crm_service_type_list_valid(p_types text[])
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(array_length(p_types, 1), 0) <= 50
     and char_length(array_to_string(p_types, ',')) <= 6000
     and coalesce((select bool_and(char_length(btrim(s)) between 1 and 120) from unnest(p_types) s), true);
$$;

revoke all on function public.crm_service_type_list_valid(text[]) from public, anon, service_role;
grant execute on function public.crm_service_type_list_valid(text[]) to authenticated;

alter table public.crm_form_templates drop constraint if exists crm_form_templates_triggers_bounded;
alter table public.crm_form_templates add constraint crm_form_templates_triggers_bounded
  check (public.crm_service_type_list_valid(trigger_service_types));

create or replace function public.crm_assign_forms_for_visit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.crm_form_instances
    (organization_id, template_id, account_id, property_id, work_order_id, technician_id, created_by)
  select new.organization_id, t.id, new.account_id, new.property_id, new.id, new.technician_id, new.created_by
    from public.crm_form_templates t
   where t.organization_id = new.organization_id
     and t.active
     and exists (
       select 1 from unnest(t.trigger_service_types) s
        where lower(btrim(s)) = lower(btrim(new.service_type))
     )
     and not exists (
       select 1 from public.crm_form_instances i
        where i.work_order_id = new.id and i.template_id = t.id
     )
   order by t.name, t.version desc;
  return new;
end;
$$;

revoke all on function public.crm_assign_forms_for_visit()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_work_orders_assign_forms on public.crm_work_orders;
create trigger crm_work_orders_assign_forms
  after insert on public.crm_work_orders
  for each row execute function public.crm_assign_forms_for_visit();
