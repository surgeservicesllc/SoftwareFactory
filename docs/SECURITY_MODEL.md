# Security model

## Trust boundaries

The browser is untrusted. Next.js authenticates and authorizes command intent. Supabase RLS independently restricts tenant data. GitHub responses, webhook payloads, repository files, dispatch events, Codex/model output, validation output, and Vercel/GitHub status are external or untrusted even when authenticated.

Phase 1C adds a distinct trusted worker boundary. A dispatch event is never authority: the worker must claim one durable eligible run with service-role-only RPCs and an exact lease token, then revalidate repository identity, base SHA, cancellation, budgets, and policy before each material stage.

## Authentication and tenant authorization

- Supabase Auth sessions resolve server-side with an active organization.
- Command submission requires same origin, authenticated organization ownership, and a live connected project.
- Repository identity comes from the project connection's immutable GitHub repository UUID plus persisted installation/App IDs; a mutable name is display metadata.
- The server fetches the current default-branch SHA before persistence. The worker verifies the same SHA from GitHub before checkout.
- Member-facing agent/task/run/report/status functions require organization membership and return bounded allowlisted fields.
- Run cancel/retry requires owner/admin, exact run/organization checks, bounded reasons, and eligible retry state.
- Worker table access is denied to browser sessions; privileged worker functions are service-role only.
- Hidden controls and request JSON never confer authority.

## Risk and orchestration integrity

The server computes the highest of requested risk, command-type floor, and protected prompt/acceptance-criteria signals. Phase 1C migrations `130007`-`130011` independently recompute the floor, restrict keys/payload/dependencies, reject likely secrets, require ownership, and reject any provider/model/role/budget/workflow outside the fixed plan. Direct PostgREST callers cannot downgrade or widen a run, cross tenant/project dependency boundaries, or reset total retry budgets.

Only manual GREEN/YELLOW commands become claimable. RED commands/tasks are forced back to blocked/awaiting approval and excluded from claim. An owner approval cannot turn RED into Phase 1C execution authority.

## Worker lease security

- Workers register a bounded ID/version/capability projection and refresh a heartbeat.
- A claim sets worker ID, lease UUID, expiry, attempt number, and running state atomically and prevents a second active lease for the same neutral logical agent.
- Every heartbeat/event/validation/artifact/completion call rechecks the exact worker/lease/run tuple.
- Cancellation is durable and checked by heartbeat/abort paths.
- Retry is explicit, owner/admin scoped, allowed only for retryable failed attempts below the maximum, and creates audit evidence.
- Stale lease recovery is database controlled. Exhausted stale leases terminalize as failed/cancelled with activity/report evidence; arbitrary reassignment or duplicate terminal completion fails closed.
- Worker heartbeat status is time-derived. A one-shot worker started by approved default-branch repository dispatch or schedule registers active while running and records `idle` on clean exit; a fresh idle heartbeat is briefly Available/Connected, then becomes stale/**Not Connected** after the bounded threshold. That no-work observation cannot prove live execution, and branch-selectable manual workflow dispatch is absent.

## Codex execution security

- The supported `@openai/codex-sdk` receives the OpenAI key server-side only.
- Codex has an isolated `CODEX_HOME`, controlled process environment, one repository work directory, workspace-write sandbox, approval `never`, workspace network disabled, and web search disabled.
- Prompt content contains only bounded command, criteria, logical role, risk, and non-secret repository/base-SHA identity. It explicitly forbids credential access, provider actions, push/PR/merge/deploy, `.git` changes, and network enabling.
- Turns, input/output tokens, wall time, retries, and persisted event/output sizes are bounded.
- Agent reasoning/messages are not blindly stored. Only a small allowlisted event projection and final bounded redacted summary/usage are persisted.

## Workspace and process security

- Work root cannot be filesystem root, home, or repository root. A run marker binds run, repository, base SHA, and branch.
- Git uses explicit commands with `shell: false`, disabled terminal prompting, time/output caps, and per-command credential injection/redaction.
- The remote URL, current branch, fetched SHA, remote existing branch, and ancestry are verified before recovery.
- Branches match `factory/<run-uuid>-<slug>` and are never the default branch.
- Dependency bootstrap uses the exact pinned Node digest, bridge network only for `npm ci`, and `--ignore-scripts`.
- Deterministic validation uses network none, read-only root, dropped capabilities, no-new-privileges, PID/CPU/memory caps, a noexec temporary filesystem, controlled environment, and bounded output.

## Repository mutation security

The changed-file scanner:

- normalizes paths and rejects absolute/traversing/`.git`/credential/key-container paths;
- rejects symlinks and binary/non-UTF-8 files;
- rejects likely secret assignments/content;
- caps at 200 files, 2 MiB per file, and 10 MiB aggregate changed content; and
- requires a current exact approval naming every protected path. RED remains blocked earlier regardless of approval.

After validation/scan, the worker commits with `surgeservicesllc <surgeservicesllc@gmail.com>`, mints a repository-ID-scoped App token, pushes only the factory branch, and creates or recovers only an open draft PR. Artifact persistence requires one coherent branch/commit pair and at most one exactly matching draft PR; exact replay is accepted, while partial/conflicting project/repository/run/base/head/URL/number evidence is rejected. Recovery revalidates remote branch SHA and PR identity.

CI is observed against the exact head SHA. `SOFTWAREFACTORY_REQUIRED_CHECKS` must contain 1-20 unique pipe-delimited exact names; the reviewed value is `Lint, typecheck, test, and build|Browser and accessibility tests`. The publisher requires the complete returned check set, every observed check terminal and acceptable, each required name present with exact `success`, the identical passing fingerprint twice, and a final exact PR number/base/head recheck. It cannot approve, merge, write the default branch, modify workflows/branch protection/secrets/settings, deploy, or rollback.

## Database and audit security

- The owner-approved production ledger repair and forward chain are complete through `130014`: `130006` adds decision-only Phase 1D controls; `130007` adds provider compatibility; `130008` commits Phase 1C enums before `130009` execution; `130010` hardens roster/recovery/reporting; `130011` adds dependencies plus cumulative retry budgets; and `130012`-`130014` are forward-only lint and emergency-stop repairs. Local `130015` restores two model checks from 120 to 128, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds bounded run-detail routing evidence, revokes authenticated raw routing-decision/event SELECT, and retains tenant-scoped model-configuration SELECT; it is unhosted and needs fresh exact RED approval.
- `130010` provisions an idempotent logical roster (Orchestrator, Product, Architect, Frontend, Backend, Database, QA, Security, Performance, Release, CEO Reporter) without overwriting user-created agents or explicit provider assignments. Provider-account identity remains separate, and general Phase 1C work maps to Orchestrator.
- New tables use RLS/FORCE RLS, foreign keys, constraints, indexes, explicit policies, and revoked direct grants.
- Service role reaches execution tables only through reviewed SECURITY DEFINER functions with pinned search paths and exact lease/resource validation.
- Command/task/run details reach members through bounded JSON projections, not broad base-table grants.
- Run events, artifacts, and validations are append-only; outputs/details reject secret-like content and have strict size/shape limits.
- Material transitions append immutable Activity events. Success, failure, cancellation, queued cancellation, and exhausted stale leases create bounded structured reports; report PR links come from authoritative projections, and cancellation wins at the terminal safe boundary.

## Secret storage and workflow supply chain

Vercel retains Next.js/GitHub integration secrets. The worker uses protected GitHub Actions repository secrets. GitHub forbids Actions secret names beginning `GITHUB_`, so the reviewed names are:

- `SOFTWAREFACTORY_SUPABASE_URL`
- `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`
- `SOFTWAREFACTORY_CODEX_AUTH_JSON`
- `SOFTWAREFACTORY_GITHUB_APP_ID`
- `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`

The workflow maps them only for the worker step. Checkout uses `persist-credentials: false`; the workflow token has contents read; locked dependencies install before secrets are present; the exact validation image is preloaded before the secret-bearing step. Untrusted PR code must never receive these secrets.

Repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` must equal literal `true` before the job runs. Missing/false skips repository-dispatch and schedule triggers; branch-selectable manual workflow dispatch is intentionally absent. Keep the variable absent/false through migration/secret setup, publication, normal CI, and matching Vercel verification. This variable is not a credential, but enabling it activates a protected secret-bearing provider workflow and therefore requires exact owner RED approval for a bounded window; return it to absent/false afterward unless continued operation is separately approved.

## Current evidence boundary

Production migration history and schema are reconciled through `130014`, linked lint passed, Phase 1D remains execution-inert with every action OFF and the kill switch ON, and the Phase 1C workflow is published. The frozen routing/UI candidate passes its local final-candidate gates, while publication, CI/Vercel evidence, exact approval for local `130015`, and hosted verification remain pending. Six non-OpenAI worker secrets remain configured while the OpenAI secret and activation variable are absent. A bounded live worker attempt proved registration, heartbeat, claim, and provider-thread persistence but failed before any changed file, factory branch, commit, draft PR, or exact-head CI because the provider project had no remaining credits. The subsequent no-claim diagnostic identified `credit_balance_exhausted`. Provider execution therefore remains **Not Connected** until a funded replacement credential passes the diagnostic and a new current-base GREEN command completes.

## Autonomous and delivery boundary

Hosted migration `010` still locks the global kill switch ON and Autonomous Mode/auto approve/merge/deploy/rollback OFF. Manual Phase 1C is one owner-submitted run, not a closed autonomous loop. No Phase 1C component may change its own guardrails.

## Incident response

1. Stop/disable the workflow and preserve bounded redacted evidence.
2. Cancel or let leases expire; do not force a terminal success.
3. Revoke/rotate any potentially exposed OpenAI, Supabase, or GitHub credential at its provider.
4. Close an unsafe draft PR and contain its isolated branch without altering audit evidence.
5. Notify the owner and record the incident/containment.
6. Verify repository default branch, provider settings, hosted schema, tenant isolation, secret boundary, and logs.
7. Resume only after a reviewed recovery plan and fresh exact approval where protected resources are involved.
