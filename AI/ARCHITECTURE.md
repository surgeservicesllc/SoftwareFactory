# Architecture

## System context

SoftwareFactory is a Next.js control plane deployed on Vercel-compatible infrastructure and backed by Supabase. Browser components present state and collect intent. Trusted server code validates identity, ownership, policy, and request shape before accessing data or invoking a provider. External providers remain outside the trust boundary.

```text
Browser UI
  -> Next.js Server Components / Route Handlers / Server Actions
    -> authorization + validation + policy checks
      -> Supabase Postgres (RLS, audit data)
      -> server-side secret resolver
      -> future provider adapters (GitHub, Vercel, AI providers)
```

## Runtime layers

### Presentation

- App Router pages and layouts render the command-center shell.
- Server Components are the default for data-bearing UI.
- Client Components are limited to interaction such as navigation, forms, editors, filters, and unsaved-change protection.
- Loading, error, empty, **Demo Data**, and **Not Connected** states are product states, not afterthoughts.

### Application services

- Commands represent user intent and are persisted before any future execution.
- Policy evaluation combines project controls, risk classification, protected resources, and approvals.
- Provider-neutral services own domain behavior; adapters translate to GitHub, Vercel, Supabase, OpenAI, Anthropic, or other APIs.
- Every material state transition writes a corresponding activity event within the same trusted operation whenever transactional boundaries allow it.

### Persistence

- Supabase Postgres is the planned source of truth for control-plane records.
- UUID primary keys, timestamps, foreign keys, status constraints/enums, ownership columns, and query-path indexes are required.
- RLS is enabled on exposed tables. Policies scope access through organization membership and/or user ownership.
- Database migrations in `supabase/migrations/` are immutable once shared; corrections use a new migration.
- Demo fixtures must remain distinguishable from operational records.

### Secrets and connections

- Connection records belong to an organization or user and may be associated with projects through `project_connections`.
- Records contain provider, display metadata, status, scopes, and a server-side secret reference—not a plaintext token, password, private key, or API key.
- Privileged environment values are read only by server modules and must never use the `NEXT_PUBLIC_` prefix.
- Browser code may receive only intentionally public configuration, such as a Supabase project URL and publishable/anonymous client key; database protection still depends on RLS.

### External execution boundary

Provider adapters and durable workers are a Phase 1B concern. Until they exist and are verified:

- integrations render **Not Connected**;
- submitted commands are not shown as executed;
- no UI toggle bypasses server policy;
- no production auto-merge, auto-deploy, or autonomous rollback occurs.

## Core domain relationships

- An organization owns members, projects, connections, agents, policies, and operational records.
- A profile represents an authenticated user; organization membership determines tenant access.
- A project describes one managed software system and its safety settings.
- A connection represents one provider authorization independent of any project or agent.
- `project_connections` attaches reusable connections to projects by purpose.
- An agent definition describes role, provider/model preference, capabilities, and assignment; it does not hold provider credentials.
- A command can generate tasks. Tasks can create agent runs, pull requests, deployments, test runs, incidents, reports, approvals, and activity events.

## Request and command flow

1. Authenticate the user and resolve active organization membership.
2. Validate input on the server.
3. Determine the target project and applicable policy.
4. Classify risk and identify protected-resource contact.
5. Persist the command as queued control-plane intent and append an audit event.
6. If execution is unavailable, stop truthfully at queued/**Not Connected**.
7. In a future worker, acquire a durable idempotency key, execute only within authorization, record evidence, and request approval when required.
8. A merge, deployment, or rollback remains a separate policy-gated action.

## Security invariants

- Client input is untrusted even when controls are hidden or disabled.
- Authorization is checked server-side on every mutation and sensitive read.
- Service-role access never enters the client bundle and never replaces tenant authorization checks.
- Webhooks require signature verification, replay resistance, and idempotent handling.
- Logs and audit payloads are structured and redacted.
- RED actions require explicit owner approval in Phase 1.
- Protected resources use stricter review and never qualify for unattended mutation under the Phase 1A policy.

## Deployment topology

- Vercel serves the Next.js application and server functions.
- Supabase provides Auth/Postgres and may provide storage or realtime only when explicitly adopted.
- Background execution must not rely on a request remaining alive; a durable job runner is required before live orchestration.
- Preview, staging, and production environments use separate credentials and preferably separate Supabase projects.

See `docs/ARCHITECTURE.md` for an operator-oriented summary and `AI/DECISIONS.md` for decision history.
