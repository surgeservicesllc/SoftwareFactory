-- Take back the privileges hosted Supabase granted these tables on our behalf.
--
-- The document-polish postflight (20260902001500) refused production with
-- "job_seeker_documents grants are wrong": anon or service_role held SELECT
-- on the table. The chain never granted either — and that is the point.
-- Hosted Supabase carries ALTER DEFAULT PRIVILEGES for the `public` schema
-- that grant every new table to anon, authenticated and service_role at
-- CREATE TABLE time. The job seeker foundation (20260820000200) revoked only
-- anon; the discovery surface (20260828000400) and the upload table
-- (20260820000300) followed the same shape. Every job seeker table created
-- since the extraction contract (20260822000500) revokes all three roles
-- explicitly and its postflight has passed on production; these twelve are
-- the ones from before that convention.
--
-- Why it matters even with RLS enabled and forced on every one of them:
-- service_role holds rolbypassrls and is subject to no policy, so a
-- service_role grant is the one privilege on a person-scoped table that no
-- policy can contain. No worker reads or writes these tables — the alert
-- engine's service key signs definer RPCs and nothing else — so the grant
-- protects nothing and exposes every person's rows to the worker key.
--
-- PGlite cannot reproduce the hosted state (it has no default privileges),
-- so locally every statement below is a no-op and every test already
-- passed. Only the hosted readback could find it, which is what the
-- postflight is for. `authenticated` is deliberately untouched: each table's
-- own migration granted it exactly what its policies allow.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'job_seeker_profiles', 'job_seeker_preferences', 'job_seeker_jobs',
    'job_seeker_matches', 'job_seeker_applications', 'job_seeker_documents',
    'job_seeker_contacts', 'job_seeker_outreach', 'job_seeker_uploads',
    'job_seeker_saved_searches', 'job_seeker_search_alerts', 'job_seeker_search_events'
  ] loop
    execute format('revoke all on table public.%I from public, anon, service_role', v_table);
  end loop;
end $$;
