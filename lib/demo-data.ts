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

export const agents = [
  {
    name: "Orchestrator",
    role: "Work coordinator",
    description: "Plans work, delegates bounded tasks, enforces policy gates, and assembles evidence.",
    capabilities: ["Planning", "Delegation", "Risk routing", "Audit events"],
  },
  {
    name: "Product",
    role: "Product strategist",
    description: "Translates outcomes into scoped requirements, acceptance criteria, and prioritized work.",
    capabilities: ["Discovery", "Requirements", "Prioritization", "Acceptance criteria"],
  },
  {
    name: "Frontend",
    role: "Interface engineer",
    description: "Builds accessible, responsive interfaces and client-side product behavior.",
    capabilities: ["Next.js", "Accessibility", "Responsive UI", "Performance"],
  },
  {
    name: "Backend",
    role: "Application engineer",
    description: "Designs APIs, service boundaries, validation, and secure server-side workflows.",
    capabilities: ["APIs", "Validation", "Authorization", "Observability"],
  },
  {
    name: "Database",
    role: "Data engineer",
    description: "Owns schema quality, migrations, data integrity, RLS, and query performance.",
    capabilities: ["Postgres", "Supabase", "RLS", "Migrations"],
  },
  {
    name: "QA",
    role: "Quality engineer",
    description: "Builds test strategies, validates behavior, and records trustworthy release evidence.",
    capabilities: ["Unit tests", "Integration tests", "E2E", "Regression analysis"],
  },
  {
    name: "Security",
    role: "Security reviewer",
    description: "Reviews threat boundaries, sensitive changes, dependencies, and secret handling.",
    capabilities: ["Threat modeling", "Code review", "Secret scanning", "Policy checks"],
  },
  {
    name: "Release",
    role: "Delivery controller",
    description: "Coordinates validation, deployment readiness, rollback plans, and release evidence.",
    capabilities: ["Release gates", "Deployments", "Rollback", "Post-deploy checks"],
  },
  {
    name: "CEO Reporter",
    role: "Executive analyst",
    description: "Summarizes outcomes, blockers, risk, owner decisions, and recommended next actions.",
    capabilities: ["Executive reporting", "Metrics", "Risk summaries", "Recommendations"],
  },
] as const;

export const connections = [
  {
    name: "GitHub",
    description: "Repositories, pull requests, checks, issues, and future GitHub App events.",
  },
  {
    name: "OpenAI",
    description: "Provider-neutral model access configured only through server-side secrets.",
  },
  {
    name: "Anthropic",
    description: "Optional provider connection, kept separate from agent definitions.",
  },
  {
    name: "Vercel",
    description: "Deployment projects, previews, production health, and release status.",
  },
  {
    name: "Supabase",
    description: "Authentication, Postgres data, RLS, activity records, and application state.",
  },
  {
    name: "Other",
    description: "A provider-neutral extension point for future tools and engineering systems.",
  },
] as const;

export const demoBacklog = [
  { id: "SF-101", title: "Connect GitHub App event ingestion", priority: "P0", risk: "YELLOW", status: "Ready" },
  { id: "SF-102", title: "Implement owner approval workflow", priority: "P0", risk: "RED", status: "Planned" },
  { id: "SF-103", title: "Add project health aggregation", priority: "P1", risk: "GREEN", status: "Ready" },
  { id: "SF-104", title: "Build deployment validation runner", priority: "P1", risk: "YELLOW", status: "Discovery" },
  { id: "SF-105", title: "Add immutable agent run artifacts", priority: "P2", risk: "GREEN", status: "Planned" },
] as const;

export const demoRuns = [
  { id: "RUN-4F91", command: "Audit repository security", agent: "Security", state: "Awaiting approval", risk: "YELLOW", duration: "6m 42s" },
  { id: "RUN-4F90", command: "Validate mobile performance", agent: "Frontend", state: "Completed", risk: "GREEN", duration: "12m 08s" },
  { id: "RUN-4F8F", command: "Prepare release evidence", agent: "Release", state: "Completed", risk: "GREEN", duration: "4m 11s" },
] as const;
