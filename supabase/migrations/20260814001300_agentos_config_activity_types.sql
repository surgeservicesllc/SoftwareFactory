-- Activity types for configuration-as-code.
--
-- Kept in its own migration because `alter type ... add value` cannot be used
-- by a statement in the same transaction that adds it. The repository already
-- separates enum growth this way (see 20260813000300, 20260813000800).

alter type public.activity_event_type add value if not exists 'agentos.config_applied';
alter type public.activity_event_type add value if not exists 'agentos.config_pruned';
