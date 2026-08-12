# Current state

Last reviewed: 2026-08-12

Phase: 1B — Production GitHub App Integration

Overall status: **Implementation and hosted schema gates pass; authenticated tenant and live GitHub production acceptance pending**

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
- No merge, deploy, rollback, Codex, or Claude executor is present.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) was verified `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, and `009` were applied successfully; linked migration history matches local history.
- `supabase db lint --linked --schema public --level warning --fail-on error` reports no schema errors (`[]`). Migration application and hosted static schema lint are green; authenticated cross-tenant, anonymous-denial, privileged-RPC, audit, and real application-session checks remain pending.
- Migration `009_harden_github_project_and_sync` serializes synchronization by external installation ID before first-or-existing connection creation, re-resolves the authoritative installation binding after upsert, and forces project links to use the synchronized GitHub default branch.
- A read-only hosted catalog query returned 22 public tables, 22 with RLS, 22 with FORCE RLS, 43 policies, and 22 row-secret guards. The subsequent linked migration list confirms all eight expected migrations through `009`.
- Phase 1B adds `github_installations`, `github_repositories`, `github_webhook_deliveries`, and `github_change_requests`, all with RLS and FORCE RLS, plus audited privileged workflows and transactional project linking.
- Hosted Auth uses exact production/local callbacks, confirmed email sign-up, anonymous sign-in OFF, minimum password length 12, JWT expiry 3600, secure password changes, rate limits, eight-digit OTPs, and TOTP enabled.
- GitHub/Supabase privileged credentials are stored in Vercel server-side environment settings, not source or database rows.
- Preview Supabase configuration has not been independently verified.

## Live/configuration status

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Schema connected; behavioral gate pending | Project is healthy; local/remote migrations match through `009`; linked public-schema lint is clean. Hosted authenticated RLS allow/deny and real app-session verification remain. |
| GitHub App object/secrets | Configured | `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) exists and server-only values are in Vercel. |
| GitHub App connection | **Not Connected** | Permissions/events/environment values are configured, but no installation/callback/repository sync/file-to-draft-PR acceptance journey has passed. Provider webhook endpoint still appears blank/inactive and no real signed delivery is verified. |
| Vercel UI hosting | Verified baseline | Project `surgeservices-projects/softwarefactory` and stable alias are verified; the final Phase 1B commit/deployment ID and live acceptance remain pending. |
| Vercel deployment/rollback adapter | **Not Connected** | Hosting does not create an in-product deploy or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Verification evidence after the latest hardening

| Gate | Evidence | Result |
| --- | --- | --- |
| Unit | `npm run test:unit` | Pass — 58 tests on the hardened tree |
| Integration | `npm run test:integration` | Pass after `009` — 88 tests |
| Lint | `npm run lint` | Pass on the hardened tree |
| Type safety | `npm run typecheck` | Pass on the hardened tree |
| Full Vitest | `npm test` | Pass — 16 files, 146 tests |
| Production build | `npm run build` | Pass — 34 pages/routes |
| Hosted migration push | linked Supabase push/list | Pass — local=remote for `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009` |
| Hosted database lint | `supabase db lint --linked --schema public --level warning --fail-on error` | Pass — no schema errors (`[]`) |
| Playwright | `npm run test:e2e` | Pass — 12/12 desktop/tablet/mobile, navigation, overflow, browser-error, and axe checks |
| Secret/client scan | tracked/built asset review on hardened tree | Pass — no credential patterns or built-client privileged server names; only `.env.example` is tracked |
| Live GitHub acceptance | production checklist | Pending; **Not Connected** |
| Final Phase 1B Vercel release | exact commit/deployment/smoke | Pending |

The local shell used Node 20 and emitted Supabase's future-support warning. The repository, CI, and intended production runtime target Node 22 or newer.

## Known limitations and release blockers

- Verify hosted authenticated RLS/FORCE RLS, cross-tenant/anonymous denial, privileged-RPC authorization, audit behavior, and a real application session.
- Commit/deploy the exact Phase 1B tree and record the production commit/deployment ID.
- Complete real Supabase sign-in/onboarding.
- Install the GitHub App on the intended account/repository and verify callback, repository sync, project link, reads, safe edit/draft PR, webhooks, audit, error/revocation paths, and disconnect.
- Configure and verify the GitHub webhook endpoint (the provider page still shows blank/inactive) and observe a valid signed production delivery.
- Supabase Preview environment isolation remains unverified.

No documentation/UI may change GitHub to Connected or Phase 1B to complete until these blockers have evidence.
