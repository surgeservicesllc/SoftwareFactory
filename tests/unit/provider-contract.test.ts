// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertPromptWithinBounds,
  buildSystemPrompt,
  buildTaskPrompt,
  MAX_PROMPT_CHARACTERS,
  parseProviderResult,
  PROVIDER_RESULT_JSON_SCHEMA,
} from "@/lib/providers/contract";
import {
  connectionStateForError,
  isProviderError,
  ProviderError,
  providerErrorCodeForStatus,
  toProviderError,
} from "@/lib/providers/errors";
import {
  buildUsage,
  DECLARED_MODEL_PRICES,
  estimateCostMicros,
  findDeclaredModelPrice,
  formatEstimatedCost,
} from "@/lib/providers/usage";
import { AGENT_ROLES, isAgentRole, type ProviderRunRequest } from "@/lib/providers/types";

const validResult = {
  summary: "The change is scoped and reversible.",
  findings: [{ title: "Missing test", detail: "No case covers the empty list.", severity: "medium" }],
  recommendations: ["Add a test for the empty list."],
  confidence: "high",
  blocked: false,
  blocked_reason: null,
};

function runRequest(overrides: Partial<ProviderRunRequest> = {}): ProviderRunRequest {
  return {
    runId: "run-1",
    taskKind: "implementation_review",
    agentRole: "security",
    agentId: "agent-security",
    instructions: "Review the pending change for regressions.",
    context: {
      projectName: "SoftwareFactory",
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
      defaultBranch: "main",
      riskLevel: "GREEN",
      priorArtifacts: [],
      memoryExcerpts: [],
    },
    model: "claude-opus-5",
    maxOutputTokens: 16_000,
    timeoutMs: 120_000,
    ...overrides,
  };
}

describe("result schema", () => {
  it("constrains every object and requires every property", () => {
    expect(PROVIDER_RESULT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(PROVIDER_RESULT_JSON_SCHEMA.required).toEqual([
      "summary",
      "findings",
      "recommendations",
      "confidence",
      "blocked",
      "blocked_reason",
    ]);
    expect(PROVIDER_RESULT_JSON_SCHEMA.properties.findings.items.additionalProperties).toBe(false);
  });
});

describe("parseProviderResult", () => {
  it("accepts a well-formed artifact", () => {
    const parsed = parseProviderResult(JSON.stringify(validResult), "anthropic");

    expect(parsed.summary).toBe(validResult.summary);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.severity).toBe("medium");
    expect(parsed.blockedReason).toBeNull();
  });

  it("tolerates a fenced code block", () => {
    const parsed = parseProviderResult(
      "```json\n" + JSON.stringify(validResult) + "\n```",
      "openai",
    );
    expect(parsed.confidence).toBe("high");
  });

  it("preserves a blocked artifact rather than inventing an answer", () => {
    const parsed = parseProviderResult(
      JSON.stringify({
        ...validResult,
        findings: [],
        recommendations: [],
        blocked: true,
        blocked_reason: "The repository tree was not supplied.",
      }),
      "anthropic",
    );

    expect(parsed.blocked).toBe(true);
    expect(parsed.blockedReason).toBe("The repository tree was not supplied.");
  });

  it("rejects empty, non-JSON, and off-schema responses", () => {
    for (const raw of ["", "   ", "not json at all", JSON.stringify({ summary: "only" })]) {
      let thrown: unknown;
      try {
        parseProviderResult(raw, "anthropic");
      } catch (error) {
        thrown = error;
      }
      expect(isProviderError(thrown)).toBe(true);
      expect((thrown as ProviderError).code).toBe("invalid_response");
    }
  });

  it("rejects an unknown severity value", () => {
    expect(() =>
      parseProviderResult(
        JSON.stringify({
          ...validResult,
          findings: [{ title: "x", detail: "y", severity: "catastrophic" }],
        }),
        "anthropic",
      ),
    ).toThrow(ProviderError);
  });
});

describe("prompt construction", () => {
  it("accepts every provider-neutral canonical agent role", () => {
    expect(AGENT_ROLES).toEqual([
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
    ]);
    expect(isAgentRole("architect")).toBe(true);
    expect(isAgentRole("performance")).toBe(true);
  });

  it("states the advisory boundary and the agent role", () => {
    const system = buildSystemPrompt(runRequest());

    expect(system).toContain("security agent");
    expect(system).toContain("analysis only");
    expect(system).toContain("not an account or a login");
  });

  it("includes project context, memory, and prior artifacts", () => {
    const prompt = buildTaskPrompt(
      runRequest({
        context: {
          projectName: "SoftwareFactory",
          repositoryFullName: "surgeservicesllc/SoftwareFactory",
          defaultBranch: "main",
          riskLevel: "YELLOW",
          memoryExcerpts: [{ path: "AGENTS.md", excerpt: "Keep RLS enabled." }],
          priorArtifacts: [
            {
              taskKind: "implementation_proposal",
              agentRole: "backend",
              agentId: "agent-backend",
              provider: "openai",
              model: "owner-selected-model",
              runId: "run-implement",
              summary: "Proposed the change.",
            },
          ],
        },
      }),
    );

    expect(prompt).toContain("Declared risk: YELLOW");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("Keep RLS enabled.");
    expect(prompt).toContain("Proposed the change.");
    expect(prompt).toContain("run-implement");
  });

  it("says Not Connected instead of inventing a repository", () => {
    const prompt = buildTaskPrompt(
      runRequest({
        context: { ...runRequest().context, repositoryFullName: null, defaultBranch: null },
      }),
    );
    expect(prompt).toContain("Repository: Not Connected");
  });

  it("bounds the assembled prompt", () => {
    expect(() => assertPromptWithinBounds("short", "anthropic")).not.toThrow();
    expect(() => assertPromptWithinBounds("x".repeat(MAX_PROMPT_CHARACTERS + 1), "anthropic")).toThrow(
      ProviderError,
    );
  });
});

describe("error taxonomy", () => {
  it("maps transport status codes onto the taxonomy", () => {
    expect(providerErrorCodeForStatus(401)).toBe("unauthorized");
    expect(providerErrorCodeForStatus(404)).toBe("model_not_found");
    expect(providerErrorCodeForStatus(429)).toBe("rate_limited");
    expect(providerErrorCodeForStatus(503)).toBe("upstream_unavailable");
    expect(providerErrorCodeForStatus(418)).toBe("unknown");
  });

  it("keeps credential and policy failures out of fallback", () => {
    expect(new ProviderError("unauthorized", "x").fallbackEligible).toBe(false);
    expect(new ProviderError("forbidden", "x").fallbackEligible).toBe(false);
    expect(new ProviderError("request_rejected", "x").fallbackEligible).toBe(false);
    expect(new ProviderError("cancelled", "x").fallbackEligible).toBe(false);
  });

  it("allows fallback for transient and configuration failures", () => {
    for (const code of ["rate_limited", "timeout", "upstream_unavailable", "not_configured"] as const) {
      expect(new ProviderError(code, "x").fallbackEligible, code).toBe(true);
    }
  });

  it("does not leak the original error when normalizing", () => {
    const raw = new Error("Bearer sk-live-abcdefghijklmnopqrstuvwxyz in request body");
    Object.assign(raw, { status: 500 });
    const normalized = toProviderError(raw, "openai");

    expect(normalized.code).toBe("upstream_unavailable");
    expect(normalized.message).not.toContain("sk-live");
    expect(normalized.provider).toBe("openai");
  });

  it("recognizes an abort as a cancellation", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(toProviderError(abort, "anthropic").code).toBe("cancelled");
  });

  it("maps error codes onto the connection states the UI may show", () => {
    expect(connectionStateForError("not_configured")).toBe("not_configured");
    expect(connectionStateForError("disabled")).toBe("disabled");
    expect(connectionStateForError("rate_limited")).toBe("error");
  });
});

describe("usage and cost estimation", () => {
  it("declares prices only for models this repository can cite", () => {
    expect(findDeclaredModelPrice("anthropic", "claude-opus-5")).not.toBeNull();
    expect(DECLARED_MODEL_PRICES.some((price) => price.provider === "openai")).toBe(false);
  });

  it("estimates cost from the declared table", () => {
    // 1M input at $5 plus 1M output at $25 is $30, i.e. 30,000,000 micro-USD.
    expect(estimateCostMicros("anthropic", "claude-opus-5", 1_000_000, 1_000_000)).toBe(30_000_000);
  });

  it("returns unknown rather than zero for an undeclared model", () => {
    expect(estimateCostMicros("openai", "owner-selected-model", 1000, 1000)).toBeNull();
    expect(formatEstimatedCost(null)).toBe("Not declared");
  });

  it("builds a usage record with a normalized token count", () => {
    const usage = buildUsage("anthropic", "claude-opus-5", {
      inputTokens: 1200.7,
      outputTokens: -5,
      cachedInputTokens: 800,
    });

    expect(usage.inputTokens).toBe(1200);
    expect(usage.outputTokens).toBe(0);
    expect(usage.cachedInputTokens).toBe(800);
    expect(usage.estimatedCostMicros).toBeGreaterThan(0);
  });

  it("formats small and zero costs without implying precision it lacks", () => {
    expect(formatEstimatedCost(0)).toBe("$0.00");
    expect(formatEstimatedCost(500)).toBe("<$0.01");
    expect(formatEstimatedCost(2_500_000)).toBe("$2.50");
  });
});
