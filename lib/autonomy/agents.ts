import type { DiffFile, DiffRiskAssessment } from "@/lib/autonomy/diff-risk";
import type { Gate, GateResult } from "@/lib/autonomy/gates";

/**
 * The three reviewing agents the loop runs before a change may be approved.
 *
 * These are deterministic analysers, not model calls. Manual Phase 1C remains
 * separate and Not Connected, and Phase 2A's provider layer is a general
 * execution surface, not a reviewer bound to this loop — so a model-backed reviewer would be a claim this tree
 * cannot support. A rules engine can be tested, reproduces exactly, and cannot
 * hallucinate an approval, which is the property that matters at a gate.
 *
 * Each agent contributes findings. A blocking finding stops progression on its
 * own; advisory findings are recorded and reported but do not stop anything.
 */

export const REVIEW_AGENTS = ["review", "qa", "security"] as const;
export type ReviewAgent = (typeof REVIEW_AGENTS)[number];

export const AGENT_LABELS: Readonly<Record<ReviewAgent, string>> = Object.freeze({
  review: "Review agent",
  qa: "QA agent",
  security: "Security agent",
});

export type FindingSeverity = "blocking" | "advisory";

export interface AgentFinding {
  readonly agent: ReviewAgent;
  readonly severity: FindingSeverity;
  readonly code: string;
  readonly summary: string;
  /** The path the finding is about, when it is about one. */
  readonly path?: string;
}

export interface AgentReviewInput {
  readonly files: readonly DiffFile[];
  readonly assessment: DiffRiskAssessment;
  readonly gateResults: readonly GateResult[];
  /** Whether the change carries a test file alongside its source changes. */
  readonly hasTestChanges?: boolean;
}

export interface AgentReport {
  readonly agent: ReviewAgent;
  readonly findings: readonly AgentFinding[];
  readonly blocking: boolean;
}

export interface AgentReviewResult {
  readonly reports: readonly AgentReport[];
  readonly findings: readonly AgentFinding[];
  readonly blockingFindings: readonly AgentFinding[];
  readonly clear: boolean;
}

function outcomeOf(results: readonly GateResult[], gate: Gate) {
  return results.find((result) => result.gate === gate)?.outcome;
}

const SOURCE_PATTERN = /^(app|lib|components)\/.*\.(ts|tsx)$/;
const TEST_PATTERN = /^tests\/|\.(test|spec)\.[jt]sx?$/;

/**
 * Reviews the shape of the change itself: does it carry evidence, is it
 * reviewable, does it mix concerns that should have been separated.
 */
function reviewAgent(input: AgentReviewInput): readonly AgentFinding[] {
  const findings: AgentFinding[] = [];
  const source = input.files.filter((file) => SOURCE_PATTERN.test(file.path));
  const tests = input.files.filter((file) => TEST_PATTERN.test(file.path));
  const hasTests = input.hasTestChanges ?? tests.length > 0;

  if (source.length > 0 && !hasTests) {
    findings.push({
      agent: "review",
      severity: "blocking",
      code: "NO_TEST_EVIDENCE",
      summary: "Source files changed with no accompanying test change.",
    });
  }

  if (outcomeOf(input.gateResults, "diff_review") !== "passed") {
    findings.push({
      agent: "review",
      severity: "blocking",
      code: "DIFF_NOT_REVIEWED",
      summary: "The diff has not been reviewed.",
    });
  }

  if (input.files.length === 0) {
    findings.push({
      agent: "review",
      severity: "blocking",
      code: "EMPTY_DIFF",
      summary: "There is no change to review.",
    });
  }

  if (input.files.length > 60) {
    findings.push({
      agent: "review",
      severity: "advisory",
      code: "LARGE_DIFF",
      summary: `${input.files.length} files changed; consider splitting the change.`,
    });
  }

  return findings;
}

/** Reviews whether the change was actually verified. */
function qaAgent(input: AgentReviewInput): readonly AgentFinding[] {
  const findings: AgentFinding[] = [];

  for (const gate of ["tests", "typecheck", "build"] as const) {
    const outcome = outcomeOf(input.gateResults, gate);
    if (outcome === "failed") {
      findings.push({
        agent: "qa",
        severity: "blocking",
        code: `${gate.toUpperCase()}_FAILED`,
        summary: `${gate} reported a failure.`,
      });
    } else if (outcome === undefined || outcome === "not_run") {
      findings.push({
        agent: "qa",
        severity: "blocking",
        code: `${gate.toUpperCase()}_NOT_RUN`,
        summary: `${gate} has not run.`,
      });
    }
  }

  if (outcomeOf(input.gateResults, "lint") === "failed") {
    findings.push({
      agent: "qa",
      severity: "advisory",
      code: "LINT_FAILED",
      summary: "Lint reported a failure.",
    });
  }

  return findings;
}

/**
 * Reviews the change for the classes this repository refuses to automate:
 * credential material, security-control changes, and destructive schema work.
 */
function securityAgent(input: AgentReviewInput): readonly AgentFinding[] {
  const findings: AgentFinding[] = [];
  const { factors } = input.assessment;

  if (outcomeOf(input.gateResults, "secret_scan") !== "passed") {
    findings.push({
      agent: "security",
      severity: "blocking",
      code: "SECRET_SCAN_NOT_PASSED",
      summary: "The secret scan did not pass.",
    });
  }

  const redFactors = [
    "secrets-or-credentials",
    "destructive-production-data",
    "authentication-or-security-controls",
    "dns-or-domain-ownership",
    "privileged-access",
    "money-or-billing",
    "irreversible-production-change",
  ] as const;

  for (const factor of redFactors) {
    if (factors.includes(factor)) {
      findings.push({
        agent: "security",
        severity: "blocking",
        code: `RED_FACTOR_${factor.toUpperCase().replaceAll("-", "_")}`,
        summary: `The diff touches ${factor.replaceAll("-", " ")}; an owner must decide it.`,
      });
    }
  }

  if (factors.includes("non-destructive-schema-change")) {
    const reviewed = outcomeOf(input.gateResults, "migration_review");
    findings.push({
      agent: "security",
      severity: reviewed === "passed" ? "advisory" : "blocking",
      code: "SCHEMA_CHANGE",
      summary:
        reviewed === "passed"
          ? "Schema change reviewed."
          : "The diff changes database schema and has no migration review.",
    });
  }

  return findings;
}

const AGENT_RULES: Readonly<Record<ReviewAgent, (input: AgentReviewInput) => readonly AgentFinding[]>> =
  Object.freeze({
    review: reviewAgent,
    qa: qaAgent,
    security: securityAgent,
  });

/**
 * Run all three agents.
 *
 * `clear` is true only when no agent produced a blocking finding. Advisory
 * findings never gate; they exist so a report can say what was noticed without
 * inventing a reason to stop.
 */
export function runReviewAgents(input: AgentReviewInput): AgentReviewResult {
  const reports: AgentReport[] = REVIEW_AGENTS.map((agent) => {
    const findings = AGENT_RULES[agent](input);
    return Object.freeze({
      agent,
      findings: Object.freeze(findings),
      blocking: findings.some((finding) => finding.severity === "blocking"),
    });
  });

  const findings = reports.flatMap((report) => report.findings);
  const blockingFindings = findings.filter((finding) => finding.severity === "blocking");

  return Object.freeze({
    reports: Object.freeze(reports),
    findings: Object.freeze(findings),
    blockingFindings: Object.freeze(blockingFindings),
    clear: blockingFindings.length === 0,
  });
}
