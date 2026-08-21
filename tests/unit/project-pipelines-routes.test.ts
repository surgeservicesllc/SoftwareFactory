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

const { GET, POST, DELETE } = await import("@/app/api/project-pipelines/route");

/**
 * The selection boundary.
 *
 * The database enforces who may select; these tests are about the parts the
 * route owns: that a key naming nothing is refused before anything is
 * written, that a built-in's name comes from code while a custom one's comes
 * from its row, that a refusal arrives as itself rather than as a generic
 * failure, and that a cross-origin write never reaches Supabase at all.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const projectId = "44444444-5555-4666-8777-888888888888";

const rpc = vi.fn();
const from = vi.fn();
const client = { from, rpc };

/** `client.from(...).select(...).eq(...)...limit(...)` resolving to rows. */
function graphTemplatesReturning(rows: Array<{ id: string }>) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(async () => ({ data: rows, error: null }));
  return vi.fn(() => chain);
}

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
  from.mockImplementation(graphTemplatesReturning([]));
  rpc.mockReturnValue({ single: async () => ({ data: null, error: null }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/project-pipelines", () => {
  it("names a built-in from code and a custom template from its row", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          pipeline_id: "pp1",
          pipeline_project_id: projectId,
          pipeline_template_key: "production_readiness",
          pipeline_template_id: null,
          pipeline_selected_at: "2026-08-18T10:00:00.000Z",
          pipeline_template_name: null,
        },
        {
          pipeline_id: "pp2",
          pipeline_project_id: projectId,
          pipeline_template_key: "house_style_audit",
          pipeline_template_id: "99999999-8888-4777-8666-555555555555",
          pipeline_selected_at: "2026-08-18T10:05:00.000Z",
          pipeline_template_name: "House style audit",
        },
      ],
      error: null,
    });

    const body = (await (await GET()).json()) as {
      pipelines: Array<{ kind: string; name: string; templateKey: string }>;
      canManage: boolean;
    };

    expect(body.pipelines[0]).toMatchObject({
      kind: "built_in",
      // From `GRAPH_TEMPLATES`, not stored beside the selection, so a
      // built-in renamed in code renames everywhere at once.
      name: "Production Readiness",
      templateKey: "production_readiness",
    });
    expect(body.pipelines[1]).toMatchObject({
      kind: "custom",
      name: "House style audit",
      templateKey: "house_style_audit",
    });
    expect(body.canManage).toBe(true);
  });

  it("reports a member as unable to manage, so the console does not offer what it cannot do", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client,
    });
    rpc.mockResolvedValue({ data: [], error: null });

    const body = (await (await GET()).json()) as { canManage: boolean };
    expect(body.canManage).toBe(false);
  });
});

describe("POST /api/project-pipelines", () => {
  it("selects a built-in through the definer function", async () => {
    const single = vi.fn(async () => ({
      data: {
        pipeline_id: "pp1",
        pipeline_template_key: "security_audit",
        pipeline_template_id: null,
        pipeline_selected_at: "2026-08-18T10:00:00.000Z",
        pipeline_created: true,
      },
      error: null,
    }));
    rpc.mockReturnValue({ single });

    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId, templateKey: "security_audit" }),
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("select_project_pipeline", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_template_key: "security_audit",
    });
    expect((await response.json()).created).toBe(true);
  });

  it("reports a repeat as a success that changed nothing", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: {
          pipeline_id: "pp1",
          pipeline_template_key: "security_audit",
          pipeline_template_id: null,
          pipeline_selected_at: "2026-08-18T10:00:00.000Z",
          pipeline_created: false,
        },
        error: null,
      }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId, templateKey: "security_audit" }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(false);
  });

  it("refuses a key that names neither a built-in nor a template here, before writing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId, templateKey: "not_a_template" }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("template_not_found");
    // The point of checking first: nothing reached the database.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a custom template that exists in this workspace", async () => {
    from.mockImplementation(graphTemplatesReturning([{ id: "t1" }]));
    rpc.mockReturnValue({
      single: async () => ({
        data: {
          pipeline_id: "pp9",
          pipeline_template_key: "house_style_audit",
          pipeline_template_id: "t1",
          pipeline_selected_at: "2026-08-18T10:00:00.000Z",
          pipeline_created: true,
        },
        error: null,
      }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId, templateKey: "house_style_audit" }),
    );
    expect(response.status).toBe(200);
  });

  it("passes the database's own refusal through instead of a generic failure", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: null,
        error: { code: "55000", message: "an archived project cannot change its pipelines" },
      }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId, templateKey: "bug_sweep" }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/archived project cannot change/i);
  });

  it("refuses a body that is not a project and a key", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId: "not-a-uuid", templateKey: "Bug Sweep" }),
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin write outright", async () => {
    const response = await POST(
      new Request("https://factory.test/api/project-pipelines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "factory.test",
          origin: "https://attacker.test",
        },
        body: JSON.stringify({ projectId, templateKey: "bug_sweep" }),
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/project-pipelines", () => {
  it("removes a selection named in the query string", async () => {
    rpc.mockReturnValue({ single: async () => ({ data: { pipeline_removed: true }, error: null }) });

    const response = await DELETE(
      jsonRequest("DELETE", `/api/project-pipelines?projectId=${projectId}&templateKey=bug_sweep`),
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("deselect_project_pipeline", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_template_key: "bug_sweep",
    });
    expect((await response.json()).removed).toBe(true);
  });

  it("says it removed nothing when nothing was selected", async () => {
    rpc.mockReturnValue({ single: async () => ({ data: { pipeline_removed: false }, error: null }) });

    const response = await DELETE(
      jsonRequest("DELETE", `/api/project-pipelines?projectId=${projectId}&templateKey=bug_sweep`),
    );
    expect((await response.json()).removed).toBe(false);
  });

  it("refuses a request missing either half of the identifier", async () => {
    const response = await DELETE(
      jsonRequest("DELETE", `/api/project-pipelines?projectId=${projectId}`),
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
describe("a database without the migration", () => {
  it("says the selection store is Not Connected rather than reporting an empty set", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.list_project_pipelines" },
    });

    const body = (await (await GET()).json()) as {
      available: boolean;
      canManage: boolean;
      pipelines: unknown[];
    };

    // Empty *and* flagged: "nothing selected" and "cannot select" look the
    // same to a person pressing Use, and only one of them is true here.
    expect(body).toEqual({ available: false, canManage: false, pipelines: [] });
  });

  it("refuses a write with 503 rather than a generic failure", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.select_project_pipeline" },
      }),
    });

    const response = await POST(
      jsonRequest("POST", "/api/project-pipelines", { projectId, templateKey: "bug_sweep" }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("pipeline_selection_not_connected");
  });
});
