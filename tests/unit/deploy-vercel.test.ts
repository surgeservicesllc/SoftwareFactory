// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  isDeploymentProviderConfigured,
  latestReadyProduction,
  listRecentDeployments,
} = await import("@/lib/deploy/vercel");

const originalToken = process.env.VERCEL_TOKEN;

function deploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    uid: "dpl_1",
    readyState: "READY",
    target: "production",
    url: "app-abc.vercel.app",
    createdAt: 1_760_000_000_000,
    meta: { githubCommitSha: "abc1234", githubCommitRef: "main" },
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.VERCEL_TOKEN;
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.VERCEL_TOKEN;
  else process.env.VERCEL_TOKEN = originalToken;
});

describe("when no provider is configured", () => {
  it("reports it rather than looking like nothing is deployed", async () => {
    const result = await listRecentDeployments("prj_1");

    expect(result.status).toBe("not_connected");
    expect(result.deployments).toEqual([]);
    expect(result.reason).toMatch(/VERCEL_TOKEN/);
  });

  it("says so without issuing a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await listRecentDeployments("prj_1");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isDeploymentProviderConfigured()).toBe(false);
  });

  it("resolves no Last Known Good candidate", async () => {
    expect(latestReadyProduction(await listRecentDeployments("prj_1"))).toBeNull();
  });
});

describe("when a connection-resolved credential is supplied", () => {
  it("uses the credential's token, not the ambient one", async () => {
    process.env.VERCEL_TOKEN = "ambient-token";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [deploymentRow()] }), { status: 200 }),
    );

    const result = await listRecentDeployments("prj_1", {
      credential: { token: "team-a-token" },
    });

    expect(result.status).toBe("connected");
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer team-a-token");
  });

  it("reads two accounts in one process — one per connection credential", async () => {
    // The structural multi-account claim: with no ambient token at all, two
    // reads carrying two connections' credentials authenticate as two
    // different accounts.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [] }), { status: 200 }),
    );

    await listRecentDeployments("prj_a", { credential: { token: "team-a-token" } });
    await listRecentDeployments("prj_b", { credential: { token: "team-b-token" } });

    const bearers = fetchSpy.mock.calls.map(
      (call) => ((call[1] as RequestInit).headers as Record<string, string>).Authorization,
    );
    expect(bearers).toEqual(["Bearer team-a-token", "Bearer team-b-token"]);
  });

  it("still reports not connected when neither credential nor ambient token exists", async () => {
    const result = await listRecentDeployments("prj_1", {});
    expect(result.status).toBe("not_connected");
    expect(result.reason).toMatch(/connection-resolved deployment credential/);
  });
});

describe("when the provider answers", () => {
  beforeEach(() => {
    process.env.VERCEL_TOKEN = "test-token";
  });

  it("maps a deployment into the tracked shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [deploymentRow()] }), { status: 200 }),
    );

    const result = await listRecentDeployments("prj_1");

    expect(result.status).toBe("connected");
    expect(result.deployments[0]).toEqual({
      id: "dpl_1",
      state: "ready",
      target: "production",
      url: "https://app-abc.vercel.app",
      commitSha: "abc1234",
      branch: "main",
      createdAt: new Date(1_760_000_000_000).toISOString(),
    });
  });

  it.each([
    ["QUEUED", "queued"],
    ["INITIALIZING", "queued"],
    ["BUILDING", "building"],
    ["READY", "ready"],
    ["ERROR", "error"],
    ["CANCELED", "canceled"],
    ["SOMETHING_NEW", "unknown"],
  ])("narrows readyState %s to %s", async (provider, expected) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [deploymentRow({ readyState: provider })] }), {
        status: 200,
      }),
    );

    const result = await listRecentDeployments("prj_1");
    expect(result.deployments[0].state).toBe(expected);
  });

  it("treats anything that is not production as a preview", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [deploymentRow({ target: null })] }), {
        status: 200,
      }),
    );

    expect((await listRecentDeployments("prj_1")).deployments[0].target).toBe("preview");
  });

  it("tolerates a deployment with no commit metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [deploymentRow({ meta: {} })] }), { status: 200 }),
    );

    const [deployment] = (await listRecentDeployments("prj_1")).deployments;
    expect(deployment.commitSha).toBeNull();
    expect(deployment.branch).toBeNull();
  });

  it("bounds the requested page size", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [] }), { status: 200 }),
    );

    await listRecentDeployments("prj_1", { limit: 5000 });

    const requested = String(fetchSpy.mock.calls[0][0]);
    expect(requested).toContain("limit=20");
  });

  it("passes the target through when one is asked for", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deployments: [] }), { status: 200 }),
    );

    await listRecentDeployments("prj_1", { target: "production" });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("target=production");
  });
});

describe("when the provider fails", () => {
  beforeEach(() => {
    process.env.VERCEL_TOKEN = "test-token";
  });

  it("reports an error status rather than an empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));

    const result = await listRecentDeployments("prj_1");

    expect(result.status).toBe("error");
    expect(result.deployments).toEqual([]);
    expect(result.reason).toContain("403");
  });

  it("does not echo the provider's response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("token=super-secret-value", { status: 401 }),
    );

    const result = await listRecentDeployments("prj_1");
    expect(result.reason).not.toContain("super-secret-value");
  });

  it("never throws when the network is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await listRecentDeployments("prj_1");
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/could not be reached/i);
  });

  it("reports a timeout distinctly", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    expect((await listRecentDeployments("prj_1")).reason).toMatch(/did not respond in time/i);
  });

  it("resolves no Last Known Good candidate from a failed read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    expect(latestReadyProduction(await listRecentDeployments("prj_1"))).toBeNull();
  });
});

describe("latestReadyProduction", () => {
  beforeEach(() => {
    process.env.VERCEL_TOKEN = "test-token";
  });

  it("picks the first ready production deployment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          deployments: [
            deploymentRow({ uid: "dpl_building", readyState: "BUILDING" }),
            deploymentRow({ uid: "dpl_preview", target: "preview" }),
            deploymentRow({ uid: "dpl_good" }),
          ],
        }),
        { status: 200 },
      ),
    );

    const candidate = latestReadyProduction(await listRecentDeployments("prj_1"));
    expect(candidate?.id).toBe("dpl_good");
  });

  it("returns null when nothing production is ready", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ deployments: [deploymentRow({ readyState: "ERROR" })] }),
        { status: 200 },
      ),
    );

    expect(latestReadyProduction(await listRecentDeployments("prj_1"))).toBeNull();
  });
});

describe("the module exposes no way to mutate a deployment", () => {
  it("exports reads only", async () => {
    const vercel = await import("@/lib/deploy/vercel");
    const exported = Object.keys(vercel);

    // Adding promote/rollback/create here is a separate, owner-approved
    // decision. Absent is stronger than present-and-disabled.
    expect(exported.sort()).toEqual([
      "isDeploymentProviderConfigured",
      "latestReadyProduction",
      "listRecentDeployments",
    ]);
  });
});
