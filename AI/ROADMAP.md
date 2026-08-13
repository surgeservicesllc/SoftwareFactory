# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful **Demo Data**/**Not Connected** states, tenant model, Supabase/RLS/audit foundations, risk/approval controls, CI, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B - Production GitHub App Integration

Status: **The exact application release `edaaf62` is published, both CI jobs pass, and the matching Vercel production deployment passes Playwright 48/48, the focused signed-out race 30/30, and HTTP/security/client/log checks. Hosted migrations `011`-`025`, authenticated tenant behavior, active webhook, and full live acceptance remain pending.**

Implemented in source:

- Supabase Auth/onboarding/active organization and caller-RLS tenant surfaces.
- GitHub App installation/callback/token/sync/disconnect boundaries and bounded repository reads.
- Signed/idempotent/redacted webhook ingress, provider-time lifecycle ordering, and terminal deletion safeguards.
- Transactional project linking and provider-authoritative repository/default-branch propagation by immutable repository UUID.
- Bounded caller-member list RPC projections, raw Activity/webhook direct-read closure, same-origin command creation, allowlisted activity details, restrictive browser CSP, installation-ID/repository-selection visibility, and live Projects metadata/check visibility including stable repository-ID matching, detail-fetched PR mergeability, and per-PR head-SHA checks.
- Controlled branch + commit + draft-PR file changes with stable same-intent idempotency, exact-binding reservation, terminal audit evidence, provider-evidence completion recovery, and generic secret-assignment detection. Protected-file changes require an exact, short-lived, owner-only RED approval revalidated before write-token minting; merge/default-branch/deploy authority remains absent.
- Transaction-serialized stable repository linking rejects concurrent active duplicates and permits relink after archival.
- Repository forward migrations `011`-`025`, all unhosted.

Verified application-release evidence recorded 2026-08-13: commit `edaaf625c497380611b80092526926b1457e15a0` (tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4`, author/committer `surgeservicesllc@gmail.com`), green CI run `31694775758`, and READY Vercel deployment `dpl_FwjzBywZTadQPTRZtB4Esd9QBKTQ` at the stable production alias. Later documentation-only successors do not invalidate this runtime evidence unless application code changes.

Remaining exit work:

1. Obtain exact owner approval and apply/verify migrations `011`-`025` on hosted project `qpuofpmagrmyamahqwxw`. The CLI is authorized as `surgeservicesllc@gmail.com`, the ledger ends at `010`, linked lint is clean, and the complete linked dry run succeeds without applying anything.
2. Verify hosted two-tenant/anonymous/RPC/audit/provider-ingress behavior with real user sessions.
3. Complete production Auth/onboarding and the real GitHub installation -> tenant connection -> repository -> project -> reads -> safe draft PR -> webhook -> disconnect/loss journey.

No merge or production deployment autonomy is implied. GitHub remains **Not Connected** until the live journey passes.

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
