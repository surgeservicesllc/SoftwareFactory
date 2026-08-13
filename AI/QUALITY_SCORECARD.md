# Quality scorecard

Last reviewed: 2026-08-13

Phase 1B decision: **Published production snapshot verified; local follow-up and phase acceptance incomplete**

Reason: the published `7d22de6` snapshot, both CI jobs, and its exact Vercel production deployment/public acceptance pass. A signed-out dashboard follow-up passes `npm run check` at 53 files/394 tests, current coverage, local Playwright 48/48, a focused 30/30 regression, and current source/rebuilt-static scanning, but still needs publication, CI, and exact deployed verification. Hosted migrations `011`-`025`, hosted authenticated tenant behavior, in-product GitHub callback/connection, active webhook delivery, and the complete live provider journey remain pending.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope/implementation | Auth/onboarding; active-tenant GitHub boundaries; safe tenant/activity projections; raw Activity/webhook read closure; stable repository UUID binding/relink locking; protected RED approval/token/lease integrity; generic secret assignments; retry-safe draft-PR flow; lifecycle ordering; Projects provider detail; same-origin/CSP; repository migrations `011`-`025` | Base snapshot published/deployed; signed-out dashboard follow-up local; hosted schema promotion and live acceptance pending |
| Current-tree lint/typecheck/Vitest | `npm run check` | Pass - lint/typecheck; 53 files/394 tests |
| Current-tree integration suite | `npm run test:integration` | Pass - 21 files/163 tests |
| Current-tree coverage | `npm run test:coverage` | Pass - 53 files/394 tests; statements 70.36% (603/857), branches 71.34% (488/684), functions 62.58% (97/155), lines 71.37% (566/793) |
| Current-tree migration chain | Full chain through migration `025` | Pass in the complete suite; hosted behavior pending |
| Current-tree production build | `npm run check` | Pass - compiled 38 routes on Node 22.23.1; `/` is dynamic |
| Signed-out dashboard regression | Focused browser-error test repeated | Pass - 30/30 local runs |
| Current-tree E2E/responsive/accessibility | Local production-server Playwright | Pass - 48/48 desktop/tablet/mobile including axe; exact deployed follow-up verification pending |
| Current-tree secret/client scan | Source plus rebuilt static artifacts | Pass - zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present |
| Hosted Supabase identity | `qpuofpmagrmyamahqwxw`, last verified `ACTIVE_HEALTHY` | Historical pass |
| Hosted migrations | Hosted ledger through `010` | Pass through `010` only |
| Repository migrations `011`-`025` | Authorization/grants, audit, reconciliation, recovery/order, CHECK helper, safe tenant/Activity lists, raw Activity/webhook denial, stable repository binding/relink locking, protected approval/token/lease integrity, generic secret assignments | Published but unhosted; exact owner approval/application/post-apply verification pending |
| Hosted database identity/lint | CLI `surgeservicesllc@gmail.com`, exact `qpuofpmagrmyamahqwxw`; ledger through `010`; linked lint clean; complete `011`-`025` dry run succeeds and applies nothing | Pass for dry run/lint; application pending exact approval |
| Hosted RLS catalog | Prior 22 tables / 22 RLS / 22 FORCE RLS / 43 policies / 22 secret guards | Catalog evidence retained; current authenticated behavior pending |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Published via `020`/`023`; hosted/privacy verification pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Published via `021`; hosted/live rename/same-name verification pending |
| Protected-resource writes | Unapproved/admin protected requests fail closed; exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Published via `022`; hosted/live expiry/role/immutability verification pending |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Published via application + migrations `015`/`017`/`022`; hosted/live verification pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Published via migrations `016`/`018`; hosted/live verification pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Published via `019`; hosted verification pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Build and public production checks pass; authenticated verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Published; live-provider/E2E verification pending |
| GitHub App configuration | App ID `4573846`; server-only variable names configured | Configuration evidence only |
| GitHub provider installation | Personal `surgeservicesllc` installation `153286187`, selected only for `surgeservicesllc/SoftwareFactory` | Provider-scope evidence only; webhook blank/inactive |
| GitHub real connection | Authenticated SoftwareFactory callback/tenant connection/token/repository sync | **Not Connected** |
| GitHub webhook | Route implemented; active hook/valid signed production delivery absent | **Not Connected** |
| Project/repository and file-to-draft-PR flow | Code/tests exist; real journey absent | Pending live acceptance |
| Git/main provenance for published snapshot | Commit `7d22de665813d119488b4a26b0cd4084070b3eaa`, tree `9ede78e7d5c4f28269a0a11dc1a4e381c53a3772`, author/committer `surgeservicesllc@gmail.com`; CI run `31692336607`, both jobs green | Pass; local follow-up publication pending |
| Vercel production for published snapshot | Exact project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`; READY deployment `dpl_6Aiygdb9r1B4PCUefLahBKgadAHb` for exact SHA; immutable URL plus stable alias; production Playwright 48/48, security/API/client/log checks pass | Pass for snapshot's public release scope; local follow-up and authenticated integrations pending |
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
  current dry run: complete 011-025 chain succeeds; no application
```

Historical baseline evidence remains useful for regression comparison but cannot be relabeled as verification of migrations `011`-`025` in hosted production.

## Security and production acceptance still required

- Apply migrations `011`-`025` only after exact owner approval and a full-chain dry run; verify all grants/search paths, RLS/FORCE RLS, base-table column secrecy, raw Activity/webhook denial, safe list RPCs, stable repository binding/relink concurrency, protected approval/token/lease constraints, generic assignment handling, two-tenant/anonymous denial, provider-ingress CHECK evaluation, actor attribution, immutable/bounded/redacted activity, lifecycle ordering, and recovery behavior.
- Complete a real authenticated production session and the entire GitHub callback/token/repository/project/read/edit/draft-PR/disconnect journey.
- Observe valid, invalid, duplicate, stale, out-of-order, deletion, and restore webhook deliveries in production.
- Verify stale SHA, unapproved/admin protected denial, exact owner approval/expiry/lease, likely secret, wrong tenant, renamed/same-name repository, revoked installation, insufficient permission, rate limit, stable retry, and ambiguous completion recovery.
- Record the remaining hosted migration and authenticated provider acceptance evidence against the exact deployed release.

## Release-blocking invariants

- Any exposed secret/raw audit payload, disabled RLS, direct sensitive-base-table browser read, cross-tenant or mutable-name repository authorization, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, lease reclaim after provider execution, or unapproved/expired protected action is a failure.
- Configuration, tests, provider installation, or Vercel READY status cannot be relabeled as a real SoftwareFactory GitHub connection.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
