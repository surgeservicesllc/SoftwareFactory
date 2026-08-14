import { describe, expect, it, vi } from "vitest";

import { SupabaseWorkerStore } from "@/lib/worker/supabase-store";

describe("SupabaseWorkerStore retry usage", () => {
  it("maps cumulative prior usage without branch recovery and never resets it on failure", async () => {
    const priorUsage = {
      turns: 2,
      inputTokens: 900,
      cachedInputTokens: 100,
      outputTokens: 100,
      reasoningOutputTokens: 40,
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
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
        }],
        error: null,
      })
      .mockResolvedValue({ data: null, error: null });
    const store = new SupabaseWorkerStore({ rpc } as never, "openai", "gpt-5.3-codex");

    const claimed = await store.claim("worker-1");

    expect(claimed).toMatchObject({
      attempt: 2,
      recovery: null,
      priorUsage,
      budget: { maximumTurns: 1, maximumInputTokens: 1, maximumOutputTokens: 1 },
    });
    expect(claimed).not.toBeNull();
    await store.fail(claimed!, "worker-1", {
      code: "github_unavailable",
      message: "GitHub could not be reached.",
      retryable: true,
    });
    expect(rpc).toHaveBeenLastCalledWith("complete_phase1c_run", expect.objectContaining({
      p_outcome: "failed",
      p_usage: priorUsage,
    }));
  });
});
