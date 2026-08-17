-- Activity types for archiving a run and for a report's end of life.
--
-- Its own file because PostgreSQL will not use an enum value in the same
-- transaction that added it, and 20260817000700 needs all five immediately.

alter type public.activity_event_type add value if not exists 'run.archived';
alter type public.activity_event_type add value if not exists 'run.unarchived';
alter type public.activity_event_type add value if not exists 'report.archived';
alter type public.activity_event_type add value if not exists 'report.unarchived';
alter type public.activity_event_type add value if not exists 'report.deleted';
