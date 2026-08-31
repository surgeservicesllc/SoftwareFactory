import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { listAiAccounts, type AiAccountRow } from "@/lib/ai-accounts/broker";
import { assignmentPostingIsConfigured } from "@/lib/bots/assignment-config";
import { normalizeCredentialRef } from "@/lib/bots/credentials";
import { loadBotFabric } from "@/lib/bots/service";
import type { BotFabricSnapshot, SerializedBotRole } from "@/lib/bots/types";
import { deriveReleaseEvidence } from "@/lib/factory/release-evidence";
import {
  GROK_PLANNER_ERROR_CODES,
  GROK_PLAN_VERSION,
  type GrokChiefOfStaffPlan,
  type GrokConfiguredAgent,
  type GrokPlannerErrorCode,
  type GrokProjectContext,
} from "@/lib/factory/chief-of-staff";
import type {
  GrokArtifact,
  GrokControlAction,
  GrokEvent,
  GrokMessage,
  GrokSession,
  GrokSessionDetail,
  GrokTask,
} from "@/lib/grok/contracts";
import { MODEL_TIERS, NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { GRAPH_TOPOLOGIES } from "@/lib/graph/types";
import { containsLikelySecret } from "@/lib/security/sensitive-data";

type DatabaseError = Readonly<{ code?: string; message?: string }>;

export class GrokStoreDatabaseError extends Error {
  readonly databaseError: DatabaseError;

  constructor(error: DatabaseError) {
    super(error.message ?? "The Grok workspace database request failed.");
    this.name = "GrokStoreDatabaseError";
    this.databaseError = error;
  }
}

export class GrokStoreProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokStoreProjectionError";
  }
}

async function rpc<T>(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw new GrokStoreDatabaseError(error);
  return data as T;
}

function childIdempotencyKey(base: string, purpose: string): string {
  const combined = `${base}:${purpose}`;
  if (combined.length <= 128) return combined;
  return `grok:${createHash("sha256").update(combined, "utf8").digest("hex")}`;
}

function oneRow(value: unknown, label: string): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new GrokStoreProjectionError(`${label} did not return one row.`);
    return value[0];
  }
  if (typeof value !== "object" || value === null) {
    throw new GrokStoreProjectionError(`${label} did not return a row.`);
  }
  return value;
}

const sessionRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().min(1).max(160),
  status: z.enum(["active", "blocked", "completed", "cancelled", "archived"]),
  created_by: z.string().uuid(),
  idempotency_key: z.string().min(1).max(200),
  last_message_sequence: z.coerce.number().int().nonnegative(),
  last_event_sequence: z.coerce.number().int().nonnegative(),
  version: z.coerce.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  closed_at: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const messageRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  sequence_no: z.coerce.number().int().positive(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().max(32_000),
  metadata: z.unknown(),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();

const taskLinkRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  message_id: z.string().uuid().nullable(),
  command_id: z.string().uuid().nullable(),
  task_id: z.string().uuid().nullable(),
  graph_id: z.string().uuid().nullable(),
  graph_run_id: z.string().uuid().nullable(),
  relation: z.enum(["requested", "planned", "executing", "result"]),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();

const eventRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  sequence_no: z.coerce.number().int().positive(),
  event_type: z.string().min(1).max(120),
  correlation_id: z.string().uuid(),
  payload: z.unknown(),
  occurred_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();

const planningFailureResultSchema = z.object({
  session: sessionRowSchema,
  message: messageRowSchema,
  event: eventRowSchema,
}).strict();

const artifactLinkSchema = z.object({
  id: z.string().uuid(),
  kind: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  uri: z.string().max(2_000).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const readBundleSchema = z.object({
  session: sessionRowSchema,
  messages: z.array(messageRowSchema).max(200),
  task_links: z.array(taskLinkRowSchema).max(500),
  events: z.array(eventRowSchema).max(200),
  artifact_links: z.array(artifactLinkSchema).max(500),
  control_intents: z.array(z.unknown()).max(500),
  next: z.object({
    message_sequence: z.coerce.number().int().nonnegative(),
    event_sequence: z.coerce.number().int().nonnegative(),
  }).passthrough(),
  events_truncated: z.boolean().optional(),
}).strict();

const planResourceSchema = z.object({ kind: z.string().min(1), id: z.string().min(1) }).strict();
const launchNodeSchema = z.object({
  node_key: z.string().min(1),
  job: z.string().min(1),
  executor: z.string().min(1),
  capability: z.string().min(1),
  model_tier: z.string().min(1),
  risk_level: z.enum(["green", "yellow", "red"]),
  timeout_ms: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
  allow_provider_fallback: z.boolean(),
  tolerates_partial_inputs: z.boolean(),
  input_schema: z.record(z.string(), z.unknown()),
  output_schema: z.record(z.string(), z.unknown()),
  reads: z.array(planResourceSchema),
  writes: z.array(planResourceSchema),
  lifecycle_stage: z.null(),
  gate_kind: z.enum(["HUMAN"]).nullable(),
}).strict();
const launchEdgeSchema = z.object({
  from_node_key: z.string().min(1),
  to_node_key: z.string().min(1),
  reason: z.string().min(1),
  detail: z.string().min(1),
  is_feedback: z.literal(false),
}).strict();
const graphLaunchSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  topology: z.enum(GRAPH_TOPOLOGIES),
  topologyReasons: z.array(z.object({ code: z.string(), detail: z.string() }).strict()).max(100),
  riskLevel: z.enum(["green", "yellow", "red"]),
  requiresOwnerApproval: z.boolean(),
  nodes: z.array(launchNodeSchema).min(1).max(50),
  edges: z.array(launchEdgeSchema).max(500),
  budget: z.object({
    max_nodes: z.number().int().positive().max(50),
    max_concurrent_nodes: z.number().int().positive().max(8),
    max_duration_ms: z.number().int().positive(),
    max_retries: z.number().int().nonnegative(),
    max_discovery_rounds: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const storedTaskSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().min(1).max(128),
  agentName: z.string().min(1).max(120),
  assignmentId: z.string().uuid().optional(),
  assignmentRevision: z.number().int().positive().optional(),
  botId: z.string().uuid().optional(),
  botRevision: z.number().int().positive().optional(),
  roleId: z.string().uuid().optional(),
  roleUpdatedAt: z.string().datetime({ offset: true }).optional(),
  aiAccountId: z.string().uuid().optional(),
  credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  credentialPurpose: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/).optional(),
  providerIdentity: z.string().trim().min(1).max(120).nullable().optional(),
  accountUpdatedAt: z.string().datetime({ offset: true }).optional(),
  agentCapabilities: z.array(z.union([z.enum(NODE_CAPABILITIES), z.literal("*")]))
    .min(1).max(NODE_CAPABILITIES.length + 1).optional(),
  agentMaxModelTier: z.enum(MODEL_TIERS).refine((value) => value !== "NONE").optional(),
  dependsOn: z.array(z.string().min(1).max(120)).max(50),
}).passthrough();

const storedPlanSchema = z.object({
  planner: z.object({
    version: z.union([z.literal(1), z.literal(GROK_PLAN_VERSION)]),
  }).passthrough(),
  intent: z.object({ prompt: z.string().trim().min(1).max(4_000) }).passthrough(),
  project: z.object({ projectId: z.string().uuid() }).passthrough(),
  dag: z.object({ tasks: z.array(storedTaskSchema).min(1).max(50) }).passthrough(),
  graphLaunch: graphLaunchSchema,
}).passthrough();

type ReadBundle = z.infer<typeof readBundleSchema>;
type SessionRow = z.infer<typeof sessionRowSchema>;
type MessageRow = z.infer<typeof messageRowSchema>;
type TaskLinkRow = z.infer<typeof taskLinkRowSchema>;
type EventRow = z.infer<typeof eventRowSchema>;
type PlanningFailureResult = z.infer<typeof planningFailureResultSchema>;

const controlIntentSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  session_id: z.string().uuid(),
  target_kind: z.enum(["graph", "graph_run", "task", "gate"]),
  graph_id: z.string().uuid().nullable(),
  graph_run_id: z.string().uuid().nullable(),
  task_id: z.string().uuid().nullable(),
  gate_id: z.string().uuid().nullable(),
  action: z.enum(["pause", "resume", "withdraw", "cancel", "retry", "approve", "reject"]),
  state: z.enum(["requested", "accepted", "rejected", "applied", "failed", "superseded"]),
  reason: z.string().min(1).max(1_000),
  idempotency_key: z.string().min(1),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  updated_at: z.string().datetime({ offset: true }),
}).passthrough();

export type GrokControlIntent = z.infer<typeof controlIntentSchema>;

const appliedGraphControlSchema = z.object({
  intent_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  session_id: z.string().uuid(),
  graph_id: z.string().uuid(),
  action: z.enum(["pause", "resume", "withdraw"]),
  state: z.literal("applied"),
  idempotency_key: z.string().min(8).max(128),
  replayed: z.boolean(),
}).strict();

export type GrokAppliedGraphControl = z.infer<typeof appliedGraphControlSchema>;

export async function applyGrokGraphControl(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    sessionId: string;
    graphId: string;
    action: "pause" | "resume" | "withdraw";
    reason: string;
    idempotencyKey: string;
  }>,
): Promise<GrokAppliedGraphControl> {
  const value = await rpc<unknown>(client, "apply_grok_graph_control_as_owner", {
    p_organization_id: input.organizationId,
    p_session_id: input.sessionId,
    p_graph_id: input.graphId,
    p_action: input.action,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  const parsed = appliedGraphControlSchema.safeParse(
    oneRow(value, "apply_grok_graph_control_as_owner"),
  );
  if (!parsed.success) {
    throw new GrokStoreProjectionError("The atomic Grok graph control result was malformed.");
  }
  if (
    parsed.data.organization_id !== input.organizationId
    || parsed.data.session_id !== input.sessionId
    || parsed.data.graph_id !== input.graphId
    || parsed.data.action !== input.action
    || parsed.data.idempotency_key !== input.idempotencyKey
  ) {
    throw new GrokStoreProjectionError("The atomic Grok graph control result did not match its exact input.");
  }
  return parsed.data;
}

export async function requestGrokControlIntent(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    sessionId: string;
    targetKind: "graph" | "graph_run" | "task";
    targetId: string;
    action: "pause" | "resume" | "withdraw" | "cancel" | "retry";
    reason: string;
    idempotencyKey: string;
  }>,
): Promise<GrokControlIntent> {
  const value = await rpc(client, "request_grok_control_intent", {
    p_organization_id: input.organizationId,
    p_session_id: input.sessionId,
    p_target_kind: input.targetKind,
    p_target_id: input.targetId,
    p_action: input.action,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  const parsed = controlIntentSchema.safeParse(oneRow(value, "request_grok_control_intent"));
  if (!parsed.success) throw new GrokStoreProjectionError("The Grok control intent was malformed.");
  return parsed.data;
}

export async function resolveGrokControlIntent(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    intentId: string;
    state: "applied" | "failed";
    failureCode?: string | null;
    failureDetail?: string | null;
  }>,
): Promise<GrokControlIntent> {
  const value = await rpc(client, "resolve_grok_control_intent_as_server", {
    p_organization_id: input.organizationId,
    p_intent_id: input.intentId,
    p_state: input.state,
    p_failure_code: input.failureCode ?? null,
    p_failure_detail: input.failureDetail ?? null,
  });
  const parsed = controlIntentSchema.safeParse(oneRow(value, "resolve_grok_control_intent_as_server"));
  if (!parsed.success || parsed.data.state !== input.state) {
    throw new GrokStoreProjectionError("The Grok control resolution was malformed.");
  }
  return parsed.data;
}

export type GrokProjectRead = GrokProjectContext & Readonly<{ status: string }>;

export async function readGrokProject(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<GrokProjectRead | null> {
  const result = await client
    .from("projects")
    .select("id,organization_id,name,status,github_repository,default_branch,production_url")
    .eq("organization_id", organizationId)
    .eq("id", projectId)
    .maybeSingle();
  if (result.error) throw new GrokStoreDatabaseError(result.error);
  const row = z.object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    name: z.string().min(1).max(160),
    status: z.string().min(1).max(40),
    github_repository: z.string().min(3).max(255).nullable(),
    default_branch: z.string().min(1).max(255).nullable(),
    production_url: z.string().url().nullable(),
  }).strict().safeParse(result.data);
  if (!row.success) return null;
  if (!row.data.github_repository || !row.data.default_branch) return null;
  return Object.freeze({
    projectId: row.data.id,
    name: row.data.name,
    repositoryFullName: row.data.github_repository,
    defaultBranch: row.data.default_branch,
    productionUrl: row.data.production_url,
    status: row.data.status,
  });
}

const CAPABILITY_ALIASES: Readonly<Record<string, readonly GrokConfiguredAgent["capabilities"][number][]>> =
  Object.freeze({
    planning: ["planning"], architecture: ["architecture"], implementation: ["implementation"],
    coding: ["implementation"], api: ["implementation"], backend: ["implementation"],
    frontend: ["implementation"], ui: ["implementation"], migrations: ["implementation"],
    extraction: ["extraction"], review: ["review"], audit: ["review"],
    "security-review": ["security_review"], security: ["security_review"],
    authorization: ["security_review"], secrets: ["security_review"],
    qa: ["qa"], testing: ["qa"], tests: ["qa"], validation: ["qa"],
    regression: ["qa"], coverage: ["qa"], synthesis: ["synthesis"],
    summarization: ["synthesis"], reporting: ["reporting"], discovery: ["discovery"],
    research: ["discovery"], evaluation: ["evaluation"], decision: ["decision"],
  });

function rosterCapabilities(role: SerializedBotRole): GrokConfiguredAgent["capabilities"] {
  const capabilities = new Set<GrokConfiguredAgent["capabilities"][number]>();
  for (const declared of role.capabilities) {
    for (const capability of CAPABILITY_ALIASES[declared.trim().toLowerCase()] ?? []) {
      capabilities.add(capability);
    }
  }
  return Object.freeze([...capabilities].sort());
}

function tierForWorkEffort(workEffort: string): GrokConfiguredAgent["maxModelTier"] {
  if (workEffort === "high" || workEffort === "max") return "STRONG";
  if (workEffort === "low") return "ECONOMY";
  return "STANDARD";
}

const grokAiAccountSchema = z.object({
  account_id: z.string().uuid(),
  provider: z.enum(["anthropic", "openai"]),
  status: z.string().min(1).max(64),
  credential_purpose: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  provider_identity: z.string().trim().min(1).max(120)
    .refine((value) => !containsLikelySecret(value))
    .nullable().optional(),
  updated_at: z.string().datetime({ offset: true }),
}).passthrough();

function connectedAiAccounts(
  accounts: readonly AiAccountRow[],
): ReadonlyMap<string, z.infer<typeof grokAiAccountSchema>> {
  const parsed = z.array(grokAiAccountSchema).max(200).safeParse(accounts);
  if (!parsed.success) {
    throw new GrokStoreProjectionError("The connected AI-account roster was malformed.");
  }
  const connected = new Map<string, z.infer<typeof grokAiAccountSchema>>();
  for (const account of parsed.data) {
    if (account.status !== "connected") continue;
    if (connected.has(account.account_id)) {
      throw new GrokStoreProjectionError("The connected AI-account roster contained a duplicate identity.");
    }
    connected.set(account.account_id, account);
  }
  return connected;
}

export function configuredGrokAgents(
  fabric: BotFabricSnapshot,
  projectId: string,
  accounts: readonly AiAccountRow[],
): readonly GrokConfiguredAgent[] {
  if (fabric.assignmentsComplete !== true) {
    throw new GrokStoreProjectionError("The configured bot roster is incomplete.");
  }
  const botById = new Map(fabric.bots.map((bot) => [bot.id, bot]));
  const roleById = new Map(fabric.roles.map((role) => [role.id, role]));
  const accountById = connectedAiAccounts(accounts);
  const agents: GrokConfiguredAgent[] = [];
  for (const assignment of fabric.assignments) {
    if (assignment.projectId !== projectId || assignment.status !== "active") continue;
    const bot = botById.get(assignment.botId);
    const role = roleById.get(assignment.roleId);
    if (!bot || !role || (bot.provider !== "anthropic" && bot.provider !== "openai")) continue;
    const account = bot.aiAccountId ? accountById.get(bot.aiAccountId) : undefined;
    if (!account || account.provider !== bot.provider) continue;
    let credentialRef: string | null;
    try {
      credentialRef = normalizeCredentialRef(bot.credentialRef);
    } catch {
      continue;
    }
    if (!credentialRef || credentialRef !== bot.credentialRef) continue;
    // The launch RPC independently requires the persisted readiness row. A
    // currently openable recovered credential may improve the console's live
    // overlay, but it cannot silently substitute for that audited state.
    if (bot.readiness !== "ready" || bot.currentReadiness !== "ready"
      || !assignmentPostingIsConfigured({
      config: assignment.config,
      model: assignment.model,
      workEffort: assignment.workEffort,
    })) continue;
    const capabilities = rosterCapabilities(role);
    if (capabilities.length === 0) continue;
    agents.push(Object.freeze({
      id: assignment.id,
      assignmentId: assignment.id,
      assignmentRevision: assignment.revision,
      botId: bot.id,
      botRevision: bot.revision,
      roleId: role.id,
      roleUpdatedAt: role.updatedAt,
      aiAccountId: account.account_id,
      credentialRef,
      credentialPurpose: account.credential_purpose,
      providerIdentity: account.provider_identity ?? null,
      accountUpdatedAt: account.updated_at,
      name: `${bot.name} — ${role.name}`,
      provider: bot.provider,
      model: assignment.model ?? bot.model,
      capabilities,
      maxModelTier: tierForWorkEffort(assignment.workEffort),
      ready: true,
      priority: assignment.config.priority,
    }));
  }
  return Object.freeze(agents.sort((left, right) =>
    (left.priority ?? 100) - (right.priority ?? 100) || left.id.localeCompare(right.id),
  ));
}

export async function loadConfiguredGrokAgents(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<readonly GrokConfiguredAgent[]> {
  const [fabric, accounts] = await Promise.all([
    loadBotFabric(client, organizationId),
    listAiAccounts(client, organizationId),
  ]);
  return configuredGrokAgents(fabric, projectId, accounts);
}

export function grokSessionTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ") ?? "";
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 117).trimEnd()}...`;
}

export async function createGrokSession(
  client: SupabaseClient,
  input: Readonly<{ organizationId: string; projectId: string; title: string; idempotencyKey: string }>,
): Promise<SessionRow> {
  const value = await rpc(client, "create_grok_session", {
    p_organization_id: input.organizationId,
    p_project_id: input.projectId,
    p_title: input.title,
    p_idempotency_key: input.idempotencyKey,
  });
  const parsed = sessionRowSchema.safeParse(oneRow(value, "create_grok_session"));
  if (!parsed.success) throw new GrokStoreProjectionError("The created Grok session was malformed.");
  return parsed.data;
}

export async function appendGrokUserMessage(
  client: SupabaseClient,
  input: Readonly<{ organizationId: string; sessionId: string; prompt: string; idempotencyKey: string }>,
): Promise<MessageRow> {
  const value = await rpc(client, "append_grok_user_message", {
    p_organization_id: input.organizationId,
    p_session_id: input.sessionId,
    p_content: input.prompt,
    p_metadata: { schemaVersion: 1, kind: "grok.user_prompt" },
    p_idempotency_key: childIdempotencyKey(input.idempotencyKey, "user"),
    p_expected_sequence: 0,
    p_reply_to_message_id: null,
  });
  const parsed = messageRowSchema.safeParse(oneRow(value, "append_grok_user_message"));
  if (!parsed.success || parsed.data.role !== "user" || parsed.data.content !== input.prompt) {
    throw new GrokStoreProjectionError("The durable Grok user message did not match the request.");
  }
  return parsed.data;
}

export function assistantPlanContent(plan: GrokChiefOfStaffPlan): string {
  return `I recorded a deterministic ${plan.intent.kind} plan with ${plan.dag.tasks.length} tasks `
    + `across ${plan.dag.layers.length} dependency-safe layers. Execution has not started.`;
}

export async function appendGrokAssistantPlan(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    sessionId: string;
    userMessageId: string;
    idempotencyKey: string;
    plan: GrokChiefOfStaffPlan;
  }>,
): Promise<MessageRow> {
  const content = assistantPlanContent(input.plan);
  const value = await rpc(client, "append_grok_message_as_server", {
    p_organization_id: input.organizationId,
    p_session_id: input.sessionId,
    p_role: "assistant",
    p_content: content,
    p_metadata: { schemaVersion: 1, kind: "grok.plan", plan: input.plan },
    p_idempotency_key: childIdempotencyKey(input.idempotencyKey, "assistant-plan"),
    p_expected_sequence: 1,
    p_reply_to_message_id: input.userMessageId,
  });
  const parsed = messageRowSchema.safeParse(oneRow(value, "append_grok_message_as_server"));
  if (!parsed.success || parsed.data.role !== "assistant" || parsed.data.content !== content) {
    throw new GrokStoreProjectionError("The durable Grok assistant plan message was malformed.");
  }
  return parsed.data;
}

const PLANNING_FAILURE_CONTENT: Readonly<Record<GrokPlannerErrorCode, string>> = Object.freeze({
  INVALID_INPUT:
    "Planning is blocked because the request does not satisfy the bounded Grok planning contract.",
  SENSITIVE_DATA:
    "Planning is blocked because the request contains secret-shaped data. Remove it and start a new goal.",
  NO_CONFIGURED_AGENTS:
    "Planning is blocked until this project has at least one Ready configured Claude or Codex agent.",
  MISSING_CLAUDE_AGENT:
    "Planning is blocked until a Ready configured Claude agent covers every required planning and verification task.",
  MISSING_CODEX_AGENT:
    "Planning is blocked until a Ready configured Codex agent covers the repository-writing task.",
  GRAPH_INVALID:
    "Planning is blocked because the deterministic task graph did not satisfy the graph contract.",
});

const plannerErrorCodeSchema = z.enum(GROK_PLANNER_ERROR_CODES);

const planningFailureMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("grok.planning_error"),
  code: plannerErrorCodeSchema,
  workerWoken: z.literal(false),
  executionStarted: z.literal(false),
}).strict();

const planningFailureEventPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  detail: z.literal("Planning was blocked before any graph or worker dispatch."),
  code: plannerErrorCodeSchema,
  messageId: z.string().uuid(),
  workerWoken: z.literal(false),
  executionStarted: z.literal(false),
}).strict();

const planningFailureMessageEvidenceSchema = z.object({
  reply_to_message_id: z.string().uuid(),
  actor_user_id: z.null(),
}).passthrough();

const planningFailureEventEvidenceSchema = z.object({
  message_id: z.string().uuid(),
  task_link_id: z.null(),
  actor_user_id: z.null(),
}).passthrough();

const blockedEventEvidenceSchema = z.object({
  message_id: z.null(),
  task_link_id: z.null(),
  actor_user_id: z.null(),
}).passthrough();

const messageAppendedPayloadSchema = z.object({
  message_id: z.string().uuid(),
  message_sequence: z.literal(2),
  role: z.literal("assistant"),
}).strict();

const blockedEventPayloadSchema = z.object({ status: z.literal("blocked") }).strict();

export type StoredGrokPlanningFailure = Readonly<{
  code: GrokPlannerErrorCode;
  message: string;
  messageId: string;
}>;

/**
 * Recover an already-recorded refusal before re-running the planner. This
 * makes an idempotent replay stable even if the configured bot roster changes
 * after the original request was blocked.
 */
export function storedGrokPlanningFailure(bundle: ReadBundle): StoredGrokPlanningFailure | null {
  const message = bundle.messages.find(
    (candidate) => candidate.sequence_no === 2 && candidate.role === "assistant",
  );
  if (!message) return null;
  const marker = z.object({ kind: z.unknown() }).passthrough().safeParse(message.metadata);
  if (!marker.success || marker.data.kind !== "grok.planning_error") return null;

  const metadata = planningFailureMetadataSchema.safeParse(message.metadata);
  if (!metadata.success || message.content !== PLANNING_FAILURE_CONTENT[metadata.data.code]) {
    throw new GrokStoreProjectionError("The durable Grok planning-error message was malformed.");
  }
  const messageEvidence = planningFailureMessageEvidenceSchema.safeParse(message);
  const userMessage = bundle.messages.find(
    (candidate) => candidate.sequence_no === 1 && candidate.role === "user",
  );
  if (
    bundle.session.status !== "blocked"
    || bundle.session.closed_at !== null
    || bundle.session.last_message_sequence !== 2
    || bundle.session.last_event_sequence !== 5
    || bundle.session.version !== 5
    || bundle.next.message_sequence !== 2
    || bundle.next.event_sequence !== 5
    || bundle.messages.length !== 2
    || !userMessage
    || !messageEvidence.success
    || messageEvidence.data.reply_to_message_id !== userMessage.id
  ) {
    throw new GrokStoreProjectionError("The durable Grok planning-error session was not blocked safely.");
  }

  const appendEvent = bundle.events.find(
    (candidate) => candidate.sequence_no === 3 && candidate.event_type === "message.appended",
  );
  const appendEvidence = appendEvent
    ? planningFailureEventEvidenceSchema.safeParse(appendEvent)
    : null;
  const appendPayload = appendEvent ? messageAppendedPayloadSchema.safeParse(appendEvent.payload) : null;
  if (
    !appendEvent
    || appendEvent.session_id !== bundle.session.id
    || appendEvent.correlation_id !== message.id
    || !appendEvidence?.success
    || appendEvidence.data.message_id !== message.id
    || !appendPayload?.success
    || appendPayload.data.message_id !== message.id
  ) {
    throw new GrokStoreProjectionError("The durable Grok planning-error append event was malformed.");
  }

  const event = bundle.events.find(
    (candidate) => candidate.sequence_no === 4 && candidate.event_type === "session.planning_failed",
  );
  const eventEvidence = event ? planningFailureEventEvidenceSchema.safeParse(event) : null;
  const payload = event ? planningFailureEventPayloadSchema.safeParse(event.payload) : null;
  if (
    !event
    || event.correlation_id !== bundle.session.id
    || !eventEvidence?.success
    || eventEvidence.data.message_id !== message.id
    || !payload?.success
    || payload.data.code !== metadata.data.code
    || payload.data.messageId !== message.id
  ) {
    throw new GrokStoreProjectionError("The durable Grok planning-failure event was malformed.");
  }

  const blockedEvent = bundle.events.find(
    (candidate) => candidate.sequence_no === 5 && candidate.event_type === "session.blocked",
  );
  const blockedEvidence = blockedEvent ? blockedEventEvidenceSchema.safeParse(blockedEvent) : null;
  const blockedPayload = blockedEvent ? blockedEventPayloadSchema.safeParse(blockedEvent.payload) : null;
  if (
    bundle.events.length !== 5
    || bundle.task_links.length !== 0
    || bundle.artifact_links.length !== 0
    || !blockedEvent
    || blockedEvent.session_id !== bundle.session.id
    || blockedEvent.correlation_id !== bundle.session.id
    || !blockedEvidence?.success
    || !blockedPayload?.success
  ) {
    throw new GrokStoreProjectionError("The durable Grok session-blocked event was malformed.");
  }
  return { code: metadata.data.code, message: message.content, messageId: message.id };
}

/**
 * Atomically persist the bounded assistant refusal, immutable failure event,
 * and active -> blocked transition. The database replays the exact failure
 * identity before applying its version CAS, so a retry cannot create partial
 * or duplicate evidence even though its observed session version has moved.
 *
 * Only the stable planner code crosses this boundary; the database derives
 * the fixed safe content, while the prompt, details, and provider errors are
 * excluded.
 */
export async function recordGrokPlanningFailure(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    sessionId: string;
    userMessageId: string;
    idempotencyKey: string;
    code: GrokPlannerErrorCode;
    expectedVersion: number;
  }>,
): Promise<PlanningFailureResult> {
  const content = PLANNING_FAILURE_CONTENT[input.code];
  const value = await rpc(client, "record_grok_planning_failure_as_server", {
    p_organization_id: input.organizationId,
    p_session_id: input.sessionId,
    p_user_message_id: input.userMessageId,
    p_error_code: input.code,
    p_idempotency_key: childIdempotencyKey(input.idempotencyKey, "planning-failure"),
    p_expected_version: input.expectedVersion,
  });
  const parsed = planningFailureResultSchema.safeParse(
    oneRow(value, "record_grok_planning_failure_as_server"),
  );
  const metadata = parsed.success
    ? planningFailureMetadataSchema.safeParse(parsed.data.message.metadata)
    : null;
  const messageEvidence = parsed.success
    ? planningFailureMessageEvidenceSchema.safeParse(parsed.data.message)
    : null;
  const eventPayload = parsed.success
    ? planningFailureEventPayloadSchema.safeParse(parsed.data.event.payload)
    : null;
  const eventEvidence = parsed.success
    ? planningFailureEventEvidenceSchema.safeParse(parsed.data.event)
    : null;
  if (
    !parsed.success
    || parsed.data.session.id !== input.sessionId
    || parsed.data.session.status !== "blocked"
    || parsed.data.session.closed_at !== null
    || parsed.data.session.last_message_sequence !== 2
    || parsed.data.session.last_event_sequence !== 5
    || parsed.data.session.version !== input.expectedVersion + 3
    || parsed.data.message.session_id !== input.sessionId
    || parsed.data.message.role !== "assistant"
    || parsed.data.message.sequence_no !== 2
    || parsed.data.message.content !== content
    || !messageEvidence?.success
    || messageEvidence.data.reply_to_message_id !== input.userMessageId
    || !metadata?.success
    || metadata.data.code !== input.code
    || parsed.data.event.session_id !== input.sessionId
    || parsed.data.event.sequence_no !== 4
    || parsed.data.event.event_type !== "session.planning_failed"
    || parsed.data.event.correlation_id !== input.sessionId
    || !eventEvidence?.success
    || eventEvidence.data.message_id !== parsed.data.message.id
    || !eventPayload?.success
    || eventPayload.data.code !== input.code
    || eventPayload.data.messageId !== parsed.data.message.id
  ) {
    throw new GrokStoreProjectionError("The durable Grok planning-failure result was malformed.");
  }
  return parsed.data;
}

export async function recordGrokEvent(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    sessionId: string;
    eventType: "session.planned" | "graph.planned";
    correlationId: string;
    payload: Record<string, unknown>;
    expectedSequence: number;
    messageId: string | null;
    taskLinkId: string | null;
  }>,
): Promise<EventRow> {
  const value = await rpc(client, "record_grok_event_as_server", {
    p_organization_id: input.organizationId,
    p_session_id: input.sessionId,
    p_event_type: input.eventType,
    p_correlation_id: input.correlationId,
    p_payload: input.payload,
    p_expected_sequence: input.expectedSequence,
    p_message_id: input.messageId,
    p_task_link_id: input.taskLinkId,
  });
  const parsed = eventRowSchema.safeParse(oneRow(value, "record_grok_event_as_server"));
  if (!parsed.success || parsed.data.event_type !== input.eventType) {
    throw new GrokStoreProjectionError("The durable Grok event was malformed.");
  }
  return parsed.data;
}

export async function readGrokBundle(
  client: SupabaseClient,
  organizationId: string,
  sessionId: string,
): Promise<ReadBundle> {
  const value = await rpc<unknown>(client, "read_grok_session", {
    p_organization_id: organizationId,
    p_session_id: sessionId,
    p_after_message_sequence: 0,
    p_after_event_sequence: 0,
    p_limit: 200,
  });
  const parsed = readBundleSchema.safeParse(value);
  if (!parsed.success) throw new GrokStoreProjectionError("The Grok session projection was malformed.");
  const first = parsed.data;
  const snapshotLastSequence = first.session.last_event_sequence;
  const hasExactEventWindow = (
    events: readonly EventRow[],
    firstSequence: number,
    lastSequence: number,
  ) => events.length === Math.max(0, lastSequence - firstSequence + 1)
    && events.every((event, index) => event.sequence_no === firstSequence + index);
  if (snapshotLastSequence <= 200) {
    if (!hasExactEventWindow(first.events, 1, snapshotLastSequence)) {
      throw new GrokStoreProjectionError("The Grok session event window was incomplete.");
    }
    return first;
  }

  // read_grok_session is cursor-based and returns the oldest page. Fetch the
  // bounded tail explicitly so the workspace never hides newer control/audit
  // truth behind a long-lived session's first 200 events.
  const tailValue = await rpc<unknown>(client, "read_grok_session", {
    p_organization_id: organizationId,
    p_session_id: sessionId,
    p_after_message_sequence: 0,
    p_after_event_sequence: snapshotLastSequence - 200,
    p_limit: 200,
  });
  const tail = readBundleSchema.safeParse(tailValue);
  if (
    !tail.success
    || tail.data.session.id !== first.session.id
    || tail.data.session.organization_id !== first.session.organization_id
    || tail.data.session.project_id !== first.session.project_id
    || tail.data.session.last_event_sequence < snapshotLastSequence
  ) {
    throw new GrokStoreProjectionError("The Grok session event tail was malformed.");
  }
  const events = tail.data.events.filter(
    (event) => event.sequence_no <= snapshotLastSequence,
  );
  const firstTailSequence = snapshotLastSequence - 199;
  if (!hasExactEventWindow(events, firstTailSequence, snapshotLastSequence)) {
    throw new GrokStoreProjectionError("The Grok session event tail was incomplete.");
  }
  return {
    ...first,
    events,
    events_truncated: true,
  };
}

export function storedGrokPlan(bundle: ReadBundle): GrokChiefOfStaffPlan | null {
  const assistant = bundle.messages.find((message) => message.sequence_no === 2 && message.role === "assistant");
  const metadata = z.object({ kind: z.literal("grok.plan"), plan: storedPlanSchema }).passthrough()
    .safeParse(assistant?.metadata);
  return metadata.success ? metadata.data.plan as unknown as GrokChiefOfStaffPlan : null;
}

export function plannedGraphLink(bundle: ReadBundle): TaskLinkRow | null {
  return bundle.task_links.find((link) => link.relation === "planned" && link.graph_id !== null) ?? null;
}

export async function listGrokSessionRows(
  client: SupabaseClient,
  organizationId: string,
  projectId: string | null,
  limit: number,
): Promise<readonly z.infer<typeof listRowSchema>[]> {
  const value = await rpc<unknown>(client, "list_grok_sessions", {
    p_organization_id: organizationId,
    p_project_id: projectId,
    p_limit: limit,
    p_before_created_at: null,
    p_before_id: null,
  });
  const parsed = z.array(listRowSchema).max(50).safeParse(value ?? []);
  if (!parsed.success) throw new GrokStoreProjectionError("The Grok session list was malformed.");
  return parsed.data;
}

const listRowSchema = z.object({
  session_id: z.string().uuid(),
  project_id: z.string().uuid(),
  project_name: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  status: z.enum([
    "active", "blocked", "planned", "paused", "running", "completed",
    "failed", "cancelled", "stopped", "budget_stopped", "archived",
  ]),
  last_message_sequence: z.coerce.number().int().nonnegative(),
  last_event_sequence: z.coerce.number().int().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export function mapGrokSessionList(rows: readonly z.infer<typeof listRowSchema>[]): readonly GrokSession[] {
  return rows.map((row) => Object.freeze({
    id: row.session_id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    // The list projection intentionally does not duplicate message content or
    // task links. Empty/null means "load detail", never an invented summary.
    goal: "",
    status: row.status,
    commandId: null,
    graphId: null,
    graphRunId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    allowedActions: Object.freeze([]),
  }));
}

type GraphEvidence = Readonly<{
  graphId: string;
  goal: string;
  pausedAt: string | null;
  withdrawnAt: string | null;
  runId: string | null;
  runState: string | null;
  run: Readonly<{
    closureNote: string | null;
    startedAt: string | null;
    completedAt: string | null;
    tokensUsed: number | null;
    costMicros: number | null;
  }> | null;
  tasks: readonly Readonly<{
    id: string;
    key: string;
    job: string;
    state: string | null;
    provider: "anthropic" | "openai" | null;
    model: string | null;
    attempt: number | null;
  }>[];
  artifacts: readonly Readonly<{
    id: string;
    nodeKey: string | null;
    kind: string;
    payload: unknown;
    createdAt: string;
  }>[];
  events: readonly Readonly<{
    id: string;
    type: string;
    detail: string;
    nodeKey: string | null;
    createdAt: string;
  }>[];
  eventsTruncated: boolean;
}>;

const GRAPH_EVENT_LIMIT = 500;

const graphArtifactRowSchema = z.object({
  artifact_id: z.string().uuid(),
  node_run_id: z.string().uuid().nullable(),
  node_key: z.string().nullable(),
  kind: z.string().min(1),
  payload: z.unknown(),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();

function artifactLabel(kind: string, nodeKey: string | null, payload: unknown): string {
  const observation = z.object({ observation: z.string().min(1).max(160) }).passthrough()
    .safeParse(payload);
  if (observation.success) return observation.data.observation.replaceAll("_", " ");
  return nodeKey ? `${nodeKey} · ${kind}` : kind;
}

async function readGraphEvidence(
  client: SupabaseClient,
  organizationId: string,
  graphId: string,
  graphRunId: string | null,
): Promise<GraphEvidence> {
  let graphRead = await client.from("graphs")
    .select("id,goal,pause_requested_at,withdrawn_at")
    .eq("organization_id", organizationId).eq("id", graphId).maybeSingle();
  if (graphRead.error?.code === "42703") {
    graphRead = await client.from("graphs").select("id,goal")
      .eq("organization_id", organizationId).eq("id", graphId).maybeSingle();
  }
  if (graphRead.error) throw new GrokStoreDatabaseError(graphRead.error);
  const graph = z.object({
    id: z.string().uuid(), goal: z.string().min(1).max(4_000),
    pause_requested_at: z.string().nullable().optional(),
    withdrawn_at: z.string().nullable().optional(),
  }).passthrough().safeParse(graphRead.data);
  if (!graph.success || graph.data.id !== graphId) {
    throw new GrokStoreProjectionError("The linked Grok graph was unavailable.");
  }

  const runQuery = client.from("graph_runs")
    .select("id,state,closure_note,started_at,completed_at,tokens_used,cost_micros,created_at")
    .eq("organization_id", organizationId).eq("graph_id", graphId);
  const [runRead, nodeRead] = await Promise.all([
    graphRunId
      ? runQuery.eq("id", graphRunId).maybeSingle()
      : runQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    client.from("graph_nodes").select("id,node_key,job")
      .eq("organization_id", organizationId).eq("graph_id", graphId)
      .order("node_key", { ascending: true }),
  ]);
  if (runRead.error) throw new GrokStoreDatabaseError(runRead.error);
  if (nodeRead.error) throw new GrokStoreDatabaseError(nodeRead.error);
  const run = z.object({
    id: z.string().uuid(), state: z.string().min(1),
    closure_note: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    tokens_used: z.coerce.number().int().nonnegative().nullable().optional(),
    cost_micros: z.coerce.number().int().nonnegative().nullable().optional(),
  }).passthrough()
    .nullable().safeParse(runRead.data);
  const nodes = z.array(z.object({
    id: z.string().uuid(), node_key: z.string().min(1), job: z.string().min(1),
  }).strict()).max(50).safeParse(nodeRead.data ?? []);
  if (!run.success || !nodes.success) throw new GrokStoreProjectionError("The linked graph evidence was malformed.");

  let nodeRuns: Array<{
    id?: string; node_id: string; state: string; provider: string | null;
    model: string | null; attempt?: number;
  }> = [];
  let artifacts: z.infer<typeof graphArtifactRowSchema>[] = [];
  let graphEvents: Array<{
    id: string; event_type: string; detail: string | null; node_run_id: string | null; created_at: string;
  }> = [];
  let parsedEventsWereTruncated = false;
  if (run.data) {
    const [nodeRunRead, artifactRead, eventRead] = await Promise.all([
      client.from("node_runs")
        .select("id,node_id,state,provider,model,attempt")
        .eq("organization_id", organizationId).eq("graph_run_id", run.data.id),
      client.rpc("list_graph_run_artifacts", {
        p_organization_id: organizationId,
        p_graph_run_id: run.data.id,
      }),
      client.from("graph_events")
        .select("id,event_type,detail,node_run_id,created_at")
        .eq("organization_id", organizationId).eq("graph_run_id", run.data.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(GRAPH_EVENT_LIMIT + 1),
    ]);
    if (nodeRunRead.error) throw new GrokStoreDatabaseError(nodeRunRead.error);
    if (artifactRead.error) throw new GrokStoreDatabaseError(artifactRead.error);
    if (eventRead.error) throw new GrokStoreDatabaseError(eventRead.error);
    const parsed = z.array(z.object({
      id: z.string().uuid().optional(),
      node_id: z.string().uuid(), state: z.string().min(1),
      provider: z.string().nullable(), model: z.string().nullable(),
      attempt: z.coerce.number().int().nonnegative().optional(),
    }).strict()).max(50).safeParse(nodeRunRead.data ?? []);
    const parsedArtifacts = z.array(graphArtifactRowSchema).max(500).safeParse(artifactRead.data ?? []);
    const parsedEvents = z.array(z.object({
      id: z.string().uuid(), event_type: z.string().min(1), detail: z.string().nullable(),
      node_run_id: z.string().uuid().nullable(), created_at: z.string().datetime({ offset: true }),
    }).strict()).max(GRAPH_EVENT_LIMIT + 1).safeParse(eventRead.data ?? []);
    if (!parsed.success || !parsedArtifacts.success || !parsedEvents.success) {
      throw new GrokStoreProjectionError("The graph run evidence was malformed.");
    }
    nodeRuns = parsed.data;
    artifacts = parsedArtifacts.data;
    // Keep the newest bounded slice, then restore chronological reading order.
    parsedEventsWereTruncated = parsedEvents.data.length > GRAPH_EVENT_LIMIT;
    graphEvents = parsedEvents.data.slice(0, GRAPH_EVENT_LIMIT).reverse();
  }
  // A node may have multiple attempts. Never let database physical order pick
  // the displayed state/provider/model: project the greatest durable attempt,
  // with id only as a deterministic tie-breaker for malformed legacy rows.
  const runByNode = new Map<string, (typeof nodeRuns)[number]>();
  for (const candidate of nodeRuns) {
    const current = runByNode.get(candidate.node_id);
    const candidateAttempt = candidate.attempt ?? -1;
    const currentAttempt = current?.attempt ?? -1;
    if (
      !current
      || candidateAttempt > currentAttempt
      || (candidateAttempt === currentAttempt && (candidate.id ?? "") > (current.id ?? ""))
    ) runByNode.set(candidate.node_id, candidate);
  }
  const nodeKeyByRun = new Map(nodeRuns.flatMap((item) => {
    const node = nodes.data.find((candidate) => candidate.id === item.node_id);
    return item.id && node ? [[item.id, node.node_key] as const] : [];
  }));
  return Object.freeze({
    graphId,
    goal: graph.data.goal,
    pausedAt: graph.data.pause_requested_at ?? null,
    withdrawnAt: graph.data.withdrawn_at ?? null,
    runId: run.data?.id ?? null,
    runState: run.data?.state ?? null,
    run: run.data ? Object.freeze({
      closureNote: run.data.closure_note ?? null,
      startedAt: run.data.started_at ?? null,
      completedAt: run.data.completed_at ?? null,
      tokensUsed: run.data.tokens_used ?? null,
      costMicros: run.data.cost_micros ?? null,
    }) : null,
    tasks: Object.freeze(nodes.data.map((node) => {
      const nodeRun = runByNode.get(node.id);
      return Object.freeze({
        id: node.id, key: node.node_key, job: node.job,
        state: nodeRun?.state ?? null,
        provider: nodeRun?.provider === "anthropic" || nodeRun?.provider === "openai"
          ? nodeRun.provider : null,
        model: nodeRun?.model ?? null,
        attempt: nodeRun?.attempt ?? null,
      });
    })),
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze({
      id: artifact.artifact_id,
      nodeKey: artifact.node_key,
      kind: artifact.kind,
      payload: artifact.payload,
      createdAt: artifact.created_at,
    }))),
    events: Object.freeze(graphEvents.map((event) => Object.freeze({
      id: event.id,
      type: event.event_type,
      detail: event.detail ?? event.event_type,
      nodeKey: event.node_run_id ? nodeKeyByRun.get(event.node_run_id) ?? null : null,
      createdAt: event.created_at,
    }))),
    eventsTruncated: parsedEventsWereTruncated,
  });
}

function allowedActions(evidence: GraphEvidence | null): readonly GrokControlAction[] {
  if (!evidence || evidence.withdrawnAt) return Object.freeze([]);
  const actions: GrokControlAction[] = [evidence.pausedAt ? "resume" : "pause"];
  // Stop is graph-backed. Cancel and Retry require an exact Phase 1C bridge
  // agent-run identity; graph-run state alone is not eligibility evidence.
  // The audited withdraw boundary refuses a graph while any run is RUNNING,
  // so do not advertise a control that cannot commit in that state.
  if (evidence.runState?.toUpperCase() !== "RUNNING") actions.push("stop");
  return Object.freeze(actions);
}

function sessionStatus(session: SessionRow, evidence: GraphEvidence | null, hasPlan: boolean): string {
  if (session.status !== "active") return session.status;
  if (evidence?.withdrawnAt) return "stopped";
  // A pause request is the current graph control-plane truth even while the
  // last durable run still says RUNNING.  Keep detail projection aligned with
  // list_grok_sessions (and with the Resume-only control set) so the workspace
  // never presents a paused graph as actively executing.
  if (evidence?.pausedAt) return "paused";
  if (evidence?.runState) return evidence.runState.toLowerCase();
  if (evidence) return "planned";
  return hasPlan ? "blocked" : "active";
}

function eventDetail(event: EventRow): string {
  const payload = z.object({ detail: z.string().min(1).max(2_000).optional() }).passthrough()
    .safeParse(event.payload);
  if (payload.success && payload.data.detail) return payload.data.detail;
  if (event.event_type === "session.planned") return "The deterministic chief-of-staff plan was recorded.";
  if (event.event_type === "session.planning_failed") return "Planning was blocked before any graph or worker dispatch.";
  if (event.event_type === "graph.planned") return "The dependency graph was recorded in PLANNED state.";
  return event.event_type;
}

export async function mapGrokSessionDetail(
  client: SupabaseClient,
  organizationId: string,
  projectName: string,
  bundle: ReadBundle,
): Promise<GrokSessionDetail> {
  const plan = storedGrokPlan(bundle);
  const link = plannedGraphLink(bundle);
  const evidence = link?.graph_id
    ? await readGraphEvidence(client, organizationId, link.graph_id, link.graph_run_id)
    : null;
  const userMessage = bundle.messages.find((message) => message.role === "user");
  const plannedByKey = new Map(plan?.dag.tasks.map((task) => [task.id, task]) ?? []);
  const taskEvidence = evidence?.tasks ?? [];
  const tasks: readonly GrokTask[] = taskEvidence.length > 0
    ? taskEvidence.map((task) => {
        const planned = plannedByKey.get(task.key);
        return Object.freeze({
          id: task.id,
          taskKey: task.key,
          title: planned?.title ?? task.job,
          status: (task.state ?? "planned").toLowerCase(),
          // Runtime provider/model are execution evidence. Planned route
          // identity must never be substituted when no node run exists.
          provider: task.provider,
          model: task.model,
          agentName: null,
          attempt: task.attempt,
          dependsOn: Object.freeze([...(planned?.dependsOn ?? [])]),
        });
      })
    : Object.freeze((plan?.dag.tasks ?? []).map((task) => Object.freeze({
        id: task.id,
        taskKey: task.id,
        title: task.title,
        status: "pending_graph",
        provider: task.provider,
        model: task.model,
        agentName: task.agentName,
        dependsOn: Object.freeze([...task.dependsOn]),
      })));
  const latest = [...bundle.task_links].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  ).at(-1);
  const session: GrokSession = Object.freeze({
    id: bundle.session.id,
    projectId: bundle.session.project_id,
    projectName,
    title: bundle.session.title,
    goal: evidence?.goal ?? userMessage?.content ?? "",
    status: sessionStatus(bundle.session, evidence, plan !== null),
    commandId: latest?.command_id ?? null,
    graphId: evidence?.graphId ?? link?.graph_id ?? null,
    graphRunId: evidence?.runId ?? latest?.graph_run_id ?? null,
    createdAt: bundle.session.created_at,
    updatedAt: bundle.session.updated_at,
    allowedActions: allowedActions(evidence),
  });
  const messages: readonly GrokMessage[] = bundle.messages.map((message) => Object.freeze({
    id: message.id, role: message.role, content: message.content, createdAt: message.created_at,
  }));
  const events: readonly GrokEvent[] = bundle.events.map((event) => Object.freeze({
    id: event.id, type: event.event_type, detail: eventDetail(event), createdAt: event.occurred_at,
  }));
  const artifacts: readonly GrokArtifact[] = bundle.artifact_links.map((artifact) => Object.freeze({
    id: artifact.id,
    kind: artifact.kind,
    label: artifact.label,
    uri: artifact.uri ?? null,
    createdAt: artifact.created_at,
  }));
  const graphArtifacts: readonly GrokArtifact[] = (evidence?.artifacts ?? []).map((artifact) => Object.freeze({
    id: artifact.id,
    kind: artifact.kind,
    label: artifactLabel(artifact.kind, artifact.nodeKey, artifact.payload),
    uri: null,
    nodeKey: artifact.nodeKey,
    createdAt: artifact.createdAt,
  }));
  const total = evidence?.tasks.length ?? 0;
  // SKIPPED is terminal accounting, not completed work (paused/failed runs
  // close undispatched nodes as SKIPPED), so it must not inflate this label.
  const completed = evidence?.tasks.filter(
    (task) => task.state?.toUpperCase() === "COMPLETED",
  ).length ?? 0;
  const runEvidence = evidence?.run && evidence.runState ? Object.freeze({
    state: evidence.runState,
    closureNote: evidence.run.closureNote,
    startedAt: evidence.run.startedAt,
    completedAt: evidence.run.completedAt,
    tokensUsed: evidence.run.tokensUsed,
    costMicros: evidence.run.costMicros,
    progress: Object.freeze({
      completed,
      total,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    }),
    events: evidence.events,
    eventsTruncated: evidence.eventsTruncated,
    release: deriveReleaseEvidence(evidence.artifacts),
  }) : null;
  return Object.freeze({
    session, messages, tasks, events,
    eventsTruncated: bundle.events_truncated ?? false,
    artifacts: Object.freeze([...artifacts, ...graphArtifacts]),
    runEvidence,
  });
}
