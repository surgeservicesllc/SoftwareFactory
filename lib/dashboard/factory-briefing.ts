/**
 * A deterministic, read-only briefing over the control plane's existing safe
 * projections. The same work never appears in two lanes: a task folds in its
 * latest run, while runs with no loaded task remain visible on their own.
 *
 * This adapts FirstMate's useful "bearings" information architecture without
 * importing its local shell runtime, state files, credentials, or authority.
 */

export type BriefingBucket = "needs_you" | "underway" | "recently_finished" | "up_next";

export type BriefingTask = Readonly<{
  id: string;
  title?: string;
  status: string;
  risk: string;
  requiresOwnerApproval: boolean;
  priority: number;
  createdAt: string;
  dependencyCount?: number;
  project: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  command?: { id: string; prompt?: string | null } | null;
  latestRun?: { id: string; status: string } | null;
  pullRequest?: { number: number; url?: string | null; status?: string } | null;
}>;

export type BriefingRun = Readonly<{
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  branch?: string | null;
  project: { id: string; name: string } | null;
  task: { id: string; title?: string } | null;
  agent: { id: string; name: string } | null;
}>;

export type BriefingGraphRun = Readonly<{
  graphRunId: string;
  goal: string;
  topology: string;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
  verifications?: readonly Readonly<{ verdict: string }>[];
}>;

export type BriefingInboxMessage = Readonly<{
  id: string;
  status: string;
  kind: string;
  agentName: string | null;
  createdAt: string;
}>;

export type BriefingIncident = Readonly<{
  id: string;
  title: string;
  projectName: string;
  severity: string;
  status: string;
  impact: string | null;
  detectedAt?: string;
  resolvedAt: string | null;
  ownerAttentionRequired: boolean;
}>;

export type BriefingConnection = Readonly<{
  id: string;
  name: string;
  status: string;
  statusReason: string | null;
}>;

export type BriefingAgent = Readonly<{
  id: string;
  name: string;
  role: string;
  status: string;
}>;

export type BriefingWorker = Readonly<{
  connectionStatus: "connected" | "stale" | "not_connected";
  statusLabel: string;
  lastHeartbeatAt: string | null;
  activeWorkers: number;
  availableWorkers: number;
  staleAfterSeconds: number;
}>;

export type BriefingInput = Readonly<{
  tasks: readonly BriefingTask[];
  runs: readonly BriefingRun[];
  graphRuns: readonly BriefingGraphRun[];
  inboxMessages: readonly BriefingInboxMessage[];
  incidents: readonly BriefingIncident[];
  connections: readonly BriefingConnection[];
  agents: readonly BriefingAgent[];
  worker: BriefingWorker | null;
}>;

export type BriefingItem = Readonly<{
  key: string;
  bucket: BriefingBucket;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  label: string;
  occurredAt: string | null;
  evidenceUrl?: string | null;
  evidenceLabel?: string | null;
  priority: number;
}>;

export type BriefingSection = Readonly<{
  items: readonly BriefingItem[];
  total: number;
}>;

export type FactoryBriefing = Readonly<{
  needsYou: BriefingSection;
  underway: BriefingSection;
  recentlyFinished: BriefingSection;
  upNext: BriefingSection;
  crew: Readonly<{
    liaison: { id: string; name: string } | null;
    activeAgents: number;
    totalAgents: number;
    worker: BriefingWorker | null;
  }>;
  omittedCancelled: number;
}>;

const DEFAULT_SECTION_LIMIT = 4;
const ACTIVE_AGENT_STATUSES = new Set(["busy"]);

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function readableStatus(value: string) {
  return value.trim().replace(/_/g, " ").toLowerCase() || "unknown";
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectDetail(project: { name: string } | null, fallback: string) {
  return project?.name ? `${project.name} · ${fallback}` : fallback;
}

function makeItem(
  bucket: BriefingBucket,
  item: Omit<BriefingItem, "bucket">,
): BriefingItem {
  return { bucket, ...item };
}

function sortedSection(
  items: readonly BriefingItem[],
  limit: number,
  order: "priority_first" | "recency_first" = "priority_first",
): BriefingSection {
  const ordered = [...items].sort((left, right) => {
    const recency = timestamp(right.occurredAt) - timestamp(left.occurredAt);
    const priority = right.priority - left.priority;
    if (order === "recency_first") {
      if (recency !== 0) return recency;
      if (priority !== 0) return priority;
    } else {
      if (priority !== 0) return priority;
      if (recency !== 0) return recency;
    }
    return left.key.localeCompare(right.key);
  });
  return { items: ordered.slice(0, limit), total: ordered.length };
}

function taskItem(task: BriefingTask, runById: ReadonlyMap<string, BriefingRun>): BriefingItem | null {
  const status = normalized(task.status);
  const run = task.latestRun ? runById.get(task.latestRun.id) : undefined;
  const runStatus = normalized(run?.status ?? task.latestRun?.status ?? "");
  const common = {
    key: `task:${task.id}`,
    title: task.title?.trim() || "Work item",
    priority: Number.isFinite(task.priority) ? task.priority : 0,
    evidenceUrl: task.pullRequest?.url ?? null,
    evidenceLabel: task.pullRequest ? `PR #${task.pullRequest.number}` : null,
  } as const;

  if (status === "cancelled") return null;
  if (status === "awaiting_approval") {
    return makeItem("needs_you", {
      ...common,
      actionLabel: "Review request",
      detail: projectDetail(task.project, `${task.risk.toUpperCase()} work is recorded and waiting for an owner decision.`),
      href: "/solutions/bot-manager",
      label: "Decision",
      occurredAt: task.createdAt,
      priority: Math.max(common.priority, 110),
    });
  }
  if (status === "failed") {
    return makeItem("needs_you", {
      ...common,
      actionLabel: "Inspect run",
      detail: projectDetail(task.project, "The latest attempt failed; its evidence is preserved."),
      href: "/solutions/runs",
      label: "Failed",
      occurredAt: run?.completedAt ?? null,
      priority: Math.max(common.priority, 100),
    });
  }
  // Provider/advisory runs can finish without mutating their task. Fold the
  // latest recorded run into the task instead of hiding a failure behind a
  // still-backlog task or rendering the same work in two lanes.
  if (runStatus === "failed") {
    return makeItem("needs_you", {
      ...common,
      actionLabel: "Inspect run",
      detail: projectDetail(task.project, `The latest run failed while the task remains ${readableStatus(task.status)}.`),
      href: "/solutions/runs",
      label: "Run failed",
      occurredAt: run?.completedAt ?? null,
      priority: Math.max(common.priority, 100),
    });
  }
  if (runStatus === "running") {
    return makeItem("underway", {
      ...common,
      actionLabel: "Open runs",
      detail: projectDetail(task.project, task.agent ? `${task.agent.name} is working on it.` : "Work is running."),
      href: "/solutions/runs",
      label: "Running",
      occurredAt: run?.startedAt ?? null,
    });
  }
  if (status === "completed") {
    return makeItem("recently_finished", {
      ...common,
      actionLabel: "Open runs",
      detail: projectDetail(
        task.project,
        task.pullRequest ? `Validated output is linked to PR #${task.pullRequest.number}.` : "The work completed.",
      ),
      href: "/solutions/runs",
      label: "Completed",
      occurredAt: run?.completedAt ?? null,
    });
  }
  if (runStatus === "succeeded") {
    return makeItem("recently_finished", {
      ...common,
      actionLabel: "Open runs",
      detail: projectDetail(task.project, `The latest run succeeded; the task remains ${readableStatus(task.status)}.`),
      href: "/solutions/runs",
      label: "Run succeeded",
      occurredAt: run?.completedAt ?? null,
    });
  }
  if (status === "in_progress") {
    return makeItem("underway", {
      ...common,
      actionLabel: "Open runs",
      detail: projectDetail(task.project, task.agent ? `${task.agent.name} is working on it.` : "Work is running."),
      href: "/solutions/runs",
      label: "Running",
      occurredAt: run?.startedAt ?? null,
    });
  }
  if (["backlog", "queued", "blocked"].includes(status)) {
    const dependencyDetail = task.dependencyCount
      ? `${task.dependencyCount} dependenc${task.dependencyCount === 1 ? "y" : "ies"} recorded.`
      : status === "blocked"
        ? "A recorded gate is holding this item."
        : status === "queued"
          ? "Ready for an available worker."
          : "Accepted and waiting to be scheduled.";
    return makeItem("up_next", {
      ...common,
      actionLabel: "Open backlog",
      detail: projectDetail(task.project, dependencyDetail),
      href: "/solutions/backlog",
      label: status === "blocked" ? "Gated" : status === "queued" ? "Queued" : "Backlog",
      occurredAt: task.createdAt,
    });
  }

  return makeItem("needs_you", {
    ...common,
    actionLabel: "Inspect item",
    detail: projectDetail(task.project, `The recorded task status is ${readableStatus(task.status)}.`),
    href: "/solutions/backlog",
    label: "Unknown state",
    occurredAt: task.createdAt,
    priority: Math.max(common.priority, 120),
  });
}

function runItem(run: BriefingRun): BriefingItem | null {
  const status = normalized(run.status);
  if (status === "cancelled") return null;
  const title = run.task?.title?.trim() || "Recorded run";
  const common = {
    key: `run:${run.id}`,
    title,
    priority: 50,
    href: "/solutions/runs",
    actionLabel: "Open runs",
  } as const;
  const context = projectDetail(run.project, run.agent ? `Assigned to ${run.agent.name}.` : "No agent is recorded.");
  if (status === "running") {
    return makeItem("underway", { ...common, detail: context, label: "Running", occurredAt: run.startedAt });
  }
  if (status === "succeeded") {
    return makeItem("recently_finished", { ...common, detail: context, label: "Succeeded", occurredAt: run.completedAt });
  }
  if (status === "queued") {
    return makeItem("up_next", { ...common, detail: context, label: "Queued", occurredAt: run.createdAt });
  }
  return makeItem("needs_you", {
    ...common,
    detail: status === "failed" ? "The run failed; its evidence is preserved." : `The recorded run status is ${readableStatus(run.status)}.`,
    label: status === "failed" ? "Failed" : "Unknown state",
    occurredAt: run.completedAt ?? run.startedAt ?? run.createdAt,
    priority: status === "failed" ? 100 : 120,
  });
}

function graphItem(run: BriefingGraphRun): BriefingItem | null {
  const state = run.state.trim().toUpperCase();
  if (state === "CANCELLED") return null;
  const common = {
    key: `graph:${run.graphRunId}`,
    title: run.goal || "Multi-agent graph run",
    priority: 45,
    href: "/solutions/pipelines?view=graphs",
    actionLabel: "Open graph",
  } as const;
  const topology = run.topology ? `${run.topology} graph` : "Multi-agent graph";
  const verificationVerdicts = (run.verifications ?? [])
    .map((verification) => verification.verdict.trim().toUpperCase())
    .map((verdict) => verdict || "UNKNOWN");
  const reviewFindings = verificationVerdicts.filter(
    (verdict) => !["PASS", "WARN"].includes(verdict),
  );
  if (reviewFindings.length > 0) {
    const verdicts = [...new Set(reviewFindings)].join(", ");
    return makeItem("needs_you", {
      ...common,
      detail: `${topology} recorded verification ${verdicts}; inspect the stored evidence.`,
      label: "Verification finding",
      occurredAt: run.completedAt,
      priority: 125,
    });
  }
  if (state === "RUNNING") {
    return makeItem("underway", {
      ...common,
      detail: `${topology} is running.`,
      label: "Graph running",
      occurredAt: run.startedAt,
    });
  }
  if (state === "COMPLETED") {
    const hasWarnings = verificationVerdicts.includes("WARN");
    return makeItem("recently_finished", {
      ...common,
      detail: `${topology} completed${hasWarnings ? " with recorded warnings" : ""}.`,
      label: hasWarnings ? "Completed with warning" : "Graph completed",
      occurredAt: run.completedAt,
    });
  }
  if (state === "PLANNED") {
    return makeItem("up_next", {
      ...common,
      detail: `${topology} is recorded and waiting to start.`,
      label: "Graph planned",
      occurredAt: null,
    });
  }
  return makeItem("needs_you", {
    ...common,
    detail: ["FAILED", "PARTIAL", "BUDGET_STOPPED"].includes(state)
      ? `${topology} stopped as ${state.toLowerCase().replace(/_/g, " ")}; inspect its evidence.`
      : `${topology} has an unrecognized state: ${readableStatus(run.state)}.`,
    label: ["FAILED", "PARTIAL", "BUDGET_STOPPED"].includes(state) ? "Graph stopped" : "Unknown state",
    occurredAt: run.completedAt ?? run.startedAt,
    priority: ["FAILED", "PARTIAL", "BUDGET_STOPPED"].includes(state) ? 95 : 120,
  });
}

/** Build the four-lane member briefing from already-authorized projections. */
export function buildFactoryBriefing(
  input: BriefingInput,
  options: Readonly<{ sectionLimit?: number }> = {},
): FactoryBriefing {
  const requestedLimit = options.sectionLimit ?? DEFAULT_SECTION_LIMIT;
  const sectionLimit = Number.isFinite(requestedLimit)
    ? Math.min(20, Math.max(1, Math.trunc(requestedLimit)))
    : DEFAULT_SECTION_LIMIT;
  const items: BriefingItem[] = [];
  let omittedCancelled = 0;

  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const representedRunIds = new Set<string>();
  const representedTaskIds = new Set(input.tasks.map((task) => task.id));

  for (const task of input.tasks) {
    if (task.latestRun) representedRunIds.add(task.latestRun.id);
    const item = taskItem(task, runById);
    if (item) items.push(item);
    else omittedCancelled += 1;
  }

  for (const run of input.runs) {
    if (representedRunIds.has(run.id) || (run.task && representedTaskIds.has(run.task.id))) continue;
    const item = runItem(run);
    if (item) items.push(item);
    else omittedCancelled += 1;
  }

  for (const run of input.graphRuns) {
    const item = graphItem(run);
    if (item) items.push(item);
    else omittedCancelled += 1;
  }

  for (const message of input.inboxMessages) {
    if (normalized(message.status) !== "open") continue;
    items.push(makeItem("needs_you", {
      key: `inbox:${message.id}`,
      title: `Decision requested by ${message.agentName || "an agent"}`,
      detail: "Open the AgentOS inbox to review the question and its recorded choices.",
      href: "/solutions/agentos",
      actionLabel: "Open inbox",
      label: "Question",
      occurredAt: message.createdAt,
      priority: 115,
    }));
  }

  for (const incident of input.incidents) {
    if (!incident.ownerAttentionRequired || incident.resolvedAt) continue;
    items.push(makeItem("needs_you", {
      key: `incident:${incident.id}`,
      title: `Production incident: ${incident.title}`,
      detail: projectDetail({ name: incident.projectName }, incident.impact || "The next recovery step needs an owner decision."),
      href: "/solutions/operations",
      actionLabel: "Open operations",
      label: incident.severity.toUpperCase() || "Incident",
      occurredAt: incident.detectedAt ?? null,
      priority: 140,
    }));
  }

  for (const connection of input.connections) {
    if (normalized(connection.status) !== "error") continue;
    items.push(makeItem("needs_you", {
      key: `connection:${connection.id}`,
      title: `GitHub connection “${connection.name}” needs attention`,
      detail: connection.statusReason || "Repository access could not be verified.",
      href: "/solutions/connections",
      actionLabel: "Open connections",
      label: "Connection",
      occurredAt: null,
      priority: 105,
    }));
  }

  const queuedWork = input.tasks.some((task) => normalized(task.status) === "queued")
    || input.runs.some((run) => normalized(run.status) === "queued");
  const activeWork = input.tasks.some((task) => normalized(task.status) === "in_progress")
    || input.runs.some((run) => normalized(run.status) === "running");
  const workIsRecorded = queuedWork || activeWork;
  if (input.worker && input.worker.connectionStatus !== "connected" && workIsRecorded) {
    const workDetail = queuedWork && activeWork
      ? "Queued and active work remain recorded; inspect worker and lease state before intervening."
      : queuedWork
        ? "Queued work remains recorded; inspect worker state before intervening."
        : "Active work remains recorded; inspect worker and lease state before intervening.";
    items.push(makeItem("needs_you", {
      key: "worker:waiting-work",
      title: input.worker.connectionStatus === "stale"
        ? "The Phase 1C worker heartbeat is stale while work is recorded"
        : "No Phase 1C worker is connected while work is recorded",
      detail: workDetail,
      href: "/solutions/bot-manager",
      actionLabel: "Check worker",
      label: input.worker.connectionStatus === "stale" ? "Worker stale" : "Not connected",
      occurredAt: input.worker.lastHeartbeatAt,
      priority: 108,
    }));
  }

  const liaison = input.agents.find((agent) => normalized(agent.role) === "orchestrator") ?? null;
  const activeAgents = input.agents.filter((agent) => ACTIVE_AGENT_STATUSES.has(normalized(agent.status))).length;
  return {
    needsYou: sortedSection(items.filter((item) => item.bucket === "needs_you"), sectionLimit),
    underway: sortedSection(items.filter((item) => item.bucket === "underway"), sectionLimit),
    recentlyFinished: sortedSection(
      items.filter((item) => item.bucket === "recently_finished"),
      sectionLimit,
      "recency_first",
    ),
    upNext: sortedSection(items.filter((item) => item.bucket === "up_next"), sectionLimit),
    crew: {
      liaison: liaison ? { id: liaison.id, name: liaison.name } : null,
      activeAgents,
      totalAgents: input.agents.length,
      worker: input.worker,
    },
    omittedCancelled,
  };
}
