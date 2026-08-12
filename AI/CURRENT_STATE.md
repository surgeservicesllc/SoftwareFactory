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
