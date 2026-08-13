# Architecture overview

SoftwareFactory is a server-first Next.js control plane. Main contains a Phase 2A advisory Anthropic/OpenAI provider layer, and the local Phase 1C candidate adds a manually requested, durable Codex-to-draft-PR path. Neither adds merge, deployment, rollback, RED execution, or Autonomous Mode.

## Components

| Component | Responsibility | Current status |
| --- | --- | --- |
| Browser UI | Collect bounded intent and show safe tenant projections | Untrusted client |
| Next.js server | Auth, active tenant, same-origin, risk, plan, repository/base-SHA binding, persistence, opaque dispatch | Implemented locally |
| Supabase Auth/Postgres | Identity, RLS, commands/tasks/runs, operations/synthetic journeys, provider routing/advisory evidence, bot registry, marketing content, neutral logical-agent roster, leases, coherent artifacts, validations, reports, activity | Published post-`027` schema present; ledger still exactly through `027`; protected history reconciliation and Phase 1C promotion pending |
| Phase 2A provider adapters | Official Anthropic/OpenAI SDKs, live health/model discovery, deterministic routing, bounded fallback, schema-validated advisory artifacts | Source on main; migration/credentials/live requests absent; execution OFF; **Not Connected** |
| GitHub App adapter | Short-lived repository-ID-scoped tokens, repository dispatch, isolated push, draft PR, checks | Phase 1B owner path connected; Phase 1C live run pending |
| GitHub Actions worker | One durable claim, heartbeat/cancel, Codex, validation, draft publication, CI observation | Workflow local; secrets/heartbeat **Not Connected** |
| Codex SDK | Supported server-side engineering thread | Adapter local; real provider call **Not Connected** |
| Vercel | Serve UI and request-time server routes | Existing production READY; never a Codex worker |
| Autonomous loop | Future independent execution policy | OFF; kill switch ON |

## Command path

1. The caller has an authenticated Supabase session and active organization.
2. `POST /api/commands` enforces same origin and owner authority, validates type/prompt/criteria/risk/idempotency, and rejects likely secrets.
3. The server resolves a live connected project to exact connection, App/installation, immutable repository ID, full name, default branch, and current 40-character base SHA.
4. The server computes the highest risk, maps the logical role, and fixes provider `openai`, model `gpt-5.3-codex`, budgets, and the draft-PR workflow.
5. `submit_command` persists the command/task/run. Phase 1C migrations `130007`-`130011` independently require organization ownership, raise risk from prompt plus acceptance criteria, enforce input/key/secret/dependency bounds, reject provider/model/role/budget/workflow mismatch, and preserve total budgets across retries.
6. RED remains awaiting approval/blocked and cannot be claimed. GREEN/YELLOW may queue.
7. After commit, the server sends repository dispatch event `softwarefactory_phase1c_command` with only an opaque command UUID. Failed dispatch is recorded as delayed; the five-minute scheduled worker can recover durable work.

Dispatch is not authorization. The worker must still claim an eligible row from Supabase with its service-role credential and lease token.

## Worker path

1. Register the worker and publish a heartbeat-derived status.
2. Claim one GREEN/YELLOW queued run and receive the exact repository snapshot plus fixed budget. The database serializes execution so one neutral logical agent cannot hold two active leases.
3. Mint a short-lived installation token scoped to one repository ID.
4. Verify the remote default branch still equals the planned base SHA. Fail stale rather than rebase silently.
5. Create or safely resume `factory/<run-id>-<slug>` under a dedicated work root.
6. Bootstrap locked dependencies in the pinned Docker image using `npm ci --ignore-scripts`.
7. Start the supported Codex SDK thread with isolated `CODEX_HOME`, workspace-write sandbox, approval `never`, workspace network disabled, and web search disabled.
8. Heartbeat the lease and honor cancellation/time/token/turn limits throughout.
9. Run deterministic `git diff --check`, lint, typecheck, tests, and build inside the pinned network-none validation container.
10. If required, allow one bounded Codex repair, then revalidate.
11. Scan every changed path/content for containment, protected resources, forbidden files, symlinks, binaries, secrets, count, and size.
12. Commit as `surgeservicesllc <surgeservicesllc@gmail.com>`, push only the factory branch, and create or recover an open draft PR. Recovery accepts only coherent exact branch/commit evidence and an optional exactly matching draft PR; partial or conflicting evidence fails closed.
13. Observe the complete check set for the exact head SHA. `SOFTWAREFACTORY_REQUIRED_CHECKS` must name the two exact CI jobs, every required conclusion must be `success`, all observed checks must be terminal/acceptable, and the identical passing fingerprint must appear twice before a final PR base/head recheck.
14. Persist bounded terminal result, timeline, validation, artifacts, changed paths, usage, and a structured success/failure/cancellation report. Cancellation wins at the terminal safe boundary.

## Execution sandbox

- The work root cannot be filesystem root, user home, current repository root, or an unsafe reused directory.
- Each run has a marker binding run ID, repository ID, base SHA, and generated branch.
- Child processes get a narrow environment. Git credentials are injected into only the required Git command and included in output redaction.
- The exact validation image is `node:22.22.0-bookworm@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c`.
- Validation containers drop capabilities, use no-new-privileges, a read-only root, limited PID/CPU/memory, and network none. The dependency bootstrap alone uses bridge networking and ignores install scripts.
- Process output and durations are bounded and redacted before persistence.

## Persistence and browser projections

Hosted schema already contains the effects of `028`/`130001`-`130005`, although their ledger rows are missing. Forward `130006` adds only execution-inert Phase 1D controls. Phase 1C then uses `130007` provider compatibility, `130008` enum additions, `130009` core execution, `130010` roster/recovery/report hardening, and `130011` canonical dependencies/cumulative retry budgets. New tables use RLS and FORCE RLS. Direct browser table privileges are revoked; member-facing reads use bounded functions, while narrowly reviewed trusted functions retain only required grants. Run events, artifacts, and validations reject update/delete.

Browser detail endpoints expose allowlisted agent/task/run/report fields, event timelines, artifact references, validation summaries, dependencies, and heartbeat state. They do not expose service credentials, raw command/model payloads, raw provider errors, or broad base-table columns.

## Publication authority

The worker may read one repository, push its own `factory/*` branch, create/recover a draft PR, and read check state. It cannot:

- write the default branch;
- create a ready-for-review/non-draft PR;
- approve or merge;
- modify workflows, branch protection, environments, secrets, or repository administration;
- deploy or rollback; or
- execute RED work.

## Current live boundary

Candidate GitHub App installation `153479019` is connected to exactly `surgeservicesllc/SoftwareFactory`, but that is Phase 1B repository evidence. Hosted ledger reconciliation, migrations `130006`-`130011`, production/provider evidence, Actions secrets/variables, published Phase 1C workflow, worker heartbeat, and a Phase 1C draft PR/required-CI result do not exist. A clean one-shot exit could provide temporary availability evidence, not a real bounded-run result. Phase 1E operations, Phase 1D execution, advisory provider execution, bot-provider readiness, and the Codex worker remain **Not Connected**.

See [`AI/ARCHITECTURE.md`](../AI/ARCHITECTURE.md), [Security model](SECURITY_MODEL.md), and [Autonomous mode](AUTONOMOUS_MODE.md).
