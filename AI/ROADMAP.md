# Roadmap

Roadmap ordering reflects safety dependencies, not target dates. A later phase must not be pulled forward without satisfying the policy and verification gates that make it safe.

## Phase 1A — trustworthy control-plane foundation

Status: **Release candidate; final audit/report pending**

- Professional responsive application shell and required navigation.
- Dashboard, Projects, Bot Manager, Files, Agents, Backlog, Runs, Reports, Connections, Activity, and Settings foundations.
- Clear **Demo Data** and **Not Connected** states.
- Project safety controls defaulting to OFF.
- GREEN/YELLOW/RED risk model with owner approval for RED.
- Provider-neutral domain model and Supabase migrations with RLS.
- Command persistence without fictional worker execution.
- Audit events for important operations.
- Repository-memory, policies, operating documentation, tests, and CI quality gates.

Exit evidence is defined in `AI/QUALITY_SCORECARD.md`.

## Phase 1B — authenticated control plane and GitHub read integration

- Supabase Auth, organization onboarding, and membership administration.
- Live project CRUD and scoped repository-memory editing.
- GitHub App registration, installation flow, encrypted secret storage/reference, signed webhooks, and installation-token exchange.
- Repository discovery, branch/PR/check read models, webhook reconciliation, and audit evidence.
- Durable job dispatch with idempotency and cancellation; begin with read-only/audit commands.
- Owner approval inbox and policy-decision trace.
- Live dashboard metrics labeled by provider and freshness.

No merge or production deployment autonomy is implied by this phase.

## Phase 1C — sandboxed agent execution

- Isolated workspaces and least-privilege repository access.
- Provider-neutral AI model adapters with budgets, timeouts, retry limits, and redacted traces.
- Agent task leasing, heartbeats, evidence collection, and resumable runs.
- GREEN-risk branch changes, deterministic validation, and draft PR creation.
- Security scanning and supply-chain controls.
- Human-reviewed promotion from draft PR to merge readiness.

## Phase 2 — governed delivery automation

- Staged GREEN auto-merge eligibility with branch protection and required checks.
- Preview deployment integration and post-deploy validation.
- Explicitly authorized YELLOW workflows with enhanced testing and observation windows.
- Automated rollback recommendations, then narrowly scoped rollback execution after drills prove safety.
- SLOs, incident workflows, and operator alerts.

## Phase 3 — measured autonomy

- Policy-bounded multi-agent planning and execution across multiple projects.
- Risk-based budgets, change windows, escalation paths, and kill switches.
- Autonomous GREEN work only where historical evidence demonstrates acceptable outcomes.
- Continuous evaluation of quality, security, cost, rollback rate, and owner intervention.

RED actions remain owner-controlled unless a future, explicit policy revision creates a narrower and independently reviewed authorization model.
