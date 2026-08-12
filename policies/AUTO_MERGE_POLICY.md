# Auto-merge policy

Status: **Disabled in Phase 1A**

## Current rule

SoftwareFactory must not automatically merge pull requests in Phase 1A. The Auto Merge control defaults OFF and is descriptive configuration only until a future implementation satisfies this policy, is explicitly approved, and is proven in a non-production rollout.

CI has read-only repository permissions and performs validation only. It must not receive pull-request write, contents write, deployment, or administration permission for auto-merge.

## Future minimum eligibility

A future pull request may be considered for auto-merge only when every condition is true:

- the owning project explicitly enabled auto-merge through an audited owner-authorized change;
- the change is classified GREEN under `RISK_CLASSIFICATION.md`;
- the target repository and branch are explicitly allowlisted;
- the PR is produced from a fresh, isolated branch by an authenticated installation identity;
- branch protection remains enabled and every required, current-head check passes;
- lint, typecheck, tests, build, security checks, and applicable preview validation pass;
- the head SHA reviewed is exactly the head SHA merged;
- the PR is conflict-free, within approved size/scope limits, and contains no unexplained generated or binary content;
- required human/CODEOWNER approvals, if any, remain valid and are not dismissed;
- no protected resource, secret, authentication/authorization boundary, destructive migration, billing, DNS, workflow permission, or production configuration is touched;
- no unresolved review thread, security finding, incident, freeze, kill switch, or owner-attention flag exists; and
- the audit record contains risk rationale, check evidence, policy version, actor, project, repository, branch, and commit SHA.

Eligibility is recalculated after every push, rebase, review change, check rerun, policy update, or repository-setting change.

## Always excluded in Phase 1

- RED actions;
- YELLOW changes until a later policy explicitly defines and approves a bounded subset;
- dependency updates with unknown provenance or unresolved advisories;
- database migrations that are destructive, irreversible, or not backward compatible;
- changes to credentials, auth, RLS, encryption, audit controls, protected resources, this policy, or GitHub workflow permissions;
- bypassing branch protection, required checks, review requirements, or merge queues; and
- merging when provider state cannot be freshly verified.

## Failure behavior

Fail closed. If any signal is missing, stale, ambiguous, unavailable, or contradictory, do not merge. Mark the item as requiring owner attention and create an activity event. A retry must recompute eligibility rather than reuse a previous decision.

## Enabling process for a future phase

1. Implement evaluation in trusted server/worker code, never as a client-only toggle.
2. Add adversarial and race-condition tests, including head-SHA changes and stale approvals.
3. Run in observation-only mode and compare decisions with owner review.
4. Pilot only on a disposable/non-production repository.
5. Obtain explicit owner approval for the precise allowlist and limits.
6. Add a globally reachable kill switch and rollback/incident procedure.
7. Record the enabling decision in `AI/DECISIONS.md` and update the quality scorecard.
