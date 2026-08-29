-- Personal marks on search results: favorite, hidden, viewed.
--
-- The unified search shows postings that live on other people's websites, so
-- the only thing this table stores is the person's own relationship to a
-- posting's URL: starred it, hid it, or opened it. One row per
-- (person, workspace, URL, mark); putting the mark in the row's identity
-- makes marking idempotent and unmarking a plain delete — no update path
-- exists or is granted.
--
-- Marks are reversible personal state, not evidence: unlike the alert
-- delivery ledger there is nothing here that must never be rewritten, so the
-- person may delete their own rows (unfavorite, unhide). Reads and writes
-- are the signed-in person's alone, under forced RLS, with service_role
-- explicitly revoked the same way the Budget Tracker and the alert ledger
-- revoke it — hosted default privileges would otherwise hand it the table.

create table if not exists public.job_seeker_result_marks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_url text not null check (job_url ~ '^https?://' and char_length(job_url) <= 800),
  mark text not null check (mark in ('favorite', 'hidden', 'viewed')),
  created_at timestamptz not null default now(),
  constraint job_seeker_result_marks_one_per_url
    unique (organization_id, user_id, job_url, mark)
);

create index if not exists job_seeker_result_marks_by_person_idx
  on public.job_seeker_result_marks (organization_id, user_id, mark);

comment on table public.job_seeker_result_marks is
  'A person''s own favorite/hidden/viewed marks on search-result URLs. Reversible personal state; the mark is part of the row identity.';

alter table public.job_seeker_result_marks enable row level security;
alter table public.job_seeker_result_marks force row level security;
revoke all on table public.job_seeker_result_marks from anon;
revoke all on table public.job_seeker_result_marks from authenticated;
revoke all on table public.job_seeker_result_marks from service_role;
grant select, insert, delete on table public.job_seeker_result_marks to authenticated;

drop policy if exists job_seeker_result_marks_select_own on public.job_seeker_result_marks;
create policy job_seeker_result_marks_select_own
  on public.job_seeker_result_marks for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_result_marks_insert_own on public.job_seeker_result_marks;
create policy job_seeker_result_marks_insert_own
  on public.job_seeker_result_marks for insert to authenticated
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_result_marks_delete_own on public.job_seeker_result_marks;
create policy job_seeker_result_marks_delete_own
  on public.job_seeker_result_marks for delete to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());
