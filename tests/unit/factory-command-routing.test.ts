import { describe, expect, it } from "vitest";

import {
  FactoryCommandCandidateProjectionError,
  parseFactoryCommandRoutingCandidates,
  routeFactoryCommand,
} from "@/lib/orchestration/factory-command-routing";
import { LEAST_PRIVILEGE_CONFIG } from "@/lib/bots/assignment-config";
import type { RiskLevel } from "@/lib/risk";

const PIPELINE = "security_audit";

const configuredGrant = Object.freeze({
  preset: "developer",
  responsibilities: ["Implement and validate the requested change"],
  instructions: "Work only through an isolated draft pull request.",
  repositoryAccess: "write",
  branchStrategy: "per_task_branch",
  canOpenPullRequest: true,
  canMergePullRequest: false,
  pipelineAccess: "assigned",
  environmentAccess: "none",
  tools: ["repository"],
  requiresHumanApproval: true,
  maxConcurrentTasks: 2,
  priority: 1,
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    project_pipeline_id: "10000000-0000-4000-8000-000000000001",
    pipeline_template_key: PIPELINE,
    pipeline_template_id: null,
    assignment_id: "20000000-0000-4000-8000-000000000001",
    bot_id: "30000000-0000-4000-8000-000000000001",
    bot_name: "Codex Audit Bot",
    role_id: "40000000-0000-4000-8000-000000000001",
    role_slug: "developer",
    role_risk_ceiling: "red",
    assignment_status: "active",
    current_readiness: "ready",
    ai_account_status: "connected",
    provider: "openai",
    model: "gpt-5.3-codex",
    assignment_model: null,
    work_effort: "high",
    assignment_config: { ...configuredGrant },
    assigned_pipeline_keys: [PIPELINE],
    in_flight: 0,
    max_concurrent_tasks: 2,
    has_capacity: true,
    is_configured: true,
    assigned_at: "2026-08-21T12:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return parseFactoryCommandRoutingCandidates([row(overrides)])[0];
}

function decide(overrides: Record<string, unknown> = {}, risk: RiskLevel = "GREEN") {
  return routeFactoryCommand({
    candidates: [candidate(overrides)],
    pipelineTemplateKey: PIPELINE,
    effectiveRisk: risk,
  });
}

describe("factory command routing", () => {
  it("rejects a malformed projection instead of silently dropping a candidate", () => {
    expect(() => parseFactoryCommandRoutingCandidates([row({ in_flight: -1 })]))
      .toThrow(FactoryCommandCandidateProjectionError);
    expect(() => parseFactoryCommandRoutingCandidates([
      row({ max_concurrent_tasks: 3 }),
    ])).toThrow(FactoryCommandCandidateProjectionError);
  });

  it("recomputes configured state from the raw posting override, not the resolved model", () => {
    const baseline = {
      assignment_config: { ...LEAST_PRIVILEGE_CONFIG },
      assignment_model: null,
      work_effort: "medium",
      max_concurrent_tasks: LEAST_PRIVILEGE_CONFIG.maxConcurrentTasks,
      is_configured: true,
    };

    expect(candidate(baseline).isConfigured).toBe(false);
    expect(candidate({ ...baseline, assignment_model: "gpt-5.3-codex" }).isConfigured).toBe(true);
    expect(candidate({ ...baseline, work_effort: "high" }).isConfigured).toBe(true);
    expect(candidate({ ...baseline, assignment_model: "gpt-5.3-codex", is_configured: false }).isConfigured)
      .toBe(false);
  });

  it("names an empty but valid project roster", () => {
    const decision = routeFactoryCommand({
      candidates: [],
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
    });

    expect(decision).toMatchObject({
      outcome: "REFUSED",
      refused: [{ code: "NO_ASSIGNED_BOTS" }],
    });
  });

  it.each([
    {
      label: "paused posting",
      overrides: { assignment_status: "paused" },
      code: "ASSIGNMENT_PAUSED",
    },
    {
      label: "released posting",
      overrides: { assignment_status: "released" },
      code: "ASSIGNMENT_RELEASED",
    },
    {
      label: "unconfigured posting",
      overrides: { is_configured: false },
      code: "ASSIGNMENT_NOT_CONFIGURED",
    },
    {
      label: "unready bot",
      overrides: { current_readiness: "not_connected" },
      code: "BOT_NOT_READY",
    },
    {
      label: "AI account needing reauthentication",
      overrides: { ai_account_status: "needs_reauth" },
      code: "BOT_NOT_READY",
    },
    {
      label: "unsupported provider",
      overrides: { provider: "google" },
      code: "PROVIDER_MODEL_MISMATCH",
    },
    {
      label: "unsupported OpenAI model",
      overrides: { model: "gpt-5.3" },
      code: "PROVIDER_MODEL_MISMATCH",
    },
    {
      label: "repository is read-only",
      overrides: {
        assignment_config: {
          ...configuredGrant,
          repositoryAccess: "read",
          canOpenPullRequest: false,
        },
      },
      code: "REPOSITORY_WRITE_REQUIRED",
    },
    {
      label: "draft pull requests are forbidden",
      overrides: {
        assignment_config: { ...configuredGrant, canOpenPullRequest: false },
      },
      code: "PULL_REQUEST_PERMISSION_REQUIRED",
    },
    {
      label: "pipeline access is absent",
      overrides: {
        assignment_config: { ...configuredGrant, pipelineAccess: "none" },
      },
      code: "PIPELINE_ACCESS_REQUIRED",
    },
    {
      label: "selected pipeline is outside assigned scope",
      overrides: { assigned_pipeline_keys: ["other_pipeline"] },
      code: "PIPELINE_OUT_OF_SCOPE",
    },
    {
      label: "live assignment count consumes the last slot",
      overrides: { in_flight: 2, has_capacity: false },
      code: "AT_CONCURRENCY_LIMIT",
    },
    {
      label: "database refuses a broader capacity gate",
      overrides: { in_flight: 0, has_capacity: false },
      code: "DATABASE_CAPACITY_REFUSED",
    },
    {
      label: "candidate belongs to another pipeline",
      overrides: { pipeline_template_key: "other_pipeline" },
      code: "PIPELINE_SCOPE_MISMATCH",
    },
  ])("refuses a $label", ({ overrides, code }) => {
    const decision = decide(overrides);
    expect(decision).toMatchObject({ outcome: "REFUSED" });
    expect(decision.refused.map((entry) => entry.code)).toContain(code);
  });

  it("enforces the role's risk ceiling against the effective risk", () => {
    const decision = decide({ role_risk_ceiling: "green" }, "YELLOW");

    expect(decision).toMatchObject({
      outcome: "REFUSED",
      refused: [{ code: "ROLE_RISK_CEILING_TOO_LOW" }],
    });
  });

  it("defers only capacity for a possible same-key replay", () => {
    const full = candidate({ in_flight: 2, has_capacity: false });
    const decision = routeFactoryCommand({
      candidates: [full],
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
      deferCapacityToAtomicSubmit: true,
    });

    expect(decision).toMatchObject({
      outcome: "SELECTED",
      selected: { assignmentId: full.assignmentId },
    });

    const forbidden = routeFactoryCommand({
      candidates: [candidate({
        in_flight: 2,
        has_capacity: false,
        assignment_config: {
          ...configuredGrant,
          repositoryAccess: "read",
          canOpenPullRequest: false,
        },
      })],
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
      deferCapacityToAtomicSubmit: true,
    });
    expect(forbidden).toMatchObject({
      outcome: "REFUSED",
      refused: [{ code: "REPOSITORY_WRITE_REQUIRED" }],
    });
  });

  it("prefers any capacity-available bot over a higher-priority deferred bot", () => {
    const fullPriorityBot = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000020",
      bot_id: "30000000-0000-4000-8000-000000000020",
      bot_name: "Full priority bot",
      assignment_config: { ...configuredGrant, priority: 0 },
      in_flight: 2,
      has_capacity: false,
    });
    const availableBot = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000021",
      bot_id: "30000000-0000-4000-8000-000000000021",
      bot_name: "Available bot",
      assignment_config: { ...configuredGrant, priority: 3 },
    });

    const decision = routeFactoryCommand({
      candidates: [fullPriorityBot, availableBot],
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
      deferCapacityToAtomicSubmit: true,
    });

    expect(decision).toMatchObject({
      outcome: "SELECTED",
      selected: { botName: "Available bot" },
    });
  });

  it("uses a ready Claude posting as the authoritative provider and model", () => {
    const decision = decide({
      bot_name: "Claude - Daniel",
      provider: "anthropic",
      model: "claude-opus-5",
    });

    expect(decision).toMatchObject({
      outcome: "SELECTED",
      selected: {
        botName: "Claude - Daniel",
        provider: "anthropic",
        model: "claude-opus-5",
      },
    });
  });

  it("skips an unsupported higher-priority posting for a supported Claude posting", () => {
    const decision = routeFactoryCommand({
      candidates: [
        candidate({
          assignment_id: "00000000-0000-4000-8000-000000000099",
          bot_id: "00000000-0000-4000-8000-000000000098",
          bot_name: "Unsupported",
          provider: "google",
          assignment_config: { ...configuredGrant, priority: 0 },
        }),
        candidate({
          assignment_id: "00000000-0000-4000-8000-000000000097",
          bot_id: "00000000-0000-4000-8000-000000000096",
          bot_name: "Claude - Daniel",
          provider: "anthropic",
          model: "claude-opus-5",
          assignment_config: { ...configuredGrant, priority: 1 },
        }),
      ],
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
    });

    expect(decision).toMatchObject({
      outcome: "SELECTED",
      selected: { botName: "Claude - Daniel", provider: "anthropic" },
    });
  });

  it("accepts an active, configured, ready posting with every required grant", () => {
    const decision = decide();

    expect(decision).toMatchObject({
      outcome: "SELECTED",
      eligibleCount: 1,
      selected: {
        assignmentId: "20000000-0000-4000-8000-000000000001",
        pipelineTemplateKey: PIPELINE,
        provider: "openai",
        model: "gpt-5.3-codex",
      },
    });
  });

  it("uses the existing deterministic assignment order independent of input order", () => {
    const oldest = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000002",
      bot_id: "30000000-0000-4000-8000-000000000002",
      bot_name: "Oldest",
      assigned_at: "2026-08-20T12:00:00.000Z",
    });
    const urgent = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000003",
      bot_id: "30000000-0000-4000-8000-000000000003",
      bot_name: "Urgent",
      assignment_config: { ...configuredGrant, priority: 0 },
      assigned_at: "2026-08-21T13:00:00.000Z",
    });
    const samePriorityNewer = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000004",
      bot_id: "30000000-0000-4000-8000-000000000004",
      bot_name: "Newer",
      assigned_at: "2026-08-21T14:00:00.000Z",
    });

    const route = (candidates: typeof oldest[]) => routeFactoryCommand({
      candidates,
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
    });

    expect(route([oldest, urgent, samePriorityNewer])).toMatchObject({
      outcome: "SELECTED",
      selected: { botName: "Urgent" },
    });
    expect(route([samePriorityNewer, urgent, oldest])).toMatchObject({
      outcome: "SELECTED",
      selected: { botName: "Urgent" },
    });
  });

  it("uses headroom, assignment age, then assignment id as stable tie-breakers", () => {
    const fullish = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000010",
      bot_id: "30000000-0000-4000-8000-000000000010",
      bot_name: "Less headroom",
      in_flight: 1,
    });
    const older = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000011",
      bot_id: "30000000-0000-4000-8000-000000000011",
      bot_name: "Older",
      assigned_at: "2026-08-20T12:00:00.000Z",
    });
    const newer = candidate({
      assignment_id: "20000000-0000-4000-8000-000000000012",
      bot_id: "30000000-0000-4000-8000-000000000012",
      bot_name: "Newer",
      assigned_at: "2026-08-21T12:00:00.000Z",
    });

    const decision = routeFactoryCommand({
      candidates: [newer, fullish, older],
      pipelineTemplateKey: PIPELINE,
      effectiveRisk: "GREEN",
    });

    expect(decision).toMatchObject({ outcome: "SELECTED", selected: { botName: "Older" } });
  });
});
