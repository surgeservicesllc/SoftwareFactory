# Backlog

Last triaged: 2026-08-13

Checked items have repository/provider evidence only. The owner repository connection is live, but checked items do not make the webhook Connected or Phase 1B complete.

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
- [x] Register owner-only candidate App `4582606` (`surge-softwarefactory-next`) with the exact callback, a retained active exact webhook URL, least-privilege Phase 1B permissions/events, and distinct Sensitive Production/Preview candidate variable names. This is provider/configuration evidence, not an installation or connection.
- [x] Implement locally the isolated dual-App configuration/state/token/webhook boundaries and owner-only atomic reversible project handoff migration `027`, including a processed signed target-installation delivery gate and immutable handoff evidence.

## Phase 1B release blockers

- [x] Pass current pre-release lint/typecheck, 56 files/436 tests, and the 38-route production build. The dual-App/handoff tree is not yet committed or deployed.
- [x] Pass current-tree coverage: statements 74.76%, branches 75.59%, functions 68.02%, lines 75.82%.
- [ ] Rerun coverage for the candidate cutover tree before publication.
- [x] Retain exact-production Playwright 48/48 across desktop/tablet/mobile including axe and focused signed-out browser-error race 30/30 from the preceding verified release; pass the current exact-commit CI browser/accessibility job.
- [x] Retain the published application-release source/client artifact scan: zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present.
- [ ] Rerun source, tracked-file, and rebuilt-client secret scans for the candidate cutover tree before publication.
- [x] Publish application tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0` as commit `0bd048565a9e002848c5553ccbe43ab0e217780e` with author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31704289754` passed both jobs, and matching Vercel deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY at its immutable URL and the stable alias.
- [x] Apply hosted migrations `011`-`026` to `qpuofpmagrmyamahqwxw`; verify pre-`027` history matched, dry run/lint were clean, and prior RLS/catalog/browser-grant checks remain recorded.
- [x] Verify the exact post-`026` ACL matrix has zero mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19.
- [ ] Verify two authenticated tenants plus anonymous denial and privileged-RPC behavior using caller sessions, not service role as the user-under-test. Only one actual user/email is authorized; a live second tenant was intentionally not created, while local behavioral tests cover the boundary.
- [x] Confirm and authenticate `surgeservicesllc@gmail.com`; complete SoftwareFactory organization/workspace owner onboarding.
- [x] Publish the bounded documented `GET /user/installations` exact-ID callback fix and verify tenant persistence for installation `153445938`.
- [x] Link real connection `d17c63a9-d995-481e-98ce-b737efb32ce5` and project `b1f23696-437e-4d89-b55f-d7a949980e8f`; verify live repository sync, branches, commits, pull requests, checks, tree, and `README.md` reads.
- [x] Create ordinary draft PR `#6` and exact owner-approved protected RED draft PR `#7`; verify both remain draft/unmerged, likely-secret rejection, and immutable approval/provider/audit evidence. Earlier identity-mismatched PRs `#4`/`#5` were closed unmerged and their branches deleted.
- [ ] Complete live stale-SHA, idempotent retry, ambiguous completion recovery, unapproved/admin/expired protected denial, wrong-tenant, revoked-installation, insufficient-permission, rate-limit, and lifecycle failure acceptance. Local tests do not replace the missing provider cases.
- [x] Publish the strict server-only commit-identity boundary, configure `GITHUB_COMMIT_IDENTITY_NAME`/`GITHUB_COMMIT_IDENTITY_EMAIL` in Vercel Production and Preview, and verify both author and committer are `surgeservicesllc <surgeservicesllc@gmail.com>` on draft commits `e789303` and `6a808de`.
- [ ] Review, commit, push, and deploy the dual-App/handoff tree, then apply and verify local migration `027` on hosted project `qpuofpmagrmyamahqwxw`. Until then, production remains exact application release `0bd0485` and hosted Supabase remains through `026`.
- [ ] Install candidate App `4582606` for exactly `surgeservicesllc/SoftwareFactory`; verify callback, synchronized App/repository identity, repository reads, and a valid signed **processed** webhook delivery for that exact installation. The candidate endpoint is retained and active at GitHub, but the candidate is not installed and the webhook capability remains **Not Connected**.
- [ ] Execute the owner-only exact-confirmation handoff from primary installation `153445938` to the verified candidate installation; confirm the same project and history remain intact, reads and draft-only writes route through the candidate App, and immutable handoff evidence is visible. Observe the rollback window and verify evidence-bound reverse handoff before any primary access is retired.
- [ ] Keep OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724) as the defect record for App `4573846`, whose single webhook still reloads blank/inactive. Do not make candidate success retroactively label the primary webhook Connected.
- [ ] Verify explicit disconnect/loss state and history preservation.
- [ ] Configure/verify isolated Preview Supabase values before authenticated preview testing.
- [ ] Publish the owner-facing Phase 1B final report only after every acceptance item passes.

## Release evidence retained

- Verified application release: `0bd048565a9e002848c5553ccbe43ab0e217780e`, tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0`, CI `31704289754`, Vercel deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX`. Both CI jobs are green; post-rotation production Playwright passes 48/48, nine JavaScript assets have zero forbidden markers, and recent logs have zero errors. Later documentation-only successors do not supersede this runtime evidence unless application code changes.
- Hosted Supabase is current through `026`; pre-`027` history matched, dry run/lint were clean, and the exact four-table `service_role` ACL matrix has zero mismatches.
- Local migration `027` and the dual-App/handoff routes are pre-release only; they pass the current full local check but are not in hosted Supabase or production.
- The currently selected local Supabase CLI profile is unauthorized or associated with the wrong account for a fresh recheck. It was not used for any mutation; the prior hosted-through-`026` evidence above remains recorded.
- Connected provider installation `153445938`, scoped exactly to `surgeservicesllc/SoftwareFactory`; live connection/project/read/draft-write/audit path passes for the owner.
- Current READY production: `dpl_AEirYPnCrKemJjiFX7bKGc7626jX`, immutable `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app`, stable alias, source exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e`.
- Temporary downloaded App PEM and ignored provider-verification helper scripts were deleted after use; no credential/helper artifact remains in the repository checkout.
- Last independently verified pre-hardening release: `f12814bd94001e5c9fe9637e0350e14816de8d13` on Vercel deployment `dpl_9M66dxkkNiqTTRVbC2SGqzXzkwju`, public Playwright 12/12.
- Prior local baseline before migrations `014`-`019`: 25 files/208 tests, 34-route build, local Playwright 12/12. Historical only and not proof for the current `020`-`023` tree.

## Explicitly deferred

- Phase 1C durable Codex/OpenAI worker, sandboxing, leasing, budgets, and execution: **Not Connected; do not start.**
- Phase 1D execution/autonomy beyond the inert observation scaffold: OFF.
- Phase 2 Anthropic/Claude agents: **Not Connected; do not start.**
- Auto approval, merge, deployment, and rollback: OFF with no executor.

## Maintenance

- [ ] Run final verification on the repository-supported Node version.
- [ ] Before any new hosted database command, reauthenticate the Supabase CLI as `surgeservicesllc@gmail.com` and reconfirm project `qpuofpmagrmyamahqwxw`; do not use the currently selected wrong/unauthorized profile.
- [x] Move Vitest configuration to native ESM (`vitest.config.mts`) to remove the prior config-loader warning.
- [ ] Expand authenticated E2E once a safe disposable live-provider fixture exists.

## Owner review - protected delivery controls

These are recorded for deliberate owner review and are not evidence that Phase 1B provider acceptance passed:

- [ ] Decide whether to enable protection/required checks and require verified signatures on `main`; the branch is currently unprotected and the published release commit is unsigned. Any settings change is a protected owner-approved action.
- [ ] Review unexpected `theagoras.com` Vercel aliases, verify ownership and routing intent, and remove or retain them only through an explicitly approved protected routing change.
