-- Job Seeker: the authenticated /job-seeker command center's data model.
--
-- Everything here is PERSONAL data inside a tenant: a member's career
-- profile, preferences, discovered jobs, match scores, applications, and
-- outreach drafts. So every table is scoped by BOTH organization_id and
-- user_id, and RLS requires both organization membership and row ownership —
-- an admin of the organization does not read a member's career history.
--
-- Three invariants live in the schema rather than in application code,
-- because the application code is replaceable and these must not be:
--
--   1. The approval gate. An application row cannot enter any stage at or
--      beyond APPLIED unless its approval_status is 'approved'. Nothing is
--      ever submitted by default; a buggy or bypassed client hits a CHECK,
--      not a code path.
--   2. Duplicate protection. One job per (organization, user, normalized
--      company, normalized title, external id) — a unique index, so a second
--      discovery of the same posting is a conflict, not a second row.
--   3. Score integrity. A match's total must equal the sum of its component
--      scores, and every component is bounded by its published weight
--      (experience 30, skills 20, leadership 15, industry 10, compensation
--      10, location 10, career growth 5). A score nothing can audit is a
--      number, not a match.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.job_seeker_arrangement as enum ('remote', 'hybrid', 'onsite', 'any');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_seeker_stage as enum (
    'FOUND', 'QUALIFIED', 'RESUME_CREATED', 'READY_FOR_REVIEW', 'APPLIED',
    'FOLLOW_UP', 'RECRUITER_RESPONSE', 'INTERVIEW', 'FINAL_INTERVIEW',
    'OFFER', 'CLOSED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_seeker_approval as enum ('pending_review', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_seeker_document_kind as enum ('resume', 'cover_letter', 'answers');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_seeker_outreach_status as enum ('draft', 'approved', 'sent');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- JSON shape validators (immutable, CHECK-usable)
-- ---------------------------------------------------------------------------

-- A bounded list of bounded strings: the shape of skills, industries, target
-- titles, criteria lists, reasons, and gaps. Refuses anything else.
create or replace function public.job_seeker_text_list_valid(
  p_list jsonb, p_max_items integer, p_max_length integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_entry jsonb;
begin
  if p_list is null or jsonb_typeof(p_list) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_list) > p_max_items then
    return false;
  end if;
  for v_entry in select value from jsonb_array_elements(p_list) loop
    if jsonb_typeof(v_entry) <> 'string' then
      return false;
    end if;
    if char_length(v_entry #>> '{}') not between 1 and p_max_length then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function public.job_seeker_text_list_valid(jsonb, integer, integer)
  from public, anon;
-- CHECK constraints execute as the writing role, and these tables are
-- written directly under RLS — so authenticated must be able to run the
-- validator. It is immutable and reads nothing.
grant execute on function public.job_seeker_text_list_valid(jsonb, integer, integer) to authenticated;

-- Employment/education entries: an array of objects with allowlisted keys
-- only. The career profile is the source of truth the resume generator may
-- draw from, so its shape is a contract, not a suggestion.
create or replace function public.job_seeker_history_valid(p_history jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_entry jsonb;
begin
  if p_history is null or jsonb_typeof(p_history) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_history) > 40 then
    return false;
  end if;
  for v_entry in select value from jsonb_array_elements(p_history) loop
    if jsonb_typeof(v_entry) <> 'object' then
      return false;
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_entry) as key
      where key not in ('organization', 'title', 'started', 'ended', 'summary', 'highlights')
    ) then
      return false;
    end if;
    if jsonb_typeof(v_entry -> 'organization') is distinct from 'string'
      or char_length(v_entry ->> 'organization') not between 1 and 200 then
      return false;
    end if;
    if jsonb_typeof(v_entry -> 'title') is distinct from 'string'
      or char_length(v_entry ->> 'title') not between 1 and 200 then
      return false;
    end if;
    if v_entry ? 'started' and (jsonb_typeof(v_entry -> 'started') is distinct from 'string'
      or char_length(v_entry ->> 'started') not between 1 and 40) then
      return false;
    end if;
    if v_entry ? 'ended' and (jsonb_typeof(v_entry -> 'ended') is distinct from 'string'
      or char_length(v_entry ->> 'ended') not between 1 and 40) then
      return false;
    end if;
    if v_entry ? 'summary' and (jsonb_typeof(v_entry -> 'summary') is distinct from 'string'
      or char_length(v_entry ->> 'summary') > 2000) then
      return false;
    end if;
    if v_entry ? 'highlights'
      and not public.job_seeker_text_list_valid(v_entry -> 'highlights', 20, 500) then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function public.job_seeker_history_valid(jsonb)
  from public, anon;
-- CHECK constraints execute as the writing role, and these tables are
-- written directly under RLS — so authenticated must be able to run the
-- validator. It is immutable and reads nothing.
grant execute on function public.job_seeker_history_valid(jsonb) to authenticated;

-- The published score weights. One definition, read by the CHECK below and
-- mirrored by lib/job-seeker/scoring.ts; the behavior test holds them equal.
create or replace function public.job_seeker_breakdown_valid(p_breakdown jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_weights constant jsonb := '{"experience":30,"skills":20,"leadership":15,"industry":10,"compensation":10,"location":10,"career_growth":5}'::jsonb;
  v_key text;
begin
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'object' then
    return false;
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_breakdown) as key
    where not (v_weights ? key)
  ) then
    return false;
  end if;
  for v_key in select jsonb_object_keys(v_weights) loop
    if jsonb_typeof(p_breakdown -> v_key) is distinct from 'number' then
      return false;
    end if;
    if (p_breakdown ->> v_key)::numeric < 0
      or (p_breakdown ->> v_key)::numeric > (v_weights ->> v_key)::numeric then
      return false;
    end if;
    if (p_breakdown ->> v_key)::numeric <> round((p_breakdown ->> v_key)::numeric) then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function public.job_seeker_breakdown_valid(jsonb)
  from public, anon;
-- CHECK constraints execute as the writing role, and these tables are
-- written directly under RLS — so authenticated must be able to run the
-- validator. It is immutable and reads nothing.
grant execute on function public.job_seeker_breakdown_valid(jsonb) to authenticated;

create or replace function public.job_seeker_breakdown_total(p_breakdown jsonb)
returns integer
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(sum(value::numeric), 0)::integer
    from jsonb_each_text(p_breakdown) as entries(key, value);
$function$;

revoke all on function public.job_seeker_breakdown_total(jsonb)
  from public, anon;
-- CHECK constraints execute as the writing role, and these tables are
-- written directly under RLS — so authenticated must be able to run the
-- validator. It is immutable and reads nothing.
grant execute on function public.job_seeker_breakdown_total(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.job_seeker_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text check (full_name is null or char_length(btrim(full_name)) between 1 and 200),
  email text check (email is null or char_length(btrim(email)) between 3 and 320),
  phone text check (phone is null or char_length(btrim(phone)) between 3 and 40),
  linkedin_url text check (linkedin_url is null or (linkedin_url ~ '^https://' and char_length(linkedin_url) <= 400)),
  location text check (location is null or char_length(btrim(location)) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 4000),
  salary_target integer check (salary_target is null or salary_target between 0 and 100000000),
  salary_currency text not null default 'USD' check (salary_currency ~ '^[A-Z]{3}$'),
  work_arrangement public.job_seeker_arrangement not null default 'any',
  open_to_travel boolean not null default false,
  open_to_relocation boolean not null default false,
  employment_history jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  accomplishments jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  technologies jsonb not null default '[]'::jsonb,
  industries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_seeker_profiles_one_per_user unique (organization_id, user_id),
  constraint job_seeker_profiles_history_shape check (public.job_seeker_history_valid(employment_history)),
  constraint job_seeker_profiles_education_shape check (public.job_seeker_history_valid(education)),
  constraint job_seeker_profiles_accomplishments_shape check (public.job_seeker_text_list_valid(accomplishments, 100, 500)),
  constraint job_seeker_profiles_skills_shape check (public.job_seeker_text_list_valid(skills, 200, 120)),
  constraint job_seeker_profiles_certifications_shape check (public.job_seeker_text_list_valid(certifications, 100, 200)),
  constraint job_seeker_profiles_technologies_shape check (public.job_seeker_text_list_valid(technologies, 200, 120)),
  constraint job_seeker_profiles_industries_shape check (public.job_seeker_text_list_valid(industries, 50, 120))
);

create table if not exists public.job_seeker_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_titles jsonb not null default '[]'::jsonb,
  seniority text check (seniority is null or char_length(btrim(seniority)) between 1 and 120),
  compensation_minimum integer check (compensation_minimum is null or compensation_minimum between 0 and 100000000),
  locations jsonb not null default '[]'::jsonb,
  work_arrangements jsonb not null default '[]'::jsonb,
  industries jsonb not null default '[]'::jsonb,
  required_criteria jsonb not null default '[]'::jsonb,
  preferred_criteria jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  -- The user-configurable qualification bar; 80 by design default.
  qualification_threshold integer not null default 80
    check (qualification_threshold between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_seeker_preferences_one_per_user unique (organization_id, user_id),
  constraint job_seeker_preferences_titles_shape check (public.job_seeker_text_list_valid(target_titles, 50, 160)),
  constraint job_seeker_preferences_locations_shape check (public.job_seeker_text_list_valid(locations, 50, 160)),
  constraint job_seeker_preferences_arrangements_shape check (public.job_seeker_text_list_valid(work_arrangements, 4, 20)),
  constraint job_seeker_preferences_industries_shape check (public.job_seeker_text_list_valid(industries, 50, 120)),
  constraint job_seeker_preferences_required_shape check (public.job_seeker_text_list_valid(required_criteria, 50, 300)),
  constraint job_seeker_preferences_preferred_shape check (public.job_seeker_text_list_valid(preferred_criteria, 50, 300)),
  constraint job_seeker_preferences_exclusions_shape check (public.job_seeker_text_list_valid(exclusions, 50, 300))
);

create table if not exists public.job_seeker_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Where the record came from: 'manual' today; adapter names later. Honest
  -- attribution is the anti-fabrication rule in column form.
  source text not null default 'manual' check (source ~ '^[a-z][a-z0-9_]{0,62}$'),
  external_id text check (external_id is null or char_length(btrim(external_id)) between 1 and 200),
  url text check (url is null or (url ~ '^https?://' and char_length(url) <= 800)),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  company text not null check (char_length(btrim(company)) between 1 and 300),
  salary_text text check (salary_text is null or char_length(btrim(salary_text)) between 1 and 200),
  location text check (location is null or char_length(btrim(location)) between 1 and 200),
  work_model public.job_seeker_arrangement,
  description text check (description is null or char_length(description) <= 30000),
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duplicate protection: company + title + external id, normalized, per person.
create unique index if not exists job_seeker_jobs_dedupe_idx
  on public.job_seeker_jobs (
    organization_id, user_id,
    lower(btrim(company)), lower(btrim(title)), coalesce(btrim(external_id), '')
  );

create table if not exists public.job_seeker_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.job_seeker_jobs(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  breakdown jsonb not null,
  reasons jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  threshold_used integer not null check (threshold_used between 0 and 100),
  qualified boolean not null,
  created_at timestamptz not null default now(),

  constraint job_seeker_matches_one_per_job unique (job_id),
  constraint job_seeker_matches_breakdown_shape check (public.job_seeker_breakdown_valid(breakdown)),
  constraint job_seeker_matches_score_is_the_sum check (score = public.job_seeker_breakdown_total(breakdown)),
  constraint job_seeker_matches_qualified_is_derived check (qualified = (score >= threshold_used)),
  constraint job_seeker_matches_reasons_shape check (public.job_seeker_text_list_valid(reasons, 50, 500)),
  constraint job_seeker_matches_gaps_shape check (public.job_seeker_text_list_valid(gaps, 50, 500))
);

create table if not exists public.job_seeker_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.job_seeker_jobs(id) on delete cascade,
  stage public.job_seeker_stage not null default 'FOUND',
  approval_status public.job_seeker_approval not null default 'pending_review',
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  application_url text check (application_url is null or (application_url ~ '^https?://' and char_length(application_url) <= 800)),
  notes text check (notes is null or char_length(notes) <= 8000),
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_seeker_applications_one_per_job unique (job_id),
  -- THE APPROVAL GATE. No stage at or beyond APPLIED without an explicit
  -- approval. CLOSED is exempt: a rejected application may be closed.
  constraint job_seeker_applications_approval_gate check (
    stage in ('FOUND', 'QUALIFIED', 'RESUME_CREATED', 'READY_FOR_REVIEW', 'CLOSED')
    or approval_status = 'approved'
  ),
  -- A decision carries its evidence: status and timestamp move together.
  constraint job_seeker_applications_decision_recorded check (
    (approval_status = 'pending_review') = (decided_at is null)
  )
);

create table if not exists public.job_seeker_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.job_seeker_applications(id) on delete cascade,
  kind public.job_seeker_document_kind not null,
  version integer not null check (version between 1 and 1000),
  content text not null check (char_length(content) between 1 and 60000),
  created_at timestamptz not null default now(),

  -- Every generated version is stored; a (kind, version) pair is immutable.
  constraint job_seeker_documents_versioned unique (application_id, kind, version)
);

create table if not exists public.job_seeker_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.job_seeker_applications(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  role text check (role is null or char_length(btrim(role)) between 1 and 200),
  source text check (source is null or char_length(btrim(source)) between 1 and 200),
  linkedin_url text check (linkedin_url is null or (linkedin_url ~ '^https://' and char_length(linkedin_url) <= 400)),
  email text check (email is null or char_length(btrim(email)) between 3 and 320),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_seeker_outreach (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.job_seeker_contacts(id) on delete cascade,
  application_id uuid references public.job_seeker_applications(id) on delete cascade,
  subject text check (subject is null or char_length(btrim(subject)) between 1 and 300),
  body text not null check (char_length(body) between 1 and 10000),
  status public.job_seeker_outreach_status not null default 'draft',
  -- Set only by a real, successful send. No send integration exists yet, so
  -- nothing sets it; the CHECK keeps 'sent' honest when one does.
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_seeker_outreach_sent_is_evidence check (
    (status = 'sent') = (sent_at is not null)
  )
);

-- ---------------------------------------------------------------------------
-- Row Level Security: organization member AND row owner, on every table.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'job_seeker_profiles', 'job_seeker_preferences', 'job_seeker_jobs',
    'job_seeker_matches', 'job_seeker_applications', 'job_seeker_documents',
    'job_seeker_contacts', 'job_seeker_outreach'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_own', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_select_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_own', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_insert_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_update_own', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())
         with check (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_update_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_delete_own', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_delete_own', v_table);
  end loop;
end;
$$;

-- Documents are generated versions: immutable once written, like the other
-- evidence tables. Updating or deleting a stored version rewrites history.
create or replace function public.job_seeker_documents_no_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'generated documents are append-only; write a new version instead';
end;
$function$;

revoke all on function public.job_seeker_documents_no_rewrite()
  from public, anon, authenticated, service_role;

drop trigger if exists job_seeker_documents_append_only on public.job_seeker_documents;
create trigger job_seeker_documents_append_only
  before update or delete on public.job_seeker_documents
  for each row execute function public.job_seeker_documents_no_rewrite();

-- updated_at upkeep through the shared helper.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'job_seeker_profiles', 'job_seeker_preferences', 'job_seeker_jobs',
    'job_seeker_applications', 'job_seeker_contacts', 'job_seeker_outreach'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes for the reading paths
-- ---------------------------------------------------------------------------

create index if not exists job_seeker_jobs_person_idx
  on public.job_seeker_jobs (organization_id, user_id, discovered_at desc);
create index if not exists job_seeker_matches_person_idx
  on public.job_seeker_matches (organization_id, user_id, created_at desc);
create index if not exists job_seeker_applications_person_stage_idx
  on public.job_seeker_applications (organization_id, user_id, stage);
create index if not exists job_seeker_documents_application_idx
  on public.job_seeker_documents (application_id, kind, version desc);
create index if not exists job_seeker_contacts_person_idx
  on public.job_seeker_contacts (organization_id, user_id);
create index if not exists job_seeker_outreach_person_idx
  on public.job_seeker_outreach (organization_id, user_id, status);
