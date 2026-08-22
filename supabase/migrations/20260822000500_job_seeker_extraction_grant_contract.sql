-- Take back the privileges Supabase granted this table on our behalf.
--
-- 20260822000400 created job_seeker_resume_extractions, revoked `anon`, and
-- granted `authenticated` select/insert/delete. Its own post-apply check then
-- refused the result on production, and the probe said why:
--
--   auth_update = t, service_update = t
--
-- Hosted Supabase carries ALTER DEFAULT PRIVILEGES for the `public` schema that
-- grant new tables to anon, authenticated and service_role at CREATE TABLE
-- time. Revoking only `anon` therefore left UPDATE — and every other verb —
-- with the two roles nobody revoked.
--
-- Why this matters even though RLS is on: the table has three policies and
-- none of them is UPDATE, so a signed-in caller's UPDATE is denied by RLS
-- whatever the grant says. `service_role` is the hole, because it holds
-- rolbypassrls and is not subject to any policy at all. The design's stated
-- invariant — applying is the definer function's job, so nothing can mark an
-- extraction applied while the profile stays unchanged — was not actually true.
--
-- PGlite cannot reproduce this. It has no default privileges configured for
-- these roles, so a table created there starts with none and every local test
-- passed. Only the hosted readback could find it, which is the argument for
-- having one.
--
-- A new version rather than an edit to 20260822000400: that version is recorded
-- in the hosted ledger, and re-running a file under a version the ledger
-- already holds is how this repository previously lost a migration entirely.

-- REVOKE ALL, then grant back exactly the three verbs. Naming `public` too
-- matters: a grant to PUBLIC reaches every role including future ones, and
-- revoking the named roles alone would leave it standing.
revoke all on table public.job_seeker_resume_extractions
  from public, anon, authenticated, service_role;

-- The person's own rows, under the three policies that already exist. No
-- UPDATE: an extraction is written once and then decided upon, and applying it
-- is apply_resume_extraction's job precisely so the profile write, the applied
-- record and the audit row cannot come apart.
grant select, insert, delete on table public.job_seeker_resume_extractions
  to authenticated;

-- service_role is granted nothing at all. No worker reads or writes this
-- table — it is entirely a person-facing record — and service_role bypasses
-- row level security, so a grant here would be the one privilege on this table
-- that no policy could contain.

-- The same treatment for the function, which was created with the default
-- EXECUTE-to-PUBLIC that PostgreSQL gives every new function.
revoke all on function public.apply_resume_extraction(uuid, text[])
  from public, anon;
grant execute on function public.apply_resume_extraction(uuid, text[])
  to authenticated;
