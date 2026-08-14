-- Bot fabric audit vocabulary.
--
-- PostgreSQL forbids using a new enum label in the same transaction that adds
-- it, so the labels are introduced in their own forward migration ahead of the
-- tables and functions that reference them.

alter type public.activity_event_type add value if not exists 'bot.registered';
alter type public.activity_event_type add value if not exists 'bot.updated';
alter type public.activity_event_type add value if not exists 'bot.retired';
alter type public.activity_event_type add value if not exists 'bot.readiness_checked';
alter type public.activity_event_type add value if not exists 'bot_role.saved';
alter type public.activity_event_type add value if not exists 'bot_role.removed';
alter type public.activity_event_type add value if not exists 'bot.assigned';
alter type public.activity_event_type add value if not exists 'bot.moved';
alter type public.activity_event_type add value if not exists 'bot.assignment_changed';
