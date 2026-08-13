# Quality scorecard

Last reviewed: 2026-08-13

Phase 1B decision: **Application release verified; phase acceptance incomplete**

Reason: hosted migration `026`, owner onboarding, installation `153445938`, real connection/project/reads, ordinary/protected draft-only writes, secret rejection, commit attribution, and immutable Activity evidence pass. The provider webhook remains **Not Connected**, and the live second-tenant plus remaining failure/disconnect matrix is incomplete.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding; signed-out fetch suppression; active-tenant GitHub boundaries; safe projections; stable repository UUID; protected approval/token/lease integrity; lifecycle/order/recovery; migrations `011`-`026` | Application/schema hosted; owner live path passes; remaining acceptance pending |
| Current-tree lint/typecheck/Vitest/build | `npm run check` | Pass - lint/typecheck; 54 files/408 tests; 38 routes |
| Verified application-release integration suite | `npm run test:integration` | Pass - 21 files/163 tests; focused `026` grant test passes separately |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 70.36%, branches 71.34%, functions 62.58%, lines 71.37% |
| Migration `026` | Narrowed exact table grants; function grants unchanged | Pass locally and hosted; local=remote, dry run/lint clean, ACL mismatch count zero |
| Current-tree production build | `npm run check` | Pass - compiled 38 routes on Node 22.23.1; `/` is dynamic |
| Signed-out dashboard regression | Focused browser-error race repeated locally and against production | Retained pass - 30/30 production runs; current exact-commit CI is green |
| E2E/responsive/accessibility | Exact-`0bd0485` production Playwright plus current exact-commit CI browser job | Pass - post-rotation production 48/48 desktop/tablet/mobile including axe; current CI green |
| Verified application-release secret/client scan | Source plus rebuilt static artifacts | Pass - zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, last verified `ACTIVE_HEALTHY`; currently selected local CLI profile is wrong/unauthorized for a fresh recheck and was not used for mutations | Prior hosted evidence remains recorded; reauthentication required before a new linked check |
| Hosted migrations | Current through `026`; local=remote; dry run up to date | Pass |
| Hosted database identity/lint | Exact `qpuofpmagrmyamahqwxw`; linked lint clean | Pass |
| Hosted RLS/catalog/browser grants | 23/23 RLS+FORCE; 32 policies; zero policyless; 22 secret guards; tested raw authenticated/browser grants false | Pass |
| Hosted service-role table grants | SELECT/INSERT/UPDATE on four GitHub ingress tables; no table privileges on other 19; exact matrix mismatch zero | Pass |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Hosted; owner Activity caller path passes; live second-tenant matrix pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Hosted via `021`; live rename/same-name acceptance pending |
| Protected-resource writes | Exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Live protected draft PR `#7` and immutable approval/provider evidence pass; live expiry/admin-denial matrix pending |
| Draft-commit attribution | Deployed boundary strictly validates one server-only deployment identity before authorization/persistence and supplies it as both Contents API author and committer; no App-bot fallback or browser/database/log path | Pass - Production/Preview configured; draft commits `e789303` and `6a808de` verify both fields as `surgeservicesllc <surgeservicesllc@gmail.com>` |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Application plus migrations `015`/`017`/`022` hosted; live acceptance pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Hosted via migrations `016`/`018`; live acceptance pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Hosted via `019`; real provider-ingress insert/rejection acceptance pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Build and public production checks pass; authenticated verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Pass against the live selected repository |
| GitHub App configuration | App ID `4573846`; server-only variable names configured; commit-identity names configured for Production/Preview | Configuration plus live commit evidence |
| Supabase Auth owner | `surgeservicesllc@gmail.com` confirmed/authenticated; SoftwareFactory org/workspace owner onboarding succeeded | Pass for onboarding |
| GitHub provider installation | Installation `153445938`, connected to `surgeservicesllc`, exactly `surgeservicesllc/SoftwareFactory` selected | Pass |
| GitHub real connection | Connection `d17c63a9-d995-481e-98ce-b737efb32ce5`; project `b1f23696-437e-4d89-b55f-d7a949980e8f`; callback/sync/read/audit journey observed | Connected for the owner repository path |
| GitHub webhook | Fresh secret in Sensitive Production/Preview; invalid signatures return `401`/no-store; owner UI reports update but reloads blank/inactive; documented App-JWT `PATCH /app/hook/config` returns `404`; GitHub Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724), **GitHub App 4573846 cannot retain its single webhook**, was submitted 2026-08-13 under `surgeservicesllc` and is OPEN; no valid signed delivery exists | **Not Connected** |
| Local credential cleanup | Temporary downloaded App PEM and ignored provider-verification helper scripts deleted after use; no credential/helper artifact persisted | Pass |
| Project/repository and file-to-draft-PR flow | Live branches/commits/checks/PRs/tree/README reads; ordinary draft `#6`; protected RED draft `#7`; likely-secret rejection; immutable Activity evidence | Pass for accepted owner scenarios; remaining adverse matrix pending |
| Acceptance cleanup | Wrong-App-bot attribution on prior draft PRs `#4`/`#5` was detected; both PRs closed unmerged and isolated branches deleted; `main` unchanged | Pass |
| Git provenance for application release | Commit `0bd048565a9e002848c5553ccbe43ab0e217780e`, tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31704289754`, both jobs green | Pass; docs-only successors retain this evidence unless application code changes |
| Vercel production | `dpl_AEirYPnCrKemJjiFX7bKGc7626jX`; `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app`; stable alias; source exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e` | READY; production Playwright 48/48; nine JavaScript assets have zero forbidden markers; recent logs have zero errors |
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
  current ledger: through 026; local and remote match
  linked database lint: clean through 026
  current dry run: up to date; ACL matrix mismatch 0
```

Historical baseline evidence remains useful for regression comparison; current hosted evidence is recorded above.

## Security and production acceptance still required

- Wait for GitHub repair under OPEN Support ticket `#4660724`, then make the App retain the active webhook endpoint and observe a valid signed production delivery plus duplicate, stale, out-of-order, deletion, and restore handling. Invalid-signature rejection already passes.
- Verify a second authenticated tenant plus anonymous/RPC denial through real caller sessions. Only one actual user/email is authorized today; local behavioral tests do not replace the live matrix.
- Verify stale SHA, unapproved/admin protected denial, approval expiry/lease, wrong tenant, renamed/same-name repository, revoked installation, insufficient permission, rate limit, stable retry, ambiguous completion recovery, disconnect/loss, and history preservation. Exact owner approval and likely-secret rejection already pass in the live owner journey.

## Release-blocking invariants

- Any exposed secret/raw audit payload, disabled RLS, direct sensitive-base-table browser read, cross-tenant or mutable-name repository authorization, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, lease reclaim after provider execution, or unapproved/expired protected action is a failure.
- Configuration, tests, provider installation, or Vercel READY status alone cannot be relabeled as a real SoftwareFactory GitHub connection. The current owner connection has separate live callback/read/write/audit evidence; that evidence does not make the webhook Connected or Phase 1B complete.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
- A documentation-only successor does not supersede application/runtime evidence when application code, configuration, schema, and deployment remain unchanged.
