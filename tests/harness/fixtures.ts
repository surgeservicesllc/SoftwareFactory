/**
 * The shapes the production routes return, with the awkward values a real
 * workspace contains: a name long enough to force a wrapping decision, a bot
 * that cannot be assigned, an account stuck needing another sign-in.
 *
 * Comfortable fixtures are why populated layouts pass review and then break on
 * a phone, so these are deliberately the difficult ones.
 */

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const ROLE_ID = "55555555-5555-4555-8555-555555555551";

export const LEAST_PRIVILEGE = {
  preset: null,
  responsibilities: [] as string[],
  instructions: null,
  repositoryAccess: "read" as const,
  branchStrategy: "per_task_branch" as const,
  canOpenPullRequest: false,
  canMergePullRequest: false,
  pipelineAccess: "none" as const,
  environmentAccess: "none" as const,
  tools: [] as string[],
  requiresHumanApproval: true,
  maxConcurrentTasks: 1,
  priority: 2,
};

function bot(id: string, name: string, ready: boolean) {
  return {
    id,
    name,
    provider: "anthropic",
    providerLabel: "Claude",
    providerVendor: "Anthropic",
    model: "claude-opus-5-20260101-with-a-long-identifier",
    currentReadiness: ready ? "ready" : "not_connected",
    readinessLabel: ready ? "Ready to assign" : "Needs credential",
    readinessTone: ready ? "safe" : "warning",
    aiAccountId: null,
    assignable: ready,
    blockedReason: ready ? null : "ANTHROPIC_API_KEY is not set on this server.",
    alreadyOnThisProject: false,
    currentProjectId: null,
    currentProjectName: null,
    currentRoleId: null,
    workload: 0,
  };
}

export const PROJECTS = [
  {
    id: PROJECT_ID,
    name: "E-Commerce Platform",
    description: "Storefront, checkout and fulfilment.",
    status: "active",
    githubRepository: "surgeservicesllc/ecommerce-platform",
    githubRepositoryId: "9001",
    healthStatus: "healthy",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    // Long enough to force a real wrapping decision in a narrow table cell.
    name: "Internal Tools and Operations Automation Platform",
    description: "The long-named one, on purpose.",
    status: "active",
    githubRepository: "surgeservicesllc/internal-tools",
    githubRepositoryId: "9002",
    healthStatus: "degraded",
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-08-16T10:00:00.000Z",
  },
];

export const ROLES = [
  { id: ROLE_ID, name: "Developer", slug: "developer", summary: "Builds and ships changes." },
  { id: "55555555-5555-4555-8555-555555555552", name: "Security", slug: "security", summary: "Reviews" },
  { id: "55555555-5555-4555-8555-555555555553", name: "Tester", slug: "tester", summary: "Tests" },
];

export const PROJECT_BOTS_ROSTER = {
  canManage: true,
  roles: ROLES,
  assigned: [
    {
      id: "66666666-6666-4666-8666-666666666661",
      botId: "bot-1",
      roleId: ROLE_ID,
      status: "active" as const,
      assignedAt: "2026-08-17T10:00:00.000Z",
      config: {
        ...LEAST_PRIVILEGE,
        repositoryAccess: "write" as const,
        canOpenPullRequest: true,
        pipelineAccess: "all" as const,
        maxConcurrentTasks: 3,
        priority: 1,
        responsibilities: ["Implement features", "Fix defects", "Open pull requests"],
      },
      bot: bot("bot-1", "Code Master With A Long Bot Name", true),
      role: ROLES[0],
    },
    {
      id: "66666666-6666-4666-8666-666666666662",
      botId: "bot-2",
      roleId: ROLES[1].id,
      status: "paused" as const,
      assignedAt: "2026-08-16T10:00:00.000Z",
      config: { ...LEAST_PRIVILEGE, pipelineAccess: "assigned" as const, priority: 0 },
      bot: bot("bot-2", "Security Guardian", true),
      role: ROLES[1],
    },
  ],
  available: [
    bot("bot-1", "Code Master With A Long Bot Name", true),
    bot("bot-3", "Test Engineer", true),
    bot("bot-4", "Docs Writer", true),
    bot("bot-5", "Offline Bot", false),
  ],
};

export const AI_ACCOUNTS = [
  {
    id: "77777777-7777-4777-8777-777777777771",
    provider: "anthropic",
    providerLabel: "Claude",
    displayName: "Claude Blackstone Production Subscription",
    status: "needs_reauth",
    lastVerifiedAt: "2026-08-17T09:20:19.000Z",
    lastError: "The provider refused the stored credential (HTTP 403).",
  },
  {
    id: "77777777-7777-4777-8777-777777777772",
    provider: "openai",
    providerLabel: "Codex",
    displayName: "Codex Daniel",
    status: "connected",
    lastVerifiedAt: "2026-08-17T09:33:47.000Z",
    lastError: null,
  },
];

/* ------------------------------------------------ the remaining consoles */

const LONG_TITLE =
  "Reconcile the hosted migration ledger against the repository and repair drift";

export const RUNS = [
  {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    status: "failed",
    conclusion: "provider_startup_failed",
    agentName: "Orchestrator",
    agentRole: "orchestrator",
    projectId: PROJECT_ID,
    projectName: "E-Commerce Platform",
    provider: "openai",
    model: "gpt-5.3-codex-with-a-long-identifier",
    title: LONG_TITLE,
    startedAt: "2026-08-16T09:00:00.000Z",
    finishedAt: "2026-08-16T09:04:00.000Z",
    createdAt: "2026-08-16T09:00:00.000Z",
    updatedAt: "2026-08-16T09:04:00.000Z",
    attempt: 1,
    maxAttempts: 2,
    riskLevel: "GREEN",
    branch: "factory/aaaaaaaa-reconcile-the-hosted-migration-ledger",
    baseSha: "0c662a24393f682073e6002c5aff9339292226d8",
  },
  {
    id: "aaaaaaaa-2222-4222-8222-222222222222",
    status: "queued",
    conclusion: null,
    agentName: "QA",
    agentRole: "qa",
    projectId: PROJECT_ID,
    projectName: "E-Commerce Platform",
    provider: "anthropic",
    model: "claude-opus-5",
    title: "Add coverage for the assignment configuration",
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-08-17T09:00:00.000Z",
    updatedAt: "2026-08-17T09:00:00.000Z",
    attempt: 0,
    maxAttempts: 2,
    riskLevel: "GREEN",
    branch: null,
    baseSha: null,
  },
];

export const REPORTS = [
  {
    id: "bbbbbbbb-1111-4111-8111-111111111111",
    kind: "ceo_summary",
    title: LONG_TITLE,
    summary: "One paragraph that is deliberately long enough to wrap on a phone screen.",
    projectId: PROJECT_ID,
    projectName: "E-Commerce Platform",
    createdAt: "2026-08-16T10:00:00.000Z",
    status: "published",
  },
];

export const AGENTS = [
  {
    id: "cccccccc-1111-4111-8111-111111111111",
    name: "Orchestrator",
    role: "orchestrator",
    status: "idle",
    description: "Plans the work and hands it out.",
    capabilities: ["planning", "routing"],
    createdAt: "2026-08-01T10:00:00.000Z",
  },
  {
    id: "cccccccc-2222-4222-8222-222222222222",
    name: "Security",
    role: "security",
    status: "idle",
    description: "Reviews changes for unsafe patterns.",
    capabilities: ["security"],
    createdAt: "2026-08-01T10:00:00.000Z",
  },
];

export const ACTIVITY = [
  {
    id: "dddddddd-1111-4111-8111-111111111111",
    occurredAt: "2026-08-17T10:00:00.000Z",
    eventType: "bot.assigned",
    description:
      "Bot assigned to project with its configuration. Assignment is routing intent, not execution.",
    actor: { id: null, displayName: "surgeservicesllc", source: "softwarefactory" as const },
    entity: { id: "66666666-6666-4666-8666-666666666661", type: "bot_assignment" },
    evidence: {
      action: "assigned",
      conclusion: null,
      resources: [{ id: PROJECT_ID, type: "project" }],
      source: "softwarefactory" as const,
      stateTransition: null,
      status: null,
    },
    project: { id: PROJECT_ID, name: "E-Commerce Platform" },
  },
];

export const CONNECTIONS = [
  {
    id: "eeeeeeee-1111-4111-8111-111111111111",
    provider: "github",
    status: "connected",
    externalAccountLogin: "surgeservicesllc",
    installationId: "154236235",
    repositorySelection: "selected",
    repositories: [
      { id: "9001", fullName: "surgeservicesllc/SoftwareFactory", defaultBranch: "main" },
    ],
    createdAt: "2026-08-16T19:47:00.000Z",
    lastSyncedAt: "2026-08-17T10:00:00.000Z",
  },
];

/** Built-in pipeline templates, in the shape the pipelines console takes. */
export const TEMPLATES = [
  {
    key: "production-readiness",
    name: "Production Readiness",
    category: "audit",
    summary:
      "Checks the things that break on the first real day: configuration, migrations, error handling, observability and rollback.",
    version: 1,
    topology: "diamond",
    nodeCount: 7,
    maxParallelism: 5,
    compiles: true,
  },
  {
    key: "security-audit",
    name: "Security Audit",
    category: "audit",
    summary: "Looks for unsafe patterns, dependency risk and exposed material.",
    version: 1,
    topology: "fan-out",
    nodeCount: 5,
    maxParallelism: 4,
    compiles: true,
  },
];
