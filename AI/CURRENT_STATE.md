# Current state

Last reviewed: 2026-08-13

Phase: 1B - Production GitHub App Integration

Overall status: **Hosted Supabase is verified through `026`, and owner Auth/onboarding now succeeds. Current production `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77` is READY from `main` `3434387`, but its GitHub callback failed on nonexistent `GET /user/installations/{id}`. A bounded list-and-exact-ID fix passes locally but is unpublished. GitHub and webhook remain Not Connected.**

"Implemented" below means code/schema exists in the verified application release. It does not mean the provider workflow was observed or the schema is hosted.

## Implemented application boundaries

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4, server-first Auth/tenant/provider boundaries, and caller-session Supabase RLS reads.
- Supabase sign-up/sign-in/magic-link/sign-out/callback/onboarding, organization membership, and active-organization selection.
- GitHub App installation start/callback, short-lived repository-ID-scoped installation tokens, bounded repository reads, signed/idempotent/redacted webhooks, transaction-serialized project linking by stable repository UUID, and an isolated branch + commit + draft-PR-only file-change flow.
- Every interactive GitHub route is bound to the caller's exact active organization. Revoked or insufficient-permission token creation is persisted best-effort as connection loss; rate-limit errors do not falsely revoke the connection.
- Callback browser failures return safely to Connections with bounded error state; JSON callers retain structured no-store errors. GitHub-returned web URLs are restricted to HTTPS `github.com` origins.
- Connections and dashboard states do not hard-code a personal account and distinguish the live Supabase control plane from a GitHub integration that is **Not Connected**. A real connection will show its installation ID and repository-selection mode.
- Ordinary file changes require owner/admin authorization, keep one idempotency key for an unchanged retry intent, and can recover an already-created draft PR after an ambiguous database-completion response. Protected paths fail closed unless an active owner supplies the exact short-lived RED approval phrase, rationale, and rollback plan; generic non-placeholder secret assignments and provider-token patterns remain blocked, and the only provider outcome remains a draft PR.
- The current local unpublished write boundary requires a strictly validated server-only commit identity before authorization, persistence, token minting, or provider mutation, and sends that same identity as both GitHub author and committer. It has no App-bot fallback and is never browser-, database-, or log-visible. Production configuration and live draft-commit attribution remain unverified.
- Change reservations expire after five minutes and may be reclaimed only for the exact original intent before the provider boundary is entered. The exact approval snapshot is bound to the reserved change, and the provider boundary is durably revalidated before the write-scoped installation token is minted; entry permanently prevents lease reclamation.
- Installation and repository webhook transitions are provider-time ordered. Deletion is terminal for an installation ID; repository deletion remains terminal until an explicit newer restore, and restored repositories stay unselected pending access synchronization.
- Provider-authoritative repository rename/default-branch changes propagate by stable repository UUID only to exact connection-linked projects and create redacted immutable activity evidence.
- Agents, commands, tasks, runs, and reports are read through bounded caller-member RPC projections; authenticated browser sessions no longer have direct SELECT on those sensitive base tables. Command creation also enforces same-origin requests.
- Authenticated direct reads of raw Activity and webhook-delivery rows are revoked. Activity uses a caller-member, row-limited RPC and returns only allowlisted, bounded GitHub/SoftwareFactory actor, source, resource, action, status, conclusion, and transition evidence; raw audit metadata and stored webhook subsets remain server-side. Webhook project attribution uses the stable repository UUID.
- Projects selects repositories by stable provider ID and renders live repository sync time, branch protection/SHA, commit author/date, PR author/created/updated time and detail-fetched mergeability, default-branch checks, and per-PR checks fetched against each displayed head SHA.
- Global browser headers include a restrictive CSP, framing/object denial, a narrow Supabase connection allowlist, and a narrow image allowlist; repository Markdown previews do not load external images.
- No direct default-branch write, merge, deployment, rollback, Codex worker, or Claude worker exists. The Phase 1D observation scaffold remains execution-inert: Autonomous Mode OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF.
- The signed-out dashboard receives a server-verified authentication hint so it skips protected browser fetches; the focused production race regression passes 30/30 repeated runs.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was last verified `ACTIVE_HEALTHY`; the CLI is authorized as `surgeservicesllc@gmail.com` and linked to this exact project.
- Hosted migration history is current through `026`, including `001`-`005` and `007`-`026`; local and remote history match.
- Hosted migrations `011`-`026` provide:
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
- `026` revokes all public-table privileges from `service_role` and restores only SELECT/INSERT/UPDATE on the four GitHub ingress tables.
- Post-apply verification reports an up-to-date dry run, clean linked lint, 23/23 public tables with RLS and FORCE RLS, 32 policies, zero policyless tables, 22 secret guards, and false tested raw authenticated/browser grants.
- Post-`026` hosted verification reports an exact ACL-matrix mismatch count of zero. `service_role` has only SELECT/INSERT/UPDATE on `github_installations`, `github_repositories`, `github_webhook_deliveries`, and `github_change_requests`, and no table privileges on the other 19 public tables.
- Authenticated two-tenant/RPC behavior and the complete real application session remain pending.
- Privileged GitHub/Supabase secrets remain in server-side Vercel settings, not source, browser code, logs, fixtures, or database rows.

## Provider and release truth

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Connected through migration `026`; local=remote | Post-`026` dry run and lint are clean. Prior catalog evidence is 23/23 RLS+FORCE with 32 policies, zero policyless tables, 22 secret guards, and tested raw browser grants false. Exact ACL mismatch count is zero; `service_role` has SELECT/INSERT/UPDATE on four GitHub ingress tables and no table privileges on the other 19. |
| GitHub App object/secrets | Configured | App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) and protected server variable names exist. Configuration is not a live tenant connection. |
| GitHub provider installation | Installed; repository-scoped | Latest installation `153442281` is App-JWT verified on `surgeservicesllc` and selects only `surgeservicesllc/SoftwareFactory`. |
| GitHub App connection | **Not Connected** | Production callback failed because deployed code used nonexistent `GET /user/installations/{id}`. The local unpublished fix uses bounded `GET /user/installations` plus exact-ID lookup; tenant persistence and the live repository journey remain unverified. |
| GitHub webhook | **Not Connected** | A GitHub App JWT validates App `4573846`, but `/app/hook/config` returns 404 and the UI does not retain activation. No active hook or valid signed production delivery is verified. |
| Supabase Auth owner | Confirmed and authenticated | `surgeservicesllc@gmail.com` completed onboarding; the SoftwareFactory organization/workspace and owner membership exist. No GitHub connection or project has been verified. |
| Vercel UI hosting | Current production READY | `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77`, immutable `https://softwarefactory-nd3orq8r6-surgeservices-projects.vercel.app`, stable alias, source `main` `3434387`. The local callback fix is not deployed; deploy/rollback adapter remains **Not Connected**. |
| Vercel deploy/rollback adapter | **Not Connected** | Hosting the UI is not an in-product deployment or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Verification evidence

- Current local `npm run check` passes lint/typecheck, 54 files/408 Vitest tests, and a 38-route production build.
- Hosted migration `026` is applied with local and remote history matching; post-apply dry run/lint and the exact ACL matrix pass.
- Local and exact production Playwright each pass 48/48 across desktop, tablet, and mobile, including axe checks. The production signed-out browser-error race additionally passes 30/30 repeated runs.
- Current-tree source and rebuilt-static scans found zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present. Code-variable and documented placeholder assignments were reviewed as non-credentials.
- Verified application release `edaaf625c497380611b80092526926b1457e15a0` has tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4`; both author and committer are `surgeservicesllc@gmail.com`. CI run `31694775758` passed both the quality and browser/accessibility jobs.
- Production deployment `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77` is READY at `https://softwarefactory-nd3orq8r6-surgeservices-projects.vercel.app` and the stable alias, sourced from `main` `3434387`. It predates the local callback fix. GitHub still does not retain an active webhook.
- Production checks passed the focused race 30/30 and full Playwright 48/48; tested pages returned 200 with CSP, HSTS, and X-Frame-Options; protected APIs and an invalid webhook returned 401; ten deployed assets (nine JavaScript and one CSS) contained no privileged markers; and deployment-log review found zero errors or HTTP 500s.
- Later documentation-only successors do not supersede this application/runtime evidence unless application code changes.
- Hosted evidence is current through `026`, and owner onboarding is confirmed. A successful post-fix callback, an active signed webhook, and authenticated live-provider acceptance remain absent.

## Release blockers

1. Publish the bounded callback fix, verify its exact deployment, then retry installation `153442281` from the authenticated owner session.
2. Configure and verify the active GitHub App webhook; GitHub must retain the exact URL and accept a valid signed production delivery.
3. Complete tenant isolation/RPC acceptance and the GitHub connection/repository/project/read/edit/draft-PR/disconnect journey.
4. Configure the exact owner-approved server-only commit identity in the deployment and verify both author and committer on the live draft commit.
5. Keep GitHub **Not Connected**, Phase 1B incomplete, Phase 1C unstarted, and all automatic actions OFF until that evidence exists.
