import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { DELETE, PUT } from "@/app/api/projects/[projectId]/repository/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const repositoryUuid = "44444444-4444-4444-8444-444444444444";

const params = { params: Promise.resolve({ projectId }) };

function putRequest(options: {
  origin?: string | null;
  body?: Record<string, unknown>;
} = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? "https://factory.example");
  }
  return new Request("https://factory.example/api/projects/" + projectId + "/repository", {
    body: JSON.stringify(options.body ?? { connectionId, repositoryId: 600001 }),
    headers,
    method: "PUT",
  });
}

function deleteRequest(origin: string | null = "https://factory.example") {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  return new Request("https://factory.example/api/projects/" + projectId + "/repository", {
    headers,
    method: "DELETE",
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

describe("PUT /api/projects/[projectId]/repository", () => {
  it("rejects a cross-origin request before touching the tenant boundary", async () => {
    const response = await PUT(putRequest({ origin: "https://evil.example" }), params);
    expect(response.status).toBe(403);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID project id", async () => {
    const response = await PUT(putRequest(), {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_project_id");
  });

  it("rejects an invalid body without calling the database", async () => {
    const rpc = tenantClient("owner", { data: null, error: null });
    const response = await PUT(
      putRequest({ body: { connectionId, repositoryId: "600001" } }),
      params,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_repository_link");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a member without owner or administrator access", async () => {
    const rpc = tenantClient("member", { data: null, error: null });
    const response = await PUT(putRequest(), params);
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("project_management_forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("links a repository through the serialized database function", async () => {
    const rpc = tenantClient("admin", {
      data: {
        connection_id: connectionId,
        default_branch: "main",
        github_repository: "example-org/application",
        github_repository_id: repositoryUuid,
        project_id: projectId,
        project_name: "Application",
      },
      error: null,
    });

    const response = await PUT(putRequest(), params);
    const body = await response.json() as {
      project: { githubRepository: string; connectionId: string };
    };
    expect(response.status).toBe(200);
    expect(body.project.githubRepository).toBe("example-org/application");
    expect(body.project.connectionId).toBe(connectionId);
    expect(rpc).toHaveBeenCalledWith("set_project_github_repository", {
      p_connection_id: connectionId,
      p_external_repository_id: 600001,
      p_organization_id: organizationId,
      p_project_id: projectId,
    });
  });

  it("surfaces the named uniqueness refusal verbatim as a 409", async () => {
    tenantClient("owner", {
      data: null,
      error: {
        code: "55000",
        message: "that repository is already linked to project \"Billing\"",
      },
    });

    const response = await PUT(putRequest(), params);
    const body = await response.json() as { error: { message: string } };
    expect(response.status).toBe(409);
    expect(body.error.message).toBe("that repository is already linked to project \"Billing\"");
  });

  it("maps a raw unique-constraint race to a readable conflict, not a raw failure", async () => {
    tenantClient("owner", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const response = await PUT(putRequest(), params);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("repository_already_linked");
    expect(body.error.message).not.toMatch(/duplicate key|constraint/);
  });
});

describe("DELETE /api/projects/[projectId]/repository", () => {
  it("rejects a cross-origin request", async () => {
    const response = await DELETE(deleteRequest("https://evil.example"), params);
    expect(response.status).toBe(403);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("refuses a member without owner or administrator access", async () => {
    const rpc = tenantClient("member", { data: null, error: null });
    const response = await DELETE(deleteRequest(), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("unlinks through the database function and reports the removed link", async () => {
    const rpc = tenantClient("owner", {
      data: {
        previous_connection_id: connectionId,
        previous_github_repository: "example-org/application",
        previous_github_repository_id: repositoryUuid,
        project_id: projectId,
        project_name: "Application",
      },
      error: null,
    });

    const response = await DELETE(deleteRequest(), params);
    const body = await response.json() as {
      project: { githubRepository: null; previousGithubRepository: string };
    };
    expect(response.status).toBe(200);
    expect(body.project.githubRepository).toBeNull();
    expect(body.project.previousGithubRepository).toBe("example-org/application");
    expect(rpc).toHaveBeenCalledWith("unlink_project_github_repository", {
      p_organization_id: organizationId,
      p_project_id: projectId,
    });
  });

  it("returns the function's refusal when no repository is linked", async () => {
    tenantClient("owner", {
      data: null,
      error: { code: "55000", message: "project has no linked GitHub repository" },
    });

    const response = await DELETE(deleteRequest(), params);
    const body = await response.json() as { error: { message: string } };
    expect(response.status).toBe(409);
    expect(body.error.message).toBe("project has no linked GitHub repository");
  });
});
