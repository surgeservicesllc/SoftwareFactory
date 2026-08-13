# Quality scorecard

Last reviewed: 2026-08-13

Phase 1B decision: **Application release verified; phase acceptance incomplete**

Reason: hosted migration `026` and owner onboarding pass. Latest installation `153442281` is scoped and App-JWT verified, but the current production callback failed on a nonexistent endpoint; its bounded local fix is unpublished. GitHub/webhook acceptance remains pending.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding; signed-out fetch suppression; active-tenant GitHub boundaries; safe projections; stable repository UUID; protected approval/token/lease integrity; lifecycle/order/recovery; migrations `011`-`026` | Application schema hosted; live acceptance pending |
| Current-tree lint/typecheck/Vitest/build | `npm run check` | Pass - lint/typecheck; 54 files/408 tests; 38 routes |
| Verified application-release integration suite | `npm run test:integration` | Pass - 21 files/163 tests; focused `026` grant test passes separately |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 70.36%, branches 71.34%, functions 62.58%, lines 71.37% |
| Migration `026` | Narrowed exact table grants; function grants unchanged | Pass locally and hosted; local=remote, dry run/lint clean, ACL mismatch count zero |
| Current-tree production build | `npm run check` | Pass - compiled 38 routes on Node 22.23.1; `/` is dynamic |
| Signed-out dashboard regression | Focused browser-error race repeated locally and against production | Pass - 30/30 production runs |
| E2E/responsive/accessibility | Local and exact production Playwright | Pass - 48/48 desktop/tablet/mobile including axe |
| Verified application-release secret/client scan | Source plus rebuilt static artifacts | Pass - zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, last verified `ACTIVE_HEALTHY` | Historical pass |
| Hosted migrations | Current through `026`; local=remote; dry run up to date | Pass |
| Hosted database identity/lint | Exact `qpuofpmagrmyamahqwxw`; linked lint clean | Pass |
| Hosted RLS/catalog/browser grants | 23/23 RLS+FORCE; 32 policies; zero policyless; 22 secret guards; tested raw authenticated/browser grants false | Pass |
| Hosted service-role table grants | SELECT/INSERT/UPDATE on four GitHub ingress tables; no table privileges on other 19; exact matrix mismatch zero | Pass |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Hosted; real caller-session verification pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Hosted via `021`; live rename/same-name acceptance pending |
| Protected-resource writes | Unapproved/admin protected requests fail closed; exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Hosted via `022`; live expiry/role/immutability acceptance pending |
| Draft-commit attribution | Local write boundary strictly validates one server-only deployment identity before authorization/persistence and supplies it as both Contents API author and committer; no App-bot fallback or browser/database/log path | Local implementation; publication, Vercel configuration, and live commit evidence pending |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Application plus migrations `015`/`017`/`022` hosted; live acceptance pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Hosted via migrations `016`/`018`; live acceptance pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Hosted via `019`; real provider-ingress insert/rejection acceptance pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Build and public production checks pass; authenticated verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Published; live-provider/E2E verification pending |
| GitHub App configuration | App ID `4573846`; server-only variable names configured | Configuration evidence only |
| Supabase Auth owner | `surgeservicesllc@gmail.com` confirmed/authenticated; SoftwareFactory org/workspace owner onboarding succeeded | Pass for onboarding |
| GitHub provider installation | Latest installation `153442281`, App-JWT verified on `surgeservicesllc`, only `surgeservicesllc/SoftwareFactory` selected | Provider scope passes; callback does not |
| GitHub real connection | Production used nonexistent `GET /user/installations/{id}`; local bounded list/exact-ID patch unpublished | **Not Connected** |
| GitHub webhook | Route implemented; active hook/valid signed production delivery absent | **Not Connected** |
| Project/repository and file-to-draft-PR flow | Code/tests exist; real journey absent | Pending live acceptance |
| Git provenance for application release | Commit `edaaf625c497380611b80092526926b1457e15a0`, tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4`, author/committer `surgeservicesllc@gmail.com`; CI run `31694775758`, both jobs green | Pass; docs-only successors retain this evidence unless application code changes |
| Vercel production | `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77`; `https://softwarefactory-nd3orq8r6-surgeservices-projects.vercel.app`; stable alias; source `main` `3434387` | READY; callback patch not deployed |
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
  current CLI identity: surgeservicesllc@gmail.com
  exact linked project: qpuofpmagrmyamahqwxw
  current ledger: through 026; local and remote match
  linked database lint: clean through 026
  current dry run: up to date; ACL matrix mismatch 0
```

Historical baseline evidence remains useful for regression comparison; current hosted evidence is recorded above.

## Security and production acceptance still required

- Complete a real authenticated production session and the entire GitHub callback/token/repository/project/read/edit/draft-PR/disconnect journey.
- Observe valid, invalid, duplicate, stale, out-of-order, deletion, and restore webhook deliveries in production.
- Verify stale SHA, unapproved/admin protected denial, exact owner approval/expiry/lease, likely secret, wrong tenant, renamed/same-name repository, revoked installation, insufficient permission, rate limit, stable retry, and ambiguous completion recovery.
- Verify the exact owner-approved deployment identity is configured server-side and appears as both author and committer on the real draft commit.
- Record authenticated provider acceptance evidence against an exact verified deployment.

## Release-blocking invariants

- Any exposed secret/raw audit payload, disabled RLS, direct sensitive-base-table browser read, cross-tenant or mutable-name repository authorization, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, lease reclaim after provider execution, or unapproved/expired protected action is a failure.
- Configuration, tests, provider installation, or Vercel READY status cannot be relabeled as a real SoftwareFactory GitHub connection.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
- A documentation-only successor does not supersede application/runtime evidence when application code, configuration, schema, and deployment remain unchanged.
