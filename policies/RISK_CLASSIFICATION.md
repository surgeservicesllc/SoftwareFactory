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

- **Explicit owner authorization is mandatory for RED actions in Phase 1.** Runtime and product RED actions retain their specific owner-approval records; owner-directed repository releases use the narrow rule below.
- Runtime/product approval must describe the action, target, risk, evidence, expiration when the applicable control requires one, and rollback/containment plan.
- Authorization cannot be inferred from a toggle, an autonomous decision, chat silence, an unrelated task, or approval of a different target.
- Separate duties where practical; the requester/executor must not silently self-approve.
- Use a maintenance window, backup/restore validation, and live observation when applicable.
- Record request, decision, actor, execution, outcome, and incident/rollback events in the audit trail.

Phase 1A does not execute RED actions autonomously even after a UI control is changed.

## Owner-directed repository release authorization

A direct owner request in the active task to push, deploy, or apply the task's reviewed repository changes is the authorization for that bounded release. RED classification still determines the exact technical gates and handling; it does not require a second approval ceremony for a release the owner has just ordered.

- Ordinary language is sufficient. No magic phrase, separate confirmation string, or approval form is required.
- The owner does not have to predeclare an exact commit, tree, artifact, or migration hash. Those identities may not exist until the requested work is committed. Release tooling must derive the final identity and verify it exactly before and after the external write.
- The active-task authorization has no artificial expiration and does not need repeated approval after a commit, rebase, required-check run, deployment handoff, or bounded retry within the same request. It cannot be carried into an unrelated later task or materially broader target.
- The authorization covers only the repository, branch/environment, release contents, and apply/deploy intent reasonably identified by the request. A new repository, branch, environment, unrequested migration, or materially expanded operation requires new owner direction.
- Required checks, branch protection, exact final-SHA/artifact matching, migration hashes and catalog checks, least privilege, secret scanning, audit evidence, containment, rollback planning, and post-deploy validation remain mandatory. Owner direction cannot approve past a failed technical gate.
- A repository release request is not approval for a SoftwareFactory runtime RED command, provider run, protected-change product flow, automatic merge/deploy/rollback, freeze or kill-switch removal, or autonomous guardrail change.
- A general push/deploy/apply request does not silently authorize destructive production-data work, secret access or rotation, authentication/authorization changes, billing, DNS, ownership transfer, or protection weakening. If one is genuinely required, it must be expressly within the owner's request and satisfy its own technical, audit, backup, and containment controls.

## Classification procedure

1. Describe the exact action and environment.
2. Identify affected users, organizations, projects, providers, data, and protected resources.
3. Evaluate worst credible impact and whether reversal restores both state and trust.
4. Assign the highest matching tier.
5. Attach required validation and approvals before execution.
6. Reclassify if scope, target, permissions, or evidence changes.
7. Record classification and rationale with the task/run and activity event.

## Examples of escalation

- A documentation edit is normally GREEN; editing this risk policy is YELLOW because it changes governance, and weakening runtime/product owner approval or autonomous guardrails is RED.
- An additive migration is normally YELLOW; dropping a production column is RED.
- Updating a non-secret connection display name is GREEN/YELLOW; rotating its credential is RED.
- Creating a draft PR can become GREEN in a later authorized phase; changing protected-branch rules or an autonomous merge remains RED. A human-directed repository release may merge or deploy only when the active-task owner request authorizes it and every technical gate passes.
