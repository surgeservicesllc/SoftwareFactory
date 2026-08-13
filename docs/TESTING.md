# Testing

Phase 1B needs local code evidence, hosted database evidence, and real-provider acceptance evidence. None substitutes for the others.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:e2e
npm run build
```

## Last verified baseline and current-tree status (2026-08-13)

| Gate | Result |
| --- | --- |
| Current release check | Pass - lint, typecheck, 53 files/394 Vitest tests, production build compiled 38 routes with `/` dynamic |
| Current integration suite | Pass - 21 files/163 tests |
| Current migration chain | Pass in the complete suite through local migration `025`; hosted behavior remains pending |
| Current-tree coverage | Pass - 53 files/394 tests; statements 70.36% (603/857), branches 71.34% (488/684), functions 62.58% (97/155), lines 71.37% (566/793) |
| Local and exact production E2E/responsive/accessibility | Pass - Playwright 48/48 across desktop/tablet/mobile, including axe checks |
| Signed-out dashboard race | Pass - focused browser-error test repeated 30/30 against production |
| Current-tree secret/client scan | Pass - zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present |
| Prior local baseline before migrations `014`-`019` | 25 files/208 tests, 34-route build, and 12/12 local E2E passed; historical evidence only |
| Hosted Supabase migration application | Pass through `010`; transactional preflight `unsafe_project_rows=0` and hosted safety checks passed |
| Local migrations `011`-`025` | Not hosted; exact owner approval and post-apply ledger/lint/grant/RLS/RPC/raw-Activity/webhook-denial/list-projection/repository-binding/relink/approval-token-lease/secret-assignment/activity-detail/ordering/recovery/CHECK-helper checks pending |
| Hosted Supabase CLI/link | Authorized as `surgeservicesllc@gmail.com`; linked to exact project `qpuofpmagrmyamahqwxw`; hosted ledger still through `010` |
| Migration dry run | Complete linked `011`-`025` plan succeeds; no migration applied |
| Hosted Supabase lint | Linked database lint is clean against hosted state through `010` |
| GitHub publication/CI | Pass - application commit `edaaf625c497380611b80092526926b1457e15a0`, tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4`, author/committer `surgeservicesllc@gmail.com`; CI `31694775758`, both jobs green |
| Exact production Playwright | Pass - focused race 30/30 and full 48/48 at `https://softwarefactory-tan.vercel.app` on READY deployment `dpl_FwjzBywZTadQPTRZtB4Esd9QBKTQ` for the exact application SHA |
| GitHub provider installation | Pass — personal `surgeservicesllc` installation `153286187`, `surgeservicesllc/SoftwareFactory` only; webhook still blank/inactive |
| Vercel configuration/runtime | Exact `surgeservices-projects/softwarefactory` project linked; exact deployment READY; tested pages 200 with CSP/HSTS/X-Frame-Options; protected APIs and invalid webhook 401; ten deployed assets (nine JavaScript and one CSS) contain no privileged markers; zero error/500 logs |
| Real in-product GitHub acceptance | Pending; App connection/webhook remain **Not Connected** |

The repository and intended production/CI runtime require Node 22 or newer. The final local run used Node 22.23.1; older historical test evidence does not replace that run.

## Unit and integration coverage

Phase 1B tests cover or must continue to cover:

- Supabase environment/Auth/session/onboarding and active-organization resolution;
- same-origin and authenticated/tenant authorization boundaries;
- installation-state signature, expiry, nonce, user, organization, and return-path validation;
- App JWT/private-key/server-secret validation;
- installation/repository synchronization, provider-time ordering, terminal deletion, explicit restore, and revoked/permission/rate-limit failures;
- installation-token repository and permission scoping;
- webhook signature, invalid signature, size bounds, delivery deduplication/conflict, accepted/ignored events, and redaction;
- repository coordinates, refs, paths, file-size/binary handling, branch/commit/PR/check mapping;
- literal normalized repository-name matching with no SQL wildcard expansion;
- serialized first/existing installation synchronization, authoritative post-upsert binding, and synchronized-default-branch project linking;
- expanded protected-resource path and likely-secret rejection, including opaque non-placeholder values assigned to generic secret-bearing keys while deliberate placeholders remain allowed;
- exact active-organization enforcement across interactive GitHub routes and truthful connection status derived from live installation/repository evidence;
- authenticated direct raw Activity/webhook-delivery denial plus caller-member `list_activity` reads that cap results and expose only bounded allowlisted actor/source/resource/action/status/conclusion/transition evidence;
- authenticated base-table SELECT revocation plus caller-member/tenant/limit/column/size behavior for agent, command, task, run, and report list RPCs;
- command same-origin/CSRF enforcement and global CSP/security header contracts;
- removal of the legacy HTTP local-file writer and direct authenticated connection/member/project/link/change-request mutation paths;
- authenticated exact stable-repository-UUID change reservation and serialized active-project linking/relink-after-archive, stable same-intent idempotency, provider-evidence completion recovery, actor attribution, and immutable terminal events;
- active-owner-only protected RED approval with exact reservation/path/content/SHA/branch/requester/approver/executor binding, exact phrase/rationale/rollback validation, 15-minute expiry, five-minute pre-provider lease, provider-boundary-before-write-token ordering, exact reclaim, and permanent reclaim denial after provider execution/evidence;
- signed-webhook repository-grant reconciliation, stable repository-to-project attribution, bounded activity details, exact linked-project metadata propagation, and stale/terminal lifecycle ordering through narrow RPC/trigger boundaries;
- Projects sync/branch protection/SHA/commit/PR timestamps/authors/mergeability, default-branch checks, and per-PR head-SHA checks;
- controlled branch + expected SHA + draft-PR-only mutation and idempotency; and
- schema/RPC/RLS/FORCE RLS/audit contracts for migrations.

Contract tests validate static SQL properties, but hosted catalog and cross-tenant user-session checks are still required.

## End-to-end coverage

The final E2E run should exercise desktop, tablet, and mobile layouts plus:

- unauthenticated redirects and safe **Not Connected** states;
- sign-up/sign-in/callback/onboarding/organization selection;
- Connections installation initiation and cancellation/error states;
- real connected state only in a controlled provider acceptance environment;
- project creation from a selected repository;
- live sync time, branch protection/SHA, commit/PR author/timestamp/mergeability views, default-branch checks, and per-PR head-SHA checks;
- file tree/read/edit/preview/unsaved-change protection;
- stale SHA, renamed/same-name repository mismatch, unapproved/admin/expired protected request, reservation expiry/reclaim, and provider failure;
- exact owner-approved protected-file draft PR with immutable approval/execution evidence;
- successful controlled branch/commit/draft PR with no merge/deploy; and
- accessibility, keyboard, browser-error, and viewport-overflow checks.

## Hosted Supabase evidence

Hosted migration `010` is in the ledger. Its transactional preflight/application checks returned zero unsafe projects, kill-switch default true, both constraints validated, zero switch-off organizations, zero unsafe projects, authenticated RPC execute true, and anonymous execute false. The CLI is authorized as `surgeservicesllc@gmail.com`, linked to exact project `qpuofpmagrmyamahqwxw`, and linked database lint is clean. A complete linked dry run successfully plans exactly `011`-`025` and applies nothing. Next, obtain exact owner approval, apply the full chain, then test two authenticated tenants plus anonymous denial without service role as the user-under-test.

## Real GitHub acceptance

Use the checklist in [GitHub App integration](GITHUB_APP_INTEGRATION.md). Provider configuration, mocked requests, and route tests do not prove the real callback/token/repository/webhook workflow.

## Final evidence

Before claiming completion, record exact commands, tree/commit, date, result, hosted project/migration state, production deployment ID, and provider acceptance outcomes in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`. A skipped, stale, flaky, or narrower test is not passing evidence for omitted scope.
