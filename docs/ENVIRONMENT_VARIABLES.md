# Environment variables

Copy `.env.example` to `.env.local` only for local development. Real environment files are ignored and must never be committed. Empty or invalid provider configuration must produce **Not Connected**, never a weaker fallback.

## Browser-public variables

Only these values may use `NEXT_PUBLIC_`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preferred browser credential constrained by RLS |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional legacy browser credential fallback |

Never put a service-role key, OpenAI key, App private key, OAuth/client/state/webhook secret, database password, or installation token in a `NEXT_PUBLIC_` variable.

## Vercel server-only application variables

The Next.js application uses:

- `SUPABASE_SERVICE_ROLE_KEY` for narrow server-only webhook/audited privileged RPCs;
- primary `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, one of `GITHUB_APP_PRIVATE_KEY_BASE64`/`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CALLBACK_URL`, `GITHUB_APP_WEBHOOK_SECRET`, and `GITHUB_APP_STATE_SECRET`;
- optional complete, isolated candidate equivalents prefixed `GITHUB_CANDIDATE_APP_`; and
- `GITHUB_COMMIT_IDENTITY_NAME=surgeservicesllc` plus `GITHUB_COMMIT_IDENTITY_EMAIL=surgeservicesllc@gmail.com` for controlled GitHub commits.

Vercel values are scoped server-side. Candidate configuration is absent-or-complete and cannot reuse primary cryptographic material. Commit identity is public attribution but still server owned; request data cannot override it.

The Phase 2A advisory APIs may use these additional server-only Vercel variables:

- `ANTHROPIC_API_KEY`, optional `ANTHROPIC_DEFAULT_MODEL`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_PROVIDER_DISABLED`;
- `OPENAI_API_KEY`, required `OPENAI_DEFAULT_MODEL` when OpenAI advisory execution is configured, optional `OPENAI_BASE_URL`, and `OPENAI_PROVIDER_DISABLED`; and
- `AI_PROVIDER_TIMEOUT_MS` for the bounded advisory request timeout.

These variables authorize advisory provider calls only after the organization execution switch is enabled. They never authorize repository writes or Phase 1C. The Phase 1C Codex worker does not run inside a Vercel request handler and uses its own protected GitHub Actions secret mapping.

## Phase 1C worker runtime variables

The Node worker validates all required values before registration:

| Variable | Purpose/default |
| --- | --- |
| `SOFTWAREFACTORY_WORKER_ENABLED` | Must be literal `true` to execute; default `false` |
| `SOFTWAREFACTORY_WORKER_RUNTIME` | Must be literal `docker` |
| `SOFTWAREFACTORY_WORKER_ID` | Unique bounded worker identity |
| `SOFTWAREFACTORY_WORK_ROOT` | Dedicated safe run directory, never root/home/repository root |
| `SOFTWAREFACTORY_WORKER_POLL_MS` | Persistent-worker poll interval, default 5000 ms |
| `SOFTWAREFACTORY_WORKER_HEARTBEAT_MS` | Lease heartbeat interval, default 10000 ms |
| `SOFTWAREFACTORY_CODEX_MODEL` | Reviewed model, currently `gpt-5.3-codex` |
| `SOFTWAREFACTORY_REQUIRED_CHECKS` | Required exact CI job names, pipe-delimited; reviewed value is `Lint, typecheck, test, and build|Browser and accessibility tests 1/3|Browser and accessibility tests 2/3|Browser and accessibility tests 3/3` |
| `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` | Shared fail-closed application/workflow gate for Phase 1C dispatch; keep `false` under production containment |
| `SOFTWAREFACTORY_GRAPH_WORKER_ENABLED` | Global fail-closed graph-worker activation gate; keep `false` unless a bounded release explicitly enables execution |
| `SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED` | Scheduled-drain gate; has no effect while the global graph-worker gate is off |
| `SOFTWAREFACTORY_TARGET_GRAPH_ID` | Exact graph UUID required by repository/manual one-shot graph claims; scheduled drains leave it empty |
| `NEXT_PUBLIC_SUPABASE_URL` | Runtime Supabase URL; public value used server-side here |
| `SOFTWAREFACTORY_EXPECTED_SUPABASE_PROJECT_REF` | Server-only exact Supabase project identity; `/api/health` fails closed if the configured public URL points anywhere else |
| `SOFTWAREFACTORY_EXPECTED_VERCEL_PROJECT_ID` | Server-only exact Vercel project ID; `/api/health` joins the public alias to this project and its immutable deployment identity |
| `SOFTWAREFACTORY_EXPECTED_PRODUCTION_HOST` | Server-only exact public production hostname accepted by `/api/health` (for example `www.theagoras.com`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only worker RPC credential |
| `SOFTWAREFACTORY_CODEX_AUTH_JSON` | Contents of `~/.codex/auth.json` from a subscription `codex login`. The zero-token default; the worker refuses to start without it |
| `SOFTWAREFACTORY_CODEX_AUTH_MODE` | `subscription` (default) or `api_key`. The billed mode must name itself; it is never selected implicitly |
| `SOFTWAREFACTORY_TARGET_COMMAND_ID` | Non-secret exact Phase 1C command UUID for a repository/manual one-shot claim; empty for the disabled scheduled path |
| `SOFTWAREFACTORY_TARGET_CLAIM_REQUIRED` | Non-secret `true`/`false` guard. `true` refuses startup unless `SOFTWAREFACTORY_TARGET_COMMAND_ID` is present and valid |
| `OPENAI_API_KEY` | Only read in `api_key` mode, which bills per token. Setting it without that mode is a refused configuration |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY_BASE64` | Primary installation-token identity/key |
| `GITHUB_CANDIDATE_APP_ID` / `GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64` | Candidate installation-token identity/key |
| `GITHUB_COMMIT_IDENTITY_NAME` | Must resolve to `surgeservicesllc` for release |
| `GITHUB_COMMIT_IDENTITY_EMAIL` | Must resolve to `surgeservicesllc@gmail.com` for release |

The worker checks that the Supabase credential is a service-role credential, that URLs and identities are valid, and that the work root is safe. General Git/npm/Codex child processes receive a narrow environment rather than the full parent secret environment.

Repository-dispatch and manual one-shot workflows set
`SOFTWAREFACTORY_TARGET_CLAIM_REQUIRED=true` together with the exact dispatched
`SOFTWAREFACTORY_TARGET_COMMAND_ID`. The database claim uses that UUID as an
authoritative filter, not a diagnostic hint. Schedules keep the required guard
false and omit the target; neither variable is a credential or enables a
worker, schedule, provider, or autonomous action.

`SOFTWAREFACTORY_REQUIRED_CHECKS` is required and fail closed. Parsing trims and deduplicates pipe-delimited names and requires 1-20 unique entries, each no longer than 300 characters. All four reviewed names must continue to exactly match the job display names in `.github/workflows/ci.yml`; a missing, empty, renamed, duplicate-only, oversized, or drifting value prevents safe acceptance.

## GitHub Actions repository secrets

GitHub does not permit Actions secret names beginning with `GITHUB_`. Store worker secrets using exactly these repository secret names:

| Actions secret | Mapped runtime variable |
| --- | --- |
| `SOFTWAREFACTORY_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| `SOFTWAREFACTORY_CODEX_AUTH_JSON` | `SOFTWAREFACTORY_CODEX_AUTH_JSON` |
| `SOFTWAREFACTORY_GITHUB_APP_ID` | `GITHUB_APP_ID` |
| `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64` | `GITHUB_APP_PRIVATE_KEY_BASE64` |
| `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID` | `GITHUB_CANDIDATE_APP_ID` |
| `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64` | `GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64` |

`.github/workflows/codex-worker.yml` performs this mapping only on the final worker step. It does not pass secrets to checkout, Node setup, dependency install, or validation-image preload. The public commit identity is set in workflow environment, not stored as a secret.

The workflow sets `SOFTWAREFACTORY_REQUIRED_CHECKS` to `Lint, typecheck, test, and build|Browser and accessibility tests 1/3|Browser and accessibility tests 2/3|Browser and accessibility tests 3/3`. It is public policy configuration, not a secret. Do not change it independently of the exact CI job display names or the worker publisher tests.

Six non-OpenAI Actions secrets are currently verified configured. `SOFTWAREFACTORY_OPENAI_API_KEY` is intentionally absent, and it is now absent **permanently rather than pending**: Phase 1C no longer has a paid-API path to restore it to. The exposed key was removed after diagnostic run `31748582858` classified the prior project's failure as `credit_balance_exhausted`, and that failure is what prompted the architecture change — a funded API balance is no longer a precondition for any run.

The worker instead requires `SOFTWAREFACTORY_CODEX_AUTH_JSON`, the contents of `~/.codex/auth.json` produced by a subscription `codex login`. It carries OAuth tokens for the ChatGPT account, so it is server-only secret material subject to the same protected-resource rules. Secret configuration alone is never a Connected-worker claim. Creating or changing any of these secrets is RED protected-resource work requiring exact owner approval.

The workflow also requires the non-secret repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` to equal the literal `true`. Missing, empty, or any other value skips the worker job for repository dispatch and schedule triggers. Branch-selectable manual workflow dispatch is intentionally absent. The variable is currently absent/OFF. Keep it absent while the OpenAI funding blocker remains. Change it to `true` only for the exact owner-approved diagnostic or activation window, then return it to absent immediately after job admission unless separately approved continued operation exists.

## CLI-only Supabase variables

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID` (production is `qpuofpmagrmyamahqwxw`)
- `SUPABASE_DB_PASSWORD` when required

Prefer the CLI credential store or protected operator environment. Reauthenticate as `surgeservicesllc@gmail.com` and verify the exact project before every linked production command.

## Other deferred providers

- `VERCEL_TOKEN`: in-product deployment adapter **Not Connected**.
- Anthropic/OpenAI Phase 2A adapters exist, but no credential or live call is verified and provider execution defaults OFF; both remain **Not Connected**.

## Rotation and validation

- Never print secret values in shell/tool output, workflow logs, screenshots, issues, reports, prompts, or database rows.
- Revoke/rotate at the provider if a value may have entered Git, logs, screenshots, artifacts, or a client bundle.
- Keep Preview/Development and Production credentials/data deliberately isolated.
- Verify only secret names/presence, then exercise behavior without revealing values.
- A configured name or provider object is not connection evidence; require a current heartbeat and real successful run.
