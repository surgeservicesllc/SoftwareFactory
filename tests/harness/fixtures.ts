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

/**
 * The owner's screenshot, as data: four accounts, none freshly verified, and
 * no bots at all. Three refused their stored credential (HTTP 403) and one has
 * been disconnected — the state in which the console previously offered no way
 * forward and said only "None can create a bot".
 */
export const STALE_AI_ACCOUNTS = [
  {
    id: "77777777-7777-4777-8777-77777777777a",
    provider: "anthropic",
    providerLabel: "Claude",
    displayName: "Claude Blackstone",
    status: "needs_reauth",
    lastVerifiedAt: "2026-08-18T07:05:22.000Z",
    lastError: "The provider refused the stored credential (HTTP 403).",
  },
  {
    id: "77777777-7777-4777-8777-77777777777b",
    provider: "anthropic",
    providerLabel: "Claude",
    displayName: "Claude NWV",
    status: "needs_reauth",
    lastVerifiedAt: "2026-08-17T20:11:24.000Z",
    lastError: "The provider refused the stored credential (HTTP 403).",
  },
  {
    id: "77777777-7777-4777-8777-77777777777c",
    provider: "anthropic",
    providerLabel: "Claude",
    displayName: "Claude Bubaly",
    status: "needs_reauth",
    lastVerifiedAt: "2026-08-17T20:11:24.000Z",
    lastError: "The provider refused the stored credential (HTTP 403).",
  },
  {
    id: "77777777-7777-4777-8777-77777777777d",
    provider: "openai",
    providerLabel: "Codex",
    displayName: "Codex Daniel",
    status: "disconnected",
    lastVerifiedAt: "2026-08-16T15:51:14.000Z",
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

/**
 * Exact `GET /api/runs?limit=100&view=briefing` projection consumed by Factory Briefing.
 *
 * The general Runs console fixture above predates the safe list projection
 * and intentionally carries its richer console fields. Keeping this endpoint-
 * exact fixture separate prevents the briefing harness from silently testing
 * `task`, `project`, and `agent` as missing when production always nests them.
 */
export const FACTORY_BRIEFING_RUNS = [
  {
    id: "aaaaaaaa-3111-4111-8111-111111111111",
    status: "failed",
    startedAt: "2026-08-20T09:00:00.000Z",
    completedAt: "2026-08-20T09:04:00.000Z",
    createdAt: "2026-08-20T09:00:00.000Z",
    project: { id: PROJECT_ID, name: "E-Commerce Platform" },
    task: {
      id: "aaaaaaaa-4111-4111-8111-111111111111",
    },
    agent: {
      id: "cccccccc-1111-4111-8111-111111111111",
      name: "Orchestrator",
    },
  },
  {
    id: "aaaaaaaa-3222-4222-8222-222222222222",
    status: "queued",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    project: { id: PROJECT_ID, name: "E-Commerce Platform" },
    task: {
      id: "aaaaaaaa-4222-4222-8222-222222222222",
    },
    agent: {
      id: "cccccccc-2222-4222-8222-222222222222",
      name: "Security",
    },
  },
];

/*
 * Shaped like `GET /api/reports` actually answers, key for key.
 *
 * It previously carried `kind`, `projectId` and `projectName` — none of which
 * that route returns. `ReportsConsole` reads `report.type`, so it threw on
 * `undefined.replace` and rendered nothing; the mismatch went unnoticed
 * because the console was showing a signed-out gate and never read the
 * fixture at all. A fixture that does not match its route measures a screen
 * no user can reach.
 */
export const REPORTS = [
  {
    id: "bbbbbbbb-1111-4111-8111-111111111111",
    type: "ceo_summary",
    status: "published",
    title: LONG_TITLE,
    summary: "One paragraph that is deliberately long enough to wrap on a phone screen.",
    periodStart: "2026-08-15T00:00:00.000Z",
    periodEnd: "2026-08-16T00:00:00.000Z",
    publishedAt: "2026-08-16T10:00:00.000Z",
    createdAt: "2026-08-16T10:00:00.000Z",
    project: { id: PROJECT_ID, name: "E-Commerce Platform" },
    generatedBy: { id: "cccccccc-1111-4111-8111-111111111111", name: "Orchestrator" },
  },
];

/** `GET /api/providers`, which the Agents console reads for its status row. */
export const PROVIDER_STATUS = {
  executionEnabled: false,
  providers: [
    {
      provider: "openai",
      label: "OpenAI",
      state: "not_configured" as const,
      stateLabel: "Not Connected",
      detail: "No provider credential is configured in this environment.",
      checkedAt: "2026-08-18T05:00:00.000Z",
      latencyMs: null,
      defaultModel: null,
      configuredModels: [],
      environmentVariableNames: [],
    },
  ],
};

/** `GET /api/worker/status`, read by the guided journey. */
export const WORKER_STATUS = {
  connectionStatus: "not_connected",
  statusLabel: "Worker Not Connected",
  lastHeartbeatAt: null,
  activeWorkers: 0,
  availableWorkers: 0,
  staleAfterSeconds: 90,
};

/** `GET /api/commands`, read by the guided journey and the pipelines console. */
export const COMMANDS = [
  {
    id: "dddddddd-1111-4111-8111-111111111111",
    prompt: LONG_TITLE,
    risk: "GREEN",
    status: "queued",
    executionMode: "record_only",
    submittedAt: "2026-08-16T09:00:00.000Z",
    completedAt: null,
    project: { id: PROJECT_ID, name: "E-Commerce Platform" },
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

/** Maximum accepted project-config agent name, deliberately unbroken. */
export const MAX_LENGTH_COORDINATOR_NAME = "C".repeat(160);

/** Exact `GET /api/agents?limit=100&view=briefing` projection consumed by Factory Briefing. */
export const FACTORY_BRIEFING_AGENTS = [
  {
    id: "cccccccc-3111-4111-8111-111111111111",
    name: MAX_LENGTH_COORDINATOR_NAME,
    role: "orchestrator",
    status: "busy",
  },
  {
    id: "cccccccc-3222-4222-8222-222222222222",
    name: "Security",
    role: "security",
    status: "idle",
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

/** Exact `GET /api/github/connections?view=briefing` projection consumed by Factory Briefing. */
export const FACTORY_BRIEFING_CONNECTIONS = [
  {
    id: "eeeeeeee-2111-4111-8111-111111111111",
    name: "GitHub · surgeservicesllc",
    status: "connected",
    statusReason: null,
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
    anchorNodeCount: 0,
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
    anchorNodeCount: 0,
    compiles: true,
  },
];

/**
 * The workflows console takes a richer summary than the pipelines one: each
 * template carries its compiled preview and any errors from compiling it.
 * Two shapes, two fixtures — reusing the wrong one crashed the page on
 * `compileErrors.map`, which is the fixture being wrong rather than the
 * component being fragile.
 */
/**
 * A project with pipelines already selected, so the *selected* card — grey
 * Use, check icon, the summary counting them — is a layout the sweep can
 * measure. Unselected is what every other case already shows.
 */
export const PROJECT_PIPELINES = [
  {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    projectId: PROJECT_ID,
    templateKey: "production-readiness",
    templateId: null,
    kind: "built_in" as const,
    name: "Production Readiness",
    summary: "Checks the things that break on the first real day.",
    selectedAt: "2026-08-18T09:00:00.000Z",
  },
  {
    id: "aaaaaaaa-2222-4222-8222-222222222222",
    projectId: PROJECT_ID,
    templateKey: "checkout_audit",
    templateId: "bbbbbbbb-3333-4333-8333-333333333333",
    kind: "custom" as const,
    name: "Checkout Audit",
    summary: null,
    selectedAt: "2026-08-18T09:05:00.000Z",
  },
];

/** One custom template, so the custom half of the manager renders rows too. */
export const CUSTOM_PIPELINE_TEMPLATES = [
  {
    id: "bbbbbbbb-3333-4333-8333-333333333333",
    slug: "checkout_audit",
    name: "Checkout Audit",
    summary: "Audit the checkout flow end to end, from cart to receipt email.",
    category: "AUDIT",
    capability: "review",
    areas: [{ id: "payments", job: "Check the payment flow." }],
    version: 2,
    editable: true,
    compiles: true,
    topology: "DIAMOND",
    nodeCount: 3,
    maxParallelism: 1,
    errors: [] as string[],
  },
];

/**
 * A job search with rows in every state the Overview distinguishes: scored and
 * unscored, applied and not, an interview, an offer. A fixture where every job
 * looks the same would measure one row repeated, not the layout.
 */
export const JOB_SEEKER_JOBS = [
  {
    id: "js-1", title: "VP of Marketing", company: "Acme Corporation",
    discoveredAt: "2026-05-19T10:00:00.000Z",
    match: { score: 94, qualified: true },
    application: { id: "ja-1", stage: "APPLIED", appliedAt: "2026-05-19T10:30:00.000Z" },
  },
  {
    id: "js-2", title: "Head of Growth Marketing", company: "TechNova",
    discoveredAt: "2026-05-18T10:00:00.000Z",
    match: { score: 91, qualified: true },
    application: { id: "ja-2", stage: "INTERVIEW", appliedAt: "2026-05-16T10:30:00.000Z" },
  },
  {
    id: "js-3", title: "VP of Digital Marketing", company: "NextWave Solutions",
    discoveredAt: "2026-05-17T10:00:00.000Z",
    match: { score: 88, qualified: true },
    application: { id: "ja-3", stage: "FINAL_INTERVIEW", appliedAt: "2026-05-12T10:30:00.000Z" },
  },
  {
    id: "js-4", title: "Senior Director of Marketing", company: "BrightPath",
    discoveredAt: "2026-05-16T10:00:00.000Z",
    match: { score: 85, qualified: true },
    application: { id: "ja-4", stage: "OFFER", appliedAt: "2026-05-05T10:30:00.000Z" },
  },
  {
    id: "js-5", title: "VP of Marketing", company: "InnovateX",
    discoveredAt: "2026-05-15T10:00:00.000Z",
    match: { score: 62, qualified: false },
    application: null,
  },
  // Unscored on purpose: the Overview must not count it as a low score.
  { id: "js-6", title: "Chief Marketing Officer", company: "Northwind", match: null, application: null },
];

export const JOB_SEEKER_DOCUMENTS = [
  {
    id: "jd-1", applicationId: "ja-1", kind: "resume", version: 3,
    createdAt: "2026-05-19T10:05:00.000Z", stage: "APPLIED",
    title: "VP of Marketing", company: "Acme Corporation",
    preview: "Marketing leader with fifteen years building demand engines across B2B SaaS.",
    characters: 4820,
  },
  {
    id: "jd-2", applicationId: "ja-2", kind: "cover_letter", version: 1,
    createdAt: "2026-05-18T10:05:00.000Z", stage: "INTERVIEW",
    title: "Head of Growth Marketing", company: "TechNova",
    preview: "TechNova's move into product-led growth is exactly the transition I ran at scale.",
    characters: 2140,
  },
];

export const JOB_SEEKER_CONTACTS = [
  {
    id: "jc-1", name: "Priya Raman", role: "Talent Partner", source: "linkedin",
    linkedinUrl: "linkedin.com/in/priyaraman", email: "priya@acme.example",
    notes: "Owns the VP of Marketing req; asked for a portfolio link.",
  },
  {
    id: "jc-2", name: "Marcus Webb", role: "Hiring Manager", source: "referral",
    linkedinUrl: null, email: null, notes: null,
  },
];

export const JOB_SEEKER_OUTREACH = [
  {
    id: "jo-1", contactId: "jc-1", subject: "VP of Marketing — following up",
    body: "Thanks for the call on Tuesday. Sending the portfolio you asked about.",
    status: "sent", sentAt: "2026-05-19T12:00:00.000Z",
  },
  {
    id: "jo-2", contactId: "jc-2", subject: "Introduction via Dana",
    body: "Dana suggested I reach out about the growth marketing role.",
    status: "draft", sentAt: null,
  },
];

/**
 * Graph runs with staged nodes, in the states the lifecycle distinguishes:
 * complete, failed with a message, and one waiting on a person. A fixture
 * where every run looked the same would measure one card repeated.
 *
 * `startedAt`, `completedAt` and `verifications` are here because this stands
 * in for `/api/graphs/runs`, which every reader of that endpoint sees — not
 * only the lifecycle pages. `FactoryBriefing` validates the projection before
 * it trusts it, and an earlier version of this fixture omitted the three
 * fields: the read failed validation, the source counted as unavailable, and
 * the briefing correctly reported itself incomplete. Keep this matching the
 * route's projection, not merely the fields the newest case happens to read.
 */
export const GRAPH_RUNS_STAGED = [
  {
    graphRunId: "run-1",
    graphId: "graph-1",
    goal: "Add per-account usage evidence to the Bot Manager",
    topology: "DIAMOND",
    riskLevel: "GREEN",
    state: "RUNNING",
    startedAt: "2026-08-23T18:04:11.000Z",
    completedAt: null,
    verifications: [],
    nodes: [
      { node_key: "goal", executor: "claude", capability: "planning", state: "SUCCEEDED",
        provider: "anthropic", model: "claude-opus-5", latency_ms: 4200,
        error_message: null, lifecycle_stage: "GOAL" },
      { node_key: "prd", executor: "claude", capability: "planning", state: "SUCCEEDED",
        provider: "anthropic", model: "claude-opus-5", latency_ms: 9100,
        error_message: null, lifecycle_stage: "PRD" },
      { node_key: "arch", executor: "claude", capability: "architecture", state: "VERIFYING",
        provider: "anthropic", model: "claude-opus-5", latency_ms: 15200,
        error_message: null, lifecycle_stage: "ARCHITECTURE",
        gate_kind: "HUMAN", gate_id: "gate-1", gate_state: "OPEN", gate_anchor_count: 0,
        job: "Design the usage-evidence read path and name the components it touches.",
        max_attempts: 2, depends_on: ["prd"], queued_at: "2026-08-23T18:04:11.000Z",
        node_started_at: "2026-08-23T18:05:02.000Z", node_completed_at: null,
        artifact_counts: {} },
    ],
  },
  {
    graphRunId: "run-2",
    graphId: "graph-2",
    goal: "Repair the flaky deployment smoke test",
    topology: "DAG",
    riskLevel: "YELLOW",
    state: "FAILED",
    startedAt: "2026-08-23T16:41:02.000Z",
    completedAt: "2026-08-23T16:52:24.000Z",
    verifications: [],
    nodes: [
      { node_key: "goal", executor: "codex", capability: "planning", state: "SUCCEEDED",
        provider: "openai", model: "gpt-5.3-codex", latency_ms: 3100,
        error_message: null, lifecycle_stage: "GOAL" },
      // The long job line and the multi-key dependency list are the widest
      // strings the node detail can render; the width sweep needs them present
      // or it measures a layout no user sees.
      { node_key: "impl", executor: "codex", capability: "implementation", state: "SUCCEEDED",
        provider: "openai", model: "gpt-5.3-codex", latency_ms: 42800,
        error_message: null, lifecycle_stage: "IMPLEMENTATION",
        job: "Replace the polling smoke check with a deterministic readiness probe, and delete the sleep.",
        max_attempts: 3, depends_on: ["goal"], queued_at: "2026-08-23T16:41:02.000Z",
        node_started_at: "2026-08-23T16:41:40.000Z", node_completed_at: "2026-08-23T16:48:52.000Z",
        artifact_counts: { SYNTHESIS: 2, RAW: 1 } },
      { node_key: "test", executor: "codex", capability: "qa", state: "FAILED",
        provider: "openai", model: "gpt-5.3-codex", latency_ms: 18400,
        error_message: "smoke test timed out after 120s", lifecycle_stage: "TEST",
        job: "Run the suite and record the verdict as evidence.",
        max_attempts: 1, depends_on: ["impl"], queued_at: "2026-08-23T16:41:02.000Z",
        node_started_at: "2026-08-23T16:48:55.000Z", node_completed_at: "2026-08-23T16:52:24.000Z",
        artifact_counts: { ANCHOR: 1 } },
    ],
  },
  {
    graphRunId: "run-3",
    graphId: "graph-3",
    goal: "Document the connection registry",
    topology: "SEQUENTIAL",
    riskLevel: "GREEN",
    state: "COMPLETED",
    startedAt: "2026-08-23T14:12:35.000Z",
    completedAt: "2026-08-23T14:19:58.000Z",
    verifications: [],
    nodes: [
      { node_key: "goal", executor: "claude", capability: "planning", state: "SUCCEEDED",
        provider: "anthropic", model: "claude-sonnet-5", latency_ms: 2600,
        error_message: null, lifecycle_stage: "GOAL" },
      { node_key: "review", executor: "claude", capability: "review", state: "SUCCEEDED",
        provider: "anthropic", model: "claude-sonnet-5", latency_ms: 7300,
        error_message: null, lifecycle_stage: "REVIEW" },
    ],
  },
];

export const WORKFLOW_TEMPLATES = TEMPLATES.map((template) => ({
  key: template.key,
  name: template.name,
  category: template.category,
  summary: template.summary,
  version: template.version,
  preview: null,
  compileErrors: [] as string[],
}));

/*
 * The consoles below read their own endpoints, and until these existed the
 * harness answered every one of them with a 200 and no keys. Ten cases
 * therefore rendered an error card — a few centred words that fit every width
 * and reach every control, so the sweep passed them unconditionally while
 * measuring none of their real layout.
 *
 * The portfolio payload is built by the same pure aggregator the route uses
 * rather than transcribed from it, so it cannot drift from the shape the
 * browser actually receives. The rest are written against their route's
 * response, key for key.
 */

export const PORTFOLIO_SOURCES = {
  projects: [
    {
      id: PROJECT_ID,
      name: "E-Commerce Platform",
      status: "active" as const,
      githubRepository: "acme/storefront",
      healthStatus: "healthy" as const,
      autonomousMode: false,
      maximumAutonomousRisk: "GREEN" as const,
      description: "Checkout, catalogue and fulfilment for the storefront.",
      defaultBranch: "main",
      productionUrl: "https://example.invalid",
      engineeringPriority: 1,
      strategicFocus: true,
      engineeringPaused: false,
      engineeringPauseReason: null,
    },
    {
      id: "11111111-2222-4222-8222-222222222222",
      name: LONG_TITLE,
      status: "paused" as const,
      githubRepository: null,
      healthStatus: "degraded" as const,
      autonomousMode: false,
      maximumAutonomousRisk: "GREEN" as const,
      description: null,
      defaultBranch: null,
      productionUrl: null,
      engineeringPriority: 3,
      strategicFocus: false,
      engineeringPaused: true,
      engineeringPauseReason: "Waiting on the owner to confirm the migration window.",
    },
  ],
  commands: [{ projectId: PROJECT_ID, status: "succeeded" }],
  runs: [{ projectId: PROJECT_ID, status: "running" }],
  tasks: [{ projectId: PROJECT_ID, status: "in_progress" }],
  incidents: [],
  changeRequests: [{ projectId: PROJECT_ID, status: "completed" }],
  deployments: [],
  connections: [{ projectId: PROJECT_ID, status: "connected", provider: "github" }],
};

export const PORTFOLIO_SCHEDULING = {
  capacity: {
    activeRuns: 2,
    emergencyQueued: 0,
    emergencyReserved: 1,
    fairnessPromotionSeconds: 900,
    focusedProjects: 1,
    openBreakers: 0,
    ordinaryCeiling: 4,
    organizationLimit: 5,
    pausedProjects: 1,
    queuedRuns: 3,
    workerCapacity: 4,
    workerCount: 1,
    workerLeases: 2,
  },
  projects: [
    {
      activeRuns: 2,
      engineeringPaused: false,
      engineeringPauseReason: null,
      engineeringPriority: 1,
      maximumConcurrentRuns: 3,
      projectId: PROJECT_ID,
      projectName: "E-Commerce Platform",
      queuedRuns: 1,
      strategicFocus: true,
    },
  ],
  queue: [
    {
      blockedReason: null,
      effectivePriority: 1,
      emergency: false,
      projectName: "E-Commerce Platform",
      projectPriority: 1,
      queuePosition: 1,
      runId: "eeeeeeee-1111-4111-8111-111111111111",
      runStatus: "queued",
      strategicFocus: true,
      taskTitle: LONG_TITLE,
      waitingSeconds: 240,
    },
  ],
  unavailable: [] as string[],
};

/** `GET /api/operations/overview`, read by Operations and Needs Your Attention. */
export const OPERATIONS_OVERVIEW = {
  activeOrganizationId: "10000000-0000-4000-8000-000000000001",
  role: "owner",
  // Every executor is off in this phase, and the console says so in place.
  executionAllowed: false,
  deploymentExecutor: "not_connected",
  rollbackExecutor: "not_connected",
  repairWorker: "not_connected",
  summary: {
    projectsTotal: 2,
    projectsHealthy: 1,
    projectsDegraded: 1,
    projectsCritical: 0,
    projectsUnknown: 0,
    projectsPaused: 1,
    projectsFrozen: 0,
    openIncidents: 1,
    openSev1: 0,
    openSev2: 1,
    incidentsResolved24h: 2,
    failedDeployments24h: 0,
    rollbacks24h: 0,
    failedRollbacks24h: 0,
    repairsOpen: 1,
    ownerAttention: 1,
    connectedMonitors: 0,
    pendingEvents: 0,
  },
  projects: [
    {
      id: PROJECT_ID,
      name: "E-Commerce Platform",
      status: "active",
      healthState: "healthy",
      healthReason: null,
      healthComputedAt: "2026-08-18T05:00:00.000Z",
      releasesFrozen: false,
      operationsStopped: false,
      ownerAttentionRequired: false,
      connectedMonitors: 0,
      openIncidents: 0,
    },
    {
      id: "11111111-2222-4222-8222-222222222222",
      name: LONG_TITLE,
      status: "paused",
      healthState: "degraded",
      healthReason: "A checkout journey has been failing since the last release.",
      healthComputedAt: "2026-08-18T05:00:00.000Z",
      releasesFrozen: true,
      operationsStopped: false,
      ownerAttentionRequired: true,
      connectedMonitors: 0,
      openIncidents: 1,
    },
  ],
  incidents: [
    {
      id: "ffffffff-1111-4111-8111-111111111111",
      projectId: "11111111-2222-4222-8222-222222222222",
      projectName: LONG_TITLE,
      title: LONG_TITLE,
      severity: "sev2",
      status: "open",
      source: "manual",
      symptoms: "Checkout returns a 500 for a subset of carts.",
      impact: "Some customers cannot complete an order.",
      occurrenceCount: 3,
      detectedAt: "2026-08-18T04:00:00.000Z",
      lastSignalAt: "2026-08-18T04:50:00.000Z",
      resolvedAt: null,
      ownerAttentionRequired: true,
      rootCause: null,
      correctiveAction: null,
      autoCreated: false,
    },
  ],
  monitors: [],
  auditEvents: [
    {
      id: "ffffffff-2222-4222-8222-222222222222",
      projectId: PROJECT_ID,
      kind: "project.updated",
      entityType: "project",
      entityId: PROJECT_ID,
      summary: "Default branch changed to main.",
      createdAt: "2026-08-18T03:00:00.000Z",
    },
  ],
  journeys: [],
  providers: [],
};

/** `GET /api/resources/overview`, read by the resource manager. */
export const RESOURCES_OVERVIEW = {
  policyVersion: "phase2c-resources-v1",
  capabilities: [],
  executionState: "not_connected",
  executionLabel: "Not Connected",
  executionReason:
    "No provider run has executed, so no routing decision has ever been recorded against real work.",
  breakers: [
    {
      target: "openai",
      state: "closed",
      fault: null,
      faultExplanation: null,
      consecutiveFaults: 0,
      openedAt: null,
      cooldownMs: null,
      reason: null,
      updatedAt: "2026-08-18T05:00:00.000Z",
    },
  ],
  transitions: [],
  assignments: [],
};

/** The five reads behind `/solutions/agentos`, one populated row each. */
export const AGENTOS_GRANTS = [
  {
    agentId: "cccccccc-1111-4111-8111-111111111111",
    agentName: "Orchestrator",
    configured: true,
    inboxAccess: "read_write",
    runnerPreference: "container",
    environment: { name: "default", networking: "restricted", allowedHostCount: 3 },
    counts: {
      mcpConnections: 2,
      skills: 4,
      repos: 1,
      filesystemGrants: 2,
      collaborators: 1,
    },
  },
];

export const AGENTOS_MESSAGES = [
  {
    id: "aaaaaaaa-9111-4111-8111-111111111111",
    author: "agent",
    kind: "question",
    status: "open",
    body: LONG_TITLE,
    choices: ["Keep the current behaviour", "Change it and open a pull request"],
    selectedChoice: null,
    answerBody: null,
    agentName: "Orchestrator",
    agentRunId: "eeeeeeee-1111-4111-8111-111111111111",
    createdAt: "2026-08-18T04:00:00.000Z",
    answeredAt: null,
  },
];

export const AGENTOS_GOALS = [
  {
    id: "aaaaaaaa-9222-4222-8222-222222222222",
    title: LONG_TITLE,
    status: "running",
    projectName: "E-Commerce Platform",
    definitionOfDone: { total: 4, satisfied: 2 },
    spend: { capUsd: 25, spentUsd: 4, uncappedAcknowledged: false },
    maxDurationMinutes: 120,
    stuckThreshold: 3,
    iterations: 6,
    stoppedReason: null,
    createdAt: "2026-08-18T03:00:00.000Z",
  },
];

export const AGENTOS_CHAINS = [
  {
    id: "aaaaaaaa-9333-4333-8333-333333333333",
    title: LONG_TITLE,
    templateName: "Feature delivery",
    projectName: "E-Commerce Platform",
    progress: { total: 5, done: 2 },
    currentStep: { name: "Implement", state: "running", approvalGate: false },
    createdAt: "2026-08-18T03:30:00.000Z",
  },
];

export const AGENTOS_TRIGGERS = [
  {
    id: "aaaaaaaa-9444-4444-8444-444444444444",
    name: "storefront-push",
    displayName: "Storefront push",
    agentName: "Orchestrator",
    projectName: "E-Commerce Platform",
    enabled: false,
    // Whether a secret exists, never the secret.
    secretConfigured: true,
    deliveries: { total: 12, accepted: 11, rejected: 1 },
    lastReceivedAt: "2026-08-17T21:00:00.000Z",
  },
];

/** `GET /api/autonomy/status` and `/decisions`, read by the Autonomy console. */
export const AUTONOMY_STATUS = [
  {
    projectId: PROJECT_ID,
    projectName: "E-Commerce Platform",
    autonomousMode: false,
    riskCeiling: "green",
    riskCeilingSource: "organization",
    killSwitchActive: true,
    releaseFrozen: false,
    executorConnected: false,
    actions: { enabled: 0, total: 9 },
    decisionsRecorded: 1,
    lastDecisionAt: "2026-08-18T04:00:00.000Z",
  },
];

export const AUTONOMY_DECISIONS = [
  {
    id: "aaaaaaaa-9555-4555-8555-555555555555",
    projectName: "E-Commerce Platform",
    action: "merge",
    decision: "refused",
    risk: "yellow",
    riskEscalated: true,
    headSha: "0123456789abcdef0123456789abcdef01234567",
    blockers: ["EXECUTOR_NOT_CONNECTED", "KILL_SWITCH_ACTIVE"],
    reachedStage: "authority",
    policyVersion: "phase1d-autonomy-v1",
    hadAuthor: true,
    hadApprover: false,
    independentApproval: false,
    decidedAt: "2026-08-18T04:00:00.000Z",
  },
];

/** `GET /api/autonomy/controls`, read by the Safety page. */
export const AUTONOMY_CONTROLS = {
  killSwitchActive: true,
  controls: {
    autonomousMode: false,
    maximumAutonomousRisk: "GREEN",
    actions: {
      plan: false,
      code: false,
      test: false,
      repair: false,
      review: false,
      approve: false,
      merge: false,
      deploy: false,
      rollback: false,
    },
  },
  canOperate: true,
};

/** `GET /api/operations/projects/[projectId]`, read by My Projects. */
export const PROJECT_OPERATIONS = {
  executionAllowed: false,
  deploymentExecutor: "not_connected",
  rollbackExecutor: "not_connected",
  repairWorker: "not_connected",
  project: {
    id: PROJECT_ID,
    name: "E-Commerce Platform",
    status: "active",
    healthState: "healthy",
    healthReason: null,
    healthComputedAt: "2026-08-18T05:00:00.000Z",
    releasesFrozen: false,
    operationsStopped: false,
    ownerAttentionRequired: false,
  },
  releaseAuthority: { allowed: false, blockers: ["EXECUTOR_NOT_CONNECTED"] },
  healthHistory: [
    {
      id: "aaaaaaaa-9666-4666-8666-666666666666",
      state: "healthy",
      previousState: "degraded",
      reason: "The failing checkout journey recovered.",
      computedAt: "2026-08-18T05:00:00.000Z",
    },
  ],
  incidents: [],
  monitors: [],
  freezes: [],
  rollbacks: [],
  repairs: [],
};

/** `GET /api/resources/models`, the declaration table under the resource manager. */
export const RESOURCE_MODELS = {
  models: [
    {
      provider: "openai",
      model: "gpt-5.3-codex",
      enabled: true,
      strengthTier: "strong",
      contextLimitTokens: 400_000,
      fullyDeclared: true,
    },
    {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      enabled: false,
      strengthTier: null,
      contextLimitTokens: null,
      fullyDeclared: false,
    },
  ],
  undeclared: [{ provider: "anthropic", model: "claude-sonnet-4-5" }],
  note:
    "An undeclared model cannot take work that requires a strong model, and cannot be shown to"
    + " fit any context. Routing will refuse it until both values are declared.",
};

/**
 * Job Seeker fixtures: a filled profile and preferences so the layout and
 * accessibility sweeps exercise the real form controls, not empty shells.
 */
export const JOB_SEEKER_PROFILE = {
  fullName: "Daniel H",
  email: "daniel@example.com",
  phone: "+1 555 0100",
  linkedinUrl: "https://www.linkedin.com/in/example",
  location: "Austin, TX",
  summary: "Platform engineer who ships end to end.",
  salaryTarget: 250000,
  salaryCurrency: "USD",
  workArrangement: "remote",
  openToTravel: false,
  openToRelocation: false,
  employmentHistory: [
    {
      organization: "Surge Services",
      title: "Founder",
      started: "2020",
      summary: "Built the software factory control plane.",
      highlights: ["Shipped the graph execution engine"],
    },
  ],
  education: [{ organization: "State University", title: "BSc Computer Science", started: "2012", ended: "2016" }],
  accomplishments: ["Took a control plane from zero to production"],
  skills: ["TypeScript", "PostgreSQL", "Next.js"],
  certifications: [],
  technologies: ["Supabase", "Vercel"],
  industries: ["Software"],
  updatedAt: "2026-08-20T00:00:00.000Z",
};

export const JOB_SEEKER_PREFERENCES = {
  targetTitles: ["Staff Engineer", "Platform Lead"],
  seniority: "Staff",
  compensationMinimum: 220000,
  locations: ["Remote — US"],
  workArrangements: ["remote", "hybrid"],
  industries: ["Software"],
  requiredCriteria: ["Remote-first"],
  preferredCriteria: ["Small team"],
  exclusions: ["Gambling"],
  qualificationThreshold: 80,
  updatedAt: "2026-08-20T00:00:00.000Z",
};
