# Current state

Last reviewed: 2026-08-12

Phase: 1B — Production GitHub App Integration

Overall status: **Production deployment and repository-scoped GitHub App installation verified; authenticated in-product connection, webhook, and remaining tenant acceptance pending**

“Implemented” below means code/schema exists in the current tree. It does not mean the real provider workflow was observed.

## Implemented application boundaries

- Next.js 16.3, React 19.2, TypeScript strict mode, App Router, and Tailwind CSS 4.
- Supabase email/password sign-up/sign-in, existing-user magic link, sign-out, callback exchange, onboarding, organization creation, membership resolution, and active-organization selection.
- Tenant-scoped live project API/UI. Owner/admin can create a safe-default project only from a selected repository on an active GitHub connection.
- GitHub App install start/callback with same-origin protection, signed ten-minute state, HttpOnly nonce cookie, user authorization verification, exact App/installation verification, and best-effort ephemeral user-token revocation.
- Server-only App JWT/private-key handling and short-lived installation tokens scoped to one repository ID and exact route permissions.
- Connection/repository synchronization, status/freshness visibility, explicit disconnect confirmation, history preservation, and connection-loss handling.
- Tenant-authorized repository branches, commits, pull requests, checks, trees, and UTF-8 file reads.
- Guarded file change route: validates project/connection/default branch/path/content/SHA/idempotency, rejects likely secrets and a broad protected-resource set (`AI/**`, `policies/**`, Supabase, every `app/api/**` route, GitHub/server/Supabase libraries, Auth/session code, deployment/environment/infrastructure files, and other security-sensitive subject paths), creates a `softwarefactory/*` branch, commits there, and requires an open draft PR.
- Repository authorization compares normalized GitHub full names literally rather than through SQL wildcard matching. Project creation persists only the synchronized GitHub default branch; a caller-supplied branch is a freshness expectation and cannot override provider state.
- GitHub webhook route with 2 MiB bound, raw-body HMAC verification, validated headers/payload, delivery-ID/payload-hash replay protection, redacted storage, and bounded database reconciliation.
- Connections, Projects, Files, and dashboard surfaces consume live tenant records when configured; demo records remain labeled **Demo Data**.
- Phase 1D observation-only scaffolding is present: a pure GREEN prerequisite evaluator, tenant-scoped GET/owner-only same-origin PATCH controls, a locked static safety surface, and hosted migration `010` that keeps Autonomous Mode OFF, the global kill switch ON, and every automatic action OFF. No evaluator result can execute work.
- No merge, deploy, rollback, Codex, or Claude executor is present.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was verified `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` were applied successfully; the hosted migration ledger includes `010`.
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
| Vercel UI hosting | Production deployment verified | Deployment `dpl_436vwUxUAuypnRmCstgptQa2qfve` from commit `3dfdbf35daeff7a79e09a41e5070e521b23d83f9` is READY/Current at `https://softwarefactory-tan.vercel.app`; stable-production Playwright passed 12/12. This is hosting evidence, not an in-product deploy/rollback adapter or full provider acceptance. |
| Vercel deployment/rollback adapter | **Not Connected** | Hosting does not create an in-product deploy or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |
| Phase 1D observation scaffold | Hosted controls; execution blocked | GREEN-only policy observation; hosted global kill switch locked ON; both safety constraints validated; automatic actions OFF; worker **Not Connected**. |

## Verification evidence after the latest hardening

| Gate | Evidence | Result |
| --- | --- | --- |
| Unit | `npm run test:unit` | Pass — 58 tests on the hardened tree |
| Integration | `npm run test:integration` | Pass after `009` — 88 tests |
| Lint | `npm run lint` | Pass on the hardened tree |
| Type safety | `npm run typecheck` | Pass on the hardened tree |
| Full Vitest | `npm test` | Pass — 157 tests on the latest tree after the Phase 1D observation scaffold |
| Production build | `npm run build` | Pass — 34 pages/routes |
| Hosted migration application | Supabase SQL Editor + hosted ledger | Pass through `010`; transactional preflight/application and safety checks recorded |
| Hosted database lint | linked CLI | Pass through `009` — no schema errors (`[]`); post-`010` attempt blocked by CLI-account `403`, not claimed |
| Playwright | `npm run test:e2e` | Pass — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, and axe checks |
| Secret/client scan | tracked/built asset review on hardened tree | Pass — no credential patterns or built-client privileged server names; only `.env.example` is tracked |
| Stable production Playwright | `PLAYWRIGHT_BASE_URL=https://softwarefactory-tan.vercel.app npm run test:e2e` | Pass — 12/12 against deployment `dpl_436vwUxUAuypnRmCstgptQa2qfve` from `3dfdbf35daeff7a79e09a41e5070e521b23d83f9` |
| Live GitHub acceptance | production checklist | Pending; **Not Connected** |
| Phase 1B/1D Vercel deployment | deployment identity/readiness/public E2E | Pass — `dpl_436vwUxUAuypnRmCstgptQa2qfve`, READY/Current from `3dfdbf35daeff7a79e09a41e5070e521b23d83f9`, stable alias 12/12 |

The local shell used Node 20 and emitted Supabase's future-support warning. The repository, CI, and intended production runtime target Node 22 or newer.

## Known limitations and release blockers

- Verify hosted authenticated RLS/FORCE RLS, cross-tenant/anonymous denial, privileged-RPC authorization, audit behavior, and a real application session.
- Keep the final documentation-only evidence commit on `main`; application code commit `3dfdbf35daeff7a79e09a41e5070e521b23d83f9` is the verified READY/Current runtime source.
- Complete real Supabase sign-in/onboarding.
- Complete the authenticated owner callback for provider installation `153286187`, persist the organization connection, and verify repository sync, project link, reads, safe edit/draft PR, audit, error/revocation paths, and disconnect.
- Configure and verify the GitHub webhook endpoint. The provider General form is blank/inactive and App-authenticated hook configuration returns `404`/no hook object; observe a valid signed production delivery before changing its status.
- Supabase Preview environment isolation remains unverified.
- Restore an authorized Supabase CLI account and rerun linked public-schema lint after `010`; retain the hosted kill-switch/constraint/RPC checks. This does not authorize an executor.

No documentation/UI may change GitHub to Connected or Phase 1B to complete until these blockers have evidence.
