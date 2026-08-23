import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { POST } from "@/app/api/autonomy/clear/route";

/**
 * The boundary in front of `clear_autonomy_projects`.
 *
 * The route carries no authority of its own — the function re-checks the
 * caller and the reason — so what is worth testing here is that it cannot be
 * talked past from another origin or with a throwaway reason, that it never
 * invents an organization, and that a refusal reaches the caller in the
 * database's own words rather than a paraphrase.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";

const rpc = vi.fn();

function request(body: unknown, origin: string | null = "https://factory.example") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://factory.example/api/autonomy/clear", {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReturnValue({
    single: async () => ({
      data: { archived_count: 3, already_archived: 1 },
      error: null,
    }),
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { rpc },
  });
});

describe("POST /api/autonomy/clear", () => {
  it("passes the reason and the caller's own organization to the database", async () => {
    const response = await POST(request({ reason: "clearing the autonomy list" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cleared: { archivedCount: 3, alreadyArchived: 1 },
    });
    expect(rpc).toHaveBeenCalledWith("clear_autonomy_projects", {
      p_organization_id: organizationId,
      p_reason: "clearing the autonomy list",
    });
  });

  it("refuses a short reason, a missing one, and an organization named by the caller", async () => {
    for (const body of [
      { reason: "too short" },
      {},
      { reason: "clearing the autonomy list", organizationId: "11111111-1111-4111-8111-111111111111" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("refuses a cross-origin post before it reaches the workspace", async () => {
    const response = await POST(request(
      { reason: "clearing the autonomy list" },
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
          message: "only an owner or admin may clear the autonomy list",
        },
      }),
    });

    const response = await POST(request({ reason: "clearing the autonomy list" }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toContain("only an owner or admin may clear the autonomy list");
  });
});
