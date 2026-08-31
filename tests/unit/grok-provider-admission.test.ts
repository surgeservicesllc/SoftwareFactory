// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildGrokChiefOfStaffPlan,
  type GrokChiefOfStaffPlan,
  type GrokTask,
} from "@/lib/factory/chief-of-staff";
import {
  buildGrokProviderAdmissions,
  GrokProviderAdmissionError,
} from "@/lib/grok/provider-admission";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";

const identity = {
  assignmentId: "10000000-0000-4000-8000-000000000001",
  assignmentRevision: 4,
  botId: "20000000-0000-4000-8000-000000000002",
  botRevision: 7,
  aiAccountId: "30000000-0000-4000-8000-000000000003",
  accountUpdatedAt: "2026-08-31T12:00:00.000Z",
  roleId: "40000000-0000-4000-8000-000000000004",
  roleUpdatedAt: "2026-08-31T11:00:00.000Z",
  credentialPurpose: "claude",
  credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
  providerIdentity: "claude-owner@example.com",
  agentCapabilities: ["*"],
  agentMaxModelTier: "STRONG",
} as const;

function task(overrides: Partial<GrokTask> = {}): GrokTask {
  return {
    id: "plan",
    title: "Plan",
    job: "Plan the work.",
    lane: "claude_read_only",
    executor: "MODEL",
    capability: "planning",
    modelTier: "STRONG",
    provider: "anthropic",
    model: "claude-opus-5",
    agentId: identity.assignmentId,
    agentName: "Claude planner",
    risk: "GREEN",
    maxAttempts: 1,
    timeoutMs: 480_000,
    dependsOn: [],
    contextPolicy: "DEPENDENCY_ARTIFACTS_ONLY",
    independentOf: [],
    gate: null,
    artifacts: { consumes: [], produces: "plan.v1", schemaVersion: 1 },
    contract: { input: "GOAL", outputArtifact: "plan", acceptsPartialInputs: false },
    ...identity,
    ...overrides,
  };
}

function plan(tasks: readonly GrokTask[]): GrokChiefOfStaffPlan {
  return { planner: { version: 2 }, dag: { tasks } } as unknown as GrokChiefOfStaffPlan;
}

describe("Grok provider admission projection", () => {
  it("maps a real build plan to every executable canonical lane", () => {
    const claude = {
      id: identity.assignmentId,
      assignmentId: identity.assignmentId,
      assignmentRevision: identity.assignmentRevision,
      botId: identity.botId,
      botRevision: identity.botRevision,
      roleId: identity.roleId,
      roleUpdatedAt: identity.roleUpdatedAt,
      aiAccountId: identity.aiAccountId,
      accountUpdatedAt: identity.accountUpdatedAt,
      credentialPurpose: identity.credentialPurpose,
      credentialRef: identity.credentialRef,
      providerIdentity: identity.providerIdentity,
      name: "Claude generalist",
      provider: "anthropic" as const,
      model: "claude-opus-5",
      capabilities: ["*"] as const,
      maxModelTier: "STRONG" as const,
      ready: true,
    };
    const codex = {
      ...claude,
      id: "50000000-0000-4000-8000-000000000005",
      assignmentId: "50000000-0000-4000-8000-000000000005",
      botId: "60000000-0000-4000-8000-000000000006",
      roleId: "70000000-0000-4000-8000-000000000007",
      aiAccountId: "80000000-0000-4000-8000-000000000008",
      name: "Codex writer",
      provider: "openai" as const,
      model: "gpt-5.3-codex",
      credentialPurpose: "codex",
      credentialRef: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
      capabilities: ["implementation"] as const,
    };
    const planned = buildGrokChiefOfStaffPlan({
      prompt: "Build the provider admission boundary",
      project: {
        projectId: "90000000-0000-4000-8000-000000000009",
        name: "SoftwareFactory",
        repositoryFullName: "surgeservicesllc/SoftwareFactory",
        defaultBranch: "main",
      },
      agents: [claude, codex],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.error.message);

    const template = findTemplate("full_lifecycle");
    expect(template).toBeDefined();
    if (!template) throw new Error("full_lifecycle template is unavailable");
    const canonical = buildLaunchPlan(
      { ...template, summary: planned.plan.intent.prompt },
      budgetForTemplate(template),
    );
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) throw new Error(canonical.errors.join("; "));

    const admissions = buildGrokProviderAdmissions(planned.plan, canonical.plan.nodes);
    const executable = canonical.plan.nodes.filter((node) => node.executor === "MODEL"
      || (node.executor === "ANCHOR" && node.node_key === "implement"));
    expect(admissions).toHaveLength(executable.length);
    expect(admissions.filter((entry) => entry.lane === "phase1c")).toHaveLength(1);
    expect(admissions.every((entry) => entry.agentMaxModelTier === "STRONG")).toBe(true);
  });

  it("pins canonical Claude nodes and the Phase 1C Codex handoff to exact identities", () => {
    const codex = task({
      ...identity,
      id: "implement",
      provider: "openai",
      model: "gpt-5.3-codex",
      capability: "implementation",
      lane: "codex_workspace",
      credentialPurpose: "codex",
      credentialRef: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
      agentCapabilities: ["implementation"],
      assignmentId: "50000000-0000-4000-8000-000000000005",
      botId: "60000000-0000-4000-8000-000000000006",
      aiAccountId: "70000000-0000-4000-8000-000000000007",
      roleId: "80000000-0000-4000-8000-000000000008",
    });
    const admissions = buildGrokProviderAdmissions(plan([task(), codex]), [
      { node_key: "goal", executor: "MODEL", capability: "planning", model_tier: "STRONG" },
      { node_key: "implement", executor: "ANCHOR", capability: "implementation", model_tier: null },
      { node_key: "review", executor: "ANCHOR", capability: "review", model_tier: null },
    ]);

    expect(admissions).toHaveLength(2);
    expect(admissions[0]).toMatchObject({
      version: 1,
      lane: "graph_model",
      nodeKey: "goal",
      assignmentId: identity.assignmentId,
      provider: "anthropic",
      model: "claude-opus-5",
      agentMaxModelTier: "STRONG",
    });
    expect(admissions[1]).toMatchObject({
      lane: "phase1c",
      nodeKey: "implement",
      sourceTaskKey: "implement",
      provider: "openai",
      model: "gpt-5.3-codex",
      agentMaxModelTier: "STRONG",
    });
  });

  it("fails closed for a legacy plan without immutable identity fields", () => {
    const legacy = task({ assignmentId: undefined });
    expect(() => buildGrokProviderAdmissions(plan([legacy]), [
      { node_key: "goal", executor: "MODEL", capability: "planning", model_tier: "STRONG" },
    ])).toThrow(GrokProviderAdmissionError);
  });

  it("keeps a readable legacy v1 plan non-executable", () => {
    expect(() => buildGrokProviderAdmissions(
      { planner: { version: 1 }, dag: { tasks: [task()] } } as unknown as GrokChiefOfStaffPlan,
      [{ node_key: "goal", executor: "MODEL", capability: "planning", model_tier: "STRONG" }],
    )).toThrow(/legacy plan/);
  });

  it("refuses capability, tier, and provider substitution", () => {
    expect(() => buildGrokProviderAdmissions(plan([task({
      agentCapabilities: ["planning"],
      agentMaxModelTier: "STANDARD",
    })]), [
      { node_key: "architecture", executor: "MODEL", capability: "architecture", model_tier: "STRONG" },
    ])).toThrow(/No immutable anthropic posting/);

    expect(() => buildGrokProviderAdmissions(plan([task({
      provider: "openai",
      capability: "implementation",
      agentCapabilities: ["implementation"],
    })]), [
      { node_key: "goal", executor: "MODEL", capability: "planning", model_tier: "STRONG" },
    ])).toThrow(/No immutable anthropic posting/);
  });
});
