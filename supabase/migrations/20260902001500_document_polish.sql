-- Polish that cannot invent (ADR-248): a generated document records where
-- it came from. Every version so far is the fact-only baseline; a version
-- a model reworded carries the model's name and the non-fabrication check
-- that let it be stored. The check is part of the row because "which
-- version did they see, and was it checked?" must be answerable from the
-- table alone. No new table, so the grants, policies and RLS census of
-- job_seeker_documents are unchanged.

alter table public.job_seeker_documents
  add column if not exists origin text not null default 'baseline',
  add column if not exists model text,
  add column if not exists polish_check jsonb;

do $$ begin
  alter table public.job_seeker_documents
    add constraint job_seeker_documents_origin_known check (origin in ('baseline', 'polished'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.job_seeker_documents
    add constraint job_seeker_documents_model_shape
      check (model is null or char_length(btrim(model)) between 1 and 128);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.job_seeker_documents
    add constraint job_seeker_documents_polish_check_shape
      check (polish_check is null or jsonb_typeof(polish_check) = 'object');
exception when duplicate_object then null; end $$;

-- A baseline carries no model and no check; a polished version carries both.
do $$ begin
  alter table public.job_seeker_documents
    add constraint job_seeker_documents_origin_consistent check (
      (origin = 'baseline' and model is null and polish_check is null)
      or (origin = 'polished' and model is not null and polish_check is not null)
    );
exception when duplicate_object then null; end $$;

-- The check is evidence. It must say the variant passed, or the row is a
-- contradiction: a stored polish the check rejected.
do $$ begin
  alter table public.job_seeker_documents
    add constraint job_seeker_documents_polish_passed check (
      polish_check is null or (polish_check ->> 'passed') = 'true'
    );
exception when duplicate_object then null; end $$;
