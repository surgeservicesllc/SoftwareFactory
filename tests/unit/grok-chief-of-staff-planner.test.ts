// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  buildGrokChiefOfStaffPlan,
  classifyGrokIntent,
  type GrokConfiguredAgent,
  type GrokPlannerInput,
} from "@/lib/factory/chief-of-staff";

const project = Object.freeze({
  projectId: "10000000-0000-4000-8000-000000000001",
  name: "SoftwareFactory",
  repositoryFullName: "surgeservicesllc/SoftwareFactory",
  defaultBranch: "main",
  productionUrl: "https://softwarefactory.example.com",
});

const claude = Object.freeze({
  id: "11000000-0000-4000-8000-000000000011",
  assignmentId: "11000000-0000-4000-8000-000000000011",
  assignmentRevision: 7,
  botId: "12000000-0000-4000-8000-000000000012",
  botRevision: 5,
  roleId: "13000000-0000-4000-8000-000000000013",
  roleUpdatedAt: "2026-08-30T18:00:00.000Z",
  aiAccountId: "14000000-0000-4000-8000-000000000014",
  credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
  credentialPurpose: "claude",
  providerIdentity: "claude-owner@example.com",
  accountUpdatedAt: "2026-08-30T19:00:00.000Z",
  name: "Claude - Chief",
  provider: "anthropic",
  model: "claude-opus-4-1",
  capabilities: Object.freeze(["*"] as const),
  maxModelTier: "STRONG",
  ready: true,
  priority: 10,
} satisfies GrokConfiguredAgent);

const codex = Object.freeze({
  id: "21000000-0000-4000-8000-000000000021",
  assignmentId: "21000000-0000-4000-8000-000000000021",
  assignmentRevision: 11,
  botId: "22000000-0000-4000-8000-000000000022",
  botRevision: 9,
  roleId: "23000000-0000-4000-8000-000000000023",
  roleUpdatedAt: "2026-08-30T18:30:00.000Z",
  aiAccountId: "24000000-0000-4000-8000-000000000024",
  credentialRef: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
  credentialPurpose: "codex",
  providerIdentity: null,
  accountUpdatedAt: "2026-08-30T19:30:00.000Z",
  name: "Codex - Builder",
  provider: "openai",
  model: "gpt-5.3-codex",
  capabilities: Object.freeze(["implementation"] as const),
  maxModelTier: "STRONG",
  ready: true,
  priority: 10,
} satisfies GrokConfiguredAgent);

function input(prompt: string, agents: readonly GrokConfiguredAgent[] = [claude, codex]): GrokPlannerInput {
  return { prompt, project, agents };
}

function expectPlan(prompt: string, agents?: readonly GrokConfiguredAgent[]) {
  const result = buildGrokChiefOfStaffPlan(input(prompt, agents));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
}

describe("classifyGrokIntent", () => {
  it.each([
    ["Build a customer portal", "build"],
    ["Fix the broken login flow", "fix"],
    ["Research the repository architecture", "research"],
    ["Test the authorization boundary", "test"],
    ["Deploy the reviewed commit to production", "deploy"],
  ] as const)("classifies %s as %s", (prompt, expected) => {
    expect(classifyGrokIntent(prompt)).toBe(expected);
  });
});

describe("buildGrokChiefOfStaffPlan", () => {
  it("builds the same immutable plan for the same bounded input without starting execution", () => {
    const first = buildGrokChiefOfStaffPlan(input("Build a customer portal"));
    const second = buildGrokChiefOfStaffPlan(input("Build a customer portal"));

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan.planner).toEqual({
      id: "grok-chief-of-staff",
      version: 2,
      deterministic: true,
      executionStarted: false,
    });
    expect(Object.isFrozen(first.plan)).toBe(true);
    expect(Object.isFrozen(first.plan.dag.tasks)).toBe(true);
    expect(first.plan.delivery.mode).toBe("HANDOFF_ONLY");
    expect(JSON.parse(JSON.stringify(first.plan))).toMatchObject({
      planner: { version: 2, executionStarted: false },
      intent: { kind: "build" },
    });
  });

  it("is pure: planning performs no network, clock, randomness, provider, or execution work", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clockSpy = vi.spyOn(Date, "now");
    const randomSpy = vi.spyOn(Math, "random");
    try {
      const result = buildGrokChiefOfStaffPlan(input("Build a customer portal"));
      expect(result.ok).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(clockSpy).not.toHaveBeenCalled();
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      clockSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it("maximizes safe read-only fan-out and serializes unknown repository writes into one Codex task", () => {
    const plan = expectPlan("Build a customer portal");
    expect(plan.dag.layers[0]).toEqual([
      "research_repository",
      "research_requirements",
      "research_risk",
    ]);
    expect(plan.dag.layers).toContainEqual([
      "verify_correctness",
      "verify_security",
      "verify_tests",
    ]);
    expect(plan.dag.maxParallelism).toBe(3);
    expect(plan.budget.maxConcurrentNodes).toBe(3);

    const codexTasks = plan.dag.tasks.filter((task) => task.lane === "codex_workspace");
    expect(codexTasks).toHaveLength(1);
    expect(codexTasks[0]).toMatchObject({
      id: "implement",
      provider: "openai",
      model: "gpt-5.3-codex",
      capability: "implementation",
      modelTier: "STANDARD",
      dependsOn: ["architecture"],
    });
    expect(plan.dag.tasks.filter((task) => task.id.startsWith("verify_"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "anthropic", contextPolicy: "FRESH_INDEPENDENT_VERIFIER", independentOf: ["implement"] }),
      ]),
    );
  });

  it("creates a dependency-safe fix lane with failure, root-cause, and security reads before Codex", () => {
    const plan = expectPlan("Fix the checkout regression");
    expect(plan.intent.kind).toBe("fix");
    expect(plan.dag.layers[0]).toEqual([
      "reproduce_issue",
      "inspect_root_cause",
      "inspect_security_impact",
    ]);
    expect(plan.dag.tasks.find((task) => task.id === "fix")).toMatchObject({
      provider: "openai",
      dependsOn: ["fix_plan"],
    });
    expect(plan.acceptanceCriteria.find((criterion) => criterion.id === "regression_closed")?.statement)
      .toMatch(/regression test/i);
  });

  it("plans research entirely through Claude with evidence verification and no fake Codex write", () => {
    const plan = expectPlan("Research whether we should reuse the existing graph engine", [claude]);
    expect(plan.intent.kind).toBe("research");
    expect(plan.dag.tasks.every((task) => task.provider === "anthropic")).toBe(true);
    expect(plan.dag.tasks.some((task) => task.id === "synthesize_research")).toBe(true);
    expect(plan.dag.tasks.find((task) => task.id === "verification_fan_in")?.dependsOn).toEqual([
      "verify_correctness",
      "verify_security",
      "verify_tests",
    ]);
  });

  it("routes test implementation to Codex only after three independent Claude inspections", () => {
    const plan = expectPlan("Test the account tenancy boundary");
    expect(plan.intent.kind).toBe("test");
    expect(plan.dag.layers[0]).toEqual([
      "inspect_behavior",
      "inspect_test_surface",
      "inspect_security_invariants",
    ]);
    expect(plan.dag.tasks.find((task) => task.id === "implement_tests")).toMatchObject({
      provider: "openai",
      capability: "implementation",
      dependsOn: ["test_plan"],
    });
  });

  it("makes deploy RED, inspection-only before delivery, and owner-gates the exact handoff", () => {
    const plan = expectPlan("Deploy the reviewed release to production", [claude]);
    expect(plan.intent).toMatchObject({ kind: "deploy", risk: "RED" });
    expect(plan.dag.tasks.every((task) => task.provider === "anthropic")).toBe(true);
    expect(plan.delivery.ownerApprovalRequired).toBe(true);
    expect(plan.dag.tasks.find((task) => task.id === "delivery")?.gate).toEqual({
      kind: "HUMAN",
      requiredRole: "owner",
      reason: "RED delivery requires the owner to approve exact immutable evidence before any external action.",
    });
    expect(plan.dag.tasks.find((task) => task.id === "delivery")?.job).toMatch(/must not claim/i);
    expect(plan.acceptanceCriteria.find((criterion) => criterion.id === "exact_release")?.statement)
      .toMatch(/remain unobserved/i);
  });

  it("preserves every declared dependency as a compiler-approved data or verification edge", () => {
    for (const prompt of [
      "Build a customer portal",
      "Fix the checkout regression",
      "Research the graph engine",
      "Test account isolation",
      "Deploy the reviewed release",
    ]) {
      const plan = expectPlan(prompt);
      const edges = new Set(plan.dag.edges.map((edge) => `${edge.from}->${edge.to}`));
      for (const task of plan.dag.tasks) {
        for (const dependency of task.dependsOn) {
          expect(edges.has(`${dependency}->${task.id}`), `${prompt}: ${dependency}->${task.id}`).toBe(true);
        }
      }
      expect(plan.validation).toEqual({
        compiler: "PASSED",
        removedEdgeCount: 0,
        unresolvedWriteConflictCount: 0,
      });
    }
  });

  it("emits explicit bounded budgets, attempts, artifact contracts, providers, and tiers", () => {
    const plan = expectPlan("Build a customer portal");
    expect(plan.budget).toMatchObject({
      maxNodes: plan.dag.tasks.length,
      maxConcurrentNodes: 3,
      maxDurationMs: 180 * 60_000,
      maxDiscoveryRounds: 1,
    });
    for (const task of plan.dag.tasks) {
      expect(task.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(task.maxAttempts).toBeLessThanOrEqual(2);
      expect(task.artifacts.produces).toBe(`${task.id}.v1`);
      expect(task.artifacts.consumes).toEqual(task.dependsOn.map((dependency) => `${dependency}.v1`));
      expect(task.contract.acceptsPartialInputs).toBe(false);
      expect(["anthropic", "openai"]).toContain(task.provider);
      expect(["STANDARD", "STRONG"]).toContain(task.modelTier);
      expect(task).toMatchObject({
        assignmentId: expect.any(String),
        assignmentRevision: expect.any(Number),
        botId: expect.any(String),
        botRevision: expect.any(Number),
        roleId: expect.any(String),
        roleUpdatedAt: expect.any(String),
        aiAccountId: expect.any(String),
        credentialRef: expect.any(String),
        credentialPurpose: expect.any(String),
        accountUpdatedAt: expect.any(String),
        agentCapabilities: expect.any(Array),
        agentMaxModelTier: expect.any(String),
      });
    }
    expect(JSON.stringify(plan)).not.toContain("credentialValue");
  });

  it("serializes the compiler result once into the exact durable graph launch contract", () => {
    const plan = expectPlan("Build a customer portal");
    expect(plan.graphLaunch).toMatchObject({
      goal: plan.intent.prompt,
      topology: plan.dag.topology,
      riskLevel: plan.intent.risk.toLowerCase(),
      requiresOwnerApproval: plan.delivery.ownerApprovalRequired,
      budget: {
        max_nodes: plan.budget.maxNodes,
        max_concurrent_nodes: plan.budget.maxConcurrentNodes,
        max_duration_ms: plan.budget.maxDurationMs,
        max_retries: plan.budget.maxRetries,
        max_discovery_rounds: plan.budget.maxDiscoveryRounds,
      },
    });
    expect(plan.graphLaunch.nodes.map((node) => node.node_key))
      .toEqual(plan.dag.tasks.map((task) => task.id));
    expect(plan.graphLaunch.edges.map((edge) => `${edge.from_node_key}->${edge.to_node_key}`))
      .toEqual(plan.dag.edges.map((edge) => `${edge.from}->${edge.to}`));
    for (const node of plan.graphLaunch.nodes) {
      expect(node.input_schema).toMatchObject({ $schema: expect.any(String) });
      expect(node.output_schema).toMatchObject({ $schema: expect.any(String) });
    }
    expect(JSON.parse(JSON.stringify(plan.graphLaunch))).toEqual(plan.graphLaunch);
  });

  it("chooses agents deterministically: exact capability before wildcard, then priority and id", () => {
    const exactReviewer = {
      ...claude,
      id: "31000000-0000-4000-8000-000000000031",
      assignmentId: "31000000-0000-4000-8000-000000000031",
      botId: "32000000-0000-4000-8000-000000000032",
      roleId: "33000000-0000-4000-8000-000000000033",
      aiAccountId: "34000000-0000-4000-8000-000000000034",
      name: "Claude Reviewer",
      capabilities: ["review"] as const,
      priority: 999,
    } satisfies GrokConfiguredAgent;
    const plan = expectPlan("Build a customer portal", [claude, exactReviewer, codex]);
    expect(plan.dag.tasks.find((task) => task.id === "verify_correctness")?.agentId)
      .toBe("31000000-0000-4000-8000-000000000031");
    expect(plan.dag.tasks.find((task) => task.id === "architecture")?.agentId)
      .toBe("11000000-0000-4000-8000-000000000011");
  });

  it("fails closed when no ready configured agents exist", () => {
    const result = buildGrokChiefOfStaffPlan(input("Build a customer portal", []));
    expect(result).toMatchObject({ ok: false, error: { code: "NO_CONFIGURED_AGENTS" } });
  });

  it("fails closed when build work has Claude but no capable Codex lane", () => {
    const result = buildGrokChiefOfStaffPlan(input("Build a customer portal", [claude]));
    expect(result).toMatchObject({ ok: false, error: { code: "MISSING_CODEX_AGENT" } });
  });

  it("fails closed when a configured agent cannot meet a required Claude capability/tier", () => {
    const narrowClaude = {
      ...claude,
      capabilities: ["planning"] as const,
      maxModelTier: "STANDARD" as const,
    } satisfies GrokConfiguredAgent;
    const result = buildGrokChiefOfStaffPlan(input("Research the repository", [narrowClaude]));
    expect(result).toMatchObject({ ok: false, error: { code: "MISSING_CLAUDE_AGENT" } });
  });

  it("rejects credential-shaped prompt data without echoing it", () => {
    const secret = `sk-${"a".repeat(30)}`;
    const result = buildGrokChiefOfStaffPlan(input(`Build the feature with ${secret}`));
    expect(result).toMatchObject({ ok: false, error: { code: "SENSITIVE_DATA" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects sensitive nested keys before accepting unknown input", () => {
    const result = buildGrokChiefOfStaffPlan({
      ...input("Build a customer portal"),
      metadata: { accessToken: "not-returned" },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "SENSITIVE_DATA" } });
    expect(JSON.stringify(result)).not.toContain("not-returned");
  });

  it("rejects empty/oversized prompts and malformed project identity", () => {
    expect(buildGrokChiefOfStaffPlan(input(" "))).toMatchObject({
      ok: false, error: { code: "INVALID_INPUT" },
    });
    expect(buildGrokChiefOfStaffPlan(input("x".repeat(4_001)))).toMatchObject({
      ok: false, error: { code: "INVALID_INPUT" },
    });
    expect(buildGrokChiefOfStaffPlan({
      ...input("Build a customer portal"),
      project: { ...project, repositoryFullName: "not-a-repository" },
    })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("does not lower a sensitive or explicitly RED request through an intent override", () => {
    const result = buildGrokChiefOfStaffPlan({
      ...input("Review the authorization architecture"),
      intent: "research",
      requestedRisk: "GREEN",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.intent.risk).toBe("RED");
    expect(result.plan.delivery.ownerApprovalRequired).toBe(true);
  });
});
