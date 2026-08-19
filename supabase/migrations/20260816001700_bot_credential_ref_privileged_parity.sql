-- The bot credential denylist, enforced by the database as ADR-036 says it is.
--
-- ADR-036 states that privileged reference names are "rejected by both the
-- application allowlist and a table CHECK constraint". Five of the fourteen
-- names the application rejects were absent from the constraint:
--
--   GITHUB_CLIENT_ID, POSTGRES_URL, SUPABASE_ACCESS_TOKEN,
--   SUPABASE_SECRET_KEY, VERCEL_OIDC_TOKEN
--
-- The constraint is the half that matters for the case it was written for. The
-- application allowlist only runs when the application is in the path;
-- `register_bot` is granted to `authenticated`, and `normalize_bot_credential_ref`
-- validates the *shape* of a reference and nothing else. So an organization
-- manager calling the RPC directly through PostgREST bypassed the allowlist,
-- passed the shape check, and the constraint let five control-plane variable
-- names through.
--
-- No value is exposed by such a row -- readiness resolves a presence boolean
-- and never reads the variable into the database. What was lost is the
-- defence-in-depth boundary that exists precisely for when the first layer is
-- skipped, and the truth of the sentence in the ADR.
--
-- `not valid` is deliberate, and it is not a weakening: PostgreSQL enforces a
-- `not valid` CHECK on every insert and update from the moment it exists, so
-- the hole closes immediately. What it skips is the scan of existing rows,
-- which would fail the whole apply -- and this migration is one of more than
-- twenty an owner still has to get through. Any pre-existing row is visible
-- with:
--
--   select id, name, credential_ref from public.bots
--    where credential_ref in ('GITHUB_CLIENT_ID','POSTGRES_URL',
--          'SUPABASE_ACCESS_TOKEN','SUPABASE_SECRET_KEY','VERCEL_OIDC_TOKEN');
--
-- and the owner can null those references and then `validate constraint`.

alter table public.bots
  drop constraint if exists bots_credential_ref_not_privileged;

alter table public.bots
  add constraint bots_credential_ref_not_privileged check (
    credential_ref is null
    or (
      credential_ref not in (
        -- Supabase
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_DB_PASSWORD',
        'SUPABASE_ACCESS_TOKEN',
        -- GitHub App
        'GITHUB_APP_PRIVATE_KEY',
        'GITHUB_WEBHOOK_SECRET',
        'GITHUB_CLIENT_SECRET',
        'GITHUB_CLIENT_ID',
        'GITHUB_STATE_SECRET',
        -- Database
        'DATABASE_URL',
        'POSTGRES_PASSWORD',
        'POSTGRES_URL',
        -- Deployment
        'VERCEL_TOKEN',
        'VERCEL_OIDC_TOKEN'
      )
      -- A publishable variable is not privileged, but a bot referencing one is
      -- a configuration mistake rather than a credential, and the original
      -- constraint refused it for that reason. Kept.
      and credential_ref not like 'NEXT\_PUBLIC\_%'
    )
  )
  not valid;

comment on constraint bots_credential_ref_not_privileged on public.bots is
  'Refuses a reference to a control-plane variable. Mirrors PRIVILEGED_CREDENTIAL_REFS in lib/bots/credentials.ts; tests/unit/bot-credential-denylist-parity.test.ts fails if the two drift.';
