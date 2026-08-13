export const dashboardMetrics = [
  { label: "Connected projects", value: "0", detail: "No live providers connected", tone: "neutral" },
  { label: "Active agents", value: "0", detail: "Agent execution is not wired", tone: "neutral" },
  { label: "Tasks in progress", value: "4", detail: "Illustrative operating load", tone: "info" },
  { label: "PRs created", value: "12", detail: "Illustrative 30-day total", tone: "info" },
  { label: "PRs merged", value: "9", detail: "Illustrative 30-day total", tone: "safe" },
  { label: "Deployments", value: "7", detail: "Illustrative 30-day total", tone: "safe" },
  { label: "Tests passed", value: "184", detail: "Illustrative validation count", tone: "safe" },
  { label: "Bugs fixed", value: "15", detail: "Illustrative 30-day total", tone: "safe" },
  { label: "Issues found", value: "18", detail: "Illustrative 30-day total", tone: "warning" },
  { label: "Rollbacks", value: "1", detail: "Illustrative 30-day total", tone: "warning" },
  { label: "Owner attention", value: "3", detail: "Illustrative approval queue", tone: "danger" },
] as const;

export const demoActivity = [
  {
    id: "demo-activity-1",
    action: "Security review completed",
    detail: "2 findings require triage before release",
    actor: "Security Agent",
    time: "18 min ago",
    tone: "warning",
  },
  {
    id: "demo-activity-2",
    action: "Validation suite passed",
    detail: "42 unit, integration, and UI checks passed",
    actor: "QA Agent",
    time: "41 min ago",
    tone: "safe",
  },
  {
    id: "demo-activity-3",
    action: "Owner approval requested",
    detail: "Database index rollout classified YELLOW",
    actor: "Orchestrator",
    time: "1 hr ago",
    tone: "danger",
  },
  {
    id: "demo-activity-4",
    action: "Pull request prepared",
    detail: "Mobile performance improvements ready for review",
    actor: "Frontend Agent",
    time: "2 hr ago",
    tone: "info",
  },
] as const;

export const demoReport = {
  date: "Illustrative daily briefing",
  summary:
    "Delivery remained stable. Test coverage improved, while two security findings and one release decision need owner review.",
  completed: 8,
  pullRequests: 3,
  deployments: 2,
  blockers: 1,
  decisions: [
    "Approve the YELLOW database performance change",
    "Choose remediation timing for two medium security findings",
    "Confirm the next mobile performance milestone",
  ],
};



export const demoBacklog = [
  { id: "SF-101", title: "Connect GitHub App event ingestion", priority: "P0", risk: "YELLOW", status: "Ready" },
  { id: "SF-102", title: "Implement owner approval workflow", priority: "P0", risk: "RED", status: "Planned" },
  { id: "SF-103", title: "Add project health aggregation", priority: "P1", risk: "GREEN", status: "Ready" },
  { id: "SF-104", title: "Build deployment validation runner", priority: "P1", risk: "YELLOW", status: "Discovery" },
  { id: "SF-105", title: "Add immutable agent run artifacts", priority: "P2", risk: "GREEN", status: "Planned" },
] as const;

