# Quality scorecard

Last reviewed: 2026-08-13

Phase 1B decision: **Candidate cutover is live and verified; remaining tenant/adverse/rollback observations keep Phase 1B incomplete**

Reason: hosted migration `027`, main release `799d2cea189b6860a03987ae75c25765f9ac4aca`, candidate App `4582606` installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, a post-sync processed signed delivery, atomic project handoff, preserved history, candidate-backed reads, and clean draft-only PR `#8` acceptance pass. Primary installation `153445938` remains active as rollback while its webhook defect stays isolated under Support `#4660724`. The live second-tenant, reverse-handoff, disconnect/loss, and remaining adverse matrix are incomplete; Phase 1C/2 remain Not Connected and automatic actions remain OFF.

Phase 1E decision: **Production-operations control plane implemented and locally verified; unhosted and unobserved, so no live monitoring claim is made**

Reason: migration `028` adds ten RLS/FORCE-RLS operations tables and owner-scoped workflows with zero new `service_role` table privileges, and the detection-to-resolution pipeline is proven against the real migrated schema. Migration `028` is **not** applied to hosted Supabase and no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown**. Rollback and repair execution remain absent by design.

| Area | Evidence | Status |
| --- | --- | --- |
| Phase 1E gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` on the Phase 1E tree | Pass - lint/typecheck; 69 files/635 tests; 64 build entries |
| Phase 1E coverage | `npm run test:coverage` | Pass - merged tree with Phase 2A: statements 72.94%, branches 69.92%, functions 64.57%, lines 74.29%. The Phase 1E tree alone measured 78.02/77.79/70.00/79.15 |
| Phase 1E E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe, `/operations` added | Pass - 51/51 |
| Phase 1E detection pipeline | `tests/integration/phase1e-operations.behavior.test.ts` against the migrated schema | Pass - 28 tests: threshold detection, dedupe, upward-only severity, automatic freeze, owner-only resume, Last Known Good, blocked/failed rollback, bounded repairs, resolution gating, event idempotency, RLS, append-only |
| Phase 1E end-to-end journey | `tests/integration/phase1e-incident-journey.behavior.test.ts` | Pass - ordered Monitor→Detect→Incident→Freeze→Rollback→Diagnose→Repair→Validate→Resolve, plus failed-rollback escalation to SEV1; Codex-fix and deploy stages asserted as blocked, not simulated |
| Phase 1E boundary contracts | `tests/integration/phase1e-operations.contract.test.ts` | Pass - 16 tests: same-origin and role checks on every mutation, execution envelope on every response, no provider deployment call, no new `service_role` table grants, Phase 1D interlocks preserved |
| Phase 1E privilege boundary | Post-`028` grant assertions in the behavioral and hosted-grant suites | Pass - `service_role` still holds table privileges on exactly the four GitHub ingress tables; 38/38 public tables have RLS and FORCE RLS |
| Phase 1E monitoring truth | `production_monitors_enabled_requires_connection`; provider registry; probe target validation | Pass - an unconnected monitor cannot be enabled; private/loopback/metadata targets are refused; no response body is read |
| Phase 1E execution boundary | `autonomous_release_allowed`; `PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED`; `PHASE_1E_REPAIR_WORKER_CONNECTED` | Pass - release authority returns false unconditionally with `EXECUTOR_NOT_CONNECTED`; no rollback, deployment, merge, or repair is executed |
| Phase 1E hosted state | Hosted Supabase is current through `027` | **Not applied** - migration `028` is unhosted and no production target has been observed |
| Scope/implementation | Auth/onboarding; signed-out fetch suppression; active-tenant GitHub boundaries; safe projections; stable repository UUID; protected approval/token/lease integrity; lifecycle/order/recovery; dual-App handoff; migrations `011`-`027` | Application/schema hosted; candidate owner path passes; remaining acceptance pending |
| Cutover-tree lint/typecheck/Vitest/build | `npm run check` plus main CI | Pass - lint/typecheck; 56 files/436 tests; 38 routes; CI `31716263910` green |
| Dual-App replacement boundary | Isolated candidate config; state binds App slot/ID; token routing uses persisted installation App ID; webhook verifies signing App provenance | Deployed and live for candidate installation `153479019` |
| Migration `027` atomic handoff | Immutable exact-tuple owner RED approval/execution; same account/external repository; both installations live; post-sync processed signed target delivery; cross-App/pending-change serialization; preserved history; bounded reverse | Hosted and live handoff passed |
| Hosted handoff database audit | Candidate sync `2026-08-13T15:26:56Z`; earliest qualifying delivery `2026-08-13T15:27:38Z` with exact App ID; immutable RED same-owner approval/execution succeeded; three request/approved/completed events; append-only triggers enabled; old installation/repository retained | Pass - project/link rebound to candidate while four completed change requests and five prior activity rows remain |
| Verified application-release integration suite | `npm run test:integration` | Pass - 21 files/163 tests; focused `026` grant test passes separately |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 74.76%, branches 75.59%, functions 68.02%, lines 75.82% |
| Migration `026` | Narrowed exact table grants; function grants unchanged | Retained pass locally and hosted; pre-`027` history matched, dry run/lint clean, ACL mismatch count zero |
| Current-tree production build | `npm run check` | Pass - compiled 38 routes on Node 22.23.1; `/` is dynamic |
| Signed-out dashboard regression | Focused browser-error race repeated locally and against production | Retained pass - 30/30 production runs; current exact-commit CI is green |
| E2E/responsive/accessibility | Exact-main production Playwright plus CI browser job | Pass - production 48/48 desktop/tablet/mobile including axe; CI `31716263910` green |
| Secret/client boundary | Prior full source/rebuilt-static scan plus current CI secret-boundary contracts and production 20-asset marker scan | Pass - no secret/helper committed; 20 deployed JavaScript assets clean |
| Hosted Supabase identity | Exact project `qpuofpmagrmyamahqwxw`, current through `027`; earlier wrong/unauthorized CLI profile was not used for mutation | Live hosted `027` behavior passes; reconfirm identity before any future linked command |
| Hosted migrations | Current through `027`; pre-`027` history/dry-run/lint baseline retained; live `027` approval/execution/rebind path passed | Hosted through `027` |
| Hosted database identity/lint | Exact `qpuofpmagrmyamahqwxw`; linked lint clean | Pass |
| Hosted RLS/catalog/browser grants | Post-`027`: 25/25 RLS+FORCE, 34 policies, zero policyless; narrow owner-read/no-browser-mutation grants on both handoff-evidence tables; 22 secret guards and raw browser denials retained | Pass |
| Hosted service-role table grants | Verified pre-`027`: SELECT/INSERT/UPDATE on four GitHub ingress tables; no table privileges on other 19; `027` revokes direct access on its new evidence tables | Pass baseline; live `027` path uses narrow RPCs |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Hosted; owner Activity caller path passes; live second-tenant matrix pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Hosted via `021`; live rename/same-name acceptance pending |
| Protected-resource writes | Exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Live protected draft PR `#7` and immutable approval/provider evidence pass; live expiry/admin-denial matrix pending |
| Draft-commit attribution | Deployed boundary strictly validates one server-only deployment identity before authorization/persistence and supplies it as both Contents API author and committer; no App-bot fallback or browser/database/log path | Pass - draft commits `e789303`, `6a808de`, and candidate-backed `204ed79e` verify both fields as `surgeservicesllc <surgeservicesllc@gmail.com>` |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Application plus migrations `015`/`017`/`022` hosted; live acceptance pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Hosted via migrations `016`/`018`; live acceptance pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Hosted via `019`; real provider-ingress insert/rejection acceptance pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Build and public production checks pass; authenticated verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Pass against the live selected repository |
| GitHub App configuration | Primary App `4573846`; candidate App `4582606` (`surge-softwarefactory-next`) owner-only with retained exact callback/active webhook; distinct candidate variable names Sensitive in Production/Preview; commit identity configured | Candidate is live; primary remains active rollback with impaired webhook |
| Supabase Auth owner | `surgeservicesllc@gmail.com` confirmed/authenticated; SoftwareFactory org/workspace owner onboarding succeeded | Pass for onboarding |
| GitHub provider installations | Candidate `153479019` is live for exactly `surgeservicesllc/SoftwareFactory`; primary `153445938` remains active for rollback | Pass for candidate; rollback retained |
| GitHub real connection | Candidate connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`; project `b1f23696-437e-4d89-b55f-d7a949980e8f`; callback/sync/handoff/read/write/audit journey observed | Connected for the owner repository path |
| GitHub webhook | Candidate-signed deliveries for installation `153479019` process with exact App-ID provenance after sync and stream push/check Activity. Primary App `4573846` remains blank/inactive under OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724). | Candidate Connected; primary webhook impaired |
| Local credential cleanup | Temporary downloaded App PEM and ignored provider-verification helper scripts deleted after use; no credential/helper artifact persisted | Pass |
| Project/repository and file-to-draft-PR flow | Candidate-backed branches/commits/checks/PRs/tree/file reads; ordinary draft `#6`; protected RED draft `#7`; candidate acceptance draft `#8`; likely-secret rejection; immutable Activity evidence | Pass for accepted owner scenarios; remaining adverse matrix pending |
| Acceptance cleanup | Prior PRs `#4`/`#5` and candidate acceptance PR `#8` were closed unmerged with isolated branches deleted; PR `#8` passed CI `31716958685` and Vercel Preview; `main` unchanged by acceptance writes | Pass |
| Git provenance for application release | Commit `799d2cea189b6860a03987ae75c25765f9ac4aca`, tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31716263910`, both jobs green | Pass; docs-only successors retain this evidence unless application code changes |
| Vercel production | `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`; `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`; stable alias; source exact main commit `799d2cea189b6860a03987ae75c25765f9ac4aca` | READY; production Playwright 48/48; 13/13 public routes `200`; invalid webhook `401` private/no-store; 30-minute logs clean; 20 JavaScript assets clean |
| OpenAI/Codex | No live worker; Phase 1C not started | **Not Connected** |
| Anthropic/Claude | No live worker | **Not Connected** |
| Automation safety | No merge/deploy/rollback executor; controls OFF | Pass |
| Phase 1D observation scaffold | Autonomous Mode OFF, GREEN-only observation, global kill switch ON | Execution remains blocked |

## Historical baseline (not current-tree proof)

```text
Review date: 2026-08-12
Prior local baseline before migrations 014-019:
  Vitest: PASS - 25 files / 208 tests
  production build: PASS - 34 routes
  local Playwright: PASS - 12/12

Last independently verified pre-hardening production release:
  commit: f12814bd94001e5c9fe9637e0350e14816de8d13
  deployment: dpl_9M66dxkkNiqTTRVbC2SGqzXzkwju
  deployment URL: softwarefactory-3fg568r3j-surgeservices-projects.vercel.app
  stable alias: https://softwarefactory-tan.vercel.app
  public Playwright: PASS - 12/12

Hosted Supabase baseline:
  project: qpuofpmagrmyamahqwxw
  prior applied ledger: 001, 002, 003, 004, 005, 007, 008, 009, 010
  prior verified CLI identity: surgeservicesllc@gmail.com
  current selected CLI profile: unauthorized/wrong account for a fresh recheck; no mutations performed
  exact linked project: qpuofpmagrmyamahqwxw
  current hosted ledger: through 027; pre-027 local and remote history matched
  local pending migration: none
  linked database lint baseline: clean through 026; live 027 behavior verified
  current dry run: up to date; ACL matrix mismatch 0
```

Historical baseline evidence remains useful for regression comparison; current hosted evidence is recorded above.

## Security and production acceptance still required

- Complete the evidence-bound reverse-handoff observation and disconnect/loss/lifecycle handling before retiring primary installation `153445938`. Keep Support ticket `#4660724` as the primary-App webhook defect record.
- Verify a second authenticated tenant plus anonymous/RPC denial through real caller sessions. Only one actual user/email is authorized today; local behavioral tests do not replace the live matrix.
- Verify stale SHA, unapproved/admin protected denial, approval expiry/lease, wrong tenant, renamed/same-name repository, revoked installation, insufficient permission, rate limit, stable retry, ambiguous completion recovery, disconnect/loss, and history preservation. Exact owner approval and likely-secret rejection already pass in the live owner journey.

## Release-blocking invariants

- Any exposed secret/raw audit payload, disabled RLS, direct sensitive-base-table browser read, cross-tenant or mutable-name repository authorization, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, lease reclaim after provider execution, or unapproved/expired protected action is a failure.
- Configuration, tests, provider installation, or Vercel READY status alone cannot be relabeled as a real SoftwareFactory GitHub connection. The current owner connection has separate live callback/read/write/audit evidence; that evidence does not make the webhook Connected or Phase 1B complete.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
- A documentation-only successor does not supersede application/runtime evidence when application code, configuration, schema, and deployment remain unchanged.
