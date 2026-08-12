/**
 * The CEO Reporter.
 *
 * It summarizes structured factory data. It does not invent work, and it does
 * not narrate. Routine successful GREEN activity is compressed into a single
 * line; exceptions are listed individually, because the value of an executive
 * brief is what it surfaces, not its length.
 */

export type ReportWindow = {
  readonly start: string;
  readonly end: string;
};

export type ReportInput = {
  readonly window: ReportWindow;
  readonly tasksCompleted: number;
  readonly tasksActive: number;
  readonly runsSucceeded: number;
  readonly runsFailed: number;
  readonly runsCancelled: number;
  readonly greenRunsSucceeded: number;
  readonly pullRequestsCreated: number;
  readonly pullRequestsMerged: number;
  readonly pullRequestsWaiting: number;
  readonly deployments: number;
  readonly deploymentFailures: number;
  readonly rollbacks: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly bugsFixed: number;
  readonly issuesDiscovered: number;
  readonly securityFindings: readonly string[];
  readonly blockers: readonly string[];
  readonly ownerDecisions: readonly string[];
  readonly deploymentTelemetryAvailable: boolean;
};

export type ReportSection = {
  readonly heading: string;
  readonly lines: readonly string[];
};

export type GeneratedReport = {
  readonly title: string;
  readonly summary: string;
  readonly posture: "stable" | "attention" | "blocked";
  readonly metrics: Readonly<Record<string, number>>;
  readonly sections: readonly ReportSection[];
  readonly recommendations: readonly string[];
};

function plural(count: number, singular: string, plural_?: string) {
  return `${count} ${count === 1 ? singular : (plural_ ?? `${singular}s`)}`;
}

export function generateCeoReport(input: ReportInput): GeneratedReport {
  const exceptions =
    input.runsFailed + input.deploymentFailures + input.rollbacks
    + input.securityFindings.length + input.blockers.length;
  const posture: GeneratedReport["posture"] =
    input.blockers.length > 0 || input.rollbacks > 0
      ? "blocked"
      : exceptions > 0
        ? "attention"
        : "stable";

  const summary =
    exceptions === 0
      ? `Delivery was routine: ${plural(input.runsSucceeded, "run")} succeeded and ${plural(
        input.pullRequestsCreated,
        "pull request",
      )} were opened for review, with no failure, rollback, or security finding.`
      : `${plural(input.tasksCompleted, "task")} completed. ${plural(
        exceptions,
        "exception needs",
        "exceptions need",
      )} attention: ${[
        input.runsFailed > 0 ? `${input.runsFailed} failed run(s)` : null,
        input.securityFindings.length > 0 ? `${input.securityFindings.length} security finding(s)` : null,
        input.rollbacks > 0 ? `${input.rollbacks} rollback(s)` : null,
        input.blockers.length > 0 ? `${input.blockers.length} blocker(s)` : null,
      ]
        .filter(Boolean)
        .join(", ")}.`;

  const sections: ReportSection[] = [];

  // Routine GREEN success is compressed to one line by design.
  if (input.greenRunsSucceeded > 0) {
    sections.push({
      heading: "Routine activity",
      lines: [
        `${plural(input.greenRunsSucceeded, "GREEN run")} completed without incident and are not itemized.`,
      ],
    });
  }

  if (input.runsFailed > 0 || input.runsCancelled > 0) {
    sections.push({
      heading: "Runs needing attention",
      lines: [
        ...(input.runsFailed > 0 ? [`${plural(input.runsFailed, "run")} failed.`] : []),
        ...(input.runsCancelled > 0 ? [`${plural(input.runsCancelled, "run")} was cancelled.`] : []),
      ],
    });
  }

  sections.push({
    heading: "Delivery",
    lines: [
      `${plural(input.pullRequestsCreated, "pull request")} opened; ${input.pullRequestsMerged} merged; ${input.pullRequestsWaiting} waiting for review.`,
      input.deploymentTelemetryAvailable
        ? `${plural(input.deployments, "deployment")}, ${input.deploymentFailures} failed, ${input.rollbacks} rolled back.`
        : "Deployment telemetry is unavailable: no deployment provider is connected.",
    ],
  });

  sections.push({
    heading: "Quality",
    lines: [
      `${input.testsPassed} test(s) passed and ${input.testsFailed} failed in real repository CI.`,
      `${plural(input.bugsFixed, "bug")} fixed; ${plural(input.issuesDiscovered, "issue")} discovered.`,
    ],
  });

  if (input.securityFindings.length > 0) {
    sections.push({ heading: "Security findings", lines: input.securityFindings.slice(0, 10) });
  }
  if (input.blockers.length > 0) {
    sections.push({ heading: "Blockers", lines: input.blockers.slice(0, 10) });
  }
  if (input.ownerDecisions.length > 0) {
    sections.push({ heading: "Owner decisions required", lines: input.ownerDecisions.slice(0, 10) });
  }

  const recommendations: string[] = [];
  if (input.securityFindings.length > 0) {
    recommendations.push("Triage the open security findings and set a remediation deadline.");
  }
  if (input.runsFailed > 0) {
    recommendations.push("Review failed run evidence before resubmitting the same work.");
  }
  if (input.pullRequestsWaiting > 0) {
    recommendations.push(
      `Review ${plural(input.pullRequestsWaiting, "waiting draft pull request")}; nothing merges without a human.`,
    );
  }
  if (input.blockers.length > 0) {
    recommendations.push("Clear the recorded blockers, which are holding dependent work.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No action is required. Continue the current plan.");
  }

  return {
    title: `Daily operating report — ${input.window.end.slice(0, 10)}`,
    summary,
    posture,
    metrics: {
      tasksCompleted: input.tasksCompleted,
      tasksActive: input.tasksActive,
      runsSucceeded: input.runsSucceeded,
      runsFailed: input.runsFailed,
      pullRequestsCreated: input.pullRequestsCreated,
      pullRequestsMerged: input.pullRequestsMerged,
      pullRequestsWaiting: input.pullRequestsWaiting,
      deployments: input.deployments,
      rollbacks: input.rollbacks,
      testsPassed: input.testsPassed,
      testsFailed: input.testsFailed,
      bugsFixed: input.bugsFixed,
      issuesDiscovered: input.issuesDiscovered,
      securityFindings: input.securityFindings.length,
      blockers: input.blockers.length,
    },
    sections,
    recommendations: recommendations.slice(0, 3),
  };
}
