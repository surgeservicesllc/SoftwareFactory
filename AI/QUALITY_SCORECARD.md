# Quality scorecard

Last reviewed: 2026-08-13

Phase 1C decision: **Not release-ready yet**

Reason: the full site build-out and the execution loop are implemented and pass every local gate, but no part of the loop has been observed live. Hosted migrations `011`-`016` are unapplied, no provider or worker credential exists, no worker tick has ever run, and the GitHub connection, webhook, and authenticated tenant behavior remain unverified.

Phase 1B decision: **Not release-ready yet** — its outstanding blockers below are unchanged and are now a prerequisite for Phase 1C acceptance.

## Phase 1C evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Provider abstraction, Codex adapter, deterministic orchestrator, durable leased run engine, diff review, draft-PR delivery, every primary page live | Implemented locally; no live run observed |
| Lint | `npm run lint` | Pass |
| Typecheck | `npm run typecheck` | Pass |
| Unit and integration tests | `npm test` | Pass — 31 files / 300 tests |
| Migration application | All 16 migrations applied in order to real PostgreSQL via pglite | Pass — 26 tables, all with RLS and FORCE RLS |
| Execution schema behavior | `tests/integration/phase1c-execution-schema.test.ts` | Pass — 17 tests: leasing, lease reclaim, append-only evidence, secret rejection, concurrency ceiling, cancellation, retry policy, unapproved RED refusal, dependency ordering, Phase 1D interlocks |
| Security boundary contract | `tests/integration/phase1c-boundaries.contract.test.ts` | Pass — 13 tests: service-role confinement, no provider credential reachable from client code, same-origin on every cookie-authenticated mutation, tenant scoping, RLS/read-only grants, draft-only PRs, no merge/deploy/rollback executor |
| Production build | `npm run build` | Pass — 41 routes |
| E2E/responsive/accessibility | `npm run test:e2e` | Pass — 15/15 across desktop, tablet, mobile including axe |
| Demo content removal | `lib/demo-data.ts` deleted; no page imports seeded content | Pass |
| Hosted migrations `011`-`016` | — | **Pending exact owner approval**; no hosted application, lint, or RPC claim |
| OpenAI Codex worker | Adapter implemented and contract-tested; no `OPENAI_API_KEY` | **Not Connected** |
| Durable worker tick | Endpoint, leasing, and authorization implemented and tested; no `WORKER_TICK_SECRET`/`CRON_SECRET` | **Not Connected** |
| Commanded execution | Owner-gated per organization, defaults OFF | OFF |
| Real worker run | — | **Never executed** |
| Vercel deployment visibility | No `VERCEL_TOKEN`; metrics report unavailable rather than zero | **Not Connected** |

### Defects found and fixed by these gates

1. Dashboard connectivity was derived from connection status alone and could disagree with the Projects page; it now uses identical evidence.
2. An unlayered `a { color: inherit }` rule outranked layered component classes, causing a WCAG contrast failure on every `.primary-action` link.
3. The orchestrator applied the declared risk floor to the plan but not to its tasks, and task risk is what gates execution.
4. The diff secret scanner backtracked catastrophically on long single lines (250KB minified line took over 50 seconds), which would stall a worker tick.
5. `claim_agent_runs` counted an attempt on every claim, so a multi-tick run would exhaust its retry budget without failing.

## Phase 1B evidence (unchanged)

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding; active-tenant GitHub boundaries; truthful connection/project/file state; live Activity; guarded GitHub writes; local migrations `011`-`013` | Implemented locally; live acceptance pending |
| Current-tree check phases | `npm run check` | Lint, typecheck, and 24 files/205 tests pass; build phase hit only a stale OneDrive `.next` cache `EPERM` |
| Current-tree production build | standalone `npm run build` after recoverable cache relocation | Pass — 34 pages/routes |
| Full coverage suite | `npm run test:coverage` after final `013` ordering/contracts | Pass — 25 files/208 tests; 50.44% statements, 52.99% branches, 45.07% functions, 51.24% lines |
| Focused `013` chain | 3 files/44 tests | Pass |
| Local E2E/responsive/accessibility | `npm run test:e2e` | Pass — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, and axe |
| Secret safety | Current source/tracked and `.next/static` scan | Pass; only the synthetic `github_pat_` fixture matched, and no built static server-secret markers were found |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, `ACTIVE_HEALTHY` | Pass |
| Hosted migrations | Hosted ledger through `010`; transactional application after `unsafe_project_rows=0` | Pass through `010` |
| Local migrations `011`-`013` | Authorization/grant, audit, and webhook-reconciliation forward migrations | Local implementation only; exact owner approval, hosted application, and post-apply checks pending |
| Phase 1D hosted interlocks | Kill-switch default true; both constraints validated; 0 switch-off organizations; 0 unsafe projects; authenticated RPC execute true; anon false | Pass; execution still unavailable |
| Hosted database lint | Last successful public-schema linked lint through `009`: no errors (`[]`); post-`010` attempt received CLI-account `403` | Pass through `009`; post-`010` not verified |
| Hosted RLS | SQL Editor catalog: 22 public tables, 22 RLS, 22 FORCE RLS, 43 policies, 22 row-secret guards; linked history separately confirms 8 migrations through `009` | Catalog/history pass; authenticated behavior pending |
| GitHub sync/project hardening | `009` serializes external-installation sync and forces synchronized default branch; repository full-name matching is literal | Implementation/contract and hosted migration pass; live behavior pending |
| Protected-resource writes | Classifier additionally blocks nested ownership/memory files, config/dependency-manager files, and security-sensitive path segments; no local HTTP writer remains | Pass in current local gates |
| GitHub App configuration | App/permissions/events configured; sole key fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=` promoted in Vercel | Pass for App/key configuration |
| GitHub provider installation | Installation `153286187` on `surgeservicesllc`, selected repository only `surgeservicesllc/SoftwareFactory` | Pass for provider installation scope |
| GitHub real connection | Provider installation exists; authenticated SoftwareFactory callback/tenant connection/token/repository sync | **Not Connected** / pending in-product acceptance |
| GitHub webhook | Route tested locally; provider General form blank/inactive and App-auth hook config returns `404`/no hook object | **Not Connected** / no real delivery |
| Project/repository flow | Code implemented; real selected repo/project | Pending live acceptance |
| File-to-draft-PR | Guarded implementation/tests; real branch/commit/draft PR | Pending live acceptance |
| Git/main provenance | implementation `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278`; owner marker/current main `7bd9d30e67bf018aba32f28d235d4a2f1232d65c` | Pass — implementation authorship preserved; empty marker changes no application files |
| Vercel production deployment | `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY`, READY/current at deployment URL and stable alias, exact `e0ca6e7` application tree via marker `7bd9d30`; production Playwright 12/12 | Pass for hosting/public E2E and exact runtime provenance; full provider acceptance pending |
| Production HTTP probes | `/`, `/activity`, `/connections` 200; unauthenticated `/api/activity` 401; removed `/api/files` 404 | Pass |
| Codex/OpenAI | No live worker | **Not Connected** |
| Claude/Anthropic | No live worker | **Not Connected** |
| Automation safety | No merge/deploy/rollback endpoints/workflows; controls OFF | Pass |
| Phase 1D observation scaffold | Autonomous Mode OFF; GREEN-only pure evaluator; static locked UI; same-origin tenant/owner API; hosted migration `010` kill switch/constraints | Local lint/typecheck, focused tests (51), full tests (157), 34-route build, and hosted safety checks pass; execution remains blocked |

## Recorded local and hosted evidence

The hardening gates and current production deployment are recorded first. Hosted Supabase still ends at `010`; source migrations `011`-`013` are present in the deployed tree but are not applied to the database.

```text
Review date: 2026-08-12
Local shell: Node 20 (Supabase future-support warning)
Target runtime: Node >=22

npm run check (current local hardening):
  PASS — lint, typecheck, 24 files / 205 tests
  BUILD PHASE — stale OneDrive .next cache EPERM only
npm run build after recoverable cache relocation:
  PASS — 34 pages/routes
npm run test:coverage (after final 013 ordering/contracts):
  PASS — 25 files / 208 tests
  COVERAGE — 50.44 statements / 52.99 branches / 45.07 functions / 51.24 lines
focused 013 chain:
  PASS — 3 files / 44 tests
npm run test:e2e (current local hardening):
  PASS — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, axe
current secret/client scan:
  PASS — only synthetic github_pat_ fixture matched; no .next/static server-secret markers

Prior baseline detail:
npm run test:unit:
  PASS — 58 tests after repository-write hardening
npm run test:integration:
  PASS — 88 tests after migration 009
npm run lint:
  PASS
npm run typecheck:
  PASS
npm test:
  PASS — 157 tests on the prior Phase 1D observation-scaffold baseline
npm run build:
  PASS — 34 pages/routes
npm run test:e2e:
  PASS — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, axe
stable production test:e2e:
  PASS — 12/12 at https://softwarefactory-tan.vercel.app
final secret/client scan:
  PASS — no credential patterns or built-client privileged server names; only .env.example tracked

Vercel production:
  implementation — e0ca6e7fe62234817e24273fb8ba3f6a12ffd278, pushed to origin/main
  current main / owner-authored empty deployment marker — 7bd9d30e67bf018aba32f28d235d4a2f1232d65c
  deployment — dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY, READY/current
  deployment URL — softwarefactory-fbho4i38o-surgeservices-projects.vercel.app
  stable alias — https://softwarefactory-tan.vercel.app
  production Playwright — PASS, 12/12
  HTTP — / 200; /activity 200; /connections 200; /api/activity unauthenticated 401; /api/files 404
  provenance note — direct e0ca deployment was blocked by Vercel Hobby private-repo author membership; empty marker changes no application files and builds the exact e0ca application tree

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
  exact owner approval and hosted application/verification of migrations 011 through 016
  authenticated production Supabase journey
  authenticated SoftwareFactory callback/tenant connection/repository/project/file/draft-PR/webhook/disconnect acceptance
  authorized post-010 CLI lint and broader hosted tenant/RPC/audit verification
```

## Security acceptance still required

- prove two-tenant and anonymous denial with user sessions;
- verify the durable worker boundary is unreachable from an authenticated browser session in hosted Supabase;
- verify unapproved RED work and dependent work are refused at claim time in hosted Supabase;
- observe one complete real run: plan, lease, provider call, diff review, isolated branch, draft PR, real CI, recorded result;
- verify a cancelled run stops before its next external effect and opens no pull request;
- verify a protected-path and a secret-bearing proposal are both blocked before any commit;
- verify RLS and FORCE RLS on every exposed hosted table;
- verify security-definer search paths/grants/actor checks after hosted promotion of `011`-`013`;
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
