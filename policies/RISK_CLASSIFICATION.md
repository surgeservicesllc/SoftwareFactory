# Risk classification policy

Status: Active for Phase 1  
Default when uncertain: choose the higher tier and request owner review.

## Purpose

Every proposed action is classified before execution. Classification is based on impact, reversibility, blast radius, data sensitivity, authorization surface, and operational evidence—not on how small the diff looks. The most severe applicable criterion wins.

## GREEN — low risk

Low-impact, easily reversible work with narrow blast radius and no sensitive resource contact.

Typical examples:

- documentation, copy, comments, and non-policy repository memory corrections;
- deterministic tests that do not change production behavior;
- isolated visual or accessibility fixes with no authentication, security, billing, data, or release effect;
- internal refactors with unchanged public behavior and strong test coverage; and
- dependency-free developer tooling changes that do not alter release permissions.

Minimum controls:

- focused validation plus all affected quality gates;
- a reviewable diff and a clear revert path;
- no protected resource contact; and
- an activity event if the action occurs through SoftwareFactory.

GREEN describes risk; it does not make autonomous execution available in Phase 1A.

## YELLOW — meaningful but controlled risk

Meaningful behavior or infrastructure changes that are testable and reversible but need enhanced validation or human attention.

Typical examples:

- ordinary feature behavior or API contract changes;
- additive, backward-compatible database migrations;
- dependency additions or upgrades;
- non-production provider configuration;
- performance changes, caching, background jobs, or concurrency behavior;
- agent prompts/capabilities that can affect generated work; and
- changes near, but not altering, a protected boundary.

Minimum controls:

- the GREEN controls;
- unit and integration coverage for the changed boundary;
- preview/staging validation where applicable;
- explicit rollback instructions and an observation plan;
- security review when inputs, data, or external providers are involved; and
- approval whenever project policy, branch protection, or a protected-resource rule requires it.

## RED — high impact or sensitive

Actions with high impact, broad or hard-to-reverse blast radius, or contact with critical ownership/security resources.

RED includes:

- spending money, changing billing, purchasing, or altering budget limits;
- destructive or irreversible production-data operations, backups, retention, or recovery controls;
- accessing, creating, rotating, disclosing, or changing secrets, private keys, service-role credentials, or signing keys;
- authentication, authorization, RLS, encryption, audit-policy, security-control, or identity-provider changes;
- DNS, domains, TLS certificates, routing ownership, or production origin changes;
- production database migrations with destructive or irreversible steps;
- production branch protection, required checks, GitHub App permissions, workflow write permissions, or environment protection changes;
- enabling or widening autonomous approval, merge, deploy, or rollback authority;
- deleting repositories, environments, projects, organizations, user accounts, or audit evidence; and
- an uncertain action whose potential failure can reach any item above.

Required controls:

- **Explicit owner approval is mandatory for every RED action in Phase 1.**
- Approval must describe the exact action, target, risk, evidence, expiration, and rollback/containment plan.
- Approval cannot be inferred from a toggle, old approval, chat silence, or approval of a different target.
- Separate duties where practical; the requester/executor must not silently self-approve.
- Use a maintenance window, backup/restore validation, and live observation when applicable.
- Record request, decision, actor, execution, outcome, and incident/rollback events in the audit trail.

Phase 1A does not execute RED actions autonomously even after a UI control is changed.

## Classification procedure

1. Describe the exact action and environment.
2. Identify affected users, organizations, projects, providers, data, and protected resources.
3. Evaluate worst credible impact and whether reversal restores both state and trust.
4. Assign the highest matching tier.
5. Attach required validation and approvals before execution.
6. Reclassify if scope, target, permissions, or evidence changes.
7. Record classification and rationale with the task/run and activity event.

## Examples of escalation

- A documentation edit is normally GREEN; editing this risk policy is YELLOW because it changes governance, and weakening owner approval is RED.
- An additive migration is normally YELLOW; dropping a production column is RED.
- Updating a non-secret connection display name is GREEN/YELLOW; rotating its credential is RED.
- Creating a draft PR can become GREEN in a later authorized phase; changing protected-branch rules or merging to production is RED under Phase 1 policy.
