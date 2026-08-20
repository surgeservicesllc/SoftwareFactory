-- Activity vocabulary for the Job Seeker surface, in its own migration so a
-- transactional apply (supabase db push wraps each file) never uses an enum
-- value in the transaction that added it — the same reason
-- 20260813000300_bot_fabric_activity_types exists.

alter type public.activity_event_type add value if not exists 'job_seeker.profile_updated';
alter type public.activity_event_type add value if not exists 'job_seeker.job_recorded';
alter type public.activity_event_type add value if not exists 'job_seeker.application_stage_changed';
alter type public.activity_event_type add value if not exists 'job_seeker.application_decided';
