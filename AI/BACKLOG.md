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
- [x] Add and host migrations `011`-`025` for direct-write closure, terminal/audited change evidence, repository-grant reconciliation, linked-project metadata propagation, draft-PR completion recovery, provider-time installation/repository ordering, terminal deletion, exact-binding change reservation, the minimal service-role sensitive-JSON CHECK-helper grant, safe tenant/Activity list projections, stable repository UUID binding and relink locking, owner-approved protected RED draft changes with approval/token/lease integrity, generic secret-assignment detection, and bounded GitHub activity details.
- [x] Enforce same-origin command mutations and global CSP/security headers; suppress external repository Markdown image loads.
- [x] Restore live Projects sync/visibility, branch protection/SHA, commit/PR timestamps and authors, mergeability, default-branch checks, and per-PR head-SHA checks.
- [x] Keep Autonomous Mode OFF, global kill switch ON, auto approve/merge/deploy/rollback OFF, and Codex/Claude **Not Connected**.

## Phase 1B release blockers

- [x] Pass current local lint/typecheck, 54 files/398 tests, and the 38-route production build.
- [x] Pass coverage: statements 70.36%, branches 71.34%, functions 62.58%, lines 71.37%.
- [x] Pass local and exact production Playwright 48/48 across desktop/tablet/mobile including axe; pass the production focused signed-out browser-error race 30/30.
- [x] Pass the final source/client artifact scan: zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 local artifacts, zero tracked key/container files, and only `.env.example` present.
- [x] Publish application tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4` as commit `edaaf625c497380611b80092526926b1457e15a0` with author/committer `surgeservicesllc@gmail.com`; CI run `31694775758` passed both jobs, and matching READY Vercel deployment `dpl_FwjzBywZTadQPTRZtB4Esd9QBKTQ` passed production focused race 30/30, Playwright 48/48, HTTP/security/client/log checks, and the ten-asset privileged-marker scan at the stable alias.
- [x] Apply hosted migrations `011`-`026` to `qpuofpmagrmyamahqwxw`; verify local and remote history match, dry run/lint are clean, and prior RLS/catalog/browser-grant checks remain recorded.
- [x] Verify the exact post-`026` ACL matrix has zero mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19.
- [ ] Verify two authenticated tenants plus anonymous denial and privileged-RPC behavior using caller sessions, not service role as the user-under-test.
- [x] Confirm and authenticate `surgeservicesllc@gmail.com`; complete SoftwareFactory organization/workspace owner onboarding.
- [ ] Publish the local callback patch that replaces nonexistent `GET /user/installations/{id}` with bounded documented `GET /user/installations` plus exact-ID lookup, then retry installation `153442281` and verify tenant persistence. Current production does not include the fix.
- [ ] Link the real repository/project and verify live sync time, branch protection/SHA, commits, pull requests with created/updated timestamps and mergeability, default-branch/per-PR checks, tree, and content reads.
- [ ] Create one safe isolated branch/commit/draft PR and verify stable idempotent retry, ambiguous completion recovery, stale SHA, likely-secret, unapproved/admin protected denial, exact owner protected approval and expiry/lease behavior, wrong tenant, revoked installation, insufficient permission, and rate-limit behavior. Never merge or deploy.
- [ ] Make GitHub retain and activate the exact webhook endpoint, then observe valid, invalid, duplicate, stale, out-of-order, installation deletion, repository deletion, and explicit restore deliveries. A GitHub App JWT validates App `4573846`, but `/app/hook/config` returns 404 and the UI does not retain activation; the webhook remains **Not Connected**.
- [ ] Verify explicit disconnect/loss state and history preservation.
- [ ] Configure/verify isolated Preview Supabase values before authenticated preview testing.
- [ ] Publish the owner-facing Phase 1B final report only after every acceptance item passes.

## Release evidence retained

- Verified application release: `edaaf625c497380611b80092526926b1457e15a0`, tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4`, CI `31694775758`, Vercel deployment `dpl_FwjzBywZTadQPTRZtB4Esd9QBKTQ`, production focused race 30/30 and Playwright 48/48. Later documentation-only successors do not supersede this runtime evidence unless application code changes.
- Hosted Supabase is current through `026`; local/remote history matches, dry run/lint are clean, and the exact four-table `service_role` ACL matrix has zero mismatches.
- Latest provider installation `153442281`, App-JWT verified and scoped only to `surgeservicesllc/SoftwareFactory`.
- Current READY production: `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77`, immutable `https://softwarefactory-nd3orq8r6-surgeservices-projects.vercel.app`, stable alias, source `main` `3434387`; callback fix unpublished.
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

## Owner review - protected delivery controls

These are recorded for deliberate owner review and are not evidence that Phase 1B provider acceptance passed:

- [ ] Decide whether to enable protection/required checks and require verified signatures on `main`; the branch is currently unprotected and the published release commit is unsigned. Any settings change is a protected owner-approved action.
- [ ] Review unexpected `theagoras.com` Vercel aliases, verify ownership and routing intent, and remove or retain them only through an explicitly approved protected routing change.
