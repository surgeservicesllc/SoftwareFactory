# Current state

Last reviewed: 2026-08-13

Phase: 1C — Full site production build-out and the first AI engineering execution loop

Overall status: **Phase 1C is implemented and locally verified on this branch. Hosted migrations `011`-`016`, provider/worker credentials, and every live acceptance journey remain pending owner action.**

"Implemented" below means code, schema, and tests exist in the current tree. It does not mean a real provider workflow, a real worker run, or a hosted database change was observed.

## Implemented application boundaries

### Carried forward from Phase 1A/1B

- Next.js 16.3, React 19.2, TypeScript strict mode, App Router, Tailwind CSS 4.
- Supabase email/password auth, magic link, callback, onboarding, membership, and active-organization boundaries.
- GitHub App install/callback/token/sync/disconnect with same-origin protection, signed state, exact App/installation verification, and short-lived repository-scoped installation tokens.
- Repository reads: branches, commits, pull requests, check runs, trees, and UTF-8 files.
- The guarded manual file-change route: protected-path rejection, secret rejection, expected blob SHA, isolated `softwarefactory/*` branch, and a required open draft pull request.
- Signed, idempotent, redacted webhook ingestion with bounded database reconciliation.
- Phase 1D observation-only scaffolding with the hosted global kill switch locked ON.

### Added in Phase 1C

- **Provider abstraction.** A provider-neutral worker contract (`createRun`/`getRun`/`cancelRun`/`getResult`), a registry that lists planned providers truthfully, and an OpenAI Codex adapter on the supported server-side Responses API in background mode. Anthropic remains listed as Phase 2 with no adapter.
- **Deterministic orchestrator.** Classifies intent, derives acceptance criteria, reuses `lib/risk.ts`, decomposes only broad programmes, represents dependencies, and treats the owner's declared risk as a floor while escalating on detected RED signals. Planning requires no provider, so Bot Manager works while Codex is Not Connected.
- **Durable run engine.** A nine-step state machine advanced by short, leased, idempotent worker ticks. All state is in Postgres; an expired lease is reclaimed on the next tick. Driven by a `vercel.json` cron and authenticated by a server-only bearer secret.
- **Pre-commit diff review.** Scope, protected paths, untrusted expected SHAs, oversized content, diff-level secret scanning, and recalculated risk. Unexpected escalation stops the run.
- **Draft-PR-only delivery.** Changes land on an isolated `factory/<run-id>-<slug>` branch and open a draft pull request carrying run ID, command, summary, risk, acceptance criteria, changed files, limitations, and rollback notes.
- **Real CI as the validation authority.** SoftwareFactory does not run a managed project's test suite. Lint, typecheck, tests, and build are read from the repository's own check runs, and the bounded repair loop consumes genuine failures.
- **Every primary page is live.** Dashboard, Projects (+ detail with eight tabs), Bot Manager, Files, Agents, Backlog, Runs (+ run detail), Reports, Connections, Activity, and Settings all read tenant records. `lib/demo-data.ts` is deleted; nothing seeds demo content.
- **Global shell.** Project selector, breadcrumbs, system status, notification centre, profile menu with sign-out, and a Cmd/Ctrl-K command shortcut.
- **Commanded execution interlock.** `organization_settings.execution_enabled` defaults OFF and is owner-only. It is independent of the Phase 1D autonomy kill switch and never enables autonomous approval, merge, deployment, or rollback.
- No merge, deploy, or rollback executor exists in any phase of this tree.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was verified `ACTIVE_HEALTHY`.
- Hosted migrations `001`-`005`, `007`-`010` are applied; the hosted ledger ends at `010`.
- Local migrations **`011`-`016` are committed but not applied to hosted Supabase.** `011`-`013` close direct authenticated mutations, add actor-attributed change evidence, and reconcile repository grants. `014`-`016` add the Phase 1C execution enums, schema, and workflows. Hosted promotion requires exact owner approval and post-apply verification.
- All 16 migrations were applied in order to a real PostgreSQL instance (pglite) in tests: 26 public tables, every one with RLS **and** FORCE RLS.
- New tables `run_events`, `run_workspaces`, `run_results`, and `organization_settings` are read-only for `authenticated`; every write goes through an audited SECURITY DEFINER function.
- The durable worker boundary (`claim_agent_runs`, `heartbeat_agent_run`, `finish_agent_run`, `record_run_event`, `record_run_workspace`, `record_run_result`, `record_run_pull_request`) is revoked from `public`, `anon`, and `authenticated`. No browser session can drive execution.
- `run_events` is append-only by trigger and rejects likely secrets in both its message and metadata.
- Unapproved RED work is never claimed. Dependent work is never claimed before its dependency completes. Organization concurrency is enforced at claim time.
- The Phase 1D interlocks are intact and verified by test: Autonomous Mode stays constrained OFF and the organization kill switch stays locked ON.
- GitHub App installation `153286187` exists on `surgeservicesllc`, scoped only to `surgeservicesllc/SoftwareFactory`. It has still not completed the authenticated SoftwareFactory callback.
- Provider, worker, and deployment credentials are absent, so those capabilities report **Not Connected**.

## Live/configuration status

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Schema through `010`; `011`-`016` pending | Project healthy. All 16 migrations verified against real PostgreSQL locally. Hosted authenticated RLS allow/deny and a real application session remain unverified. |
| GitHub App object/secrets | Configured and rotated | `Surge SoftwareFactory` (App ID `4573846`); sole key fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=` promoted in Vercel. |
| GitHub provider installation | Installed; repository-scoped | Installation `153286187`, only `surgeservicesllc/SoftwareFactory` selected. Not a tenant connection. |
| GitHub App connection | **Not Connected** | The authenticated owner callback, connection record, repository sync, project link, and signed webhook delivery are all still pending. |
| OpenAI Codex worker | **Not Connected** | Adapter implemented and unit-tested against its contract. No `OPENAI_API_KEY` is configured, so no run can start. |
| Durable worker tick | **Not Connected** | Endpoint, leasing, and authorization implemented and tested. No `WORKER_TICK_SECRET`/`CRON_SECRET` is configured, so queued runs are never claimed. |
| Commanded execution | OFF | Owner-gated per organization; defaults OFF. |
| Anthropic/Claude worker | **Not Connected** | Phase 2. Listed in the registry with no adapter. |
| Vercel deployment visibility | **Not Connected** | No `VERCEL_TOKEN`. Deployment metrics report unavailable rather than zero. |
| Vercel deployment/rollback adapter | **Not Connected** | Hosting is not an in-product deploy or rollback executor. |
| Auto approve/merge/deploy/rollback | OFF | No executor exists. Verified by contract test. |
| Phase 1D autonomy | Locked | Kill switch ON, Autonomous Mode constrained OFF, GREEN ceiling. |

## Verification evidence and current-tree status

| Gate | Evidence | Result |
| --- | --- | --- |
| Lint | `npm run lint` | Pass |
| Typecheck | `npm run typecheck` | Pass |
| Unit and integration tests | `npm test` | Pass — 31 files / 300 tests |
| Migration application | All 16 migrations applied in order to PostgreSQL via pglite | Pass — 26 tables, all with RLS and FORCE RLS |
| Execution schema behavior | `tests/integration/phase1c-execution-schema.test.ts` | Pass — 17 tests covering leasing, append-only evidence, secret rejection, concurrency, cancellation, retry policy, RED refusal, dependency ordering, and Phase 1D interlocks |
| Security boundary contract | `tests/integration/phase1c-boundaries.contract.test.ts` | Pass — 13 tests covering service-role confinement, credential isolation from client code, same-origin coverage, tenant scoping, RLS grants, draft-only PRs, and absence of any merge/deploy/rollback executor |
| Production build | `npm run build` | Pass — 41 routes |
| Browser, responsive, and accessibility | `npm run test:e2e` | Pass — 15/15 across desktop, tablet, and mobile including axe checks |
| Live GitHub acceptance | production checklist | Pending; **Not Connected** |
| Live worker run | production checklist | Pending; **Not Connected** |
| Hosted migration promotion `011`-`016` | — | Pending exact owner approval |

Defects found and fixed by these gates during Phase 1C:

1. The dashboard counted a project as connected from its connection status alone, which could disagree with the Projects page. It now derives connectivity from identical evidence.
2. An unlayered `a { color: inherit }` rule outranked every layered component class, stripping the foreground colour from `.primary-action` links so they failed WCAG contrast on their lime background.
3. The orchestrator applied the owner's declared risk to the plan but not to its tasks, so a YELLOW declaration produced GREEN tasks — and task risk is what gates execution.
4. The diff secret scanner backtracked catastrophically on long single lines; a 250KB minified line took over 50 seconds, which would stall a worker tick.
5. `claim_agent_runs` counted an attempt on every claim, so a run spanning several ticks would exhaust its retry budget without failing.

## Known limitations and release blockers

- Obtain exact owner approval to apply hosted migrations `011`-`016`; then verify ledger, lint, grants, RLS, actor attribution, event immutability, and application health.
- Verify hosted authenticated RLS allow/deny, cross-tenant and anonymous denial, privileged-RPC authorization, and a real application session.
- Restore an authorized Supabase CLI account and rerun linked public-schema lint; the last clean linked lint is through `009`.
- Complete real Supabase sign-in and onboarding in production.
- Complete the authenticated owner callback for provider installation `153286187`, persist the connection, and verify repository sync, project link, reads, safe edit/draft PR, audit, error/revocation paths, and disconnect.
- Configure and verify the GitHub webhook endpoint; the provider General form is still blank/inactive.
- Configure `OPENAI_API_KEY` and `WORKER_TICK_SECRET`, enable commanded execution for the organization, and observe one complete real run end to end before describing the execution loop as live.
- Supabase Preview environment isolation remains unverified.

No documentation or UI may describe GitHub, the Codex worker, the durable tick, or any deployment capability as Connected — or Phase 1C as complete — until these blockers have evidence.
