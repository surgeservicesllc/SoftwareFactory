# Backlog

Last triaged: 2026-08-13

Checked items have repository/provider evidence only. They do not make GitHub Connected or Phase 1B complete.

## Phase 1B implementation

- [x] Supabase Auth/onboarding, active organization, tenant-scoped APIs, RLS/FORCE RLS foundations, and immutable Activity reads.
- [x] GitHub App install/callback state/nonce/user/App verification, ephemeral user-token revocation, and short-lived repository/permission-scoped installation tokens.
- [x] Tenant-authorized repository/branch/commit/PR/check/tree/file reads and live Connections/Projects/Files/dashboard surfaces.
- [x] Signed, bounded, schema-validated, delivery-idempotent, redacted webhook ingress.
- [x] Transactional project linking and isolated branch + expected-SHA commit + open draft-PR-only file changes.
- [x] Remove the local HTTP writer and block broad protected/security-sensitive repository paths.
- [x] Add callback redirect errors, strict GitHub web URL validation, connection-loss persistence, truthful disconnected UI, and stable same-intent browser idempotency.
- [x] Add local migrations `011`-`025` for direct-write closure, terminal/audited change evidence, repository-grant reconciliation, linked-project metadata propagation, draft-PR completion recovery, provider-time installation/repository ordering, terminal deletion, exact-binding change reservation, the minimal service-role sensitive-JSON CHECK-helper grant, safe tenant/Activity list projections, stable repository UUID binding and relink locking, owner-approved protected RED draft changes with approval/token/lease integrity, generic secret-assignment detection, and bounded GitHub activity details.
- [x] Enforce same-origin command mutations and global CSP/security headers; suppress external repository Markdown image loads.
- [x] Restore live Projects sync/visibility, branch protection/SHA, commit/PR timestamps and authors, mergeability, default-branch checks, and per-PR head-SHA checks.
- [x] Keep Autonomous Mode OFF, global kill switch ON, auto approve/merge/deploy/rollback OFF, and Codex/Claude **Not Connected**.

## Phase 1B release blockers

- [x] Pass current-tree lint/typecheck, the consolidated 52-file/392-test Vitest suite through migration `025`, and the production build with 38 generated static routes.
- [x] Pass coverage: statements 70.36%, branches 71.34%, functions 62.58%, lines 71.37%.
- [x] Pass production-server Playwright 48/48 across desktop/tablet/mobile including axe checks.
- [x] Pass final source/client secret gates: zero actual credential candidates, zero privileged/static marker matches, zero unexpected sensitive files; one benign Vercel environment identifier reviewed.
- [ ] Commit/push the exact reviewed hardening tree to `origin/main`, verify CI, record exact provenance, and verify the resulting Vercel production deployment/alias/HTTP/E2E evidence.
- [ ] Obtain exact owner approval for hosted migrations `011`-`025`; dry-run the full chain, apply to `qpuofpmagrmyamahqwxw`, and verify ledger, lint, RLS/FORCE RLS, table/function/helper grants, actor/tenant/resource checks, raw Activity/webhook denial and safe list RPCs, stable repository binding/relink concurrency, protected approval/token/lease invariants, generic assignment handling, immutable/redacted bounded activity, provider-ingress CHECK evaluation, ordering/terminal behavior, recovery behavior, and health.
- [x] Restore Supabase CLI access as `surgeservicesllc@gmail.com`, link exact project `qpuofpmagrmyamahqwxw`, and obtain a clean linked database lint. Dry run `011`-`024` passed before `025` existed.
- [ ] Restore the database login-role authorization currently returning `403`, then pass a full `011`-`025` dry run before approved application.
- [ ] Verify two authenticated tenants plus anonymous denial and privileged-RPC behavior using caller sessions, not service role as the user-under-test.
- [ ] Complete production sign-up/email confirmation/sign-in/onboarding/active-organization acceptance.
- [ ] Complete the authenticated SoftwareFactory owner callback for provider installation `153286187`, persist the tenant connection, and verify identity, permissions, selected repository count, freshness, and audit evidence.
- [ ] Link the real repository/project and verify live sync time, branch protection/SHA, commits, pull requests with created/updated timestamps and mergeability, default-branch/per-PR checks, tree, and content reads.
- [ ] Create one safe isolated branch/commit/draft PR and verify stable idempotent retry, ambiguous completion recovery, stale SHA, likely-secret, unapproved/admin protected denial, exact owner protected approval and expiry/lease behavior, wrong tenant, revoked installation, insufficient permission, and rate-limit behavior. Never merge or deploy.
- [ ] Obtain exact owner approval to configure/activate the GitHub webhook secret/endpoint, then observe valid, invalid, duplicate, stale, out-of-order, installation deletion, repository deletion, and explicit restore deliveries.
- [ ] Verify explicit disconnect/loss state and history preservation.
- [ ] Configure/verify isolated Preview Supabase values before authenticated preview testing.
- [ ] Publish the owner-facing Phase 1B final report only after every acceptance item passes.

## Historical evidence retained

- Hosted Supabase migrations through `010` and prior fail-closed observation-control checks.
- Provider installation `153286187`, scoped only to `surgeservicesllc/SoftwareFactory`.
- Last independently verified pre-hardening release: `f12814bd94001e5c9fe9637e0350e14816de8d13` on Vercel deployment `dpl_9M66dxkkNiqTTRVbC2SGqzXzkwju`, public Playwright 12/12.
- Prior local baseline before migrations `014`-`019`: 25 files/208 tests, 34-route build, local Playwright 12/12. Historical only and not proof for the current `020`-`023` tree.

## Explicitly deferred

- Phase 1C durable Codex/OpenAI worker, sandboxing, leasing, budgets, and execution: **Not Connected; do not start.**
- Phase 1D execution/autonomy beyond the inert observation scaffold: OFF.
- Phase 2 Anthropic/Claude agents: **Not Connected; do not start.**
- Auto approval, merge, deployment, and rollback: OFF with no executor.

## Maintenance

- [ ] Run final verification on the repository-supported Node version.
- [x] Move Vitest configuration to native ESM (`vitest.config.mts`) to remove the prior config-loader warning.
- [ ] Expand authenticated E2E once a safe disposable live-provider fixture exists.
