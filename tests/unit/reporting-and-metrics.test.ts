import { describe, expect, it } from "vitest";

import {
  buildOwnerAttention,
  summarizeEngineering,
  summarizePortfolio,
  summarizeWorkforce,
  type ProjectSnapshot,
  type RunSnapshot,
  type TaskSnapshot,
} from "@/lib/dashboard/metrics";
import { generateCeoReport, type ReportInput } from "@/lib/reports/ceo-reporter";

function reportInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    window: { start: "2026-08-11T00:00:00.000Z", end: "2026-08-12T00:00:00.000Z" },
    tasksCompleted: 4,
    tasksActive: 1,
    runsSucceeded: 4,
    runsFailed: 0,
    runsCancelled: 0,
    greenRunsSucceeded: 4,
    pullRequestsCreated: 3,
    pullRequestsMerged: 2,
    pullRequestsWaiting: 1,
    deployments: 0,
    deploymentFailures: 0,
    rollbacks: 0,
    testsPassed: 208,
    testsFailed: 0,
    bugsFixed: 2,
    issuesDiscovered: 1,
    securityFindings: [],
    blockers: [],
    ownerDecisions: [],
    deploymentTelemetryAvailable: false,
    ...overrides,
  };
}

describe("CEO reporter", () => {
  it("compresses routine GREEN activity into a single line", () => {
    const report = generateCeoReport(reportInput());
    const routine = report.sections.find((section) => section.heading === "Routine activity");

    expect(report.posture).toBe("stable");
    expect(routine?.lines).toHaveLength(1);
    expect(routine?.lines[0]).toContain("4 GREEN runs");
    expect(routine?.lines[0]).toContain("not itemized");
  });

  it("names exceptions individually instead of compressing them", () => {
    const report = generateCeoReport(
      reportInput({
        runsFailed: 2,
        securityFindings: ["Overbroad OAuth scope", "Outdated dependency advisory"],
      }),
    );

    expect(report.posture).toBe("attention");
    const findings = report.sections.find((section) => section.heading === "Security findings");
    expect(findings?.lines).toEqual(["Overbroad OAuth scope", "Outdated dependency advisory"]);
    expect(report.summary).toContain("2 failed run(s)");
  });

  it("reports a blocked posture when work is held", () => {
    expect(generateCeoReport(reportInput({ blockers: ["Waiting on owner approval"] })).posture).toBe("blocked");
    expect(generateCeoReport(reportInput({ rollbacks: 1 })).posture).toBe("blocked");
  });

  it("says deployment telemetry is unavailable rather than reporting zero deployments", () => {
    const report = generateCeoReport(reportInput({ deploymentTelemetryAvailable: false }));
    const delivery = report.sections.find((section) => section.heading === "Delivery");

    expect(delivery?.lines.join(" ")).toContain("Deployment telemetry is unavailable");
    expect(delivery?.lines.join(" ")).not.toContain("0 deployments,");
  });

  it("invents no work when nothing happened", () => {
    const report = generateCeoReport(
      reportInput({
        tasksCompleted: 0,
        runsSucceeded: 0,
        greenRunsSucceeded: 0,
        pullRequestsCreated: 0,
        pullRequestsMerged: 0,
        pullRequestsWaiting: 0,
        testsPassed: 0,
        bugsFixed: 0,
        issuesDiscovered: 1,
      }),
    );

    expect(report.metrics.tasksCompleted).toBe(0);
    expect(report.sections.some((section) => section.heading === "Routine activity")).toBe(false);
    expect(report.recommendations).toEqual(["No action is required. Continue the current plan."]);
  });

  it("caps recommendations so the brief stays readable", () => {
    const report = generateCeoReport(
      reportInput({
        runsFailed: 3,
        pullRequestsWaiting: 5,
        securityFindings: ["a"],
        blockers: ["b"],
      }),
    );

    expect(report.recommendations.length).toBeLessThanOrEqual(3);
  });
});

describe("dashboard metrics", () => {
  const projects: ProjectSnapshot[] = [
    { id: "1", status: "active", healthStatus: "healthy", connected: true },
    { id: "2", status: "active", healthStatus: "degraded", connected: true },
    { id: "3", status: "active", healthStatus: "unknown", connected: false },
    { id: "4", status: "archived", healthStatus: "healthy", connected: true },
  ];

  it("excludes archived projects from the portfolio", () => {
    const portfolio = summarizePortfolio(projects);

    expect(portfolio.total).toBe(3);
    expect(portfolio.connected).toBe(2);
    expect(portfolio.degraded).toBe(1);
    expect(portfolio.disconnected).toBe(1);
  });

  it("counts only leased work as active", () => {
    const runs: RunSnapshot[] = [
      { status: "running", failureKind: null, createdAt: "2026-08-12T00:00:00.000Z" },
      { status: "queued", failureKind: null, createdAt: "2026-08-12T00:00:00.000Z" },
      { status: "failed", failureKind: "ci_failure", createdAt: "2026-08-12T00:00:00.000Z" },
    ];
    const workforce = summarizeWorkforce([{ enabled: true }, { enabled: false }], runs);

    expect(workforce.available).toBe(1);
    expect(workforce.active).toBe(1);
    expect(workforce.queuedRuns).toBe(1);
    expect(workforce.failedRuns).toBe(1);
  });

  it("counts discovered issues only from audit and failure sources", () => {
    const tasks: TaskSnapshot[] = [
      { status: "completed", riskLevel: "green", requiresOwnerApproval: false, source: "ai_audit" },
      { status: "in_progress", riskLevel: "green", requiresOwnerApproval: false, source: "ci_failure" },
      { status: "backlog", riskLevel: "green", requiresOwnerApproval: false, source: "owner" },
    ];
    const engineering = summarizeEngineering({
      tasks,
      pullRequests: [{ status: "draft" }, { status: "merged" }],
      runs: [{ status: "failed", failureKind: "ci_failure", createdAt: "2026-08-12T00:00:00.000Z" }],
      testsPassed: 12,
      securityFindings: 2,
    });

    expect(engineering.issuesDiscovered).toBe(2);
    expect(engineering.pullRequestsWaiting).toBe(1);
    expect(engineering.pullRequestsMerged).toBe(1);
    expect(engineering.ciFailures).toBe(1);
  });

  it("puts approvals and failures ahead of configuration notes", () => {
    const attention = buildOwnerAttention({
      pendingApprovals: 1,
      failedRuns: 2,
      securityFindings: 1,
      disconnectedProjects: 1,
      ciFailures: 0,
      openIncidents: 0,
      configurationGaps: ["Commanded execution is OFF for this organization."],
    });

    expect(attention[0].kind).toBe("approval_required");
    expect(attention[0].severity).toBe("danger");
    expect(attention.at(-1)?.kind).toBe("configuration_required");
    expect(attention.map((item) => item.kind)).toContain("connection_broken");
  });

  it("reports nothing to do when the tenant is clean", () => {
    expect(
      buildOwnerAttention({
        pendingApprovals: 0,
        failedRuns: 0,
        securityFindings: 0,
        disconnectedProjects: 0,
        ciFailures: 0,
        openIncidents: 0,
        configurationGaps: [],
      }),
    ).toEqual([]);
  });
});
