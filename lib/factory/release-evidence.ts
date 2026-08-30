/**
 * The run's release evidence, read back from its recorded artifacts.
 *
 * The full_lifecycle ANCHOR nodes record real observations — the Phase 1C
 * change lineage, the pull-request review, the exact-head CI check runs, the
 * provider deployment, and the production health probe. This module derives
 * one composed view from those payloads for the Build workspace's
 * "Changes & release" panel: which pull request carries the files changed
 * and diffs, which commit was produced, what the tests concluded, where it
 * deployed, and whether production answered healthy. Every field is null
 * until its observation exists — nothing here invents progress.
 */

export type ReleaseCheck = Readonly<{
  name: string;
  conclusion: string;
  url: string | null;
}>;

export type ReleaseEvidence = Readonly<{
  /** The pull request that carries the files changed and the diffs. */
  pullRequest: Readonly<{ url: string; number: number; repository: string }> | null;
  /** The exact commit the implementation produced (the PR head). */
  producedCommit: string | null;
  baseBranch: string | null;
  /** The exact-head CI verdict: every required check at its latest attempt. */
  checks: readonly ReleaseCheck[] | null;
  deployment: Readonly<{ environment: string | null; state: string; url: string | null }> | null;
  health: Readonly<{
    url: string | null;
    healthy: boolean;
    postDeployValidation: string | null;
  }> | null;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function deriveReleaseEvidence(
  artifacts: readonly { readonly payload?: unknown }[],
): ReleaseEvidence {
  let pullRequest: ReleaseEvidence["pullRequest"] = null;
  let producedCommit: string | null = null;
  let baseBranch: string | null = null;
  let checks: ReleaseCheck[] | null = null;
  let deployment: ReleaseEvidence["deployment"] = null;
  let health: ReleaseEvidence["health"] = null;

  for (const artifact of artifacts) {
    const payload = record(artifact.payload);
    if (payload === null) continue;
    switch (payload.observation) {
      case "phase1c_change_lineage":
      case "phase1c_pull_request_review": {
        const url = text(payload.pullRequestUrl);
        const repository = text(payload.repository);
        if (url !== null && repository !== null
          && typeof payload.pullRequestNumber === "number") {
          pullRequest = { url, number: payload.pullRequestNumber, repository };
        }
        producedCommit = text(payload.headSha) ?? producedCommit;
        baseBranch = text(payload.baseBranch) ?? baseBranch;
        break;
      }
      case "ci_check_runs": {
        // The recorded verdict keeps successes and failures apart; the panel
        // shows them as one honest list with each check's real conclusion.
        const passing = Array.isArray(payload.checks) ? payload.checks : [];
        const failing = Array.isArray(payload.failing) ? payload.failing : [];
        checks = [...passing, ...failing].flatMap((entry) => {
          const row = record(entry);
          const name = row === null ? null : text(row.name);
          const conclusion = row === null ? null : text(row.conclusion);
          return name !== null && conclusion !== null
            ? [{ name, conclusion, url: text(row?.url) }]
            : [];
        });
        producedCommit = text(payload.sha) ?? producedCommit;
        break;
      }
      case "github_production_deployment": {
        const state = text(payload.state);
        if (state !== null) {
          deployment = {
            environment: text(payload.environment),
            state,
            url: text(payload.environmentUrl),
          };
        }
        break;
      }
      case "production_http_probe": {
        if (typeof payload.healthy === "boolean") {
          health = {
            url: text(payload.url),
            healthy: payload.healthy,
            postDeployValidation: text(payload.postDeployValidation),
          };
        }
        break;
      }
      default:
        break;
    }
  }

  return { pullRequest, producedCommit, baseBranch, checks, deployment, health };
}
