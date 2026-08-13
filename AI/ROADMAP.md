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

## Bot fabric - provider-neutral control plane

Status: **Implemented locally; migrations `020`-`021` unhosted; no executor.**

- Provider-neutral bot registration, organization-authored roles, and bot-to-project assignment, with credentials held as server-side references rather than stored values.
- This is the registry a future worker will bind to. It confers no execution authority: readiness describes configuration, assignment describes intent, and OpenAI/Codex and Anthropic/Claude remain **Not Connected**.
- Binding a real worker to these records requires a separate owner-approved phase decision and verified-session evidence.

## Phase 2 - Claude and governed delivery

Status: **Not Connected; not started.**

- Future supported Anthropic API connections and logical roles, not consumer-account browser automation. The bot fabric supplies the role and assignment model; it does not start this phase.
- Preview validation and separately approved governance precede any delivery automation.

## Later measured autonomy

- Narrow GREEN automation only after sustained non-production evidence, explicit allowlists, budgets, alerts, kill switches, and owner-approved policy.
- RED actions remain owner-controlled absent a future independently reviewed policy revision.
