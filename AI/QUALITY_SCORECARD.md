# Quality scorecard

Last reviewed: 2026-08-13

Decision: **Phase 2A provider source is published on main and Phase 1C is a local reconciled candidate; the hosted schema is ahead of an inconsistent migration ledger, so protected reconciliation and live acceptance remain blocked. Provider execution and OpenAI/Codex remain Not Connected.**

Reason: main contains the Phase 1E operations and synthetic journeys, Phase 2A Anthropic/OpenAI advisory-provider layer, universal bot-fabric registry, marketing site, and separated route groups, while the reconciled tree adds the supported Codex SDK worker and exact repository binding. Read-only hosted evidence shows post-`027` objects but exactly 26 ledger rows through `027`, so the database requires owner-approved history reconciliation before Phase 1C promotion. No real production monitor or synthetic journey, bot/provider request, or Codex execution exists; both provider/worker execution switches remain OFF, Actions secrets/variable are absent, and there is no active heartbeat or live Codex thread/draft PR/required-CI evidence. Passing local tests cannot close those gaps.

Phase 1E decision: **Production-operations control plane implemented and locally verified; unhosted and unobserved, so no live monitoring claim is made**

Reason: migration `028` adds ten RLS/FORCE-RLS operations tables and owner-scoped workflows with zero new `service_role` table privileges, and the detection-to-resolution pipeline is proven against the real migrated schema. Migration `028` is **not** applied to hosted Supabase and no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown**. Rollback and repair execution remain absent by design.

Phase 1D decision: **Decision layer complete and proven against a migrated database; every automatic action remains constrained OFF and no executor exists**

Reason: the unhosted Phase 1D control migration completes the nine-action control model at both an organization and a project scope, extends both interlocks to cover the new columns, and relaxes nothing — every flag is created `false`, constrained `false`, and refused by the trigger. The decision modules classify an actual diff, require the correct gate set, run three deterministic reviewing agents, and return the approval tri-state with an absolute no-self-approval rule. Merge, deploy and autonomous Codex execution are reached, evaluated, and blocked by name. The migration must retain a unique reviewed version in the final chain and is **not** applied to hosted Supabase.

### Phase 1D completion

| Objective area | Completion | Note |
| --- | --- | --- |
| Controls (9 actions, 2 scopes, most-restrictive-wins, emergency STOP) | **100%** | STOP and freeze were already Phase 1E; this phase added the missing five actions, the organization scope, and the resolver |
| Risk classification, before work and on the final diff | **100%** | Derived from paths and content; escalation past a declaration blocks |
| Gates (GREEN set, YELLOW set, blocking findings) | **100%** | A missing result blocks; `not_connected` distinct from `not_run` |
| Review / QA / Security agents | **100%** as deterministic analysers | Model-backed review needs Phase 1C/2A binding, which this phase does not claim |
| Approval (tri-state, no self-approval) | **100%** | Evaluated after the gates; unsound work is never escalated to a person |
| Orchestrator stage machine | **100%** as a decision machine | Twelve stages, halts at the first block |
| Deploy / preview / validate | **Validate 100% (Phase 1E); deploy and preview 0%** | **Blocked** — no Vercel API connection |
| Rollback | **Decision 100% (Phase 1E); execution 0%** | **Blocked** — no adapter; `AUTO_ROLLBACK.md` disables it |
| Healing / repair | **Creation 100% (Phase 1E); execution 0%** | **Blocked** — the manual Phase 1C candidate is **Not Connected** and grants no autonomous authority |
| Auto merge | **0%** | **Blocked** — `AGENTS.md` forbids introducing the workflow in this line of phases |
| Backlog Autopilot | **0%** | **Blocked** — depends on the two rows above |
| Enabling any automatic action | **0% by design** | RED under `RISK_CLASSIFICATION.md`; needs an owner-approved migration |

## Phase 1E and retained Phase 1B evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Phase 1D gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` | Pass - lint/typecheck; 90 files/986 tests; 97 build entries |
| Phase 1D E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe | Pass - 117/117 |
| Phase 1D control interlocks | `tests/integration/phase1d-autonomy-controls.behavior.test.ts` against the migrated schema | Pass - 35 tests: each of nine actions refused at each of two scopes, both ceilings, both mode flags, the kill switch, and a new project or organization trying to be born with authority; both constraints `convalidated`; `anon` holds no write |
| Phase 1D decision modules | `tests/unit/autonomy-*.test.ts` | Pass - 91 tests across controls, diff risk, gates, agents, approval, and the stage machine |
| Phase 1D end-to-end loop | `tests/integration/phase1d-loop-journey.behavior.test.ts` | Pass - a GREEN change reaches `APPROVED_AUTOMATICALLY` and then halts at `MERGE_EXECUTOR_NOT_CONNECTED`; a failed release drives incident, automatic freeze, Last Known Good, blocked rollback and bounded repair through Phase 1E's real functions, and the freeze is shown propagating back into the decision layer |
| Phase 1D self-approval boundary | Same journey plus `tests/unit/autonomy-approval.test.ts` | Pass - the author is refused as approver at every risk level, including RED and including an owner |
| Phase 1D hosted state | Hosted Supabase is current through `027` | **Not applied** - migration `20260813000500` is unhosted |

| Phase 1E gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` on the Phase 1E tree | Pass - lint/typecheck; 82 files/819 tests on the merged tree |
| Phase 1E coverage | `npm run test:coverage` | Pass - merged tree with Phase 2A: statements 72.94%, branches 69.92%, functions 64.57%, lines 74.29%. The Phase 1E tree alone measured 78.02/77.79/70.00/79.15 |
| Phase 1E E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe, `/solutions/operations` included | Pass - 117/117 on the merged tree |
| Phase 1E detection pipeline | `tests/integration/phase1e-operations.behavior.test.ts` against the migrated schema | Pass - 30 tests: threshold detection, dedupe, upward-only severity, automatic freeze, owner-only resume, Last Known Good, blocked/failed rollback, bounded repairs, resolution gating, event idempotency, RLS, append-only |
| Phase 1E end-to-end journey | `tests/integration/phase1e-incident-journey.behavior.test.ts` | Pass - ordered Monitor→Detect→Incident→Freeze→Rollback→Diagnose→Repair→Validate→Resolve, plus failed-rollback escalation to SEV1; Codex-fix and deploy stages asserted as blocked, not simulated |
| Phase 1E boundary contracts | `tests/integration/phase1e-operations.contract.test.ts` | Pass - 18 tests: same-origin and role checks on every mutation, execution envelope on every response, no provider deployment call, no new `service_role` table grants, Phase 1D interlocks preserved |
| Phase 1E privilege boundary | Post-`028` grant assertions in the behavioral and hosted-grant suites | Pass - `service_role` still holds table privileges on exactly the four GitHub ingress tables; 53/53 public tables have RLS and FORCE RLS |
| Phase 1E monitoring truth | `production_monitors_enabled_requires_connection`; provider registry; probe target validation | Pass - an unconnected monitor cannot be enabled; private/loopback/metadata targets are refused; no response body is read |
| Phase 1E execution boundary | `autonomous_release_allowed`; `PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED`; `PHASE_1E_REPAIR_WORKER_CONNECTED` | Pass - release authority returns false unconditionally with `EXECUTOR_NOT_CONNECTED`; no rollback, deployment, merge, or repair is executed |
| Phase 1E synthetic journeys | Database CHECK constraints plus `tests/unit/operations-journey.test.ts` and the behavioral suite | Pass - destructive paths, undeclared writes, and uncovered profiles are refused by constraint; execution stops at the first failure; declared writes are recorded as skipped and never issued |
| Phase 1E hosted state | Hosted Supabase is current through `027` | **Not applied** - migrations `028` and `130002` are unhosted and no production target or journey has been observed |
| Phase 1E release | Merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0` on `main`; CI run [`31731632715`](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31731632715) | Pass - both jobs green: lint/typecheck/tests/build, and browser/accessibility. Vercel Preview for the merged head deployed READY before the merge. |
| `/solutions` routing | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build`, Playwright; plus live checks against `https://www.theagoras.com` | Pass - lint/typecheck; 83 files/824 tests; build lists twelve `/solutions` routes; Playwright 117/117 with axe on each moved page. Live: all twelve pages `200` with both landmarks and the shell offset, every former path `308` to its new home, `/solutions` `noindex` and disallowed |
| `/solutions` routing contract | `tests/integration/console-routing.contract.test.ts` | Pass - 5 tests: no stray `app/(console)` group, a redirect for every console route, `/solutions` disallowed, no sitemap entry contradicting robots, a title on every console page. The sitemap assertion was mutation-checked |
| Scope/implementation | Auth/onboarding; signed-out fetch suppression; active-tenant GitHub boundaries; safe projections; stable repository UUID; protected approval/token/lease integrity; lifecycle/order/recovery; dual-App handoff; migrations `011`-`027` | Application/schema hosted; candidate owner path passes; remaining acceptance pending |
| Cutover-tree lint/typecheck/Vitest/build | `npm run check` plus main CI | Pass - lint/typecheck; 56 files/436 tests; 38 routes; CI `31716263910` green |
| Dual-App replacement boundary | Isolated candidate config; state binds App slot/ID; token routing uses persisted installation App ID; webhook verifies signing App provenance | Deployed and live for candidate installation `153479019` |
| Migration `027` atomic handoff | Immutable exact-tuple owner RED approval/execution; same account/external repository; both installations live; post-sync processed signed target delivery; cross-App/pending-change serialization; preserved history; bounded reverse | Hosted and live handoff passed |
| Hosted handoff database audit | Candidate sync `2026-08-13T15:26:56Z`; earliest qualifying delivery `2026-08-13T15:27:38Z` with exact App ID; immutable RED same-owner approval/execution succeeded; three request/approved/completed events; append-only triggers enabled; old installation/repository retained | Pass - project/link rebound to candidate while four completed change requests and five prior activity rows remain |
| Verified application-release integration suite | `npm run test:integration` | Pass - 21 files/163 tests; focused `026` grant test passes separately |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 72.37%, branches 66.79%, functions 68.80%, lines 74.13% |
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
| OpenAI/Codex | No live worker; Phase 1C exists only in the local reconciled candidate | **Not Connected** |
| Anthropic/Claude | Advisory adapter source exists; no hosted schema, verified credential, enabled switch, or live run | **Not Connected** |
| Automation safety | No merge/deploy/rollback executor; controls OFF | Pass |
| Phase 1D observation scaffold | Autonomous Mode OFF, GREEN-only observation, global kill switch ON | Execution remains blocked |

## Phase 2A and Phase 1C reconciliation evidence

| Area | Current evidence | Status |
| --- | --- | --- |
| Command/orchestration | Connected-project-only intent; command type/criteria; stable idempotency; exact base SHA; fixed provider/model/role/budgets/workflow; independent SQL risk/config enforcement | Implemented locally |
| Phase 2A advisory providers | Official Anthropic/OpenAI adapters; health/model discovery; deterministic routing; bounded fallback; independent review; advisory artifacts only | Published on main; `130001` unhosted; keys/live run absent; execution OFF; **Not Connected** |
| RED ceiling | SQL and worker exclude RED; owner approval does not widen Phase 1C | Implemented locally; hosted proof pending |
| Durable schema | Provider layer `130001`; synthetic journeys `130002`; bot fabric `130003`/`130004`; marketing `130005`; Phase 1C enum-only `130006`; execution `130007`; roster/recovery/report/provider-ACL hardening `130008` | Implemented in source; all eight **UNHOSTED** |
| Logical agent identity | Eleven standard logical roles for existing/future organizations; provider-account identity remains separate; general Phase 1C work maps to Orchestrator | Implemented in `130008`; hosted proof pending |
| Recovery/report integrity | Coherent artifact replay, draft projection, bounded retry/resume, stale-lease/cancel terminalization, structured success/failure/cancellation reports | Implemented in `130008`; hosted/live proof pending |
| RLS/ACL | New tables declare RLS/FORCE RLS; browser table grants revoked; bounded member RPCs and service-role-only worker RPCs | Contract/behavior tests local; hosted catalog/user-session proof pending |
| Codex integration | Pinned `@openai/codex-sdk` `0.147.0`; isolated home; bounded turns/tokens/time; workspace-write/no approval/no workspace network/web search | Implemented locally; no real provider call |
| Workspace/GitHub | Repository-ID token; exact base-SHA check; isolated `factory/*` branch; required commit identity; draft-PR-only publisher; exact-head CI polling | Implemented/tested locally; no live Phase 1C artifact |
| Validation sandbox | Exact pinned Node image; restricted bootstrap; network-none diff/lint/typecheck/test/build; process/resource/output limits | Implemented/tested locally; live runner proof pending |
| Policy scan | Path containment; forbidden/symlink/binary/secret/protected/file-count/size limits | Implemented/tested locally |
| Durable worker workflow | Opaque repository dispatch, five-minute recovery, no branch-selectable manual trigger, read-only workflow token, no persisted checkout credentials | Implemented locally; protected secrets/workflow run pending |
| Safe UI/APIs | Worker status, agent/task/run/report detail, timelines/artifacts/validation, cancel, retry, responsive real-data consoles | Implemented locally; hosted authenticated/E2E proof pending |
| Consolidated lint/typecheck/tests/build | Exact reconciled Phase 1E/2A/bot/marketing/1C tree | Pass on Node `24.19.0`: 97 files/959 tests and production build with 62/62 page-data entries |
| Consolidated coverage | Exact reconciled tree | Pass - 72.37% statements / 66.79% branches / 68.80% functions / 74.13% lines |
| Secret/tracked-file/client scan | Exact reconciled production source and `.next/static` | Pass - 0 high-confidence credential values; one client-bundle match is an allowlisted environment-variable reference label, not a value |
| Responsive/E2E/axe | Exact reconciled desktop/tablet/mobile against production build | Pass - 117/117 |
| Production dependency audit | Exact reconciled `npm audit --omit=dev` | Pass - 0 vulnerabilities |
| Disabled worker smoke | Exact reconciled worker disabled/incomplete configuration | Pass - exits safely without executing |
| Diff and independent severity audit | Exact reconciled tree | Pass - diff check clean except line-ending notices; focused migration/API security audits found no remaining P0/P1 blocker |
| Hosted migrations | Exact project `qpuofpmagrmyamahqwxw` | Through `027`; Phase 1E `028` and `130001` through `130008` unhosted |
| GitHub Actions secrets | Seven required `SOFTWAREFACTORY_*` secrets | **Not Connected / not verified configured** |
| Worker activation gate | Repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` | Not verified enabled; absent/false skips all jobs |
| Required CI checks | `SOFTWAREFACTORY_REQUIRED_CHECKS` exact names for both CI jobs; complete stable set; required conclusions `success`; PR base/head recheck | Implemented locally; live proof pending |
| Worker heartbeat | Fresh service-role worker registration/heartbeat | None; **Not Connected** |
| Live Codex acceptance | Real command/thread/branch/commit/draft PR/validation/exact-head CI/report/audit | None; blocking |
| Autonomous safety | Kill switch ON; Autonomous Mode and auto approve/merge/deploy/rollback OFF | Pass by design; hosted `010` retained |
| Commit identity | `surgeservicesllc <surgeservicesllc@gmail.com>` required for author/committer | Enforced in worker/workflow; live Phase 1C proof pending |

## Retained Phase 1B live evidence

- Candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, signed webhook, handoff, reads, and prior draft-only write acceptance pass for exactly `surgeservicesllc/SoftwareFactory`.
- Primary installation `153445938` remains rollback; its webhook defect remains tracked by GitHub Support `#4660724`.
- Prior application release `799d2cea189b6860a03987ae75c25765f9ac4aca` passed CI run `31716263910` and is READY as Vercel deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`. It predates the Phase 2A and Phase 1E main integrations and does not contain the local Phase 1C tree.
- Phase 1B still lacks a live second tenant, reverse handoff, disconnect/loss, and remaining adverse provider matrix.

## Phase 1C release acceptance required

1. Complete a fresh consolidated gate run on the exact reconciled Phase 1E/Phase 2A/Phase 1C release tree.
2. Exact owner RED approval for hosted migration `028` and migrations `130001` through `130008`, protected Actions secret configuration, disabled publication, activation window, and one bounded live run.
3. Hosted migration history/lint/RLS/FORCE RLS/policy/ACL/function/secret/append-only checks plus real owner/cross-tenant/anonymous RPC behavior.
4. Verified presence (not values) of these Actions secrets: `SOFTWAREFACTORY_SUPABASE_URL`, `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`, `SOFTWAREFACTORY_OPENAI_API_KEY`, `SOFTWAREFACTORY_GITHUB_APP_ID`, `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`, `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`, `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`.
5. Verify `SOFTWAREFACTORY_REQUIRED_CHECKS` exactly matches both CI job names and keep activation absent/false while publishing the exact reviewed default-branch commit and verifying matching green CI/Vercel deployment.
6. Set `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true` only under the approved bounded window. The secret-bearing workflow has no branch-selectable manual dispatch.
7. Submit one real manual GREEN owner command so the approved default-branch repository dispatch (or scheduled recovery) starts the worker; observe a fresh active heartbeat during execution and require stable exact-head success for both named checks.
8. Restore activation absent/false after acceptance unless continued authority is separately approved.
9. Durable evidence for repository/base SHA, neutral logical agent, lease, recovery state, timeline, validation, artifacts, changed paths, usage, structured report, activity, cancellation state, and final result.
10. Proof that no default-branch write, PR approval/merge, deployment, rollback, RED execution, workflow/provider-setting change, or secret disclosure occurred.

## Release-blocking invariants

- Configuration, source code, a queued row, a mocked SDK result, or a GitHub Actions file never counts as Connected.
- A clean idle one-shot heartbeat is briefly Available/Connected while fresh; stale, explicitly disabled, or missing heartbeat state is **Not Connected**. Idle availability is not end-to-end run proof.
- Missing or inconclusive validation/CI is failure, not success.
- RED, protected-without-exact-approval, secret-bearing, stale-base, cross-tenant, lease-mismatched, or oversized work must fail closed.
- Any browser exposure of raw command/model/provider errors, service credentials, raw audit details, or broad worker tables is a failure.
- Any default-branch write, non-draft PR, approval, merge, deploy, rollback, workflow/provider administration, or Autonomous Mode widening is a failure.
- A code/schema/provider/deployment change invalidates affected evidence and requires rerunning it.
