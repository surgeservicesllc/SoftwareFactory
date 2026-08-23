import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { POST } from "@/app/api/commands/delete/route";

/**
 * The boundary in front of `delete_selected_pipelines`.
 *
 * It holds no authority of its own, so what is worth testing is that it
 * cannot be talked past: a cross-origin post, a selection that is empty or
 * absurd, a missing reason, and — when the database refuses — that the
 * caller reads the database's sentence rather than a paraphrase.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const firstCommand = "22222222-2222-4222-8222-222222222222";
const secondCommand = "33333333-3333-4333-8333-333333333333";

const rpc = vi.fn();

function request(body: unknown, origin: string | null = "https://factory.example") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://factory.example/api/commands/delete", {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReturnValue({
    single: async () => ({
      data: {
        deleted_count: 2,
        stopped_count: 1,
        kept_with_runs: 0,
        kept_with_evidence: 0,
        not_found: 0,
        unlinked_analyses: 1,
      },
      error: null,
    }),
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { rpc },
  });
});

describe("POST /api/commands/delete", () => {
  it("passes the selection, the reason and the run flag straight to the database", async () => {
    const response = await POST(request({
      commandIds: [firstCommand, secondCommand],
      reason: "tidying the pipelines list",
      includeCommandsWithRuns: true,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: {
        deletedCount: 2,
        stoppedCount: 1,
        keptWithRuns: 0,
        keptWithEvidence: 0,
        notFound: 0,
        unlinkedAnalyses: 1,
      },
    });
    expect(rpc).toHaveBeenCalledWith("delete_selected_pipelines", {
      p_organization_id: organizationId,
      p_command_ids: [firstCommand, secondCommand],
      p_reason: "tidying the pipelines list",
      p_include_commands_with_runs: true,
    });
  });

  it("defaults the run-history flag to off rather than assuming consent", async () => {
    await POST(request({ commandIds: [firstCommand], reason: "removing one pipeline" }));

    expect(rpc).toHaveBeenCalledWith(
      "delete_selected_pipelines",
      expect.objectContaining({ p_include_commands_with_runs: false }),
    );
  });

  it("refuses an empty selection, an oversized one, and a short reason", async () => {
    const oversized = Array.from({ length: 201 }, () => firstCommand);
    for (const body of [
      { commandIds: [], reason: "removing one pipeline" },
      { commandIds: oversized, reason: "removing one pipeline" },
      { commandIds: [firstCommand], reason: "too short" },
      { commandIds: ["not-a-uuid"], reason: "removing one pipeline" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("refuses a cross-origin post before it reaches the workspace", async () => {
    const response = await POST(request(
      { commandIds: [firstCommand], reason: "removing one pipeline" },
      "https://elsewhere.example",
    ));

    expect(response.status).toBe(403);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("reports the database's own refusal instead of a paraphrase", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: null,
        error: {
          code: "42501",
          message: "only an owner or admin may delete pipelines",
        },
      }),
    });

    const response = await POST(request({
      commandIds: [firstCommand],
      reason: "removing one pipeline",
    }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toContain("only an owner or admin may delete pipelines");
  });
});
