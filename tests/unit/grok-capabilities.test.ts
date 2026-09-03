import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { serializeAssignment, serializeBot, serializeBotRole } from "@/lib/bots/service";
import { buildGrokChiefOfStaffPlan } from "@/lib/factory/chief-of-staff";
import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { GROK_CAPABILITY_ALIASES, normalizeGrokCapabilities } from "@/lib/grok/capabilities";
import { configuredGrokAgents } from "@/lib/grok/session-store";

describe("normalizeGrokCapabilities", () => {
  it("is the identity on every canonical capability, so a second pass loses nothing", () => {
    for (const capability of NODE_CAPABILITIES) {
      expect(normalizeGrokCapabilities([capability])).toEqual([capability]);
    }
    const once = normalizeGrokCapabilities(["*"]);
    expect(once).toEqual([...NODE_CAPABILITIES].sort());
    expect(normalizeGrokCapabilities(once)).toEqual(once);
  });

  it("still expands role vocabulary through the alias table", () => {
    expect(normalizeGrokCapabilities(["security", "tests", "api"]))
      .toEqual(["implementation", "qa", "security_review"]);
    expect(normalizeGrokCapabilities(["Security-Review", " coding "]))
      .toEqual(["implementation", "security_review"]);
    expect(normalizeGrokCapabilities(["unknown", ""])).toEqual([]);
    for (const [alias, targets] of Object.entries(GROK_CAPABILITY_ALIASES)) {
      expect(normalizeGrokCapabilities([alias])).toEqual([...targets].sort());
    }
  });
});

// The roster the fake-data journey builds on the local stack: one Claude bot on
// a generalist role at high effort, one Codex bot on the backend starter role.
// Before canonical names were their own aliases, the planner's second
// normalization dropped `security_review` from every roster and refused every
// intent with MISSING_CLAUDE_AGENT, whatever the role declared.
const organizationId = "10000000-0000-4000-8000-0000000fa001";
const projectId = "68f738b2-ad4b-466c-adb4-10467747e629";
const claudeBotId = "fcdf7337-3185-4fa1-9dfa-439b47769241";
const codexBotId = "a679bfd4-676a-4198-aae4-260cb73ed877";
const backendRoleId = "9df6fd6b-073a-4f7d-b78b-731e7ad8b665";
const generalistRoleId = "ed6a2c68-2133-481b-966a-1479e5c93d81";
const claudeAccountId = "40000000-0000-4000-8000-0000000fa001";
const codexAccountId = "40000000-0000-4000-8000-0000000fa002";
const at = "2026-09-03T03:33:24.172017+00:00";

function botRow(id: string, name: string, provider: string, model: string, credentialRef: string, accountId: string) {
  return {
    id, organization_id: organizationId, name, provider, model, credential_ref: credentialRef,
    base_url: null, readiness: "ready", readiness_detail: "ready", last_checked_at: at, notes: null,
    created_by: "57606582-c50e-429a-beaf-1eb93f38501a", created_at: at, updated_at: at,
    ai_account_id: accountId, revision: 2,
  };
}

function roleRow(id: string, name: string, slug: string, capabilities: string[], riskCeiling: string) {
  return {
    id, name, slug, summary: "s", instructions: "i", capabilities, risk_ceiling: riskCeiling,
    created_at: at, updated_at: at,
  };
}

function assignmentRow(id: string, botId: string, roleId: string, model: string, workEffort: string) {
  return {
    id, bot_id: botId, project_id: projectId, role_id: roleId, status: "active", assigned_at: at,
    released_at: null, model, work_effort: workEffort, priority: 1, revision: 2, preset: null,
    responsibilities: [], instructions: null, repository_access: "write",
    branch_strategy: "per_task_branch", can_open_pull_request: true, can_merge_pull_request: false,
    pipeline_access: "assigned", environment_access: "none", tools: [],
    requires_human_approval: true, max_concurrent_tasks: 2,
  };
}

function accountRow(accountId: string, provider: string, purpose: string) {
  return {
    account_id: accountId, provider, auth_method: "subscription", display_name: `Fake ${purpose}`,
    status: "connected", credential_purpose: purpose, last_verified_at: at, last_error: null,
    created_at: at, updated_at: at, provider_identity: null,
  };
}

describe("a generalist Claude posting and a backend Codex posting", () => {
  it("cover a build plan end to end through the roster projection", () => {
    const fabric = {
      bots: [
        serializeBot(botRow(claudeBotId, "Claude", "anthropic", "claude-opus-5", "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN", claudeAccountId) as never, () => true),
        serializeBot(botRow(codexBotId, "Codex / GPT", "openai", "gpt-5.3-codex", "SOFTWAREFACTORY_CODEX_AUTH_JSON", codexAccountId) as never, () => true),
      ],
      roles: [
        serializeBotRole(roleRow(backendRoleId, "Backend engineer", "backend", ["api", "validation", "tests"], "yellow") as never),
        serializeBotRole(roleRow(generalistRoleId, "Generalist", "generalist", ["*"], "green") as never),
      ],
      assignments: [
        serializeAssignment(assignmentRow("374076e9-8f1a-4da9-a436-af6e01d0004a", codexBotId, backendRoleId, "gpt-5.3-codex", "medium") as never),
        serializeAssignment(assignmentRow("a52a3e81-ccb5-4d95-bb9d-4ce863baed90", claudeBotId, generalistRoleId, "claude-fable-5", "high") as never),
      ],
      assignmentsComplete: true as const,
      projects: [],
    };
    const agents = configuredGrokAgents(
      fabric as never,
      projectId,
      [accountRow(claudeAccountId, "anthropic", "claude"), accountRow(codexAccountId, "openai", "codex")] as never,
    );
    expect(agents.map((agent) => agent.name)).toEqual(["Codex / GPT — Backend engineer", "Claude — Generalist"]);
    expect(agents[1]?.capabilities).toContain("security_review");

    const result = buildGrokChiefOfStaffPlan({
      prompt: "Build me a fake health endpoint and prove it with a test.",
      project: {
        projectId, name: "Storefront Rebuild", repositoryFullName: "fake-owner/storefront",
        defaultBranch: "main", productionUrl: null,
      },
      agents,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.intent.kind).toBe("build");
    const providers = new Set(result.plan.dag.tasks.map((task) => task.provider));
    expect(providers).toEqual(new Set(["anthropic", "openai"]));
  });

  it("is refused, naming the uncovered task, when the Claude posting lacks security review", () => {
    const reviewerOnly = normalizeGrokCapabilities(["planning", "review", "testing", "reporting", "discovery", "architecture", "synthesis"]);
    const result = buildGrokChiefOfStaffPlan({
      prompt: "Build me a fake health endpoint and prove it with a test.",
      project: {
        projectId, name: "Storefront Rebuild", repositoryFullName: "fake-owner/storefront",
        defaultBranch: "main", productionUrl: null,
      },
      agents: [{
        id: "a52a3e81-ccb5-4d95-bb9d-4ce863baed90", assignmentId: "a52a3e81-ccb5-4d95-bb9d-4ce863baed90",
        assignmentRevision: 2, botId: claudeBotId, botRevision: 2, roleId: generalistRoleId,
        roleUpdatedAt: at, aiAccountId: claudeAccountId, credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
        credentialPurpose: "claude", providerIdentity: null, accountUpdatedAt: at, name: "Claude",
        provider: "anthropic", model: "claude-fable-5", capabilities: reviewerOnly,
        maxModelTier: "STRONG", ready: true, priority: 1,
      }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_CLAUDE_AGENT");
    expect(result.error.details).toEqual(["security_review/STRONG"]);
  });
});
