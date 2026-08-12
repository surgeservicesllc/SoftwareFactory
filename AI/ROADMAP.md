# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful **Demo Data**/**Not Connected** states, tenant model, Supabase/RLS/audit foundations, risk/approval controls, CI, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B - Production GitHub App Integration

Status: **Hardening passes all current local gates; publication/deployment, hosted migrations `011`-`019`, authenticated tenant behavior, active webhook, and full live acceptance remain pending.**

Implemented in source:

- Supabase Auth/onboarding/active organization and caller-RLS tenant surfaces.
- GitHub App installation/callback/token/sync/disconnect boundaries and bounded repository reads.
- Signed/idempotent/redacted webhook ingress, provider-time lifecycle ordering, and terminal deletion safeguards.
- Transactional project linking and provider-authoritative repository/default-branch propagation.
- Controlled branch + commit + draft-PR file changes with broad protected-path rejection, stable same-intent idempotency, exact-binding reservation, terminal audit evidence, and provider-evidence completion recovery.
- Local forward migrations `011`-`019`, all unhosted.

Exit work:

1. Push the locally verified tree, pass CI, and verify the resulting exact production deployment.
2. Obtain exact owner approval and apply/verify migrations `011`-`019` on the hosted Supabase project (hosted ledger currently ends at `010`; last clean linked lint ends at `009`).
3. Verify hosted two-tenant/anonymous/RPC/audit/provider-ingress behavior with real user sessions.
4. Complete production Auth/onboarding and the real GitHub installation -> tenant connection -> repository -> project -> reads -> safe draft PR -> webhook -> disconnect/loss journey.

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
