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
- RED contact requires explicit owner authorization as defined in `RISK_CLASSIFICATION.md`. Runtime/product actions use their specific approval records; an owner-directed repository release uses the active-task authorization rule below.
- Read operations use least privilege and are audited when sensitive.
- Writes identify the exact resource and environment; wildcard or organization-wide scope is not assumed.
- Backups and restore paths are verified before destructive data work.
- Automated systems cannot weaken, remove, or approve changes to their own guardrails.
- A project toggle cannot override this policy.
- Unknown resources are treated as protected until classified.

## Owner-directed repository release authorization

A direct owner request in the active task to push, deploy, or apply the task's reviewed repository changes authorizes the bounded repository release even when protected paths make the diff RED. This is human direction, not autonomous approval.

- No magic phrase, separate confirmation form, predeclared commit/artifact hash, approval expiration, or repeated confirmation is required for the same requested release.
- Release machinery must discover and verify the actual final commit, artifact, destination, and migration identities. Exact technical release gates, required checks, branch protection, least privilege, audit, containment, rollback planning, and post-deploy validation remain in force.
- The request does not authorize a materially different repository, branch, environment, migration set, or protected-resource operation. It never implicitly authorizes destructive production data work, secrets, authentication/authorization, billing, DNS, ownership transfer, or weakened protections.
- Product/runtime RED approvals remain separate. In particular, a release request cannot approve a RED command, provider execution, protected-change product flow, rollback, freeze removal, or kill-switch change inside SoftwareFactory.
- Automated systems still cannot approve or weaken their own guardrails, and this rule does not enable auto-merge, auto-deploy, or auto-rollback.

## Repository paths requiring elevated review

The following are protected by subject matter even if repository path names change:

- `supabase/migrations/**` and database policy/configuration;
- `.github/workflows/**`, branch/release/deployment configuration, and ownership rules;
- authentication, authorization, RLS, encryption, and secret-resolution code;
- `.env*` templates when they change the public/private boundary;
- `policies/**`, `AGENTS.md`, and safety-relevant AI memory;
- production deployment, DNS, billing, rollback, and provider-permission configuration.

## Owner-frozen: the AI-account connection path (2026-08-16)

The owner verified the end-to-end Claude connection live and ordered it
protected: **no modification without a specific owner instruction.** This is
stronger than elevated review — it is a freeze. It covers:

- `lib/worker/auth-broker.ts`, `scripts/auth-broker.mts`, and
  `.github/workflows/auth-broker.yml`;
- the broker migrations (`20260816000100`–`20260816001200`) and their
  functions;
- `components/ai-account-connect.tsx`, the connect/session/code/cancel
  routes under `app/api/ai-accounts/**`, and `lib/ai-accounts/**`
  (including `lib/ai-accounts/device-login.ts`).

Diagnosis stays allowed: reading logs, running read-only probes, and
reporting findings. When a defect is found, the finding and a proposed fix
go to the owner; the fix lands only on their instruction. Verified-working
configuration at the Claude freeze (2026-08-16 ~17:00Z): main `74843ef`
(worker release `85c4b14` lineage — Enter-as-keystroke submission,
stale-code fail-fast, release-SHA self-handover, identity capture).

**Codex extension (2026-08-16 19:06Z).** The owner verified the first live
Codex connection ("Signed in as daniel.hughen@gmail.com", verified
19:06:41Z) and ordered the Codex path locked down alongside Claude. The
freeze therefore also covers, at the configuration then on main:

- the Codex device-auth driver in `lib/worker/auth-broker.ts`
  (`codex login --device-auth`, CLI pinned `@openai/codex@0.147.0`,
  completion via `$CODEX_HOME/auth.json`, no paste-back);
- `lib/ai-accounts/device-login.ts` (the `#sf-device-code=` fragment
  contract between worker and console);
- the device-code branch of `components/ai-account-connect.tsx` (big code
  + Copy button + first-time "Device code login" guidance);
- migrations `20260816000800`–`20260816001200` (cancel-discards-pending,
  status read, vault-read restatement, 65536-char envelope cap,
  awaiting_user→verifying).

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

"Automated systems cannot weaken, remove, or approve changes to their own guardrails" is enforced in three places: the authority-widening content rules classify any enabling of autonomous authority as RED; `lib/autonomy/approval.ts` refuses self-approval absolutely, so an autonomous author can never approve its own product action; and `AI/DECISIONS.md` is raised above documentation-only so a guardrail decision cannot be deleted inside an otherwise-GREEN diff. An owner's direct release instruction is external human authorization and does not change any of those runtime checks.

Not enforced in code, and not claimed to be:

- Semantic reduction in protection is not detected. The classifier reads paths and added lines; it cannot tell a policy clarification from a policy weakening. Where that distinction matters it over-classifies — every path under `policies/` is RED, including a clarification this policy would allow at YELLOW.
- The access-and-evidence record below is a schema and a contract, not an enforced workflow. Nothing blocks a protected-resource action on the absence of that record, because no executor performs protected-resource actions.
- Provider scopes, branch protection settings, and CODEOWNERS are read from GitHub where CI surfaces them; nothing in this repository asserts they are correctly configured.

## Access and evidence

For each approved protected-resource action, record:

- requester, authorization source, executor, organization, project, and correlation ID; for runtime/product approvals, also record the approver and decision;
- precise resource identifiers without secret values;
- reason, risk classification, planned change, validation, and rollback/containment plan;
- for runtime/product actions, the approval timing and expiration required by that control; for an owner-directed repository release, the active task/request and execution timestamps without inventing a separate expiry; and
- outcome, post-change validation, and any incident reference.
