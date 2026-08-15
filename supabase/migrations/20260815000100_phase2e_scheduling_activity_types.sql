-- Phase 2E: activity types for portfolio scheduling decisions.
--
-- Separate file because PostgreSQL refuses to use an enum value in the same
-- transaction that added it, and every other migration here needs these values
-- immediately. `20260813000800_phase1c_enums.sql` exists for the same reason.

alter type public.activity_event_type add value if not exists 'project.engineering_priority_changed';
alter type public.activity_event_type add value if not exists 'project.strategic_focus_changed';
alter type public.activity_event_type add value if not exists 'project.engineering_paused';
alter type public.activity_event_type add value if not exists 'project.engineering_resumed';
alter type public.activity_event_type add value if not exists 'portfolio.capacity_changed';
