import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  rpc: vi.fn(),
  openSecret: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: harness.rpc }),
}));
vi.mock("@/lib/security/secret-box-core", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/security/secret-box-core")>();
  return { ...original, openSecret: harness.openSecret };
});

import {
  loadAdmittedCredential,
  resolveAdmittedClaudeAuth,
  resolveAdmittedCodexAuth,
  type ExecutionAdmission,
} from "@/lib/worker/execution-admission";

const base = {
  supabaseUrl: "https://example.supabase.co",
  serviceRoleKey: "sb_secret_test-service-role-value",
  organizationId: "10000000-0000-4000-8000-000000000001",
} as const;

function admission(provider: "anthropic" | "openai"): ExecutionAdmission {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    lane: provider === "anthropic" ? "graph_model" : "phase1c",
    provider,
    model: provider === "anthropic" ? "claude-sonnet-5" : "gpt-5.3-codex",
    credential_purpose: provider === "anthropic" ? "claude_47" : "codex_47",
    credential_ref: provider === "anthropic"
      ? "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_47"
      : "SOFTWAREFACTORY_CODEX_AUTH_JSON_47",
    provider_credential_id: "20000000-0000-4000-8000-000000000002",
    provider_credential_rotated_at: "2026-08-31T12:00:00.000Z",
    ai_account_id: "20000000-0000-4000-8000-000000000003",
    admission_sha256: "a".repeat(64),
  };
}

beforeEach(() => {
  harness.rpc.mockReset();
  harness.openSecret.mockReset();
});

describe("admitted provider credentials", () => {
  it("never routes an OpenAI admission through Claude or an Anthropic admission through Codex", async () => {
    await expect(resolveAdmittedClaudeAuth({ ...base, admission: admission("openai") }))
      .rejects.toThrow(/non-Anthropic admission/i);
    await expect(resolveAdmittedCodexAuth({ ...base, admission: admission("anthropic") }))
      .rejects.toThrow(/non-OpenAI admission/i);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("does not fall back to another account slot when the admitted ref mismatches", async () => {
    await expect(loadAdmittedCredential({
      ...base,
      admission: { ...admission("anthropic"), credential_ref: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN" },
    })).rejects.toThrow(/slot does not match/i);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("opens only the exact hash-bound admission and resolves its Claude model credential", async () => {
    harness.rpc.mockResolvedValue({ data: "v1.sealed", error: null });
    harness.openSecret.mockReturnValue("sk-ant-oat01-exact-admitted-token");
    const exact = admission("anthropic");

    const resolved = await resolveAdmittedClaudeAuth({ ...base, admission: exact });

    expect(resolved.oauthToken).toBe("sk-ant-oat01-exact-admitted-token");
    expect(harness.rpc).toHaveBeenCalledWith("read_grok_execution_credential_as_worker", {
      p_organization_id: base.organizationId,
      p_admission_id: exact.id,
      p_admission_sha256: exact.admission_sha256,
    });
    expect(harness.openSecret).toHaveBeenCalledWith("v1.sealed", {
      organizationId: base.organizationId,
      purpose: "claude_47",
    });
  });

  it("resolves an exact Codex slot without consulting ambient provider variables", async () => {
    harness.rpc.mockResolvedValue({ data: "v1.sealed", error: null });
    harness.openSecret.mockReturnValue(JSON.stringify({ tokens: { access_token: "exact-token" } }));

    const resolved = await resolveAdmittedCodexAuth({ ...base, admission: admission("openai") });

    expect(resolved.authJson).toContain("exact-token");
    expect(resolved.mode).toBe("subscription");
  });
});
