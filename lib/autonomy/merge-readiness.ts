/**
 * The final revalidation before a merge would be attempted.
 *
 * Everything upstream — gates, agents, approval — is evaluated against a
 * *snapshot* of the change. Between that evaluation and the merge, the world
 * moves: someone pushes another commit, the base branch advances into a
 * conflict, a required check is added, a reviewer withdraws. An approval that
 * was true five minutes ago is not evidence about the commit that would
 * actually be merged.
 *
 * So this re-asks the questions at the last moment, against the current head.
 * It is deliberately separate from `approval.ts`: approval answers "should this
 * change be merged", and this answers "is *this commit* still the change that
 * was approved, and can it merge cleanly right now".
 */

export type MergeBlocker =
  | "NOT_APPROVED"
  | "APPROVAL_STALE"
  | "GATES_STALE"
  | "MERGE_CONFLICT"
  | "MERGEABILITY_UNKNOWN"
  | "REQUIRED_CHECK_FAILING"
  | "REQUIRED_CHECK_PENDING"
  | "REQUIRED_CHECK_MISSING"
  | "REVIEW_DISMISSED"
  | "BRANCH_PROTECTION_UNSATISFIED"
  | "PULL_REQUEST_NOT_OPEN"
  | "MERGE_EXECUTOR_NOT_CONNECTED";

/** GitHub's mergeable_state vocabulary, narrowed to what the decision needs. */
export type MergeabilityState = "clean" | "dirty" | "blocked" | "behind" | "unknown";

export interface CheckState {
  readonly name: string;
  readonly status: "passed" | "failed" | "pending" | "missing";
}

export interface MergeReadinessRequest {
  /** The commit that would actually be merged, read now. */
  readonly currentHeadSha: string;
  /** The commit the gates were evaluated against. */
  readonly gatedHeadSha: string;
  /** The commit the approval was given for. */
  readonly approvedHeadSha: string | null;
  readonly approved: boolean;
  readonly mergeability: MergeabilityState;
  readonly pullRequestOpen: boolean;
  /** Checks the branch protection rule requires, by name. */
  readonly requiredChecks: readonly string[];
  readonly checks: readonly CheckState[];
  /** True when a previously-given review was dismissed. */
  readonly reviewDismissed?: boolean;
  /** Only true once a merge executor exists. Nothing sets this today. */
  readonly executorConnected?: boolean;
}

export interface MergeReadinessResult {
  readonly ready: boolean;
  readonly blockers: readonly MergeBlocker[];
  readonly reason: string;
  /** The head this decision was made against, for the audit record. */
  readonly evaluatedHeadSha: string;
}

const REASONS: Readonly<Record<MergeBlocker, string>> = Object.freeze({
  NOT_APPROVED: "The change is not approved.",
  APPROVAL_STALE: "The approval was given for an earlier commit; it does not cover this one.",
  GATES_STALE: "Verification ran against an earlier commit and must be re-run.",
  MERGE_CONFLICT: "The branch conflicts with its base and cannot merge.",
  MERGEABILITY_UNKNOWN: "Mergeability has not been computed yet.",
  REQUIRED_CHECK_FAILING: "A required check is failing.",
  REQUIRED_CHECK_PENDING: "A required check has not finished.",
  REQUIRED_CHECK_MISSING: "A required check has not reported at all.",
  REVIEW_DISMISSED: "A required review was dismissed.",
  BRANCH_PROTECTION_UNSATISFIED: "Branch protection is not satisfied.",
  PULL_REQUEST_NOT_OPEN: "The pull request is not open.",
  MERGE_EXECUTOR_NOT_CONNECTED: "No merge executor is connected.",
});

/**
 * Re-ask every merge precondition against the current head.
 *
 * Two of these are the ones that actually bite in practice, and both are
 * staleness rather than failure:
 *
 * - **A new push invalidates the approval.** Someone approves, then pushes one
 *   more commit; the approval now describes code nobody looked at. This refuses
 *   rather than carrying the signature forward.
 * - **A new push invalidates the gates.** Same reasoning: a passing test run
 *   against an older commit is not evidence about this one.
 *
 * Branch protection is never bypassed and never inferred as satisfied — a
 * required check that has not reported is `MISSING`, which blocks, rather than
 * being treated as absent-and-therefore-fine.
 */
export function evaluateMergeReadiness(request: MergeReadinessRequest): MergeReadinessResult {
  const {
    currentHeadSha,
    gatedHeadSha,
    approvedHeadSha,
    approved,
    mergeability,
    pullRequestOpen,
    requiredChecks,
    checks,
    reviewDismissed = false,
    executorConnected = false,
  } = request;

  const blockers: MergeBlocker[] = [];

  if (!pullRequestOpen) blockers.push("PULL_REQUEST_NOT_OPEN");

  // Approval and verification must both describe *this* commit.
  if (!approved) blockers.push("NOT_APPROVED");
  else if (approvedHeadSha !== currentHeadSha) blockers.push("APPROVAL_STALE");

  if (gatedHeadSha !== currentHeadSha) blockers.push("GATES_STALE");

  if (reviewDismissed) blockers.push("REVIEW_DISMISSED");

  switch (mergeability) {
    case "dirty":
      blockers.push("MERGE_CONFLICT");
      break;
    case "blocked":
      blockers.push("BRANCH_PROTECTION_UNSATISFIED");
      break;
    case "unknown":
      blockers.push("MERGEABILITY_UNKNOWN");
      break;
    default:
      break;
  }

  const byName = new Map(checks.map((check) => [check.name, check]));
  for (const required of requiredChecks) {
    const check = byName.get(required);
    if (!check) {
      blockers.push("REQUIRED_CHECK_MISSING");
      continue;
    }
    if (check.status === "failed") blockers.push("REQUIRED_CHECK_FAILING");
    else if (check.status !== "passed") blockers.push("REQUIRED_CHECK_PENDING");
  }

  // Last, because it is a fact about this tree rather than about the change.
  if (!executorConnected) blockers.push("MERGE_EXECUTOR_NOT_CONNECTED");

  const unique = [...new Set(blockers)];

  return Object.freeze({
    ready: unique.length === 0,
    blockers: Object.freeze(unique),
    reason: unique.length
      ? unique.map((blocker) => REASONS[blocker]).join(" ")
      : "Every merge precondition holds against the current head.",
    evaluatedHeadSha: currentHeadSha,
  });
}
