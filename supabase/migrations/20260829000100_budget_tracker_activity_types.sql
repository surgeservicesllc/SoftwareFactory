-- Activity vocabulary for the Budget Tracker, in its own migration so a
-- transactional apply (supabase db push wraps each file) never uses an enum
-- value in the transaction that added it — the same reason
-- 20260820000100_job_seeker_activity_types exists.

alter type public.activity_event_type add value if not exists 'budget.account_recorded';
alter type public.activity_event_type add value if not exists 'budget.transactions_imported';
alter type public.activity_event_type add value if not exists 'budget.obligation_updated';
alter type public.activity_event_type add value if not exists 'budget.plan_updated';
