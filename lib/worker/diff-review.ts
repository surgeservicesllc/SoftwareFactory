import "server-only";

import { isProtectedGitHubWritePath, normalizeRepositoryPath } from "@/lib/github/repository";
import { MAX_FILE_CONTENT_BYTES, MAX_PROPOSED_FILES } from "@/lib/providers/contract";
import type { ProposedFileChange } from "@/lib/providers/types";
import { classifyRisk, type RiskFactor, type RiskLevel } from "@/lib/risk";
import { scanProposedFiles, type SecretFinding } from "@/lib/worker/secret-scan";

/**
 * Pre-commit diff review.
 *
 * Everything a provider proposes is untrusted. Nothing reaches a branch until
 * scope, protected-resource contact, secret content, and recalculated risk have
 * all been checked here. Unexpected RED impact stops the run instead of
 * downgrading itself to fit the plan.
 */

export type DiffReviewBlocker =
  | "no_changes_proposed"
  | "too_many_files"
  | "file_too_large"
  | "protected_resource"
  | "secret_detected"
  | "out_of_scope"
  | "missing_expected_sha"
  | "risk_ceiling_exceeded"
  | "provider_reported_blockers";

export type DiffReviewFinding = {
  readonly blocker: DiffReviewBlocker;
  readonly path: string | null;
  readonly detail: string;
};

export type DiffReviewInput = {
  readonly changes: readonly ProposedFileChange[];
  /** Blob SHAs the worker was actually given, keyed by normalized path. */
  readonly knownFileShas: ReadonlyMap<string, string>;
  /** Paths the plan expected to touch. Empty means no path restriction. */
  readonly expectedPaths: readonly string[];
  readonly declaredRisk: RiskLevel;
  readonly providerRiskFactors: readonly RiskFactor[];
  readonly providerBlockers: readonly string[];
  /** Investigation and review work legitimately produces no file changes. */
  readonly expectsChanges: boolean;
};

export type DiffReviewResult = {
  readonly approved: boolean;
  readonly findings: readonly DiffReviewFinding[];
  readonly recalculatedRisk: RiskLevel;
  readonly riskFactors: readonly RiskFactor[];
  readonly secretFindings: readonly SecretFinding[];
  readonly unexpectedPaths: readonly string[];
  readonly acceptedChanges: readonly ProposedFileChange[];
};

/** Path-shape signals that raise risk regardless of what the provider declared. */
const PATH_RISK_FACTORS: ReadonlyArray<[RegExp, RiskFactor]> = [
  [/(^|\/)package(-lock)?\.json$/i, "dependency-change"],
  [/(^|\/)(pnpm-lock\.yaml|yarn\.lock)$/i, "dependency-change"],
  [/\.(test|spec)\.[jt]sx?$/i, "test-only"],
  [/^tests?\//i, "test-only"],
  [/\.(md|mdx|txt)$/i, "documentation-only"],
  [/\.(css|scss)$/i, "isolated-reversible-ui"],
];

function riskFactorsForPath(path: string): RiskFactor[] {
  return PATH_RISK_FACTORS.filter(([pattern]) => pattern.test(path)).map(([, factor]) => factor);
}

function rank(level: RiskLevel): number {
  return { GREEN: 0, YELLOW: 1, RED: 2 }[level];
}

export function reviewProposedDiff(input: DiffReviewInput): DiffReviewResult {
  const findings: DiffReviewFinding[] = [];
  const normalizedExpected = new Set(
    input.expectedPaths.map((path) => normalizeRepositoryPath(path).toLowerCase()),
  );
  const unexpectedPaths: string[] = [];
  const pathFactors: RiskFactor[] = [];

  if (input.providerBlockers.length > 0) {
    findings.push({
      blocker: "provider_reported_blockers",
      path: null,
      detail: `The worker reported blockers: ${input.providerBlockers.slice(0, 5).join("; ")}`,
    });
  }

  if (input.expectsChanges && input.changes.length === 0) {
    findings.push({
      blocker: "no_changes_proposed",
      path: null,
      detail: "The worker proposed no file changes for a code-changing task.",
    });
  }

  if (input.changes.length > MAX_PROPOSED_FILES) {
    findings.push({
      blocker: "too_many_files",
      path: null,
      detail: `A run may change at most ${MAX_PROPOSED_FILES} files; ${input.changes.length} were proposed.`,
    });
  }

  for (const change of input.changes) {
    const path = normalizeRepositoryPath(change.path);
    const lowerPath = path.toLowerCase();

    if (isProtectedGitHubWritePath(path)) {
      findings.push({
        blocker: "protected_resource",
        path,
        detail: "This path is a protected resource and requires a separate owner-approved workflow.",
      });
    }

    if (Buffer.byteLength(change.content, "utf8") > MAX_FILE_CONTENT_BYTES) {
      findings.push({
        blocker: "file_too_large",
        path,
        detail: `Proposed content exceeds ${MAX_FILE_CONTENT_BYTES} bytes.`,
      });
    }

    if (change.action === "update") {
      const knownSha = input.knownFileShas.get(lowerPath);
      if (!knownSha) {
        findings.push({
          blocker: "missing_expected_sha",
          path,
          detail: "The worker proposed updating a file it was not given, so no expected SHA can be trusted.",
        });
      } else if (knownSha !== change.expectedSha) {
        findings.push({
          blocker: "missing_expected_sha",
          path,
          detail: "The expected blob SHA does not match the file the worker was given.",
        });
      }
    }

    if (normalizedExpected.size > 0 && !normalizedExpected.has(lowerPath)) {
      unexpectedPaths.push(path);
    }

    pathFactors.push(...riskFactorsForPath(path));
  }

  if (unexpectedPaths.length > 0) {
    findings.push({
      blocker: "out_of_scope",
      path: null,
      detail: `Paths outside the planned scope were proposed: ${unexpectedPaths.slice(0, 5).join(", ")}`,
    });
  }

  const secretFindings = scanProposedFiles(
    input.changes.map((change) => ({ path: change.path, content: change.content })),
  );
  for (const finding of secretFindings) {
    findings.push({
      blocker: "secret_detected",
      path: finding.path,
      detail: `${finding.detail} (line ${finding.line})`,
    });
  }

  // Risk is recalculated from what was actually proposed, never inherited.
  const combinedFactors = [...input.providerRiskFactors, ...pathFactors];
  const classification = combinedFactors.length > 0
    ? classifyRisk(combinedFactors)
    : { level: input.declaredRisk, factors: [] as readonly RiskFactor[], defaulted: false };
  const recalculatedRisk: RiskLevel = rank(classification.level) > rank(input.declaredRisk)
    ? classification.level
    : input.declaredRisk;

  if (rank(recalculatedRisk) > rank(input.declaredRisk)) {
    findings.push({
      blocker: "risk_ceiling_exceeded",
      path: null,
      detail: `The proposed change recalculated to ${recalculatedRisk}, above the planned ${input.declaredRisk}.`,
    });
  }

  return {
    approved: findings.length === 0,
    findings,
    recalculatedRisk,
    riskFactors: classification.factors,
    secretFindings,
    unexpectedPaths,
    acceptedChanges: findings.length === 0 ? input.changes : [],
  };
}
