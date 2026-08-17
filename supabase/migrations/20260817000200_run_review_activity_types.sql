-- Activity types for the two new things an owner can do to a run record.
--
-- Its own file because PostgreSQL will not use an enum value in the same
-- transaction that added it, and `20260815000800` needs both immediately.

alter type public.activity_event_type add value if not exists 'run.review_updated';
alter type public.activity_event_type add value if not exists 'run.deleted';
