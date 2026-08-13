# Quality scorecard

Last reviewed: 2026-08-13

Phase 1B decision: **Not release-ready yet**

Reason: local lint, typecheck, 52 files/392 tests, coverage, production build, production-server Playwright 48/48, and final source/rebuilt-static secret scans pass. Publication/deployment, hosted migrations `011`-`025`, hosted authenticated tenant behavior, in-product GitHub callback/connection, active webhook delivery, and the complete live provider journey remain pending.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding; active-tenant GitHub boundaries; safe tenant/activity projections; raw Activity/webhook read closure; stable repository UUID binding/relink locking; protected RED approval/token/lease integrity; generic secret assignments; retry-safe draft-PR flow; lifecycle ordering; Projects provider detail; same-origin/CSP; local migrations `011`-`025` | Implemented locally; publication and live acceptance pending |
| Current-tree lint/typecheck/Vitest | `npm run check` | Pass - lint/typecheck; 52 files/392 tests |
| Current-tree integration suite | `npm run test:integration` | Pass - 21 files/163 tests |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 70.36% (603/857), branches 71.34% (488/684), functions 62.58% (97/155), lines 71.37% (566/793) |
| Current-tree migration chain | Full chain through migration `025` | Pass in the complete suite; hosted behavior pending |
| Current-tree production build | `npm run check` | Pass - compiled and generated 38 static routes on Node 22.23.1 |
| Current-tree E2E/responsive/accessibility | Production-server Playwright | Pass - 48/48 desktop/tablet/mobile including axe |
| Current-tree secret/client scan | Source plus rebuilt static artifacts | Pass - zero actual credential candidates, zero privileged/static marker matches, zero unexpected sensitive files; one benign Vercel environment identifier reviewed |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, last verified `ACTIVE_HEALTHY` | Historical pass |
| Hosted migrations | Hosted ledger through `010` | Pass through `010` only |
| Local migrations `011`-`025` | Authorization/grants, audit, reconciliation, recovery/order, CHECK helper, safe tenant/Activity lists, raw Activity/webhook denial, stable repository binding/relink locking, protected approval/token/lease integrity, generic secret assignments | Local only; exact owner approval/application/post-apply verification pending |
| Hosted database identity/lint | CLI `surgeservicesllc@gmail.com`, exact `qpuofpmagrmyamahqwxw`; ledger through `010`; linked lint clean; dry run only `011`-`024` before `025` existed | Full-chain dry run blocked by database login-role `403`; application pending |
| Hosted RLS catalog | Prior 22 tables / 22 RLS / 22 FORCE RLS / 43 policies / 22 secret guards | Catalog evidence retained; current authenticated behavior pending |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Implemented locally via `020`/`023`; hosted/privacy verification pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Implemented locally via `021`; hosted/live rename/same-name verification pending |
| Protected-resource writes | Unapproved/admin protected requests fail closed; exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Implemented locally via `022`; hosted/live expiry/role/immutability verification pending |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Implemented locally via application + migrations `015`/`017`/`022`; hosted/live verification pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Implemented locally via migrations `016`/`018`; hosted/live verification pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Implemented locally via `019`; hosted verification pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Implemented locally; build/browser verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Implemented locally; live-provider/E2E verification pending |
| GitHub App configuration | App ID `4573846`; server-only variable names configured | Configuration evidence only |
| GitHub provider installation | Personal `surgeservicesllc` installation `153286187`, selected only for `surgeservicesllc/SoftwareFactory` | Provider-scope evidence only; webhook blank/inactive |
| GitHub real connection | Authenticated SoftwareFactory callback/tenant connection/token/repository sync | **Not Connected** |
| GitHub webhook | Route implemented; active hook/valid signed production delivery absent | **Not Connected** |
| Project/repository and file-to-draft-PR flow | Code/tests exist; real journey absent | Pending live acceptance |
| Git/main provenance for this increment | Working tree not yet committed/pushed | Pending |
| Vercel production for this increment | Exact `surgeservices-projects/softwarefactory` linked; encrypted environment names present; no exact matching verified deployment yet | Pending |
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
  applied ledger: 001, 002, 003, 004, 005, 007, 008, 009, 010
  current CLI identity: surgeservicesllc@gmail.com
  exact linked project: qpuofpmagrmyamahqwxw
  linked database lint: clean against hosted ledger through 010
  dry run: 011-024 only, before 025 existed; no application
```

Historical baseline evidence remains useful for regression comparison but cannot be relabeled as verification of migrations `011`-`025` in hosted production or a future deployment.

## Security and production acceptance still required

- Apply migrations `011`-`025` only after exact owner approval and a full-chain dry run; verify all grants/search paths, RLS/FORCE RLS, base-table column secrecy, raw Activity/webhook denial, safe list RPCs, stable repository binding/relink concurrency, protected approval/token/lease constraints, generic assignment handling, two-tenant/anonymous denial, provider-ingress CHECK evaluation, actor attribution, immutable/bounded/redacted activity, lifecycle ordering, and recovery behavior.
- Complete a real authenticated production session and the entire GitHub callback/token/repository/project/read/edit/draft-PR/disconnect journey.
- Observe valid, invalid, duplicate, stale, out-of-order, deletion, and restore webhook deliveries in production.
- Verify stale SHA, unapproved/admin protected denial, exact owner approval/expiry/lease, likely secret, wrong tenant, renamed/same-name repository, revoked installation, insufficient permission, rate limit, stable retry, and ambiguous completion recovery.
- Record exact commit, CI run, Vercel deployment/alias, production HTTP/E2E/log checks, and provider acceptance.

## Release-blocking invariants

- Any exposed secret/raw audit payload, disabled RLS, direct sensitive-base-table browser read, cross-tenant or mutable-name repository authorization, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, lease reclaim after provider execution, or unapproved/expired protected action is a failure.
- Configuration, tests, provider installation, or Vercel READY status cannot be relabeled as a real SoftwareFactory GitHub connection.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
