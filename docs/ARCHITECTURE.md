# Architecture overview

SoftwareFactory is a server-first Next.js control plane. Phase 1A models and presents software-factory state; it does not yet run unrestricted autonomous production work.

## Components

| Component | Responsibility | Trust level |
| --- | --- | --- |
| Browser UI | Present state and collect intent | Untrusted client |
| Next.js server | Authenticate, authorize, validate, apply policy, redact, and coordinate data | Trusted application boundary |
| Supabase Auth/Postgres | Identity and tenant-scoped control-plane records protected by RLS | Trusted persistence boundary |
| Server secret configuration | Resolve privileged provider credentials | Protected server boundary |
| Future provider adapters | Translate domain operations to GitHub, Vercel, and AI providers | External/untrusted responses |
| Future durable workers | Lease, execute, validate, and record bounded jobs | Trusted only within explicit policy |

## Server-first request path

1. A Server Component reads safe, tenant-scoped presentation data, or a client form submits intent to a trusted server boundary.
2. The server authenticates the caller, resolves organization membership, validates input, and evaluates risk/policy.
3. Supabase applies RLS in addition to application-level authorization.
4. The operation persists state and its audit event.
5. A future adapter may contact a provider using a short-lived credential resolved on the server.
6. Provider output is treated as untrusted, normalized, and recorded with source/freshness evidence.

## App Router conventions

- Prefer Server Components for data reads and static shell content.
- Add `"use client"` only for the smallest interactive boundary.
- Keep service-role and provider modules server-only; never import them into client graphs.
- Use explicit loading, error, empty, **Demo Data**, and **Not Connected** states.
- Validate authorization again at every mutation; disabled buttons are not security controls.

## Data architecture

The model separates users/profiles, organizations/membership, projects, connections, project connections, agents, commands, tasks, agent runs, pull requests, deployments, test runs, incidents, reports, policies, approvals, and activity events.

Connections store provider-neutral metadata and an opaque secret reference. Projects can attach connections without embedding credentials. Agents describe roles and capabilities without becoming provider accounts. Commands are persisted intent and do not become “completed” without worker evidence.

## Deployment

The Next.js application is Vercel-compatible. Supabase is independent managed state. Preview, staging, and production should use isolated configuration and preferably separate database projects. CI validates only; no Phase 1A workflow merges or deploys.

Durable AI execution cannot safely depend on the lifetime of a Vercel request. Phase 1B needs a durable queue/worker with idempotency, leases, budgets, cancellation, provider timeouts, audit evidence, and a global kill switch.

## Deeper contracts

- Domain/security detail: `AI/ARCHITECTURE.md`
- Decisions: `AI/DECISIONS.md`
- Risk and automation: `policies/`
- Supabase: [Supabase setup](SUPABASE_SETUP.md) and [Database migrations](DATABASE_MIGRATIONS.md)
- Security: [Security model](SECURITY_MODEL.md)
