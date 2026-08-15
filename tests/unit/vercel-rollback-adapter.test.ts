// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rollbackExecutorStatus, vercelRollbackAdapter } from "@/lib/deploy/vercel-rollback";

const ORIGINAL = { ...process.env };

function mockFetch(responses: { ok: boolean; status: number; body?: unknown }[]) {
  let call = 0;
  // Parameters declared so `mock.calls` is typed as the tuple the assertions
  // read; an argument-less mock types them as `[]`.
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses[Math.min(call++, responses.length - 1)];
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body ?? {},
    } as unknown as Response;
  });
}

beforeEach(() => {
  process.env = { ...ORIGINAL };
  delete process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_TEAM_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe("adapter availability", () => {
  it("is absent without a token, rather than present and always failing", () => {
    // An adapter that exists and fails every call reads as a provider outage;
    // an absent one reads as missing configuration, which is the truth.
    expect(vercelRollbackAdapter("prj_1")).toBeNull();
  });

  it("exists once a token is configured", () => {
    process.env.VERCEL_TOKEN = "tok";
    expect(vercelRollbackAdapter("prj_1")).not.toBeNull();
  });

  it("reports its status honestly for a surface to render", () => {
    expect(rollbackExecutorStatus().connected).toBe(false);
    expect(rollbackExecutorStatus().reason).toContain("keep the release freeze");

    process.env.VERCEL_TOKEN = "tok";
    expect(rollbackExecutorStatus().connected).toBe(true);
  });
});

describe("promotion", () => {
  it("promotes rather than redeploying", async () => {
    process.env.VERCEL_TOKEN = "tok";
    const fetchMock = mockFetch([{ ok: true, status: 200 }]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await vercelRollbackAdapter("prj_1")!.promote("dpl_good");

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    // Reusing the existing build is the point: a rebuild from the same commit
    // can produce a different artifact.
    expect(url).toContain("/promote/dpl_good");
    expect(init?.method).toBe("POST");
  });

  it("never sends a create or delete", async () => {
    process.env.VERCEL_TOKEN = "tok";
    const fetchMock = mockFetch([{ ok: true, status: 200 }]);
    vi.stubGlobal("fetch", fetchMock);

    await vercelRollbackAdapter("prj_1")!.promote("dpl_good");

    const [url, init] = fetchMock.mock.calls[0];
    expect(init?.method).not.toBe("DELETE");
    expect(url).not.toContain("/v13/deployments?");
  });

  it("reports a provider refusal without throwing", async () => {
    process.env.VERCEL_TOKEN = "tok";
    vi.stubGlobal(
      "fetch",
      mockFetch([{ ok: false, status: 403, body: { error: { message: "forbidden" } } }]),
    );

    const result = await vercelRollbackAdapter("prj_1")!.promote("dpl_good");

    // The executor must get an answer, not an exception through the middle of
    // its sequence.
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("forbidden");
  });

  it("never puts the token in the audit detail", async () => {
    process.env.VERCEL_TOKEN = "super-secret-token";
    vi.stubGlobal(
      "fetch",
      mockFetch([{ ok: false, status: 401, body: { error: { message: "bad credentials" } } }]),
    );

    const result = await vercelRollbackAdapter("prj_1")!.promote("dpl_good");

    // This string is written to an audit trail.
    expect(result.detail).not.toContain("super-secret-token");
  });

  it("says so plainly when unreachable", async () => {
    process.env.VERCEL_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

    const result = await vercelRollbackAdapter("prj_1")!.promote("dpl_good");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("could not be reached");
  });
});

describe("state", () => {
  it("maps a ready deployment to READY", async () => {
    process.env.VERCEL_TOKEN = "tok";
    vi.stubGlobal("fetch", mockFetch([{ ok: true, status: 200, body: { readyState: "READY" } }]));

    expect(await vercelRollbackAdapter("prj_1")!.state("dpl_1")).toBe("READY");
  });

  it("treats a cancelled deployment as an error, not a pending one", async () => {
    process.env.VERCEL_TOKEN = "tok";
    vi.stubGlobal("fetch", mockFetch([{ ok: true, status: 200, body: { readyState: "CANCELED" } }]));

    // Waiting on a cancelled deployment would hang the rollback.
    expect(await vercelRollbackAdapter("prj_1")!.state("dpl_1")).toBe("ERROR");
  });

  it("reports an unrecognised state as UNKNOWN rather than guessing READY", async () => {
    process.env.VERCEL_TOKEN = "tok";
    vi.stubGlobal("fetch", mockFetch([{ ok: true, status: 200, body: { readyState: "WAT" } }]));

    // The executor treats anything but READY as a failed rollback, which is
    // the safe reading of an unknown provider state.
    expect(await vercelRollbackAdapter("prj_1")!.state("dpl_1")).toBe("UNKNOWN");
  });

  it("reports UNKNOWN when the read itself fails", async () => {
    process.env.VERCEL_TOKEN = "tok";
    vi.stubGlobal("fetch", mockFetch([{ ok: false, status: 500 }]));

    expect(await vercelRollbackAdapter("prj_1")!.state("dpl_1")).toBe("UNKNOWN");
  });
});

describe("team scoping", () => {
  it("scopes requests to the team when one is configured", async () => {
    process.env.VERCEL_TOKEN = "tok";
    process.env.VERCEL_TEAM_ID = "team_abc";
    const fetchMock = mockFetch([{ ok: true, status: 200 }]);
    vi.stubGlobal("fetch", fetchMock);

    await vercelRollbackAdapter("prj_1")!.promote("dpl_1");

    expect(String(fetchMock.mock.calls[0][0])).toContain("teamId=team_abc");
  });
});
