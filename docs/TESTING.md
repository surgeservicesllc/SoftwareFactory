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

## Last verified baseline and current-tree status (2026-08-12)

| Gate | Result |
| --- | --- |
| Current lint/typecheck | Pass |
| Current full Vitest | Pass - 38 files/263 tests (unit 23/145, integration 15/118) |
| Current migration-chain RLS matrix | Pass - 5/5 through migration `019` |
| Current production build | Pass - 34 routes |
| Current coverage | Pass - 38 files/263 tests; 66.08% statements, 65.13% branches, 58.62% functions, 67.16% lines; required risk/constants thresholds pass |
| Current E2E/responsive/accessibility | Pass - 12/12 desktop/tablet/mobile including axe after relocating an ignored stale OneDrive coverage cache |
| Current secret/client scan | Pass - no credential/private-key marker in tracked/untracked non-fixture source; only explicit fake detector fixtures matched; rebuilt `.next/static` has no privileged env name, key marker, or `service_role` marker |
| Prior local baseline before migrations `014`-`019` | 25 files/208 tests, 34-route build, and 12/12 local E2E passed; historical evidence only |
| Hosted Supabase migration application | Pass through `010`; transactional preflight `unsafe_project_rows=0` and hosted safety checks passed |
| Local migrations `011`-`019` | Not hosted; exact owner approval and post-apply ledger/lint/grant/RLS/RPC/ordering/recovery/CHECK-helper checks pending |
| Hosted Supabase lint | Pass through `009` — no schema errors (`[]`); post-`010` CLI attempt blocked by account `403`, so not claimed |
| Last independently verified stable-production Playwright | Pass — 12/12 at `https://softwarefactory-tan.vercel.app` on pre-hardening deployment `dpl_9M66dxkkNiqTTRVbC2SGqzXzkwju` from `f12814bd94001e5c9fe9637e0350e14816de8d13`; historical evidence only |
| GitHub provider installation | Pass — installation `153286187`, `surgeservicesllc/SoftwareFactory` only |
| Real in-product GitHub acceptance | Pending; App connection/webhook remain **Not Connected** |

The local shell used Node 20 and emitted Supabase's future-support warning. The repository and intended production/CI runtime require Node 22 or newer. The warning does not invalidate the recorded local pass, but release evidence should prefer Node 22.

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
- expanded protected-resource path and likely-secret rejection;
- exact active-organization enforcement across interactive GitHub routes and truthful connection status derived from live installation/repository evidence;
- caller-RLS Activity reads that omit metadata from browser responses;
- removal of the legacy HTTP local-file writer and direct authenticated connection/member/project/link/change-request mutation paths;
- authenticated exact-binding change reservation, stable same-intent idempotency, provider-evidence completion recovery, actor attribution, and immutable terminal events;
- signed-webhook repository-grant reconciliation, exact linked-project metadata propagation, and stale/terminal lifecycle ordering through narrow RPC/trigger boundaries;
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
- live branch/commit/PR/check views;
- file tree/read/edit/preview/unsaved-change protection;
- stale SHA, protected path, and provider failure;
- successful controlled branch/commit/draft PR with no merge/deploy; and
- accessibility, keyboard, browser-error, and viewport-overflow checks.

## Hosted Supabase evidence

Hosted migration `010` is in the ledger. Its transactional preflight/application checks returned zero unsafe projects, kill-switch default true, both constraints validated, zero switch-off organizations, zero unsafe projects, authenticated RPC execute true, and anonymous execute false. The last successful linked public-schema lint is green through `009`; the post-`010` CLI attempt received account `403`, so no post-`010` lint result is claimed. A prior hosted catalog query returned 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 enabled row-secret guards. Next, restore authorized CLI lint and test two authenticated tenants plus anonymous denial without service role as the user-under-test.

## Real GitHub acceptance

Use the checklist in [GitHub App integration](GITHUB_APP_INTEGRATION.md). Provider configuration, mocked requests, and route tests do not prove the real callback/token/repository/webhook workflow.

## Final evidence

Before claiming completion, record exact commands, tree/commit, date, result, hosted project/migration state, production deployment ID, and provider acceptance outcomes in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`. A skipped, stale, flaky, or narrower test is not passing evidence for omitted scope.
