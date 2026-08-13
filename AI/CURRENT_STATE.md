# Current state

Last reviewed: 2026-08-13

Phase: 1B - Production GitHub App Integration

Overall status: **Hosted Supabase is verified through `026`, owner Auth/onboarding succeeds, and primary installation `153445938` remains connected to exactly `surgeservicesllc/SoftwareFactory`. The live owner connection, project, repository reads, ordinary/protected draft-only writes, likely-secret rejection, and immutable Activity evidence pass on exact application commit `0bd048565a9e002848c5553ccbe43ab0e217780e`. Candidate App `4582606` (`surge-softwarefactory-next`) now retains the exact active webhook configuration and has an isolated Sensitive Production/Preview configuration in Vercel. The dual-App routing and atomic reversible handoff implementation plus migration `027` pass the full local check at 56 files/436 tests and a 38-route build, but are not committed, deployed, or hosted. The candidate is not installed, has no signed processed delivery, and no project handoff has occurred. Existing App `4573846`/installation `153445938` therefore remains the live path; its webhook is still broken under OPEN Support ticket `#4660724`. The webhook capability, live second-tenant matrix, and Phase 1B acceptance remain incomplete.**

"Implemented" below means code/schema exists in the verified application release. It does not mean the provider workflow was observed or the schema is hosted.

## Current local replacement cutover (pre-release)

- A second, owner-only GitHub App is registered as `Surge SoftwareFactory Next` (`surge-softwarefactory-next`, App ID `4582606`). It retains the exact callback and active webhook URL after reload, uses the Phase 1B least-privilege permissions/events, and has distinct server-only candidate values stored as Sensitive in Vercel Production and Preview.
- The uncommitted local tree adds all-or-nothing, cryptographically isolated `primary`/`candidate` App configuration; App-slot/App-ID-bound installation state; installation-App-ID token routing; dual-secret webhook verification with persisted App-ID provenance checks; candidate install UI; and an owner-only exact-confirmation handoff route.
- Local migration `20260812002700_handoff_github_project_connection.sql` atomically rebinds an existing project/link between two active installations for the same provider account and immutable external repository, preserves IDs/history, serializes against change reservations, records immutable evidence, requires a processed signed target-installation delivery before first handoff, and supports an evidence-bound reverse handoff while both installations remain active.
- `npm run check` passes for this working tree: lint, typecheck, 56 Vitest files/436 tests, and a 38-route production build.
- This is pre-release evidence only. Migration `027` is not hosted; the candidate code is not committed/deployed; App `4582606` is not installed; no callback/sync, signed processed candidate delivery, handoff, post-handoff reads/writes, or reverse/disconnect observation has passed.

## Implemented application boundaries

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4, server-first Auth/tenant/provider boundaries, and caller-session Supabase RLS reads.
- Supabase sign-up/sign-in/magic-link/sign-out/callback/onboarding, organization membership, and active-organization selection.
- GitHub App installation start/callback, short-lived repository-ID-scoped installation tokens, bounded repository reads, signed/idempotent/redacted webhooks, transaction-serialized project linking by stable repository UUID, and an isolated branch + commit + draft-PR-only file-change flow.
- Every interactive GitHub route is bound to the caller's exact active organization. Revoked or insufficient-permission token creation is persisted best-effort as connection loss; rate-limit errors do not falsely revoke the connection.
- Callback browser failures return safely to Connections with bounded error state; JSON callers retain structured no-store errors. GitHub-returned web URLs are restricted to HTTPS `github.com` origins.
- Connections and dashboard states do not hard-code a personal account and show **Not Connected** when live GitHub evidence is absent. The current owner connection shows its real installation ID and repository-selection mode.
- Ordinary file changes require owner/admin authorization, keep one idempotency key for an unchanged retry intent, and can recover an already-created draft PR after an ambiguous database-completion response. Protected paths fail closed unless an active owner supplies the exact short-lived RED approval phrase, rationale, and rollback plan; generic non-placeholder secret assignments and provider-token patterns remain blocked, and the only provider outcome remains a draft PR.
- The deployed write boundary requires a strictly validated server-only commit identity before authorization, persistence, token minting, or provider mutation, and sends that same identity as both GitHub author and committer. It has no App-bot fallback and is never browser-, database-, or log-visible. Production and Preview configure the owner-approved identity; live ordinary and protected draft commits verify both fields.
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

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was last verified `ACTIVE_HEALTHY`. The currently selected local Supabase CLI profile is now unauthorized or associated with the wrong account for a fresh recheck; it was not used for any mutation. The prior verified hosted-through-`026` evidence below remains recorded, and any new linked database command must wait until the CLI is reauthenticated as `surgeservicesllc@gmail.com` and the exact project ref is reconfirmed.
- Hosted migration history is current through `026`, including `001`-`005` and `007`-`026`; the repository additionally contains local migration `027`, which is not hosted. Local and remote hosted history matched before `027` was added.
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
- The authenticated owner application session passes. Only one actual user/email is authorized, so a live second tenant was intentionally not created; local behavioral tests cover tenant denial, but real two-tenant/anonymous/RPC acceptance remains pending.
- Privileged GitHub/Supabase secrets remain in server-side Vercel settings, not source, browser code, logs, fixtures, or database rows.

## Provider and release truth

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Previously verified through migration `026`; fresh CLI recheck unavailable under the currently selected wrong/unauthorized profile | Recorded post-`026` dry run and lint are clean. Prior catalog evidence is 23/23 RLS+FORCE with 32 policies, zero policyless tables, 22 secret guards, and tested raw browser grants false. Exact ACL mismatch count is zero; `service_role` has SELECT/INSERT/UPDATE on four GitHub ingress tables and no table privileges on the other 19. No mutation used the current CLI profile. |
| GitHub App object/secrets | Configured | App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) and protected server variable names exist. Production and Preview commit-identity variable names are configured without exposing secret material. |
| Candidate GitHub App object/secrets | Configured candidate; **Not Connected** | Owner-only App `Surge SoftwareFactory Next` (`surge-softwarefactory-next`, App ID `4582606`) retains the exact callback and active `https://softwarefactory-tan.vercel.app/api/github/webhooks` endpoint. Its distinct `GITHUB_CANDIDATE_APP_*` names are Sensitive in Vercel Production and Preview. Candidate code is not deployed and the App is not installed. |
| GitHub provider installation | Connected; repository-scoped | Installation `153445938` is connected to `surgeservicesllc` and selects exactly `surgeservicesllc/SoftwareFactory`. |
| GitHub App connection | Connected for the owner repository path | Connection `d17c63a9-d995-481e-98ce-b737efb32ce5` and project `b1f23696-437e-4d89-b55f-d7a949980e8f` passed callback, sync, branches/commits/checks/PRs/tree/file reads, ordinary/protected draft writes, secret rejection, and Activity verification. |
| GitHub webhook | **Not Connected** | Primary App `4573846` still reloads blank/inactive and remains tracked by OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724). Candidate App `4582606` retains the exact active endpoint, but its dual-secret ingress code is not deployed, the App is not installed, and no valid signed processed production delivery exists. Provider configuration alone is not connection evidence. |
| Supabase Auth owner | Confirmed and authenticated | `surgeservicesllc@gmail.com` completed onboarding; the SoftwareFactory organization/workspace and owner membership exist. Only this real user/email is authorized for live acceptance. |
| Vercel UI hosting | Current production READY | `dpl_AEirYPnCrKemJjiFX7bKGc7626jX`, immutable `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app`, stable alias, source exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e`. Deploy/rollback adapter remains **Not Connected**. |
| Vercel deploy/rollback adapter | **Not Connected** | Hosting the UI is not an in-product deployment or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Verification evidence

- Current pre-release `npm run check` passes lint/typecheck, 56 files/436 Vitest tests, and a 38-route production build. Those results cover the local dual-App/handoff implementation; they do not supersede production release `0bd0485` until publication and deployment.
- Hosted migration `026` is applied; pre-`027` local/remote history matched, and post-apply dry run/lint plus the exact ACL matrix pass.
- Local and exact production Playwright each pass 48/48 across desktop, tablet, and mobile, including axe checks. The production signed-out browser-error race additionally passes 30/30 repeated runs.
- The verified application-release source and rebuilt-static scans found zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present. The candidate cutover tree still requires its publication-time source/tracked-file/rebuilt-client scan.
- Verified application release `0bd048565a9e002848c5553ccbe43ab0e217780e` has tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0`; both author and committer are `surgeservicesllc <surgeservicesllc@gmail.com>`. CI run `31704289754` passed both the quality and browser/accessibility jobs.
- Production deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY at `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app` and the stable alias, sourced from exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e`. That artifact is primary-only; it does not contain the candidate cutover implementation.
- Post-rotation production Playwright passes 48/48; nine JavaScript assets contain zero forbidden markers and recent deployment logs contain zero errors. Focused race 30/30, HTTP/security checks, and exact-commit CI run `31704289754` remain green.
- Later documentation-only successors do not supersede this application/runtime evidence unless application code changes.
- Hosted evidence is current through `026`, and owner onboarding is confirmed. Installation `153445938`, connection `d17c63a9-d995-481e-98ce-b737efb32ce5`, and project `b1f23696-437e-4d89-b55f-d7a949980e8f` pass the live repository journey. Connections, Projects, Files, and Activity show real repository sync, branches, commits, checks, pull requests, tree/content, and immutable transitions.
- Ordinary draft PR `#6` (commit `e789303`) and owner-approved protected RED draft PR `#7` (commit `6a808de`) are open, draft, and unmerged. Both use `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer. Earlier App-bot-attributed PRs `#4` and `#5` were closed unmerged and their isolated branches were deleted; `main` stayed unchanged.
- A fake generic password assignment was rejected before any pull request. Primary invalid-signature handling returns `401` with private no-store behavior. Documented App-JWT `PATCH /app/hook/config` for App `4573846` still returns `404`, and its owner UI reports success but reloads blank/inactive. Candidate App `4582606` retains the active URL but has not produced a signed processed delivery.
- GitHub Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724), subject **GitHub App 4573846 cannot retain its single webhook**, was submitted 2026-08-13 under `surgeservicesllc` and remains OPEN as the primary-App defect record. The active candidate endpoint is the supported replacement path; it still requires code/schema promotion, exact installation, and signed-delivery acceptance before handoff.
- The temporary downloaded App PEM and ignored provider-verification helper scripts were deleted after use; no secret or helper artifact remains in the repository checkout.

## Release blockers

1. Review, commit, and publish the dual-App implementation; deploy the exact artifact; then apply and verify migration `027` against hosted project `qpuofpmagrmyamahqwxw` using the authorized `surgeservicesllc@gmail.com` operator identity.
2. Install candidate App `4582606` for exactly `surgeservicesllc/SoftwareFactory`, pass callback/sync/read acceptance, and observe a valid signed processed delivery for that exact installation before owner handoff.
3. Execute the exact owner-confirmed atomic handoff, verify project/history continuity plus post-handoff reads and draft-only write boundaries, observe the rollback window, and verify reverse/disconnect behavior before retiring any primary-App access. Keep Support ticket `#4660724` open as the primary-App defect record.
4. Complete the live second-tenant/anonymous/RPC matrix and remaining failure/lifecycle cases. Keep Phase 1B incomplete, Phase 1C/Phase 2 **Not Connected**, Autonomous Mode OFF, the global kill switch ON, and every automatic action OFF until all gaps close.
