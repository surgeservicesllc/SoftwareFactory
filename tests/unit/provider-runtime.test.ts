// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BaseProviderAdapter, type ProviderExecution } from "@/lib/providers/base-adapter";
import { ProviderError } from "@/lib/providers/errors";
import type { ProjectRoutingPolicy, ProviderAvailability, RoutingRequest } from "@/lib/providers/routing";
import { executeProviderTask, type ExecuteTaskRequest } from "@/lib/providers/runtime";
import {
  PROVIDER_CAPABILITIES,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderHealth,
  type ProviderId,
  type ProviderModel,
  type ProviderRunRequest,
  type ProviderRunResult,
} from "@/lib/providers/types";

const allCapabilities = PROVIDER_CAPABILITIES as readonly ProviderCapability[];

const goodArtifact = JSON.stringify({
  summary: "The proposal is sound.",
  findings: [],
  recommendations: ["Ship behind the existing draft-PR flow."],
  confidence: "high",
  blocked: false,
  blocked_reason: null,
});

/** A stub adapter that answers with a scripted execution or throws. */
class StubAdapter extends BaseProviderAdapter {
  readonly displayName: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly defaultModel: string | null;
  requestCount = 0;

  constructor(
    readonly id: ProviderId,
    private readonly behavior: (signal: AbortSignal) => Promise<ProviderExecution>,
    options: { capabilities?: readonly ProviderCapability[]; defaultModel?: string } = {},
  ) {
    super();
    this.displayName = `${id} stub`;
    this.capabilities = options.capabilities ?? allCapabilities;
    this.defaultModel = options.defaultModel ?? "stub-model";
  }

  async checkHealth(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      state: "connected",
      checkedAt: new Date().toISOString(),
      detail: "stub",
      latencyMs: 1,
      defaultModel: this.defaultModel,
    };
  }

  async listModels(): Promise<readonly ProviderModel[]> {
    return [
      { id: "stub-model", displayName: "Stub", maxInputTokens: null, maxOutputTokens: null },
    ];
  }

  protected async performRequest(
    _request: ProviderRunRequest,
    _prompts: { system: string; task: string },
    signal: AbortSignal,
  ): Promise<ProviderExecution> {
    this.requestCount += 1;
    return this.behavior(signal);
  }
}

function succeeding(id: ProviderId): StubAdapter {
  return new StubAdapter(id, async () => ({
    providerRunId: `${id}-response-1`,
    text: goodArtifact,
    inputTokens: 1000,
    outputTokens: 200,
    cachedInputTokens: null,
  }));
}

function failing(id: ProviderId, error: ProviderError): StubAdapter {
  return new StubAdapter(id, async () => {
    throw error;
  });
}

function providerRunRequest(overrides: Partial<ProviderRunRequest> = {}): ProviderRunRequest {
  return {
    runId: "run-1",
    taskKind: "implementation_review",
    agentRole: "security",
    agentId: "agent-security",
    instructions: "Review the proposal.",
    context: {
      projectName: "SoftwareFactory",
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
      defaultBranch: "main",
      riskLevel: "GREEN",
      priorArtifacts: [],
      memoryExcerpts: [],
    },
    model: "stub-model",
    maxOutputTokens: 4000,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function availability(provider: ProviderId): ProviderAvailability {
  return {
    provider,
    state: "connected",
    capabilities: allCapabilities,
    enabledModels: ["stub-model"],
    defaultModel: "stub-model",
    recentSuccessRate: null,
    medianLatencyMs: null,
    declaredCostPerMillionUsd: null,
  };
}

function policy(overrides: Partial<ProjectRoutingPolicy> = {}): ProjectRoutingPolicy {
  return {
    defaultProvider: "AUTO",
    allowedProviders: ["anthropic", "openai"],
    allowFallback: false,
    maximumRisk: "YELLOW",
    ...overrides,
  };
}

function routing(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    taskKind: "implementation_review",
    riskLevel: "GREEN",
    requestedProvider: "ANTHROPIC",
    policy: policy(),
    agentAssignment: null,
    availability: [availability("anthropic"), availability("openai")],
    ...overrides,
  };
}

function executeRequest(overrides: Partial<ExecuteTaskRequest> = {}): ExecuteTaskRequest {
  return {
    runId: "run-1",
    routing: routing(),
    agentId: "agent-security",
    instructions: "Review the proposal.",
    context: providerRunRequest().context,
    maxOutputTokens: 4000,
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("BaseProviderAdapter lifecycle", () => {
  it("exposes create, get, events, and result for one run", async () => {
    const adapter = succeeding("anthropic");
    const handle = await adapter.createRun(providerRunRequest());

    expect(handle.provider).toBe("anthropic");
    expect(handle.model).toBe("stub-model");

    const result = await adapter.getResult("run-1");
    expect(result.status).toBe("succeeded");
    expect(result.output?.summary).toBe("The proposal is sound.");
    expect(result.usage?.inputTokens).toBe(1000);
    expect(result.providerRunId).toBe("anthropic-response-1");

    expect(adapter.getRun("run-1")?.status).toBe("succeeded");
    expect(adapter.listEvents("run-1").map((event) => event.type)).toEqual([
      "run_created",
      "request_sent",
      "response_received",
      "run_succeeded",
    ]);
  });

  it("refuses a task kind the adapter does not declare a capability for", async () => {
    const adapter = new StubAdapter(
      "openai",
      async () => ({ providerRunId: null, text: goodArtifact, inputTokens: 1, outputTokens: 1, cachedInputTokens: null }),
      { capabilities: allCapabilities.filter((capability) => capability !== "security_review") },
    );

    await expect(
      adapter.createRun(providerRunRequest({ taskKind: "security_review" })),
    ).rejects.toThrow(/capability/i);
  });

  it("records a failure without an artifact", async () => {
    const adapter = failing("anthropic", new ProviderError("rate_limited", "Rate limited.", "anthropic"));
    await adapter.createRun(providerRunRequest());

    const result = await adapter.getResult("run-1");
    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error?.code).toBe("rate_limited");
    expect(result.error?.fallbackEligible).toBe(true);
    expect(result.events.at(-1)?.type).toBe("run_failed");
  });

  it("cancels an in-flight run", async () => {
    const adapter = new StubAdapter("anthropic", (signal) =>
      new Promise<ProviderExecution>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const abort = new Error("aborted");
          abort.name = "AbortError";
          reject(abort);
        });
      }),
    );

    await adapter.createRun(providerRunRequest());
    expect(adapter.cancelRun("run-1")).toBe(true);

    const result = await adapter.getResult("run-1");
    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("cancelled");
    expect(adapter.cancelRun("run-1")).toBe(false);
  });

  it("times out a run that never answers", async () => {
    const adapter = new StubAdapter("anthropic", (signal) =>
      new Promise<ProviderExecution>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const abort = new Error("aborted");
          abort.name = "AbortError";
          reject(abort);
        });
      }),
    );

    await adapter.createRun(providerRunRequest({ timeoutMs: 20 }));
    const result = await adapter.getResult("run-1");
    expect(result.status).toBe("cancelled");
  });

  it("rejects a result lookup for an untracked run", async () => {
    const adapter = succeeding("anthropic");
    await expect(adapter.getResult("never-created")).rejects.toThrow(/not tracked/i);
  });
});

describe("executeProviderTask", () => {
  function resolver(adapters: Partial<Record<ProviderId, ProviderAdapter>>) {
    return (provider: ProviderId) => {
      const adapter = adapters[provider];
      if (!adapter) throw new ProviderError("not_configured", "No stub adapter.", provider);
      return adapter;
    };
  }

  it("routes, executes, and returns the successful attempt", async () => {
    const anthropic = succeeding("anthropic");
    const response = await executeProviderTask(
      executeRequest(),
      resolver({ anthropic, openai: succeeding("openai") }),
    );

    expect(response.outcome).toBe("SUCCEEDED");
    expect(response.attempts).toHaveLength(1);
    expect(response.finalAttempt?.provider).toBe("anthropic");
    expect(response.finalAttempt?.result.output?.summary).toBe("The proposal is sound.");
    expect(response.fallbackFromProvider).toBeNull();
    expect(anthropic.requestCount).toBe(1);
  });

  it("falls back once when policy allows and the error is eligible", async () => {
    const anthropic = failing("anthropic", new ProviderError("upstream_unavailable", "Down.", "anthropic"));
    const openai = succeeding("openai");

    const response = await executeProviderTask(
      executeRequest({ routing: routing({ policy: policy({ allowFallback: true }) }) }),
      resolver({ anthropic, openai }),
    );

    expect(response.outcome).toBe("SUCCEEDED");
    expect(response.attempts).toHaveLength(2);
    expect(response.attempts[0]?.provider).toBe("anthropic");
    expect(response.attempts[1]?.provider).toBe("openai");
    expect(response.attempts[1]?.decision.source).toBe("FALLBACK");
    expect(response.fallbackFromProvider).toBe("anthropic");
    expect(response.fallbackReason).toContain("upstream_unavailable");
  });

  it("does not fall back when the project policy forbids it", async () => {
    const anthropic = failing("anthropic", new ProviderError("timeout", "Slow.", "anthropic"));
    const openai = succeeding("openai");

    const response = await executeProviderTask(executeRequest(), resolver({ anthropic, openai }));

    expect(response.outcome).toBe("FAILED");
    expect(response.attempts).toHaveLength(1);
    expect(openai.requestCount).toBe(0);
    expect(response.fallbackReason).toMatch(/does not permit provider fallback/i);
  });

  it("does not fall back on a credential failure even when policy allows it", async () => {
    const anthropic = failing("anthropic", new ProviderError("unauthorized", "Bad key.", "anthropic"));
    const openai = succeeding("openai");

    const response = await executeProviderTask(
      executeRequest({ routing: routing({ policy: policy({ allowFallback: true }) }) }),
      resolver({ anthropic, openai }),
    );

    expect(response.outcome).toBe("FAILED");
    expect(openai.requestCount).toBe(0);
    expect(response.fallbackReason).toMatch(/not eligible for fallback/i);
  });

  it("does not fall back on a content-policy refusal", async () => {
    const anthropic = failing("anthropic", new ProviderError("request_rejected", "Declined.", "anthropic"));
    const openai = succeeding("openai");

    const response = await executeProviderTask(
      executeRequest({ routing: routing({ policy: policy({ allowFallback: true }) }) }),
      resolver({ anthropic, openai }),
    );

    expect(response.outcome).toBe("FAILED");
    expect(openai.requestCount).toBe(0);
  });

  it("stops after a single fallback attempt", async () => {
    const anthropic = failing("anthropic", new ProviderError("timeout", "Slow.", "anthropic"));
    const openai = failing("openai", new ProviderError("timeout", "Slow.", "openai"));

    const response = await executeProviderTask(
      executeRequest({ routing: routing({ policy: policy({ allowFallback: true }) }) }),
      resolver({ anthropic, openai }),
    );

    expect(response.outcome).toBe("FAILED");
    expect(response.attempts).toHaveLength(2);
    expect(anthropic.requestCount).toBe(1);
    expect(openai.requestCount).toBe(1);
  });

  it("reports an unroutable request without executing anything", async () => {
    const anthropic = succeeding("anthropic");
    const response = await executeProviderTask(
      executeRequest({
        routing: routing({
          availability: [
            { ...availability("anthropic"), state: "not_configured" },
            { ...availability("openai"), state: "not_configured" },
          ],
        }),
      }),
      resolver({ anthropic }),
    );

    expect(response.outcome).toBe("NOT_ROUTED");
    expect(response.attempts).toHaveLength(0);
    expect(anthropic.requestCount).toBe(0);
  });

  it("blocks a task above the project risk ceiling without executing", async () => {
    const anthropic = succeeding("anthropic");
    const response = await executeProviderTask(
      executeRequest({
        routing: routing({ riskLevel: "RED", policy: policy({ maximumRisk: "GREEN" }) }),
      }),
      resolver({ anthropic }),
    );

    expect(response.outcome).toBe("BLOCKED_BY_RISK_POLICY");
    expect(anthropic.requestCount).toBe(0);
  });

  it("records an adapter that fails before a run record exists", async () => {
    const response = await executeProviderTask(executeRequest(), resolver({}));

    expect(response.outcome).toBe("FAILED");
    expect(response.attempts).toHaveLength(1);
    expect(response.attempts[0]?.result.error?.code).toBe("not_configured");
    expect(response.attempts[0]?.result.events).toHaveLength(1);
  });

  it("treats a cancelled attempt as terminal rather than falling back", async () => {
    const anthropic = new StubAdapter("anthropic", (signal) =>
      new Promise<ProviderExecution>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const abort = new Error("aborted");
          abort.name = "AbortError";
          reject(abort);
        });
      }),
    );
    const openai = succeeding("openai");

    const execution = executeProviderTask(
      executeRequest({
        routing: routing({ policy: policy({ allowFallback: true }) }),
        timeoutMs: 20,
      }),
      resolver({ anthropic, openai }),
    );

    const response: Awaited<ReturnType<typeof executeProviderTask>> = await execution;
    expect(response.outcome).toBe("CANCELLED");
    expect(openai.requestCount).toBe(0);
  });

  it("keeps every attempt's provider, model, and decision on the record", async () => {
    const anthropic = failing("anthropic", new ProviderError("rate_limited", "Busy.", "anthropic"));
    const openai = succeeding("openai");

    const response = await executeProviderTask(
      executeRequest({ routing: routing({ policy: policy({ allowFallback: true }) }) }),
      resolver({ anthropic, openai }),
    );

    const record: readonly { provider: ProviderId; model: string; result: ProviderRunResult }[] =
      response.attempts;
    expect(record.map((attempt) => `${attempt.provider}:${attempt.model}`)).toEqual([
      "anthropic:stub-model",
      "openai:stub-model",
    ]);
    expect(record[0]?.result.status).toBe("failed");
    expect(record[1]?.result.status).toBe("succeeded");
  });
});
