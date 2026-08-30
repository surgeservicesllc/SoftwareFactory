-- The CRM's grants, narrowed for real (ADR-185 follow-up).
--
-- 20260830000500 stated each table's capabilities as grants — and on the
-- hosted database that statement was incomplete: hosted default privileges
-- GRANT ALL on every new table to authenticated, and a narrower grant on
-- top of ALL narrows nothing. The scope=services-crm postflight refused
-- ("the CRM immutability grants are wrong") — the timeline could have been
-- updated and deleted by any member, which is exactly the un-audit-trail
-- this schema promises not to be. PGlite carries no default privileges, so
-- the behavior suite could not see it; the suite now installs hosted-style
-- defaults before running the chain, so this class fails locally from now
-- on.
--
-- The fix is REVOKE-then-GRANT: collapse whatever the defaults handed out,
-- then state the exact capability set again. Idempotent, and correct both
-- on hosted (defaults collapsed) and on a fresh chain (a no-op
-- restatement).

revoke all on table public.crm_accounts from public, anon, authenticated, service_role;
revoke all on table public.crm_contacts from public, anon, authenticated, service_role;
revoke all on table public.crm_properties from public, anon, authenticated, service_role;
revoke all on table public.crm_timeline_events from public, anon, authenticated, service_role;

-- Accounts are corrected, never deleted; contacts and properties may be
-- removed; the timeline is read and appended, never rewritten.
grant select, insert, update on table public.crm_accounts to authenticated;
grant select, insert, update, delete on table public.crm_contacts to authenticated;
grant select, insert, update, delete on table public.crm_properties to authenticated;
grant select, insert on table public.crm_timeline_events to authenticated;
