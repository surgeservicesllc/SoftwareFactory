import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createGitHubInstallationToken,
  createSupabaseGitHubWebhookClient,
  dispatchGraphWorker,
  getGitHubAppConfigurationForAppId,
  getGitHubBranchReference,
  getGitHubFile,
  requireActiveOrganization,
} = vi.hoisted(() => ({
  createGitHubInstallationToken: vi.fn(),
  createSupabaseGitHubWebhookClient: vi.fn(),
  dispatchGraphWorker: vi.fn(),
  getGitHubAppConfigurationForAppId: vi.fn(),
  getGitHubBranchReference: vi.fn(),
  getGitHubFile: vi.fn(),
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({ dispatchGraphWorker }));
vi.mock("@/lib/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/client")>()),
  createGitHubInstallationToken,
}));
vi.mock("@/lib/github/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/config")>()),
  getGitHubAppConfigurationForAppId,
}));
vi.mock("@/lib/github/service-role", () => ({ createSupabaseGitHubWebhookClient }));
vi.mock("@/lib/github/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/repository")>()),
  getGitHubBranchReference,
  getGitHubFile,
}));

import { POST } from "@/app/api/graphs/route";

/**
 * The Workflows page's Launch, at the route boundary.
 *
 * The case that earned this file: the owner pressed Launch on
 * `full_lifecycle`, the graph landed PLANNED — and nothing ever ran it. The
 * route recorded the graph and stopped, the scheduled drain is off by
 * default, and the wake that the command routes fire was missing here. The
 * button looked like "run this" and meant "file this".
 *
 * So the properties pinned are the wake's: it fires with the created graph's
 * id through the project's own binding, its failure can never fail a launch
 * that already succeeded, and the response says plainly which of the two
 * worlds the caller is in.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const projectId = "55555555-5555-4555-8555-555555555555";
const ownerId = "33333333-3333-4333-8333-333333333333";
const graphId = "66666666-6666-4666-8666-666666666666";
const baseSha = "a".repeat(40);
const defaultGoal = "Deliver the exact requested production change.";
const requiredChecks = [
  "Lint, typecheck, test, and build",
  "Browser and accessibility tests 1/3",
  "Browser and accessibility tests 2/3",
  "Browser and accessibility tests 3/3",
];

const targetRow = {
  app_id: 99,
  base_branch: "main",
  connection_id: "77777777-7777-4777-8777-777777777777",
  external_installation_id: 1234,
  external_repository_id: 5678,
  internal_installation_id: "88888888-8888-4888-8888-888888888888",
  project_id: projectId,
  repository_full_name: "owner/repository",
  repository_id: "99999999-9999-4999-8999-999999999999",
};

const rpc = vi.fn();

/**
 * The billing tables the launch quota reads. Chainable like PostgREST and
 * thenable at the end; the counts default to an untouched Free organization
 * so every pre-existing case launches exactly as it did before quotas.
 */
const usageCounts = { graphs: 0, projects: 0, members: 1 };

function from(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "lt", "order", "limit"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) => {
    if (table === "billing_subscriptions") return resolve({ data: [], error: null });
    if (table === "graphs") return resolve({ count: usageCounts.graphs, error: null });
    if (table === "projects") return resolve({ count: usageCounts.projects, error: null });
    if (table === "organization_members") return resolve({ count: usageCounts.members, error: null });
    return resolve({ data: null, error: null });
  };
  return chain;
}

function request(body: unknown) {
  return new Request("https://factory.example/api/graphs", {
    body: JSON.stringify(body),
    headers: new Headers({
      "Content-Type": "application/json",
      Origin: "https://factory.example",
    }),
    method: "POST",
  });
}

function rawRequest(body: BodyInit, contentType?: string) {
  const headers = new Headers({ Origin: "https://factory.example" });
  if (contentType) headers.set("Content-Type", contentType);
  return new Request("https://factory.example/api/graphs", {
    body,
    headers,
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation((functionName: string) => {
    if (functionName === "create_graph_from_plan_with_release_identity_as_server") {
      return Promise.resolve({ data: graphId, error: null });
    }
    // resolve_phase1c_command_target
    return { single: async () => ({ data: targetRow, error: null }) };
  });
  usageCounts.graphs = 0;
  usageCounts.projects = 0;
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc, from },
    user: { id: ownerId },
  });
  createSupabaseGitHubWebhookClient.mockReturnValue({ rpc });
  createGitHubInstallationToken.mockResolvedValue({ token: "installation-token" });
  getGitHubAppConfigurationForAppId.mockReturnValue({ appId: targetRow.app_id });
  getGitHubBranchReference.mockResolvedValue({ object: { sha: baseSha } });
  getGitHubFile.mockResolvedValue({
    content: JSON.stringify({ version: 1, requiredChecks }),
    path: ".softwarefactory/release-policy.json",
    ref: baseSha,
  });
  dispatchGraphWorker.mockResolvedValue({ dispatched: true, reason: "dispatched" });
});

describe("POST /api/graphs", () => {
  it("refuses the launch at the Free plan's monthly allowance, before any compile work", async () => {
    usageCounts.graphs = 10;

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(402);
    const body = await response.json() as {
      error: { code: string; message: string; limit: number; current: number; plan: string };
    };
    expect(body.error.code).toBe("plan_limit_reached");
    expect(body.error.limit).toBe(10);
    expect(body.error.current).toBe(10);
    expect(body.error.plan).toBe("free");
    // The refusal cost nothing: no graph was created, no worker woken.
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("wakes the worker for the graph it just created, and says so", async () => {
    const response = await POST(request({
      projectId,
      templateKey: "full_lifecycle",
      goal: "  Repair checkout failures and preserve authentication.  ",
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      graphId: string; state: string; workerWoken: boolean; note: string;
    };
    expect(body.graphId).toBe(graphId);
    expect(body.state).toBe("PLANNED");
    expect(body.workerWoken).toBe(true);
    expect(body.note).toContain("woken");

    expect(createGitHubInstallationToken).toHaveBeenCalledWith(
      { appId: targetRow.app_id },
      targetRow.external_installation_id,
      {
        permissions: { contents: "read", metadata: "read" },
        repositoryIds: [targetRow.external_repository_id],
      },
    );
    expect(getGitHubBranchReference).toHaveBeenCalledWith(
      "installation-token",
      "owner",
      "repository",
      "main",
    );
    expect(getGitHubFile).toHaveBeenCalledWith(
      "installation-token",
      "owner",
      "repository",
      baseSha,
      ".softwarefactory/release-policy.json",
    );

    const createCall = rpc.mock.calls.find(
      ([functionName]) => functionName === "create_graph_from_plan_with_release_identity_as_server",
    );
    expect(createCall?.[1]).toMatchObject({
      p_base_branch: "main",
      p_base_sha: baseSha,
      p_goal: "Repair checkout failures and preserve authentication.",
      p_github_repository_id: targetRow.repository_id,
      p_requested_by: ownerId,
      p_required_check_names: requiredChecks,
      p_template_key: "full_lifecycle",
      p_template_version: 2,
    });

    expect(dispatchGraphWorker).toHaveBeenCalledWith(
      {
        appId: targetRow.app_id,
        externalInstallationId: targetRow.external_installation_id,
        externalRepositoryId: targetRow.external_repository_id,
        repositoryFullName: targetRow.repository_full_name,
      },
      graphId,
    );
  });

  it("keeps the launch's answer independent of a wake that throws", async () => {
    dispatchGraphWorker.mockRejectedValue(new Error("GitHub is unreachable"));

    const response = await POST(request({ projectId, templateKey: "full_lifecycle", goal: defaultGoal }));

    expect(response.status).toBe(200);
    const body = await response.json() as { graphId: string; workerWoken: boolean; note: string };
    expect(body.graphId).toBe(graphId);
    expect(body.workerWoken).toBe(false);
    expect(body.note).toContain("global worker gate");
  });

  it("refuses Full Lifecycle before recording when no exact repository is connected", async () => {
    rpc.mockImplementation(() => {
      return { single: async () => ({ data: null, error: { code: "PGRST116" } }) };
    });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle", goal: defaultGoal }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalledWith(
      "create_graph_from_plan_with_release_identity_as_server",
      expect.anything(),
    );
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses Full Lifecycle before recording when GitHub returns no exact base SHA", async () => {
    getGitHubBranchReference.mockResolvedValue({ object: { sha: "not-a-commit" } });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle", goal: defaultGoal }));

    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalledWith(
      "create_graph_from_plan_with_release_identity_as_server",
      expect.anything(),
    );
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses Full Lifecycle when the exact base has no usable repository release policy", async () => {
    getGitHubFile.mockResolvedValue({ content: "{}" });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle", goal: defaultGoal }));

    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code)
      .toBe("release_policy_invalid");
    expect(rpc).not.toHaveBeenCalledWith(
      "create_graph_from_plan_with_release_identity_as_server",
      expect.anything(),
    );
  });

  it("never wakes anything when the plan was refused", async () => {
    rpc.mockImplementation((functionName: string) => {
      if (functionName === "create_graph_from_plan_with_release_identity_as_server") {
        return Promise.resolve({
          data: null,
          error: { code: "42501", message: "organization membership is required" },
        });
      }
      return { single: async () => ({ data: targetRow, error: null }) };
    });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle", goal: defaultGoal }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });
});

/**
 * Step 1's refusals.
 *
 * The ten-step flow begins here, so every way this call can be wrong is a way
 * the whole lifecycle can start from a lie: a graph planted against a project
 * the caller may not touch, a template that does not exist, a body that named
 * neither. Each refusal must reach the caller as a refusal — never a recorded
 * graph, never a woken worker.
 */
describe("POST /api/graphs refuses before it records", () => {
  it("returns the bounded JSON error for malformed JSON", async () => {
    const response = await POST(rawRequest("{not-json", "application/json"));

    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_json");
    expect(requireActiveOrganization).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing content type", new Uint8Array(new TextEncoder().encode("{}")), undefined],
    ["a wrong content type", "{}", "text/plain"],
  ] as const)("returns the bounded JSON error for %s", async (_label, body, contentType) => {
    const response = await POST(rawRequest(body, contentType));

    expect(response.status).toBe(415);
    expect((await response.json() as { error: { code: string } }).error.code)
      .toBe("unsupported_media_type");
    expect(requireActiveOrganization).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the bounded JSON error for an oversized body", async () => {
    const response = await POST(rawRequest(
      JSON.stringify({ padding: "x".repeat(21 * 1024) }),
      "application/json",
    ));

    expect(response.status).toBe(413);
    expect((await response.json() as { error: { code: string } }).error.code)
      .toBe("payload_too_large");
    expect(requireActiveOrganization).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that does not name a project and a template", async () => {
    const response = await POST(request({ templateKey: "full_lifecycle" }));

    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses a project identifier that is not a uuid", async () => {
    const response = await POST(request({ projectId: "not-a-uuid", templateKey: "full_lifecycle" }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an empty, oversized, or secret-shaped goal before persistence", async () => {
    for (const goal of ["   ", "x".repeat(4_001), `sk-${"a".repeat(32)}`]) {
      const response = await POST(request({ projectId, templateKey: "full_lifecycle", goal }));
      expect(response.status).toBe(400);
    }

    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses Full Lifecycle when no real user goal was supplied", async () => {
    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(400);
    expect((await response.json() as { error: { message: string } }).error.message)
      .toContain("concrete goal");
    expect(rpc).not.toHaveBeenCalledWith(
      "create_graph_from_plan_with_release_identity_as_server",
      expect.anything(),
    );
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("names the template a caller asked for and could not have", async () => {
    // A typo or a stale client. The message says which key failed, because
    // "not found" alone leaves the caller guessing which half was wrong.
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: {
        rpc,
        // The quota tables answer through the shared fake; only the custom
        // template lookup needs its own not-found chain.
        from: (table: string) =>
          table === "graph_templates"
            ? {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                    }),
                  }),
                }),
              }
            : from(table),
      },
    });

    const response = await POST(request({ projectId, templateKey: "no_such_template" }));

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain("no_such_template");
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses a member who may not launch, before any graph exists", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("manager_required");
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses a request that did not come from this origin", async () => {
    const response = await POST(
      new Request("https://factory.example/api/graphs", {
        body: JSON.stringify({ projectId, templateKey: "full_lifecycle" }),
        headers: new Headers({
          "Content-Type": "application/json",
          Origin: "https://elsewhere.example",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code)
      .toBe("invalid_request_origin");
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });
});

describe("launching from a sentence alone", () => {
  it("accepts a goal with no template and routes it through the Chief of Staff", async () => {
    /*
     * The headline the product makes: someone types what they want and the
     * system decides how to run it. Before this the route demanded a
     * templateKey, so "Build me a booking app" could not launch at all.
     */
    const response = await POST(request({
      projectId,
      goal: "Build me a booking app for my salon",
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      template: { key: string };
      chiefOfStaff: { intent: string; shape: string; rationale: string } | null;
    };

    // A whole product earns the ten-phase path, which no keyword reached before.
    expect(body.template.key).toBe("full_lifecycle");
    expect(body.chiefOfStaff?.intent).toBe("build");
    expect(body.chiefOfStaff?.shape).toBe("full_lifecycle");
    expect(body.chiefOfStaff?.rationale).toMatch(/whole product/i);
  });

  it("never overrides a template the caller named", async () => {
    /*
     * A classifier that second-guesses an explicit choice is a classifier
     * nobody can rely on. When templateKey is given there is no decision to
     * make and none to explain, so chiefOfStaff is null rather than a
     * rationalisation of what the caller already decided.
     */
    const response = await POST(request({
      projectId,
      templateKey: "full_lifecycle",
      goal: "Fix the broken checkout",
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      template: { key: string }; chiefOfStaff: unknown | null;
    };
    expect(body.template.key).toBe("full_lifecycle");
    expect(body.chiefOfStaff).toBeNull();
  });

  it("refuses a request that names neither a goal nor a template", async () => {
    const response = await POST(request({ projectId }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
