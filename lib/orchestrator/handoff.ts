import {
  assessExecution,
  type CostAssessment,
  type ExecutionMechanism,
} from "@/lib/worker/cost-policy";

/**
 * The Codex handoff package.
 *
 * Phase 1C's execution path previously assumed SoftwareFactory would call a
 * provider API itself, which bills per token. Under the zero-token rule it does
 * not. What it does instead is assemble a *complete* work package — everything
 * an executor needs to do the job correctly and nothing it needs to guess — and
 * hand that to a Codex session authenticated by subscription rather than by a
 * metered API key.
 *
 * The package is the product. Its quality is what determines whether the
 * execution boundary is a real capability or a shrug, so every field here
 * exists because its absence would force the executor to invent something:
 *
 * - Without `baseSha` it does not know what it is changing.
 * - Without `acceptanceCriteria` it does not know when it is done.
 * - Without `forbiddenActions` it does not know what would be a violation
 *   rather than a shortcut.
 * - Without `validationCommands` it does not know what "it works" means here.
 * - Without `expectedResult` it does not know what to hand back.
 *
 * Everything in this module is deterministic. No model is consulted to classify
 * a command, resolve a repository, or set a risk floor — that work is rules, and
 * paying a model to apply rules is both slower and less predictable.
 */

export const COMMAND_KINDS = [
  "DOCUMENTATION",
  "TEST_ONLY",
  "BUG_FIX",
  "FEATURE",
  "REFACTOR",
  "DEPENDENCY",
  "SCHEMA",
  "INFRASTRUCTURE",
  "UNKNOWN",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const RISK_LEVELS = ["GREEN", "YELLOW", "RED"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Risk floor per command kind.
 *
 * A floor rather than a value: the classifier can raise risk, never lower it.
 * Schema and infrastructure work is RED because it can be neither reviewed away
 * nor cheaply reversed.
 */
const KIND_RISK_FLOOR: Readonly<Record<CommandKind, RiskLevel>> = Object.freeze({
  DOCUMENTATION: "GREEN",
  TEST_ONLY: "GREEN",
  BUG_FIX: "YELLOW",
  FEATURE: "YELLOW",
  REFACTOR: "YELLOW",
  DEPENDENCY: "YELLOW",
  SCHEMA: "RED",
  INFRASTRUCTURE: "RED",
  // An unclassified command is not assumed harmless.
  UNKNOWN: "YELLOW",
});

/** Ordered so the most specific signals win over the generic ones. */
const KIND_SIGNALS: readonly { kind: CommandKind; pattern: RegExp }[] = [
  { kind: "SCHEMA", pattern: /\b(migration|schema|rls|policy|supabase table|alter table|drop table)\b/i },
  { kind: "INFRASTRUCTURE", pattern: /\b(deploy|workflow|secret|environment variable|dns|vercel|infrastructure|ci config)\b/i },
  { kind: "DEPENDENCY", pattern: /\b(dependenc|upgrade|bump|package\.json|npm install|lockfile)\b/i },
  { kind: "TEST_ONLY", pattern: /\b(add (a )?test|test coverage|unit test|write tests)\b/i },
  { kind: "DOCUMENTATION", pattern: /\b(document|documentation|readme|changelog|comment|docs?)\b/i },
  { kind: "BUG_FIX", pattern: /\b(fix|bug|defect|regression|broken|failing)\b/i },
  { kind: "REFACTOR", pattern: /\b(refactor|rename|extract|simplif|clean ?up|tidy)\b/i },
  { kind: "FEATURE", pattern: /\b(add|build|implement|create|introduce|support)\b/i },
];

/**
 * Prompt signals that raise risk regardless of kind.
 *
 * These describe *reach*, not topic. A documentation change that also touches
 * authentication is not a documentation change.
 */
const ESCALATION_SIGNALS: readonly { pattern: RegExp; to: RiskLevel; why: string }[] = [
  // Prefix-matched (`\w*`) rather than whole-word. A trailing `\b` cannot match
  // an inflected form — `\btoken\b` misses "tokens", `\bauth\b` misses
  // "authentication" — and every miss here fails in the under-escalating
  // direction, which is the one that matters.
  { pattern: /\b(auth\w*|permission\w*|rls|credential\w*|secret\w*|token\w*|password\w*)/i, to: "RED", why: "touches authentication, authorization or secrets" },
  { pattern: /\b(delet\w*|drop|dropping|truncat\w*|remove all|purg\w*|destroy\w*)/i, to: "RED", why: "describes destructive action" },
  { pattern: /\b(production|prod\b|live site|customer data)/i, to: "RED", why: "names production or customer data" },
  { pattern: /\b(merg\w*|deploy\w*|releas\w*|publish\w*|rollback\w*)/i, to: "RED", why: "describes an action beyond opening a draft pull request" },
];

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = Object.freeze({
  GREEN: 0,
  YELLOW: 1,
  RED: 2,
});

function highest(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export type Classification = {
  readonly kind: CommandKind;
  readonly risk: RiskLevel;
  readonly reasons: readonly string[];
};

/**
 * Classify a command deterministically.
 *
 * The same prompt always produces the same classification, which is what makes
 * a risk floor meaningful — a model that classified "delete the user table" as
 * GREEN once in twenty runs would make the whole gate decorative.
 */
export function classifyCommand(prompt: string): Classification {
  const reasons: string[] = [];
  const matched = KIND_SIGNALS.find((signal) => signal.pattern.test(prompt));
  const kind = matched?.kind ?? "UNKNOWN";

  reasons.push(
    matched
      ? `Classified ${kind} from the command text.`
      : "No recognised command shape, so it is treated as UNKNOWN rather than assumed simple.",
  );

  let risk = KIND_RISK_FLOOR[kind];
  reasons.push(`${kind} carries a ${risk} floor.`);

  for (const signal of ESCALATION_SIGNALS) {
    if (signal.pattern.test(prompt)) {
      const raised = highest(risk, signal.to);
      if (raised !== risk) {
        reasons.push(`Raised to ${signal.to} because the command ${signal.why}.`);
        risk = raised;
      }
    }
  }

  return { kind, risk, reasons };
}

/**
 * Acceptance criteria, derived from the classification.
 *
 * Generated rather than asked for, because a command that arrives without them
 * still needs them — and the executor should not be the one deciding what would
 * count as success for work it was asked to do.
 */
export function acceptanceCriteriaFor(classification: Classification): readonly string[] {
  const shared = [
    "The change is limited to what the command asked for.",
    "npm run lint, npm run typecheck, npm test and npm run build all succeed.",
    "No credential, key or secret appears in source, tests, fixtures or logs.",
    "The work is on a factory/* branch and ends at an open draft pull request.",
  ];

  switch (classification.kind) {
    case "DOCUMENTATION":
      return [...shared, "No behavioural code changes accompany the documentation."];
    case "TEST_ONLY":
      return [
        ...shared,
        "The new tests fail against the unfixed behaviour and pass against the fixed one.",
        "No production code is modified.",
      ];
    case "BUG_FIX":
      return [
        ...shared,
        "A test reproduces the defect and fails without the fix.",
        "The root cause is addressed rather than the symptom suppressed.",
      ];
    case "DEPENDENCY":
      return [...shared, "The lockfile is updated in the same commit.", "No transitive major version changes silently."];
    case "SCHEMA":
      return [
        ...shared,
        "RLS and FORCE RLS remain enabled on every exposed table.",
        "The migration version is unique and sorts after every applied migration.",
      ];
    default:
      return [...shared, "New behaviour is covered by a test that would fail without it."];
  }
}

export type HandoffPackage = {
  readonly runId: string;
  readonly commandId: string;
  readonly projectId: string;
  readonly repositoryFullName: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly prompt: string;
  readonly classification: Classification;
  readonly acceptanceCriteria: readonly string[];
  readonly branchName: string;
  readonly allowedActions: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly validationCommands: readonly string[];
  readonly contextFiles: readonly string[];
  readonly expectedResult: string;
  readonly mechanism: ExecutionMechanism;
  readonly cost: CostAssessment;
};

/** `factory/<run-id>-<slug>`, matching the branch contract the worker enforces. */
export function branchNameFor(runId: string, prompt: string): string {
  const slug = prompt
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `factory/${runId.toLowerCase()}-${slug || "change"}`;
}

const ALWAYS_FORBIDDEN = Object.freeze([
  "Committing to the default branch.",
  "Marking a pull request ready for review, or merging one.",
  "Deploying, releasing or rolling back.",
  "Modifying GitHub Actions workflow files.",
  "Adding, reading or printing any credential, key or token.",
  "Enabling a metered AI provider API, or adding OPENAI_API_KEY or ANTHROPIC_API_KEY.",
  "Disabling or weakening Row Level Security.",
]);

/**
 * Assemble the package.
 *
 * Refuses to build one for RED work: RED requires explicit owner approval, and
 * producing a ready-to-execute package for it would put the dangerous thing one
 * accidental paste away from happening.
 */
export function buildHandoffPackage(input: {
  readonly runId: string;
  readonly commandId: string;
  readonly projectId: string;
  readonly repositoryFullName: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly prompt: string;
  readonly contextFiles?: readonly string[];
  readonly mechanism?: ExecutionMechanism;
}): HandoffPackage {
  const classification = classifyCommand(input.prompt);

  if (classification.risk === "RED") {
    throw new HandoffRefusedError(
      "red_requires_owner_approval",
      `This command classifies as RED (${classification.reasons.join(" ")}) and needs explicit owner approval before a work package may be produced.`,
    );
  }

  if (!/^[0-9a-f]{40}$/i.test(input.baseSha)) {
    // A short or absent SHA is how a run silently starts from the wrong tree.
    throw new HandoffRefusedError(
      "base_sha_not_exact",
      "The base SHA must be a full 40-character commit identifier resolved from the live repository.",
    );
  }

  const mechanism = input.mechanism ?? "CODEX_HANDOFF";
  const cost = assessExecution(mechanism);
  if (!cost.allowed) {
    throw new HandoffRefusedError("paid_ai_api_blocked", cost.detail);
  }

  return {
    runId: input.runId,
    commandId: input.commandId,
    projectId: input.projectId,
    repositoryFullName: input.repositoryFullName,
    baseBranch: input.baseBranch,
    baseSha: input.baseSha,
    prompt: input.prompt,
    classification,
    acceptanceCriteria: acceptanceCriteriaFor(classification),
    branchName: branchNameFor(input.runId, input.prompt),
    allowedActions: [
      "Reading any file in the repository.",
      "Creating and modifying files the command requires.",
      `Committing to ${branchNameFor(input.runId, input.prompt)}.`,
      "Pushing that branch and opening a draft pull request.",
      "Running the validation commands below.",
    ],
    forbiddenActions: ALWAYS_FORBIDDEN,
    validationCommands: ["npm run lint", "npm run typecheck", "npm test", "npm run build"],
    contextFiles: input.contextFiles ?? ["AGENTS.md", "AI/PROJECT_CONTEXT.md", "AI/ARCHITECTURE.md"],
    expectedResult:
      "A structured result naming the branch, the commit SHA, the draft pull request number and URL, " +
      "the validation command outcomes, and every changed path.",
    mechanism,
    cost,
  };
}

export class HandoffRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HandoffRefusedError";
  }
}

/**
 * Render the package as the instruction text an executor receives.
 *
 * Plain text on purpose: it has to survive being pasted into a Codex session,
 * a task file, or a dispatch payload without a parser on the other end.
 */
export function renderHandoff(pkg: HandoffPackage): string {
  const lines = [
    `# SoftwareFactory work package ${pkg.runId}`,
    "",
    `Repository: ${pkg.repositoryFullName}`,
    `Base: ${pkg.baseBranch} at ${pkg.baseSha}`,
    `Branch to create: ${pkg.branchName}`,
    `Classification: ${pkg.classification.kind}, risk ${pkg.classification.risk}`,
    "",
    "## The request",
    pkg.prompt,
    "",
    "## Done means all of these",
    ...pkg.acceptanceCriteria.map((line) => `- ${line}`),
    "",
    "## You may",
    ...pkg.allowedActions.map((line) => `- ${line}`),
    "",
    "## You must not",
    ...pkg.forbiddenActions.map((line) => `- ${line}`),
    "",
    "## Validate with",
    ...pkg.validationCommands.map((line) => `- ${line}`),
    "",
    "## Read first",
    ...pkg.contextFiles.map((line) => `- ${line}`),
    "",
    "## Hand back",
    pkg.expectedResult,
  ];
  return lines.join("\n");
}
