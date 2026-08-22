import { z } from "zod";

/**
 * What one bot is allowed to do on one project.
 *
 * Browser-safe on purpose: the wizard needs the same bounds, the same presets,
 * and the same idea of "elevated" that the server enforces, and re-deriving
 * them in the client is how the two drift apart. The server still validates
 * everything it receives — this module is shared vocabulary, not a substitute
 * for the boundary.
 *
 * Three rules are worth stating outright, because they shape everything below.
 *
 * **Least privilege is the default, not a preset.** An assignment created with
 * no configuration at all reads the repository, opens nothing, touches no
 * pipeline or environment, runs one task at a time, and needs a person. Every
 * widening is something somebody chose.
 *
 * **Authority is nested.** Opening a pull request requires repository write;
 * merging requires being able to open. `normalizeAssignmentConfig` refuses
 * incoherent combinations rather than quietly repairing them — a grant that
 * gets silently adjusted is a grant nobody reviewed. The database enforces the
 * same rule again in `bot_assignments_authority_nested`.
 *
 * **Elevated authority keeps its human.** Merge and production access force
 * `requiresHumanApproval` to stay on, matching `policies/AUTO_MERGE_POLICY.md`:
 * Phase 1 has no autonomous merge or deployment authority, and a configuration
 * must not be able to claim one.
 */

export const REPOSITORY_ACCESS_LEVELS = ["none", "read", "write"] as const;
export type RepositoryAccess = (typeof REPOSITORY_ACCESS_LEVELS)[number];

/**
 * There is no direct default-branch option because the platform has no such
 * authority: every published change is an isolated branch and a draft pull
 * request. Offering the value would describe a capability that does not exist.
 */
export const BRANCH_STRATEGIES = ["per_task_branch", "shared_project_branch"] as const;
export type BranchStrategy = (typeof BRANCH_STRATEGIES)[number];

export const PIPELINE_ACCESS_LEVELS = ["none", "assigned", "all"] as const;
export type PipelineAccess = (typeof PIPELINE_ACCESS_LEVELS)[number];

export const ENVIRONMENT_ACCESS_LEVELS = ["none", "preview", "production"] as const;
export type EnvironmentAccess = (typeof ENVIRONMENT_ACCESS_LEVELS)[number];

export const MAX_CONCURRENT_TASKS = 10;
export const MAX_RESPONSIBILITIES = 12;
export const MAX_TOOLS = 16;
export const MAX_INSTRUCTIONS = 4000;
/** The batch ceiling `assign_bots_to_project` enforces. */
export const MAX_BOTS_PER_ASSIGNMENT = 25;

export interface AssignmentConfig {
  readonly preset: string | null;
  readonly responsibilities: readonly string[];
  readonly instructions: string | null;
  readonly repositoryAccess: RepositoryAccess;
  readonly branchStrategy: BranchStrategy;
  readonly canOpenPullRequest: boolean;
  readonly canMergePullRequest: boolean;
  readonly pipelineAccess: PipelineAccess;
  readonly environmentAccess: EnvironmentAccess;
  readonly tools: readonly string[];
  readonly requiresHumanApproval: boolean;
  readonly maxConcurrentTasks: number;
  /** P0 (0) is the most urgent, matching the portfolio scheduler's ladder. */
  readonly priority: number;
}

/** What a bot gets when nobody has chosen anything: the narrowest useful grant. */
export const LEAST_PRIVILEGE_CONFIG: AssignmentConfig = Object.freeze({
  preset: null,
  responsibilities: Object.freeze([]),
  instructions: null,
  repositoryAccess: "read",
  branchStrategy: "per_task_branch",
  canOpenPullRequest: false,
  canMergePullRequest: false,
  pipelineAccess: "none",
  environmentAccess: "none",
  tools: Object.freeze([]),
  requiresHumanApproval: true,
  maxConcurrentTasks: 1,
  priority: 2,
});

/**
 * Whether somebody has actually configured this posting.
 *
 * The comparison is against {@link LEAST_PRIVILEGE_CONFIG} rather than against
 * any single field, because that is what "configured" means here: an
 * assignment created with no configuration at all *is* the least-privilege
 * posting, and every departure from it is something a person chose.
 *
 * The AI Factory journey's "Configure Bot Settings" step used to derive this
 * from `roleId || responsibilities.length`. Both halves were wrong: the API
 * nests `responsibilities` under `config`, so that half read `undefined`, and
 * `bot_assignments.role_id` is NOT NULL, so the other half was true of every
 * assignment that could exist. The step was marked done the instant a bot was
 * assigned, and its evidence line could only ever read "N of N configured".
 */
export function assignmentIsConfigured(config: AssignmentConfig): boolean {
  const baseline = LEAST_PRIVILEGE_CONFIG;
  return (
    config.preset !== baseline.preset
    || config.responsibilities.length > 0
    || (config.instructions ?? "").trim().length > 0
    || config.tools.length > 0
    || config.repositoryAccess !== baseline.repositoryAccess
    || config.branchStrategy !== baseline.branchStrategy
    || config.canOpenPullRequest !== baseline.canOpenPullRequest
    || config.canMergePullRequest !== baseline.canMergePullRequest
    || config.pipelineAccess !== baseline.pipelineAccess
    || config.environmentAccess !== baseline.environmentAccess
    || config.requiresHumanApproval !== baseline.requiresHumanApproval
    || config.maxConcurrentTasks !== baseline.maxConcurrentTasks
    || config.priority !== baseline.priority
  );
}

/**
 * Whether an assignment posting differs from every execution default.
 * Model and work effort live beside `config` in the API/database shape, so
 * callers that summarize a whole posting must include them as well.
 */
export function assignmentPostingIsConfigured(input: {
  readonly config: AssignmentConfig;
  readonly model?: string | null;
  readonly workEffort?: string | null;
}): boolean {
  return assignmentIsConfigured(input.config)
    || (input.model ?? "").trim().length > 0
    || (input.workEffort ?? "medium") !== "medium";
}

export const assignmentConfigSchema = z
  .object({
    preset: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,38}$/)
      .nullish(),
    responsibilities: z
      .array(z.string().trim().min(1).max(160))
      .max(MAX_RESPONSIBILITIES)
      .optional(),
    instructions: z.string().trim().min(1).max(MAX_INSTRUCTIONS).nullish(),
    repositoryAccess: z.enum(REPOSITORY_ACCESS_LEVELS).optional(),
    branchStrategy: z.enum(BRANCH_STRATEGIES).optional(),
    canOpenPullRequest: z.boolean().optional(),
    canMergePullRequest: z.boolean().optional(),
    pipelineAccess: z.enum(PIPELINE_ACCESS_LEVELS).optional(),
    environmentAccess: z.enum(ENVIRONMENT_ACCESS_LEVELS).optional(),
    tools: z.array(z.string().trim().min(1).max(60)).max(MAX_TOOLS).optional(),
    requiresHumanApproval: z.boolean().optional(),
    maxConcurrentTasks: z.number().int().min(1).max(MAX_CONCURRENT_TASKS).optional(),
    priority: z.number().int().min(0).max(3).optional(),
  })
  .strict();

export type AssignmentConfigInput = z.infer<typeof assignmentConfigSchema>;

export class IncoherentAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncoherentAssignmentError";
  }
}

/**
 * Fills in the defaults and refuses a grant that does not hold together.
 *
 * Refusing rather than repairing is the deliberate part. Silently turning
 * "merge, no approval needed" into "merge, approval required" would store
 * something nobody agreed to, under a label they did agree to — and the person
 * reviewing the assignment afterwards has no way to see that it happened.
 */
export function normalizeAssignmentConfig(input: AssignmentConfigInput = {}): AssignmentConfig {
  const merged: AssignmentConfig = {
    preset: input.preset ?? null,
    responsibilities: Object.freeze([...(input.responsibilities ?? [])]),
    instructions: input.instructions ?? null,
    repositoryAccess: input.repositoryAccess ?? LEAST_PRIVILEGE_CONFIG.repositoryAccess,
    branchStrategy: input.branchStrategy ?? LEAST_PRIVILEGE_CONFIG.branchStrategy,
    canOpenPullRequest: input.canOpenPullRequest ?? LEAST_PRIVILEGE_CONFIG.canOpenPullRequest,
    canMergePullRequest: input.canMergePullRequest ?? LEAST_PRIVILEGE_CONFIG.canMergePullRequest,
    pipelineAccess: input.pipelineAccess ?? LEAST_PRIVILEGE_CONFIG.pipelineAccess,
    environmentAccess: input.environmentAccess ?? LEAST_PRIVILEGE_CONFIG.environmentAccess,
    tools: Object.freeze([...(input.tools ?? [])]),
    requiresHumanApproval:
      input.requiresHumanApproval ?? LEAST_PRIVILEGE_CONFIG.requiresHumanApproval,
    maxConcurrentTasks: input.maxConcurrentTasks ?? LEAST_PRIVILEGE_CONFIG.maxConcurrentTasks,
    priority: input.priority ?? LEAST_PRIVILEGE_CONFIG.priority,
  };

  if (merged.canOpenPullRequest && merged.repositoryAccess !== "write") {
    throw new IncoherentAssignmentError(
      "A bot needs repository write access before it can open a pull request.",
    );
  }
  if (merged.canMergePullRequest && !merged.canOpenPullRequest) {
    throw new IncoherentAssignmentError(
      "A bot needs permission to open a pull request before it can merge one.",
    );
  }
  if (!merged.requiresHumanApproval && merged.canMergePullRequest) {
    throw new IncoherentAssignmentError(
      "Merging a pull request always needs a person to approve it.",
    );
  }
  if (!merged.requiresHumanApproval && merged.environmentAccess === "production") {
    throw new IncoherentAssignmentError("Production access always needs a person to approve it.");
  }

  return Object.freeze(merged);
}

/**
 * The permissions that deserve a second look before anyone confirms.
 *
 * Returned as sentences rather than flags so the review step can list what it
 * is actually asking about. An empty array means nothing here is elevated —
 * which the review step should state, rather than showing an empty warning box.
 */
export function elevatedPermissions(config: AssignmentConfig): string[] {
  const elevated: string[] = [];
  if (config.repositoryAccess === "write") elevated.push("Can write to the repository");
  if (config.canOpenPullRequest) elevated.push("Can open pull requests");
  if (config.canMergePullRequest) elevated.push("Can merge pull requests, with approval");
  if (config.pipelineAccess === "all") elevated.push("Can run every pipeline");
  if (config.environmentAccess === "preview") elevated.push("Can reach preview environments");
  if (config.environmentAccess === "production") {
    elevated.push("Can reach production, with approval");
  }
  if (!config.requiresHumanApproval) elevated.push("Works without waiting for approval");
  if (config.maxConcurrentTasks > 3) {
    elevated.push(`Runs up to ${config.maxConcurrentTasks} tasks at once`);
  }
  return elevated;
}

export function hasElevatedPermissions(config: AssignmentConfig): boolean {
  return elevatedPermissions(config).length > 0;
}

export interface RolePreset {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  /** Matched against a `bot_roles.slug` when one exists, before falling back. */
  readonly roleSlug: string;
  readonly config: Omit<AssignmentConfig, "preset">;
}

function preset(
  id: string,
  label: string,
  summary: string,
  responsibilities: readonly string[],
  overrides: Partial<Omit<AssignmentConfig, "preset" | "responsibilities">>,
): RolePreset {
  return Object.freeze({
    id,
    label,
    summary,
    roleSlug: id,
    config: Object.freeze({
      ...LEAST_PRIVILEGE_CONFIG,
      responsibilities: Object.freeze([...responsibilities]),
      ...overrides,
    }),
  });
}

/**
 * The seven starting points.
 *
 * Each is a real, defensible grant rather than a label: a Reviewer genuinely
 * cannot write, a Researcher genuinely cannot reach the repository at all, and
 * only the two that build get write access. Presets are a starting point the
 * person then edits — the stored columns are what counts, which is why the
 * database keeps `preset` for display only.
 */
export const ROLE_PRESETS: readonly RolePreset[] = Object.freeze([
  preset(
    "developer",
    "Developer",
    "Implements features and fixes, and opens pull requests for review.",
    ["Implement features", "Fix defects", "Open pull requests"],
    {
      repositoryAccess: "write",
      canOpenPullRequest: true,
      pipelineAccess: "assigned",
      maxConcurrentTasks: 3,
      priority: 1,
    },
  ),
  preset(
    "reviewer",
    "Reviewer",
    "Reads changes and comments. Never writes code of its own.",
    ["Review pull requests", "Comment on code quality"],
    { repositoryAccess: "read", pipelineAccess: "assigned", maxConcurrentTasks: 3, priority: 1 },
  ),
  preset(
    "tester",
    "Tester",
    "Writes and runs tests, and reports what failed.",
    ["Write tests", "Run test suites", "Report failures"],
    {
      repositoryAccess: "write",
      canOpenPullRequest: true,
      pipelineAccess: "all",
      maxConcurrentTasks: 2,
      priority: 2,
    },
  ),
  preset(
    "security",
    "Security",
    "Scans for vulnerabilities and unsafe patterns. Reads only.",
    ["Scan for vulnerabilities", "Check dependencies", "Flag unsafe patterns"],
    { repositoryAccess: "read", pipelineAccess: "assigned", maxConcurrentTasks: 2, priority: 0 },
  ),
  preset(
    "devops",
    "DevOps",
    "Watches pipelines and deployments. Reaches preview, never production unattended.",
    ["Maintain pipelines", "Watch deployments", "Investigate build failures"],
    {
      repositoryAccess: "read",
      pipelineAccess: "all",
      environmentAccess: "preview",
      maxConcurrentTasks: 2,
      priority: 1,
    },
  ),
  preset(
    "research",
    "Research",
    "Investigates and summarizes. Touches no repository at all.",
    ["Investigate options", "Summarize findings"],
    { repositoryAccess: "none", pipelineAccess: "none", maxConcurrentTasks: 2, priority: 3 },
  ),
  preset(
    "documentation",
    "Documentation",
    "Writes and updates documentation, and opens pull requests for it.",
    ["Write documentation", "Keep guides current"],
    {
      repositoryAccess: "write",
      canOpenPullRequest: true,
      pipelineAccess: "none",
      maxConcurrentTasks: 2,
      priority: 3,
    },
  ),
]);

export function findRolePreset(id: string | null | undefined): RolePreset | null {
  if (!id) return null;
  return ROLE_PRESETS.find((entry) => entry.id === id) ?? null;
}

/** A preset applied as a configuration, with its own id recorded. */
export function configFromPreset(id: string): AssignmentConfig {
  const found = findRolePreset(id);
  if (!found) throw new IncoherentAssignmentError(`Unknown role preset: ${id}`);
  return normalizeAssignmentConfig({
    ...found.config,
    responsibilities: [...found.config.responsibilities],
    tools: [...found.config.tools],
    preset: found.id,
  });
}

const REPOSITORY_ACCESS_LABELS: Record<RepositoryAccess, string> = {
  none: "No repository access",
  read: "Read the repository",
  write: "Write to the repository",
};

const PIPELINE_ACCESS_LABELS: Record<PipelineAccess, string> = {
  none: "No pipelines",
  assigned: "Assigned pipelines only",
  all: "All pipelines",
};

const ENVIRONMENT_ACCESS_LABELS: Record<EnvironmentAccess, string> = {
  none: "No environments",
  preview: "Preview only",
  production: "Preview and production",
};

const BRANCH_STRATEGY_LABELS: Record<BranchStrategy, string> = {
  per_task_branch: "A branch per task",
  shared_project_branch: "One shared project branch",
};

export function repositoryAccessLabel(value: RepositoryAccess): string {
  return REPOSITORY_ACCESS_LABELS[value];
}
export function pipelineAccessLabel(value: PipelineAccess): string {
  return PIPELINE_ACCESS_LABELS[value];
}
export function environmentAccessLabel(value: EnvironmentAccess): string {
  return ENVIRONMENT_ACCESS_LABELS[value];
}
export function branchStrategyLabel(value: BranchStrategy): string {
  return BRANCH_STRATEGY_LABELS[value];
}
export function priorityLabel(priority: number): string {
  return `P${Math.min(3, Math.max(0, Math.trunc(priority)))}`;
}

/**
 * The database's snake_case payload.
 *
 * Built here rather than in the route so there is exactly one place that knows
 * how a configuration crosses into SQL, and it is the same place that decided
 * the configuration was coherent.
 */
export function toDatabaseConfiguration(config: AssignmentConfig): Record<string, unknown> {
  return {
    preset: config.preset,
    responsibilities: [...config.responsibilities],
    instructions: config.instructions,
    repository_access: config.repositoryAccess,
    branch_strategy: config.branchStrategy,
    can_open_pull_request: config.canOpenPullRequest,
    can_merge_pull_request: config.canMergePullRequest,
    pipeline_access: config.pipelineAccess,
    environment_access: config.environmentAccess,
    tools: [...config.tools],
    requires_human_approval: config.requiresHumanApproval,
    max_concurrent_tasks: config.maxConcurrentTasks,
    priority: config.priority,
  };
}

type AssignmentConfigRow = {
  preset?: string | null;
  responsibilities?: unknown;
  instructions?: string | null;
  repository_access?: string | null;
  branch_strategy?: string | null;
  can_open_pull_request?: boolean | null;
  can_merge_pull_request?: boolean | null;
  pipeline_access?: string | null;
  environment_access?: string | null;
  tools?: unknown;
  requires_human_approval?: boolean | null;
  max_concurrent_tasks?: number | null;
  priority?: number | null;
};

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function stringList(value: unknown, max: number): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.filter((entry): entry is string => typeof entry === "string").slice(0, max),
  );
}

/**
 * Reads a stored row back into the shared shape.
 *
 * A row written before this migration has no configuration columns at all;
 * those read as least privilege rather than as the widest grant, so an older
 * assignment cannot become more powerful by being displayed.
 */
export function assignmentConfigFromRow(row: AssignmentConfigRow): AssignmentConfig {
  return Object.freeze({
    preset: row.preset ?? null,
    responsibilities: stringList(row.responsibilities, MAX_RESPONSIBILITIES),
    instructions: row.instructions ?? null,
    repositoryAccess: oneOf(REPOSITORY_ACCESS_LEVELS, row.repository_access, "read"),
    branchStrategy: oneOf(BRANCH_STRATEGIES, row.branch_strategy, "per_task_branch"),
    canOpenPullRequest: row.can_open_pull_request === true,
    canMergePullRequest: row.can_merge_pull_request === true,
    pipelineAccess: oneOf(PIPELINE_ACCESS_LEVELS, row.pipeline_access, "none"),
    environmentAccess: oneOf(ENVIRONMENT_ACCESS_LEVELS, row.environment_access, "none"),
    tools: stringList(row.tools, MAX_TOOLS),
    // Absent means required. The one direction this may not fail is open.
    requiresHumanApproval: row.requires_human_approval !== false,
    maxConcurrentTasks:
      typeof row.max_concurrent_tasks === "number" && row.max_concurrent_tasks >= 1
        ? Math.min(MAX_CONCURRENT_TASKS, Math.trunc(row.max_concurrent_tasks))
        : 1,
    priority:
      typeof row.priority === "number" && row.priority >= 0 && row.priority <= 3
        ? Math.trunc(row.priority)
        : 2,
  });
}
