-- Put existing Codex bots on the model the executor actually accepts.
--
-- `createPhase1CExecutionPlan` fixes the command's provider and model, and
-- both `selectFactoryCommandRoute` and `submit_factory_command` refuse any bot
-- whose pair is not exactly that. Meanwhile `ensureProviderBot` named a new
-- bot's model from the catalog's suggestion list. The two were one fact
-- written in two files, and they drifted: the plan fixed `gpt-5.3-codex`
-- while every provisioned Codex bot got `gpt-5.1-codex`.
--
-- The effect was total rather than partial. Every command, in every
-- workspace, was refused at the last step of the journey with
-- PROVIDER_MODEL_MISMATCH — after choosing a project, a pipeline, and a bot.
-- Nothing was wrong with the setup; the console had shipped a bot the
-- executor could never match.
--
-- The code side is fixed by one source of truth (`executionModel()`, which
-- provisioning now asks). This repairs the rows already written, because a
-- constant fix alone would leave every existing workspace blocked.
--
-- Scope is deliberately narrow: only the models the catalog itself could have
-- produced for the executing provider. A model this console never offered was
-- typed by a person and is left alone, even though it cannot execute either —
-- silently rewriting a deliberate choice is worse than refusing it, and the
-- refusal now says what to change.

do $do$
declare
  -- The default `executionModel()` resolves to.
  -- `tests/integration/executable-model-migration.contract.test.ts` fails if
  -- this and `DEFAULT_CODEX_MODEL` ever disagree, so this is not a fourth
  -- place the value can drift.
  v_executable_model constant text := 'gpt-5.3-codex';
  -- Everything `lib/bots/catalog.ts` has ever led its openai list with, or
  -- offered beside it. None of these can be claimed by the worker.
  v_catalog_models constant text[] :=
    array['gpt-5.1-codex', 'gpt-5.1', 'gpt-5-mini', 'o4-mini'];
  v_bot record;
  v_assignment record;
begin
  for v_bot in
    select bot.id, bot.organization_id, bot.model, bot.name
    from public.bots bot
    where bot.provider = 'openai'::public.bot_provider
      and bot.model = any(v_catalog_models)
    for update
  loop
    update public.bots
    set model = v_executable_model,
        updated_at = now()
    where id = v_bot.id;

    -- Visible rather than silent: a person who chose a model from the list
    -- can see that it moved, and why.
    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    ) values (
      v_bot.organization_id,
      null,
      null,
      'bot.updated'::public.activity_event_type,
      'bot',
      v_bot.id,
      'Bot moved onto the model the Codex executor accepts, so its commands can be routed.',
      pg_catalog.jsonb_build_object(
        'previous_model', v_bot.model,
        'model', v_executable_model,
        'reason', 'provider_model_mismatch_repair'
      )
    );
  end loop;

  -- A per-posting override pointing at an unexecutable model blocks the
  -- command just as surely as the bot's own model did. Cleared rather than
  -- rewritten: null means "use the bot's model", which is now correct, and
  -- claiming the person asked for the executable model would be inventing an
  -- intention they never expressed.
  for v_assignment in
    select assignment.id, assignment.organization_id, assignment.project_id, assignment.model
    from public.bot_assignments assignment
    join public.bots bot
      on bot.id = assignment.bot_id
     and bot.organization_id = assignment.organization_id
    where bot.provider = 'openai'::public.bot_provider
      and assignment.model = any(v_catalog_models)
      and assignment.status <> 'released'
    for update of assignment
  loop
    update public.bot_assignments
    set model = null
    where id = v_assignment.id;

    insert into public.activity_events (
      organization_id, project_id, actor_user_id, event_type,
      entity_type, entity_id, description, metadata
    ) values (
      v_assignment.organization_id,
      v_assignment.project_id,
      null,
      'bot.assignment_changed'::public.activity_event_type,
      'bot_assignment',
      v_assignment.id,
      'Per-posting model override cleared: it named a model the Codex executor cannot claim, so the bot''s own model applies.',
      pg_catalog.jsonb_build_object(
        'previous_model', v_assignment.model,
        'model', null,
        'reason', 'provider_model_mismatch_repair'
      )
    );
  end loop;
end
$do$;
