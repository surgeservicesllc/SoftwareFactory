import type { GrokChiefOfStaffPlan, GrokTask } from "@/lib/factory/chief-of-staff";

export const GROK_PROVIDER_ADMISSION_VERSION = 1 as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,119}$/;
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
  sourceTaskKey: string;
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

type IdentityTask = GrokTask & Readonly<{
  assignmentId?: string;
  assignmentRevision?: number;
  botId?: string;
  botRevision?: number;
  aiAccountId?: string;
  accountUpdatedAt?: string;
  roleId?: string;
  roleUpdatedAt?: string;
  credentialPurpose?: string;
  credentialRef?: string;
  providerIdentity?: string | null;
  agentCapabilities?: readonly string[];
  agentMaxModelTier?: "ECONOMY" | "STANDARD" | "STRONG";
}>;

function hasIdentity(task: IdentityTask): task is IdentityTask & Required<Pick<
  IdentityTask,
  | "assignmentId"
  | "assignmentRevision"
  | "botId"
  | "botRevision"
  | "aiAccountId"
  | "accountUpdatedAt"
  | "roleId"
  | "roleUpdatedAt"
  | "credentialPurpose"
  | "credentialRef"
  | "agentCapabilities"
  | "agentMaxModelTier"
>> {
  return typeof task.assignmentId === "string" && UUID_PATTERN.test(task.assignmentId)
    && Number.isSafeInteger(task.assignmentRevision) && (task.assignmentRevision ?? 0) > 0
    && typeof task.botId === "string" && UUID_PATTERN.test(task.botId)
    && Number.isSafeInteger(task.botRevision) && (task.botRevision ?? 0) > 0
    && typeof task.aiAccountId === "string" && UUID_PATTERN.test(task.aiAccountId)
    && typeof task.accountUpdatedAt === "string" && !Number.isNaN(Date.parse(task.accountUpdatedAt))
    && typeof task.roleId === "string" && UUID_PATTERN.test(task.roleId)
    && typeof task.roleUpdatedAt === "string" && !Number.isNaN(Date.parse(task.roleUpdatedAt))
    && typeof task.credentialPurpose === "string" && /^[a-z][a-z0-9_]{1,79}$/.test(task.credentialPurpose)
    && typeof task.credentialRef === "string" && CREDENTIAL_REF_PATTERN.test(task.credentialRef)
    && Array.isArray(task.agentCapabilities) && task.agentCapabilities.length > 0
    && (task.agentMaxModelTier === "ECONOMY"
      || task.agentMaxModelTier === "STANDARD"
      || task.agentMaxModelTier === "STRONG");
}

function supportsCapability(task: IdentityTask, capability: string): boolean {
  return task.agentCapabilities?.includes(capability) === true
    || task.agentCapabilities?.includes("*") === true;
}

function supportsTier(task: IdentityTask, tier: string | null | undefined): boolean {
  if (tier !== "ECONOMY" && tier !== "STANDARD" && tier !== "STRONG") return false;
  if (!task.agentMaxModelTier) return false;
  return MODEL_TIER_RANK[task.agentMaxModelTier] >= MODEL_TIER_RANK[tier];
}

function admissionFromTask(
  task: IdentityTask,
  node: GrokCanonicalAdmissionNode,
  lane: GrokProviderAdmissionInput["lane"],
): GrokProviderAdmissionInput {
  if (!hasIdentity(task)) {
    throw new GrokProviderAdmissionError(
      `The selected agent for ${node.node_key} lacks an immutable bot, posting, account, or credential-reference snapshot. Re-plan this goal.`,
    );
  }
  return Object.freeze({
    version: GROK_PROVIDER_ADMISSION_VERSION,
    lane,
    nodeKey: node.node_key,
    sourceTaskKey: task.id,
    assignmentId: task.assignmentId,
    assignmentRevision: task.assignmentRevision,
    botId: task.botId,
    botRevision: task.botRevision,
    aiAccountId: task.aiAccountId,
    accountUpdatedAt: task.accountUpdatedAt,
    roleId: task.roleId,
    roleUpdatedAt: task.roleUpdatedAt,
    agentCapabilities: Object.freeze([...task.agentCapabilities].sort()),
    provider: task.provider,
    model: task.model,
    credentialPurpose: task.credentialPurpose,
    credentialRef: task.credentialRef,
    providerIdentity: task.providerIdentity ?? null,
    capability: node.capability,
    agentMaxModelTier: task.agentMaxModelTier,
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
  if (plan.planner.version !== 2) {
    throw new GrokProviderAdmissionError(
      "This goal uses a legacy plan without immutable provider admission. Re-plan it before execution.",
    );
  }
  const tasks = plan.dag.tasks as readonly IdentityTask[];
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

    const candidates = tasks
      .filter((task) => task.provider === provider && hasIdentity(task))
      .filter((task) => lane === "phase1c"
        ? task.capability === "implementation"
        : supportsCapability(task, node.capability) && supportsTier(task, node.model_tier))
      .sort((left, right) => {
        const leftExact = left.capability === node.capability ? 0 : 1;
        const rightExact = right.capability === node.capability ? 0 : 1;
        return leftExact - rightExact
          || (left.assignmentId ?? "").localeCompare(right.assignmentId ?? "")
          || left.id.localeCompare(right.id);
      });
    const selected = candidates[0];
    if (!selected) {
      throw new GrokProviderAdmissionError(
        `No immutable ${provider} posting can execute canonical node ${node.node_key} (${node.capability}). Re-plan with a Ready capable bot.`,
      );
    }
    admissions.push(admissionFromTask(selected, node, lane));
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
