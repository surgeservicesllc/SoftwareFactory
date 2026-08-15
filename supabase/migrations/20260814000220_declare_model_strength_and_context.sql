-- Let an owner declare what the Resource Manager has to know about a model.
--
-- Phase 2C's eligibility rules need two facts that Phase 2A's catalogue does
-- not carry: how strong the model is, and how much input it accepts. Both are
-- eligibility inputs, not scoring weights — `requiresStrongModel` refuses to
-- push RED, judgement, security, architecture, or synthesis work onto an
-- economical model, and `CONTEXT_TOO_SMALL` refuses work that would not fit.
--
-- They are added here rather than inferred from the model's name. A lookup
-- table keyed by name would be wrong the first time a provider ships a model
-- nobody updated it for, and it would be wrong silently — in the direction of
-- claiming capability, which is the bad direction.
--
-- Both columns are nullable, and null means **undeclared**, never a default.
-- The application fails closed on an undeclared value: a model whose strength
-- the owner has not stated cannot take work that requires a strong model, and a
-- model whose limit is unstated cannot be shown to fit. That is the honest
-- reading, and it is also why this migration cannot backfill a guess.
--
-- This extends the Phase 2A catalogue additively. It does not alter `130001`,
-- and it does not touch any constraint that the pending `20260813001500`
-- migration redefines.

alter table public.provider_model_configurations
  add column if not exists strength_tier text
    check (strength_tier is null or strength_tier in ('economical', 'balanced', 'strong')),
  add column if not exists context_limit_tokens integer
    check (context_limit_tokens is null or context_limit_tokens between 1 and 100000000);

comment on column public.provider_model_configurations.strength_tier is
  'Owner-declared strength: economical | balanced | strong. Null means undeclared, never a default. An undeclared model cannot take work that requires a strong model.';
comment on column public.provider_model_configurations.context_limit_tokens is
  'Owner-declared maximum input in tokens. Null means undeclared, never unlimited. Work cannot be shown to fit an undeclared limit.';
