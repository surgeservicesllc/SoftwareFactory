/**
 * Phase 2C capability registry.
 *
 * Phase 2A declared eight capabilities on *providers*. Routing a node well
 * needs more than that: the same provider is a different proposition depending
 * on which agent is asking and which model would run it.
 *
 * So capability is declared at three levels, and a candidate must satisfy all
 * three. The registry is data, not inference — nothing here is measured, and
 * nothing here claims to be. Measured behavior lives in `history.ts` and is
 * kept deliberately separate so a declaration can never be mistaken for
 * evidence.
 */

export const WORK_CAPABILITIES = [
  "planning",
  "architecture",
  "coding",
  "frontend",
  "backend",
  "database",
  "research",
  "qa",
  "security",
  "review",
  "synthesis",
  "production_investigation",
] as const;

export type WorkCapability = (typeof WORK_CAPABILITIES)[number];

export function isWorkCapability(value: unknown): value is WorkCapability {
  return typeof value === "string" && (WORK_CAPABILITIES as readonly string[]).includes(value);
}

/** How demanding a node is of the worker's judgement, independent of its subject. */
export const NODE_COMPLEXITIES = ["mechanical", "bounded", "judgement"] as const;
export type NodeComplexity = (typeof NODE_COMPLEXITIES)[number];

export interface AgentCapabilityProfile {
  readonly agentId: string;
  readonly role: string;
  readonly capabilities: readonly WorkCapability[];
  /** False when the agent is paused, errored, or otherwise unavailable. */
  readonly available: boolean;
  /**
   * Projects this agent may work on. An empty list means unrestricted; a
   * non-empty list is an allowlist, never a denylist, so a new project cannot
   * silently inherit access.
   */
  readonly allowedProjectIds: readonly string[];
}

export interface ModelCapabilityProfile {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: readonly WorkCapability[];
  /** Maximum input the model can accept, in tokens. */
  readonly contextLimitTokens: number;
  /**
   * Declared strength tier. This is the owner's configured judgement about
   * where a model belongs, not a benchmark result.
   */
  readonly tier: "economical" | "balanced" | "strong";
  readonly available: boolean;
}

export type CapabilityRejection =
  | "AGENT_LACKS_CAPABILITY"
  | "AGENT_UNAVAILABLE"
  | "AGENT_NOT_ALLOWED_ON_PROJECT"
  | "MODEL_LACKS_CAPABILITY"
  | "MODEL_UNAVAILABLE"
  | "CONTEXT_TOO_SMALL";

export interface CapabilityCheck {
  readonly eligible: boolean;
  readonly rejections: readonly CapabilityRejection[];
  /** Share of required capabilities the pair declares, 0-1. */
  readonly fit: number;
}

/**
 * Check one agent+model pair against what a node requires.
 *
 * Every rejection is collected rather than short-circuited, so a caller can
 * explain the whole reason a candidate was excluded instead of the first thing
 * that happened to be wrong.
 */
export function checkCapability(input: {
  readonly required: readonly WorkCapability[];
  readonly agent: AgentCapabilityProfile;
  readonly model: ModelCapabilityProfile;
  readonly projectId: string;
  readonly estimatedContextTokens: number;
}): CapabilityCheck {
  const rejections: CapabilityRejection[] = [];

  if (!input.agent.available) rejections.push("AGENT_UNAVAILABLE");
  if (!input.model.available) rejections.push("MODEL_UNAVAILABLE");

  if (
    input.agent.allowedProjectIds.length > 0
    && !input.agent.allowedProjectIds.includes(input.projectId)
  ) {
    rejections.push("AGENT_NOT_ALLOWED_ON_PROJECT");
  }

  const agentCapabilities = new Set(input.agent.capabilities);
  const modelCapabilities = new Set(input.model.capabilities);
  const agentMissing = input.required.filter((capability) => !agentCapabilities.has(capability));
  const modelMissing = input.required.filter((capability) => !modelCapabilities.has(capability));

  if (agentMissing.length > 0) rejections.push("AGENT_LACKS_CAPABILITY");
  if (modelMissing.length > 0) rejections.push("MODEL_LACKS_CAPABILITY");

  if (input.estimatedContextTokens > input.model.contextLimitTokens) {
    rejections.push("CONTEXT_TOO_SMALL");
  }

  // Fit measures the pair, so a capability either side lacks is not met.
  const met = input.required.filter(
    (capability) => agentCapabilities.has(capability) && modelCapabilities.has(capability),
  ).length;

  return Object.freeze({
    eligible: rejections.length === 0,
    rejections: Object.freeze(rejections),
    fit: input.required.length === 0 ? 1 : met / input.required.length,
  });
}

export const CAPABILITY_REJECTION_EXPLANATIONS: Record<CapabilityRejection, string> = {
  AGENT_LACKS_CAPABILITY: "The agent does not declare every capability this work requires.",
  AGENT_UNAVAILABLE: "The agent is paused, busy beyond its limit, or in an error state.",
  AGENT_NOT_ALLOWED_ON_PROJECT: "The agent is not on this project's allowlist.",
  MODEL_LACKS_CAPABILITY: "The model does not declare every capability this work requires.",
  MODEL_UNAVAILABLE: "The model is not configured or its provider is not connected.",
  CONTEXT_TOO_SMALL: "The estimated context exceeds the model's limit.",
};
