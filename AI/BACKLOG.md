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

## Bot fabric (control plane)

- [x] Add provider-neutral bot registration for Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Groq, OpenRouter, self-hosted, and custom OpenAI-compatible endpoints.
- [x] Store a server-side secret reference name with an allowlist, a control-plane denylist, and a table CHECK constraint; never store, return, or log a credential value.
- [x] Add organization-authored roles with starter templates, risk ceilings, and capability labels.
- [x] Add bot-to-project assignment with one open posting per bot, so a move is a single audited transition.
- [x] Add configuration-only readiness checks that make no provider request and never claim a session.
- [x] Add local migrations `020`-`021` with RLS/FORCE RLS, select-only authenticated grants, and audited SECURITY DEFINER mutations.
- [ ] Obtain exact owner approval for hosted migrations `020`-`021` and verify grants, RLS behavior, audit evidence, and constraint enforcement against two authenticated tenants.
- [ ] Do not connect an execution worker to these records. That requires a separate owner-approved phase decision.

## Phase 1B release blockers

- [x] Pass current-tree lint/typecheck, full Vitest 45 files/364 tests, full-chain RLS behavior 5/5 through migration `019`, and a 40-route production build.
- [x] Pass current-tree coverage at 70.96% statements, 69.49% branches, 67.59% functions, and 72.11% lines with required risk/constants thresholds.
- [x] Pass current-tree Playwright 24/24 across desktop/tablet/mobile including axe checks on the dashboard and the bot fabric; fix the two contrast defects that gate surfaced.
- [x] Pass source/client secret gates: no credential/private-key marker in tracked or untracked non-fixture source; only explicit fake detector fixtures matched; rebuilt `.next/static` contains no privileged environment name, key marker, or `service_role` marker.
- [x] Publish application commit `427190d050796e3f5ff5cf6154adc2c34e2e5694` to `origin/main`; CI run `31649243266` passed 2/2; verify READY production deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`, exact SHA metadata, stable alias, HTTP boundaries/title, Playwright 12/12, nine deployed-JS assets clean, and zero recent error/HTTP-500 logs.
- [ ] Obtain exact owner approval for hosted migrations `011`-`021`; apply to `qpuofpmagrmyamahqwxw` and verify ledger, lint, RLS/FORCE RLS, table/function/helper grants, actor/tenant/resource checks, immutable/redacted activity, provider-ingress CHECK evaluation, ordering/terminal behavior, recovery behavior, and health.
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

## Maintenance

- [ ] Run final verification on the repository-supported Node version.
- [x] Move Vitest configuration to native ESM (`vitest.config.mts`) to remove the prior config-loader warning.
- [ ] Expand authenticated E2E once a safe disposable live-provider fixture exists.
