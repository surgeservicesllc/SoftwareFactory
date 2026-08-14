-- AgentOS task templates, approval gates and follow-up chains.
--
-- docs/AGENTOS_SPEC.md §9–10. A template is an ordered list of steps, each
-- naming the agent that does it and whether a human must sign it off.
-- Instantiating one produces a chain of tasks where step N+1 cannot start
-- until step N is done.
--
-- The spec is blunt that "approval gates are not honor-system": the API must
-- refuse an agent's attempt to complete a gated step. Here that refusal lives
-- in the database, so it holds for any caller — a route that forgets to check,
-- a worker, or a future runner.
--
-- Two distinct completion paths exist on purpose:
--
--   agentos_submit_chain_step_for_review   what an agent may do. Reaches
--                                          `review` at best, never `done`.
--   agentos_complete_chain_step            what a human may do. Requires
--                                          owner or admin, and is the only
--                                          path that unblocks the next step.
--
-- This migration starts no work. Instantiating a chain leaves step 1 ready and
-- every later step blocked; nothing dispatches them.

create type public.agentos_chain_step_state as enum (
  'blocked', 'ready', 'in_progress', 'review', 'done', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table public.agentos_task_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (name ~ '^[a-z][a-z0-9-]{0,62}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  -- Declared names a caller must supply at instantiation, e.g. branchName.
  variables text[] not null default '{}'::text[],
  is_builtin boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_task_templates_name_unique unique (organization_id, name),
  constraint agentos_task_templates_id_organization_unique unique (id, organization_id),
  constraint agentos_task_templates_variables_bounded check (cardinality(variables) <= 20)
);

create table public.agentos_task_template_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  template_id uuid not null,
  step_index smallint not null check (step_index >= 1 and step_index <= 50),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  -- The agent named by role. Resolved to a concrete agent at instantiation so
  -- a template stays portable across organizations.
  agent_name text not null check (agent_name ~ '^[a-z][a-z0-9-]{0,62}$'),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 8000),
  approval_gate boolean not null default false,
  -- The spec's step 9 is assigned to the human, not an agent.
  human_step boolean not null default false,
  created_at timestamptz not null default now(),

  constraint agentos_template_steps_unique unique (template_id, step_index),
  constraint agentos_template_steps_id_organization_unique unique (id, organization_id),
  constraint agentos_template_steps_template_fk foreign key (template_id, organization_id)
    references public.agentos_task_templates(id, organization_id) on delete cascade,
  -- A step a human performs is signed off by a human. Anything else would let
  -- the chain advance past a step nobody did.
  constraint agentos_template_steps_human_is_gated check (not human_step or approval_gate),
  constraint agentos_template_steps_prompt_no_secret check (
    not public.text_has_likely_secret(prompt)
  )
);

-- ---------------------------------------------------------------------------
-- Chains
-- ---------------------------------------------------------------------------

create table public.agentos_task_chains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  template_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  -- Values for the template's declared variables, interpolated into prompts.
  variable_values jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint agentos_task_chains_id_organization_unique unique (id, organization_id),
  constraint agentos_task_chains_project_fk foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint agentos_task_chains_template_fk foreign key (template_id, organization_id)
    references public.agentos_task_templates(id, organization_id) on delete restrict,
  constraint agentos_task_chains_values_object check (jsonb_typeof(variable_values) = 'object'),
  constraint agentos_task_chains_values_no_secret check (
    not public.jsonb_has_sensitive_keys(variable_values)
  )
);

create table public.agentos_task_chain_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  chain_id uuid not null,
  step_index smallint not null check (step_index >= 1 and step_index <= 50),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  agent_name text not null,
  -- The prompt with variables already interpolated, so what an agent receives
  -- is what was recorded rather than something re-derived later.
  resolved_prompt text not null check (char_length(btrim(resolved_prompt)) between 1 and 8000),
  approval_gate boolean not null default false,
  human_step boolean not null default false,
  state public.agentos_chain_step_state not null default 'blocked',
  task_id uuid,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agentos_chain_steps_unique unique (chain_id, step_index),
  constraint agentos_chain_steps_id_organization_unique unique (id, organization_id),
  constraint agentos_chain_steps_chain_fk foreign key (chain_id, organization_id)
    references public.agentos_task_chains(id, organization_id) on delete cascade,
  constraint agentos_chain_steps_task_fk foreign key (task_id, organization_id)
    references public.tasks(id, organization_id) on delete set null,
  -- Done means a person or a path recorded who finished it and when.
  constraint agentos_chain_steps_done_is_attributed check (
    (state = 'done' and completed_at is not null)
    or (state <> 'done' and completed_at is null and completed_by is null)
  ),
  -- A gated step that reached done must name the human who signed it off.
  -- Without this the gate could be satisfied by an unattributed write.
  constraint agentos_chain_steps_gated_done_has_human check (
    not (state = 'done' and approval_gate) or completed_by is not null
  )
);

create index agentos_task_templates_org_idx on public.agentos_task_templates (organization_id, name);
create index agentos_template_steps_template_idx
  on public.agentos_task_template_steps (organization_id, template_id, step_index);
create index agentos_task_chains_project_idx
  on public.agentos_task_chains (organization_id, project_id, created_at desc);
create index agentos_chain_steps_chain_idx
  on public.agentos_task_chain_steps (organization_id, chain_id, step_index);

alter table public.agentos_task_templates enable row level security;
alter table public.agentos_task_templates force row level security;
alter table public.agentos_task_template_steps enable row level security;
alter table public.agentos_task_template_steps force row level security;
alter table public.agentos_task_chains enable row level security;
alter table public.agentos_task_chains force row level security;
alter table public.agentos_task_chain_steps enable row level security;
alter table public.agentos_task_chain_steps force row level security;

create policy agentos_task_templates_select_members
  on public.agentos_task_templates for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_template_steps_select_members
  on public.agentos_task_template_steps for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_task_chains_select_members
  on public.agentos_task_chains for select to authenticated
  using (public.is_organization_member(organization_id));
create policy agentos_chain_steps_select_members
  on public.agentos_task_chain_steps for select to authenticated
  using (public.is_organization_member(organization_id));

revoke all on table public.agentos_task_templates from anon, authenticated;
revoke all on table public.agentos_task_template_steps from anon, authenticated;
revoke all on table public.agentos_task_chains from anon, authenticated;
revoke all on table public.agentos_task_chain_steps from anon, authenticated;

grant select on table public.agentos_task_templates to authenticated;
grant select on table public.agentos_task_template_steps to authenticated;
grant select on table public.agentos_task_chains to authenticated;
grant select on table public.agentos_task_chain_steps to authenticated;

-- ---------------------------------------------------------------------------
-- Variable interpolation
-- ---------------------------------------------------------------------------

create or replace function public.agentos_interpolate_prompt(
  p_prompt text,
  p_values jsonb
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  result text := p_prompt;
  key text;
  value text;
begin
  for key, value in select * from jsonb_each_text(coalesce(p_values, '{}'::jsonb)) loop
    result := replace(result, '{{' || key || '}}', value);
  end loop;

  -- An unfilled placeholder means the caller did not supply a declared
  -- variable. Interpolating nothing and carrying on would hand an agent a
  -- prompt containing literal braces.
  if result ~ '\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}' then
    raise exception using
      errcode = '22023',
      message = 'the prompt still contains an unfilled variable';
  end if;

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Instantiation
-- ---------------------------------------------------------------------------

create or replace function public.agentos_instantiate_template(
  p_project_id uuid,
  p_template_id uuid,
  p_title text,
  p_variable_values jsonb default '{}'::jsonb
)
returns public.agentos_task_chains
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  project_record record;
  template_record public.agentos_task_templates;
  step_record record;
  chain_record public.agentos_task_chains;
  missing text;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select p.id, p.organization_id into project_record
    from public.projects p where p.id = p_project_id;
  if not found then
    raise exception using errcode = '42501', message = 'the project does not exist or is not visible';
  end if;
  if not public.is_organization_member(project_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select * into template_record
    from public.agentos_task_templates
   where id = p_template_id and organization_id = project_record.organization_id;
  if not found then
    raise exception using errcode = '42501', message = 'the template does not exist in this organization';
  end if;

  -- Every declared variable must be supplied. Discovering a missing one at
  -- step 5, hours in, is worse than refusing now.
  select string_agg(v, ', ') into missing
    from unnest(template_record.variables) as v
   where not (p_variable_values ? v);
  if missing is not null then
    raise exception using
      errcode = '22023',
      message = format('missing values for template variables: %s', missing);
  end if;

  insert into public.agentos_task_chains
    (organization_id, project_id, template_id, title, variable_values, created_by)
  values
    (project_record.organization_id, p_project_id, p_template_id, p_title,
     coalesce(p_variable_values, '{}'::jsonb), caller_id)
  returning * into chain_record;

  for step_record in
    select * from public.agentos_task_template_steps
     where template_id = p_template_id
     order by step_index
  loop
    insert into public.agentos_task_chain_steps
      (organization_id, chain_id, step_index, name, agent_name, resolved_prompt,
       approval_gate, human_step, state)
    values
      (project_record.organization_id, chain_record.id, step_record.step_index,
       step_record.name, step_record.agent_name,
       public.agentos_interpolate_prompt(step_record.prompt, chain_record.variable_values),
       step_record.approval_gate, step_record.human_step,
       -- Only the first step is ready. Everything after it waits.
       (case when step_record.step_index = 1 then 'ready' else 'blocked' end)::public.agentos_chain_step_state);
  end loop;

  return chain_record;
end;
$function$;

revoke all on function public.agentos_instantiate_template(uuid, uuid, text, jsonb)
  from public, anon, service_role;
grant execute on function public.agentos_instantiate_template(uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Advancing a chain
-- ---------------------------------------------------------------------------
--
-- What an agent may do. `review` is the ceiling: a gated step cannot be
-- finished from here, and an ungated one still waits for the completion call
-- so that unblocking the next step has exactly one implementation.

create or replace function public.agentos_submit_chain_step_for_review(p_step_id uuid)
returns public.agentos_task_chain_steps
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  step_record public.agentos_task_chain_steps;
  updated public.agentos_task_chain_steps;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into step_record
    from public.agentos_task_chain_steps where id = p_step_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'the step does not exist or is not visible';
  end if;
  if not public.is_organization_member(step_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  -- A blocked step has an unfinished predecessor. Letting it report progress
  -- would make the ordering cosmetic.
  if step_record.state not in ('ready', 'in_progress') then
    raise exception using
      errcode = '22023',
      message = format('a step in state %s cannot be submitted for review', step_record.state);
  end if;

  update public.agentos_task_chain_steps
     set state = 'review', updated_at = now()
   where id = p_step_id
  returning * into updated;

  return updated;
end;
$function$;

revoke all on function public.agentos_submit_chain_step_for_review(uuid)
  from public, anon, service_role;
grant execute on function public.agentos_submit_chain_step_for_review(uuid) to authenticated;

-- What a human may do. The only path to `done`, and the only path that
-- unblocks the next step.
create or replace function public.agentos_complete_chain_step(p_step_id uuid)
returns public.agentos_task_chain_steps
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  step_record public.agentos_task_chain_steps;
  updated public.agentos_task_chain_steps;
  is_manager boolean;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into step_record
    from public.agentos_task_chain_steps where id = p_step_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'the step does not exist or is not visible';
  end if;
  if not public.is_organization_member(step_record.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  select exists (
    select 1 from public.organization_members m
     where m.organization_id = step_record.organization_id
       and m.user_id = caller_id
       and m.role in ('owner', 'admin')
  ) or public.is_organization_owner(step_record.organization_id)
    into is_manager;

  -- The spec's rule: a gated step is signed off by a person, and only a
  -- person. This is the refusal an agent session hits.
  if step_record.approval_gate and not is_manager then
    raise exception using
      errcode = '42501',
      message = 'this step is approval-gated and only an owner or administrator may complete it';
  end if;

  if step_record.state = 'done' then
    raise exception using errcode = '22023', message = 'the step is already done';
  end if;
  if step_record.state = 'blocked' then
    raise exception using errcode = '22023', message = 'the step is blocked by an earlier step';
  end if;
  if step_record.state = 'cancelled' then
    raise exception using errcode = '22023', message = 'the step was cancelled';
  end if;

  update public.agentos_task_chain_steps
     set state = 'done', completed_by = caller_id, completed_at = now(), updated_at = now()
   where id = p_step_id
  returning * into updated;

  -- Exactly one successor becomes ready, and only from `blocked`, so a
  -- re-run cannot revive a cancelled step.
  update public.agentos_task_chain_steps
     set state = 'ready', updated_at = now()
   where chain_id = step_record.chain_id
     and step_index = step_record.step_index + 1
     and state = 'blocked';

  return updated;
end;
$function$;

revoke all on function public.agentos_complete_chain_step(uuid) from public, anon, service_role;
grant execute on function public.agentos_complete_chain_step(uuid) to authenticated;

comment on function public.agentos_complete_chain_step(uuid) is
  'The only path to done, and the only path that unblocks the next step. A gated step refuses any caller who is not an owner or administrator.';
