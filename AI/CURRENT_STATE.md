# Current state

Last reviewed: 2026-08-12

Phase: 1B - Production GitHub App Integration

Overall status: **Phase 1B hardening passes local gates, CI, and exact-tree production hosting; hosted migrations `011`-`019`, authenticated tenant behavior, webhook activation, and live GitHub acceptance remain pending.**

"Implemented" below means code/schema exists in the working tree. It does not mean the provider workflow was observed or the schema is hosted.

## Implemented application boundaries

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4, server-first Auth/tenant/provider boundaries, and caller-session Supabase RLS reads.
- Supabase sign-up/sign-in/magic-link/sign-out/callback/onboarding, organization membership, and active-organization selection.
- GitHub App installation start/callback, short-lived repository-ID-scoped installation tokens, bounded repository reads, signed/idempotent/redacted webhooks, transactional project linking, and an isolated branch + commit + draft-PR-only file-change flow.
- Every interactive GitHub route is bound to the caller's exact active organization. Revoked or insufficient-permission token creation is persisted best-effort as connection loss; rate-limit errors do not falsely revoke the connection.
- Callback browser failures return safely to Connections with bounded error state; JSON callers retain structured no-store errors. GitHub-returned web URLs are restricted to HTTPS `github.com` origins.
- Connections and dashboard states do not hard-code a personal account and distinguish the live Supabase control plane from a GitHub integration that is **Not Connected**.
- The standard editor blocks broad security/identity/provider/automation/dependency/infrastructure resource classes, keeps one idempotency key for an unchanged retry intent, and can recover an already-created draft PR after an ambiguous database-completion response.
- Installation and repository webhook transitions are provider-time ordered. Deletion is terminal for an installation ID; repository deletion remains terminal until an explicit newer restore, and restored repositories stay unselected pending access synchronization.
- Provider-authoritative repository rename/default-branch changes propagate only to exact connection-linked projects and create redacted immutable activity evidence.
- No direct default-branch write, merge, deployment, rollback, Codex worker, or Claude worker exists. The Phase 1D observation scaffold remains execution-inert: Autonomous Mode OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF.
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
- The interface uses a semantic design-token system with a 12px minimum type size (ADR-021) and plain-language copy that keeps exact policy terms as secondary labels (ADR-022). The dashboard leads with the real product path — connect GitHub, add a project, open your files — derived from the single `/api/projects` read the live metrics already perform.
- Every surface now reads live tenant records (ADR-023). `GET /api/agents`, `/api/tasks`, `/api/runs`, `/api/reports`, and `/api/commands` were added over the existing `agents`, `tasks`, `agent_runs`, `reports`, and `commands` tables, all through one server-only boundary (`lib/server/tenant-list.ts`) that authenticates the caller, filters by the exact active organization, bounds rows at 100, enumerates columns explicitly, and returns no-store. `lib/demo-data.ts` is deleted; an empty table renders an empty state rather than illustrative rows. Run inputs/outputs, report bodies, and command parameters are never selected into a browser response.
- Consequently the navigation no longer has a "Demo only" group, and no surface renders **Demo Data** — there is no seeded content left to label. **Not Connected** remains in use wherever a provider or worker genuinely is not connected.
- The legacy HTTP local-file writer, its component, and its environment switch are removed. Repository changes have only the authenticated GitHub isolated-branch/draft-PR route.
- Phase 1D observation-only scaffolding is present: a pure GREEN prerequisite evaluator, tenant-scoped GET/owner-only same-origin PATCH controls, a locked static safety surface, and hosted migration `010` that keeps Autonomous Mode OFF, the global kill switch ON, and every automatic action OFF. No evaluator result can execute work.
- No merge, deploy, rollback, Codex, or Claude executor is present.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was last verified `ACTIVE_HEALTHY`.
- Hosted migrations are applied only through `010`: `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010`.
- Local migrations `011`-`019` are **not hosted**:
  - `011` closes initial direct connection/member mutations and aligns `github_pat_` detection.
  - `012` adds actor-attributed completed/failed change evidence.
  - `013` adds bounded service-role repository-grant reconciliation.
  - `014` propagates exact linked-project repository metadata.
  - `015` recovers completion from an existing branch/commit/draft PR.
  - `016` makes installation deletion terminal and provider-time ordered.
  - `017` closes remaining direct connection/project/link/change-request writes and adds an authenticated exact-binding reservation RPC.
  - `018` provider-orders repository metadata and preserves terminal deletion/explicit restore semantics.
  - `019` grants service role only the SECURITY DEFINER sensitive-JSON wrapper required by provider-ingress table CHECK evaluation; recursive/text helpers remain inaccessible.
- Promoting this authorization/audit/provider-ingress chain is a protected production action requiring exact owner approval and post-apply ledger, lint, grant, RLS/FORCE RLS, tenant, audit, ordering, recovery, CHECK-evaluation, and health verification.
- The last clean linked public-schema lint is through `009`; a post-`010` attempt was blocked by the current Supabase CLI account `403`. No later hosted lint claim is made.
- Hosted catalog evidence before this increment reported 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 row-secret guards. Authenticated two-tenant/anonymous/RPC behavior remains pending.
- Privileged GitHub/Supabase secrets remain in server-side Vercel settings, not source, browser code, logs, fixtures, or database rows.

## Provider and release truth

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Connected through hosted migration `010`; broader behavioral gate pending | Project health and prior fail-closed `010` checks were verified. Local `011`-`019` are not hosted. |
| GitHub App object/secrets | Configured | App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) and protected server variable names exist. Configuration is not a live tenant connection. |
| GitHub provider installation | Installed; repository-scoped | Installation `153286187` exists on `surgeservicesllc`, selected only for `surgeservicesllc/SoftwareFactory`. |
| GitHub App connection | **Not Connected** | Authenticated SoftwareFactory callback/tenant persistence, live repo/project/file/draft-PR journey, and signed webhook delivery are not verified. |
| GitHub webhook | **Not Connected** | Route exists; active provider hook and valid signed production delivery are not verified. |
| Vercel UI hosting | Exact application release verified | READY production deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu` stores `softwarefactoryGitCommitSha=427190d050796e3f5ff5cf6154adc2c34e2e5694`, serves the stable alias, and passes production Playwright 12/12. |
| Vercel deploy/rollback adapter | **Not Connected** | Hosting the UI is not an in-product deployment or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Verification evidence

- Current working tree: lint and typecheck pass; full Vitest passes 38 files/263 tests (unit 23/145, integration 15/118); coverage passes 38 files/263 tests at 66.08% statements, 65.13% branches, 58.62% functions, and 67.16% lines with required risk/constants thresholds satisfied; the full migration-chain RLS behavioral matrix passes 5/5 through migration `019`; the production build passes with 34 routes; and local Playwright passes 12/12 across desktop/tablet/mobile including axe checks after relocating an ignored stale OneDrive coverage cache.
- Source/client secret gates pass: tracked and untracked non-fixture source contained no credential/private-key marker; the only source pattern hits were explicit fake detector fixtures in `github-repository-grants` and `github-rls-behavior`; rebuilt `.next/static` contained no privileged environment name, key marker, or `service_role` marker.
- GitHub `main` application commit `427190d050796e3f5ff5cf6154adc2c34e2e5694` (author `NewWorldVenture`) passed CI run `31649243266` with 2/2 jobs green.
- The supported detached, tracked-files-only, owner-authenticated production deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu` is READY at `https://softwarefactory-i3pm08bpx-surgeservices-projects.vercel.app` and the stable alias `https://softwarefactory-tan.vercel.app`; provider metadata resolves it to the exact application SHA above. Documentation-only successors need not replace this application-tree evidence.
- Production validation passed: five public routes returned 200 with the expected title, representative authenticated APIs returned 401, removed `/api/files` returned 404, Playwright passed 12/12, all nine deployed JavaScript assets were clean of privileged markers, and recent error/HTTP-500 log counts were zero.
- No hosted or live-provider evidence has been produced for migrations `011`-`019` or the new application hardening.

## Release blockers

1. Obtain exact owner approval for production migrations `011`-`019` and webhook secret/provider activation; apply only to `qpuofpmagrmyamahqwxw` and run every post-apply check.
2. Complete real production sign-in, email confirmation, onboarding, active-organization, and caller-session acceptance.
3. Complete the authenticated GitHub callback, tenant connection/repository sync, project link, branch/commit/PR/check views, file read, safe edit/draft PR, stale/protected/idempotent/recovery cases, and disconnect/loss handling.
4. Configure/verify the active GitHub webhook and observe valid, invalid, duplicate, out-of-order, deletion, and restore behavior in production.
5. Keep GitHub **Not Connected**, Phase 1B incomplete, Phase 1C unstarted, and all automatic actions OFF until that evidence exists.
## Current-tree verification

These gates ran on the merged tree (this interface/wiring work on top of the `019` hardening) on Node 22.

| Gate | Evidence | Result |
| --- | --- | --- |
| Lint, typecheck, tests, build | `npm run check` in one run | Pass - 40 files/289 tests and a clean production build |
| Local Playwright | `npm run test:e2e` | Pass - 48/48 across desktop/tablet/mobile: 12 dashboard depth checks plus 36 per-page checks asserting heading, no horizontal overflow, and axe on 12 routes |
| Interface simplification (ADR-021, ADR-022) | Design tokens with a 12px type floor, plain-language copy, grouped navigation, guided dashboard path | Pass - presentation only; no route, schema, policy, token, or provider behaviour changed |
| Live Supabase wiring (ADR-023) | Five tenant read routes over existing tables through one server-only boundary; five surfaces converted from seeded arrays; `lib/demo-data.ts` deleted | Pass - read-only application change; no hosted schema change and no credential set |
| Withheld-column contract | Run `input`/`output`, report `content`, and command `parameters` excluded from every list select; no `select("*")` | Pass - asserted by `tests/integration/tenant-list-routes.contract.test.ts` |
| Accessibility repairs | axe on every route at three viewports | Pass - two real WCAG AA defects fixed: anchor primary buttons at 1.21:1 caused by an unlayered `a { color: inherit }` outranking `@layer components`, and a keyboard-unreachable horizontal scroll region on the backlog. Both predate this work; gradient panel backgrounds had made axe report contrast "incomplete" rather than failing. |
| Secret scan | tracked source and `.next/static` | Pass - no credential values; matches are environment-variable names in docs/config only |

The published production evidence above (release `427190d`, deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`) describes the tree **before** this interface and wiring work. Production evidence for the merged tree must be recaptured after it deploys. No provider, connection, or phase claim changes because of this work.

## Known limitations and release blockers

- Verify hosted authenticated RLS/FORCE RLS, cross-tenant/anonymous denial, privileged-RPC authorization, audit behavior, and a real application session.
- Complete real Supabase sign-in/onboarding.
- Complete the authenticated owner callback for provider installation `153286187`, persist the organization connection, and verify repository sync, project link, reads, safe edit/draft PR, audit, error/revocation paths, and disconnect.
- Configure and verify the GitHub webhook endpoint. The provider General form is blank/inactive and App-authenticated hook configuration returns `404`/no hook object; observe a valid signed production delivery before changing its status.
- Supabase Preview environment isolation remains unverified.
- Restore an authorized Supabase CLI account and rerun linked public-schema lint after `010`; retain the hosted kill-switch/constraint/RPC checks. This does not authorize an executor.

No documentation/UI may change GitHub to Connected or Phase 1B to complete until these blockers have evidence.
