import type {
  GrokChiefOfStaffPlan,
  GrokSpecialistAdmission,
} from "@/lib/factory/chief-of-staff";

export const GROK_PROVIDER_ADMISSION_VERSION = 2 as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const MODEL_TIER_RANK = Object.freeze({ ECONOMY: 1, STANDARD: 2, STRONG: 3 });

export type GrokCanonicalAdmissionNode = Readonly<{
  node_key: string;
  executor: string;
  capability: string;
  model_tier?: string | null;
}>;

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
