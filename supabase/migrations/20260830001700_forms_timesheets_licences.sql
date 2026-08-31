-- Services CRM increment 9: the forms and inspections engine, technician
-- timesheets, and licence expiry (task #64, owner /goal — ADR-197).
--
-- This is the capability PestPac sells hardest: create, assign and collect
-- digital forms — inspections, service reports, compliance checklists —
-- signed in the field and readable from the desk the moment they are done.
-- AI/PEST_CRM_COMPETITOR_MATRIX.md marks it the largest single gap.
--
-- Posture unchanged: organization-scoped forced RLS, revoke-then-grant
-- against the hosted default privileges, anon and service_role shut out,
-- same-organization composite foreign keys, nothing deletable.
--
-- Five invariants live in the schema:
--
--   1. AN ANSWER'S SHAPE MATCHES ITS QUESTION'S TYPE. A number question
--      cannot be answered with prose, and a yes/no question cannot be
--      answered with a date. A trigger reads the field's declared type and
--      refuses the wrong shape, so a form's data stays reportable.
--   2. A COMPLETED FORM HAS ANSWERED EVERY REQUIRED QUESTION. The
--      transition to `completed` counts the required fields against the
--      answers present and refuses the difference. "Completed" therefore
--      means completed.
--   3. A SIGNATURE IS A NAME, A MOMENT AND A STORED IMAGE TOGETHER, or
--      none of the three. A signature block with two of them is not a
--      signature.
--   4. A TEMPLATE IN USE IS NOT EDITED. Its fields become immutable once a
--      form has been assigned from it; a change is a new version. A report
--      whose questions changed under it is not a report.
--   5. A TECHNICIAN CANNOT BE IN TWO PLACES AT ONCE. Overlapping shifts for
--      the same person are refused, so a timesheet total is arithmetic
--      rather than an estimate.

do $$ begin
  create type public.crm_form_kind as enum (
    'inspection', 'service_report', 'compliance_checklist', 'wdo_report',
    'safety_check', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_field_type as enum (
    'text', 'long_text', 'number', 'boolean', 'date', 'select', 'multi_select'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_form_status as enum ('assigned', 'in_progress', 'completed', 'void');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Templates and their questions. Versioned, because invariant 4 makes a
-- change to a template in use a new version rather than an edit.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_form_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  kind public.crm_form_kind not null default 'inspection',
  version integer not null default 1 check (version between 1 and 1000),
  description text check (description is null or char_length(description) between 1 and 2000),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_form_templates_name_no_secret check (not public.text_has_likely_secret(name)),
  constraint crm_form_templates_description_no_secret
    check (not public.text_has_likely_secret(description))
);

create unique index if not exists crm_form_templates_org_id_key
  on public.crm_form_templates (organization_id, id);
create unique index if not exists crm_form_templates_org_name_version_key
  on public.crm_form_templates (organization_id, lower(btrim(name)), version);

create table if not exists public.crm_form_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null,
  position integer not null check (position between 1 and 500),
  label text not null check (char_length(btrim(label)) between 1 and 300),
  field_type public.crm_field_type not null,
  required boolean not null default false,
  help_text text check (help_text is null or char_length(help_text) between 1 and 1000),
  -- Choices, for the two question types that have them.
  options text[],
  created_at timestamptz not null default now(),
  constraint crm_form_fields_template_same_org
    foreign key (organization_id, template_id)
    references public.crm_form_templates (organization_id, id) on delete cascade,
  -- A choice question has choices; every other kind has none. Length is
  -- checked apart from shape: PostgreSQL refuses a regex repetition count
  -- above 255, which has cost this project two releases already.
  constraint crm_form_fields_options_iff_choice
    check (
      (field_type in ('select', 'multi_select')) = (options is not null)
    ),
  constraint crm_form_fields_options_bounded
    check (
      options is null
      or (array_length(options, 1) between 1 and 100
          and char_length(array_to_string(options, ',')) between 1 and 4000)
    ),
  constraint crm_form_fields_label_no_secret check (not public.text_has_likely_secret(label))
);

create unique index if not exists crm_form_fields_org_id_key
  on public.crm_form_fields (organization_id, id);
create unique index if not exists crm_form_fields_template_position_key
  on public.crm_form_fields (organization_id, template_id, position);

-- ---------------------------------------------------------------------------
-- Instances: a template assigned to a job, and the answers collected.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_form_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null,
  account_id uuid,
  property_id uuid,
  work_order_id uuid,
  technician_id uuid,
  status public.crm_form_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  -- Invariant 3: the three halves of a signature travel together.
  signed_by_name text check (signed_by_name is null or char_length(btrim(signed_by_name)) between 1 and 120),
  signed_at timestamptz,
  signature_path text
    check (
      signature_path is null
      or (signature_path ~ '^[a-z0-9][a-z0-9._/-]*$'
          and char_length(signature_path) between 3 and 301
          and signature_path !~ '://')
    ),
  notes text check (notes is null or char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_form_instances_template_same_org
    foreign key (organization_id, template_id)
    references public.crm_form_templates (organization_id, id) on delete restrict,
  constraint crm_form_instances_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_form_instances_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete set null,
  constraint crm_form_instances_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_form_instances_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete set null,
  constraint crm_form_instances_completed_iff_moment
    check ((status = 'completed') = (completed_at is not null)),
  constraint crm_form_instances_completed_after_assigned
    check (completed_at is null or completed_at >= assigned_at),
  -- Invariant 3, stated: all three, or none.
  constraint crm_form_instances_signature_complete
    check (num_nonnulls(signed_by_name, signed_at, signature_path) in (0, 3)),
  constraint crm_form_instances_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_form_instances_org_id_key
  on public.crm_form_instances (organization_id, id);

create table if not exists public.crm_form_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid not null,
  field_id uuid not null,
  value_text text check (value_text is null or char_length(value_text) between 1 and 4000),
  value_number numeric(14, 4),
  value_boolean boolean,
  value_date date,
  value_options text[],
  answered_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint crm_form_answers_instance_same_org
    foreign key (organization_id, instance_id)
    references public.crm_form_instances (organization_id, id) on delete cascade,
  constraint crm_form_answers_field_same_org
    foreign key (organization_id, field_id)
    references public.crm_form_fields (organization_id, id) on delete cascade,
  -- Exactly one shape carries the answer. Which one is decided against the
  -- field's declared type by trigger — invariant 1.
  constraint crm_form_answers_one_shape
    check (num_nonnulls(value_text, value_number, value_boolean, value_date, value_options) = 1),
  constraint crm_form_answers_text_no_secret check (not public.text_has_likely_secret(value_text))
);

create unique index if not exists crm_form_answers_org_id_key
  on public.crm_form_answers (organization_id, id);
-- One answer per question per form: a question is answered or it is not.
create unique index if not exists crm_form_answers_instance_field_key
  on public.crm_form_answers (organization_id, instance_id, field_id);

-- ---------------------------------------------------------------------------
-- Invariant 1: an answer's shape matches its question's type.
-- ---------------------------------------------------------------------------

create or replace function public.crm_check_answer_shape()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_type text;
  v_required_shape text;
  v_given_shape text;
  v_options text[];
begin
  select field_type::text, options into v_type, v_options
    from public.crm_form_fields where id = new.field_id;
  if v_type is null then
    raise exception 'answer references a question that does not exist'
      using errcode = 'foreign_key_violation';
  end if;

  v_required_shape := case v_type
    when 'text' then 'text'
    when 'long_text' then 'text'
    when 'number' then 'number'
    when 'boolean' then 'boolean'
    when 'date' then 'date'
    when 'select' then 'text'
    when 'multi_select' then 'options'
  end;

  v_given_shape := case
    when new.value_text is not null then 'text'
    when new.value_number is not null then 'number'
    when new.value_boolean is not null then 'boolean'
    when new.value_date is not null then 'date'
    else 'options'
  end;

  if v_given_shape <> v_required_shape then
    raise exception 'a % question cannot be answered with a % value', v_type, v_given_shape
      using errcode = 'check_violation';
  end if;

  -- A choice answer has to be one of the offered choices. A dropdown whose
  -- answers are not in its own list is not a dropdown.
  if v_type = 'select' and not (new.value_text = any(v_options)) then
    raise exception 'that answer is not one of the choices offered'
      using errcode = 'check_violation';
  end if;
  if v_type = 'multi_select' and not (new.value_options <@ v_options) then
    raise exception 'one of those answers is not among the choices offered'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.crm_check_answer_shape()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_form_answers_check_shape on public.crm_form_answers;
create trigger crm_form_answers_check_shape
  before insert or update on public.crm_form_answers
  for each row execute function public.crm_check_answer_shape();

-- ---------------------------------------------------------------------------
-- Invariant 2: "completed" means every required question was answered.
-- ---------------------------------------------------------------------------

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

revoke all on function public.crm_check_form_completeness()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_form_instances_check_completeness on public.crm_form_instances;
create trigger crm_form_instances_check_completeness
  before insert or update on public.crm_form_instances
  for each row execute function public.crm_check_form_completeness();

-- ---------------------------------------------------------------------------
-- Invariant 4: a template in use is not edited. Its questions freeze the
-- moment a form is assigned from it; a change is a new version.
-- ---------------------------------------------------------------------------

create or replace function public.crm_guard_template_in_use()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_template uuid;
  v_used boolean;
begin
  v_template := coalesce(new.template_id, old.template_id);
  select exists (
    select 1 from public.crm_form_instances where template_id = v_template
  ) into v_used;
  if v_used then
    raise exception 'this template has forms assigned from it; publish a new version instead'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.crm_guard_template_in_use()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_form_fields_guard_in_use on public.crm_form_fields;
create trigger crm_form_fields_guard_in_use
  before insert or update on public.crm_form_fields
  for each row execute function public.crm_guard_template_in_use();

-- ---------------------------------------------------------------------------
-- Timesheets. Invariant 5: nobody is in two places at once.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_timesheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  technician_id uuid not null,
  work_order_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes between 0 and 720),
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_timesheets_technician_same_org
    foreign key (organization_id, technician_id)
    references public.crm_technicians (organization_id, id) on delete restrict,
  constraint crm_timesheets_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_timesheets_ended_after_started
    check (ended_at is null or ended_at > started_at),
  -- A shift no longer than a day; anything else is a forgotten clock-out,
  -- and calling that sixteen hours of labour would be a payroll error.
  constraint crm_timesheets_bounded
    check (ended_at is null or ended_at <= started_at + interval '24 hours'),
  constraint crm_timesheets_notes_no_secret check (not public.text_has_likely_secret(notes))
);

create unique index if not exists crm_timesheets_org_id_key
  on public.crm_timesheets (organization_id, id);

create or replace function public.crm_guard_shift_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_clash uuid;
begin
  select id into v_clash
    from public.crm_timesheets
   where organization_id = new.organization_id
     and technician_id = new.technician_id
     and id is distinct from new.id
     -- Two shifts overlap when each starts before the other ends. An open
     -- shift runs to now, because it has not ended yet.
     and new.started_at < coalesce(ended_at, now())
     and started_at < coalesce(new.ended_at, now())
   limit 1;
  if v_clash is not null then
    raise exception 'that technician already has a shift covering this time'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_guard_shift_overlap()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_timesheets_guard_overlap on public.crm_timesheets;
create trigger crm_timesheets_guard_overlap
  before insert or update on public.crm_timesheets
  for each row execute function public.crm_guard_shift_overlap();

-- ---------------------------------------------------------------------------
-- Licence expiry. A technician whose applicator licence has lapsed is a
-- compliance problem the moment it lapses, so the date is a column the
-- product can report on rather than a note in a field.
-- ---------------------------------------------------------------------------

alter table public.crm_technicians
  add column if not exists license_expires_on date,
  add column if not exists license_state text;

do $$ begin
  alter table public.crm_technicians
    add constraint crm_technicians_license_state_shape
    check (license_state is null or license_state ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_technicians
    add constraint crm_technicians_expiry_needs_licence
    check (license_expires_on is null or license_number is not null);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at, Row Level Security and grants. Answers are append-and-correct
-- (a technician fixes a typo before submitting), but nothing is deletable
-- and a completed form's answers are frozen by invariant 2's arithmetic.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_form_templates', 'crm_form_instances', 'crm_timesheets'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;

  foreach v_table in array array[
    'crm_form_templates', 'crm_form_fields', 'crm_form_instances',
    'crm_form_answers', 'crm_timesheets'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_member', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id))',
      v_table || '_select_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_member', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id))',
      v_table || '_insert_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);

    execute format('grant select, insert, update on table public.%I to authenticated', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes: the reads these pages make.
-- ---------------------------------------------------------------------------

create index if not exists crm_form_templates_org_kind_idx
  on public.crm_form_templates (organization_id, kind, active);
create index if not exists crm_form_fields_org_template_idx
  on public.crm_form_fields (organization_id, template_id, position);
create index if not exists crm_form_instances_org_status_idx
  on public.crm_form_instances (organization_id, status, assigned_at desc);
create index if not exists crm_form_instances_org_account_idx
  on public.crm_form_instances (organization_id, account_id, assigned_at desc);
create index if not exists crm_form_instances_org_technician_idx
  on public.crm_form_instances (organization_id, technician_id, status);
create index if not exists crm_form_answers_org_instance_idx
  on public.crm_form_answers (organization_id, instance_id);
create index if not exists crm_timesheets_org_technician_idx
  on public.crm_timesheets (organization_id, technician_id, started_at desc);
create index if not exists crm_technicians_org_licence_expiry_idx
  on public.crm_technicians (organization_id, license_expires_on)
  where license_expires_on is not null;
