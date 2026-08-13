# Environment variables

Copy `.env.example` to `.env.local` for development. Real environment files are ignored and must never be committed. An empty provider value must produce **Not Connected**, not a weaker authentication path.

## Browser-public configuration

Only the following variables may be exposed through `NEXT_PUBLIC_`. They are intentionally public but still require RLS and server authorization.

| Variable | Purpose | Production status |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL | Use `https://softwarefactory-tan.vercel.app` in production |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project API URL | Configured in Vercel Production |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preferred browser credential constrained by RLS | Configured in Vercel Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy fallback for the browser credential | Optional; prefer the publishable key |

Never place a service-role key, provider token, client secret, private key, state secret, or webhook secret in a `NEXT_PUBLIC_` variable.

## Server-only Supabase configuration

| Variable | Purpose | Rules/status |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Narrow webhook and audited privileged GitHub synchronization/RPC boundary | Configured in Vercel Production; bypasses RLS and must stay server-only |

Interactive Auth, organization, project, and repository reads use the caller's session plus RLS. Service-role access does not replace tenant checks and is not a fix for an RLS error.

## Server-only GitHub App configuration

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | Numeric App identity |
| `GITHUB_APP_SLUG` | Installation URL slug |
| `GITHUB_APP_CLIENT_ID` | OAuth client identity |
| `GITHUB_APP_CLIENT_SECRET` | One-time callback code exchange |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Preferred Vercel-safe PEM representation |
| `GITHUB_APP_PRIVATE_KEY` | Alternative raw/escaped PEM representation |
| `GITHUB_APP_CALLBACK_URL` | Exact environment callback URL |
| `GITHUB_APP_WEBHOOK_SECRET` | Raw-body HMAC verification secret, minimum 32 bytes |
| `GITHUB_APP_STATE_SECRET` | Installation state signing secret, minimum 32 bytes and distinct from webhook secret |
| `GITHUB_COMMIT_IDENTITY_NAME` | Explicit name used for both author and committer on controlled draft-PR commits |
| `GITHUB_COMMIT_IDENTITY_EMAIL` | Explicit email used for both author and committer on controlled draft-PR commits |

Configure exactly one private-key representation. The application prefers `GITHUB_APP_PRIVATE_KEY_BASE64` when both exist. Current production deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY from exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e` after rotating the webhook secret in Sensitive Production and Preview scopes. The repository connection is live; the provider webhook remains blank/inactive and independently **Not Connected**.

Commit identity has no provider/App-bot fallback. `GITHUB_COMMIT_IDENTITY_NAME` and `GITHUB_COMMIT_IDENTITY_EMAIL` are configured server-side in both Vercel Production and Preview for the owner-approved public identity `surgeservicesllc <surgeservicesllc@gmail.com>`. Both values must pass strict server-side validation before the change route performs tenant persistence, token minting, or a GitHub mutation. The identity is never sent to the browser, stored in Supabase, or written to logs; it is sent only to GitHub in the Contents API's required `author` and `committer` objects. Live ordinary and protected draft commits have verified both fields.

## Safety/deferred providers

| Variable | Purpose | Status |
| --- | --- | --- |
| `VERCEL_TOKEN` | Future in-product Vercel API adapter | **Not Connected**; not required to host the UI |
| `OPENAI_API_KEY` | Future Codex/OpenAI worker | **Not Connected**; Phase 1C |
| `ANTHROPIC_API_KEY` | Future Claude worker | **Not Connected**; Phase 2 |

The GitHub-backed editor uses authenticated repository-scoped App tokens and always creates an isolated branch and draft PR. Its commit author and committer are the same explicitly configured server-only deployment identity. No HTTP route can write directly to the local repository or protected memory/policy files.

## CLI-only Supabase values

These values are for protected local/operator tooling, not application runtime:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Authenticate Supabase CLI |
| `SUPABASE_PROJECT_ID` | Identify/link the intended project (`qpuofpmagrmyamahqwxw` in production) |
| `SUPABASE_DB_PASSWORD` | Protected database operation authentication when required |

Prefer the CLI credential store or a protected operator environment. Do not put real values in `.env.example`, workflow YAML, shell history, fixtures, screenshots, logs, or issue text.

## Rotation and validation

- Revoke/rotate immediately if a credential may have entered Git, logs, screenshots, or a client bundle.
- Use separate preview and production credentials/data. Production Supabase values are verified configured; Preview Supabase values are not independently verified.
- Restart/redeploy after secret changes, then verify behavior without printing values.
- Validate the production client bundle contains no privileged variable names or values.
- A provider object or environment variable alone is not a Connected result.
