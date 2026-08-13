# Current state

Last reviewed: 2026-08-13

Phase: 1B - Production GitHub App Integration

Overall status: **The Phase 1B hardening snapshot at `7d22de6` is published on GitHub `main`, both CI jobs pass, and its exact matching Vercel production deployment is READY with Playwright 48/48. A signed-out dashboard follow-up is validated locally at 53 files/394 tests but is not yet in that production snapshot. Hosted migrations `011`-`025`, authenticated tenant behavior, webhook activation, and live GitHub acceptance remain pending.**

"Implemented" below means code/schema exists in the published release or the explicitly identified local follow-up. It does not mean the provider workflow was observed or the schema is hosted.

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
- The current local follow-up gives the signed-out dashboard a server-verified authentication hint so it skips protected browser fetches; its regression test passes 30/30 repeated runs. This follow-up is not part of the production deployment identified below.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was last verified `ACTIVE_HEALTHY`; the CLI is authorized as `surgeservicesllc@gmail.com` and linked to this exact project.
- Hosted migrations are applied only through `010`: `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010`.
- Repository migrations `011`-`025` are **not hosted**:
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
- Linked database lint is clean against hosted state through `010`. A complete linked dry run successfully plans exactly `011`-`025` and applies nothing; production application still requires exact owner approval.
- Hosted catalog evidence before this increment reported 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 row-secret guards. Authenticated two-tenant/anonymous/RPC behavior remains pending.
- Privileged GitHub/Supabase secrets remain in server-side Vercel settings, not source, browser code, logs, fixtures, or database rows.

## Provider and release truth

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Connected through hosted migration `010`; broader behavioral gate pending | CLI authorized as `surgeservicesllc@gmail.com`, exact project linked, ledger through `010`, linked lint clean. Repository migrations `011`-`025` are not hosted; the complete linked dry run succeeds without applying them. |
| GitHub App object/secrets | Configured | App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) and protected server variable names exist. Configuration is not a live tenant connection. |
| GitHub provider installation | Installed; repository-scoped | Personal `surgeservicesllc` installation `153286187` selects only `surgeservicesllc/SoftwareFactory`. |
| GitHub App connection | **Not Connected** | Authenticated SoftwareFactory callback/tenant persistence, live repo/project/file/draft-PR journey, and signed webhook delivery are not verified. |
| GitHub webhook | **Not Connected** | Route exists; the provider webhook remains blank/inactive and no valid signed production delivery is verified. |
| Vercel UI hosting | Exact current release verified | Exact `surgeservices-projects/softwarefactory` deployment `dpl_6Aiygdb9r1B4PCUefLahBKgadAHb` is READY for commit `7d22de665813d119488b4a26b0cd4084070b3eaa` and serves the stable alias. Public Playwright passes 48/48; the in-product deploy/rollback adapter remains **Not Connected**. |
| Vercel deploy/rollback adapter | **Not Connected** | Hosting the UI is not an in-product deployment or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Verification evidence

- On the current local follow-up, `npm run check` passes lint, typecheck, 53 files/394 Vitest tests, and the production build; the build compiled 38 routes on Node 22.23.1, with `/` dynamic.
- The dedicated integration suite passes 21 files/163 tests.
- Current-tree coverage passes 53 files/394 tests: statements 70.36% (603/857), branches 71.34% (488/684), functions 62.58% (97/155), and lines 71.37% (566/793).
- The published production snapshot and the local follow-up each pass Playwright 48/48 across desktop, tablet, and mobile, including axe checks. The local signed-out browser-error regression additionally passes 30/30 repeated runs.
- Current-tree source and rebuilt-static scans found zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present. Code-variable and documented placeholder assignments were reviewed as non-credentials.
- GitHub `main` points to `7d22de665813d119488b4a26b0cd4084070b3eaa`, tree `9ede78e7d5c4f28269a0a11dc1a4e381c53a3772`; both author and committer are `surgeservicesllc@gmail.com`. CI run `31692336607` passed both the quality and browser/accessibility jobs.
- Matching Vercel deployment `dpl_6Aiygdb9r1B4PCUefLahBKgadAHb` is READY at immutable URL `https://softwarefactory-3yg1d1bsf-surgeservices-projects.vercel.app` and stable alias `https://softwarefactory-tan.vercel.app`.
- Production checks passed 48/48, security headers were present, protected unauthenticated APIs were denied, an invalid webhook returned 401, nine JavaScript assets contained no privileged markers, and no recent deployment errors were found.
- No hosted migration or authenticated live-provider acceptance evidence has been produced for migrations `011`-`025` or the GitHub workflow.

## Release blockers

1. Obtain exact owner approval for production migrations `011`-`025` and webhook secret/provider activation; apply only to `qpuofpmagrmyamahqwxw`, and run every post-apply check.
2. Complete real production sign-in, email confirmation, onboarding, active-organization, and caller-session acceptance.
3. Complete the authenticated GitHub callback, tenant connection/repository sync, project link, branch/commit/PR/check views, file read, safe edit/draft PR, stale/protected/idempotent/recovery cases, and disconnect/loss handling.
4. Configure/verify the active GitHub webhook and observe valid, invalid, duplicate, out-of-order, deletion, and restore behavior in production.
5. Keep GitHub **Not Connected**, Phase 1B incomplete, Phase 1C unstarted, and all automatic actions OFF until that evidence exists.
