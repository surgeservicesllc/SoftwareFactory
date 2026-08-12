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

## Current hardened-tree evidence (2026-08-12)

| Gate | Result |
| --- | --- |
| `npm run test:unit` | Pass — 58 tests after repository-write hardening |
| `npm run test:integration` | Pass — 88 tests after migration `009` |
| `npm run lint` | Pass on the hardened tree |
| `npm run typecheck` | Pass on the hardened tree |
| `npm test` | Pass — 16 files, 146 tests |
| `npm run build` | Pass — 34 pages/routes |
| Hosted Supabase migration push | Pass — local=remote for `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009` |
| Hosted Supabase lint | Pass — public schema, warning level, fail-on-error; no schema errors (`[]`) |
| Playwright E2E | Pass — 12/12 across desktop, tablet, and mobile, including navigation, overflow, browser-error, and axe gates |
| Secret/client-bundle scan | Pass on the hardened tree — no credential patterns or built-client privileged server names |
| Real GitHub App acceptance | Pending; App is **Not Connected** |

The local shell used Node 20 and emitted Supabase's future-support warning. The repository and intended production/CI runtime require Node 22 or newer. The warning does not invalidate the recorded local pass, but release evidence should prefer Node 22.

## Unit and integration coverage

Phase 1B tests cover or must continue to cover:

- Supabase environment/Auth/session/onboarding and active-organization resolution;
- same-origin and authenticated/tenant authorization boundaries;
- installation-state signature, expiry, nonce, user, organization, and return-path validation;
- App JWT/private-key/server-secret validation;
- installation/repository synchronization and revoked/permission/rate-limit failures;
- installation-token repository and permission scoping;
- webhook signature, invalid signature, size bounds, delivery deduplication/conflict, accepted/ignored events, and redaction;
- repository coordinates, refs, paths, file-size/binary handling, branch/commit/PR/check mapping;
- literal normalized repository-name matching with no SQL wildcard expansion;
- serialized first/existing installation synchronization, authoritative post-upsert binding, and synchronized-default-branch project linking;
- expanded protected-resource path and likely-secret rejection;
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

Linked migration list and public-schema lint are green through `009`. A hosted catalog query returned 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 enabled row-secret guards; the subsequent linked list independently confirms all eight expected migrations through `009`. Next, test two authenticated tenants plus anonymous denial without service role as the user-under-test. Test privileged RPCs with authorized and unauthorized actors and confirm immutable/redacted audit evidence.

## Real GitHub acceptance

Use the checklist in [GitHub App integration](GITHUB_APP_INTEGRATION.md). Provider configuration, mocked requests, and route tests do not prove the real callback/token/repository/webhook workflow.

## Final evidence

Before claiming completion, record exact commands, tree/commit, date, result, hosted project/migration state, production deployment ID, and provider acceptance outcomes in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`. A skipped, stale, flaky, or narrower test is not passing evidence for omitted scope.
