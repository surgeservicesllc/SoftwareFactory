-- Seed the standard model catalogue for every existing organization.
--
-- A logical agent can only be assigned a model that is an *enabled catalogue
-- configuration* for its organization — `set_agent_provider_assignment`
-- refuses anything else by design — and organizations start with an empty
-- catalogue. On the hosted deployment that left every select on the Agents
-- page offering exactly one row, "Automatic routing", with the way forward
-- depending on a person finding and pressing a seed button. The catalogue
-- should simply exist: it is non-secret metadata (model identifiers and
-- display names), it claims no provider connection, and it enables no
-- execution.
--
-- The list mirrors `lib/providers/standard-catalogue.ts`, which derives from
-- the bot catalog's per-provider suggested models. `created_by` is a NOT
-- NULL reference to auth.users, so each row is attributed to the
-- organization's earliest owner or administrator; an organization with no
-- such member is skipped rather than guessed at.
--
-- Replay-safe by construction: the insert lands on the catalogue's
-- (organization_id, provider, model) unique key with DO NOTHING, so applying
-- this file twice — or after an organization already seeded itself through
-- the console — changes nothing. Organizations created after this migration
-- seed themselves through the Agents page's one-click control.

insert into public.provider_model_configurations
  (organization_id, provider, model, display_name, capabilities, enabled, created_by)
select
  organization.id,
  standard.provider::public.connection_provider,
  standard.model,
  standard.display_name,
  '[]'::jsonb,
  true,
  manager.user_id
from public.organizations organization
cross join (
  values
    ('anthropic', 'claude-opus-5', 'Claude Opus 5'),
    ('anthropic', 'claude-sonnet-5', 'Claude Sonnet 5'),
    ('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5'),
    ('anthropic', 'claude-fable-5', 'Claude Fable 5'),
    ('openai', 'gpt-5.1-codex', 'GPT-5.1 Codex'),
    ('openai', 'gpt-5.1', 'GPT-5.1'),
    ('openai', 'gpt-5-mini', 'GPT-5 Mini'),
    ('openai', 'o4-mini', 'o4-mini')
) as standard(provider, model, display_name)
join lateral (
  select member.user_id
  from public.organization_members member
  where member.organization_id = organization.id
    and member.role in ('owner', 'admin')
  order by member.created_at
  limit 1
) manager on true
on conflict (organization_id, provider, model) do nothing;
