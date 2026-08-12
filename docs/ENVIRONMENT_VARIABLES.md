# Environment variables

Copy `.env.example` to `.env.local` for development. Real environment files are ignored and must never be committed.

## Browser-public configuration

Only variables with `NEXT_PUBLIC_` are bundled for browser access. They are not secret.

| Variable | Purpose | Phase 1A requirement |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL for absolute metadata links | `http://localhost:3000` locally; set per deployed environment |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project API URL | Optional until Supabase runtime is connected |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preferred Supabase publishable client credential, constrained by RLS | Optional until Supabase runtime is connected |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy fallback for the Supabase anonymous client credential | Optional; prefer the publishable-key variable |

The anonymous/publishable credential is intentionally client-visible. It is not a substitute for RLS and must never be replaced with a service-role key.

## Server-only runtime secrets

`SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES` is a server-only safety switch rather than a secret. It defaults to `false`. Set it to `true` only for a trusted, single-user local development process when repository Markdown saving is intentionally required. Never enable this local-filesystem route in preview or production; it is not an authenticated multi-tenant file service.

| Variable | Purpose | Status |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Future narrow administrative server operations that intentionally bypass RLS | Protected and unused by Phase 1A request handlers |
| `GITHUB_APP_ID` | Future GitHub App identifier | Future integration; **Not Connected** |
| `GITHUB_APP_PRIVATE_KEY` | Future GitHub App signing key | Protected; **Not Connected** |
| `GITHUB_WEBHOOK_SECRET` | Future GitHub webhook signature verification | Protected; **Not Connected** |
| `VERCEL_TOKEN` | Future server-side Vercel API access | Protected; **Not Connected** |
| `OPENAI_API_KEY` | Future server-side OpenAI worker access | Protected; **Not Connected** |
| `ANTHROPIC_API_KEY` | Future server-side Anthropic worker access | Protected; **Not Connected** |

Do not add a `NEXT_PUBLIC_` alias for any server-only value. Avoid passing the environment object into client code or serializing it into props, errors, logs, audit metadata, or reports.

Phase 1A request handlers use the authenticated user's JWT, RLS, and reviewed `SECURITY DEFINER` RPCs; they do not require the service-role key. Do not configure it merely to bypass an RLS problem.

## Local migration/CLI secrets

These are for local tooling or protected CI environments, not browser/runtime configuration:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Authenticate the Supabase CLI to a hosted account |
| `SUPABASE_PROJECT_ID` | Link commands to the intended Supabase project |
| `SUPABASE_DB_PASSWORD` | Database operation authentication |

Prefer interactive/local secret configuration or the deployment platform's encrypted secret store. Never put real values in `.env.example`, workflow YAML, shell history, fixtures, screenshots, or issue text.

## Rotation and failure behavior

- Rotate a credential immediately if it may have entered source control, logs, or a client bundle; removing it from Git is not sufficient.
- A missing privileged variable must fail closed or produce **Not Connected**, never silently enable a weaker path.
- Preview and production use separate credentials and scopes.
- After configuration, validate behavior without printing the credential.
