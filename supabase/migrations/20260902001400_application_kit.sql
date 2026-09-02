-- ---------------------------------------------------------------------------
-- Application kit: the screening answers a person keeps (ADR-244)
-- ---------------------------------------------------------------------------
--
-- Every applicant tracking system asks the same dozen questions after the
-- resume is uploaded — work authorization, sponsorship, start date, notice
-- period, years of experience — and Easy Apply's complaint is typing them
-- again for every employer. This table keeps the person's own answers, one
-- row per question, from a fixed vocabulary so a page can render a form
-- and a requirements check can read a specific answer by key.
--
-- Person-scoped like every job_seeker table: organization + owner, RLS
-- enabled and forced, the four own-row policies, anon revoked, no
-- service_role grant. No demographic or self-identification questions are
-- in the vocabulary, deliberately: those are the employer's to ask on
-- their own form, not this product's to store.

create table if not exists public.job_seeker_screening_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text not null check (question_key in (
    'work_authorization',
    'needs_sponsorship',
    'earliest_start',
    'notice_period',
    'years_experience',
    'education_level',
    'security_clearance',
    'languages',
    'willing_to_travel',
    'willing_to_relocate',
    'salary_expectation',
    'references'
  )),
  answer text not null check (char_length(btrim(answer)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_seeker_screening_answers_one_per_question
    unique (organization_id, user_id, question_key)
);

comment on table public.job_seeker_screening_answers is
  'The person''s own answers to the screening questions every ATS asks, one row per question from a fixed vocabulary (ADR-244).';

create index if not exists job_seeker_screening_answers_person_idx
  on public.job_seeker_screening_answers (organization_id, user_id);

alter table public.job_seeker_screening_answers enable row level security;
alter table public.job_seeker_screening_answers force row level security;
revoke all on table public.job_seeker_screening_answers from public, anon, service_role;
grant select, insert, update, delete on table public.job_seeker_screening_answers to authenticated;

drop policy if exists job_seeker_screening_answers_select_own on public.job_seeker_screening_answers;
create policy job_seeker_screening_answers_select_own
  on public.job_seeker_screening_answers for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_screening_answers_insert_own on public.job_seeker_screening_answers;
create policy job_seeker_screening_answers_insert_own
  on public.job_seeker_screening_answers for insert to authenticated
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_screening_answers_update_own on public.job_seeker_screening_answers;
create policy job_seeker_screening_answers_update_own
  on public.job_seeker_screening_answers for update to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid())
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_screening_answers_delete_own on public.job_seeker_screening_answers;
create policy job_seeker_screening_answers_delete_own
  on public.job_seeker_screening_answers for delete to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());
