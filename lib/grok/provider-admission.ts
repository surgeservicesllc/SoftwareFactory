import { createHash } from "node:crypto";

import type {
  GrokChiefOfStaffPlan,
  GrokSpecialistAdmission,
} from "@/lib/factory/chief-of-staff";

export const GROK_PROVIDER_ADMISSION_VERSION = 2 as const;

export const GROK_DEPLOY_READINESS_BRIDGE = "grok_deploy_readiness_v1" as const;
export const GROK_DEPLOY_READINESS_GOAL =
  "Inspect immutable release evidence for the saved RED deploy intent. Do not merge, deploy, mutate resources, wake workers, or claim production." as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const MODEL_TIER_RANK = Object.freeze({ ECONOMY: 1, STANDARD: 2, STRONG: 3 });

const DEPLOY_TASKS = Object.freeze({
  inspect_release: Object.freeze({
    title: "Release identity inspection",
    job: "Inspect the exact repository, branch, commit, and existing release evidence. Do not create or mutate a release.",
    capability: "review",
    modelTier: "STRONG",
    dependsOn: Object.freeze([]),
    outputArtifact: "release_identity",
    maxAttempts: 2,
    contextPolicy: "FRESH_INDEPENDENT_VERIFIER",
    schemaSha256: "5ece384cdb3b7d7e0ec352070e6355f96744a3e41a7f836a4ae01cc40c98ba58",
  }),
  verify_release_tests: Object.freeze({
    title: "Release test inspection",
    job: "Inspect exact-head required-check and test evidence without rerunning or inventing a result.",
    capability: "qa",
    modelTier: "STANDARD",
    dependsOn: Object.freeze([]),
    outputArtifact: "release_test_evidence",
    maxAttempts: 2,
    contextPolicy: "FRESH_INDEPENDENT_VERIFIER",
    schemaSha256: "32637df4c394882ac3c3ff80583d9b6cb111cbcf21dae38e657f7767b82d230e",
  }),
  review_release_security: Object.freeze({
    title: "Release security inspection",
    job: "Inspect the release evidence for protected-path, secret, migration, and security-policy risk.",
    capability: "security_review",
    modelTier: "STRONG",
    dependsOn: Object.freeze([]),
    outputArtifact: "release_security_evidence",
    maxAttempts: 2,
    contextPolicy: "FRESH_INDEPENDENT_VERIFIER",
    schemaSha256: "9d44f923bc40cfc75e0976b761d0e0cdbc53af6e309b813ff6d99ca56ba5c256",
  }),
  verification_fan_in: Object.freeze({
    title: "Release readiness fan-in",
    job: "Synthesize exact release identity, tests, and security evidence. Missing or conflicting evidence must block readiness.",
    capability: "synthesis",
    modelTier: "STRONG",
    dependsOn: Object.freeze(["inspect_release", "verify_release_tests", "review_release_security"]),
    outputArtifact: "release_readiness",
    maxAttempts: 1,
    contextPolicy: "FRESH_INDEPENDENT_VERIFIER",
    schemaSha256: "5f20c10bc311535984e21319db86346de9cdf45b0742b4e65cf96242edbea81d",
  }),
  delivery: Object.freeze({
    title: "Delivery handoff",
    job: "Produce the exact delivery handoff package from verified artifacts. This task records readiness only; it must not claim that a merge, deployment, or production change occurred.",
    capability: "reporting",
    modelTier: "STANDARD",
    dependsOn: Object.freeze(["verification_fan_in"]),
    outputArtifact: "delivery_handoff",
    maxAttempts: 1,
    contextPolicy: "DEPENDENCY_ARTIFACTS_ONLY",
    schemaSha256: "44b6903fd05015926c8f94a4e7702ab20e5e963d9c5a6ab51f36da78ec67d730",
  }),
} as const);

const DEPLOY_TASK_KEYS = Object.freeze(Object.keys(DEPLOY_TASKS));
const DEPLOY_READINESS_TASK_KEYS = Object.freeze(DEPLOY_TASK_KEYS.filter((key) => key !== "delivery"));

export type GrokCanonicalAdmissionNode = Readonly<{
  node_key: string;
  executor: string;
  capability: string;
  model_tier?: string | null;
}>;

export type GrokDeployReadinessProjection = GrokChiefOfStaffPlan["graphLaunch"];

export type GrokProviderAdmissionInput = Readonly<{
  version: typeof GROK_PROVIDER_ADMISSION_VERSION;
  lane: "graph_model" | "phase1c";
  nodeKey: string;
  sourceRosterAssignmentId: string;
  assignmentId: string;
  assignmentRevision: number;
  botId: string;
  botRevision: number;
  aiAccountId: string;
  accountUpdatedAt: string;
  roleId: string;
  roleUpdatedAt: string;
  agentCapabilities: readonly string[];
  provider: "anthropic" | "openai";
  model: string;
  credentialPurpose: string;
  credentialRef: string;
  providerIdentity: string | null;
  capability: string;
  agentMaxModelTier: "ECONOMY" | "STANDARD" | "STRONG";
}>;

export class GrokProviderAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokProviderAdmissionError";
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nodeSchemaSha256(node: GrokChiefOfStaffPlan["graphLaunch"]["nodes"][number]): string {
  return createHash("sha256").update(JSON.stringify({
    input_schema: node.input_schema,
    output_schema: node.output_schema,
  })).digest("hex");
}

/**
 * Derive the only executable subset of a RED deploy plan.
 *
 * The immutable planner message keeps the original RED deploy intent and its
 * owner-gated delivery handoff. This projection deliberately excludes that
 * handoff and removes even read-resource declarations from the four Claude
 * inspection nodes. The database repeats this derivation from the immutable
 * message before it writes a paused graph.
 */
export function buildGrokDeployReadinessProjection(
  plan: GrokChiefOfStaffPlan,
): GrokDeployReadinessProjection {
  if (plan.planner.version !== 3 || !Array.isArray(plan.admissionRoster)) {
    throw new GrokProviderAdmissionError(
      "This deploy goal uses a legacy plan without an immutable specialist admission roster. Re-plan it before readiness inspection.",
    );
  }
  if (
    plan.intent.kind !== "deploy"
    || plan.intent.risk !== "RED"
    || plan.graphLaunch.goal !== plan.intent.prompt
    || plan.graphLaunch.topology !== "DAG"
    || plan.graphLaunch.riskLevel !== "red"
    || plan.graphLaunch.requiresOwnerApproval !== true
    || plan.delivery.mode !== "HANDOFF_ONLY"
    || plan.delivery.taskId !== "delivery"
    || plan.delivery.ownerApprovalRequired !== true
  ) {
    throw new GrokProviderAdmissionError(
      "Deploy readiness requires the exact immutable RED deploy plan and owner-gated delivery handoff.",
    );
  }
  if (
    !sameStrings(plan.dag.tasks.map((task) => task.id), DEPLOY_TASK_KEYS)
    || !sameStrings(plan.graphLaunch.nodes.map((node) => node.node_key), DEPLOY_TASK_KEYS)
  ) {
    throw new GrokProviderAdmissionError(
      "The deploy plan does not match the exact deterministic release-readiness task set.",
    );
  }

  const readOnlySnapshot = `${plan.project.repositoryFullName}:read-only-snapshot`;
  for (const key of DEPLOY_TASK_KEYS) {
    const expected = DEPLOY_TASKS[key as keyof typeof DEPLOY_TASKS];
    const task = plan.dag.tasks.find((candidate) => candidate.id === key);
    const node = plan.graphLaunch.nodes.find((candidate) => candidate.node_key === key);
    const delivery = key === "delivery";
    if (
      !task
      || !node
      || task.title !== expected.title
      || task.job !== expected.job
      || task.executor !== "MODEL"
      || task.lane !== "claude_read_only"
      || task.provider !== "anthropic"
      || task.capability !== expected.capability
      || task.modelTier !== expected.modelTier
      || !sameStrings(task.dependsOn, expected.dependsOn)
      || task.maxAttempts !== expected.maxAttempts
      || task.timeoutMs !== 480_000
      || task.contextPolicy !== expected.contextPolicy
      || task.independentOf.length !== 0
      || !sameStrings(task.artifacts.consumes, expected.dependsOn.map((dependency) => `${dependency}.v1`))
      || task.artifacts.produces !== `${key}.v1`
      || task.artifacts.schemaVersion !== 1
      || task.contract.input !== (expected.dependsOn.length === 0 ? "GOAL" : "DEPENDENCY_ENVELOPE")
      || task.contract.outputArtifact !== expected.outputArtifact
      || task.contract.acceptsPartialInputs !== false
      || task.risk !== (delivery ? "RED" : "GREEN")
      || (delivery
        ? task.gate?.kind !== "HUMAN" || task.gate.requiredRole !== "owner"
        : task.gate !== null)
      || node.executor !== "MODEL"
      || node.job !== expected.job
      || node.capability !== expected.capability
      || node.model_tier !== expected.modelTier
      || node.risk_level !== (delivery ? "red" : "green")
      || node.timeout_ms !== 480_000
      || node.max_attempts !== expected.maxAttempts
      || nodeSchemaSha256(node) !== expected.schemaSha256
      || node.allow_provider_fallback !== false
      || node.tolerates_partial_inputs !== false
      || node.lifecycle_stage !== null
      || node.gate_kind !== (delivery ? "HUMAN" : null)
      || node.writes.length !== 0
      || node.reads.length !== 1
      || node.reads[0]?.kind !== "directory"
      || node.reads[0]?.id !== readOnlySnapshot
    ) {
      throw new GrokProviderAdmissionError(
        `Deploy task ${key} is not the exact non-mutating planner contract.`,
      );
    }
  }

  const expectedEdges = Object.freeze([
    "inspect_release>verification_fan_in",
    "verify_release_tests>verification_fan_in",
    "review_release_security>verification_fan_in",
    "verification_fan_in>delivery",
  ]);
  if (!sameStrings(
    plan.graphLaunch.edges.map((edge) => `${edge.from_node_key}>${edge.to_node_key}`),
    expectedEdges,
  ) || plan.graphLaunch.edges.some((edge) => edge.is_feedback !== false)) {
    throw new GrokProviderAdmissionError(
      "The deploy plan dependency graph is not the exact acyclic readiness fan-in.",
    );
  }
  if (
    plan.graphLaunch.budget.max_nodes !== 5
    || plan.graphLaunch.budget.max_concurrent_nodes !== 3
    || plan.graphLaunch.budget.max_duration_ms !== 5_400_000
    || plan.graphLaunch.budget.max_retries !== 3
    || plan.graphLaunch.budget.max_discovery_rounds !== 0
  ) {
    throw new GrokProviderAdmissionError(
      "The deploy plan budget does not match the deterministic planner-v3 contract.",
    );
  }

  const projectedNodes = plan.graphLaunch.nodes
    .filter((node) => node.node_key !== "delivery")
    .map((node) => Object.freeze({
      ...node,
      risk_level: "green" as const,
      reads: Object.freeze([]),
      writes: Object.freeze([]),
      lifecycle_stage: null,
      gate_kind: null,
    }));
  const projectedEdges = plan.graphLaunch.edges
    .filter((edge) => edge.from_node_key !== "delivery" && edge.to_node_key !== "delivery")
    .map((edge) => Object.freeze({ ...edge }));

  if (
    !sameStrings(projectedNodes.map((node) => node.node_key), DEPLOY_READINESS_TASK_KEYS)
    || projectedNodes.some((node) => node.reads.length > 0 || node.writes.length > 0 || node.gate_kind !== null)
  ) {
    throw new GrokProviderAdmissionError(
      "The deploy readiness projection retained a resource, write, or gate.",
    );
  }

  return Object.freeze({
    goal: GROK_DEPLOY_READINESS_GOAL,
    topology: "DAG" as const,
    topologyReasons: Object.freeze(plan.graphLaunch.topologyReasons.map((reason) => Object.freeze({ ...reason }))),
    riskLevel: "green" as const,
    requiresOwnerApproval: false,
    nodes: Object.freeze(projectedNodes),
    edges: Object.freeze(projectedEdges),
    budget: Object.freeze({
      ...plan.graphLaunch.budget,
      max_nodes: projectedNodes.length,
    }),
  });
}

function hasIdentity(entry: GrokSpecialistAdmission): boolean {
  return UUID_PATTERN.test(entry.assignmentId)
    && Number.isSafeInteger(entry.assignmentRevision) && entry.assignmentRevision > 0
    && UUID_PATTERN.test(entry.botId)
    && Number.isSafeInteger(entry.botRevision) && entry.botRevision > 0
    && UUID_PATTERN.test(entry.aiAccountId)
    && !Number.isNaN(Date.parse(entry.accountUpdatedAt))
    && UUID_PATTERN.test(entry.roleId)
    && !Number.isNaN(Date.parse(entry.roleUpdatedAt))
    && /^[a-z][a-z0-9_]{1,62}$/.test(entry.credentialPurpose)
    && CREDENTIAL_REF_PATTERN.test(entry.credentialRef)
    && Array.isArray(entry.capabilities) && entry.capabilities.length > 0
    && !entry.capabilities.includes("*" as never)
    && (entry.maxModelTier === "ECONOMY"
      || entry.maxModelTier === "STANDARD"
      || entry.maxModelTier === "STRONG");
}

function supportsCapability(entry: GrokSpecialistAdmission, capability: string): boolean {
  return entry.capabilities.includes(capability as never);
}

function supportsTier(entry: GrokSpecialistAdmission, tier: string | null | undefined): boolean {
  if (tier !== "ECONOMY" && tier !== "STANDARD" && tier !== "STRONG") return false;
  return MODEL_TIER_RANK[entry.maxModelTier] >= MODEL_TIER_RANK[tier];
}

function admissionFromRoster(
  entry: GrokSpecialistAdmission,
  node: GrokCanonicalAdmissionNode,
  lane: GrokProviderAdmissionInput["lane"],
): GrokProviderAdmissionInput {
  if (!hasIdentity(entry)) {
    throw new GrokProviderAdmissionError(
      `The selected agent for ${node.node_key} lacks an immutable bot, posting, account, or credential-reference snapshot. Re-plan this goal.`,
    );
  }
  return Object.freeze({
    version: GROK_PROVIDER_ADMISSION_VERSION,
    lane,
    nodeKey: node.node_key,
    sourceRosterAssignmentId: entry.assignmentId,
    assignmentId: entry.assignmentId,
    assignmentRevision: entry.assignmentRevision,
    botId: entry.botId,
    botRevision: entry.botRevision,
    aiAccountId: entry.aiAccountId,
    accountUpdatedAt: entry.accountUpdatedAt,
    roleId: entry.roleId,
    roleUpdatedAt: entry.roleUpdatedAt,
    agentCapabilities: Object.freeze([...entry.capabilities]),
    provider: entry.provider,
    model: entry.model,
    credentialPurpose: entry.credentialPurpose,
    credentialRef: entry.credentialRef,
    providerIdentity: entry.providerIdentity,
    capability: node.capability,
    agentMaxModelTier: entry.maxModelTier,
  });
}

/**
 * Bind every executable canonical node to an exact configured posting.
 *
 * The planner DAG and the canonical release graph deliberately have different
 * node keys. This projection does not guess by display name: it considers only
 * agents already selected into the immutable plan, proves their snapshotted
 * capabilities and model-tier ceiling, then uses stable ids as the final tie
 * break. The database independently locks and re-derives every field before it
 * admits the graph.
 */
export function buildGrokProviderAdmissions(
  plan: GrokChiefOfStaffPlan,
  nodes: readonly GrokCanonicalAdmissionNode[],
): readonly GrokProviderAdmissionInput[] {
  if (plan.planner.version !== 3 || !Array.isArray(plan.admissionRoster)) {
    throw new GrokProviderAdmissionError(
      "This goal uses a legacy plan without an immutable specialist admission roster. Re-plan it before execution.",
    );
  }
  if (plan.intent.kind === "research" || plan.intent.kind === "deploy") {
    throw new GrokProviderAdmissionError(
      `The ${plan.intent.kind} plan has no intent-specific executable bridge. Its deterministic plan remains blocked before graph creation.`,
    );
  }
  const roster = plan.admissionRoster;
  const admissions: GrokProviderAdmissionInput[] = [];

  for (const node of nodes) {
    let lane: GrokProviderAdmissionInput["lane"] | null = null;
    let provider: GrokProviderAdmissionInput["provider"] | null = null;
    if (node.executor === "MODEL") {
      lane = "graph_model";
      provider = "anthropic";
    } else if (
      node.executor === "ANCHOR"
      && node.node_key === "implement"
      && node.capability === "implementation"
    ) {
      lane = "phase1c";
      provider = "openai";
    } else {
      continue;
    }

    const candidates = roster
      .filter((entry) => entry.provider === provider && hasIdentity(entry))
      .filter((entry) => lane === "phase1c"
        ? supportsCapability(entry, "implementation")
        : supportsCapability(entry, node.capability) && supportsTier(entry, node.model_tier))
      .sort((left, right) => {
        return left.capabilities.length - right.capabilities.length
          || left.assignmentId.localeCompare(right.assignmentId);
      });
    const selected = candidates[0];
    if (!selected) {
      throw new GrokProviderAdmissionError(
        `No immutable ${provider} posting can execute canonical node ${node.node_key} (${node.capability}). Re-plan with a Ready capable bot.`,
      );
    }
    admissions.push(admissionFromRoster(selected, node, lane));
  }

  const expected = nodes.filter((node) => node.executor === "MODEL"
    || (node.executor === "ANCHOR" && node.node_key === "implement")).length;
  if (admissions.length !== expected || admissions.length === 0) {
    throw new GrokProviderAdmissionError(
      "The canonical graph did not produce one exact provider admission for every executable provider lane.",
    );
  }
  return Object.freeze(admissions);
}

/**
 * Bind an exact read-only planner DAG to the postings the planner selected.
 *
 * Unlike the canonical Full Lifecycle projection above, these node keys are
 * the planner task keys themselves. Re-selecting a merely compatible bot here
 * would make the durable graph disagree with the plan shown to the owner, so
 * every node must retain its exact snapshotted assignment identity.
 */
export function buildGrokReadOnlyIntentAdmissions(
  plan: GrokChiefOfStaffPlan,
  nodes: readonly GrokCanonicalAdmissionNode[],
): readonly GrokProviderAdmissionInput[] {
  if (plan.planner.version !== 3 || !Array.isArray(plan.admissionRoster)) {
    throw new GrokProviderAdmissionError(
      "This goal uses a legacy plan without an immutable specialist admission roster. Re-plan it before execution.",
    );
  }
  if (plan.intent.kind !== "research") {
    throw new GrokProviderAdmissionError(
      `The ${plan.intent.kind} plan is not an admitted read-only research graph.`,
    );
  }
  if (nodes.length === 0 || nodes.length !== plan.dag.tasks.length) {
    throw new GrokProviderAdmissionError(
      "The read-only graph does not preserve every exact planner task.",
    );
  }

  const taskById = new Map(plan.dag.tasks.map((task) => [task.id, task] as const));
  const rosterByAssignment = new Map(
    plan.admissionRoster.map((entry) => [entry.assignmentId, entry] as const),
  );
  if (taskById.size !== plan.dag.tasks.length || new Set(nodes.map((node) => node.node_key)).size !== nodes.length) {
    throw new GrokProviderAdmissionError(
      "The read-only graph contains duplicate or ambiguous planner task identities.",
    );
  }

  const admissions = nodes.map((node) => {
    const task = taskById.get(node.node_key);
    if (!task
      || task.executor !== "MODEL"
      || task.provider !== "anthropic"
      || node.executor !== "MODEL"
      || node.capability !== task.capability
      || node.model_tier !== task.modelTier
      || !task.assignmentId
    ) {
      throw new GrokProviderAdmissionError(
        `Read-only node ${node.node_key} does not match its exact Claude planner task.`,
      );
    }
    const roster = rosterByAssignment.get(task.assignmentId);
    if (!roster
      || roster.provider !== "anthropic"
      || roster.model !== task.model
      || !supportsCapability(roster, task.capability)
      || !supportsTier(roster, task.modelTier)
    ) {
      throw new GrokProviderAdmissionError(
        `Read-only node ${node.node_key} has no current immutable match for its selected Claude posting.`,
      );
    }
    return admissionFromRoster(roster, node, "graph_model");
  });

  return Object.freeze(admissions);
}

/** Bind only the exact non-delivery tasks of a validated deploy projection. */
export function buildGrokDeployReadinessAdmissions(
  plan: GrokChiefOfStaffPlan,
  nodes: readonly GrokCanonicalAdmissionNode[],
): readonly GrokProviderAdmissionInput[] {
  if (plan.planner.version !== 3 || !Array.isArray(plan.admissionRoster)) {
    throw new GrokProviderAdmissionError(
      "This deploy goal uses a legacy plan without an immutable specialist admission roster. Re-plan it before readiness inspection.",
    );
  }
  if (plan.intent.kind !== "deploy") {
    throw new GrokProviderAdmissionError(
      `The ${plan.intent.kind} plan is not an admitted deploy-readiness projection.`,
    );
  }
  if (
    nodes.length !== DEPLOY_READINESS_TASK_KEYS.length
    || !sameStrings(nodes.map((node) => node.node_key), DEPLOY_READINESS_TASK_KEYS)
  ) {
    throw new GrokProviderAdmissionError(
      "The deploy-readiness graph does not preserve the exact non-delivery planner task set.",
    );
  }

  const taskById = new Map(plan.dag.tasks.map((task) => [task.id, task] as const));
  const rosterByAssignment = new Map(
    plan.admissionRoster.map((entry) => [entry.assignmentId, entry] as const),
  );
  const admissions = nodes.map((node) => {
    const task = taskById.get(node.node_key);
    if (!task
      || task.executor !== "MODEL"
      || task.provider !== "anthropic"
      || node.executor !== "MODEL"
      || node.capability !== task.capability
      || node.model_tier !== task.modelTier
      || !task.assignmentId
    ) {
      throw new GrokProviderAdmissionError(
        `Deploy-readiness node ${node.node_key} does not match its exact Claude planner task.`,
      );
    }
    const roster = rosterByAssignment.get(task.assignmentId);
    if (!roster
      || roster.provider !== "anthropic"
      || roster.model !== task.model
      || !supportsCapability(roster, task.capability)
      || !supportsTier(roster, task.modelTier)
    ) {
      throw new GrokProviderAdmissionError(
        `Deploy-readiness node ${node.node_key} has no current immutable match for its selected Claude posting.`,
      );
    }
    return admissionFromRoster(roster, node, "graph_model");
  });

  return Object.freeze(admissions);
}
