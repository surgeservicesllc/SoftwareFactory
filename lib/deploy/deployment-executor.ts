import "server-only";

import {
  isDeploymentProviderConfigured,
  listRecentDeployments,
  type DeploymentReadResult,
  type DeploymentState,
  type TrackedDeployment,
} from "@/lib/deploy/vercel";

/**
 * The deployment executor.
 *
 * The obvious implementation is wrong here, so it is worth saying why. Vercel
 * exposes a create-deployment endpoint, and item 20 of the Phase 1D goal reads
 * like it asks for a POST to it. This repository deploys through Vercel's
 * **Git integration**: merging to the default branch is what triggers a
 * production build. Creating a deployment through the API instead would
 * produce a second, parallel deployment that is not the one the merge caused,
 * is not attributable to the reviewed commit in the way the Git integration
 * makes it, and would happily deploy code that never passed branch protection.
 *
 * So the executing action for a merge is the merge itself, and this module's
 * job is the half that was actually missing: establishing *whether the
 * production deployment for that exact commit succeeded*. That is what turns
 * "we merged" into "it shipped", and it is the evidence Phase 1E's Last Known
 * Good and rollback paths need.
 *
 * The load-bearing rule is commit identity. A production deployment that is
 * `ready` proves nothing about our merge unless it is a deployment *of our
 * merge commit* — otherwise a healthy deployment of someone else's push would
 * read as our success, which is exactly how a broken release gets promoted to
 * Last Known Good.
 */

export type DeploymentOutcome =
  /** A production deployment of this exact commit reached `ready`. */
  | "deployed"
  /** A production deployment of this exact commit failed or was canceled. */
  | "failed"
  /** Still building when the attempt budget ran out. Not a failure. */
  | "pending"
  /** No production deployment for this commit appeared at all. */
  | "not_found"
  | "not_connected";

export interface DeploymentExecutionResult {
  readonly outcome: DeploymentOutcome;
  readonly deploymentId: string | null;
  readonly url: string | null;
  readonly state: DeploymentState | null;
  /** The commit this decision is about, echoed for the audit record. */
  readonly commitSha: string;
  readonly attempts: number;
  readonly reason: string;
}

export interface AwaitDeploymentInput {
  readonly projectId: string;
  /** The merge commit. Matched exactly; a different SHA is a different change. */
  readonly commitSha: string;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  /** Injected in tests. Defaults to the real provider read. */
  readonly read?: (
    projectId: string,
    options: { target?: "production"; limit?: number },
  ) => Promise<DeploymentReadResult>;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 15_000;

const shaPattern = /^[0-9a-f]{7,64}$/i;

/** Whether the executor can do anything at all. Absent token means Not Connected. */
export function isDeploymentExecutorConnected(): boolean {
  return isDeploymentProviderConfigured();
}

/**
 * Finds the production deployment for exactly this commit.
 *
 * Comparison is case-insensitive and requires full equality rather than a
 * prefix match. Vercel returns full SHAs, and accepting a prefix would let a
 * 7-character abbreviation collide with an unrelated commit — rare, but the
 * failure mode is attributing someone else's deployment to this change.
 */
export function findDeploymentForCommit(
  deployments: readonly TrackedDeployment[],
  commitSha: string,
): TrackedDeployment | null {
  const wanted = commitSha.toLowerCase();

  return deployments.find((deployment) => (
    deployment.target === "production"
    && typeof deployment.commitSha === "string"
    && deployment.commitSha.toLowerCase() === wanted
  )) ?? null;
}

function result(
  commitSha: string,
  attempts: number,
  outcome: DeploymentOutcome,
  reason: string,
  deployment: TrackedDeployment | null = null,
): DeploymentExecutionResult {
  return Object.freeze({
    outcome,
    deploymentId: deployment?.id ?? null,
    url: deployment?.url ?? null,
    state: deployment?.state ?? null,
    commitSha,
    attempts,
    reason,
  });
}

/**
 * Waits, boundedly, for the production deployment of a merge commit.
 *
 * Never throws and never waits forever. `pending` is returned when the budget
 * runs out with the build still running — deliberately distinct from `failed`,
 * because "we stopped watching" and "it broke" call for different responses and
 * conflating them would either raise false incidents or hide real ones.
 *
 * A read error does not end the wait. Vercel returning 500 once says nothing
 * about the deployment, and treating it as a failure would let a provider blip
 * trigger a rollback of a perfectly good release.
 */
export async function awaitProductionDeployment(
  input: AwaitDeploymentInput,
): Promise<DeploymentExecutionResult> {
  const {
    projectId,
    commitSha,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    read = listRecentDeployments,
    sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
  } = input;

  if (!shaPattern.test(commitSha)) {
    return result(commitSha, 0, "not_found", "The commit id is not a valid SHA.");
  }
  if (!isDeploymentExecutorConnected()) {
    return result(
      commitSha, 0, "not_connected",
      "No VERCEL_TOKEN is configured, so deployment state cannot be established.",
    );
  }

  const attemptLimit = Math.max(1, maxAttempts);
  let lastSeen: TrackedDeployment | null = null;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const reading = await read(projectId, { target: "production", limit: 20 });

    if (reading.status === "not_connected") {
      return result(
        commitSha, attempt, "not_connected",
        reading.reason ?? "The deployment provider is not connected.",
      );
    }

    if (reading.status === "connected") {
      const deployment = findDeploymentForCommit(reading.deployments, commitSha);
      if (deployment) {
        lastSeen = deployment;

        if (deployment.state === "ready") {
          return result(
            commitSha, attempt, "deployed",
            "A production deployment of this commit is ready.", deployment,
          );
        }
        if (deployment.state === "error" || deployment.state === "canceled") {
          return result(
            commitSha, attempt, "failed",
            `The production deployment of this commit ended as ${deployment.state}.`,
            deployment,
          );
        }
        // queued, building, unknown — keep waiting.
      }
    }
    // A read error is not evidence about the deployment, so it falls through
    // to another attempt rather than concluding anything.

    if (attempt < attemptLimit) await sleep(delayMs);
  }

  return lastSeen
    ? result(
      commitSha, attemptLimit, "pending",
      `The production deployment of this commit was still ${lastSeen.state} when the wait ended.`,
      lastSeen,
    )
    : result(
      commitSha, attemptLimit, "not_found",
      "No production deployment for this commit appeared before the wait ended.",
    );
}
