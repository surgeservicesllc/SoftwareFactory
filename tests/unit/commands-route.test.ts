import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { POST } from "@/app/api/commands/route";

function commandRequest(origin?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://factory.example/api/commands", {
    body: JSON.stringify({
      idempotencyKey: "command:test:1",
      parameters: {},
      projectId: "11111111-1111-4111-8111-111111111111",
      prompt: "Review the dashboard copy.",
      risk: "green",
    }),
    headers,
    method: "POST",
  });
}

describe("POST /api/commands", () => {
  beforeEach(() => requireActiveOrganization.mockReset());

  it.each([undefined, "https://attacker.example"])(
    "rejects a cookie-authenticated mutation from origin %s before Supabase",
    async (origin) => {
      const response = await POST(commandRequest(origin));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_request_origin",
          message: "The request origin is not allowed.",
        },
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(requireActiveOrganization).not.toHaveBeenCalled();
    },
  );

  it("accepts the exact request origin and persists without starting execution", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        command_id: "22222222-2222-4222-8222-222222222222",
        command_state: "queued",
        requires_owner_approval: false,
        task_id: "33333333-3333-4333-8333-333333333333",
        task_state: "queued",
        was_created: true,
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ single });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
    const eqOrganization = vi.fn().mockReturnValue({ maybeSingle });
    const eqProject = vi.fn().mockReturnValue({ eq: eqOrganization });
    const select = vi.fn().mockReturnValue({ eq: eqProject });
    const client = { from: vi.fn().mockReturnValue({ select }), rpc };
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: "44444444-4444-4444-8444-444444444444" },
      client,
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(eqProject).toHaveBeenCalledWith("id", "11111111-1111-4111-8111-111111111111");
    expect(eqOrganization).toHaveBeenCalledWith("organization_id", "44444444-4444-4444-8444-444444444444");
    expect(rpc).toHaveBeenCalledWith("submit_command", expect.objectContaining({
      p_project_id: "11111111-1111-4111-8111-111111111111",
      p_requested_risk: "green",
    }));
    expect(await response.json()).toMatchObject({
      execution: { started: false },
      idempotentReplay: false,
    });
  });

  it("rejects a project outside the active organization before command persistence", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqOrganization = vi.fn().mockReturnValue({ maybeSingle });
    const eqProject = vi.fn().mockReturnValue({ eq: eqOrganization });
    const rpc = vi.fn();
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: "44444444-4444-4444-8444-444444444444" },
      client: {
        from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: eqProject }) }),
        rpc,
      },
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "project_not_in_active_organization" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
