-- Removing an AI account became impossible the moment the sweep recorded its
-- first usage observation. `remove_ai_account` deletes the account row, the
-- usage table's foreign key declares `on delete cascade`, and the same
-- table's append-only trigger refuses that cascaded delete with 42501
-- "usage observations are append-only". Measured on the hosted database by
-- scope=probe run 32188102707: the impersonated owner passes
-- can_manage_organization, and the call fails with exactly that SQLSTATE —
-- which the console rendered as "The account could not be removed. (42501)".
--
-- The two declarations contradict each other, and the trigger is the one
-- that is right: usage evidence is history, and history that can be
-- rewritten is not evidence. So the cascade goes, not the trigger. The
-- account id column becomes what it already was in practice — a historical
-- reference that may outlive its account, exactly like the entity ids inside
-- activity_events. Write-time integrity is unchanged: rows are inserted only
-- by the worker's `record_ai_account_usage`, which verifies the account
-- belongs to the organization before writing. Read paths list observations
-- per organization and match them to accounts by id, so a removed account's
-- evidence simply stops matching a row on screen while remaining recorded.

alter table public.ai_account_usage_observations
  drop constraint if exists ai_account_usage_account_fk;

comment on column public.ai_account_usage_observations.ai_account_id is
  'The account this observation measured. A historical reference that may outlive the account itself: usage evidence is append-only and survives account removal.';
