-- AgentOS inbox.
--
-- docs/AGENTOS_SPEC.md §12: the single interrupt channel between an agent and
-- the human. An agent messages only when it is stuck or needs a decision; the
-- human answers; answering an open question resumes the waiting session with
-- the answer in context.
--
-- Two rules carry the weight here, and both are enforced by the database
-- rather than by whichever caller happens to be correct:
--
--   1. A session may hold at most one open question. "Resume on answer" is
--      meaningless if two questions are outstanding — answering one would not
--      tell the runner whether to continue.
--   2. A multiple-choice answer must be one of the choices that were offered.
--      A free-text answer to a radio question is how a caller ends up
--      resuming with an option nobody presented.
--
-- This migration connects no runner and grants no execution authority. A
-- message can be written and answered; nothing here starts work.

create type public.agentos_inbox_author as enum ('agent', 'human');
create type public.agentos_inbox_kind as enum ('text', 'multiple_choice');
create type public.agentos_inbox_status as enum ('open', 'answered', 'closed');

create table public.agentos_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,

  author public.agentos_inbox_author not null,
  kind public.agentos_inbox_kind not null default 'text',
  status public.agentos_inbox_status not null default 'open',

  -- Every message names its origin. All four are nullable because a message
  -- may come from a task run, a goal, or a trigger job.
  agent_id uuid,
  agent_run_id uuid,
  task_id uuid,

  body text not null check (char_length(btrim(body)) between 1 and 4000),
  -- Offered options for a multiple-choice question, as ordered text labels.
  choices text[] not null default '{}'::text[],
  selected_choice_index smallint,
  answer_body text check (answer_body is null or char_length(answer_body) <= 4000),
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz,

  created_at timestamptz not null default now(),

  constraint agentos_inbox_agent_fk foreign key (agent_id, organization_id)
    references public.agents(id, organization_id) on delete set null,
  constraint agentos_inbox_run_fk foreign key (agent_run_id, organization_id)
    references public.agent_runs(id, organization_id) on delete set null,
  constraint agentos_inbox_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete set null,

  -- A question the human must answer comes from an agent. A human message is
  -- a reply or a note, never an open question addressed to itself.
  constraint agentos_inbox_human_message_not_open check (
    author = 'agent' or status <> 'open'
  ),

  -- Choice shape follows the kind, both ways: a text message carrying choices
  -- would render as a question nobody can answer.
  constraint agentos_inbox_choices_match_kind check (
    (kind = 'multiple_choice' and cardinality(choices) between 2 and 10)
    or (kind = 'text' and cardinality(choices) = 0)
  ),

  -- An answer must select from what was offered.
  constraint agentos_inbox_selection_in_range check (
    selected_choice_index is null
    or (selected_choice_index >= 0 and selected_choice_index < cardinality(choices))
  ),
  constraint agentos_inbox_selection_requires_choices check (
    selected_choice_index is null or kind = 'multiple_choice'
  ),

  -- Answered means answered: the evidence must be present and consistent.
  constraint agentos_inbox_answer_consistent check (
    (status = 'answered' and answered_at is not null and answered_by is not null
      and (kind <> 'multiple_choice' or selected_choice_index is not null))
    or (status <> 'answered' and answered_at is null and answered_by is null
      and selected_choice_index is null)
  ),

  -- The inbox is a conversation channel, not a place to move credentials.
  constraint agentos_inbox_body_no_secret check (
    not public.text_has_likely_secret(body)
  ),
  constraint agentos_inbox_answer_no_secret check (
    answer_body is null or not public.text_has_likely_secret(answer_body)
  )
);

comment on table public.agentos_inbox_messages is
  'The only human channel for agents. An open agent question pauses its session; answering resumes it with the answer in context.';

-- One open question per session. Without this, "answering resumes the session"
-- is ambiguous and a runner cannot know whether it may continue.
create unique index agentos_inbox_one_open_question_per_run
  on public.agentos_inbox_messages (agent_run_id)
  where status = 'open' and agent_run_id is not null;

create index agentos_inbox_org_created_idx
  on public.agentos_inbox_messages (organization_id, created_at desc);
create index agentos_inbox_open_idx
  on public.agentos_inbox_messages (organization_id, status)
  where status = 'open';

alter table public.agentos_inbox_messages enable row level security;
alter table public.agentos_inbox_messages force row level security;

create policy agentos_inbox_select_members
  on public.agentos_inbox_messages for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.agentos_inbox_messages from anon, authenticated;
grant select on table public.agentos_inbox_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------
--
-- The human side. Writes go through here so the constraints above cannot be
-- sidestepped by a caller assembling its own UPDATE.

create or replace function public.agentos_answer_inbox_message(
  p_message_id uuid,
  p_answer_body text default null,
  p_selected_choice_index smallint default null
)
returns public.agentos_inbox_messages
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  message_record public.agentos_inbox_messages;
  updated public.agentos_inbox_messages;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into message_record
    from public.agentos_inbox_messages
   where id = p_message_id
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'the message does not exist or is not visible';
  end if;

  if not public.is_organization_member(message_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  -- Answering twice would resume a session that has already moved on.
  if message_record.status <> 'open' then
    raise exception using errcode = '22023', message = 'the message is no longer open';
  end if;

  if message_record.kind = 'multiple_choice' then
    if p_selected_choice_index is null then
      raise exception using errcode = '22023', message = 'a choice must be selected';
    end if;
    if p_selected_choice_index < 0
       or p_selected_choice_index >= cardinality(message_record.choices) then
      raise exception using errcode = '22023', message = 'the selected choice was not offered';
    end if;
  else
    if p_selected_choice_index is not null then
      raise exception using errcode = '22023', message = 'this message has no choices';
    end if;
    if p_answer_body is null or char_length(btrim(p_answer_body)) = 0 then
      raise exception using errcode = '22023', message = 'an answer is required';
    end if;
  end if;

  update public.agentos_inbox_messages
     set status = 'answered',
         answer_body = nullif(btrim(coalesce(p_answer_body, '')), ''),
         selected_choice_index = p_selected_choice_index,
         answered_by = caller_id,
         answered_at = now()
   where id = p_message_id
  returning * into updated;

  return updated;
end;
$function$;

comment on function public.agentos_answer_inbox_message(uuid, text, smallint) is
  'Answers an open message. Refuses a second answer, and refuses a choice that was never offered.';

revoke all on function public.agentos_answer_inbox_message(uuid, text, smallint)
  from public, anon, service_role;
grant execute on function public.agentos_answer_inbox_message(uuid, text, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- What a resumed session is handed
-- ---------------------------------------------------------------------------
--
-- The runner needs one answer to "may I continue, and with what". Computing it
-- here keeps the resume contract in one place instead of in each runner.

create or replace function public.agentos_run_inbox_state(p_agent_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  run_record record;
  open_count integer;
  latest_answer public.agentos_inbox_messages;
begin
  select r.id, r.organization_id into run_record
    from public.agent_runs r
   where r.id = p_agent_run_id;

  if not found then
    raise exception using errcode = '42501', message = 'the run does not exist or is not visible';
  end if;

  if not public.is_organization_member(run_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select count(*) into open_count
    from public.agentos_inbox_messages
   where agent_run_id = p_agent_run_id and status = 'open';

  select * into latest_answer
    from public.agentos_inbox_messages
   where agent_run_id = p_agent_run_id and status = 'answered'
   order by answered_at desc
   limit 1;

  return jsonb_build_object(
    'runId', p_agent_run_id,
    -- A run with an open question is waiting, full stop.
    'waitingOnHuman', open_count > 0,
    'openQuestionCount', open_count,
    'latestAnswer', case
      when latest_answer.id is null then null
      else jsonb_build_object(
        'messageId', latest_answer.id,
        'kind', latest_answer.kind,
        'question', latest_answer.body,
        -- The resolved label, not the index. A runner should never have to
        -- re-derive which option a number meant.
        'selectedChoice', case
          when latest_answer.selected_choice_index is null then null
          else latest_answer.choices[latest_answer.selected_choice_index + 1]
        end,
        'answerBody', latest_answer.answer_body,
        'answeredAt', latest_answer.answered_at
      )
    end
  );
end;
$function$;

comment on function public.agentos_run_inbox_state(uuid) is
  'Whether a run is waiting on the human, and the answer it should resume with. Returns the resolved choice label so a runner never re-derives what an index meant.';

revoke all on function public.agentos_run_inbox_state(uuid) from public, anon, service_role;
grant execute on function public.agentos_run_inbox_state(uuid) to authenticated;
