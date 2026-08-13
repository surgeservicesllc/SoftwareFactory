# Current state

Last reviewed: 2026-08-13

Phase: 1B - Production GitHub App Integration

Overall status: **The latest Phase 1B hardening implementation passes lint, typecheck, 52 files/392 tests, coverage, production build, production-server Playwright 48/48 across desktop/tablet/mobile with axe checks, and final source/rebuilt-static secret scans. Publication, deployment, hosted migrations `011`-`025`, authenticated tenant behavior, webhook activation, and live GitHub acceptance remain pending.**

"Implemented" below means code/schema exists in the working tree. It does not mean the provider workflow was observed or the schema is hosted.

## Implemented application boundaries

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4, server-first Auth/tenant/provider boundaries, and caller-session Supabase RLS reads.
- Supabase sign-up/sign-in/magic-link/sign-out/callback/onboarding, organization membership, and active-organization selection.
- GitHub App installation start/callback, short-lived repository-ID-scoped installation tokens, bounded repository reads, signed/idempotent/redacted webhooks, transaction-serialized project linking by stable repository UUID, and an isolated branch + commit + draft-PR-only file-change flow.
- Every interactive GitHub route is bound to the caller's exact active organization. Revoked or insufficient-permission token creation is persisted best-effort as connection loss; rate-limit errors do not falsely revoke the connection.
- Callback browser failures return safely to Connections with bounded error state; JSON callers retain structured no-store errors. GitHub-returned web URLs are restricted to HTTPS `github.com` origins.
- Connections and dashboard states do not hard-code a personal account and distinguish the live Supabase control plane from a GitHub integration that is **Not Connected**. A real connection will show its installation ID and repository-selection mode.
- Ordinary file changes require owner/admin authorization, keep one idempotency key for an unchanged retry intent, and can recover an already-created draft PR after an ambiguous database-completion response. Protected paths fail closed unless an active owner supplies the exact short-lived RED approval phrase, rationale, and rollback plan; generic non-placeholder secret assignments and provider-token patterns remain blocked, and the only provider outcome remains a draft PR.
- Change reservations expire after five minutes and may be reclaimed only for the exact original intent before the provider boundary is entered. The exact approval snapshot is bound to the reserved change, and the provider boundary is durably revalidated before the write-scoped installation token is minted; entry permanently prevents lease reclamation.
- Installation and repository webhook transitions are provider-time ordered. Deletion is terminal for an installation ID; repository deletion remains terminal until an explicit newer restore, and restored repositories stay unselected pending access synchronization.
- Provider-authoritative repository rename/default-branch changes propagate by stable repository UUID only to exact connection-linked projects and create redacted immutable activity evidence.
- Agents, commands, tasks, runs, and reports are read through bounded caller-member RPC projections; authenticated browser sessions no longer have direct SELECT on those sensitive base tables. Command creation also enforces same-origin requests.
- Authenticated direct reads of raw Activity and webhook-delivery rows are revoked. Activity uses a caller-member, row-limited RPC and returns only allowlisted, bounded GitHub/SoftwareFactory actor, source, resource, action, status, conclusion, and transition evidence; raw audit metadata and stored webhook subsets remain server-side. Webhook project attribution uses the stable repository UUID.
- Projects selects repositories by stable provider ID and renders live repository sync time, branch protection/SHA, commit author/date, PR author/created/updated time and detail-fetched mergeability, default-branch checks, and per-PR checks fetched against each displayed head SHA.
- Global browser headers include a restrictive CSP, framing/object denial, a narrow Supabase connection allowlist, and a narrow image allowlist; repository Markdown previews do not load external images.
- No direct default-branch write, merge, deployment, rollback, Codex worker, or Claude worker exists. The Phase 1D observation scaffold remains execution-inert: Autonomous Mode OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was last verified `ACTIVE_HEALTHY`; the CLI is authorized as `surgeservicesllc@gmail.com` and linked to this exact project.
- Hosted migrations are applied only through `010`: `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010`.
- Local migrations `011`-`025` are **not hosted**:
  - `011` closes initial direct connection/member mutations and aligns `github_pat_` detection.
  - `012` adds actor-attributed completed/failed change evidence.
  - `013` adds bounded service-role repository-grant reconciliation.
  - `014` propagates exact linked-project repository metadata.
  - `015` recovers completion from an existing branch/commit/draft PR.
  - `016` makes installation deletion terminal and provider-time ordered.
  - `017` closes remaining direct connection/project/link/change-request writes and adds an authenticated exact-binding reservation RPC.
  - `018` provider-orders repository metadata and preserves terminal deletion/explicit restore semantics.
  - `019` grants service role only the SECURITY DEFINER sensitive-JSON wrapper required by provider-ingress table CHECK evaluation; recursive/text helpers remain inaccessible.
  - `020` revokes authenticated base-table SELECT on agents/commands/tasks/runs/reports and exposes bounded caller-member safe-projection RPCs.
  - `021` binds each project connection and change request to the immutable tenant-scoped GitHub repository UUID; repository names remain mutable display metadata.
  - `022` records immutable, exact, owner-only RED protected-change approval before provider execution and adds a five-minute pre-provider reservation lease with exact-intent reclamation.
  - `023` projects bounded verified GitHub activity details and attributes project events through the stable repository UUID.
  - `024` revokes authenticated direct reads of raw Activity/webhook-delivery rows and exposes a caller-member, 100-row `list_activity` safe projection.
  - `025` detects opaque generic secret assignments, binds protected approval snapshots to exact pre-provider reservations, enforces provider-boundary-before-write-token ordering, and serializes stable repository relinking while allowing relink after archival.
- Promoting this authorization/audit/provider-ingress chain is a protected production action requiring exact owner approval and post-apply ledger, lint, grants, RLS/FORCE RLS, raw Activity/webhook denial, tenant/list-projection behavior, stable repository binding/relink concurrency, generic secret assignment behavior, approval/token/lease invariants, audit/detail redaction, ordering, recovery, CHECK-evaluation, and health verification.
- Linked database lint is clean against hosted state through `010`. A linked dry run successfully planned `011`-`024` before `025` existed and applied nothing. The current full `011`-`025` attempt is blocked by a database login-role `403`.
- Hosted catalog evidence before this increment reported 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 row-secret guards. Authenticated two-tenant/anonymous/RPC behavior remains pending.
- Privileged GitHub/Supabase secrets remain in server-side Vercel settings, not source, browser code, logs, fixtures, or database rows.

## Provider and release truth

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Connected through hosted migration `010`; broader behavioral gate pending | CLI authorized as `surgeservicesllc@gmail.com`, exact project linked, ledger through `010`, linked lint clean. Local `011`-`025` are not hosted; dry-run evidence covers only `011`-`024`. |
| GitHub App object/secrets | Configured | App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) and protected server variable names exist. Configuration is not a live tenant connection. |
| GitHub provider installation | Installed; repository-scoped | Personal `surgeservicesllc` installation `153286187` selects only `surgeservicesllc/SoftwareFactory`. |
| GitHub App connection | **Not Connected** | Authenticated SoftwareFactory callback/tenant persistence, live repo/project/file/draft-PR journey, and signed webhook delivery are not verified. |
| GitHub webhook | **Not Connected** | Route exists; the provider webhook remains blank/inactive and no valid signed production delivery is verified. |
| Vercel UI hosting | Exact project linked; historical baseline verified | Exact `surgeservices-projects/softwarefactory` is linked and encrypted environment names are present. Pre-hardening commit `f12814bd94001e5c9fe9637e0350e14816de8d13` on deployment `dpl_9M66dxkkNiqTTRVbC2SGqzXzkwju` passed public Playwright 12/12. This does not validate the working tree. |
| Vercel deploy/rollback adapter | **Not Connected** | Hosting the UI is not an in-product deployment or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Verification evidence

- `npm run check` passes lint, typecheck, 52 files/392 Vitest tests, and the production build; the build compiled and generated 38 static routes on Node 22.23.1.
- The dedicated integration suite passes 21 files/163 tests.
- Coverage passes 52 files/392 tests: statements 70.36% (603/857), branches 71.34% (488/684), functions 62.58% (97/155), and lines 71.37% (566/793).
- Production-server Playwright passes 48/48 across desktop, tablet, and mobile, including axe checks.
- Final source and rebuilt-static scans found zero actual credential candidates, zero privileged/static marker matches, and zero unexpected sensitive files. One `VERCEL_PROJECT_PRODUCTION_URL` environment identifier was reviewed as benign.
- Prior stable-production Playwright 12/12 is historical baseline evidence only.
- No hosted or live-provider acceptance evidence has been produced for migrations `011`-`025` or the new application hardening.

## Release blockers

1. Publish the exact verified tree and verify its exact Vercel deployment, CI, aliases, HTTP boundaries, public E2E, logs, and client artifacts.
2. Obtain exact owner approval for production migrations `011`-`025` and webhook secret/provider activation; dry-run the full chain, apply only to `qpuofpmagrmyamahqwxw`, and run every post-apply check.
3. Complete real production sign-in, email confirmation, onboarding, active-organization, and caller-session acceptance.
4. Complete the authenticated GitHub callback, tenant connection/repository sync, project link, branch/commit/PR/check views, file read, safe edit/draft PR, stale/protected/idempotent/recovery cases, and disconnect/loss handling.
5. Configure/verify the active GitHub webhook and observe valid, invalid, duplicate, out-of-order, deletion, and restore behavior in production.
6. Keep GitHub **Not Connected**, Phase 1B incomplete, Phase 1C unstarted, and all automatic actions OFF until that evidence exists.
