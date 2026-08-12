# Quality scorecard

Last reviewed: 2026-08-12

Phase 1B decision: **Not release-ready yet**

Reason: all current local quality gates pass, but publication/deployment, hosted migrations `011`-`019`, hosted authenticated tenant behavior, in-product GitHub callback/connection, active webhook delivery, and the complete live provider journey remain pending.

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
| Git/main provenance for this increment | Working tree not yet committed/pushed | Pending |
| Vercel production for this increment | No exact matching verified deployment yet | Pending |
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
  last clean linked public-schema lint: through 009 / []
  post-010 linked lint: NOT VERIFIED - CLI account returned 403
```

Historical baseline evidence remains useful for regression comparison but cannot be relabeled as verification of the working tree, migrations `011`-`019`, or a future deployment.

## Security and production acceptance still required

- Preserve the passing current-tree quality/secret evidence for the exact committed tree and rerun affected checks after any change.
- Apply migrations `011`-`019` only after exact owner approval; verify all grants/search paths, RLS/FORCE RLS, two-tenant/anonymous denial, provider-ingress CHECK evaluation, actor attribution, immutable/redacted activity, lifecycle ordering, and recovery behavior.
- Complete a real authenticated production session and the entire GitHub callback/token/repository/project/read/edit/draft-PR/disconnect journey.
- Observe valid, invalid, duplicate, stale, out-of-order, deletion, and restore webhook deliveries in production.
- Verify stale SHA, protected path, likely secret, wrong tenant, revoked installation, insufficient permission, rate limit, stable retry, and ambiguous completion recovery.
- Record exact commit, CI run, Vercel deployment/alias, production HTTP/E2E/log checks, and provider acceptance.

## Release-blocking invariants

- Any exposed secret, disabled RLS, cross-tenant access, direct default-branch write, non-draft/merge/deploy action, stale event reactivation, duplicate ambiguous retry, or unapproved protected production action is a failure.
- Configuration, tests, provider installation, or Vercel READY status cannot be relabeled as a real SoftwareFactory GitHub connection.
- A clean migration/lint result does not prove authenticated RLS behavior; both evidence layers are required.
- A future code/provider/schema/deployment change invalidates affected evidence and requires this scorecard to be rerun.
