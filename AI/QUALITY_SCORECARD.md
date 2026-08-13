# Quality scorecard

Last reviewed: 2026-08-12

Phase 1B decision: **Not release-ready yet**

Reason: local gates, GitHub publication/CI, and exact-tree production hosting pass, but hosted migrations `011`-`019`, hosted authenticated tenant behavior, in-product GitHub callback/connection, active webhook delivery, and the complete live provider journey remain pending.

A GREEN interface simplification (ADR-021, ADR-022) now sits on top of that hardening. It is presentation-only and does not move any release blocker: no provider became Connected, no phase advanced, and every production row below still describes release `427190d`, which predates it.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding; active-tenant GitHub boundaries; strict provider schemas/URLs; truthful UI; retry-safe draft-PR flow; lifecycle ordering; local migrations `011`-`019` | Implemented; all current local gates pass; live acceptance pending |
| Current-tree lint/typecheck/full Vitest | Consolidated local run | Pass - lint/typecheck; 38 files/263 tests (unit 23/145, integration 15/118) |
| Current-tree coverage | `npm run test:coverage` | Pass - 38 files/263 tests; 66.08% statements, 65.13% branches, 58.62% functions, 67.16% lines; required risk/constants thresholds pass |
| Current-tree migration chain | Full-chain RLS behavioral matrix through migration `019` | Pass - 5/5 |
| Current-tree production build | `npm run build` | Pass - 34 routes |
| Current-tree E2E/responsive/accessibility | `npm run test:e2e` after relocating an ignored stale OneDrive coverage cache | Pass - 12/12 desktop/tablet/mobile including axe |
| Current-tree secret/client scan | Tracked and untracked non-fixture source plus rebuilt `.next/static` | Pass - no credential/private-key markers in non-fixture source; only explicit fake detector fixtures matched; no privileged env names/key markers/`service_role` in client assets |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, last verified `ACTIVE_HEALTHY` | Historical pass |
| Hosted migrations | Hosted ledger through `010` | Pass through `010` only |
| Local migrations `011`-`019` | Authorization/grants, audit, reconciliation, metadata propagation, recovery, lifecycle ordering, reservation, CHECK-helper grant | Local only; exact owner approval/application/post-apply verification pending |
| Hosted database lint | Last successful linked public-schema lint through `009`: `[]`; post-`010` CLI received `403` | Pass through `009`; later state unverified |
| Hosted RLS catalog | Prior 22 tables / 22 RLS / 22 FORCE RLS / 43 policies / 22 secret guards | Catalog evidence retained; current authenticated behavior pending |
| Protected-resource writes | Broad subject/path/dependency/provider/control-plane classes blocked; no local HTTP writer; required risk/constants thresholds pass | Pass in current local tests; live-provider acceptance pending |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; existing draft-PR evidence recovery | Implemented locally via application + migrations `015`/`017`; hosted/live verification pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Implemented locally via migrations `016`/`018`; hosted/live verification pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Implemented locally via `019`; hosted verification pending |
| GitHub App configuration | App ID `4573846`; server-only variable names configured | Configuration evidence only |
| GitHub provider installation | Installation `153286187`, selected only for `surgeservicesllc/SoftwareFactory` | Provider-scope evidence only |
| GitHub real connection | Authenticated SoftwareFactory callback/tenant connection/token/repository sync | **Not Connected** |
| GitHub webhook | Route implemented; active hook/valid signed production delivery absent | **Not Connected** |
| Project/repository and file-to-draft-PR flow | Code/tests exist; real journey absent | Pending live acceptance |
| Git/main provenance for this increment | Application commit `427190d050796e3f5ff5cf6154adc2c34e2e5694`, author `NewWorldVenture`; CI run `31649243266` | Pass - commit on `main`, 2/2 CI green |
| Vercel production for this increment | READY deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`; metadata `softwarefactoryGitCommitSha=427190d050796e3f5ff5cf6154adc2c34e2e5694` | Pass - exact application tree, production alias, HTTP/E2E/assets/log checks verified |
| OpenAI/Codex | No live worker; Phase 1C not started | **Not Connected** |
| Anthropic/Claude | No live worker | **Not Connected** |
| Automation safety | No merge/deploy/rollback executor; controls OFF | Pass |
| Phase 1D observation scaffold | Autonomous Mode OFF, GREEN-only observation, global kill switch ON | Execution remains blocked |
| Scope/implementation | Auth/onboarding; active-tenant GitHub boundaries; truthful connection/project/file state; live Activity; guarded GitHub writes; local migrations `011`-`013` | Implemented locally; live acceptance pending |
| Current-tree check phases | `npm run check` | Lint, typecheck, and 24 files/205 tests pass; build phase hit only a stale OneDrive `.next` cache `EPERM` |
| Current-tree production build | standalone `npm run build` after recoverable cache relocation | Pass — 34 pages/routes |
| Focused `013` chain | 3 files/44 tests | Pass |
| Local E2E/responsive/accessibility | `npm run test:e2e` | Pass — 48/48 desktop/tablet/mobile. Dashboard depth checks (12) plus `tests/e2e/pages.spec.ts` (36) asserting heading, no horizontal overflow, and axe on 12 routes. |
| Interface simplification (GREEN) | Design tokens with a 12px type floor (ADR-021), plain-language copy (ADR-022), grouped navigation, guided dashboard path, dead `project-form` removed | Pass locally on Node 22 — `npm run check` green in one run; presentation only, no route/schema/policy/provider change |
| Live Supabase wiring (ADR-023) | Five tenant read routes over existing tables through one server-only boundary; five surfaces converted from seeded arrays; `lib/demo-data.ts` deleted | Pass locally — 40 files/289 tests on the merged tree. Read-only application change: no hosted schema change, no credential set, no provider capability added |
| Withheld-column contract | Run `input`/`output`, report `content`, and command `parameters` are excluded from every list select; no `select("*")` | Pass — asserted by `tests/integration/tenant-list-routes.contract.test.ts` |
| Interface accessibility repairs | axe across every route at three viewports | Pass — two real WCAG AA defects fixed: anchor primary buttons at 1.21:1 caused by an unlayered `a { color: inherit }` outranking `@layer components`, and a keyboard-unreachable horizontal scroll region on the backlog. Both predate this change; gradient panel backgrounds had made axe report contrast "incomplete" rather than failing. |
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
| Production HTTP probes | `/`, `/activity`, `/connections` 200; unauthenticated `/api/activity` 401; removed `/api/files` 404 | Pass |
| Codex/OpenAI | No live worker | **Not Connected** |
| Claude/Anthropic | No live worker | **Not Connected** |
| Automation safety | No merge/deploy/rollback endpoints/workflows; controls OFF | Pass |
| Phase 1D observation scaffold | Autonomous Mode OFF; GREEN-only pure evaluator; static locked UI; same-origin tenant/owner API; hosted migration `010` kill switch/constraints | Local lint/typecheck, focused tests (51), full tests (157), 34-route build, and hosted safety checks pass; execution remains blocked |

## Recorded local and release evidence

```text
Review date: 2026-08-12
Verified hardening application release:
  commit: 427190d050796e3f5ff5cf6154adc2c34e2e5694
  author: NewWorldVenture
  CI: run 31649243266 - PASS, 2/2
  deployment: dpl_9oqg94scmdn5X86r7yyrgmsVtmBu - READY Production
  deployment metadata: softwarefactoryGitCommitSha=427190d050796e3f5ff5cf6154adc2c34e2e5694
  deployment URL: softwarefactory-i3pm08bpx-surgeservices-projects.vercel.app
  stable alias: https://softwarefactory-tan.vercel.app
  public Playwright: PASS - 12/12
  HTTP: five public routes 200; authenticated APIs 401; removed /api/files 404; expected title
  deployed JS: 9 assets scanned, no privileged markers
  recent logs: 0 errors; 0 HTTP 500
Live Supabase wiring re-run (ADR-023, read-only application change):
Local shell: Node 22
  npm run check                 PASS - lint, typecheck, 40 files / 289 tests, build in one run
  build route table             46 entries, including the 4 new /api/agents|tasks|runs|reports routes
                                (/api/commands already existed and gained a GET)
  npm run test:e2e              PASS — 48/48 across desktop/tablet/mobile
  wiring check                  0 references to lib/demo-data remain; the module is deleted
  boundary check                every list select enumerates columns; no select("*"); run input/output,
                                report content, and command parameters are never selected
  NOT DONE                      no Supabase credential was set (owner-held, never in source control),
                                so local and preview still render signed-out states
  NOT DONE                      hosted migrations 011-013 remain unapplied and RED

Interface simplification re-run (GREEN, presentation only):
Local shell: Node 22 (no Supabase future-support warning)
  npm run check                 PASS — lint, typecheck, 25 files / 208 tests, 34-route build in one run
  npm run test:e2e              PASS — 48/48 (12 dashboard + 36 per-page) across desktop/tablet/mobile
  axe, all 12 routes x 3 widths PASS — no serious or critical violations
  secret scan                   PASS — no credential values in tracked source or .next/static;
                                matches are env-var names in docs/config only
  scope check                   0 sub-12px type declarations remain in app/ and components/ (was 133).
                                1 literal hex remains, the themeColor meta value in app/layout.tsx,
                                which must be a literal and is commented to track --bg; every other
                                colour (~500 previously) now resolves through a token. No route,
                                schema, policy, token, or provider behaviour changed.
  NOT deployed                  the published production rows describe release 427190d, which predates this

Prior review date: 2026-08-12
Local shell: Node 20 (Supabase future-support warning)
Target runtime: Node >=22

Hosted Supabase baseline:
  project: qpuofpmagrmyamahqwxw
  applied ledger: 001, 002, 003, 004, 005, 007, 008, 009, 010
  last clean linked public-schema lint: through 009 / []
  post-010 linked lint: NOT VERIFIED - CLI account returned 403
```

Application-release evidence is provider-resolved through deployment metadata rather than inferred from the latest Git tip, so a documentation-only successor does not make the runtime SHA claim stale. It does not verify hosted migrations `011`-`019` or the live GitHub workflow.

## Security and production acceptance still required

- Preserve the passing current-tree quality/secret evidence for the exact committed tree and rerun affected checks after any change.
- Apply migrations `011`-`019` only after exact owner approval; verify all grants/search paths, RLS/FORCE RLS, two-tenant/anonymous denial, provider-ingress CHECK evaluation, actor attribution, immutable/redacted activity, lifecycle ordering, and recovery behavior.
- Complete a real authenticated production session and the entire GitHub callback/token/repository/project/read/edit/draft-PR/disconnect journey.
- Observe valid, invalid, duplicate, stale, out-of-order, deletion, and restore webhook deliveries in production.
- Verify stale SHA, protected path, likely secret, wrong tenant, revoked installation, insufficient permission, rate limit, stable retry, and ambiguous completion recovery.
- Complete and record hosted migration/Auth/GitHub provider acceptance separately from the already verified application release.

## Release-blocking invariants

- Any exposed secret, disabled RLS, cross-tenant access, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, or unapproved protected production action is a failure.
- Configuration, tests, provider installation, or Vercel READY status cannot be relabeled as a real SoftwareFactory GitHub connection.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
