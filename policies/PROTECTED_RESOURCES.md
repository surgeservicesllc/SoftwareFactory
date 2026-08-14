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

## Which of these are enforced in code

`lib/autonomy/diff-risk.ts` classifies a real diff, so the protected paths below are the part of this policy a machine can check. Everything else in this document is a rule for the humans and agents working the repository, not something the classifier can see.

| Protected path | Classified | Where |
| --- | --- | --- |
| `supabase/migrations/**` | YELLOW; RED on a destructive statement, an authority-widening statement, or audit-evidence destruction | `DESTRUCTIVE_SQL`, `AUTHORITY_WIDENING`, `AUDIT_EVIDENCE_DESTRUCTION` |
| `.github/workflows/**` | RED | `privileged-access` |
| Authentication, authorization, RLS, encryption, secret resolution | RED | `authentication-or-security-controls` |
| `.env*` | RED | `secrets-or-credentials`, by path and by content shape |
| `policies/**`, `AGENTS.md`, `CLAUDE.md` | RED | `authentication-or-security-controls` |
| Safety-relevant AI memory (`AI/DECISIONS.md`) | YELLOW | `safety-relevant-memory` |
| DNS, domains, TLS, certificates, hosting routing | RED | `dns-or-domain-ownership` |
| Billing, payments, subscriptions | RED | `money-or-billing` |
| Backups, retention, recovery | RED | `destructive-production-data` |
| The autonomy control model (`lib/autonomy/controls.ts`) | RED | `privileged-access` |
| Unrecognised paths | YELLOW | `classifyRisk` defaults an empty factor set to YELLOW |

"Automated systems cannot weaken, remove, or approve changes to their own guardrails" is enforced in three places: the authority-widening content rules classify any enabling of autonomous authority as RED; `lib/autonomy/approval.ts` refuses self-approval absolutely, so an author can never approve their own change; and `AI/DECISIONS.md` is raised above documentation-only so a guardrail decision cannot be deleted inside an otherwise-GREEN diff.

Not enforced in code, and not claimed to be:

- Semantic reduction in protection is not detected. The classifier reads paths and added lines; it cannot tell a policy clarification from a policy weakening. Where that distinction matters it over-classifies — every path under `policies/` is RED, including a clarification this policy would allow at YELLOW.
- The access-and-evidence record below is a schema and a contract, not an enforced workflow. Nothing blocks a protected-resource action on the absence of that record, because no executor performs protected-resource actions.
- Provider scopes, branch protection settings, and CODEOWNERS are read from GitHub where CI surfaces them; nothing in this repository asserts they are correctly configured.

## Access and evidence

For each approved protected-resource action, record:

- requester, approver, executor, organization, project, and correlation ID;
- precise resource identifiers without secret values;
- reason, risk classification, planned change, validation, and rollback/containment plan;
- time-bounded approval and execution timestamps; and
- outcome, post-change validation, and any incident reference.
