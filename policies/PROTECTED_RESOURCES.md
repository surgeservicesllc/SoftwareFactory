# Protected resources policy

Status: Active for Phase 1

## Purpose

Protected resources are assets whose modification, disclosure, deletion, or loss of control can create outsized security, financial, availability, or ownership impact. Contact with a protected resource raises validation and approval requirements even when the code diff is small.

## Protected resource classes

### Identity and authorization

- authentication providers, session/cookie behavior, MFA, account recovery, and user lifecycle;
- organization membership, roles, approvals, RLS policies, service-role access, and authorization middleware;
- GitHub App installations, permissions, private keys, webhook secrets, and installation tokens.

### Secrets and cryptography

- API keys, access/refresh tokens, database passwords, private/signing keys, encryption keys, and secret-manager configuration;
- environment-variable configuration that contains or routes privileged values;
- TLS certificates and webhook-signature verification.

### Production data and recovery

- production databases, schemas, migrations, storage buckets, backups, point-in-time recovery, retention, deletion, and restore procedures;
- audit/activity events, approval evidence, incident records, and security findings.

### Ownership, routing, and money

- DNS zones, domains, registrars, nameservers, production URLs, routing, and CDN origins;
- billing accounts, payment methods, budgets, quotas, purchases, and paid plan changes;
- organization/repository ownership and administrator accounts.

### Delivery and automation controls

- protected branches, required checks, CODEOWNERS, merge queues, environment protection, workflow permissions, release signing, deploy hooks, and production projects;
- autonomous-mode limits, maximum risk, auto approve, auto merge, auto deploy, auto rollback, global kill switches, and the policies that govern them;
- provider connections with write or administrative scopes.

## Phase 1 handling rules

- Secret material is never returned to the browser or stored as plaintext in control-plane tables, logs, reports, fixtures, or activity metadata.
- RED contact requires explicit owner approval as defined in `RISK_CLASSIFICATION.md`.
- Read operations use least privilege and are audited when sensitive.
- Writes identify the exact resource and environment; wildcard or organization-wide scope is not assumed.
- Backups and restore paths are verified before destructive data work.
- Automated systems cannot weaken, remove, or approve changes to their own guardrails.
- A project toggle cannot override this policy.
- Unknown resources are treated as protected until classified.

## Repository paths requiring elevated review

The following are protected by subject matter even if repository path names change:

- `supabase/migrations/**` and database policy/configuration;
- `.github/workflows/**`, branch/release/deployment configuration, and ownership rules;
- authentication, authorization, RLS, encryption, and secret-resolution code;
- `.env*` templates when they change the public/private boundary;
- `policies/**`, `AGENTS.md`, and safety-relevant AI memory;
- production deployment, DNS, billing, rollback, and provider-permission configuration.

Documentation-only clarification may be GREEN/YELLOW, but any semantic reduction in protection is RED.

## Access and evidence

For each approved protected-resource action, record:

- requester, approver, executor, organization, project, and correlation ID;
- precise resource identifiers without secret values;
- reason, risk classification, planned change, validation, and rollback/containment plan;
- time-bounded approval and execution timestamps; and
- outcome, post-change validation, and any incident reference.
