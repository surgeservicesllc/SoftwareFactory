# Quality scorecard

Last reviewed: 2026-08-12

Phase 1B decision: **Not release-ready yet**

Reason: hosted migration/lint and final hardened-tree code/browser/secret gates pass, but hosted authenticated RLS behavior, exact production deployment, and real GitHub acceptance remain.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding, GitHub install/token/sync/read/write/webhook boundaries, project link, and live UI are present | Pass for implementation; live acceptance pending |
| Unit | `npm run test:unit`: 58 tests on the hardened tree | Pass |
| Integration | `npm run test:integration`: 88 tests after `009` | Pass |
| Lint | `npm run lint` | Pass |
| Type safety | `npm run typecheck` | Pass |
| Full Vitest | `npm test`: 16 files, 146 tests | Pass |
| Production build | `npm run build`: 34 pages/routes | Pass |
| E2E/responsive/accessibility | Desktop/tablet/mobile Playwright/axe: 12/12 | Pass; navigation, viewport overflow, browser-error, and accessibility gates green |
| Secret safety | Credential-pattern and built-client privileged-name scans on the hardened tree | Pass; no matches, and `.env.example` is the only tracked environment file |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, `ACTIVE_HEALTHY` | Pass |
| Hosted migrations | Local=remote for `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009` | Pass |
| Hosted database lint | Public schema, warning level, fail-on-error: no schema errors (`[]`) | Pass |
| Hosted RLS | SQL Editor catalog: 22 public tables, 22 RLS, 22 FORCE RLS, 43 policies, 22 row-secret guards; linked history separately confirms 8 migrations through `009` | Catalog/history pass; authenticated behavior pending |
| GitHub sync/project hardening | `009` serializes external-installation sync and forces synchronized default branch; repository full-name matching is literal | Implementation/contract and hosted migration pass; live behavior pending |
| Protected-resource writes | Classifier blocks repository memory/policies, Supabase, every app API route, GitHub/server/Supabase libraries, Auth/session, deployment/environment/infrastructure, and sensitive subject paths | Unit pass; final full gate pending |
| GitHub App configuration | App permissions/events and server values configured in Vercel; webhook endpoint still appears blank/inactive | Partial configuration; endpoint/delivery unverified |
| GitHub real connection | Installation/callback/token/repository sync | **Not Connected** / pending |
| GitHub webhook | Signed/idempotent route tested locally; real delivery | Pending live acceptance |
| Project/repository flow | Code implemented; real selected repo/project | Pending live acceptance |
| File-to-draft-PR | Guarded implementation/tests; real branch/commit/draft PR | Pending live acceptance |
| Vercel production release | Baseline project/alias known; exact Phase 1B commit/deployment | Pending |
| Codex/OpenAI | No live worker | **Not Connected** |
| Claude/Anthropic | No live worker | **Not Connected** |
| Automation safety | No merge/deploy/rollback endpoints/workflows; controls OFF | Pass |

## Recorded hardened-tree evidence

```text
Review date: 2026-08-12
Local shell: Node 20 (Supabase future-support warning)
Target runtime: Node >=22

npm run test:unit:
  PASS — 58 tests after repository-write hardening
npm run test:integration:
  PASS — 88 tests after migration 009
npm run lint:
  PASS
npm run typecheck:
  PASS
npm test:
  PASS — 16 files / 146 tests
npm run build:
  PASS — 34 pages/routes
npm run test:e2e:
  PASS — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, axe
final secret/client scan:
  PASS — no credential patterns or built-client privileged server names

hosted Supabase:
  project qpuofpmagrmyamahqwxw — ACTIVE_HEALTHY
  applied/local=remote — 001, 002, 003, 004, 005, 007, 008, 009
  linked public-schema lint — PASS, no schema errors / []
  hosted catalog — 22 tables / 22 RLS / 22 FORCE RLS / 43 policies / 22 secret guards
  linked migration history — 8 migrations through 009
  008 local — pglast all 7; PGlite reproduced 004 failure, then repair passed create/resync with audit/grant checks
  009 — serialized external-installation sync, authoritative post-upsert binding, synchronized-default-branch project linking
  required — hosted authenticated RLS/tenant/RPC/audit behavior checks

pending:
  exact Phase 1B commit + Vercel deployment ID/smoke
  authenticated production Supabase journey
  real GitHub installation/repository/project/file/draft-PR/webhook/disconnect acceptance
```

## Security acceptance still required

- prove two-tenant and anonymous denial with user sessions;
- verify RLS and FORCE RLS on every exposed hosted table;
- verify security-definer search paths/grants/actor checks after `009`;
- verify App token scope/expiry and no token leakage in responses/logs;
- observe valid/invalid/duplicate webhook behavior in production;
- verify protected path, likely-secret, stale SHA, wrong tenant, revoked installation, and insufficient permission failures; and
- verify activity evidence is immutable and redacted.

## Release-blocking invariants

- Any exposed secret, disabled RLS, cross-tenant access, direct default-branch write, non-draft/merge/deploy action, or unapproved RED action is an immediate failure.
- Configuration/mocks/tests cannot be relabeled as a real provider connection.
- Clean migration/lint evidence does not prove authenticated RLS behavior; both evidence layers must be stated separately.
- A Vercel READY deployment is not full post-deploy/provider acceptance.
- A future code/provider/schema change invalidates affected evidence and requires this scorecard to be rerun.
