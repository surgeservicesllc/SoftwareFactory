-- What an independent reviewer said about a generated document.
--
-- The drafter builds a resume and a cover letter from recorded facts only.
-- The reviewer is a second pass with no memory of the drafting: it reads the
-- posting and the drafts fresh and critiques them. Two agents that share a
-- context share its blind spots, which is why the reviewer is separate and
-- why its output lands in its own row rather than being folded into the
-- document it critiques.
--
-- This table stores the CRITIQUE, never the revision. A revision is a new
-- row in job_seeker_documents with the next version, because versions there
-- are already immutable and "which version did they actually send" has to
-- stay answerable. So a review row points at the version it read, and the
-- version it produced is found by its own version number.
--
-- The deterministic verification (keyword coverage, parseability, factual
-- grounding) is deliberately NOT stored anywhere: it is a pure function of a
-- document and a profile that are both already stored, so a copy would go
-- stale the moment either changed. A model's critique is the opposite — it
-- cannot be recomputed, so it has to be kept.

create table if not exists public.job_seeker_document_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.job_seeker_documents(id) on delete cascade,

  -- 'reviewed' means a model actually read the draft. 'unavailable' means no
  -- provider was reachable and `detail` says why. Collapsing the two would
  -- claim an independent review on a deployment that has no provider
  -- configured, which is the exact false claim this column exists to refuse.
  status text not null check (status in ('reviewed', 'unavailable')),
  -- The model that read it, or null. Null with status 'reviewed' is refused
  -- below.
  model text check (model is null or char_length(btrim(model)) between 1 and 200),
  detail text not null check (char_length(detail) between 1 and 2000),

  -- Structured edits: [{"find": "...", "replace": "...", "reason": "..."}].
  -- Proposals only. Nothing here has touched a document.
  edits jsonb not null default '[]'::jsonb,
  -- Narrative critique: [{"category": "...", "note": "..."}].
  narrative jsonb not null default '[]'::jsonb,

  -- Set when a person accepted some of the edits and a new document version
  -- was written. Never set by the reviewer itself.
  applied_at timestamptz,
  applied_edit_count integer not null default 0 check (applied_edit_count >= 0),
  -- Edits refused because applying them would have introduced a claim the
  -- profile does not support. Counted, because a reviewer that keeps
  -- proposing ungrounded claims is a fact worth being able to see.
  rejected_edit_count integer not null default 0 check (rejected_edit_count >= 0),

  created_at timestamptz not null default now(),

  constraint job_seeker_document_review_reviewed_names_model
    check ((status = 'reviewed') = (model is not null)),
  -- An unavailable review has nothing to say. A row claiming otherwise would
  -- be a critique attributed to a model that never ran.
  constraint job_seeker_document_review_unavailable_is_empty
    check (
      status <> 'unavailable'
      or (jsonb_array_length(edits) = 0 and jsonb_array_length(narrative) = 0)
    ),
  -- CASE, not AND. PostgreSQL does not guarantee short-circuit evaluation
  -- inside a CHECK, so `jsonb_typeof(x) = 'array' and jsonb_array_length(x)`
  -- raises "cannot get array length of a non-array" on a non-array — the row
  -- is still refused, but by an error that names no constraint and tells an
  -- operator nothing about which rule it broke.
  constraint job_seeker_document_review_edits_is_array
    check (case jsonb_typeof(edits) when 'array' then jsonb_array_length(edits) <= 40 else false end),
  constraint job_seeker_document_review_narrative_is_array
    check (case jsonb_typeof(narrative) when 'array' then jsonb_array_length(narrative) <= 20 else false end),
  -- Applied and the count of what was applied travel together, the same rule
  -- the extraction table uses for the same reason: a timestamp with no
  -- record of what it applied is a claim with no evidence.
  constraint job_seeker_document_review_applied_together
    check ((applied_at is not null) = (applied_edit_count > 0)),
  -- Nothing can be rejected by a review that never proposed anything.
  constraint job_seeker_document_review_counts_within_proposal
    check (
      applied_edit_count + rejected_edit_count
        <= case jsonb_typeof(edits) when 'array' then jsonb_array_length(edits) else 0 end
    )
);

alter table public.job_seeker_document_reviews enable row level security;
alter table public.job_seeker_document_reviews force row level security;
revoke all on table public.job_seeker_document_reviews from anon;
-- UPDATE is granted, unlike the extraction table, because applying a review
-- writes a NEW document version rather than mutating the profile: there is no
-- second write that could come apart from this one. What an update may say is
-- fenced by the constraints above.
grant select, insert, update, delete on table public.job_seeker_document_reviews to authenticated;

drop policy if exists job_seeker_document_reviews_select_own on public.job_seeker_document_reviews;
create policy job_seeker_document_reviews_select_own
  on public.job_seeker_document_reviews for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_document_reviews_insert_own on public.job_seeker_document_reviews;
create policy job_seeker_document_reviews_insert_own
  on public.job_seeker_document_reviews for insert to authenticated
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_document_reviews_update_own on public.job_seeker_document_reviews;
create policy job_seeker_document_reviews_update_own
  on public.job_seeker_document_reviews for update to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid())
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_document_reviews_delete_own on public.job_seeker_document_reviews;
create policy job_seeker_document_reviews_delete_own
  on public.job_seeker_document_reviews for delete to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

create index if not exists job_seeker_document_reviews_person_idx
  on public.job_seeker_document_reviews (organization_id, user_id, created_at desc);
create index if not exists job_seeker_document_reviews_document_idx
  on public.job_seeker_document_reviews (document_id, created_at desc);
