-- Local-stack replay environment, seeded by `supabase start` BEFORE the
-- migration chain runs. Hosted is never touched by this file.
--
-- supabase CLI 2.116.0 moved the local image to supabase/postgres
-- 17.6.1.165, whose bootstrap leaves hosted-style default privileges in
-- place: functions created by `postgres` in `public` default-grant EXECUTE
-- to anon, authenticated, and service_role (tables and sequences get the
-- analogous grants). The committed migration chain was written and verified
-- against the older CLI environment, where `postgres` had no default ACLs
-- in `public` and an object carried exactly the grants its migrations
-- stated. These statements restore that environment for clean replays: the
-- function grant to PUBLIC plus the three revokes collapse the default ACL
-- back to PostgreSQL's implicit default, so the catalog rows disappear and
-- created objects get a NULL acl, exactly as before.
--
-- Under CLI 2.115.0 (the version the journey lanes pin) no such default
-- ACLs exist and every statement here is a no-op.
alter default privileges for role postgres in schema public grant execute on functions to public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
