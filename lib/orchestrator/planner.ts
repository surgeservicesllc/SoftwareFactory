import { classifyRisk, type RiskFactor, type RiskLevel } from "@/lib/risk";

/**
 * The orchestrator turns one owner command into a bounded plan.
 *
 * The planner is deliberately deterministic. Planning happens before any worker
 * provider is involved, so the Bot Manager keeps working while a provider is
 * Not Connected, the same command always produces the same plan, and the plan
 * can be tested without a network call. Risk classification reuses the single
 * Phase 1 policy engine in `lib/risk.ts` rather than restating it.
 */

export type WorkType =
  | "investigation"
  | "code_change"
  | "test_repair"
  | "security_review"
  | "performance_review"
  | "planning"
  | "review";

export type AgentRole =
  | "orchestrator"
  | "product"
  | "architect"
  | "frontend"
  | "backend"
  | "database"
  | "qa"
  | "security"
  | "performance"
  | "release"
  | "ceo_reporter";

export type PlannedTask = {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly agentRole: AgentRole;
  readonly workType: WorkType;
  readonly risk: Lowercase<RiskLevel>;
  readonly priority: number;
  readonly dependsOn: string | null;
  readonly validationPlan: readonly string[];
};

export type CommandPlan = {
  readonly summary: string;
  readonly intent: string;
  readonly risk: Lowercase<RiskLevel>;
  readonly riskFactors: readonly RiskFactor[];
  readonly requiresOwnerAction: boolean;
  readonly ownerActionReason: string | null;
  readonly tasks: readonly PlannedTask[];
};

export type PlanningContext = {
  readonly prompt: string;
  readonly requestedRisk: Lowercase<RiskLevel>;
  readonly projectName: string;
  readonly repositoryConnected: boolean;
  readonly providerConnected: boolean;
  readonly executionEnabled: boolean;
};

type IntentDefinition = {
  readonly id: string;
  readonly label: string;
  readonly patterns: readonly RegExp[];
  readonly factors: readonly RiskFactor[];
  readonly build: (context: PlanningContext) => readonly PlannedTask[];
};

const CODE_VALIDATION = [
  "repository unit and integration tests",
  "lint",
  "typecheck",
  "production build",
] as const;

const REVIEW_VALIDATION = ["reviewer reads the findings against the repository"] as const;

function task(
  overrides: Partial<PlannedTask> & Pick<PlannedTask, "key" | "title" | "agentRole" | "workType">,
): PlannedTask {
  return {
    description: overrides.description ?? overrides.title,
    acceptanceCriteria:
      overrides.acceptanceCriteria
      ?? "The change is scoped to the objective, validation passes, and a reviewable draft pull request is opened.",
    risk: overrides.risk ?? "green",
    priority: overrides.priority ?? 50,
    dependsOn: overrides.dependsOn ?? null,
    validationPlan:
      overrides.validationPlan
      ?? (overrides.workType === "code_change" || overrides.workType === "test_repair"
        ? CODE_VALIDATION
        : REVIEW_VALIDATION),
    ...overrides,
  };
}

/**
 * Ordered most specific first. Broad programmes decompose; ordinary work stays
 * a single task so trivial requests are not over-decomposed.
 */
const INTENTS: readonly IntentDefinition[] = [
  {
    id: "production_readiness",
    label: "Production readiness programme",
    patterns: [/production[- ]ready/i, /ready for production/i, /production readiness/i],
    factors: ["cross-component-change", "application-behavior"],
    build: () => [
      task({
        key: "repo_audit",
        title: "Audit the repository for production readiness",
        description: "Inventory structure, dependencies, configuration, and unfinished work.",
        acceptanceCriteria: "A written inventory of gaps with a severity for each finding.",
        agentRole: "architect",
        workType: "investigation",
        priority: 90,
      }),
      task({
        key: "security_audit",
        title: "Audit authorization, secrets handling, and protected resources",
        acceptanceCriteria: "Every finding names an exact file and the control that is missing or weak.",
        agentRole: "security",
        workType: "security_review",
        priority: 85,
        dependsOn: "repo_audit",
      }),
      task({
        key: "test_audit",
        title: "Audit automated test coverage and validation gates",
        acceptanceCriteria: "Gaps in unit, integration, and end-to-end coverage are listed with the behavior each one leaves unverified.",
        agentRole: "qa",
        workType: "investigation",
        priority: 80,
        dependsOn: "repo_audit",
      }),
      task({
        key: "performance_audit",
        title: "Review performance and responsiveness",
        acceptanceCriteria: "Measured or clearly reasoned performance concerns with the affected surface named.",
        agentRole: "performance",
        workType: "performance_review",
        priority: 70,
        dependsOn: "repo_audit",
      }),
      task({
        key: "release_review",
        title: "Review CI, release, and deployment readiness",
        acceptanceCriteria: "Required checks, release gates, and rollback expectations are documented against what actually exists.",
        agentRole: "release",
        workType: "review",
        priority: 65,
        dependsOn: "repo_audit",
      }),
    ],
  },
  {
    id: "repository_audit",
    label: "Repository audit",
    patterns: [/audit (the )?(entire |whole |full )?(repo|repository|codebase|project)/i, /full audit/i],
    factors: ["documentation-only"],
    build: () => [
      task({
        key: "audit",
        title: "Audit the repository",
        description: "Inspect structure, boundaries, dependencies, and unfinished work; report findings without changing code.",
        acceptanceCriteria: "Findings name exact files and explain the risk each one creates.",
        agentRole: "architect",
        workType: "investigation",
        priority: 80,
      }),
    ],
  },
  {
    id: "fix_tests",
    label: "Test repair",
    patterns: [/fix .*(failing )?tests?/i, /tests? (are )?failing/i, /repair .*tests?/i, /green.*(test|suite)/i],
    factors: ["test-only"],
    build: () => [
      task({
        key: "fix_tests",
        title: "Repair failing tests",
        description: "Diagnose the real cause of each failure and fix it. Do not disable, skip, or weaken a check.",
        acceptanceCriteria: "The suite passes for the right reason and no assertion was removed to achieve it.",
        agentRole: "qa",
        workType: "test_repair",
        priority: 90,
      }),
    ],
  },
  {
    id: "security_review",
    label: "Security review",
    patterns: [/security review/i, /review (the )?security/i, /security audit/i, /vulnerabilit/i],
    factors: ["authentication-or-security-controls"],
    build: () => [
      task({
        key: "security_review",
        title: "Review security posture",
        description: "Review authorization, input validation, secrets handling, and protected-resource contact.",
        acceptanceCriteria: "Each finding names the exact file, the weakness, and the concrete impact.",
        agentRole: "security",
        workType: "security_review",
        risk: "green",
        priority: 90,
      }),
    ],
  },
  {
    id: "performance",
    label: "Performance improvement",
    patterns: [/improve .*performance/i, /performance (issue|problem|review)/i, /make .*faster/i, /slow/i, /optimi[sz]e/i],
    factors: ["application-behavior"],
    build: () => [
      task({
        key: "performance_review",
        title: "Investigate performance",
        acceptanceCriteria: "The dominant cost is identified with evidence before any change is proposed.",
        agentRole: "performance",
        workType: "performance_review",
        priority: 70,
      }),
      task({
        key: "performance_fix",
        title: "Apply the identified performance improvement",
        agentRole: "backend",
        workType: "code_change",
        risk: "yellow",
        priority: 65,
        dependsOn: "performance_review",
      }),
    ],
  },
  {
    id: "mobile_ui",
    label: "Interface repair",
    patterns: [/mobile/i, /responsive/i, /navigation/i, /layout/i, /accessib/i, /\bui\b/i, /styling/i],
    factors: ["isolated-reversible-ui"],
    build: (context) => [
      task({
        key: "ui_fix",
        title: `Repair the interface issue in ${context.projectName}`,
        acceptanceCriteria:
          "The reported issue is resolved at mobile, tablet, and desktop widths without regressing keyboard or screen-reader use.",
        agentRole: "frontend",
        workType: "code_change",
        priority: 70,
      }),
    ],
  },
  {
    id: "database",
    label: "Database work",
    patterns: [/\b(database|schema|migration|index|rls|postgres|supabase)\b/i],
    factors: ["non-destructive-schema-change"],
    build: () => [
      task({
        key: "database_change",
        title: "Prepare the database change",
        description: "Design an additive, reversible change with row level security and indexes considered.",
        acceptanceCriteria:
          "The migration is additive, keeps RLS enabled, and states an explicit rollback path.",
        agentRole: "database",
        workType: "code_change",
        risk: "yellow",
        priority: 75,
      }),
    ],
  },
  {
    id: "review_pull_request",
    label: "Pull request review",
    patterns: [/review (this |the )?(pr|pull request)/i],
    factors: ["documentation-only"],
    build: () => [
      task({
        key: "pr_review",
        title: "Review the pull request",
        acceptanceCriteria: "Correctness, scope, test coverage, and protected-resource contact are each addressed.",
        agentRole: "architect",
        workType: "review",
        priority: 75,
      }),
    ],
  },
  {
    id: "plan_sprint",
    label: "Planning",
    patterns: [/plan (the )?(next )?sprint/i, /roadmap/i, /backlog/i, /prioriti[sz]e/i],
    factors: ["documentation-only"],
    build: () => [
      task({
        key: "planning",
        title: "Plan the next increment",
        acceptanceCriteria: "A prioritized set of outcomes, each with acceptance criteria and a risk level.",
        agentRole: "product",
        workType: "planning",
        priority: 60,
      }),
    ],
  },
  {
    id: "investigate_bug",
    label: "Bug investigation",
    patterns: [/investigate/i, /\bbug\b/i, /\bdefect\b/i, /why (is|does|did)/i, /root cause/i],
    factors: ["application-behavior"],
    build: () => [
      task({
        key: "investigate",
        title: "Investigate the reported behavior",
        acceptanceCriteria: "The root cause is identified with the exact file and line evidence that supports it.",
        agentRole: "backend",
        workType: "investigation",
        priority: 80,
      }),
    ],
  },
  {
    id: "implement_feature",
    label: "Feature implementation",
    patterns: [/implement/i, /\badd\b/i, /\bbuild\b/i, /\bcreate\b/i, /\bfeature\b/i],
    factors: ["application-behavior"],
    build: () => [
      task({
        key: "implement",
        title: "Implement the requested change",
        agentRole: "backend",
        workType: "code_change",
        risk: "yellow",
        priority: 70,
      }),
    ],
  },
];

const FALLBACK_INTENT: IntentDefinition = {
  id: "general_engineering",
  label: "General engineering work",
  patterns: [],
  factors: ["application-behavior"],
  build: () => [
    task({
      key: "work",
      title: "Complete the requested engineering work",
      agentRole: "backend",
      workType: "code_change",
      risk: "yellow",
      priority: 60,
    }),
  ],
};

/** RED signals that must reach an owner regardless of what the command asked for. */
const RED_SIGNAL_FACTORS: ReadonlyArray<[RegExp, RiskFactor]> = [
  [/\b(secret|credential|api key|token|private key|password)\b/i, "secrets-or-credentials"],
  [/\b(auth|authentication|authorization|rls|permission|session)\b/i, "authentication-or-security-controls"],
  [/\b(dns|domain|nameserver|registrar)\b/i, "dns-or-domain-ownership"],
  [/\b(billing|payment|invoice|charge|purchase|budget)\b/i, "money-or-billing"],
  [/\b(delete|drop|truncate|wipe|purge)\b.*\b(production|prod|database|data)\b/i, "destructive-production-data"],
  [/\b(production|prod)\b.*\b(deploy|rollback|release)\b/i, "irreversible-production-change"],
];

export function detectIntent(prompt: string): IntentDefinition {
  return (
    INTENTS.find((intent) => intent.patterns.some((pattern) => pattern.test(prompt)))
    ?? FALLBACK_INTENT
  );
}

export function planCommand(context: PlanningContext): CommandPlan {
  const prompt = context.prompt.trim();
  const intent = detectIntent(prompt);

  const signalFactors = RED_SIGNAL_FACTORS.filter(([pattern]) => pattern.test(prompt)).map(
    ([, factor]) => factor,
  );
  const classification = classifyRisk([...intent.factors, ...signalFactors]);

  // The owner's declared risk is a floor, never a discount on what was detected.
  const requestedRank = { green: 0, yellow: 1, red: 2 }[context.requestedRisk];
  const detectedRank = { GREEN: 0, YELLOW: 1, RED: 2 }[classification.level];
  const effectiveLevel = (
    ["green", "yellow", "red"] as const
  )[Math.max(requestedRank, detectedRank)];

  // A task's risk is what actually gates execution, so it must carry both the
  // detected risk and the owner's declared floor. Leaving the floor on the plan
  // alone would let a YELLOW declaration run as GREEN work.
  const tasks = intent.build(context).map((planned) => {
    const taskRank = { green: 0, yellow: 1, red: 2 }[planned.risk];
    const raised = (["green", "yellow", "red"] as const)[
      Math.max(taskRank, detectedRank, requestedRank)
    ];
    return { ...planned, risk: raised };
  });

  const blockers: string[] = [];
  if (!context.repositoryConnected) {
    blockers.push("this project has no live GitHub connection, so no run can resolve a repository");
  }
  if (!context.providerConnected) {
    blockers.push("no worker provider is connected, so no run can start");
  }
  if (!context.executionEnabled) {
    blockers.push("commanded execution is OFF for this organization");
  }
  if (effectiveLevel === "red") {
    blockers.push("RED work requires explicit owner approval before any run may start");
  }

  return {
    summary: `${intent.label}: ${prompt.slice(0, 200)}`,
    intent: intent.id,
    risk: effectiveLevel,
    riskFactors: classification.factors,
    requiresOwnerAction: blockers.length > 0,
    ownerActionReason: blockers.length > 0 ? blockers.join("; ") : null,
    tasks,
  };
}
