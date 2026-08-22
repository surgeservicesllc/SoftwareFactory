// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireActiveOrganization = vi.fn();
vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

const { GET, POST, DELETE } = await import("@/app/api/project-agents/route");

/**
 * The agent-inclusion boundary.
 *
 * The database enforces who may select; these tests are about the parts the
 * route owns: shape validation before anything is written, the missing-
 * migration state arriving as itself (Not Connected, never an empty list
 * that lies), refusals surfaced verbatim, and a cross-origin write never
 * reaching Supabase at all.
 */

const organizationId = "11111111-2222-4333-8444-666666666666";
const projectId = "44444444-5555-4666-8777-999999999999";
const agentId = "55555555-6666-4777-8888-111111111111";

const rpc = vi.fn();
const client = { rpc };

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`https://factory.test${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      host: "factory.test",
      origin: "https://factory.test",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client,
  });
  rpc.mockReturnValue({ single: async () => ({ data: null, error: null }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/project-agents", () => {
  it("returns the selections with their agent names, and who may manage", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          selection_id: "pa1",
          selection_project_id: projectId,
          selection_agent_id: agentId,
          selection_selected_at: "2026-08-22T10:00:00.000Z",
          agent_name: "Orchestrator",
          agent_role: "orchestrator",
        },
      ],
      error: null,
    });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.canManage).toBe(true);
    expect(body.selections).toEqual([
      {
        id: "pa1",
        projectId,
        agentId,
        agentName: "Orchestrator",
        agentRole: "orchestrator",
        selectedAt: "2026-08-22T10:00:00.000Z",
      },
    ]);
  });

  it("reports a member as unable to manage", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client,
    });
    rpc.mockResolvedValue({ data: [], error: null });

    const body = await (await GET()).json();
    expect(body.canManage).toBe(false);
  });

  it("reports the missing migration as unavailable, never as an empty success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "no function" } });

    const body = await (await GET()).json();
    expect(body.available).toBe(false);
    expect(body.selections).toEqual([]);
  });
});

describe("POST /api/project-agents", () => {
  it("records an inclusion through the definer function under the caller's identity", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: {
          selection_id: "pa1",
          selection_agent_id: agentId,
          selection_selected_at: "2026-08-22T10:00:00.000Z",
          selection_created: true,
        },
        error: null,
      }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-agents", { projectId, agentId }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.selection.agentId).toBe(agentId);
    expect(rpc).toHaveBeenCalledWith("select_project_agent", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_agent_id: agentId,
    });
  });

  it("refuses a payload that is not a project and an agent", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/project-agents", { projectId, agentId: "not-a-uuid" }),
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the missing migration as Not Connected", async () => {
    rpc.mockReturnValue({
      single: async () => ({ data: null, error: { code: "PGRST202", message: "no function" } }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-agents", { projectId, agentId }),
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("agent_selection_not_connected");
  });

  it("surfaces the database's refusal verbatim rather than a generic failure", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: null,
        error: { code: "55000", message: "an agent bound to another project cannot be included here" },
      }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-agents", { projectId, agentId }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(String(body.error.message)).toMatch(/bound to another project/i);
  });

  it("never reaches Supabase on a cross-origin write", async () => {
    const request = new Request("https://factory.test/api/project-agents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "factory.test",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ projectId, agentId }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/project-agents", () => {
  it("removes an inclusion and reports whether anything changed", async () => {
    rpc.mockReturnValue({
      single: async () => ({ data: { selection_removed: true }, error: null }),
    });

    const response = await DELETE(
      jsonRequest(
        "DELETE",
        `/api/project-agents?projectId=${projectId}&agentId=${agentId}`,
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.removed).toBe(true);
    expect(rpc).toHaveBeenCalledWith("deselect_project_agent", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_agent_id: agentId,
    });
  });

  it("refuses malformed query parameters before touching the database", async () => {
    const response = await DELETE(
      jsonRequest("DELETE", "/api/project-agents?projectId=nope&agentId=nope"),
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
