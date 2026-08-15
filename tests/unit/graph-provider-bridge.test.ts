// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import {
  assertNodeMayCallProvider,
  maxOutputTokensForNode,
  routingRequestForNode,
  taskKindForNode,
  toNodeExecutionResult,
} from "@/lib/graph/provider-bridge";
import type { ExecuteTaskResponse } from "@/lib/providers/runtime";

function compiledNode(overrides: Partial<CompiledNode> = {}): CompiledNode {
  return {
    nodeKey: "n1",
    job: "do the thing",
    executor: "MODEL",
    capability: "extraction",
    modelTier: "ECONOMY",
    risk: "GREEN",
    timeoutMs: 60_000,
    maxAttempts: 2,
    allowProviderFallback: true,
    reads: [],
    writes: [],
    ...overrides,
  } as CompiledNode;
}

function response(overrides: Partial<ExecuteTaskResponse> = {}): ExecuteTaskResponse {
  return {
    runtimeVersion: "phase2a-runtime-v1",
    outcome: "SUCCEEDED",
    primaryDecision: {} as ExecuteTaskResponse["primaryDecision"],
    attempts: [],
    finalAttempt: null,
    fallbackFromProvider: null,
    fallbackReason: null,
    ...overrides,
  } as ExecuteTaskResponse;
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    attempt: 1,
    provider: "anthropic",
    model: "claude-opus-5",
    decision: {},
    result: {
      status: "succeeded",
      output: { findings: [] },
      latencyMs: 1200,
      usage: { inputTokens: 900, outputTokens: 300, estimatedCostMicros: 12000 },
      events: [],
      error: null,
      providerRunId: "msg_1",
      ...(overrides.result as Record<string, unknown> | undefined),
    },
    ...overrides,
  } as unknown as ExecuteTaskResponse["attempts"][number];
}

describe("provider bridge", () => {
  it("maps capabilities to provider task kinds", () => {
    expect(taskKindForNode(compiledNode({ capability: "security_review" }))).toBe("security_review");
    expect(taskKindForNode(compiledNode({ capability: "architecture" }))).toBe("architecture_review");
    expect(taskKindForNode(compiledNode({ capability: "implementation" }))).toBe("implementation_proposal");
  });

  it("caps output tokens by tier so cheap nodes stay cheap", () => {
    // A cheap extraction node asking for a huge completion is how a graph's
    // cost escapes its declared tier without anyone choosing that.
    expect(maxOutputTokensForNode(compiledNode({ modelTier: "ECONOMY" }))).toBe(2_000);
    expect(maxOutputTokensForNode(compiledNode({ modelTier: "STRONG" }))).toBe(16_000);
  });

  it("carries the node's own risk into routing rather than the graph's", () => {
    const request = routingRequestForNode({
      node: compiledNode({ risk: "YELLOW", capability: "review" }),
      base: {
        requestedProvider: "AUTO",
        policy: {} as never,
        agentAssignment: null,
        availability: [],
      },
    });

    expect(request.riskLevel).toBe("YELLOW");
    expect(request.taskKind).toBe("implementation_review");
  });

  it("excludes providers already tried so a fallback does not reselect one", () => {
    const request = routingRequestForNode({
      node: compiledNode(),
      base: {
        requestedProvider: "AUTO",
        policy: {} as never,
        agentAssignment: null,
        availability: [],
      },
      excludedProviders: ["anthropic"],
    });

    expect(request.excludedProviders).toEqual(["anthropic"]);
  });

  it("translates a successful run, carrying real usage", () => {
    const result = toNodeExecutionResult(
      response({ outcome: "SUCCEEDED", finalAttempt: attempt(), attempts: [attempt()] }),
    );

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.provider).toBe("anthropic");
    expect(result.tokensUsed).toBe(1200);
    expect(result.costMicros).toBe(12000);
  });

  it("leaves cost absent when the provider reported none", () => {
    const noUsage = attempt({ result: { usage: null } });
    const result = toNodeExecutionResult(
      response({ outcome: "SUCCEEDED", finalAttempt: noUsage, attempts: [noUsage] }),
    );

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    // Absent, not zero. A fabricated total gets believed.
    expect(result.costMicros).toBeUndefined();
    expect(result.tokensUsed).toBeUndefined();
  });

  it("treats NOT_ROUTED as permanent rather than retryable", () => {
    // Retrying re-runs the same decision and gets the same answer.
    const result = toNodeExecutionResult(response({ outcome: "NOT_ROUTED" }));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("No eligible provider");
  });

  it("treats a risk block as permanent", () => {
    const result = toNodeExecutionResult(response({ outcome: "BLOCKED_BY_RISK_POLICY" }));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(false);
  });

  it("defers to the provider layer on whether a failure is retryable", () => {
    const nonRetryable = attempt({
      result: { status: "failed", error: { message: "invalid credential", retryable: false } },
    });
    const retryable = attempt({
      result: { status: "failed", error: { message: "rate limited", retryable: true } },
    });

    // A credential failure retried against the same credential just spends
    // money to fail again; the taxonomy already knows that, so do not guess.
    expect(
      toNodeExecutionResult(
        response({ outcome: "FAILED", attempts: [nonRetryable], finalAttempt: null }),
      ),
    ).toMatchObject({ retryable: false, error: "invalid credential" });

    expect(
      toNodeExecutionResult(
        response({ outcome: "FAILED", attempts: [retryable], finalAttempt: null }),
      ),
    ).toMatchObject({ retryable: true });
  });

  it("bills usage from a failed attempt", () => {
    const failed = attempt({
      result: {
        status: "failed",
        error: { message: "timeout", retryable: true },
        usage: { inputTokens: 400, outputTokens: 0, estimatedCostMicros: 500 },
      },
    });

    const result = toNodeExecutionResult(
      response({ outcome: "FAILED", attempts: [failed], finalAttempt: null }),
    );

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.tokensUsed).toBe(400);
    expect(result.costMicros).toBe(500);
  });

  it("refuses to let a deterministic node reach a provider", () => {
    // Routing this would spend money on work code does exactly and for free.
    expect(() => assertNodeMayCallProvider(compiledNode({ executor: "DETERMINISTIC" }))).toThrow(
      /must not call a provider/,
    );
    expect(() => assertNodeMayCallProvider(compiledNode({ modelTier: "NONE" }))).toThrow(
      /model tier NONE/,
    );
    expect(() => assertNodeMayCallProvider(compiledNode())).not.toThrow();
  });
});
