import type { RiskLevel } from "@/lib/risk";

import { PRODUCTION_INVESTIGATOR_VERSION, type ProductionSignalKind } from "@/lib/operations/types";

/**
 * Production Investigator.
 *
 * A deterministic evidence engine, not a language model: no AI worker is
 * connected in this phase, so a fabricated narrative would be indistinguishable
 * from an informed one. It consumes the evidence an operator would look at and
 * returns a structured conclusion.
 *
 * It returns conclusions and the evidence it cited. It deliberately does not
 * emit, store, or expose intermediate reasoning.
 */

export interface InvestigationEvidenceItem {
  readonly kind:
    | "incident"
    | "deployment"
    | "commit"
    | "pull_request"
    | "health_check"
    | "error"
    | "recent_change"
    | "failed_test"
    | "architecture";
  readonly reference: string;
  readonly detail: string;
}

export interface InvestigationInput {
  readonly signalKind: ProductionSignalKind;
  readonly occurrenceCount: number;
  readonly failingMonitorNames: readonly string[];
  /** Minutes between the suspect deployment and the first failing signal, when both are known. */
  readonly minutesSinceDeployment: number | null;
  readonly deploymentReference: string | null;
  readonly commitSha: string | null;
  readonly pullRequestReference: string | null;
  readonly recentChangePaths: readonly string[];
  readonly failedTestNames: readonly string[];
  readonly errorSamples: readonly string[];
  readonly previousDeploymentHealthy: boolean;
}

export type InvestigationConfidence = "low" | "medium" | "high";

export interface InvestigationResult {
  readonly likelyCause: string;
  readonly affectedSubsystem: string;
  readonly confidence: InvestigationConfidence;
  readonly recommendedAction: string;
  readonly risk: RiskLevel;
  readonly evidence: readonly InvestigationEvidenceItem[];
  readonly analyzer: string;
}

const PROTECTED_PATH_PATTERNS = [
  /^supabase\/migrations\//,
  /^\.github\/workflows\//,
  /^policies\//,
  /(^|\/)auth/i,
  /(^|\/)rls/i,
  /\.env/,
];

function subsystemFor(
  signalKind: ProductionSignalKind,
  changedPaths: readonly string[],
): string {
  if (signalKind === "authentication") return "authentication";
  if (signalKind === "database") return "database";
  if (signalKind === "integration") return "provider integration";
  if (signalKind === "job") return "background jobs";
  if (changedPaths.some((path) => path.startsWith("supabase/migrations/"))) return "database";
  if (changedPaths.some((path) => /(^|\/)api\//.test(path))) return "api";
  if (changedPaths.some((path) => /(^|\/)app\//.test(path))) return "web";
  return "web";
}

function riskFor(
  signalKind: ProductionSignalKind,
  changedPaths: readonly string[],
): RiskLevel {
  const touchesProtected = changedPaths.some((path) =>
    PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(path)),
  );
  if (touchesProtected || signalKind === "authentication" || signalKind === "database") {
    return "RED";
  }
  return "YELLOW";
}

/**
 * Confidence is earned by corroboration. A single failing probe with no
 * deployment correlation is `low` no matter how alarming it looks.
 */
function confidenceFor(input: InvestigationInput): InvestigationConfidence {
  let corroboration = 0;
  const deploymentCorrelated =
    input.deploymentReference !== null
    && input.minutesSinceDeployment !== null
    && input.minutesSinceDeployment <= 60;

  if (deploymentCorrelated) corroboration += 2;
  if (deploymentCorrelated && input.previousDeploymentHealthy) corroboration += 1;
  if (input.failedTestNames.length > 0) corroboration += 1;
  if (input.occurrenceCount >= 3) corroboration += 1;
  if (input.recentChangePaths.length > 0 && deploymentCorrelated) corroboration += 1;

  if (corroboration >= 4) return "high";
  if (corroboration >= 2) return "medium";
  return "low";
}

export function investigateProductionIncident(
  input: InvestigationInput,
): InvestigationResult {
  const evidence: InvestigationEvidenceItem[] = [];

  if (input.failingMonitorNames.length) {
    evidence.push({
      kind: "health_check",
      reference: input.failingMonitorNames.join(", "),
      detail: `${input.failingMonitorNames.length} monitor(s) failing across ${input.occurrenceCount} observation(s).`,
    });
  }
  if (input.deploymentReference) {
    evidence.push({
      kind: "deployment",
      reference: input.deploymentReference,
      detail: input.minutesSinceDeployment === null
        ? "Deployment identified but not time-correlated with the failure."
        : `Failure began ${input.minutesSinceDeployment} minute(s) after this deployment.`,
    });
  }
  if (input.commitSha) {
    evidence.push({ kind: "commit", reference: input.commitSha, detail: "Released commit." });
  }
  if (input.pullRequestReference) {
    evidence.push({
      kind: "pull_request",
      reference: input.pullRequestReference,
      detail: "Pull request that introduced the released change.",
    });
  }
  for (const path of input.recentChangePaths.slice(0, 10)) {
    evidence.push({ kind: "recent_change", reference: path, detail: "Changed in the suspect release." });
  }
  for (const test of input.failedTestNames.slice(0, 10)) {
    evidence.push({ kind: "failed_test", reference: test, detail: "Failing test associated with the release." });
  }
  for (const sample of input.errorSamples.slice(0, 5)) {
    evidence.push({ kind: "error", reference: sample, detail: "Observed error signature." });
  }

  const subsystem = subsystemFor(input.signalKind, input.recentChangePaths);
  const confidence = confidenceFor(input);
  const deploymentCorrelated =
    input.deploymentReference !== null
    && input.minutesSinceDeployment !== null
    && input.minutesSinceDeployment <= 60;

  const likelyCause = deploymentCorrelated
    ? `The ${subsystem} subsystem began failing shortly after deployment ${input.deploymentReference}, so the released change is the leading suspect.`
    : input.failedTestNames.length > 0
      ? `The ${subsystem} subsystem is failing alongside known failing tests, suggesting a defect rather than an environmental fault.`
      : `The ${subsystem} subsystem is failing without a correlated release, so an environmental or dependency fault is as likely as a code defect.`;

  const recommendedAction = deploymentCorrelated && input.previousDeploymentHealthy
    ? "Evaluate rollback to the last validated deployment, then diagnose the released change."
    : confidence === "low"
      ? "Gather more evidence before changing production; confirm whether the fault is environmental."
      : "Create bounded repair work for the identified subsystem and validate in preview before release.";

  return Object.freeze({
    likelyCause,
    affectedSubsystem: subsystem,
    confidence,
    recommendedAction,
    risk: riskFor(input.signalKind, input.recentChangePaths),
    evidence: Object.freeze(evidence),
    analyzer: PRODUCTION_INVESTIGATOR_VERSION,
  });
}
