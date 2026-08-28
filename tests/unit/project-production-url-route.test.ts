import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { PATCH } from "@/app/api/projects/[projectId]/production-url/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ projectId }) };
const syntheticSecret = `sk-${"a".repeat(32)}`;

function request(productionUrl: unknown, origin = "https://factory.example") {
  return new Request(`https://factory.example/api/projects/${projectId}/production-url`, {
    body: JSON.stringify({ productionUrl }),
    headers: { "Content-Type": "application/json", Origin: origin },
    method: "PATCH",
  });
}

function tenantClient(
  role: "owner" | "admin" | "member",
  rpcResult: { data: unknown; error: { code?: string; message?: string } | null },
) {
  const rpc = vi.fn(() => ({ single: () => Promise.resolve(rpcResult) }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role },
    client: { rpc },
  });
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/projects/[projectId]/production-url", () => {
  it("rejects cross-origin input before opening the tenant boundary", async () => {
    const response = await PATCH(request("https://www.theagoras.com", "https://evil.example"), params);
    expect(response.status).toBe(403);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.theagoras.com",
    "https://user:password@www.theagoras.com",
    "https://www.theagoras.com?secret=no",
    "https://www.theagoras.com#fragment",
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://224.0.0.1",
  ])("rejects unsafe URL %s before the RPC", async (productionUrl) => {
    const rpc = tenantClient("owner", { data: null, error: null });
    const response = await PATCH(request(productionUrl), params);
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_production_url");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects likely secret material before persistence", async () => {
    const rpc = tenantClient("owner", { data: null, error: null });
    const response = await PATCH(
      request(`https://www.theagoras.com/${syntheticSecret}`),
      params,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("sensitive_data_rejected");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a member before the owner/admin RPC", async () => {
    const rpc = tenantClient("member", { data: null, error: null });
    const response = await PATCH(request("https://www.theagoras.com"), params);
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("project_management_forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("canonicalizes and writes the exact tenant project through the RPC", async () => {
    const rpc = tenantClient("admin", {
      data: {
        production_url: "https://www.theagoras.com",
        project_id: projectId,
        updated_at: "2026-08-28T12:00:00.000Z",
      },
      error: null,
    });
    const response = await PATCH(request(" HTTPS://WWW.THEAGORAS.COM/ "), params);
    const body = await response.json() as { project: { productionUrl: string } };
    expect(response.status).toBe(200);
    expect(body.project.productionUrl).toBe("https://www.theagoras.com");
    expect(rpc).toHaveBeenCalledWith("set_project_production_url", {
      p_organization_id: organizationId,
      p_production_url: "https://www.theagoras.com",
      p_project_id: projectId,
    });
  });

  it("supports an explicit clear without inventing a replacement", async () => {
    const rpc = tenantClient("owner", {
      data: {
        production_url: null,
        project_id: projectId,
        updated_at: "2026-08-28T12:00:00.000Z",
      },
      error: null,
    });
    const response = await PATCH(request(null), params);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_project_production_url", expect.objectContaining({
      p_production_url: null,
    }));
  });
});
