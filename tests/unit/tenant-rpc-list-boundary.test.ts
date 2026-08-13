// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/tenant", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/supabase/tenant")>();
  return {
    ...original,
    requireActiveOrganization: harness.requireActiveOrganization,
  };
});

import { tenantRpcListResponse } from "@/lib/server/tenant-list";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";
import { SupabaseTenantError } from "@/lib/supabase/tenant";

const organizationId = "11111111-1111-4111-8111-111111111111";

function request(query = "") {
  return new Request(`https://factory.example/api/tasks${query}`);
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}

async function respond(query = "") {
  return tenantRpcListResponse<{ id: string }>({
    request: request(query),
    rpc: "list_tasks",
    unavailableCode: "tasks_unavailable",
    unavailableMessage: "The backlog could not be loaded.",
    shape: (rows) => ({ tasks: rows }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.rpc.mockResolvedValue({ data: [{ id: "task-1" }], error: null });
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: {
      id: organizationId,
      name: "Tenant One",
      role: "viewer",
      slug: "tenant-one",
    },
    client: { rpc: harness.rpc },
    memberships: [],
    user: { id: "22222222-2222-4222-8222-222222222222" },
  });
});

describe("tenant RPC list server boundary", () => {
  it.each(["?limit=0", "?limit=101", "?limit=1.5", "?limit=not-a-number"])(
    "rejects invalid limits before authentication or database access (%s)",
    async (query) => {
      const response = await respond(query);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_query", message: "The query is invalid." },
      });
      expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
      expect(harness.rpc).not.toHaveBeenCalled();
      expectNoStore(response);
    },
  );

  it("passes only the bounded limit and exact active organization to the RPC", async () => {
    const response = await respond("?limit=7");

    expect(response.status).toBe(200);
    expect(harness.requireActiveOrganization).toHaveBeenCalledTimes(1);
    expect(harness.rpc).toHaveBeenCalledExactlyOnceWith("list_tasks", {
      p_limit: 7,
      p_organization_id: organizationId,
    });
    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: organizationId,
      tasks: [{ id: "task-1" }],
    });
    expectNoStore(response);
  });

  it("uses the server-side default limit when the query omits it", async () => {
    await respond();

    expect(harness.rpc).toHaveBeenCalledExactlyOnceWith("list_tasks", {
      p_limit: 50,
      p_organization_id: organizationId,
    });
  });

  it("preserves the authentication boundary response and never calls the RPC", async () => {
    harness.requireActiveOrganization.mockRejectedValueOnce(
      new SupabaseAuthenticationError(
        "authentication_required",
        "Authentication is required.",
      ),
    );

    const response = await respond("?limit=10");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication is required.",
      },
    });
    expect(harness.rpc).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("preserves the active-tenant boundary response and never calls the RPC", async () => {
    harness.requireActiveOrganization.mockRejectedValueOnce(
      new SupabaseTenantError(
        "active_organization_forbidden",
        "The selected organization is no longer available to this user.",
        403,
      ),
    );

    const response = await respond("?limit=10");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "active_organization_forbidden",
        message: "The selected organization is no longer available to this user.",
      },
    });
    expect(harness.rpc).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("maps a database authorization failure without weakening no-store", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied for function list_tasks" },
    });

    const response = await respond("?limit=10");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "42501",
        message: "permission denied for function list_tasks",
      },
    });
    expectNoStore(response);
  });

  it("sanitizes unknown database failures", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "internal database detail must not escape" },
    });

    const response = await respond("?limit=10");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "database_error",
        message: "The control-plane database request failed.",
      },
    });
    expectNoStore(response);
  });

  it("returns the route-specific safe failure for an unexpected exception", async () => {
    harness.rpc.mockRejectedValueOnce(new Error("unexpected internal detail"));

    const response = await respond("?limit=10");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "tasks_unavailable",
        message: "The backlog could not be loaded.",
      },
    });
    expectNoStore(response);
  });
});
