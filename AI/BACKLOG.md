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
- [x] Bind interactive GitHub routes to the exact active organization and derive connected project/file/dashboard state only from a live connection, active unsuspended installation, and selected healthy repository.
- [x] Add a live tenant-scoped Activity API/UI that uses caller-session RLS, excludes event metadata from browser responses, and keeps seeded examples labeled **Demo Data**.
- [x] Remove the legacy HTTP local-repository writer, its UI component, and its environment switch.
- [x] Add expected-SHA/idempotent protected file editing that creates only a controlled branch, commit, and draft PR; fail closed for repository memory/policies, Supabase, every application API route, GitHub/server/Supabase libraries, Auth/session boundaries, deployment/environment/infrastructure files, and other sensitive subject paths.
- [x] Add local forward migrations `011`-`013` for audited-only connection/member mutation, `github_pat_` detection, actor-attributed terminal GitHub change evidence, and bounded webhook repository-grant reconciliation.
- [x] Add Phase 1B unit/integration/contract coverage for the review hardening. The final coverage run passes 25 files/208 tests; the focused `013` chain passes 3 files/44 tests.
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
- [ ] Obtain exact owner approval and apply local migrations `011`, `012`, and `013` to hosted project `qpuofpmagrmyamahqwxw`; then verify ledger, lint, grants, RLS, immutable actor-attributed audit events, webhook repository-grant reconciliation, and application health.
- [x] Rerun current local gates: the lint/typecheck/test phases of `npm run check` pass with 24 files/205 tests; its build phase hit only a stale OneDrive `.next` cache `EPERM`, then standalone `npm run build` passed 34 routes after recoverable cache relocation. Final coverage passes 25 files/208 tests; focused `013` tests pass 44; local Playwright passes 12/12.
- [x] Rerun final secret and built-client scans on the current hardening tree; only the synthetic `github_pat_` fixture matched, and `.next/static` contains no server-secret markers.
- [x] Push implementation commit `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278` to `origin/main`; preserve its authorship with owner-authored empty deployment marker `7bd9d30e67bf018aba32f28d235d4a2f1232d65c`, now current `main`.
- [x] Verify Vercel deployment `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY` READY/current at `softwarefactory-fbho4i38o-surgeservices-projects.vercel.app` and the stable alias; it builds the exact `e0ca6e7` application tree through marker `7bd9d30`.
- [x] Rerun production Playwright 12/12 and HTTP probes: `/`, `/activity`, and `/connections` return 200; unauthenticated `/api/activity` returns 401; removed `/api/files` returns 404.
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

## Interface simplification

- [x] Replace ~500 literal hex values and nine competing grey text tones with one semantic design-token set, and raise the minimum interface type size to 12px (133 declarations previously sat between 7px and 11px). See ADR-018.
- [x] Rewrite user-facing copy in plain language, keeping exact policy terms as secondary labels, and reduce per-page **Demo Data** repetition to a single notice. See ADR-019.
- [x] Group navigation so live surfaces are visibly separate from a "Demo only" section, without changing any destination label.
- [x] Lead the dashboard with the real product path — connect GitHub, add a project, open your files — derived from the existing `/api/projects` read with no extra request.
- [x] Fix two real WCAG AA defects surfaced by the new coverage: anchor primary buttons rendering at 1.21:1 (an unlayered `a { color: inherit }` outranked the layered component class) and the backlog table forming a keyboard-unreachable horizontal scroll region.
- [x] Delete `components/project-form.tsx`, dead since the projects console superseded it.
- [x] Remove the seeded event stream that sat directly beneath the live stream on Activity in identical styling; the labeled example remains on the dashboard.
- [x] Add `tests/e2e/pages.spec.ts`: heading, horizontal-overflow, and axe assertions for 12 routes at three viewports. Local Playwright is now 48/48.
- [ ] Recapture production evidence for the interface change once it is deployed; the recorded deployment/E2E/probe results describe tree `e0ca6e7`, which predates it. The PR preview deployment is READY but sits behind Vercel deployment protection (every route answers `302` to `vercel.com/sso-api`), so `PLAYWRIGHT_BASE_URL` runs against it need an owner-supplied protection-bypass token. Do not work around that protection.

## Maintenance

- [x] Run local gates on Node 22+; the Supabase future-support warning no longer appears. Final release verification against hosted Supabase still pending.
- [ ] Resolve the Vitest/Vite future native config-loader warning before it becomes breaking.
- [ ] Expand authenticated E2E coverage once a safe disposable provider acceptance fixture exists.
