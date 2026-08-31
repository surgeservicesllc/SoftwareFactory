import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { assignmentPostingIsConfigured } from "@/lib/bots/assignment-config";
import { loadBotFabric } from "@/lib/bots/service";
import type { BotFabricSnapshot, SerializedBotRole } from "@/lib/bots/types";
import {
  GROK_PLAN_VERSION,
  type GrokChiefOfStaffPlan,
  type GrokConfiguredAgent,
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
import { GRAPH_TOPOLOGIES } from "@/lib/graph/types";

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
  status: z.enum(["active", "completed", "cancelled", "archived"]),
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
  control_intents: z.array(z.unknown()).max(200),
  next: z.object({
    message_sequence: z.coerce.number().int().nonnegative(),
    event_sequence: z.coerce.number().int().nonnegative(),
  }).passthrough(),
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
  dependsOn: z.array(z.string().min(1).max(120)).max(50),
}).passthrough();

const storedPlanSchema = z.object({
  planner: z.object({ version: z.literal(GROK_PLAN_VERSION) }).passthrough(),
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

export async function requestGrokControlIntent(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    sessionId: string;
    targetKind: "graph" | "graph_run";
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

export function configuredGrokAgents(
  fabric: BotFabricSnapshot,
  projectId: string,
): readonly GrokConfiguredAgent[] {
  if (fabric.assignmentsComplete !== true) {
    throw new GrokStoreProjectionError("The configured bot roster is incomplete.");
  }
  const botById = new Map(fabric.bots.map((bot) => [bot.id, bot]));
  const roleById = new Map(fabric.roles.map((role) => [role.id, role]));
  const agents: GrokConfiguredAgent[] = [];
  for (const assignment of fabric.assignments) {
    if (assignment.projectId !== projectId || assignment.status !== "active") continue;
    const bot = botById.get(assignment.botId);
    const role = roleById.get(assignment.roleId);
    if (!bot || !role || (bot.provider !== "anthropic" && bot.provider !== "openai")) continue;
    if (bot.currentReadiness !== "ready" || !assignmentPostingIsConfigured({
      config: assignment.config,
      model: assignment.model,
      workEffort: assignment.workEffort,
    })) continue;
    const capabilities = rosterCapabilities(role);
    if (capabilities.length === 0) continue;
    agents.push(Object.freeze({
      id: assignment.id,
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
  return configuredGrokAgents(await loadBotFabric(client, organizationId), projectId);
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
  return parsed.data;
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
  tasks: readonly Readonly<{
    id: string;
    key: string;
    job: string;
    state: string | null;
    provider: "anthropic" | "openai" | null;
    model: string | null;
  }>[];
}>;

async function readGraphEvidence(
  client: SupabaseClient,
  organizationId: string,
  graphId: string,
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

  const [runRead, nodeRead] = await Promise.all([
    client.from("graph_runs").select("id,state,created_at")
      .eq("organization_id", organizationId).eq("graph_id", graphId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("graph_nodes").select("id,node_key,job")
      .eq("organization_id", organizationId).eq("graph_id", graphId)
      .order("node_key", { ascending: true }),
  ]);
  if (runRead.error) throw new GrokStoreDatabaseError(runRead.error);
  if (nodeRead.error) throw new GrokStoreDatabaseError(nodeRead.error);
  const run = z.object({ id: z.string().uuid(), state: z.string().min(1) }).passthrough()
    .nullable().safeParse(runRead.data);
  const nodes = z.array(z.object({
    id: z.string().uuid(), node_key: z.string().min(1), job: z.string().min(1),
  }).strict()).max(50).safeParse(nodeRead.data ?? []);
  if (!run.success || !nodes.success) throw new GrokStoreProjectionError("The linked graph evidence was malformed.");

  let nodeRuns: Array<{ node_id: string; state: string; provider: string | null; model: string | null }> = [];
  if (run.data) {
    const nodeRunRead = await client.from("node_runs")
      .select("node_id,state,provider,model")
      .eq("organization_id", organizationId).eq("graph_run_id", run.data.id);
    if (nodeRunRead.error) throw new GrokStoreDatabaseError(nodeRunRead.error);
    const parsed = z.array(z.object({
      node_id: z.string().uuid(), state: z.string().min(1),
      provider: z.string().nullable(), model: z.string().nullable(),
    }).strict()).max(50).safeParse(nodeRunRead.data ?? []);
    if (!parsed.success) throw new GrokStoreProjectionError("The graph node-run evidence was malformed.");
    nodeRuns = parsed.data;
  }
  const runByNode = new Map(nodeRuns.map((item) => [item.node_id, item]));
  return Object.freeze({
    graphId,
    goal: graph.data.goal,
    pausedAt: graph.data.pause_requested_at ?? null,
    withdrawnAt: graph.data.withdrawn_at ?? null,
    runId: run.data?.id ?? null,
    runState: run.data?.state ?? null,
    tasks: Object.freeze(nodes.data.map((node) => {
      const nodeRun = runByNode.get(node.id);
      return Object.freeze({
        id: node.id, key: node.node_key, job: node.job,
        state: nodeRun?.state ?? null,
        provider: nodeRun?.provider === "anthropic" || nodeRun?.provider === "openai"
          ? nodeRun.provider : null,
        model: nodeRun?.model ?? null,
      });
    })),
  });
}

function allowedActions(evidence: GraphEvidence | null): readonly GrokControlAction[] {
  if (!evidence || evidence.withdrawnAt) return Object.freeze([]);
  const actions: GrokControlAction[] = [evidence.pausedAt ? "resume" : "pause"];
  const runState = evidence.runState?.toUpperCase() ?? null;
  if (runState === "RUNNING" || runState === "QUEUED") actions.push("cancel");
  else actions.push("stop");
  if (runState && ["FAILED", "CANCELLED", "BUDGET_STOPPED"].includes(runState)) actions.push("retry");
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
    ? await readGraphEvidence(client, organizationId, link.graph_id)
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
  return Object.freeze({ session, messages, tasks, events, artifacts });
}
