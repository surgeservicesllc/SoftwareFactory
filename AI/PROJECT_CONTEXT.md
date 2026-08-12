# Project context

## Product

SoftwareFactory is a standalone AI software-engineering command center. Its long-term purpose is to coordinate projects, agents, source control, planning, validation, releases, monitoring, approvals, and auditable autonomous work from one trustworthy control plane.

The product is not an AI-provider account manager and an agent is not a provider login. Projects, users, agents, and provider connections are separate concepts joined only through explicit relationships.

## Current phase

**Phase 1A — control-plane foundation.** The goal is a secure, responsive foundation with reliable state representation, not the appearance of a fully autonomous factory.

Phase 1A establishes:

- the application shell and primary navigation;
- executive dashboard and Daily CEO Report views;
- project, agent, connection, command, task, run, report, incident, approval, and audit foundations;
- repository-memory and policy files;
- Supabase schema and Row Level Security foundations;
- controls for autonomous mode, risk authorization, approval, merge, deploy, and rollback;
- unit, integration, and end-to-end testing foundations; and
- CI gates for lint, typecheck, tests, and production build.

## Truthful status language

- **Demo Data** means seeded or static presentation data that is not derived from a live provider.
- **Not Connected** means no verified live provider integration is available for that resource.
- A persisted command is queued control-plane intent. It is not proof that an AI worker ran.
- A configured control is not proof that the action is authorized or implemented.

No UI, documentation, or report may blur these distinctions.

## Phase 1A non-goals

- unrestricted production execution;
- autonomous RED-risk actions;
- automatic production merge or deployment;
- storing provider secrets in application database tables;
- pretending demo metrics are live telemetry;
- hard-coded personal projects or accounts; and
- a fake GitHub, Vercel, Supabase, OpenAI, or Anthropic connection.

## Product principles

1. **Truth before theater.** State must describe what happened, not what a user hoped would happen.
2. **Safe by default.** Potentially destructive capabilities start OFF and fail closed.
3. **Server-side trust.** Authorization and secrets remain behind server boundaries.
4. **Owner control.** Sensitive actions have an explicit approval path and RED actions require an owner in Phase 1.
5. **Auditability.** Material decisions and state transitions emit append-only activity events.
6. **Provider neutrality.** Core domain models should not depend on one AI or deployment provider.
7. **Progressive autonomy.** Automation expands only after policy, validation, rollback, and observability mature together.

## Success criteria

Phase 1A is complete only after every requirement in the implementation objective is backed by current code or documentation and the completion checks in `AI/QUALITY_SCORECARD.md` pass. Rendered pages alone are not sufficient evidence.
