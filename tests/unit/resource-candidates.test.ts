import { describe, expect, it } from "vitest";

import {
  WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY,
  breakerTargetsFor,
  readContextLimit,
  readDeclaredCapabilities,
  readStrengthTier,
  toAgentProfile,
  toModelProfile,
  undeclaredModels,
  type ModelRow,
} from "@/lib/resources/candidates";
import { assignWorker } from "@/lib/resources/manager";
import { closedBreaker } from "@/lib/resources/breakers";

/**
 * These assert one rule from several directions: an undeclared property is
 * never a permissive default. Every case here is about what happens when the
 * owner has *not* said something, because that is the case a router gets wrong
 * in the direction of claiming capability nobody stated.
 */

const strongModel: ModelRow = {
  provider: "anthropic",
  model: "claude-strong",
  capabilities: ["planning", "architecture", "coding", "security", "review", "synthesis"],
  enabled: true,
  strength_tier: "strong",
  context_limit_tokens: 200_000,
};

describe("resource candidates", () => {
  it("maps only the unambiguous Phase 2A capability names", () => {
    // `structured_output` is an output format, not a kind of work, and
    // `reporting` is not the same claim as `synthesis` — which gates work onto
    // strong models, so a wrong mapping would be consequential.
    expect(WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY).not.toHaveProperty("structured_output");
    expect(WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY).not.toHaveProperty("reporting");
    expect(WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY.architecture_analysis).toBe("architecture");
    expect(WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY.code_authoring).toBe("coding");
  });

  it("drops a capability nobody can name rather than guessing at it", () => {
    expect(readDeclaredCapabilities(["coding", "telepathy", "structured_output", 7, null])).toEqual(["coding"]);
    expect(readDeclaredCapabilities("not-an-array")).toEqual([]);
    expect(readDeclaredCapabilities(null)).toEqual([]);
  });

  it("treats an undeclared strength as the weakest tier, not the strongest", () => {
    expect(readStrengthTier(null)).toBe("economical");
    expect(readStrengthTier("nonsense")).toBe("economical");
    expect(readStrengthTier("strong")).toBe("strong");
  });

  it("treats an undeclared context limit as zero, not unlimited", () => {
    expect(readContextLimit(null)).toBe(0);
    expect(readContextLimit(0)).toBe(0);
    expect(readContextLimit(-5)).toBe(0);
    expect(readContextLimit(200_000)).toBe(200_000);
  });

  it("refuses judgement work to a model whose strength was never declared", () => {
    const undeclared = toModelProfile({ ...strongModel, strength_tier: null });
    const declared = toModelProfile(strongModel);

    const request = (model: typeof declared) => ({
      node: {
        nodeId: "node-1",
        projectId: "project-1",
        required: ["architecture"] as const,
        complexity: "judgement" as const,
        riskLevel: "YELLOW" as const,
        estimatedContextTokens: 1_000,
        deterministicHandlerAvailable: false,
      },
      candidates: [
        {
          agent: toAgentProfile({
            id: "agent-1",
            role: "orchestrator",
            status: "idle",
            project_id: null,
            capabilities: ["architecture"],
          }),
          model,
          performance: null,
          configuredAffinity: 0.5,
          breaker: closedBreaker(`${model.provider}/${model.model}`),
        },
      ],
      objective: "QUALITY" as const,
      mode: "AUTO" as const,
      now: 0,
    });

    // Same model, same capabilities — the only difference is whether the owner
    // declared its strength. Undeclared must not qualify for judgement work.
    expect(assignWorker(request(undeclared)).decision).toBe("NO_ELIGIBLE_WORKER");
    expect(assignWorker(request(undeclared)).candidates[0].rejections).toContain("RISK_TIER_TOO_WEAK");
    expect(assignWorker(request(declared)).decision).toBe("ASSIGNED");
  });

  it("refuses any work to a model whose context limit was never declared", () => {
    const model = toModelProfile({ ...strongModel, context_limit_tokens: null });
    expect(model.contextLimitTokens).toBe(0);

    const assignment = assignWorker({
      node: {
        nodeId: "node-1",
        projectId: "project-1",
        required: ["coding"],
        complexity: "mechanical",
        riskLevel: "GREEN",
        estimatedContextTokens: 1,
        deterministicHandlerAvailable: false,
      },
      candidates: [
        {
          agent: toAgentProfile({
            id: "agent-1",
            role: "backend",
            status: "idle",
            project_id: null,
            capabilities: [],
          }),
          model,
          performance: null,
          configuredAffinity: 0.5,
          breaker: closedBreaker("anthropic/claude-strong"),
        },
      ],
      objective: "BALANCED",
      mode: "AUTO",
      now: 0,
    });

    expect(assignment.decision).toBe("NO_ELIGIBLE_WORKER");
    expect(assignment.candidates[0].rejections).toContain("CONTEXT_TOO_SMALL");
  });

  it("gives a custom agent nothing from its role", () => {
    // "custom" states no capability, so anything it can do must be declared.
    expect(toAgentProfile({
      id: "a", role: "custom", status: "idle", project_id: null, capabilities: [],
    }).capabilities).toEqual([]);

    expect(toAgentProfile({
      id: "a", role: "custom", status: "idle", project_id: null, capabilities: ["research"],
    }).capabilities).toEqual(["research"]);
  });

  it("derives role capabilities and unions them with declared ones", () => {
    const profile = toAgentProfile({
      id: "a", role: "backend", status: "idle", project_id: null, capabilities: ["database"],
    });
    expect(profile.capabilities).toEqual(expect.arrayContaining(["coding", "backend", "database"]));
  });

  it("treats every agent status except idle as unavailable", () => {
    for (const status of ["inactive", "busy", "paused", "error"]) {
      expect(
        toAgentProfile({ id: "a", role: "backend", status, project_id: null, capabilities: [] }).available,
        `${status} must not be available`,
      ).toBe(false);
    }
    expect(
      toAgentProfile({ id: "a", role: "backend", status: "idle", project_id: null, capabilities: [] }).available,
    ).toBe(true);
  });

  it("scopes a project-bound agent to that project and leaves an unbound one unrestricted", () => {
    expect(
      toAgentProfile({ id: "a", role: "qa", status: "idle", project_id: "project-1", capabilities: [] })
        .allowedProjectIds,
    ).toEqual(["project-1"]);
    // Empty means unrestricted, not denied — and it is an allowlist, so a new
    // project cannot silently inherit a scoped agent.
    expect(
      toAgentProfile({ id: "a", role: "qa", status: "idle", project_id: null, capabilities: [] })
        .allowedProjectIds,
    ).toEqual([]);
  });

  it("checks the most specific breaker target first", () => {
    expect(breakerTargetsFor("openai", "gpt-5.3-codex")).toEqual(["openai/gpt-5.3-codex", "openai"]);
  });

  it("names the models an owner has not finished declaring", () => {
    expect(
      undeclaredModels([
        strongModel,
        { ...strongModel, model: "half-declared", strength_tier: null },
        { ...strongModel, model: "bare", strength_tier: null, context_limit_tokens: null },
      ]),
    ).toEqual([
      { provider: "anthropic", model: "half-declared", missing: ["strength_tier"] },
      { provider: "anthropic", model: "bare", missing: ["strength_tier", "context_limit_tokens"] },
    ]);
  });

  it("marks a disabled model unavailable", () => {
    expect(toModelProfile({ ...strongModel, enabled: false }).available).toBe(false);
  });
});
