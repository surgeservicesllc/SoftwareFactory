import "server-only";

import { z } from "zod";

import type { EligibilityResult } from "@/lib/autonomy/merge-eligibility";
import type { MergeReadinessResult } from "@/lib/autonomy/merge-readiness";
import { GitHubApiError, githubApiRequest } from "@/lib/github/client";

/**
 * The merge executor.
 *
 * Everything upstream decides *whether* to merge. This performs it, and its
 * whole job is to be the last place that can still say no.
 *
 * Three properties matter more than the happy path:
 *
 * **It cannot bypass branch protection.** The call is the ordinary merge
 * endpoint with the installation token. No admin enforcement is disabled, no
 * `merge_method` that sidesteps a rule is chosen, and nothing here touches
 * repository settings. If protection refuses, GitHub returns 405 and that is
 * the final answer rather than something to retry differently.
 *
 * **It cannot merge a commit nobody approved.** The `sha` parameter is sent on
 * every call. GitHub compares it to the current head server-side and returns
 * 409 if they differ, which closes the window between "readiness said yes" and
 * "the merge happens" — a window `merge-readiness.ts` cannot close on its own,
 * because it reads state and then acts on it a moment later.
 *
 * **It refuses unless both decisions already said yes.** Readiness and
 * eligibility are taken as arguments rather than recomputed, so this function
 * cannot reach a different conclusion than the one that was audited; it can
 * only decline to act on it.
 */

export type MergeExecutionOutcome =
  | "merged"
  | "refused_not_ready"
  | "refused_not_eligible"
  | "refused_head_moved"
  | "refused_by_branch_protection"
  | "refused_not_mergeable"
  | "executor_not_connected"
  | "failed";

export interface MergeExecutionResult {
  readonly outcome: MergeExecutionOutcome;
  /** Present only when GitHub actually merged. */
  readonly mergeCommitSha: string | null;
  readonly reason: string;
  /** The head that was submitted, for the audit record. */
  readonly requestedHeadSha: string;
  readonly repositoryFullName: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly pullRequestNumber: number;
}

export interface MergeExecutionRequest {
  readonly token: string;
  readonly owner: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly commitTitle: string;
  readonly readiness: MergeReadinessResult;
  readonly eligibility: EligibilityResult;
  /**
   * Squash keeps one reviewable commit per approved change on the base branch.
   * `merge` and `rebase` are not offered: the audit record names a single merge
   * SHA, and a rebase produces several commits none of which is that SHA.
   */
  readonly mergeMethod?: "squash";
}

const mergeResponseSchema = z.object({
  merged: z.boolean(),
  sha: z.string().regex(/^[0-9a-f]{40,64}$/).nullable().optional(),
  message: z.string().nullable().optional(),
});

const shaPattern = /^[0-9a-f]{40,64}$/;

/**
 * True when a merge executor is usable at all.
 *
 * Deliberately narrow: holding an installation token is the entire technical
 * requirement, so this reports connectivity and nothing about authorization.
 * Whether *this* repository may be merged is the allowlist's question, and
 * conflating the two would let a connected executor imply an approved target.
 */
export function isMergeExecutorConnected(token: string | null | undefined): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

function refusal(
  request: MergeExecutionRequest,
  outcome: MergeExecutionOutcome,
  reason: string,
): MergeExecutionResult {
  return Object.freeze({
    outcome,
    mergeCommitSha: null,
    reason,
    requestedHeadSha: request.headSha,
    repositoryFullName: `${request.owner}/${request.repository}`,
    baseBranch: request.baseBranch,
    headBranch: request.headBranch,
    pullRequestNumber: request.pullRequestNumber,
  });
}

/**
 * Merges an approved pull request, or explains why it did not.
 *
 * This never throws for an ordinary refusal. A refusal is a result the audit
 * record has to carry, and turning it into an exception invites a caller to
 * treat "GitHub said no" as an infrastructure error worth retrying.
 */
export async function executeApprovedMerge(
  request: MergeExecutionRequest,
): Promise<MergeExecutionResult> {
  if (!isMergeExecutorConnected(request.token)) {
    return refusal(request, "executor_not_connected", "No installation token is available.");
  }
  if (!shaPattern.test(request.headSha)) {
    return refusal(request, "failed", "The head SHA is not a valid commit id.");
  }

  // Both decisions are re-checked rather than assumed, because this function is
  // reachable from more than one caller and only one of them is the pipeline.
  if (!request.readiness.ready) {
    return refusal(request, "refused_not_ready", request.readiness.reason);
  }
  if (!request.eligibility.eligible) {
    return refusal(request, "refused_not_eligible", request.eligibility.reason);
  }
  // The readiness decision must describe the commit being submitted. If it does
  // not, the approval that produced it is about different code.
  if (request.readiness.evaluatedHeadSha !== request.headSha) {
    return refusal(
      request,
      "refused_head_moved",
      "Readiness was evaluated against a different commit than the one being merged.",
    );
  }

  try {
    const raw = await githubApiRequest(
      `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repository)}`
      + `/pulls/${request.pullRequestNumber}/merge`,
      {
        body: {
          commit_title: request.commitTitle,
          merge_method: request.mergeMethod ?? "squash",
          // The race-closer. GitHub rejects with 409 if the head has moved.
          sha: request.headSha,
        },
        method: "PUT",
        token: request.token,
      },
    );

    const parsed = mergeResponseSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.merged || !parsed.data.sha) {
      return refusal(
        request,
        "failed",
        "GitHub reported the merge did not complete.",
      );
    }

    return Object.freeze({
      outcome: "merged" as const,
      mergeCommitSha: parsed.data.sha,
      reason: "The pull request was merged.",
      requestedHeadSha: request.headSha,
      repositoryFullName: `${request.owner}/${request.repository}`,
      baseBranch: request.baseBranch,
      headBranch: request.headBranch,
      pullRequestNumber: request.pullRequestNumber,
    });
  } catch (error) {
    if (error instanceof GitHubApiError) {
      // These three are the answers worth distinguishing. Everything else is a
      // failure, and none of them is retried here: a retry has to recompute
      // eligibility from scratch, which is the caller's job.
      if (error.status === 409) {
        return refusal(
          request,
          "refused_head_moved",
          "The head commit changed between approval and merge.",
        );
      }
      if (error.status === 405) {
        return refusal(
          request,
          "refused_by_branch_protection",
          "GitHub refused the merge; branch protection or a required check is unsatisfied.",
        );
      }
      if (error.status === 422) {
        return refusal(request, "refused_not_mergeable", "GitHub reported the branch is not mergeable.");
      }
      return refusal(request, "failed", `GitHub returned ${error.status}.`);
    }
    // Never surface the raw error: it can carry the token in a request context.
    return refusal(request, "failed", "The merge request failed unexpectedly.");
  }
}
