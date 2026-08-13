# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful **Demo Data**/**Not Connected** states, tenant model, Supabase/RLS/audit foundations, risk/approval controls, CI, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B - Production GitHub App Integration

Status: **Hardening passes local gates, CI, and exact-tree production hosting; hosted migrations `011`-`019`, authenticated tenant behavior, active webhook, and full live acceptance remain pending.**

Implemented in source:

- Supabase Auth/onboarding/active organization and caller-RLS tenant surfaces.
- GitHub App installation/callback/token/sync/disconnect boundaries and bounded repository reads.
- Signed/idempotent/redacted webhook ingress, provider-time lifecycle ordering, and terminal deletion safeguards.
- Transactional project linking and provider-authoritative repository/default-branch propagation.
- Controlled branch + commit + draft-PR file changes with broad protected-path rejection, stable same-intent idempotency, exact-binding reservation, terminal audit evidence, and provider-evidence completion recovery.
- Local forward migrations `011`-`019`, all unhosted.

Exit work:

1. Obtain exact owner approval and apply/verify migrations `011`-`019` on the hosted Supabase project (hosted ledger currently ends at `010`; last clean linked lint ends at `009`).
2. Verify hosted two-tenant/anonymous/RPC/audit/provider-ingress behavior with real user sessions.
3. Complete production Auth/onboarding and the real GitHub installation -> tenant connection -> repository -> project -> reads -> safe draft PR -> webhook -> disconnect/loss journey.

No merge or production deployment autonomy is implied. GitHub remains **Not Connected** until the live journey passes.

## Phase 1C - Codex execution

Status: **Superseded in part by Phase 2A; repository-mutating execution not started.**

- Phase 2A delivered the provider-neutral adapter contract, the OpenAI adapter, run records, cancellation, and redacted traces that Phase 1C anticipated, but only for advisory runs.
- Still outstanding: a durable worker outside request lifetimes, leases and heartbeats, isolated workspaces, budgets, sandbox and network controls, and any repository-mutating agent work. Do not begin those until the owner explicitly authorizes them.

## Phase 1D - autonomous-loop controls

Status: **Observation-only scaffold; execution not started and controls remain OFF.**

- Autonomous Mode constrained OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF, evaluator always `executionAllowed: false`.
- Hosted migration `010` contains the current fail-closed controls. No action executor exists.

## Phase 2A - Claude and multi-provider AI layer

Status: **Implemented in source and passing local gates; every provider is Not Configured and hosted migration `020` is not applied.**

Implemented:

- One provider adapter contract with real Anthropic Messages API and OpenAI Responses API implementations on the official SDKs, using server-side API credentials only. No consumer login or browser session is part of any path.
- A pure, explainable Orchestrator routing engine with owner override, per-agent assignment, project default, and automatic scoring, plus absolute capability and availability rules.
- Policy-bounded single-attempt fallback that records its origin and reason and cannot be used for credential or content-policy failures.
- Structured multi-agent handoff with an enforced independent-review rule.
- Migration `020` for the model catalogue, routing evidence, run events, and provider run columns, with RLS and owner/admin RPC-only writes.
- Connections, Agents, Runs, Settings, and Bot Manager surfaces reading live state.

Exit work:

1. Owner approval and hosted application of migration `020` alongside `011`-`019`.
2. A server-side `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` plus `OPENAI_DEFAULT_MODEL`, then a verified live health probe and a real routed run for each configured provider.
3. Owner enablement of `ai_provider_execution_enabled`, then observation of the plan, implementation-proposal, independent-review, and QA chain end to end.

Not in scope and still gated: repository-mutating agent work, auto approve, auto merge, auto deploy, auto rollback, and preview validation.

## Phase 2B - governed delivery

Status: **Not started.**

- Preview validation and separately approved governance precede any delivery automation.

## Later measured autonomy

- Narrow GREEN automation only after sustained non-production evidence, explicit allowlists, budgets, alerts, kill switches, and owner-approved policy.
- RED actions remain owner-controlled absent a future independently reviewed policy revision.
