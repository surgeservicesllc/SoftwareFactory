# Architecture overview

SoftwareFactory is a server-first Next.js control plane. Phase 1B adds authenticated, tenant-scoped GitHub App integration without adding autonomous merge, deployment, rollback, Codex, or Claude execution.

## Components

| Component | Responsibility | Trust level/status |
| --- | --- | --- |
| Browser UI | Present safe state and collect intent | Untrusted client |
| Next.js server | Authenticate, authorize, validate, redact, and coordinate provider operations | Trusted application boundary |
| Supabase Auth/Postgres | Identity, organizations, projects, GitHub metadata, RLS, and audit evidence | Trusted persistence boundary; migrations/lint green, authenticated tenant behavior pending |
| GitHub App adapter | Sign App JWTs, mint repository-scoped installation tokens, normalize provider responses | Server-only; provider installation `153286187` is repository-scoped, but in-product callback/connection remains pending |
| GitHub webhook route | Verify raw-body HMAC, deduplicate delivery IDs, store redacted payloads, reconcile state | Implemented; live delivery not yet verified |
| Vercel | Serve Next.js application and server functions | Deployment `dpl_33dEW1EM6x8ofqqHYtm5CaKUznSh` READY with stable-production E2E 12/12; deploy/rollback adapter **Not Connected** |
| AI workers | Future task execution | Codex and Claude **Not Connected** |

## Authenticated request path

1. Supabase Auth resolves the server-side user session.
2. The server resolves the active organization and verifies membership/role.
3. RLS independently restricts tenant rows.
4. A GitHub request verifies the selected connection and repository belong to that tenant.
5. The server mints a short-lived installation token scoped to that single repository and the exact requested permissions.
6. GitHub output is schema-validated, normalized, and returned without token material.
7. Mutations reserve an idempotent database record and append audit evidence.

Installation synchronization is serialized by external installation ID before connection creation and re-reads the post-upsert installation row as the authoritative tenant/connection binding. Repository full names are normalized and compared literally rather than through SQL wildcard matching. Project links persist only the synchronized GitHub default branch; any caller-supplied branch is an optimistic freshness expectation.

## GitHub installation flow

```text
Authenticated owner/admin
  -> POST /api/github/install/start
  -> signed 10-minute state + HttpOnly nonce cookie
  -> GitHub App installation and user authorization
  -> GET /api/github/install/callback
  -> verify state, user access, App identity, installation, repositories
  -> revoke ephemeral user OAuth token
  -> persist installation/repository metadata and activity evidence
```

The App private key, client secret, state secret, webhook secret, user OAuth token, and installation token never enter application tables or the browser.

## Controlled file-change flow

```text
Open selected repository file at verified ref/SHA
  -> reject protected resource classes and likely secrets
  -> verify project + connection + default branch
  -> reserve idempotency key
  -> create softwarefactory/* branch from current default-branch SHA
  -> update file using expected blob SHA
  -> create draft pull request
  -> persist commit/PR evidence
```

The standard route cannot write directly to the default branch, create a non-draft PR, merge, or deploy. A stale file SHA fails closed rather than silently overwriting changes.

## Webhook path

The webhook route reads at most 2 MiB, verifies `X-Hub-Signature-256` over raw bytes, validates delivery/event headers and payload shape, hashes the full payload, stores only a redacted subset, and deduplicates on the delivery ID. Unknown events and unknown installations are retained as ignored evidence. The accepted Phase 1B events are documented in [GitHub App integration](GITHUB_APP_INTEGRATION.md).

## Data architecture

Migrations `001`-`003` define the Phase 1A control plane. Phase 1B adds GitHub installations, repositories, webhook deliveries, guarded change requests, authenticated onboarding, and transactional project/repository linking. Additive migrations `008` and `009` repair synchronization ambiguity, serialize installation sync, re-resolve the authoritative binding, and force synchronized-default-branch project linking. Hosted migration `010` locks observation controls fail closed; it does not connect execution. Every exposed table has RLS and FORCE RLS; privileged webhook/RPC use remains server-only and independently tenant-checked.

## Deployment boundary

Vercel serves the UI and server routes. It does not provide a SoftwareFactory deployment executor. The repository CI validates only and has no merge/deploy permission. Durable AI work cannot rely on a Vercel request lifetime and is deferred to Phase 1C.

See `AI/ARCHITECTURE.md`, `AI/DECISIONS.md`, [Security model](SECURITY_MODEL.md), and the files under `policies/` for deeper contracts.
