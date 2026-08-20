-- Resume/document upload for the Job Seeker, stored where RLS already works.
--
-- Hosted Supabase's storage.objects is owned by supabase_storage_admin, so
-- this repository's psql apply path cannot create policies on it — and the
-- web tier deliberately holds no service-role key that could bypass them.
-- Rather than smuggle a privileged key into the browser-facing server or
-- ship a bucket nobody can write to, uploads live in a person-scoped BYTEA
-- table under the exact RLS discipline every other job_seeker_* table uses.
-- A resume is a few hundred kilobytes; the cap is 2 MB, enforced twice
-- (byte_size and octet_length must agree, both bounded).

create table if not exists public.job_seeker_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'resume' check (kind in ('resume', 'document')),
  filename text not null check (char_length(btrim(filename)) between 1 and 200),
  content_type text not null check (content_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  )),
  byte_size integer not null check (byte_size between 1 and 2097152),
  data bytea not null,
  created_at timestamptz not null default now(),

  constraint job_seeker_uploads_size_is_true check (octet_length(data) = byte_size)
);

alter table public.job_seeker_uploads enable row level security;
alter table public.job_seeker_uploads force row level security;
revoke all on table public.job_seeker_uploads from anon;
grant select, insert, delete on table public.job_seeker_uploads to authenticated;

drop policy if exists job_seeker_uploads_select_own on public.job_seeker_uploads;
create policy job_seeker_uploads_select_own
  on public.job_seeker_uploads for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_uploads_insert_own on public.job_seeker_uploads;
create policy job_seeker_uploads_insert_own
  on public.job_seeker_uploads for insert to authenticated
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_uploads_delete_own on public.job_seeker_uploads;
create policy job_seeker_uploads_delete_own
  on public.job_seeker_uploads for delete to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

create index if not exists job_seeker_uploads_person_idx
  on public.job_seeker_uploads (organization_id, user_id, created_at desc);

-- The profile points at its current resume; deleting the upload clears the
-- pointer rather than the profile.
alter table public.job_seeker_profiles
  add column if not exists resume_upload_id uuid
    references public.job_seeker_uploads(id) on delete set null;
