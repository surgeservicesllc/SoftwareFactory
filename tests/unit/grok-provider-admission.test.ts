// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildGrokChiefOfStaffPlan,
  type GrokChiefOfStaffPlan,
  type GrokConfiguredAgent,
  type GrokSpecialistAdmission,
} from "@/lib/factory/chief-of-staff";
import {
  buildGrokProviderAdmissions,
  GrokProviderAdmissionError,
} from "@/lib/grok/provider-admission";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";

const project = Object.freeze({
  projectId: "90000000-0000-4000-8000-000000000009",
  name: "SoftwareFactory",
  repositoryFullName: "surgeservicesllc/SoftwareFactory",
  defaultBranch: "main",
});

const claude = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
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
  name: "Claude generalist",
  provider: "anthropic",
  model: "claude-opus-5",
  capabilities: Object.freeze(["*"] as const),
  maxModelTier: "STRONG",
  ready: true,
} satisfies GrokConfiguredAgent);

const codex = Object.freeze({
  ...claude,
  id: "50000000-0000-4000-8000-000000000005",
  assignmentId: "50000000-0000-4000-8000-000000000005",
  botId: "60000000-0000-4000-8000-000000000006",
  roleId: "70000000-0000-4000-8000-000000000007",
  aiAccountId: "80000000-0000-4000-8000-000000000008",
  providerIdentity: null,
  name: "Codex writer",
  provider: "openai",
  model: "gpt-5.3-codex",
  credentialPurpose: "codex",
  credentialRef: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
  capabilities: Object.freeze(["implementation"] as const),
} satisfies GrokConfiguredAgent);

function buildPlan(agents: readonly GrokConfiguredAgent[] = [claude, codex]) {
  const planned = buildGrokChiefOfStaffPlan({
    prompt: "Build the provider admission boundary",
    project,
    agents,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.error.message);
  return planned.plan;
}

function canonicalNodes() {
  const template = findTemplate("full_lifecycle");
  if (!template) throw new Error("full_lifecycle template is unavailable");
  const canonical = buildLaunchPlan(
    { ...template, summary: "Build the provider admission boundary" },
    budgetForTemplate(template),
  );
  if (!canonical.ok) throw new Error(canonical.errors.join("; "));
  return canonical.plan.nodes;
}

function withRoster(
  plan: GrokChiefOfStaffPlan,
  roster: readonly GrokSpecialistAdmission[],
): GrokChiefOfStaffPlan {
  return { ...plan, admissionRoster: roster };
}

describe("Grok provider admission projection", () => {
  it("maps a real planner-v3 roster to every executable canonical lane", () => {
    const nodes = canonicalNodes();
    const admissions = buildGrokProviderAdmissions(buildPlan(), nodes);
    const executable = nodes.filter((node) => node.executor === "MODEL"
      || (node.executor === "ANCHOR" && node.node_key === "implement"));

    expect(admissions).toHaveLength(executable.length);
    expect(admissions.filter((entry) => entry.lane === "phase1c")).toHaveLength(1);
    expect(admissions.every((entry) => entry.version === 2)).toBe(true);
    expect(admissions.every((entry) => entry.agentCapabilities.includes("*") === false)).toBe(true);
  });

  it("uses roster-only evaluation and decision specialists without fake planner DAG tasks", () => {
    const evaluation = {
      ...claude,
      id: "11000000-0000-4000-8000-000000000011",
      assignmentId: "11000000-0000-4000-8000-000000000011",
      botId: "12000000-0000-4000-8000-000000000012",
      roleId: "13000000-0000-4000-8000-000000000013",
      aiAccountId: "14000000-0000-4000-8000-000000000014",
      capabilities: ["evaluation"] as const,
      name: "Claude evaluator",
    } satisfies GrokConfiguredAgent;
    const decision = {
      ...claude,
      id: "21000000-0000-4000-8000-000000000021",
      assignmentId: "21000000-0000-4000-8000-000000000021",
      botId: "22000000-0000-4000-8000-000000000022",
      roleId: "23000000-0000-4000-8000-000000000023",
      aiAccountId: "24000000-0000-4000-8000-000000000024",
      capabilities: ["decision"] as const,
      name: "Claude decider",
    } satisfies GrokConfiguredAgent;
    const plan = buildPlan([claude, evaluation, decision, codex]);
    expect(plan.dag.tasks.some((task) => task.assignmentId === evaluation.assignmentId)).toBe(false);
    expect(plan.dag.tasks.some((task) => task.assignmentId === decision.assignmentId)).toBe(false);

    const admissions = buildGrokProviderAdmissions(plan, canonicalNodes());
    expect(admissions.find((entry) => entry.nodeKey === "evaluate")).toMatchObject({
      sourceRosterAssignmentId: evaluation.assignmentId,
      capability: "evaluation",
    });
    expect(admissions.find((entry) => entry.nodeKey === "decide")).toMatchObject({
      sourceRosterAssignmentId: decision.assignmentId,
      capability: "decision",
    });
  });

  it("keeps readable v1/v2 plans non-executable", () => {
    for (const version of [1, 2]) {
      expect(() => buildGrokProviderAdmissions(
        { planner: { version }, dag: { tasks: [] } } as unknown as GrokChiefOfStaffPlan,
        canonicalNodes(),
      )).toThrow(/legacy plan/);
    }
  });

  it.each(["research", "deploy"] as const)(
    "refuses %s until an intent-specific executable bridge exists",
    (intent) => {
      const base = buildPlan();
      const plan = { ...base, intent: { ...base.intent, kind: intent } } as GrokChiefOfStaffPlan;
      expect(() => buildGrokProviderAdmissions(plan, canonicalNodes()))
        .toThrow(/no intent-specific executable bridge/i);
    },
  );

  it("refuses capability, tier, identity, and provider substitution", () => {
    const plan = buildPlan();
    const base = plan.admissionRoster[0];
    const writer = plan.admissionRoster[1];
    if (!base || !writer) throw new Error("missing roster fixture");

    expect(() => buildGrokProviderAdmissions(withRoster(plan, [{
      ...base,
      capabilities: ["planning"],
      maxModelTier: "STANDARD",
    }, writer]), [
      { node_key: "architecture", executor: "MODEL", capability: "architecture", model_tier: "STRONG" },
    ])).toThrow(/No immutable anthropic posting/);

    expect(() => buildGrokProviderAdmissions(withRoster(plan, [{
      ...base,
      assignmentId: "not-a-uuid",
    }, writer]), [
      { node_key: "goal", executor: "MODEL", capability: "planning", model_tier: "STRONG" },
    ])).toThrow(GrokProviderAdmissionError);

    expect(() => buildGrokProviderAdmissions(withRoster(plan, [{
      ...base,
      provider: "openai",
    }, writer]), [
      { node_key: "goal", executor: "MODEL", capability: "planning", model_tier: "STRONG" },
    ])).toThrow(/No immutable anthropic posting/);
  });
});
