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
- [x] Rotate/promote the Vercel App private key to the sole remaining GitHub key (public fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`) without exposing key material.
- [x] Verify provider installation `153286187` on `surgeservicesllc`, restricted to only `surgeservicesllc/SoftwareFactory`.
- [x] Apply hosted Supabase migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` to `qpuofpmagrmyamahqwxw`; the hosted ledger includes `010`.

## Phase 1B release blockers

- [x] Add and locally verify migration `008_fix_github_sync_ambiguity`; PGlite reproduced the `004` ambiguity and passed the repaired create/resync/audit/grant paths.
- [x] Apply migration `008` to the hosted project; linked public-schema lint reports no schema errors.
- [x] Add and apply migration `009_harden_github_project_and_sync`; serialize external-installation sync, re-resolve the authoritative binding, and persist only the synchronized repository default branch. Verify exact local/remote history through `009` and clean hosted lint (`[]`).
- [x] Remove SQL wildcard semantics from normalized repository full-name matching.
- [x] Verify hosted RLS/FORCE RLS catalog inventory: 22/22 RLS, 22/22 FORCE RLS, 43 policies, and 22 row-secret guards. Linked migration history separately confirms eight expected migrations through `009`.
- [ ] Verify hosted two-tenant allow/deny paths, anonymous denial, privileged RPC authorization, and immutable audit events with real authenticated sessions.
- [x] Rerun final lint, typecheck, full Vitest (157 tests on the latest tree), build (34 routes), and Playwright at desktop/tablet/mobile with accessibility/browser-error/overflow gates (12/12) after the Phase 1B hardening and Phase 1D observation scaffold.
- [x] Rerun final secret and built-client privileged-variable scans on the exact hardened tree; no credential patterns or built-client privileged server names were found.
- [x] Verify Vercel deployment `dpl_33dEW1EM6x8ofqqHYtm5CaKUznSh` READY at the stable production alias and pass stable-production Playwright 12/12.
- [ ] Record/verify the READY deployment's exact source commit and ensure the final repository tree is pushed to `main`.
- [ ] Verify production Supabase sign-up/confirmation/sign-in/onboarding/session paths.
- [ ] Configure and verify the GitHub App webhook endpoint: the provider General page is blank/inactive and App-authenticated hook configuration returns `404`/no hook object; then observe a correctly signed production delivery.
- [ ] Complete the authenticated SoftwareFactory owner callback for existing provider installation `153286187`; persist the tenant connection and verify identity, permissions, repository count, freshness, and audit evidence.
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

- [x] Implement the local observation-only autonomy prerequisite evaluator and locked control surface: Autonomous Mode OFF, GREEN only, global kill switch ON, execution false, and no automatic action adapters.
- [x] Apply hosted migration `010` transactionally after `unsafe_project_rows=0`; verify kill-switch default true, both constraints validated, zero switch-off organizations, zero unsafe projects, authenticated RPC execute, and anonymous execute denied. Applying it does not enable execution.
- [ ] Restore authorized Supabase CLI access and rerun linked public-schema lint after `010`; the last successful lint was clean through `009`, while the post-`010` attempt returned account `403`.
- [ ] Run an evidence-backed non-production observation pilot with execution remaining impossible.
- [ ] Separate, owner-approved non-production pilots before any auto approve/merge/deploy/rollback.
- [ ] Supported Anthropic API/logical Claude agents in Phase 2; never browser-automate multiple consumer accounts.

Claude, auto merge, deployment automation, and rollback automation are **Not Connected**/OFF.

## Maintenance

- [ ] Run final release verification on Node 22+ (local Node 20 currently emits the Supabase future-support warning).
- [ ] Resolve the Vitest/Vite future native config-loader warning before it becomes breaking.
- [ ] Expand authenticated E2E coverage once a safe disposable provider acceptance fixture exists.
