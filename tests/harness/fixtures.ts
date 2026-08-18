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
