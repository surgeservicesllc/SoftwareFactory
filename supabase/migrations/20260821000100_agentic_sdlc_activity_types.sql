-- Activity types for the Agentic SDLC lifecycle.
--
-- Their own migration because PostgreSQL will not let a transaction use an enum
-- value it added itself. The migration that writes these rows is
-- 20260821000200, and it can only compile once this one has committed.

alter type public.activity_event_type add value if not exists 'lifecycle.graph_created';
alter type public.activity_event_type add value if not exists 'lifecycle.gate_opened';
alter type public.activity_event_type add value if not exists 'lifecycle.gate_approved';
alter type public.activity_event_type add value if not exists 'lifecycle.gate_rejected';
alter type public.activity_event_type add value if not exists 'lifecycle.iteration_advanced';
alter type public.activity_event_type add value if not exists 'lifecycle.iteration_exhausted';
