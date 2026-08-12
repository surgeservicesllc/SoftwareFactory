-- Phase 1C execution enum extensions.
--
-- This migration contains only `alter type ... add value` statements. PostgreSQL
-- forbids using a newly added enum value in the same transaction that adds it,
-- so every structure, constraint, and workflow that consumes these labels lives
-- in the following migrations. Keeping the split explicit also makes the
-- authorization-relevant changes reviewable on their own.
--
-- Nothing here grants execution authority. Autonomous Mode stays OFF, the global
-- kill switch stays ON, and no automatic approval, merge, deploy, or rollback
-- capability is introduced.

-- Command lifecycle states required by the Bot Manager surface.
alter type public.command_status add value if not exists 'planning';
alter type public.command_status add value if not exists 'validating';
alter type public.command_status add value if not exists 'awaiting_review';
alter type public.command_status add value if not exists 'owner_action_required';

-- The intake task created at command submission is superseded once the
-- orchestrator decomposes the command into concrete work.
alter type public.task_status add value if not exists 'superseded';

-- Run lifecycle states for the durable worker state machine.
alter type public.run_status add value if not exists 'validating';
alter type public.run_status add value if not exists 'awaiting_review';
alter type public.run_status add value if not exists 'cancelling';

-- Logical agent roles named by the Phase 1C workforce definition.
alter type public.agent_role add value if not exists 'architect';
alter type public.agent_role add value if not exists 'performance';

-- Validation kinds that real repository CI reports.
alter type public.test_run_kind add value if not exists 'lint';
alter type public.test_run_kind add value if not exists 'typecheck';
alter type public.test_run_kind add value if not exists 'build';

-- Coarse audit events for the execution loop. Fine-grained per-run evidence is
-- recorded separately in public.run_events.
alter type public.activity_event_type add value if not exists 'command.planned';
alter type public.activity_event_type add value if not exists 'command.cancelled';
alter type public.activity_event_type add value if not exists 'run.queued';
alter type public.activity_event_type add value if not exists 'run.completed';
alter type public.activity_event_type add value if not exists 'run.failed';
alter type public.activity_event_type add value if not exists 'run.cancelled';
alter type public.activity_event_type add value if not exists 'task.updated';
alter type public.activity_event_type add value if not exists 'report.published';
alter type public.activity_event_type add value if not exists 'settings.updated';
