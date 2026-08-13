# Security guide

SoftwareFactory treats the browser, repository content, Supabase rows, GitHub responses/webhooks, workflow events, model/provider output, and process output as untrusted. Next.js server code authorizes user intent; Supabase RLS independently enforces tenants; the worker must separately claim and revalidate its lease and repository snapshot.

## Non-negotiable rules

- Credentials never enter browser code, source control, prompts, model output, Supabase rows, reports, fixtures, screenshots, or logs.
- Every command binds the authenticated active organization to one connected project and immutable GitHub repository ID/base SHA.
- Command submission is owner-only. Browser input cannot lower prompt/acceptance-criteria risk or choose provider, model, logical role, budget, workflow, repository, or branch.
- RED commands never execute in Phase 1C, including when approval evidence exists.
- RLS and FORCE RLS remain enabled for every exposed table; service role never proves caller isolation.
- Worker claims require exact worker ID, lease UUID, expiry, attempt, cancellation checks, and per-logical-agent serialization.
- Repository/App tokens are short-lived and scoped to one repository ID and minimum permissions.
- Workspaces are dedicated, identity-marked, path-contained, and rejected on remote/branch/base-SHA mismatch.
- Codex runs workspace-write with approval `never`, workspace network disabled, web search disabled, bounded turns/tokens/time, and an isolated home.
- Validation uses the exact pinned Docker image, ignores dependency install scripts, and runs deterministic checks with network none and resource/security constraints.
- Changed files fail closed on escape/forbidden paths, symlinks, binaries, likely secrets, missing protected-path approval, excessive count, or excessive size.
- Publication creates or recovers only an open draft PR from a `factory/*` branch. Default-branch write, approval, merge, deployment, rollback, workflow/provider administration, and secret-setting are absent.
- Events, artifacts, and validations are append-only; branch/commit/draft-PR recovery must be complete and coherent, and persisted output is bounded and redacted.
- Completion, queued cancellation, and exhausted stale leases create bounded structured reports; cancellation wins at the completion safe boundary and report PR links are reconstructed from authoritative database rows.
- Autonomous Mode and every automatic action remain OFF; the global kill switch remains ON.

## Protected release boundary

Ledger repair for catalog-proven `028`/`130001`-`130005`, application of absent `130006`-`130011`, provider/worker credentials, publication of the secret-bearing workflow, and activation of any outbound provider/workflow are RED protected changes. Exact current owner approval must name the target, scope, risk, expiry, validation, and containment plan. Urgency, old approval, or approval of another phase is not enough.

The required Actions secret names use `SOFTWAREFACTORY_*`; GitHub forbids Actions secret names beginning `GITHUB_`. The workflow maps App secrets to runtime `GITHUB_*` names only in the worker step and must never echo values. `SOFTWAREFACTORY_REQUIRED_CHECKS` must exactly name `Lint, typecheck, test, and build|Browser and accessibility tests`; missing, renamed, incomplete, unstable, or non-success required checks fail closed. The separate repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` is a fail-closed activation gate: missing/false skips every job, and literal `true` requires exact owner RED approval only after hosted migrations, secrets, publication, ordinary CI, and the matching Vercel deployment are verified.

## Current limits

Hosted Supabase contains schema effects `028`/`130001`-`130005` but its ledger still has exactly 26 rows through `027`; a normal push is prohibited until owner-approved reconciliation proves each mapping. Phase 1D `130006` and Phase 1C `130007`-`130011` are unhosted. The local Phase 1C branch is unpublished; repository Actions secrets/variables are absent; only CI exists on `main`; and the current Supabase CLI profile returns `403`. No production observation, provider call, heartbeat, or real Codex run exists. Phase 1D remains kill-ON/all-actions-OFF and **Not Connected**; neither advisory provider execution nor the Codex worker is live.

See [Security model](SECURITY_MODEL.md), [Environment variables](ENVIRONMENT_VARIABLES.md), [Database migrations](DATABASE_MIGRATIONS.md), [GitHub App integration](GITHUB_APP_INTEGRATION.md), and [`policies/PROTECTED_RESOURCES.md`](../policies/PROTECTED_RESOURCES.md). Report vulnerabilities through the private process in repository-root [`SECURITY.md`](../SECURITY.md).
