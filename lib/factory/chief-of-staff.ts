import { z } from "zod";

import { specialistForNode, type Specialist } from "@/lib/factory/specialists";
import { compileGraph } from "@/lib/graph/compiler";
import {
  defineNode,
  MODEL_TIERS,
  NODE_CAPABILITIES,
  type ModelTier,
  type NodeCapability,
  type NodeContract,
} from "@/lib/graph/contracts";
import type { ProposedEdge } from "@/lib/graph/dependencies";
import { storeZodSchema } from "@/lib/graph/stored-schema";
import { findTemplate } from "@/lib/graph/templates";
import type { GraphEdge, GraphTopology, RiskLevel } from "@/lib/graph/types";
import { findSensitiveData } from "@/lib/security/sensitive-data";

/**
 * The Chief of Staff, named.
 *
 * The directive asks for a primary orchestrator that converts intent into
 * requirements, tasks, a dependency graph, agent assignments, an execution
 * plan and QA gates, then delegates. That orchestrator EXISTS in this
 * repository as the graph engine's compiler (goal → typed nodes and edges),
 * scheduler (dependency-aware, parallel, claim-locked execution), router
 * (provider/model assignment under policy), and verifier loop (gates +
 * graph_verifications + bounded iterations). This module gives that
 * machinery its name and one composed view — it invents nothing and runs
 * nothing. Every field of a composed plan is derived from records the
 * engine already made: the goal verbatim, the nodes as compiled, the edges
 * as stored, the gates as declared, the states as executed.
 */

export type PlanNodeInput = Readonly<{
  node_key: string;
  capability?: string | null;
  lifecycle_stage?: string | null;
  state?: string | null;
  gate_kind?: string | null;
}>;

export type PlanEdgeInput = Readonly<{ from: string; to: string }>;

export type PlanTask = Readonly<{
  key: string;
  specialist: Specialist | null;
  stage: string | null;
  gated: boolean;
  state: string | null;
}>;

export type ComposedPlan = Readonly<{
  /** The intent, verbatim — requirements begin as exactly what was asked. */
  requirements: string;
  /** Dependency-ordered layers: everything in one layer may run in parallel. */
  layers: readonly (readonly string[])[];
  tasks: readonly PlanTask[];
  /** The QA gates the plan carries, by node key. */
  gatedTasks: readonly string[];
  /** The widest layer — the plan's real parallelism, not a claim. */
  maxParallelism: number;
  /** Whole-number percent of tasks completed or skipped; null with no tasks. */
  progressPercent: number | null;
}>;

/**
 * Compose the plan view from the engine's own records.
 *
 * Layering is Kahn's algorithm over the stored edges. A dependency that
 * names a node the run does not carry is ignored (the run is the truth),
 * and if anything remains unplaced — which a compiled DAG should make
 * impossible — the remainder becomes one honest final layer rather than
 * disappearing.
 */
export function composePlan(input: Readonly<{
  goal: string;
  nodes: readonly PlanNodeInput[];
  edges: readonly PlanEdgeInput[];
}>): ComposedPlan {
  const keys = input.nodes.map((node) => node.node_key);
  const keySet = new Set(keys);
  const inDegree = new Map<string, number>(keys.map((key) => [key, 0]));
  const dependents = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (!keySet.has(edge.from) || !keySet.has(edge.to)) continue;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    const list = dependents.get(edge.from) ?? [];
    list.push(edge.to);
    dependents.set(edge.from, list);
  }

  const layers: string[][] = [];
  const placed = new Set<string>();
  let frontier = keys.filter((key) => (inDegree.get(key) ?? 0) === 0);
  while (frontier.length > 0) {
    layers.push(frontier);
    for (const key of frontier) placed.add(key);
    for (const key of frontier) {
      for (const dependent of dependents.get(key) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1);
      }
    }
    frontier = keys.filter(
      (key) => !placed.has(key) && (inDegree.get(key) ?? 0) === 0,
    );
  }
  const unplaced = keys.filter((key) => !placed.has(key));
  if (unplaced.length > 0) layers.push(unplaced);

  const tasks: PlanTask[] = input.nodes.map((node) => ({
    key: node.node_key,
    specialist: specialistForNode(node),
    stage: node.lifecycle_stage ?? null,
    gated: node.gate_kind != null,
    state: node.state ?? null,
  }));

  const done = tasks.filter(
    (task) => task.state === "COMPLETED" || task.state === "SKIPPED",
  ).length;

  return {
    requirements: input.goal,
    layers,
    tasks,
    gatedTasks: tasks.filter((task) => task.gated).map((task) => task.key),
    maxParallelism: layers.reduce((widest, layer) => Math.max(widest, layer.length), 0),
    progressPercent: tasks.length === 0 ? null : Math.round((done / tasks.length) * 100),
  };
}

export type LaunchProposal = Readonly<{
  plan: ComposedPlan;
  templateName: string;
  /** What each step will do, verbatim from the template, keyed by node. */
  jobs: ReadonlyMap<string, string>;
}>;

/**
 * Compose the proposal shown BEFORE anything launches.
 *
 * It is built from the same template the launch route hands the compiler —
 * the identical nodes, jobs, gates and proposed edges — so approving the
 * proposal approves the plan the factory will actually compile. The compiler
 * still applies its own scrutiny after launch (a pruned edge is a success,
 * not a divergence), and the live run view shows the compiled truth. Null
 * when the template is not in this build, never a substitute plan.
 */
export function composeLaunchProposal(goal: string): LaunchProposal | null {
  const template = findTemplate("full_lifecycle");
  if (!template) return null;
  return {
    plan: composePlan({
      goal,
      nodes: template.nodes.map((node) => ({
        node_key: node.nodeId,
        capability: node.capability,
        lifecycle_stage: node.lifecycleStage ?? null,
        state: "PLANNED",
        gate_kind: node.gate ?? null,
      })),
      edges: template.proposedEdges.map((edge) => ({ from: edge.from, to: edge.to })),
    }),
    templateName: template.name,
    jobs: new Map(template.nodes.map((node) => [node.nodeId, node.job])),
  };
}

// ---------------------------------------------------------------------------
// Grok Bot: deterministic chief-of-staff planning
// ---------------------------------------------------------------------------

/**
 * Grok is the factory's chief-of-staff product, not a model provider. This
 * planner therefore names the two execution lanes that already exist:
 * Claude performs bounded read-only analysis and verification; Codex owns the
 * one isolated repository-writing task. Planning is pure and never calls
 * either provider, a database, GitHub, or a deployment service.
 */
export const GROK_PLAN_VERSION = 1 as const;
export const GROK_INTENT_KINDS = ["build", "fix", "research", "test", "deploy"] as const;
export type GrokIntentKind = (typeof GROK_INTENT_KINDS)[number];
export type GrokProvider = "anthropic" | "openai";
export type GrokAgentCapability = NodeCapability | "*";

export type GrokConfiguredAgent = Readonly<{
  id: string;
  name: string;
  provider: GrokProvider;
  model: string;
  /** `*` is an explicit generalist declaration, never an inferred capability. */
  capabilities: readonly GrokAgentCapability[];
  /** Strongest task tier this configured model is allowed to accept. */
  maxModelTier: Exclude<ModelTier, "NONE">;
  ready: boolean;
  /** Lower numbers win; agent id is the stable final tie-break. */
  priority?: number;
}>;

export type GrokProjectContext = Readonly<{
  projectId: string;
  name: string;
  repositoryFullName: string;
  defaultBranch: string;
  productionUrl?: string | null;
}>;

export type GrokPlannerInput = Readonly<{
  prompt: string;
  project: GrokProjectContext;
  agents: readonly GrokConfiguredAgent[];
  /** Optional explicit classification; it cannot lower policy-derived risk. */
  intent?: GrokIntentKind;
  requestedRisk?: RiskLevel;
}>;

export const GROK_PLANNER_ERROR_CODES = [
  "INVALID_INPUT",
  "SENSITIVE_DATA",
  "NO_CONFIGURED_AGENTS",
  "MISSING_CLAUDE_AGENT",
  "MISSING_CODEX_AGENT",
  "GRAPH_INVALID",
] as const;
export type GrokPlannerErrorCode = (typeof GROK_PLANNER_ERROR_CODES)[number];

export type GrokPlannerError = Readonly<{
  code: GrokPlannerErrorCode;
  message: string;
  details: readonly string[];
}>;

export type GrokAcceptanceCriterion = Readonly<{
  id: string;
  statement: string;
  verifiedBy: readonly string[];
}>;

export type GrokRequirement = Readonly<{
  id: string;
  source: "user" | "policy";
  statement: string;
}>;

export type GrokTask = Readonly<{
  id: string;
  title: string;
  job: string;
  lane: "claude_read_only" | "codex_workspace";
  executor: "MODEL";
  capability: NodeCapability;
  modelTier: Exclude<ModelTier, "NONE">;
  provider: GrokProvider;
  model: string;
  agentId: string;
  agentName: string;
  risk: RiskLevel;
  maxAttempts: number;
  timeoutMs: number;
  dependsOn: readonly string[];
  /** Verifier calls must start without implementation reasoning/history. */
  contextPolicy: "DEPENDENCY_ARTIFACTS_ONLY" | "FRESH_INDEPENDENT_VERIFIER";
  independentOf: readonly string[];
  gate: Readonly<{
    kind: "HUMAN";
    requiredRole: "owner";
    reason: string;
  }> | null;
  artifacts: Readonly<{
    consumes: readonly string[];
    produces: string;
    schemaVersion: 1;
  }>;
  contract: Readonly<{
    input: "GOAL" | "DEPENDENCY_ENVELOPE";
    outputArtifact: string;
    acceptsPartialInputs: false;
  }>;
}>;

export type GrokPlanBudget = Readonly<{
  maxNodes: number;
  maxConcurrentNodes: number;
  maxDurationMs: number;
  maxRetries: number;
  maxDiscoveryRounds: number;
}>;

/**
 * The exact JSON-safe payload accepted by `create_graph_from_plan`.
 *
 * This is rendered from the same compiler result exposed by `dag`; callers
 * must persist it directly and must never reconstruct a second graph from the
 * display-oriented task projection.
 */
export type GrokGraphLaunchPayload = Readonly<{
  goal: string;
  topology: GraphTopology;
  topologyReasons: readonly Readonly<{ code: string; detail: string }>[];
  riskLevel: "green" | "yellow" | "red";
  requiresOwnerApproval: boolean;
  nodes: readonly Readonly<{
    node_key: string;
    job: string;
    executor: string;
    capability: string;
    model_tier: string;
    risk_level: "green" | "yellow" | "red";
    timeout_ms: number;
    max_attempts: number;
    allow_provider_fallback: boolean;
    tolerates_partial_inputs: boolean;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    reads: readonly Readonly<{ kind: string; id: string }>[];
    writes: readonly Readonly<{ kind: string; id: string }>[];
    lifecycle_stage: null;
    gate_kind: "HUMAN" | null;
  }>[];
  edges: readonly Readonly<{
    from_node_key: string;
    to_node_key: string;
    reason: string;
    detail: string;
    is_feedback: false;
  }>[];
  budget: Readonly<{
    max_nodes: number;
    max_concurrent_nodes: number;
    max_duration_ms: number;
    max_retries: number;
    max_discovery_rounds: number;
  }>;
}>;

export type GrokChiefOfStaffPlan = Readonly<{
  planner: Readonly<{
    id: "grok-chief-of-staff";
    version: typeof GROK_PLAN_VERSION;
    deterministic: true;
    executionStarted: false;
  }>;
  intent: Readonly<{
    kind: GrokIntentKind;
    prompt: string;
    risk: RiskLevel;
  }>;
  project: GrokProjectContext;
  requirements: readonly GrokRequirement[];
  acceptanceCriteria: readonly GrokAcceptanceCriterion[];
  dag: Readonly<{
    topology: GraphTopology;
    topologyReasons: readonly Readonly<{ code: string; detail: string }>[];
    tasks: readonly GrokTask[];
    edges: readonly GraphEdge[];
    layers: readonly (readonly string[])[];
    maxParallelism: number;
    sequentialDepth: number;
  }>;
  budget: GrokPlanBudget;
  /** Durable graph input; compiled and serialized once by this planner. */
  graphLaunch: GrokGraphLaunchPayload;
  delivery: Readonly<{
    mode: "HANDOFF_ONLY";
    taskId: "delivery";
    ownerApprovalRequired: boolean;
    statement: string;
  }>;
  validation: Readonly<{
    compiler: "PASSED";
    removedEdgeCount: 0;
    unresolvedWriteConflictCount: 0;
  }>;
}>;

export type GrokPlannerResult =
  | Readonly<{ ok: true; plan: GrokChiefOfStaffPlan }>
  | Readonly<{ ok: false; error: GrokPlannerError }>;

const grokCapabilitySchema = z.union([z.enum(NODE_CAPABILITIES), z.literal("*")]);
const grokAgentSchema = z.object({
  id: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  name: z.string().trim().min(1).max(120),
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  capabilities: z.array(grokCapabilitySchema).min(1).max(NODE_CAPABILITIES.length + 1),
  maxModelTier: z.enum(MODEL_TIERS).refine(
    (value): value is Exclude<ModelTier, "NONE"> => value !== "NONE",
  ),
  ready: z.boolean(),
  priority: z.number().int().min(0).max(10_000).optional(),
}).strict();

const grokProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  repositoryFullName: z.string().trim().regex(
    /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
    "Use an owner/repository coordinate.",
  ),
  defaultBranch: z.string().trim().min(1).max(255).regex(/^(?!.*\.\.)(?!.*[~^:?*\[\\])[A-Za-z0-9_./-]+$/),
  productionUrl: z.string().url().refine((value) => value.startsWith("https://")).nullish(),
}).strict();

const grokPlannerInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  project: grokProjectSchema,
  agents: z.array(grokAgentSchema).max(64),
  intent: z.enum(GROK_INTENT_KINDS).optional(),
  requestedRisk: z.enum(["GREEN", "YELLOW", "RED"]).optional(),
}).strict();

type ParsedGrokInput = z.infer<typeof grokPlannerInputSchema>;
type ParsedGrokAgent = z.infer<typeof grokAgentSchema>;

type TaskBlueprint = Readonly<{
  id: string;
  title: string;
  job: string;
  provider: GrokProvider;
  capability: NodeCapability;
  modelTier: Exclude<ModelTier, "NONE">;
  dependsOn: readonly string[];
  outputArtifact: string;
  verifier?: boolean;
  delivery?: boolean;
}>;

const TIER_RANK: Readonly<Record<ModelTier, number>> = Object.freeze({
  NONE: 0,
  ECONOMY: 1,
  STANDARD: 2,
  STRONG: 3,
});

const implementationArtifactSchema = z.object({
  artifactType: z.string().min(1).max(120),
  summary: z.string().min(1).max(4_000),
  changedFiles: z.array(z.string().min(1).max(500)).max(500),
  tests: z.array(z.string().min(1).max(1_000)).max(100),
  residualRisks: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

const analysisArtifactSchema = z.object({
  artifactType: z.string().min(1).max(120),
  summary: z.string().min(1).max(4_000),
  findings: z.array(z.object({
    title: z.string().min(1).max(400),
    evidence: z.string().min(1).max(2_000),
  }).strict()).max(100),
  recommendations: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

const verificationArtifactSchema = z.object({
  artifactType: z.string().min(1).max(120),
  verdict: z.enum(["PASS", "FAIL", "BLOCKED"]),
  evidence: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  findings: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

function failure(
  code: GrokPlannerErrorCode,
  message: string,
  details: readonly string[] = [],
): GrokPlannerResult {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, details: Object.freeze([...details]) }),
  });
}

/** Deterministic intent classification; callers may supply an explicit kind. */
export function classifyGrokIntent(prompt: string): GrokIntentKind {
  const normalized = prompt.trim().toLowerCase();
  if (/^(deploy|release|ship|promote|publish)\b/.test(normalized)) return "deploy";
  if (/^(fix|repair|debug|resolve|hotfix|correct)\b/.test(normalized)) return "fix";
  if (/^(test|verify|validate|cover)\b/.test(normalized)) return "test";
  if (/^(research|audit|investigate|analyze|analyse|review|assess|explore)\b/.test(normalized)) return "research";
  if (/^(build|create|add|implement|develop|update|change|make)\b/.test(normalized)) return "build";
  if (/\b(deploy|release|production rollout)\b/.test(normalized)) return "deploy";
  if (/\b(bug|broken|failure|regression|error)\b/.test(normalized)) return "fix";
  if (/\b(test|coverage|assertion)\b/.test(normalized)) return "test";
  if (/\b(research|audit|investigate|analysis)\b/.test(normalized)) return "research";
  return "build";
}

function planRisk(input: ParsedGrokInput, kind: GrokIntentKind): RiskLevel {
  const requested = input.requestedRisk ?? (
    kind === "deploy" ? "RED" : kind === "build" || kind === "fix" ? "YELLOW" : "GREEN"
  );
  const sensitiveBoundary = /\b(auth|authorization|permission|rls|migration|schema|billing|payment|secret|credential|dns|infrastructure)\b/i
    .test(input.prompt);
  if (kind === "deploy" || sensitiveBoundary || requested === "RED") return "RED";
  if (requested === "YELLOW" || kind === "build" || kind === "fix") return "YELLOW";
  return "GREEN";
}

function blueprintsFor(kind: GrokIntentKind): readonly TaskBlueprint[] {
  const verification = (subject: string): readonly TaskBlueprint[] => [
    {
      id: "verify_correctness",
      title: "Correctness review",
      job: "Review only the produced artifact and repository evidence for correctness. Return a bounded PASS, FAIL, or BLOCKED verdict with cited evidence; never reuse implementation reasoning.",
      provider: "anthropic",
      capability: "review",
      modelTier: "STRONG",
      dependsOn: [subject],
      outputArtifact: "correctness_verdict",
      verifier: true,
    },
    {
      id: "verify_security",
      title: "Security review",
      job: "Review only the produced artifact and repository evidence for authorization, tenancy, secret handling, injection, and unsafe mutations. Return a bounded verdict with evidence.",
      provider: "anthropic",
      capability: "security_review",
      modelTier: "STRONG",
      dependsOn: [subject],
      outputArtifact: "security_verdict",
      verifier: true,
    },
    {
      id: "verify_tests",
      title: "Test evidence review",
      job: "Independently evaluate whether the produced artifact meets the acceptance criteria and carries sufficient test evidence. Return a bounded verdict with evidence.",
      provider: "anthropic",
      capability: "qa",
      modelTier: "STANDARD",
      dependsOn: [subject],
      outputArtifact: "test_verdict",
      verifier: true,
    },
    {
      id: "verification_fan_in",
      title: "Verification fan-in",
      job: "Synthesize the three independent verifier artifacts. A FAIL or BLOCKED verdict must remain visible; never turn missing evidence into PASS.",
      provider: "anthropic",
      capability: "synthesis",
      modelTier: "STRONG",
      dependsOn: ["verify_correctness", "verify_security", "verify_tests"],
      outputArtifact: "verification_decision",
      verifier: true,
    },
  ];
  const delivery = (subject: string): TaskBlueprint => ({
    id: "delivery",
    title: "Delivery handoff",
    job: "Produce the exact delivery handoff package from verified artifacts. This task records readiness only; it must not claim that a merge, deployment, or production change occurred.",
    provider: "anthropic",
    capability: "reporting",
    modelTier: "STANDARD",
    dependsOn: [subject],
    outputArtifact: "delivery_handoff",
    delivery: true,
  });

  if (kind === "research") {
    const subject = "synthesize_research";
    return Object.freeze([
      {
        id: "research_repository", title: "Repository research",
        job: "Inspect the current repository for existing implementations, constraints, and reusable patterns. Return evidence-backed findings only.",
        provider: "anthropic", capability: "discovery", modelTier: "STANDARD",
        dependsOn: [], outputArtifact: "repository_research",
      },
      {
        id: "research_requirements", title: "Requirements research",
        job: "Turn the bounded goal into explicit questions, constraints, and evidence needs without inventing product decisions.",
        provider: "anthropic", capability: "planning", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "requirements_research",
      },
      {
        id: "research_security", title: "Security research",
        job: "Inspect the goal and repository for security, tenancy, privacy, and irreversible-change constraints before recommendations are made.",
        provider: "anthropic", capability: "security_review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "security_research",
      },
      {
        id: subject, title: "Research synthesis",
        job: "Synthesize the independent research artifacts, preserving citations, disagreements, uncertainty, and missing evidence.",
        provider: "anthropic", capability: "synthesis", modelTier: "STRONG",
        dependsOn: ["research_repository", "research_requirements", "research_security"],
        outputArtifact: "research_report",
      },
      ...verification(subject),
      delivery("verification_fan_in"),
    ]);
  }

  if (kind === "deploy") {
    return Object.freeze([
      {
        id: "inspect_release", title: "Release identity inspection",
        job: "Inspect the exact repository, branch, commit, and existing release evidence. Do not create or mutate a release.",
        provider: "anthropic", capability: "review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "release_identity",
        verifier: true,
      },
      {
        id: "verify_release_tests", title: "Release test inspection",
        job: "Inspect exact-head required-check and test evidence without rerunning or inventing a result.",
        provider: "anthropic", capability: "qa", modelTier: "STANDARD",
        dependsOn: [], outputArtifact: "release_test_evidence",
        verifier: true,
      },
      {
        id: "review_release_security", title: "Release security inspection",
        job: "Inspect the release evidence for protected-path, secret, migration, and security-policy risk.",
        provider: "anthropic", capability: "security_review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "release_security_evidence",
        verifier: true,
      },
      {
        id: "verification_fan_in", title: "Release readiness fan-in",
        job: "Synthesize exact release identity, tests, and security evidence. Missing or conflicting evidence must block readiness.",
        provider: "anthropic", capability: "synthesis", modelTier: "STRONG",
        dependsOn: ["inspect_release", "verify_release_tests", "review_release_security"],
        outputArtifact: "release_readiness",
        verifier: true,
      },
      delivery("verification_fan_in"),
    ]);
  }

  const rootByKind: Readonly<Record<Exclude<GrokIntentKind, "research" | "deploy">, readonly TaskBlueprint[]>> = {
    build: [
      {
        id: "research_repository", title: "Repository research",
        job: "Inspect the repository for reusable components, conventions, and constraints before any code is changed.",
        provider: "anthropic", capability: "discovery", modelTier: "STANDARD",
        dependsOn: [], outputArtifact: "repository_research",
      },
      {
        id: "research_requirements", title: "Requirements analysis",
        job: "Turn the goal into bounded functional requirements and testable acceptance needs without changing its meaning.",
        provider: "anthropic", capability: "planning", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "requirements_analysis",
      },
      {
        id: "research_risk", title: "Risk analysis",
        job: "Identify security, tenancy, data, release, and irreversible-change risks before architecture and implementation.",
        provider: "anthropic", capability: "security_review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "risk_analysis",
      },
    ],
    fix: [
      {
        id: "reproduce_issue", title: "Failure analysis",
        job: "Establish the observable failure and a bounded reproduction from repository evidence; do not guess a root cause.",
        provider: "anthropic", capability: "qa", modelTier: "STANDARD",
        dependsOn: [], outputArtifact: "failure_reproduction",
      },
      {
        id: "inspect_root_cause", title: "Root-cause inspection",
        job: "Inspect the affected code paths and identify evidence-backed root-cause candidates and blast radius.",
        provider: "anthropic", capability: "review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "root_cause_analysis",
      },
      {
        id: "inspect_security_impact", title: "Security impact inspection",
        job: "Determine whether the failure crosses authorization, tenancy, secret, or data-integrity boundaries.",
        provider: "anthropic", capability: "security_review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "security_impact",
      },
    ],
    test: [
      {
        id: "inspect_behavior", title: "Behavior inspection",
        job: "Inspect the behavior that must be proved and identify observable acceptance boundaries.",
        provider: "anthropic", capability: "review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "behavior_contract",
      },
      {
        id: "inspect_test_surface", title: "Test-surface inspection",
        job: "Inspect existing tests, harnesses, and gaps; preserve exact commands and failure evidence.",
        provider: "anthropic", capability: "qa", modelTier: "STANDARD",
        dependsOn: [], outputArtifact: "test_surface",
      },
      {
        id: "inspect_security_invariants", title: "Security invariant inspection",
        job: "Identify security and tenancy invariants the requested tests must not weaken or omit.",
        provider: "anthropic", capability: "security_review", modelTier: "STRONG",
        dependsOn: [], outputArtifact: "security_invariants",
      },
    ],
  };
  const roots = rootByKind[kind];
  const designId = kind === "fix" ? "fix_plan" : kind === "test" ? "test_plan" : "architecture";
  const writeId = kind === "fix" ? "fix" : kind === "test" ? "implement_tests" : "implement";
  return Object.freeze([
    ...roots,
    {
      id: designId,
      title: kind === "fix" ? "Fix design" : kind === "test" ? "Test design" : "Architecture",
      job: "Synthesize the independent pre-work artifacts into one dependency-safe design. Name boundaries and acceptance evidence; do not edit the repository.",
      provider: "anthropic", capability: "architecture", modelTier: "STRONG",
      dependsOn: roots.map((task) => task.id), outputArtifact: `${designId}_artifact`,
    },
    {
      id: writeId,
      title: kind === "fix" ? "Implement fix" : kind === "test" ? "Implement tests" : "Implement change",
      job: "Execute the approved design in one isolated Codex workspace. Change only the bound repository, add focused tests, run deterministic validation, and return changed-file and test evidence.",
      provider: "openai", capability: "implementation", modelTier: "STANDARD",
      dependsOn: [designId], outputArtifact: `${writeId}_result`,
    },
    ...verification(writeId),
    delivery("verification_fan_in"),
  ]);
}

function selectAgent(
  agents: readonly ParsedGrokAgent[],
  task: TaskBlueprint,
): ParsedGrokAgent | null {
  const candidates = agents.filter((agent) =>
    agent.ready
    && agent.provider === task.provider
    && TIER_RANK[agent.maxModelTier] >= TIER_RANK[task.modelTier]
    && (agent.capabilities.includes(task.capability) || agent.capabilities.includes("*")),
  );
  candidates.sort((left, right) => {
    const leftExact = left.capabilities.includes(task.capability) ? 0 : 1;
    const rightExact = right.capabilities.includes(task.capability) ? 0 : 1;
    return leftExact - rightExact
      || (left.priority ?? 100) - (right.priority ?? 100)
      || left.id.localeCompare(right.id);
  });
  return candidates[0] ?? null;
}

function outputSchemaFor(task: TaskBlueprint) {
  const artifactType = z.literal(task.outputArtifact);
  if (task.verifier) return verificationArtifactSchema.safeExtend({ artifactType });
  if (task.provider === "openai") {
    return implementationArtifactSchema.safeExtend({ artifactType });
  }
  return analysisArtifactSchema.safeExtend({ artifactType });
}

function nodeContractsFor(
  tasks: readonly TaskBlueprint[],
  selected: ReadonlyMap<string, ParsedGrokAgent>,
  risk: RiskLevel,
  repositoryFullName: string,
): readonly NodeContract[] {
  const outputs = new Map(tasks.map((task) => [task.id, outputSchemaFor(task)] as const));
  return tasks.map((task) => defineNode({
    nodeId: task.id,
    job: task.job,
    executor: "MODEL",
    capability: task.capability,
    modelTier: task.modelTier,
    inputSchema: task.dependsOn.length === 0
      ? z.string().trim().min(1).max(4_000)
      : z.object({
          outputs: z.object(Object.fromEntries(
            task.dependsOn.map((dependency) => [dependency, outputs.get(dependency) ?? z.never()]),
          )).strict(),
          missing: z.array(z.never()).max(0),
        }).strict(),
    outputSchema: outputs.get(task.id) ?? z.never(),
    dependsOn: Object.freeze([...task.dependsOn]),
    // The read lane observes an immutable checkout; the Codex lane writes only
    // its isolated workspace. Distinct resource identities prevent the
    // compiler from inventing a read-after-write cycle from future work back
    // into the research that justified it.
    reads: Object.freeze([{
      kind: "directory" as const,
      id: task.provider === "openai"
        ? `${repositoryFullName}:codex-workspace`
        : `${repositoryFullName}:read-only-snapshot`,
    }]),
    writes: task.provider === "openai"
      ? Object.freeze([{ kind: "directory" as const, id: `${repositoryFullName}:codex-workspace` }])
      : Object.freeze([]),
    risk: task.delivery && risk === "RED" ? "RED" : task.provider === "openai" ? risk : "GREEN",
    timeoutMs: task.provider === "openai" ? 3_600_000 : 480_000,
    retry: Object.freeze({
      maxAttempts: task.delivery || task.id === "verification_fan_in" ? 1 : 2,
      backoffMs: task.provider === "openai" ? 5_000 : 2_000,
      // The selected provider/model is part of the immutable plan identity.
      allowProviderFallback: false,
    }),
    // Every fan-in is strict: missing evidence must block rather than vanish.
    toleratesPartialInputs: false,
    // Referencing selection here makes omission a construction error even
    // though provider identity lives in the serializable task projection.
    maxConcurrency: selected.has(task.id) ? 1 : 0,
  }));
}

function layersFor(tasks: readonly TaskBlueprint[], edges: readonly GraphEdge[]) {
  const inDegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, [] as string[]]));
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const layers: string[][] = [];
  let frontier = tasks.filter((task) => inDegree.get(task.id) === 0).map((task) => task.id);
  let placed = 0;
  while (frontier.length > 0) {
    layers.push(frontier);
    placed += frontier.length;
    const next: string[] = [];
    for (const current of frontier) {
      for (const dependent of outgoing.get(current) ?? []) {
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    frontier = next;
  }
  return placed === tasks.length ? Object.freeze(layers.map((layer) => Object.freeze(layer))) : null;
}

function criteriaFor(kind: GrokIntentKind): readonly GrokAcceptanceCriterion[] {
  const specific: Readonly<Record<GrokIntentKind, GrokAcceptanceCriterion>> = {
    build: { id: "requested_behavior", statement: "The requested behavior is implemented in the bound repository and demonstrated by focused tests.", verifiedBy: ["verify_correctness", "verify_tests"] },
    fix: { id: "regression_closed", statement: "The reported failure no longer reproduces and a regression test proves the corrected behavior.", verifiedBy: ["verify_correctness", "verify_tests"] },
    research: { id: "evidence_grounded", statement: "Findings preserve sources, uncertainty, disagreements, and missing evidence without invented conclusions.", verifiedBy: ["verify_correctness", "verify_tests"] },
    test: { id: "coverage_added", statement: "The requested behavior is covered by focused tests that would fail against the broken or absent behavior.", verifiedBy: ["verify_correctness", "verify_tests"] },
    deploy: { id: "exact_release", statement: "Exact commit and required CI evidence agree before the owner may approve the delivery handoff; deployment and production health remain unobserved until a downstream release adapter records them.", verifiedBy: ["inspect_release", "verify_release_tests", "delivery"] },
  };
  return Object.freeze([
    Object.freeze({ ...specific[kind], verifiedBy: Object.freeze([...specific[kind].verifiedBy]) }),
    Object.freeze({
      id: "security_preserved",
      statement: "Authorization, tenancy, secret handling, and irreversible-change controls are not weakened.",
      verifiedBy: Object.freeze(kind === "deploy" ? ["review_release_security"] : ["verify_security"]),
    }),
    Object.freeze({
      id: "delivery_truthful",
      statement: "Delivery reports only durable evidence and never claims an unobserved merge, deployment, or production result.",
      verifiedBy: Object.freeze(["delivery"]),
    }),
  ]);
}

/**
 * Build one immutable, compiler-validated Grok chief-of-staff plan.
 *
 * The result contains routing intent only. `executionStarted` is permanently
 * false, and the delivery node is explicitly a handoff package rather than an
 * assertion that any external mutation occurred.
 */
export function buildGrokChiefOfStaffPlan(input: unknown): GrokPlannerResult {
  const sensitive = findSensitiveData(input);
  if (sensitive) {
    return failure(
      "SENSITIVE_DATA",
      "The planning request contains credential-shaped data. Remove secrets and submit references only.",
      [sensitive.reason],
    );
  }

  const parsed = grokPlannerInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "INVALID_INPUT",
      "The Grok planning request is invalid.",
      parsed.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`),
    );
  }
  const value = parsed.data;
  const ready = value.agents.filter((agent) => agent.ready);
  if (ready.length === 0) {
    return failure(
      "NO_CONFIGURED_AGENTS",
      "At least one ready configured Claude or Codex agent is required.",
    );
  }

  const kind = value.intent ?? classifyGrokIntent(value.prompt);
  const risk = planRisk(value, kind);
  const blueprints = blueprintsFor(kind);
  const selected = new Map<string, ParsedGrokAgent>();
  const missingClaude = new Set<string>();
  const missingCodex = new Set<string>();
  for (const task of blueprints) {
    const agent = selectAgent(ready, task);
    if (agent) selected.set(task.id, agent);
    else (task.provider === "anthropic" ? missingClaude : missingCodex)
      .add(`${task.capability}/${task.modelTier}`);
  }
  if (missingClaude.size > 0) {
    return failure(
      "MISSING_CLAUDE_AGENT",
      "No ready configured Claude agent can cover every required read-only planning and verification task.",
      [...missingClaude].sort(),
    );
  }
  if (missingCodex.size > 0) {
    return failure(
      "MISSING_CODEX_AGENT",
      "No ready configured Codex agent can cover the repository-writing task.",
      [...missingCodex].sort(),
    );
  }

  const contracts = nodeContractsFor(blueprints, selected, risk, value.project.repositoryFullName);
  const proposedEdges: readonly ProposedEdge[] = Object.freeze(blueprints.flatMap((task) =>
    task.dependsOn.map((dependency) => Object.freeze({
      from: dependency,
      to: task.id,
      reason: (task.verifier ? "VERIFICATION" : "DATA") as GraphEdge["reason"],
      detail: `${task.id} consumes the immutable ${dependency} artifact.`,
    })),
  ));
  const compiled = compileGraph({
    goal: value.prompt,
    nodes: contracts,
    proposedEdges,
    risk,
  });
  if (!compiled.ok) {
    return failure(
      "GRAPH_INVALID",
      "The deterministic Grok task graph failed the production compiler.",
      compiled.errors.map((error) => `${error.code}: ${error.detail}`),
    );
  }
  if (compiled.graph.removedEdges.length > 0 || compiled.graph.writeConflicts.length > 0) {
    return failure(
      "GRAPH_INVALID",
      "The deterministic Grok task graph contains an unjustified dependency or unresolved write conflict.",
      [
        ...compiled.graph.removedEdges.map((edge) => `${edge.from}->${edge.to}: ${edge.why}`),
        ...compiled.graph.writeConflicts.map((conflict) => `${conflict.nodes.join("/")}: ${conflict.resource.kind}:${conflict.resource.id}`),
      ],
    );
  }
  const layers = layersFor(blueprints, compiled.graph.edges);
  if (!layers) {
    return failure("GRAPH_INVALID", "The deterministic Grok task graph is not acyclic.");
  }

  const taskById = new Map(contracts.map((contract) => [contract.nodeId, contract]));
  const tasks: readonly GrokTask[] = Object.freeze(blueprints.map((task) => {
    const agent = selected.get(task.id)!;
    const contract = taskById.get(task.id)!;
    const isVerifier = task.verifier === true;
    const ownerGate = task.delivery && risk === "RED"
      ? Object.freeze({
          kind: "HUMAN" as const,
          requiredRole: "owner" as const,
          reason: "RED delivery requires the owner to approve exact immutable evidence before any external action.",
        })
      : null;
    return Object.freeze({
      id: task.id,
      title: task.title,
      job: task.job,
      lane: task.provider === "openai" ? "codex_workspace" as const : "claude_read_only" as const,
      executor: "MODEL" as const,
      capability: task.capability,
      modelTier: task.modelTier,
      provider: task.provider,
      model: agent.model,
      agentId: agent.id,
      agentName: agent.name,
      risk: contract.risk,
      maxAttempts: contract.retry.maxAttempts,
      timeoutMs: contract.timeoutMs,
      dependsOn: Object.freeze([...task.dependsOn]),
      contextPolicy: isVerifier
        ? "FRESH_INDEPENDENT_VERIFIER" as const
        : "DEPENDENCY_ARTIFACTS_ONLY" as const,
      independentOf: Object.freeze(isVerifier
        ? task.dependsOn.filter((dependency) =>
            blueprints.find((candidate) => candidate.id === dependency)?.provider === "openai",
          )
        : []),
      gate: ownerGate,
      artifacts: Object.freeze({
        consumes: Object.freeze(task.dependsOn.map((dependency) => `${dependency}.v1`)),
        produces: `${task.id}.v1`,
        schemaVersion: 1 as const,
      }),
      contract: Object.freeze({
        input: task.dependsOn.length === 0 ? "GOAL" as const : "DEPENDENCY_ENVELOPE" as const,
        outputArtifact: task.outputArtifact,
        acceptsPartialInputs: false as const,
      }),
    });
  }));

  const maxRetries = tasks.reduce((sum, task) => sum + Math.max(0, task.maxAttempts - 1), 0);
  const modelMinutes = kind === "deploy" ? 90 : kind === "research" ? 120 : 180;
  const budget: GrokPlanBudget = Object.freeze({
    maxNodes: tasks.length,
    maxConcurrentNodes: Math.min(3, Math.max(1, compiled.graph.maxParallelism)),
    maxDurationMs: modelMinutes * 60_000,
    maxRetries,
    maxDiscoveryRounds: kind === "research" || kind === "build" ? 1 : 0,
  });
  let graphLaunch: GrokGraphLaunchPayload;
  try {
    graphLaunch = Object.freeze({
      goal: compiled.graph.goal,
      topology: compiled.graph.topology,
      topologyReasons: Object.freeze(compiled.graph.topologyReasons.map((reason) =>
        Object.freeze({ code: reason.code, detail: reason.detail }),
      )),
      riskLevel: compiled.graph.risk.toLowerCase() as "green" | "yellow" | "red",
      requiresOwnerApproval: compiled.graph.requiresOwnerApproval,
      nodes: Object.freeze(compiled.graph.nodes.map((node) => {
        if (!node.inputSchema || !node.outputSchema) {
          throw new Error(`Node ${node.nodeKey} lost its input or output contract.`);
        }
        const blueprint = blueprints.find((candidate) => candidate.id === node.nodeKey);
        return Object.freeze({
          node_key: node.nodeKey,
          job: node.job,
          executor: node.executor,
          capability: node.capability,
          model_tier: node.modelTier,
          risk_level: node.risk.toLowerCase() as "green" | "yellow" | "red",
          timeout_ms: node.timeoutMs,
          max_attempts: node.maxAttempts,
          allow_provider_fallback: node.allowProviderFallback,
          tolerates_partial_inputs: node.toleratesPartialInputs,
          input_schema: storeZodSchema(node.inputSchema),
          output_schema: storeZodSchema(node.outputSchema),
          reads: Object.freeze(node.reads.map((resource) => Object.freeze({ ...resource }))),
          writes: Object.freeze(node.writes.map((resource) => Object.freeze({ ...resource }))),
          lifecycle_stage: null,
          gate_kind: blueprint?.delivery === true && risk === "RED" ? "HUMAN" as const : null,
        });
      })),
      edges: Object.freeze(compiled.graph.edges.map((edge) => Object.freeze({
        from_node_key: edge.from,
        to_node_key: edge.to,
        reason: edge.reason,
        detail: edge.detail,
        is_feedback: false as const,
      }))),
      budget: Object.freeze({
        max_nodes: budget.maxNodes,
        max_concurrent_nodes: budget.maxConcurrentNodes,
        max_duration_ms: budget.maxDurationMs,
        max_retries: budget.maxRetries,
        max_discovery_rounds: budget.maxDiscoveryRounds,
      }),
    });
  } catch (error) {
    return failure(
      "GRAPH_INVALID",
      "The deterministic Grok graph contracts could not be serialized for durable execution.",
      [error instanceof Error ? error.message : String(error)],
    );
  }
  const requirements: readonly GrokRequirement[] = Object.freeze([
    Object.freeze({ id: "requested_outcome", source: "user" as const, statement: value.prompt }),
    Object.freeze({
      id: "bound_project",
      source: "policy" as const,
      statement: `All repository evidence and changes are confined to ${value.project.repositoryFullName}@${value.project.defaultBranch}.`,
    }),
    Object.freeze({
      id: "verified_delivery",
      source: "policy" as const,
      statement: "Only compiler-valid dependency artifacts and independent verification may reach delivery.",
    }),
  ]);

  const plan: GrokChiefOfStaffPlan = Object.freeze({
    planner: Object.freeze({
      id: "grok-chief-of-staff" as const,
      version: GROK_PLAN_VERSION,
      deterministic: true as const,
      executionStarted: false as const,
    }),
    intent: Object.freeze({ kind, prompt: value.prompt, risk }),
    project: Object.freeze({ ...value.project }),
    requirements,
    acceptanceCriteria: criteriaFor(kind),
    dag: Object.freeze({
      topology: compiled.graph.topology,
      topologyReasons: Object.freeze(compiled.graph.topologyReasons.map((reason) => Object.freeze({ ...reason }))),
      tasks,
      edges: Object.freeze(compiled.graph.edges.map((edge) => Object.freeze({ ...edge }))),
      layers,
      maxParallelism: compiled.graph.maxParallelism,
      sequentialDepth: compiled.graph.sequentialDepth,
    }),
    budget,
    graphLaunch,
    delivery: Object.freeze({
      mode: "HANDOFF_ONLY" as const,
      taskId: "delivery" as const,
      ownerApprovalRequired: risk === "RED",
      statement: "This plan ends with a delivery handoff. It does not merge, deploy, or claim production health.",
    }),
    validation: Object.freeze({
      compiler: "PASSED" as const,
      removedEdgeCount: 0 as const,
      unresolvedWriteConflictCount: 0 as const,
    }),
  });
  return Object.freeze({ ok: true as const, plan });
}
