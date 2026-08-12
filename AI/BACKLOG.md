# Backlog

Last triaged: 2026-08-12

Checked items have repository or provider evidence. “Implemented” does not mean the real GitHub workflow passed.

## Phase 1B implementation

- [x] Add Supabase Auth sign-up/sign-in/magic-link/sign-out/callback flows.
- [x] Add organization onboarding, membership resolution, active-organization selection, and tenant-scoped request helpers.
- [x] Add GitHub App configuration validation, App JWTs, short-lived installation token exchange, and server-only secret handling.
- [x] Add signed time-bound installation state, user authorization verification, callback handling, and ephemeral user-token revocation.
- [x] Add connection/install/repository persistence, synchronization, loss handling, explicit disconnect, and history preservation.
- [x] Add tenant-authorized branch, commit, pull request, check, tree, and file APIs.
- [x] Add signed, bounded, idempotent, redacted webhook ingestion and reconciliation for Phase 1B events.
- [x] Add authenticated transactional project linking from an active selected repository with safe autonomy defaults.
- [x] Add live Connections, Projects, Files, and dashboard data surfaces with truthful disconnected/demo states.
- [x] Add expected-SHA/idempotent protected file editing that creates only a controlled branch, commit, and draft PR; fail closed for repository memory/policies, Supabase, every application API route, GitHub/server/Supabase libraries, Auth/session boundaries, deployment/environment/infrastructure files, and other sensitive subject paths.
- [x] Add Phase 1B unit/integration/contract coverage; the hardened tree currently passes 58 unit tests and 88 integration tests.
- [x] Create/configure GitHub App `Surge SoftwareFactory` and add protected GitHub variables to the exact Vercel project.
- [x] Apply hosted Supabase migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, and `009` to `qpuofpmagrmyamahqwxw`; verify local/remote history matches.

## Phase 1B release blockers

- [x] Add and locally verify migration `008_fix_github_sync_ambiguity`; PGlite reproduced the `004` ambiguity and passed the repaired create/resync/audit/grant paths.
- [x] Apply migration `008` to the hosted project; linked public-schema lint reports no schema errors.
- [x] Add and apply migration `009_harden_github_project_and_sync`; serialize external-installation sync, re-resolve the authoritative binding, and persist only the synchronized repository default branch. Verify exact local/remote history through `009` and clean hosted lint (`[]`).
- [x] Remove SQL wildcard semantics from normalized repository full-name matching.
- [x] Verify hosted RLS/FORCE RLS catalog inventory: 22/22 RLS, 22/22 FORCE RLS, 43 policies, and 22 row-secret guards. Linked migration history separately confirms eight expected migrations through `009`.
- [ ] Verify hosted two-tenant allow/deny paths, anonymous denial, privileged RPC authorization, and immutable audit events with real authenticated sessions.
- [x] Rerun final lint, typecheck, full Vitest (16 files/146 tests), build (34 routes), and Playwright at desktop/tablet/mobile with accessibility/browser-error/overflow gates (12/12) after `009` and the repository-write hardening.
- [x] Rerun final secret and built-client privileged-variable scans on the exact hardened tree; no credential patterns or built-client privileged server names were found.
- [ ] Commit/push the exact validated tree to `main` and deploy that commit to `surgeservices-projects/softwarefactory`; record exact commit/deployment ID/state.
- [ ] Verify production Supabase sign-up/confirmation/sign-in/onboarding/session paths.
- [ ] Configure and verify the GitHub App webhook endpoint: the provider General page still shows it blank/inactive after attempted saves; then observe a correctly signed production delivery.
- [ ] Install the App on the intended account/repository through SoftwareFactory; verify callback, identity, permissions, repository count, freshness, and audit evidence.
- [ ] Link the real `SoftwareFactory` repository as a project and verify live branch/commit/PR/check views.
- [ ] Read/edit a safe real file, verify isolated branch + commit + draft PR, stale-SHA conflict, protected-path rejection, and no merge/deploy.
- [ ] Verify revocation/permission/rate-limit/provider-error states and explicit disconnect/history preservation.
- [ ] Configure/verify isolated Preview Supabase values before authenticated preview testing.
- [ ] Publish the owner-facing Phase 1B final report only after all acceptance items pass.

## Phase 1C — explicitly deferred

- [ ] Design a durable Codex/OpenAI worker with leases, heartbeats, cancellation, idempotency, budgets, timeouts, sandboxing, redaction, and global kill switch.
- [ ] Pilot bounded GREEN work in a disposable/non-production repository and keep human review.
- [ ] Add approval inbox and visible policy-decision/evidence traces before expanding execution.

Codex/OpenAI is **Not Connected**. Do not begin Phase 1C without explicit instruction after Phase 1B exits.

## Phase 1D/2 — explicitly deferred

- [ ] Observation-only autonomy prerequisite evaluator.
- [ ] Separate, owner-approved non-production pilots before any auto approve/merge/deploy/rollback.
- [ ] Supported Anthropic API/logical Claude agents in Phase 2; never browser-automate multiple consumer accounts.

Claude, auto merge, deployment automation, and rollback automation are **Not Connected**/OFF.

## Maintenance

- [ ] Run final release verification on Node 22+ (local Node 20 currently emits the Supabase future-support warning).
- [ ] Resolve the Vitest/Vite future native config-loader warning before it becomes breaking.
- [ ] Expand authenticated E2E coverage once a safe disposable provider acceptance fixture exists.
