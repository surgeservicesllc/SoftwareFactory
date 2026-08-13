# Backlog

Last triaged: 2026-08-12

Checked items have repository/provider evidence only. They do not make GitHub Connected or Phase 1B complete.

## Phase 1B implementation

- [x] Supabase Auth/onboarding, active organization, tenant-scoped APIs, RLS/FORCE RLS foundations, and immutable Activity reads.
- [x] GitHub App install/callback state/nonce/user/App verification, ephemeral user-token revocation, and short-lived repository/permission-scoped installation tokens.
- [x] Tenant-authorized repository/branch/commit/PR/check/tree/file reads and live Connections/Projects/Files/dashboard surfaces.
- [x] Signed, bounded, schema-validated, delivery-idempotent, redacted webhook ingress.
- [x] Transactional project linking and isolated branch + expected-SHA commit + open draft-PR-only file changes.
- [x] Remove the local HTTP writer and block broad protected/security-sensitive repository paths.
- [x] Add callback redirect errors, strict GitHub web URL validation, connection-loss persistence, truthful disconnected UI, and stable same-intent browser idempotency.
- [x] Add local migrations `011`-`019` for direct-write closure, terminal/audited change evidence, repository-grant reconciliation, linked-project metadata propagation, draft-PR completion recovery, provider-time installation/repository ordering, terminal deletion, exact-binding change reservation, and the minimal service-role sensitive-JSON CHECK-helper grant.
- [x] Keep Autonomous Mode OFF, global kill switch ON, auto approve/merge/deploy/rollback OFF, and Codex/Claude **Not Connected**.

## Phase 1B release blockers

- [x] Pass current-tree lint/typecheck, full Vitest 38 files/263 tests (unit 23/145, integration 15/118), full-chain RLS behavior 5/5 through migration `019`, and a 34-route production build.
- [x] Pass current-tree coverage at 66.08% statements, 65.13% branches, 58.62% functions, and 67.16% lines with required risk/constants thresholds.
- [x] Pass current-tree Playwright 12/12 across desktop/tablet/mobile including axe checks after relocating an ignored stale OneDrive coverage cache.
- [x] Pass source/client secret gates: no credential/private-key marker in tracked or untracked non-fixture source; only explicit fake detector fixtures matched; rebuilt `.next/static` contains no privileged environment name, key marker, or `service_role` marker.
- [x] Publish application commit `427190d050796e3f5ff5cf6154adc2c34e2e5694` to `origin/main`; CI run `31649243266` passed 2/2; verify READY production deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`, exact SHA metadata, stable alias, HTTP boundaries/title, Playwright 12/12, nine deployed-JS assets clean, and zero recent error/HTTP-500 logs.
- [ ] Obtain exact owner approval for hosted migrations `011`-`019`; apply to `qpuofpmagrmyamahqwxw` and verify ledger, lint, RLS/FORCE RLS, table/function/helper grants, actor/tenant/resource checks, immutable/redacted activity, provider-ingress CHECK evaluation, ordering/terminal behavior, recovery behavior, and health.
- [ ] Restore authorized Supabase CLI access and rerun linked public-schema lint after `010`; the last successful hosted lint is through `009`.
- [ ] Verify two authenticated tenants plus anonymous denial and privileged-RPC behavior using caller sessions, not service role as the user-under-test.
- [ ] Complete production sign-up/email confirmation/sign-in/onboarding/active-organization acceptance.
- [ ] Complete the authenticated SoftwareFactory owner callback for provider installation `153286187`, persist the tenant connection, and verify identity, permissions, selected repository count, freshness, and audit evidence.
- [ ] Link the real repository/project and verify live branches, commits, pull requests, checks, tree, and content reads.
- [ ] Create one safe isolated branch/commit/draft PR and verify stable idempotent retry, ambiguous completion recovery, stale SHA, likely-secret, protected path, wrong tenant, revoked installation, insufficient permission, and rate-limit behavior. Never merge or deploy.
- [ ] Obtain exact owner approval to configure/activate the GitHub webhook secret/endpoint, then observe valid, invalid, duplicate, stale, out-of-order, installation deletion, repository deletion, and explicit restore deliveries.
- [ ] Verify explicit disconnect/loss state and history preservation.
- [ ] Configure/verify isolated Preview Supabase values before authenticated preview testing.
- [ ] Publish the owner-facing Phase 1B final report only after every acceptance item passes.

## Historical evidence retained

- Hosted Supabase migrations through `010` and prior fail-closed observation-control checks.
- Provider installation `153286187`, scoped only to `surgeservicesllc/SoftwareFactory`.
- Verified hardening application release: `427190d050796e3f5ff5cf6154adc2c34e2e5694` on READY Vercel deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`, provider-resolved exact SHA and production Playwright 12/12.
- Prior local baseline before migrations `014`-`019`: 25 files/208 tests, 34-route build, local Playwright 12/12. Historical only.

## Explicitly deferred

- Phase 1C durable Codex/OpenAI worker, sandboxing, leasing, budgets, and execution: **Not Connected; do not start.**
- Phase 1D execution/autonomy beyond the inert observation scaffold: OFF.
- Phase 2 Anthropic/Claude agents: **Not Connected; do not start.**
- Auto approval, merge, deployment, and rollback: OFF with no executor.

## Interface simplification

- [x] Replace ~500 literal hex values and nine competing grey text tones with one semantic design-token set, and raise the minimum interface type size to 12px (133 declarations previously sat between 7px and 11px). See ADR-021.
- [x] Rewrite user-facing copy in plain language, keeping exact policy terms as secondary labels, and reduce per-page **Demo Data** repetition to a single notice. See ADR-022.
- [x] Group navigation by task. The original split marked four pages "Demo only"; that heading was removed once ADR-023 made them read live records, since it would then be false.
- [x] Lead the dashboard with the real product path — connect GitHub, add a project, open your files — derived from the existing `/api/projects` read with no extra request.
- [x] Fix two real WCAG AA defects surfaced by the new coverage: anchor primary buttons rendering at 1.21:1 (an unlayered `a { color: inherit }` outranked the layered component class) and the backlog table forming a keyboard-unreachable horizontal scroll region.
- [x] Delete `components/project-form.tsx`, dead since the projects console superseded it.
- [x] Remove the seeded event stream that sat directly beneath the live stream on Activity in identical styling; the labeled example remains on the dashboard.
- [x] Add `tests/e2e/pages.spec.ts`: heading, horizontal-overflow, and axe assertions for 12 routes at three viewports. Local Playwright is now 48/48 and the merged suite is 40 files/289 tests.
- [ ] Recapture production evidence for the interface change once it is deployed; the recorded deployment/E2E/probe results describe release `427190d` / deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`, which predates it. The PR preview deployment is READY but sits behind Vercel deployment protection (every route answers `302` to `vercel.com/sso-api`), so `PLAYWRIGHT_BASE_URL` runs against it need an owner-supplied protection-bypass token. Do not work around that protection.

## Live Supabase wiring

- [x] Add `GET /api/agents`, `/api/tasks`, `/api/runs`, `/api/reports`, and `/api/commands` over the existing tables through one server-only tenant boundary (`lib/server/tenant-list.ts`): caller session, exact active organization, explicit column lists, 100-row bound, no-store. See ADR-023.
- [x] Convert Agents, Backlog, Runs, Reports, and the Bot Manager request list from seeded arrays to live reads, each with loading, signed-out, setup, empty, and error states.
- [x] Replace the dashboard's seeded activity preview with live recent activity, and delete `lib/demo-data.ts`.
- [x] Skip the request entirely when the browser bundle has no Supabase configuration, so an unconfigured environment shows "sign in required" instead of a page of failed calls.
- [x] Remove the "Demo only" navigation group, which became false once those pages read live records.
- [x] Add 26 tests covering the shared boundary's tenant scoping and withheld columns, plus the console loading/signed-out/setup/empty/error/live states.
- [ ] Supply browser and server Supabase values for local and preview environments (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`). These are owner-held secrets and must never enter source control; production already holds them in Vercel.
- [ ] Exercise the five new routes against hosted `qpuofpmagrmyamahqwxw` with a real authenticated session, and confirm cross-tenant denial on each.

## Maintenance

- [ ] Run final verification on the repository-supported Node version.
- [x] Move Vitest configuration to native ESM (`vitest.config.mts`) to remove the prior config-loader warning.
- [ ] Expand authenticated E2E once a safe disposable live-provider fixture exists.
- [x] Run local gates on Node 22+; the Supabase future-support warning no longer appears. Final release verification against hosted Supabase still pending.
- [ ] Resolve the Vitest/Vite future native config-loader warning before it becomes breaking.
- [ ] Expand authenticated E2E coverage once a safe disposable provider acceptance fixture exists.
