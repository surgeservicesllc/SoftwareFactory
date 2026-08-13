# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful **Demo Data**/**Not Connected** states, tenant model, Supabase/RLS/audit foundations, risk/approval controls, CI, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B - Production GitHub App Integration

Status: **Hosted migrations are verified through `026`, owner Auth/onboarding succeeds, and installation `153445938` is connected to exactly `surgeservicesllc/SoftwareFactory`. The live owner connection/project/read/draft-write/audit path passes. The webhook remains Not Connected and the live second-tenant/failure matrix remains incomplete.**

Implemented in source:

- Supabase Auth/onboarding/active organization and caller-RLS tenant surfaces.
- GitHub App installation/callback/token/sync/disconnect boundaries and bounded repository reads.
- Signed/idempotent/redacted webhook ingress, provider-time lifecycle ordering, and terminal deletion safeguards.
- Transactional project linking and provider-authoritative repository/default-branch propagation by immutable repository UUID.
- Bounded caller-member list RPC projections, raw Activity/webhook direct-read closure, same-origin command creation, allowlisted activity details, restrictive browser CSP, installation-ID/repository-selection visibility, and live Projects metadata/check visibility including stable repository-ID matching, detail-fetched PR mergeability, and per-PR head-SHA checks.
- Controlled branch + commit + draft-PR file changes with stable same-intent idempotency, exact-binding reservation, terminal audit evidence, provider-evidence completion recovery, and generic secret-assignment detection. Protected-file changes require an exact, short-lived, owner-only RED approval revalidated before write-token minting; merge/default-branch/deploy authority remains absent.
- Commit-attribution hardening requires one strictly validated server-only deployment identity, sends it as both author and committer, and has no App-bot fallback. Production/Preview configuration and ordinary/protected live draft attribution are verified.
- Transaction-serialized stable repository linking rejects concurrent active duplicates and permits relink after archival.
- Hosted forward migrations `011`-`026`, including the verified `service_role` table-grant remediation.

Verified application-release evidence recorded 2026-08-13: commit `0bd048565a9e002848c5553ccbe43ab0e217780e` (tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`), green CI run `31704289754`, and READY Vercel deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` at `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app` and the stable production alias. Later documentation-only successors do not invalidate this runtime evidence unless application code changes.

Remaining exit work:

1. Make GitHub retain the exact active webhook URL and accept a valid signed delivery; invalid signatures already fail closed.
2. Verify two-tenant/anonymous/RPC/audit/provider-ingress behavior with real caller sessions. Only one actual user/email is currently authorized, so local behavioral tests do not replace this live matrix.
3. Exercise the remaining live failure/disconnect cases, including stale SHA, role/approval expiry, revoked/insufficient permission, rate limit, provider ordering, terminal deletion/restore, and preserved history.

No merge or production deployment autonomy is implied. The repository connection is live; the webhook, Phase 1C, Phase 2, and every automatic action remain **Not Connected** or OFF as applicable.

## Phase 1C - Codex execution

Status: **Not Connected; not started.**

- Future durable provider-neutral worker, leases/heartbeat/cancellation/idempotency, isolated workspaces, budgets/timeouts, sandbox/network controls, redacted traces, and bounded human-reviewed work.
- Do not begin until Phase 1B exits and the owner explicitly authorizes the phase.

## Phase 1D - autonomous-loop controls

Status: **Observation-only scaffold; execution not started and controls remain OFF.**

- Autonomous Mode constrained OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF, evaluator always `executionAllowed: false`.
- Hosted migration `010` contains the current fail-closed controls. No action executor exists.

## Phase 2 - Claude and governed delivery

Status: **Not Connected; not started.**

- Future supported Anthropic API connections and logical roles, not consumer-account browser automation.
- Preview validation and separately approved governance precede any delivery automation.

## Later measured autonomy

- Narrow GREEN automation only after sustained non-production evidence, explicit allowlists, budgets, alerts, kill switches, and owner-approved policy.
- RED actions remain owner-controlled absent a future independently reviewed policy revision.
