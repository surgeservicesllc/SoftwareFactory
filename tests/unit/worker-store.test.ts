import { describe, expect, it, vi } from "vitest";

import { SupabaseWorkerStore } from "@/lib/worker/supabase-store";
import { grokClaimContextFixture } from "../support/grok-claim-context";

const priorUsage = {
  turns: 2,
  inputTokens: 900,
  cachedInputTokens: 100,
  outputTokens: 100,
  reasoningOutputTokens: 40,
};

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "10000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-000000000002",
    project_id: "10000000-0000-4000-8000-000000000003",
    command_id: "10000000-0000-4000-8000-000000000004",
    task_id: "10000000-0000-4000-8000-000000000005",
    agent_id: "10000000-0000-4000-8000-000000000006",
    connection_id: "10000000-0000-4000-8000-000000000007",
    repository_id: "10000000-0000-4000-8000-000000000008",
    internal_installation_id: "10000000-0000-4000-8000-000000000010",
    prompt: "Fix the navigation.",
    command_type: "fix_bug",
    acceptance_criteria: [],
    plan: {},
    requested_risk: "yellow",
    external_installation_id: 2,
    app_id: 1,
    external_repository_id: 3,
    repository_full_name: "example/application",
    base_branch: "main",
    base_sha: "a".repeat(40),
    lease_token: "10000000-0000-4000-8000-000000000009",
    lease_expires_at: "2026-08-13T19:00:00.000Z",
    attempt_number: 2,
    cancellation_requested: false,
    logical_agent_role: "frontend",
    provider: "openai",
    model: "gpt-5.3-codex",
    maximum_duration_ms: 60_000,
    maximum_turns: 1,
    maximum_input_tokens: 1,
    maximum_output_tokens: 1,
    maximum_repair_attempts: 0,
    ci_timeout_ms: 30_000,
    owner_approval_id: null,
    owner_approval_expires_at: null,
    owner_approved_paths: [],
    recovery_head_branch: null,
    recovery_head_sha: null,
    recovery_pull_request_number: null,
    recovery_pull_request_url: null,
    recovery_provider_run_reference: null,
    recovery_usage: priorUsage,
    ...overrides,
  };
}

describe("SupabaseWorkerStore retry usage", () => {
  it("accepts the exact 128-character admitted model even when the worker ambient model differs", async () => {
    const admittedModel = `g${"x".repeat(127)}`;
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [claimRow({
          model: admittedModel,
          execution_admission: {
            id: "20000000-0000-4000-8000-000000000001",
            lane: "phase1c",
            provider: "openai",
            model: admittedModel,
            credential_purpose: "codex_47",
            credential_ref: "SOFTWAREFACTORY_CODEX_AUTH_JSON_47",
            provider_credential_id: "20000000-0000-4000-8000-000000000002",
            provider_credential_rotated_at: "2026-08-31T12:00:00.000Z",
            ai_account_id: "20000000-0000-4000-8000-000000000003",
            admission_sha256: "a".repeat(64),
          },
          initial_context: grokClaimContextFixture(),
        })],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const targetCommandId = "10000000-0000-4000-8000-000000000004";
    const store = new SupabaseWorkerStore(
      { rpc } as never,
      "openai",
      "gpt-5.3-codex",
      120,
      targetCommandId,
    );

    const claimed = await store.claim("worker-1");

    expect(claimed?.model).toBe(admittedModel);
    expect(claimed?.executionAdmission?.model).toBe(admittedModel);
    expect(rpc).toHaveBeenNthCalledWith(1, "claim_phase1c_run_by_command_v3", expect.objectContaining({
      p_model: "gpt-5.3-codex",
      p_target_command_id: targetCommandId,
    }));
  });

  it("rejects a claimed model beyond the 128-character admission boundary", async () => {
    const oversizedModel = `g${"x".repeat(128)}`;
    const rpc = vi.fn().mockResolvedValueOnce({
      data: [claimRow({ model: oversizedModel })],
      error: null,
    });
    const store = new SupabaseWorkerStore(
      { rpc } as never,
      "openai",
      "gpt-5.3-codex",
      120,
      "10000000-0000-4000-8000-000000000004",
    );

    await expect(store.claim("worker-1")).rejects.toThrow();
  });

  it("fails before bridge binding when an admitted claim omits or corrupts its immutable context", async () => {
    const admission = {
      id: "20000000-0000-4000-8000-000000000001",
      lane: "phase1c",
      provider: "openai",
      model: "gpt-5.3-codex",
      credential_purpose: "codex_2",
      credential_ref: "SOFTWAREFACTORY_CODEX_AUTH_JSON_2",
      provider_credential_id: "20000000-0000-4000-8000-000000000002",
      provider_credential_rotated_at: "2026-08-31T10:00:00.000Z",
      ai_account_id: "20000000-0000-4000-8000-000000000003",
      admission_sha256: "a".repeat(64),
    } as const;
    for (const initialContext of [undefined, {
      ...grokClaimContextFixture(),
      input_sha256: "not-a-digest",
    }]) {
      const rpc = vi.fn().mockResolvedValueOnce({
        data: [claimRow({ execution_admission: admission, initial_context: initialContext })],
        error: null,
      });
      const store = new SupabaseWorkerStore(
        { rpc } as never,
        "openai",
        "gpt-5.3-codex",
        120,
        "10000000-0000-4000-8000-000000000004",
      );

      await expect(store.claim("worker-1")).rejects.toThrow();
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects context injected into a legacy claim before bridge binding", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: [claimRow({ initial_context: grokClaimContextFixture() })],
      error: null,
    });
    const store = new SupabaseWorkerStore(
      { rpc } as never,
      "openai",
      "gpt-5.3-codex",
      120,
      "10000000-0000-4000-8000-000000000004",
    );

    await expect(store.claim("worker-1")).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("makes the dispatched command UUID part of the database claim", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [claimRow()], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const targetCommandId = "10000000-0000-4000-8000-000000000004";
    const store = new SupabaseWorkerStore(
      { rpc } as never,
      "openai",
      "gpt-5.3-codex",
      120,
      targetCommandId,
    );

    await expect(store.claim("worker-1")).resolves.not.toBeNull();
    expect(rpc).toHaveBeenNthCalledWith(1, "claim_phase1c_run_by_command_v3", {
      p_worker_id: "worker-1",
      p_provider: "openai",
      p_model: "gpt-5.3-codex",
      p_lease_seconds: 120,
      p_target_command_id: targetCommandId,
      p_protocol_version: 3,
    });
  });

  it("maps cumulative prior usage without branch recovery and never resets it on failure", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [claimRow()],
        error: null,
      })
      .mockResolvedValue({ data: null, error: null });
    const store = new SupabaseWorkerStore({ rpc } as never, "openai", "gpt-5.3-codex");

    const claimed = await store.claim("worker-1");

    expect(rpc).toHaveBeenNthCalledWith(1, "claim_phase1c_run_v3", {
      p_worker_id: "worker-1",
      p_provider: "openai",
      p_model: "gpt-5.3-codex",
      p_lease_seconds: 120,
      p_protocol_version: 3,
    });
    expect(claimed).toMatchObject({
      attempt: 2,
      recovery: null,
      priorUsage,
      budget: { maximumTurns: 1, maximumInputTokens: 1, maximumOutputTokens: 1 },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "bind_graph_phase1c_run_by_command_as_worker", {
      p_command_id: "10000000-0000-4000-8000-000000000004",
      p_task_id: "10000000-0000-4000-8000-000000000005",
      p_agent_run_id: "10000000-0000-4000-8000-000000000001",
    });
    expect(claimed).not.toBeNull();
    await store.fail(claimed!, "worker-1", {
      code: "github_unavailable",
      message: "GitHub could not be reached.",
      retryable: true,
    });
    expect(rpc).toHaveBeenLastCalledWith("complete_phase1c_run_with_graph_bridge_as_worker", expect.objectContaining({
      p_outcome: "failed",
      p_usage: priorUsage,
    }));
  });
});

describe("SupabaseWorkerStore graph bridge boundaries", () => {
  it("refuses to hand a claimed run to the executor when exact bridge binding fails", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [claimRow()], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "attached identity mismatch" } });
    const store = new SupabaseWorkerStore({ rpc } as never, "openai", "gpt-5.3-codex");

    await expect(store.claim("worker-1")).rejects.toThrow("Graph Phase 1C run binding failed");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("replays only the same command/task/run binding on a recovered exact claim", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [claimRow()], error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: [claimRow()], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const store = new SupabaseWorkerStore({ rpc } as never, "openai", "gpt-5.3-codex");

    await store.claim("worker-1");
    await store.claim("worker-1");

    const bindingCalls = rpc.mock.calls.filter(([name]) => (
      name === "bind_graph_phase1c_run_by_command_as_worker"
    ));
    expect(bindingCalls).toEqual([
      ["bind_graph_phase1c_run_by_command_as_worker", {
        p_command_id: "10000000-0000-4000-8000-000000000004",
        p_task_id: "10000000-0000-4000-8000-000000000005",
        p_agent_run_id: "10000000-0000-4000-8000-000000000001",
      }],
      ["bind_graph_phase1c_run_by_command_as_worker", {
        p_command_id: "10000000-0000-4000-8000-000000000004",
        p_task_id: "10000000-0000-4000-8000-000000000005",
        p_agent_run_id: "10000000-0000-4000-8000-000000000001",
      }],
    ]);
  });

  it("uses the crash-atomic completion boundary for the exact PR and bridge transition", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [claimRow()], error: null })
      .mockResolvedValue({ data: null, error: null });
    const store = new SupabaseWorkerStore({ rpc } as never, "openai", "gpt-5.3-codex");
    const job = await store.claim("worker-1");
    expect(job).not.toBeNull();

    await store.complete(job!, "worker-1", {
      branch: "factory/10000000-0000-4000-8000-000000000001-change",
      commitSha: "b".repeat(40),
      pullRequestNumber: 309,
      pullRequestUrl: "https://github.com/example/application/pull/309",
      threadId: null,
      summary: "Validated draft pull request.",
      usage: priorUsage,
      checks: [],
      changedFiles: ["app/page.tsx"],
      validation: [],
    });

    expect(rpc).toHaveBeenLastCalledWith(
      "complete_phase1c_run_with_graph_bridge_as_worker",
      expect.objectContaining({
        p_run_id: "10000000-0000-4000-8000-000000000001",
        p_outcome: "succeeded",
      }),
    );
  });
});
