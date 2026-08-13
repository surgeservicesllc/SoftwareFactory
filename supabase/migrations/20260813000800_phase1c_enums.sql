-- Phase 1C enum values are committed in their own migration. PostgreSQL does
-- not permit a value added by ALTER TYPE to be used safely until that
-- transaction commits.

alter type public.agent_role add value if not exists 'architect' after 'product';
alter type public.agent_role add value if not exists 'performance' after 'security';

alter type public.activity_event_type add value if not exists 'agent.completed';
alter type public.activity_event_type add value if not exists 'agent.failed';
alter type public.activity_event_type add value if not exists 'agent.cancelled';
alter type public.activity_event_type add value if not exists 'agent.retry_requested';
