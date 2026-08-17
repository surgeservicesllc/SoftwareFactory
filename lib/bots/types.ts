import type { AssignmentConfig } from "@/lib/bots/assignment-config";
import type { BotReadiness } from "@/lib/bots/readiness";
import type { RiskLevel } from "@/lib/risk";

/**
 * Wire shapes shared by the bot fabric API and the browser console.
 *
 * A serialized bot carries the *name* of its credential reference plus a
 * presence boolean. The credential value has no representation here, by design.
 */

export type SerializedBot = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  providerVendor: string;
  model: string;
  credentialRef: string | null;
  credentialPresent: boolean;
  baseUrl: string | null;
  notes: string | null;
  /** Readiness recorded by the last check. */
  readiness: BotReadiness;
  readinessLabel: string;
  readinessTone: "safe" | "warning" | "danger" | "neutral";
  readinessDetail: string | null;
  lastCheckedAt: string | null;
  /** Readiness recomputed from current server configuration, exposing drift. */
  currentReadiness: BotReadiness;
  currentReadinessDetail: string;
  /**
   * The provider sign-in behind this bot, when it has one. Carried so the
   * assign wizard can show that account's recorded session and weekly usage
   * beside the bot, rather than asking someone to cross-reference two pages.
   */
  aiAccountId: string | null;
  createdAt: string;
};

export type SerializedBotRole = {
  id: string;
  name: string;
  slug: string;
  summary: string;
  instructions: string;
  riskCeiling: RiskLevel;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
};

export type SerializedAssignment = {
  id: string;
  botId: string;
  projectId: string;
  roleId: string;
  status: "active" | "paused" | "released";
  assignedAt: string;
  releasedAt: string | null;
  /**
   * What this bot may do on this project. Present on every assignment: a row
   * written before the configuration columns existed reads as least privilege
   * rather than as an absent field the console has to guess about.
   */
  config: AssignmentConfig;
};

export type SerializedProject = {
  id: string;
  name: string;
  status: string;
  githubRepository: string | null;
  healthStatus: string;
};

export type BotFabricSnapshot = {
  bots: SerializedBot[];
  roles: SerializedBotRole[];
  assignments: SerializedAssignment[];
  projects: SerializedProject[];
};

export type BotFabricExecutorState = {
  connected: false;
  label: string;
  detail: string;
  globalKillSwitchActive: boolean;
};

export type BotFabricResponse = BotFabricSnapshot & {
  activeOrganizationId: string;
  canManage: boolean;
  executor: BotFabricExecutorState;
};
