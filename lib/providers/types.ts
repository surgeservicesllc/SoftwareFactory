import type { RiskFactor } from "@/lib/risk";

/**
 * Provider-neutral worker contract.
 *
 * An agent is an operating role, not a provider account. A provider adapter
 * translates one bounded engineering request into a specific vendor API and
 * returns a normalized structured result. Adapters never touch the database,
 * never write to a repository, and never return credential material.
 */

export type ProviderRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ProviderConfigurationState =
  | "connected"
  | "configured"
  | "not_connected"
  | "unavailable"
  | "disabled";

export type ProviderConfigurationStatus = {
  /** Truthful label for the Connections surface. */
  readonly state: ProviderConfigurationState;
  readonly label: string;
  readonly detail: string;
  /** Exact owner action when the provider needs configuration. */
  readonly ownerAction: string | null;
};

/** A single file the worker proposes to change. Content is never persisted. */
export type ProposedFileChange = {
  readonly path: string;
  readonly action: "create" | "update";
  readonly content: string;
  /** Required for `update` so a stale edit cannot silently overwrite newer work. */
  readonly expectedSha: string | null;
  readonly summary: string;
};

export type WorkerRunResult = {
  readonly summary: string;
  readonly changes: readonly ProposedFileChange[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly securityFindings: readonly string[];
  readonly riskFactors: readonly RiskFactor[];
  readonly nextRecommendation: string | null;
};

export type RepositoryContextFile = {
  readonly path: string;
  readonly content: string;
  /** Blob SHA when known, so the worker can propose a safe expected-SHA edit. */
  readonly sha: string | null;
  readonly truncated: boolean;
};

export type WorkerRunRequest = {
  readonly runId: string;
  readonly objective: string;
  readonly acceptanceCriteria: string | null;
  readonly workType: string;
  readonly repository: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly model: string;
  readonly protectedPathGuidance: readonly string[];
  readonly memory: readonly RepositoryContextFile[];
  readonly files: readonly RepositoryContextFile[];
  /** Real validation evidence from a previous attempt, for the repair loop. */
  readonly priorFailure: {
    readonly kind: "test" | "ci";
    readonly summary: string;
    readonly details: readonly string[];
  } | null;
  readonly maxOutputTokens: number;
};

export type WorkerRunHandle = {
  readonly providerKey: string;
  readonly externalRunId: string;
  readonly model: string;
};

export type WorkerRunSnapshot = {
  readonly status: ProviderRunStatus;
  readonly handle: WorkerRunHandle;
  /** Set when the provider reported a terminal error. */
  readonly errorMessage: string | null;
  /** Concise, non-chain-of-thought progress labels safe to persist. */
  readonly progress: readonly string[];
};

export class ProviderError extends Error {
  readonly code:
    | "provider_not_configured"
    | "provider_outage"
    | "provider_rate_limit"
    | "provider_invalid_output"
    | "provider_rejected"
    | "provider_cancelled";
  readonly retryable: boolean;

  constructor(code: ProviderError["code"], message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface WorkerProvider {
  readonly key: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  /** True only when server-side credentials are present. Never inspect them. */
  isConfigured(): boolean;
  describeConfiguration(): ProviderConfigurationStatus;
  createRun(request: WorkerRunRequest): Promise<WorkerRunHandle>;
  getRun(handle: WorkerRunHandle): Promise<WorkerRunSnapshot>;
  cancelRun(handle: WorkerRunHandle): Promise<void>;
  getResult(handle: WorkerRunHandle): Promise<WorkerRunResult>;
}
