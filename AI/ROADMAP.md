# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful **Demo Data**/**Not Connected** states, tenant model, Supabase/RLS/audit foundations, risk/approval controls, CI, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B - Production GitHub App Integration

Status: **Hosted migration `027`, the deployed dual-App release, candidate App `4582606` installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, a post-sync processed candidate-signed delivery, and the atomic handoff of project `b1f23696-437e-4d89-b55f-d7a949980e8f` are live. Candidate-backed read and draft-only PR `#8` write acceptance passed; the PR stayed draft, passed CI/Preview, was closed unmerged, and its branch was deleted. Primary installation `153445938` remains active as rollback. Phase 1B remains incomplete for the live second-tenant and remaining adverse lifecycle/disconnect/reverse-observation matrix.**

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
- Deployed dual-App configuration/state/token/webhook isolation and hosted owner-only atomic reversible handoff migration `027`; live callback/sync/webhook/handoff/read/draft-write acceptance now passes for the candidate owner path.

Verified application-release evidence recorded 2026-08-13: commit `799d2cea189b6860a03987ae75c25765f9ac4aca` (tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`), green CI run `31716263910`, and READY Vercel deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` at `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app` and the stable production alias. Later documentation-only successors do not invalidate this runtime evidence unless application code changes.

Remaining exit work:

1. Observe the rollback window and execute the evidence-bound reverse-handoff check before retiring any primary access.
2. Verify two-tenant/anonymous/RPC/audit/provider-ingress behavior with real caller sessions. Only one actual user/email is currently authorized, so local behavioral tests do not replace this live matrix.
3. Exercise the remaining live failure/disconnect cases, including stale SHA, role/approval expiry, revoked/insufficient permission, rate limit, provider ordering, terminal deletion/restore, idempotent recovery, and preserved history.

No merge or production deployment autonomy is implied. The candidate repository connection and webhook are live for the owner path; the primary webhook remains impaired, Phase 1C and Phase 2 remain **Not Connected**, and every automatic action remains OFF.

## Phase 1C - Codex execution

Status: **Not Connected; not started.**

- Future durable provider-neutral worker, leases/heartbeat/cancellation/idempotency, isolated workspaces, budgets/timeouts, sandbox/network controls, redacted traces, and bounded human-reviewed work.
- Do not begin until Phase 1B exits and the owner explicitly authorizes the phase.

## Phase 1D - autonomous-loop controls

Status: **Observation-only scaffold; execution not started and controls remain OFF.**

- Autonomous Mode constrained OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF, evaluator always `executionAllowed: false`.
- Hosted migration `010` contains the current fail-closed controls. No action executor exists.

## Phase 1E - production operations

Status: **Control plane implemented and locally verified; no production-mutating executor exists and hosted migration `028` is not applied.**

Implemented in source and proven against the migrated schema:

- Provider-neutral monitoring with exactly one connected adapter (a bounded HTTPS probe that refuses private, loopback, and metadata addresses and never reads a response body). Every other provider is listed with the reason it is Not Connected and the condition that would unblock it. A monitor cannot be enabled unless its adapter is connected.
- Project health `healthy/degraded/critical/unknown/paused` derived from real signals, with append-only history and a stored reason. No connected monitor resolves to UNKNOWN, never HEALTHY.
- SEV1–SEV4 incidents created automatically from breached failure thresholds, deduplicated by fingerprint into one open incident per project, with upward-only severity escalation.
- Automatic release freeze on SEV1/SEV2, owner-only resume and organization-wide stop, and an unconditional `EXECUTOR_NOT_CONNECTED` blocker on release authority.
- Last Known Good resolved only from a deployment whose own post-deploy validation passed; rollback eligibility evaluated fail-closed against `policies/AUTO_ROLLBACK.md`; a failed rollback cannot be recorded without escalating to SEV1 with owner attention.
- A deterministic Production Investigator returning cause, cited evidence, subsystem, confidence, recommended action, and risk, with no intermediate reasoning produced or stored.
- Bounded self-healing: three attempts maximum, escalation on the third failure, and refusal to route RED or above-ceiling work around the risk policy. Assignment is recorded as Not Connected.
- A durable, idempotent operations event queue covering all ten required event types.
- Gated incident resolution: restoration, a passing same-project validation, root cause, corrective action, and prevention for SEV1/SEV2.
- Daily operational reporting, portfolio and per-project operations views, and an immutable operations audit trail.

Not implemented, and blocked rather than simulated:

1. Deployment and rollback execution — no provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off.
2. Codex repair execution — Phase 1C is **Not Connected**.
3. Vercel deployment, error-rate, latency, job, and integration telemetry — no connected provider.
4. Continuous scheduled monitoring — checks are owner-triggered because no scheduler identity is authorized; adding one must not widen `service_role`.

Exit work: apply hosted migration `028`, configure a real monitored production target under owner authorization, and record live detection-to-resolution evidence. Until then no Phase 1E surface may claim observation.

## Phase 2 - Claude and governed delivery

Status: **Not Connected; not started.**

- Future supported Anthropic API connections and logical roles, not consumer-account browser automation.
- Preview validation and separately approved governance precede any delivery automation.

## Later measured autonomy

- Narrow GREEN automation only after sustained non-production evidence, explicit allowlists, budgets, alerts, kill switches, and owner-approved policy.
- RED actions remain owner-controlled absent a future independently reviewed policy revision.
