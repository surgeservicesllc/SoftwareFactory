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

## Last verified application release and current hosted status (2026-08-13)

| Gate | Result |
| --- | --- |
| Cutover check | Pass - lint, typecheck, 56 files/436 Vitest tests, 38-route build; deployed main CI is green |
| Application release integration suite | Pass - 21 files/163 tests |
| Migration `026` | Retained pass locally and hosted - pre-`027` history matched, dry run/lint clean, exact ACL mismatch count zero |
| Current-tree coverage | Pass - statements 74.76%, branches 75.59%, functions 68.02%, lines 75.82% |
| Local and exact production E2E/responsive/accessibility | Pass - Playwright 48/48 across desktop/tablet/mobile, including axe checks |
| Signed-out dashboard race | Pass - focused browser-error test repeated 30/30 against production |
| Verified application-release secret/client scan | Pass - zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present |
| Candidate cutover coverage and secret/client scan | Pending before publication; the full `npm run check` is green but does not replace these gates |
| Prior local baseline before migrations `014`-`019` | 25 files/208 tests, 34-route build, and 12/12 local E2E passed; historical evidence only |
| Hosted Supabase migration application | Pass through `027`; live approval/execution/rebind path verified |
| Hosted RLS/catalog/browser grants | Pass - 23/23 RLS+FORCE, 32 policies, zero policyless, 22 secret guards, tested raw authenticated/browser grants false |
| Hosted service-role table grants | Pass - exact matrix mismatch zero; SELECT/INSERT/UPDATE on four GitHub ingress tables, no table privileges on other 19 |
| Hosted Supabase CLI/link | Earlier wrong/unauthorized profile was not used for mutation; reconfirm `surgeservicesllc@gmail.com` and project `qpuofpmagrmyamahqwxw` before future linked commands |
| Hosted Supabase lint | Verified baseline clean through `026`; hosted `027` live behavior passes |
| GitHub publication/CI | Pass - commit `799d2cea189b6860a03987ae75c25765f9ac4aca`, tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`; CI `31716263910`, both jobs green |
| Exact production Playwright | `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` passes 48/48; 13/13 routes, invalid webhook, logs, and 20-asset checks pass |
| Owner Auth/onboarding | Pass - `surgeservicesllc@gmail.com` confirmed/authenticated; SoftwareFactory workspace owner onboarding succeeded |
| GitHub provider installations | Candidate `153479019` live; primary `153445938` active rollback; exact repository selected |
| Vercel configuration/runtime | `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` READY at `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app` and stable alias, source exact main commit `799d2cea189b6860a03987ae75c25765f9ac4aca` |
| Real in-product GitHub acceptance | Candidate callback/sync/webhook/handoff/read/draft-write/audit pass; live second-tenant/reverse/adverse matrix pending |
| Live controlled commit identity | Pass - ordinary draft PR `#6` commit `e789303` and protected draft PR `#7` commit `6a808de` use `surgeservicesllc <surgeservicesllc@gmail.com>` as both author and committer |
| Candidate provider acceptance | Pass - App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, signed webhook, handoff, and clean PR `#8` |
| Dual-App/handoff tests | Pass within current full local check - App-slot/App-ID state, isolated config, persisted-App token routing, dual-signature/provenance webhook handling, owner handoff route, and migration `027` contracts/behavior |

The repository and intended production/CI runtime require Node 22 or newer. The final local run used Node 22.23.1; older historical test evidence does not replace that run.

## Unit and integration coverage

Phase 1B tests cover or must continue to cover:

- Supabase environment/Auth/session/onboarding and active-organization resolution;
- same-origin and authenticated/tenant authorization boundaries;
- installation-state signature, expiry, nonce, user, organization, and return-path validation;
- App JWT/private-key/server-secret validation;
- installation/repository synchronization, provider-time ordering, terminal deletion, explicit restore, and revoked/permission/rate-limit failures;
- installation-token repository and permission scoping;
- primary/candidate configuration isolation, complete-or-absent candidate settings, App-slot/App-ID-bound installation state, persisted-installation-App token routing, and safe absence of a candidate;
- webhook signature, invalid signature, size bounds, delivery deduplication/conflict, accepted/ignored events, and redaction;
- dual-App webhook signature selection, persisted installation/App-ID provenance mismatch rejection, and the processed target-installation delivery precondition;
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
- schema/RPC/RLS/FORCE RLS/audit contracts for migrations; and
- owner-only atomic handoff across two live same-account/same-repository installations, pending-change/conflict rejection, immutable history/evidence preservation, and evidence-bound reverse handoff.

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

Hosted history is current through `027`; the pre-`027` history/lint/ACL baseline and live `027` path pass. Only one actual user/email is authorized, so the live two-tenant plus anonymous caller matrix remains an explicit acceptance gap.

## Real GitHub acceptance

Use the checklist in [GitHub App integration](GITHUB_APP_INTEGRATION.md). Candidate installation, signed delivery, owner handoff, post-handoff read/draft-write behavior, and cleanup pass. They do not prove the pending second-tenant, reverse-handoff, disconnect/loss, or remaining adverse matrix.

## Final evidence

Before claiming completion, record exact commands, tree/commit, date, result, hosted project/migration state, production deployment ID, and provider acceptance outcomes in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`. A skipped, stale, flaky, or narrower test is not passing evidence for omitted scope.
