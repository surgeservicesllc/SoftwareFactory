# Current state

Last reviewed: 2026-08-12

Phase: 1B — Production GitHub App Integration

Overall status: **Phase 1B hardening is pushed to `main` and deployed; hosted migrations `011`-`013`, authenticated in-product connection, webhook, and remaining tenant acceptance are pending**

“Implemented” below means code/schema exists in the current tree. It does not mean the real provider workflow was observed.

## Implemented application boundaries

- Next.js 16.3, React 19.2, TypeScript strict mode, App Router, and Tailwind CSS 4.
- Supabase email/password sign-up/sign-in, existing-user magic link, sign-out, callback exchange, onboarding, organization creation, membership resolution, and active-organization selection.
- Tenant-scoped live project API/UI. Owner/admin can create a safe-default project only from a selected repository on an active GitHub connection. Connected status/counts require a live connection, active unsuspended installation, and selected non-archived/non-disabled repository in the exact active organization.
- GitHub App install start/callback with same-origin protection, signed ten-minute state, HttpOnly nonce cookie, user authorization verification, exact App/installation verification, active-organization equality, and best-effort ephemeral user-token revocation.
- Server-only App JWT/private-key handling and short-lived installation tokens scoped to one repository ID and exact route permissions.
- Connection/repository synchronization, status/freshness visibility, explicit disconnect confirmation, history preservation, and connection-loss handling.
- Tenant-authorized repository branches, commits, pull requests, checks, trees, and UTF-8 file reads.
- Guarded file change route: validates project/connection/default branch/path/content/SHA/idempotency, rejects likely secrets and a broad protected-resource set (`AI/**`, `policies/**`, Supabase, every `app/api/**` route, GitHub/server/Supabase libraries, Auth/session code, deployment/environment/infrastructure files, and other security-sensitive subject paths), creates a `softwarefactory/*` branch, commits there, and requires an open draft PR.
- Repository authorization compares normalized GitHub full names literally rather than through SQL wildcard matching. Project creation persists only the synchronized GitHub default branch; a caller-supplied branch is a freshness expectation and cannot override provider state.
- GitHub webhook route with 2 MiB bound, raw-body HMAC verification, event-specific payload schemas, delivery-ID/payload-hash replay protection, redacted storage, and bounded database reconciliation. Newly granted repository metadata uses the service-role-only RPC introduced by local migration `013`, so that path is not available in hosted production yet.
- Connections, Projects, Files, and dashboard surfaces consume live tenant records when configured; demo records remain labeled **Demo Data**.
- Activity now has a live no-store tenant API/UI backed by caller-session RLS. Browser responses omit activity metadata. The page previously rendered a seeded example stream directly beneath the live stream in identical styling; that duplicate was removed because two visually identical feeds on one page invite exactly the confusion the **Demo Data** label exists to prevent. The seeded example now appears only on the dashboard, still labeled.
- The interface uses a semantic design-token system with a 12px minimum type size (ADR-018) and plain-language copy that keeps exact policy terms as secondary labels (ADR-019). Navigation is grouped so live surfaces are separated from a "Demo only" section. The dashboard leads with the real product path — connect GitHub, add a project, open your files — derived from the single `/api/projects` read the live metrics already perform.
- The legacy HTTP local-file writer, its component, and its environment switch are removed. Repository changes have only the authenticated GitHub isolated-branch/draft-PR route.
- Phase 1D observation-only scaffolding is present: a pure GREEN prerequisite evaluator, tenant-scoped GET/owner-only same-origin PATCH controls, a locked static safety surface, and hosted migration `010` that keeps Autonomous Mode OFF, the global kill switch ON, and every automatic action OFF. No evaluator result can execute work.
- No merge, deploy, rollback, Codex, or Claude executor is present.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was verified `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` were applied successfully; the hosted migration ledger includes `010`.
- Additive migrations `011_harden_direct_mutation_boundaries`, `012_github_change_audit`, and `013_reconcile_github_repository_grants` are committed on `main` but **not applied to hosted Supabase**. They respectively close direct authenticated connection/member mutations and align `github_pat_` detection, add actor-attributed terminal change-request evidence, and reconcile newly granted repository metadata. Hosted promotion is pending exact owner approval and post-apply verification.
- Migration `010` was applied transactionally after preflight returned `unsafe_project_rows=0`. Hosted checks confirmed organization kill-switch default `true`, both new constraints validated, zero organizations with the switch OFF, zero unsafe projects, authenticated execute on the controls RPC, and no anonymous execute grant.
- The last successful linked public-schema CLI lint was clean through `009` (`[]`). A post-`010` CLI lint attempt was blocked by a Supabase CLI account `403`, so no post-`010` CLI-lint claim is made. Authenticated cross-tenant, broader privileged-RPC/audit, and real application-session checks remain pending.
- Migration `009_harden_github_project_and_sync` serializes synchronization by external installation ID before first-or-existing connection creation, re-resolves the authoritative installation binding after upsert, and forces project links to use the synchronized GitHub default branch.
- A read-only hosted catalog query returned 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 row-secret guards. The subsequent linked migration list confirms all eight expected migrations through `009`.
- Phase 1B adds `github_installations`, `github_repositories`, `github_webhook_deliveries`, and `github_change_requests`, all with RLS and FORCE RLS, plus audited privileged workflows and transactional project linking.
- Hosted Auth uses exact production/local callbacks, confirmed email sign-up, anonymous sign-in OFF, minimum password length 12, JWT expiry 3600, secure password changes, rate limits, eight-digit OTPs, and TOTP enabled.
- GitHub/Supabase privileged credentials are stored in Vercel server-side environment settings, not source or database rows.
- GitHub App installation `153286187` exists on `surgeservicesllc` and is scoped only to `surgeservicesllc/SoftwareFactory`. This provider-side installation is real evidence, but it has not completed the authenticated SoftwareFactory callback or tenant persistence workflow.
- The App has one remaining private key, identified by public fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`. Vercel's protected private-key value was rotated to that key and promoted without placing key material in source or logs.
- Preview Supabase configuration has not been independently verified.

## Live/configuration status

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Schema/observation controls connected; broader behavioral gate pending | Project is healthy and hosted through `010`. Kill-switch/constraint/grant checks pass. Last linked CLI lint was clean through `009`; post-`010` CLI lint is unavailable because the current CLI account returns `403`. Hosted authenticated RLS allow/deny and real app-session verification remain. |
| GitHub App object/secrets | Configured and rotated | `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) exists; its sole remaining key fingerprint is `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`, and the corresponding server-only key is promoted in Vercel. |
| GitHub provider installation | Installed; repository-scoped | Installation `153286187` is installed on `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected. This does not establish a SoftwareFactory tenant connection. |
| GitHub App connection | **Not Connected** | The authenticated SoftwareFactory owner callback, organization connection record, repository synchronization, project/file/draft-PR journey, and signed webhook delivery remain pending. The provider General form is blank/inactive, and App-authenticated hook configuration returns `404` with no hook object. |
| Vercel UI hosting | Production deployment verified | Deployment `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY` is READY at `softwarefactory-fbho4i38o-surgeservices-projects.vercel.app` and current at `https://softwarefactory-tan.vercel.app`; production Playwright passed 12/12. It builds the application tree from implementation commit `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278` through owner-authored empty marker `7bd9d30e67bf018aba32f28d235d4a2f1232d65c`. This is hosting evidence, not an in-product deploy/rollback adapter or full provider acceptance. |
| Vercel deployment/rollback adapter | **Not Connected** | Hosting does not create an in-product deploy or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |
| Phase 1D observation scaffold | Hosted controls; execution blocked | GREEN-only policy observation; hosted global kill switch locked ON; both safety constraints validated; automatic actions OFF; worker **Not Connected**. |

## Verification evidence and current-tree status

The hardening gates pass locally and the exact application tree is now deployed. Hosted database and authenticated provider acceptance remain separate evidence layers.

| Gate | Evidence | Result |
| --- | --- | --- |
| Current local Phase 1B review hardening | Active-tenant routes, truthful live status, Activity API/UI, direct-write removal, migrations `011`-`013`, expanded contracts | Implemented locally; validation below passes |
| Interface simplification (GREEN) | Design tokens, 12px type floor, plain-language copy, grouped navigation, guided dashboard setup path | Implemented locally; gates below rerun on Node 22 |
| Check phases | `npm run check` on Node 22 after the interface work | Pass — lint, typecheck, 25 files/208 tests, and the production build all pass in one run |
| Production build | `npm run build` | Pass — 34 pages/routes |
| Full coverage suite | `npm run test:coverage` after final `013` ordering/contracts | Pass — 25 files/208 tests; 50.44% statements, 52.99% branches, 45.07% functions, 51.24% lines |
| Focused `013` chain | 3 test files | Pass — 44 tests |
| Local Playwright | `npm run test:e2e` | Pass — 48/48 across desktop/tablet/mobile. Dashboard depth checks (12) plus a new per-page suite (36) asserting heading, no horizontal overflow, and axe on 12 routes. |
| Interface accessibility repairs | axe on every route at three viewports | Two real WCAG AA defects found and fixed: anchor primary buttons rendered at 1.21:1 because an unlayered `a { color: inherit }` outranked the layered component class, and the backlog table was a keyboard-unreachable horizontal scroll region. Both predate this change and were previously masked. |
| Secret/client scan | tracked/source and `.next/static` review | Pass — only the synthetic `github_pat_` fixture matched; no built static server-secret markers |
| Hosted migration application | Supabase SQL Editor + hosted ledger | Pass through `010`; transactional preflight/application and safety checks recorded |
| Local migration promotion | `011`, `012`, `013` | Pending exact owner approval; no hosted application/lint/RPC claim |
| Hosted database lint | linked CLI | Pass through `009` — no schema errors (`[]`); post-`010` attempt blocked by CLI-account `403`, not claimed |
| Git/main provenance | GitHub `origin/main` | Pass — implementation `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278` pushed; owner-authored empty marker `7bd9d30e67bf018aba32f28d235d4a2f1232d65c` is current `main` and preserves the implementation authorship/tree |
| Stable production Playwright | `PLAYWRIGHT_BASE_URL=https://softwarefactory-tan.vercel.app npm run test:e2e` | Pass — 12/12 against deployment `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY` |
| Production HTTP probes | `/`, `/activity`, `/connections`, `/api/activity`, `/api/files` | Pass — public pages return 200; unauthenticated `/api/activity` returns 401; removed `/api/files` returns 404 |
| Live GitHub acceptance | production checklist | Pending; **Not Connected** |
| Phase 1B/1D Vercel deployment | deployment identity/readiness/public E2E | Pass — `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY`, READY/current for the `e0ca6e7` application tree via marker `7bd9d30`, stable alias 12/12 |

The interface gates above ran on Node 22, which the repository, CI, and intended production runtime target; Supabase's future-support warning no longer appears. Vitest still emits the Vite native config-loader warning tracked in the backlog.

Every deployment row in this section — deployment `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY`, its production Playwright 12/12, and its HTTP probes — describes application tree `e0ca6e7`. The interface simplification is **not** in that tree. Its production evidence must be recaptured after the change is deployed; no deployment, provider, or phase claim changes because of it.

## Known limitations and release blockers

- Verify hosted authenticated RLS/FORCE RLS, cross-tenant/anonymous denial, privileged-RPC authorization, audit behavior, and a real application session.
- Obtain exact owner approval to apply hosted migrations `011`-`013`; then verify ledger, lint, grants, RLS, actor-attributed immutable activity, webhook repository-grant reconciliation, and application health.
- Preserve current provenance: implementation commit `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278` contains the application changes; owner-authored empty marker `7bd9d30e67bf018aba32f28d235d4a2f1232d65c` is current `main` and deployed because Vercel Hobby rejected the private-repository deployment directly from the non-member implementation author. The marker changes no application files.
- Complete real Supabase sign-in/onboarding.
- Complete the authenticated owner callback for provider installation `153286187`, persist the organization connection, and verify repository sync, project link, reads, safe edit/draft PR, audit, error/revocation paths, and disconnect.
- Configure and verify the GitHub webhook endpoint. The provider General form is blank/inactive and App-authenticated hook configuration returns `404`/no hook object; observe a valid signed production delivery before changing its status.
- Supabase Preview environment isolation remains unverified.
- Restore an authorized Supabase CLI account and rerun linked public-schema lint after `010`; retain the hosted kill-switch/constraint/RPC checks. This does not authorize an executor.

No documentation/UI may change GitHub to Connected or Phase 1B to complete until these blockers have evidence.
