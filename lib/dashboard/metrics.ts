/**
 * Dashboard aggregation.
 *
 * Every figure here is derived from tenant rows that actually exist. A metric
 * with no underlying source is reported as unavailable rather than rendered as
 * a zero, because a confident zero and "we cannot see this" are different
 * claims and only one of them is honest.
 */

export type MetricAvailability = "live" | "unavailable";

export type PortfolioMetrics = {
  readonly total: number;
  readonly connected: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly disconnected: number;
};

export type WorkforceMetrics = {
  readonly available: number;
  readonly active: number;
  readonly queuedRuns: number;
  readonly failedRuns: number;
};

export type EngineeringMetrics = {
  readonly tasksInProgress: number;
  readonly tasksCompleted: number;
  readonly pullRequestsCreated: number;
  readonly pullRequestsMerged: number;
  readonly pullRequestsWaiting: number;
  readonly ciFailures: number;
  readonly testsPassed: number;
  readonly issuesDiscovered: number;
  readonly securityFindings: number;
};

export type ProductionMetrics = {
  readonly availability: MetricAvailability;
  readonly deployments: number;
  readonly deploymentFailures: number;
  readonly rollbacks: number;
  readonly openIncidents: number;
};

export type OwnerAttentionItem = {
  readonly kind:
    | "approval_required"
    | "run_failed"
    | "security_finding"
    | "connection_broken"
    | "ci_failure"
    | "incident"
    | "configuration_required";
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly severity: "info" | "warning" | "danger";
};

export type ProjectSnapshot = {
  readonly id: string;
  readonly status: string;
  readonly healthStatus: string;
  readonly connected: boolean;
};

export type RunSnapshot = {
  readonly status: string;
  readonly failureKind: string | null;
  readonly createdAt: string;
};

export type TaskSnapshot = {
  readonly status: string;
  readonly riskLevel: string;
  readonly requiresOwnerApproval: boolean;
  readonly source: string;
};

export type PullRequestSnapshot = {
  readonly status: string;
};

export function summarizePortfolio(projects: readonly ProjectSnapshot[]): PortfolioMetrics {
  const active = projects.filter((project) => project.status !== "archived");
  return {
    total: active.length,
    connected: active.filter((project) => project.connected).length,
    healthy: active.filter((project) => project.healthStatus === "healthy").length,
    degraded: active.filter(
      (project) => project.healthStatus === "degraded" || project.healthStatus === "unhealthy",
    ).length,
    disconnected: active.filter((project) => !project.connected).length,
  };
}

export function summarizeWorkforce(
  agents: ReadonlyArray<{ enabled: boolean }>,
  runs: readonly RunSnapshot[],
): WorkforceMetrics {
  return {
    available: agents.filter((agent) => agent.enabled).length,
    active: runs.filter((run) => run.status === "running" || run.status === "validating").length,
    queuedRuns: runs.filter((run) => run.status === "queued").length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
  };
}

export function summarizeEngineering(input: {
  readonly tasks: readonly TaskSnapshot[];
  readonly pullRequests: readonly PullRequestSnapshot[];
  readonly runs: readonly RunSnapshot[];
  readonly testsPassed: number;
  readonly securityFindings: number;
}): EngineeringMetrics {
  return {
    tasksInProgress: input.tasks.filter((task) => task.status === "in_progress").length,
    tasksCompleted: input.tasks.filter((task) => task.status === "completed").length,
    pullRequestsCreated: input.pullRequests.length,
    pullRequestsMerged: input.pullRequests.filter((pr) => pr.status === "merged").length,
    pullRequestsWaiting: input.pullRequests.filter(
      (pr) => pr.status === "draft" || pr.status === "open",
    ).length,
    ciFailures: input.runs.filter((run) => run.failureKind === "ci_failure").length,
    testsPassed: input.testsPassed,
    issuesDiscovered: input.tasks.filter(
      (task) => task.source === "ai_audit" || task.source === "failed_test" || task.source === "ci_failure",
    ).length,
    securityFindings: input.securityFindings,
  };
}

export function buildOwnerAttention(input: {
  readonly pendingApprovals: number;
  readonly failedRuns: number;
  readonly securityFindings: number;
  readonly disconnectedProjects: number;
  readonly ciFailures: number;
  readonly openIncidents: number;
  readonly configurationGaps: readonly string[];
}): OwnerAttentionItem[] {
  const items: OwnerAttentionItem[] = [];

  if (input.pendingApprovals > 0) {
    items.push({
      kind: "approval_required",
      title: `${input.pendingApprovals} RED approval request${input.pendingApprovals === 1 ? "" : "s"}`,
      detail: "RED work cannot start until an organization owner approves it.",
      href: "/backlog?risk=red",
      severity: "danger",
    });
  }
  if (input.failedRuns > 0) {
    items.push({
      kind: "run_failed",
      title: `${input.failedRuns} failed run${input.failedRuns === 1 ? "" : "s"}`,
      detail: "Review the failure evidence before resubmitting the work.",
      href: "/runs?status=failed",
      severity: "danger",
    });
  }
  if (input.securityFindings > 0) {
    items.push({
      kind: "security_finding",
      title: `${input.securityFindings} security finding${input.securityFindings === 1 ? "" : "s"}`,
      detail: "Findings were recorded by a run and need triage.",
      href: "/runs",
      severity: "danger",
    });
  }
  if (input.ciFailures > 0) {
    items.push({
      kind: "ci_failure",
      title: `${input.ciFailures} run${input.ciFailures === 1 ? "" : "s"} blocked by CI`,
      detail: "Real CI checks failed and the repair limit was reached.",
      href: "/runs?status=failed",
      severity: "warning",
    });
  }
  if (input.openIncidents > 0) {
    items.push({
      kind: "incident",
      title: `${input.openIncidents} open incident${input.openIncidents === 1 ? "" : "s"}`,
      detail: "Production incidents remain unresolved.",
      href: "/activity",
      severity: "danger",
    });
  }
  if (input.disconnectedProjects > 0) {
    items.push({
      kind: "connection_broken",
      title: `${input.disconnectedProjects} project${input.disconnectedProjects === 1 ? "" : "s"} without a live connection`,
      detail: "A project with no live GitHub connection cannot run any work.",
      href: "/connections",
      severity: "warning",
    });
  }
  for (const gap of input.configurationGaps) {
    items.push({
      kind: "configuration_required",
      title: "Configuration required",
      detail: gap,
      href: "/settings",
      severity: "info",
    });
  }

  return items;
}
