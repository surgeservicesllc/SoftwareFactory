# Quality scorecard

Last reviewed: 2026-08-12

Phase 1B decision: **Not release-ready yet**

Reason: hosted migration `010` safety checks, prior linked lint through `009`, final code/browser/secret gates, the READY Vercel deployment, and repository-scoped GitHub provider installation pass. A post-`010` CLI lint is unavailable due account `403`; hosted authenticated tenant behavior, the in-product owner callback/connection, webhook configuration/delivery, and remaining GitHub acceptance remain.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding, GitHub install/token/sync/read/write/webhook boundaries, project link, and live UI are present | Pass for implementation; live acceptance pending |
| Unit | `npm run test:unit`: 58 tests on the hardened tree | Pass |
| Integration | `npm run test:integration`: 88 tests after `009` | Pass |
| Lint | `npm run lint` | Pass |
| Type safety | `npm run typecheck` | Pass |
| Full Vitest | Latest current-tree `npm test`: 157 tests after the Phase 1D observation scaffold | Pass |
| Production build | `npm run build`: 34 pages/routes | Pass |
| E2E/responsive/accessibility | Desktop/tablet/mobile Playwright/axe: 12/12 | Pass; navigation, viewport overflow, browser-error, and accessibility gates green |
| Secret safety | Credential-pattern and built-client privileged-name scans on the hardened tree | Pass; no matches, and `.env.example` is the only tracked environment file |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, `ACTIVE_HEALTHY` | Pass |
| Hosted migrations | Hosted ledger through `010`; transactional application after `unsafe_project_rows=0` | Pass through `010` |
| Phase 1D hosted interlocks | Kill-switch default true; both constraints validated; 0 switch-off organizations; 0 unsafe projects; authenticated RPC execute true; anon false | Pass; execution still unavailable |
| Hosted database lint | Last successful public-schema linked lint through `009`: no errors (`[]`); post-`010` attempt received CLI-account `403` | Pass through `009`; post-`010` not verified |
| Hosted RLS | SQL Editor catalog: 22 public tables, 22 RLS, 22 FORCE RLS, 43 policies, 22 row-secret guards; linked history separately confirms 8 migrations through `009` | Catalog/history pass; authenticated behavior pending |
| GitHub sync/project hardening | `009` serializes external-installation sync and forces synchronized default branch; repository full-name matching is literal | Implementation/contract and hosted migration pass; live behavior pending |
| Protected-resource writes | Classifier blocks repository memory/policies, Supabase, every app API route, GitHub/server/Supabase libraries, Auth/session, deployment/environment/infrastructure, and sensitive subject paths | Pass in current full gate |
| GitHub App configuration | App/permissions/events configured; sole key fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=` promoted in Vercel | Pass for App/key configuration |
| GitHub provider installation | Installation `153286187` on `surgeservicesllc`, selected repository only `surgeservicesllc/SoftwareFactory` | Pass for provider installation scope |
| GitHub real connection | Provider installation exists; authenticated SoftwareFactory callback/tenant connection/token/repository sync | **Not Connected** / pending in-product acceptance |
| GitHub webhook | Route tested locally; provider General form blank/inactive and App-auth hook config returns `404`/no hook object | **Not Connected** / no real delivery |
| Project/repository flow | Code implemented; real selected repo/project | Pending live acceptance |
| File-to-draft-PR | Guarded implementation/tests; real branch/commit/draft PR | Pending live acceptance |
| Vercel production deployment | `dpl_436vwUxUAuypnRmCstgptQa2qfve`, READY/Current at stable alias from `3dfdbf35daeff7a79e09a41e5070e521b23d83f9`; production Playwright 12/12 | Pass for hosting/public E2E and exact runtime provenance; full provider acceptance pending |
| Codex/OpenAI | No live worker | **Not Connected** |
| Claude/Anthropic | No live worker | **Not Connected** |
| Automation safety | No merge/deploy/rollback endpoints/workflows; controls OFF | Pass |
| Phase 1D observation scaffold | Autonomous Mode OFF; GREEN-only pure evaluator; static locked UI; same-origin tenant/owner API; hosted migration `010` kill switch/constraints | Local lint/typecheck, focused tests (51), full tests (157), 34-route build, and hosted safety checks pass; execution remains blocked |

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
  PASS — 157 tests on the latest current tree after the Phase 1D observation scaffold
npm run build:
  PASS — 34 pages/routes
npm run test:e2e:
  PASS — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, axe
stable production test:e2e:
  PASS — 12/12 at https://softwarefactory-tan.vercel.app
final secret/client scan:
  PASS — no credential patterns or built-client privileged server names; only .env.example tracked

Vercel production:
  deployment dpl_436vwUxUAuypnRmCstgptQa2qfve — READY/Current at stable alias
  exact runtime source — 3dfdbf35daeff7a79e09a41e5070e521b23d83f9

GitHub App provider state:
  installation 153286187 — installed on surgeservicesllc
  selected repositories — surgeservicesllc/SoftwareFactory only
  sole key fingerprint — SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=
  webhook — Not Connected; General form blank/inactive, App-auth configuration 404/no hook object

hosted Supabase:
  project qpuofpmagrmyamahqwxw — ACTIVE_HEALTHY
  applied hosted ledger — 001, 002, 003, 004, 005, 007, 008, 009, 010
  010 preflight — unsafe_project_rows=0
  010 safety — kill-switch default true; constraints validated; 0 switch off; 0 unsafe projects; authenticated RPC true; anon false
  linked public-schema lint through 009 — PASS, no schema errors / []
  post-010 linked lint — NOT VERIFIED; CLI account returned 403
  hosted catalog — 22 tables / 22 RLS / 22 FORCE RLS / 43 policies / 22 secret guards
  linked migration history — 9 migrations through 010
  008 local — pglast all 7; PGlite reproduced 004 failure, then repair passed create/resync with audit/grant checks
  009 — serialized external-installation sync, authoritative post-upsert binding, synchronized-default-branch project linking
  required — hosted authenticated RLS/tenant/RPC/audit behavior checks

pending:
  final evidence-only documentation commit on main (runtime provenance is already verified)
  authenticated production Supabase journey
  authenticated SoftwareFactory callback/tenant connection/repository/project/file/draft-PR/webhook/disconnect acceptance
  authorized post-010 CLI lint and broader hosted tenant/RPC/audit verification
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
