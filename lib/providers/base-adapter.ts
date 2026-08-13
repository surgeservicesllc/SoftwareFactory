import "server-only";

import { assertPromptWithinBounds, buildSystemPrompt, buildTaskPrompt, parseProviderResult } from "@/lib/providers/contract";
import { ProviderError, toProviderError } from "@/lib/providers/errors";
import { buildUsage } from "@/lib/providers/usage";
import {
  TASK_KIND_REQUIRED_CAPABILITIES,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderHealth,
  type ProviderId,
  type ProviderModel,
  type ProviderRunEvent,
  type ProviderRunHandle,
  type ProviderRunRequest,
  type ProviderRunResult,
  type ProviderUsage,
} from "@/lib/providers/types";

/** What a concrete adapter returns from one provider round trip. */
export interface ProviderExecution {
  readonly providerRunId: string | null;
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number | null;
}

interface RunRecord {
  handle: ProviderRunHandle;
  readonly events: ProviderRunEvent[];
  readonly controller: AbortController;
  readonly settled: Promise<ProviderRunResult>;
  result: ProviderRunResult | null;
}

/**
 * Cap on tracked runs per adapter instance. Terminal runs are evicted oldest
 * first so a long-lived server process cannot accumulate handles without
 * bound. Durable run state lives in Supabase, not here.
 */
const MAX_TRACKED_RUNS = 200;

/**
 * Lifecycle mechanics shared by every adapter: run registration, the event
 * log, cancellation, and mapping a provider round trip onto the structured
 * result. Concrete adapters implement only `performRequest`, `checkHealth`
 * and `listModels`.
 *
 * The registry is in-process and lives only as long as the server process, so
 * `getRun`, `listEvents`, `getResult` and `cancelRun` address a run within the
 * request that created it. Cross-request run state is read from the database.
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;
  abstract readonly capabilities: readonly ProviderCapability[];
  abstract readonly defaultModel: string | null;

  private readonly runs = new Map<string, RunRecord>();

  abstract checkHealth(): Promise<ProviderHealth>;
  abstract listModels(): Promise<readonly ProviderModel[]>;

  /** Perform one provider round trip. Implementations must honour `signal`. */
  protected abstract performRequest(
    request: ProviderRunRequest,
    prompts: { readonly system: string; readonly task: string },
    signal: AbortSignal,
  ): Promise<ProviderExecution>;

  async createRun(request: ProviderRunRequest): Promise<ProviderRunHandle> {
    this.assertCapabilityForTask(request);

    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const events: ProviderRunEvent[] = [];

    const handle: ProviderRunHandle = Object.freeze({
      provider: this.id,
      model: request.model,
      providerRunId: null,
      status: "running",
      startedAt,
    });

    const record: RunRecord = {
      handle,
      events,
      controller,
      result: null,
      settled: Promise.resolve({} as ProviderRunResult),
    };

    this.appendEvent(events, "run_created", `Run created for ${this.displayName} model ${request.model}.`);
    this.evictTerminalRuns();
    this.runs.set(request.runId, record);

    const settled = this.runToCompletion(request, record, startedAt);
    // Attach immediately so a rejection is never unhandled while a caller is
    // still between createRun and getResult.
    settled.catch(() => undefined);
    Object.assign(record, { settled });

    return handle;
  }

  getRun(runId: string): ProviderRunHandle | null {
    return this.runs.get(runId)?.handle ?? null;
  }

  listEvents(runId: string): readonly ProviderRunEvent[] {
    return Object.freeze([...(this.runs.get(runId)?.events ?? [])]);
  }

  async getResult(runId: string): Promise<ProviderRunResult> {
    const record = this.runs.get(runId);
    if (!record) {
      throw new ProviderError("unknown", "The provider run is not tracked by this process.", this.id);
    }
    return record.result ?? (await record.settled);
  }

  cancelRun(runId: string): boolean {
    const record = this.runs.get(runId);
    if (!record || record.result !== null) return false;
    record.controller.abort();
    return true;
  }

  private assertCapabilityForTask(request: ProviderRunRequest): void {
    const required = TASK_KIND_REQUIRED_CAPABILITIES[request.taskKind];
    const missing = required.filter((capability) => !this.capabilities.includes(capability));
    if (missing.length > 0) {
      throw new ProviderError(
        "capability_unsupported",
        `${this.displayName} does not declare the ${missing.join(", ")} capability required by a ${request.taskKind} task.`,
        this.id,
      );
    }
  }

  private async runToCompletion(
    request: ProviderRunRequest,
    record: RunRecord,
    startedAt: string,
  ): Promise<ProviderRunResult> {
    const startedMs = Date.now();
    const timeout = setTimeout(() => record.controller.abort(), request.timeoutMs);

    try {
      const system = buildSystemPrompt(request);
      const task = buildTaskPrompt(request);
      assertPromptWithinBounds(`${system}\n${task}`, this.id);

      this.appendEvent(record.events, "request_sent", `Request sent to ${this.displayName}.`);

      const execution = await this.performRequest(request, { system, task }, record.controller.signal);

      this.appendEvent(
        record.events,
        "response_received",
        `Response received after ${Date.now() - startedMs} ms.`,
      );

      const output = parseProviderResult(execution.text, this.id);
      const usage: ProviderUsage = buildUsage(this.id, request.model, {
        inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens,
        cachedInputTokens: execution.cachedInputTokens,
      });

      this.appendEvent(record.events, "run_succeeded", "Structured result validated and recorded.");

      return this.settle(record, {
        provider: this.id,
        model: request.model,
        providerRunId: execution.providerRunId,
        status: "succeeded",
        output,
        usage,
        latencyMs: Date.now() - startedMs,
        startedAt,
        completedAt: new Date().toISOString(),
        error: null,
        events: Object.freeze([...record.events]),
      });
    } catch (error) {
      const providerError = toProviderError(error, this.id);
      const cancelled = providerError.code === "cancelled";

      this.appendEvent(
        record.events,
        cancelled ? "run_cancelled" : "run_failed",
        `${providerError.code}: ${providerError.message}`,
      );

      return this.settle(record, {
        provider: this.id,
        model: request.model,
        providerRunId: null,
        status: cancelled ? "cancelled" : "failed",
        output: null,
        usage: null,
        latencyMs: Date.now() - startedMs,
        startedAt,
        completedAt: new Date().toISOString(),
        error: providerError.toFailure(),
        events: Object.freeze([...record.events]),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private settle(record: RunRecord, result: ProviderRunResult): ProviderRunResult {
    const frozen = Object.freeze(result);
    record.result = frozen;
    record.handle = Object.freeze({
      provider: frozen.provider,
      model: frozen.model,
      providerRunId: frozen.providerRunId,
      status: frozen.status,
      startedAt: frozen.startedAt,
    });
    return frozen;
  }

  private appendEvent(
    events: ProviderRunEvent[],
    type: ProviderRunEvent["type"],
    message: string,
  ): void {
    events.push(
      Object.freeze({
        sequence: events.length + 1,
        at: new Date().toISOString(),
        type,
        message,
      }),
    );
  }

  private evictTerminalRuns(): void {
    if (this.runs.size < MAX_TRACKED_RUNS) return;
    for (const [runId, record] of this.runs) {
      if (this.runs.size < MAX_TRACKED_RUNS) break;
      if (record.result !== null) this.runs.delete(runId);
    }
  }
}
