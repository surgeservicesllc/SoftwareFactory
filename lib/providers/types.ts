/**
 * Provider-neutral execution contracts for the SoftwareFactory AI layer.
 *
 * Nothing in this module is provider-specific. A logical agent is routed to a
 * provider and a model; the provider executes a bounded advisory task and
 * returns a structured, auditable result.
 *
 * Phase 2A scope boundary: a provider run reads a task description and returns
 * an analysis artifact. It never writes to a repository, merges, deploys, or
 * approves anything. Repository changes remain owner-driven through the
 * existing branch + commit + draft-pull-request flow.
 */

export const PROVIDER_IDS = ["anthropic", "openai"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Human-facing provider labels. Never a provider account or login name. */
export const PROVIDER_LABELS = Object.freeze({
  anthropic: "Anthropic / Claude",
  openai: "OpenAI / Codex",
} satisfies Record<ProviderId, string>);

/**
 * Capabilities are declared by an adapter and required by a task kind. A
 * provider that does not declare a required capability is never selected,
 * regardless of policy or owner override.
 */
export const PROVIDER_CAPABILITIES = [
  "planning",
  "architecture_analysis",
  "code_authoring",
  "code_review",
  "security_review",
  "qa_analysis",
  "reporting",
  "structured_output",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/** Advisory task kinds a Phase 2A provider run may execute. */
export const PROVIDER_TASK_KINDS = [
  "plan",
  "architecture_review",
  "implementation_proposal",
  "implementation_review",
  "security_review",
  "qa_assessment",
  "status_report",
] as const;

export type ProviderTaskKind = (typeof PROVIDER_TASK_KINDS)[number];

export function isProviderTaskKind(value: unknown): value is ProviderTaskKind {
  return (
    typeof value === "string" &&
    (PROVIDER_TASK_KINDS as readonly string[]).includes(value)
  );
}

/** The capabilities each task kind requires before a provider may run it. */
export const TASK_KIND_REQUIRED_CAPABILITIES = Object.freeze({
  plan: Object.freeze(["planning", "structured_output"]),
  architecture_review: Object.freeze(["architecture_analysis", "structured_output"]),
  implementation_proposal: Object.freeze(["code_authoring", "structured_output"]),
  implementation_review: Object.freeze(["code_review", "structured_output"]),
  security_review: Object.freeze(["security_review", "structured_output"]),
  qa_assessment: Object.freeze(["qa_analysis", "structured_output"]),
  status_report: Object.freeze(["reporting", "structured_output"]),
} satisfies Record<ProviderTaskKind, readonly ProviderCapability[]>);

/**
 * Whether a task kind is an independent-review step. Review steps carry the
 * reviewer-independence rule enforced in `lib/providers/workflow.ts`.
 */
export const REVIEW_TASK_KINDS = Object.freeze([
  "architecture_review",
  "implementation_review",
  "security_review",
  "qa_assessment",
] as const satisfies readonly ProviderTaskKind[]);

export function isReviewTaskKind(taskKind: ProviderTaskKind): boolean {
  return (REVIEW_TASK_KINDS as readonly ProviderTaskKind[]).includes(taskKind);
}

/** Logical agent roles. Mirrors the `public.agent_role` database enum. */
export const AGENT_ROLES = [
  "orchestrator",
  "product",
  "architect",
  "frontend",
  "backend",
  "database",
  "qa",
  "security",
  "performance",
  "release",
  "ceo_reporter",
  "custom",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

export type ProviderRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Live connection state for a provider. These are the only four strings the
 * UI may show; anything unproven is `not_configured`.
 */
export type ProviderConnectionState =
  | "not_configured"
  | "connected"
  | "error"
  | "disabled";

export const PROVIDER_CONNECTION_STATE_LABELS = Object.freeze({
  not_configured: "Not Configured",
  connected: "Connected",
  error: "Error",
  disabled: "Disabled",
} satisfies Record<ProviderConnectionState, string>);

export interface ProviderModel {
  readonly id: string;
  readonly displayName: string;
  /** Maximum context window in tokens when the provider publishes one. */
  readonly maxInputTokens: number | null;
  /** Maximum output tokens when the provider publishes one. */
  readonly maxOutputTokens: number | null;
}

export interface ProviderHealth {
  readonly provider: ProviderId;
  readonly state: ProviderConnectionState;
  readonly checkedAt: string;
  /** Short, secret-free explanation suitable for the browser. */
  readonly detail: string;
  /** Round-trip latency of the health probe, when one was performed. */
  readonly latencyMs: number | null;
  /** The model the adapter would use when a caller does not name one. */
  readonly defaultModel: string | null;
}

/** Structured, bounded context handed to a provider. Never contains secrets. */
export interface ProviderRunContext {
  readonly projectName: string;
  readonly repositoryFullName: string | null;
  readonly defaultBranch: string | null;
  readonly riskLevel: "GREEN" | "YELLOW" | "RED";
  /**
   * Prior structured artifacts produced by earlier workflow steps. This is how
   * agents exchange work: through SoftwareFactory records, never through a
   * shared provider chat history.
   */
  readonly priorArtifacts: readonly ProviderArtifactSummary[];
  /** Repository memory excerpts (AGENTS.md, /AI, /policies) already redacted. */
  readonly memoryExcerpts: readonly ProviderMemoryExcerpt[];
}

export interface ProviderMemoryExcerpt {
  readonly path: string;
  readonly excerpt: string;
}

export interface ProviderArtifactSummary {
  readonly taskKind: ProviderTaskKind;
  readonly agentRole: AgentRole;
  readonly agentId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly runId: string;
  readonly summary: string;
}

export interface ProviderRunRequest {
  /** SoftwareFactory run identifier. Correlates provider work to audit rows. */
  readonly runId: string;
  readonly taskKind: ProviderTaskKind;
  readonly agentRole: AgentRole;
  readonly agentId: string;
  /** The bounded objective. Validated and secret-scanned before it gets here. */
  readonly instructions: string;
  readonly context: ProviderRunContext;
  /** Resolved by routing; the adapter must not silently substitute another. */
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

/** The structured artifact every advisory provider run must return. */
export interface ProviderStructuredResult {
  readonly summary: string;
  readonly findings: readonly ProviderFinding[];
  readonly recommendations: readonly string[];
  /** The model's own confidence in the artifact. */
  readonly confidence: "low" | "medium" | "high";
  /** Set when the model judged the task unanswerable from the given context. */
  readonly blocked: boolean;
  readonly blockedReason: string | null;
}

export interface ProviderFinding {
  readonly title: string;
  readonly detail: string;
  readonly severity: "info" | "low" | "medium" | "high";
}

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number | null;
  /**
   * Estimated cost in micro-USD from the declared model price table. Null when
   * no price is declared for the model; never presented as billing truth.
   */
  readonly estimatedCostMicros: number | null;
}

export interface ProviderRunHandle {
  readonly provider: ProviderId;
  readonly model: string;
  /** The provider's own identifier for the request, when it exposes one. */
  readonly providerRunId: string | null;
  readonly status: ProviderRunStatus;
  readonly startedAt: string;
}

export interface ProviderRunEvent {
  readonly sequence: number;
  readonly at: string;
  readonly type:
    | "run_created"
    | "request_sent"
    | "response_received"
    | "run_succeeded"
    | "run_failed"
    | "run_cancelled";
  readonly message: string;
}

export interface ProviderRunFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
}

export interface ProviderRunResult {
  readonly provider: ProviderId;
  readonly model: string;
  readonly providerRunId: string | null;
  readonly status: ProviderRunStatus;
  readonly output: ProviderStructuredResult | null;
  readonly usage: ProviderUsage | null;
  readonly latencyMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly error: ProviderRunFailure | null;
  readonly events: readonly ProviderRunEvent[];
}

/**
 * The contract every provider adapter implements.
 *
 * Lifetime note: `createRun` starts the provider call and registers the run in
 * an in-process registry so `getRun`, `listEvents`, `getResult` and `cancelRun`
 * can address it. That registry lives for the lifetime of the server process
 * only. Durable run state is the caller's responsibility and is persisted by
 * `lib/providers/runtime.ts` into `public.agent_runs` and
 * `public.provider_run_events`.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];
  /** Null when the owner has not configured a model for this provider. */
  readonly defaultModel: string | null;

  checkHealth(): Promise<ProviderHealth>;
  listModels(): Promise<readonly ProviderModel[]>;

  createRun(request: ProviderRunRequest): Promise<ProviderRunHandle>;
  getRun(runId: string): ProviderRunHandle | null;
  listEvents(runId: string): readonly ProviderRunEvent[];
  /** Resolves when the run reaches a terminal state. */
  getResult(runId: string): Promise<ProviderRunResult>;
  /** Best effort. Returns false when the run is unknown or already terminal. */
  cancelRun(runId: string): boolean;
}
