// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  searchJobnet: vi.fn(),
  searchJobindex: vi.fn(),
  searchFreehire: vi.fn(),
  searchJobdanmark: vi.fn(),
  sealSearchResult: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/job-seeker/board-search/jobnet", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/jobnet")>();
  return { ...original, jobnetAdapter: { ...original.jobnetAdapter, search: harness.searchJobnet } };
});
vi.mock("@/lib/job-seeker/board-search/jobindex", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/jobindex")>();
  return { ...original, jobindexAdapter: { ...original.jobindexAdapter, search: harness.searchJobindex } };
});

vi.mock("@/lib/job-seeker/board-search/freehire", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/freehire")>();
  return { ...original, freehireAdapter: { ...original.freehireAdapter, search: harness.searchFreehire } };
});

vi.mock("@/lib/job-seeker/board-search/jobdanmark", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/jobdanmark")>();
  return { ...original, jobdanmarkAdapter: { ...original.jobdanmarkAdapter, search: harness.searchJobdanmark } };
});
vi.mock("@/lib/job-seeker/search-result-token", () => ({
  sealSearchResult: harness.sealSearchResult,
}));

import { GET, POST } from "@/app/api/job-seeker/search/route";
import { BoardSearchError } from "@/lib/job-seeker/board-search/types";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";

const activeOrganizationId = "10000000-0000-4000-8000-000000000042";

function searchRequest(body: unknown) {
  return new Request("https://factory.example/api/job-seeker/search", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

function hit(title: string) {
  return {
    job: {
      externalId: `id-${title}`,
      url: "https://jobnet.dk/find-job/1",
      title,
      company: "Nordisk Teknik A/S",
      salaryText: null,
      location: "København",
      workModel: null,
      description: null,
    },
    publishedOn: "2026-08-20",
    closesOn: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: activeOrganizationId },
    user: { id: "user-1" },
    client: {},
  });
  harness.searchJobnet.mockResolvedValue({ board: "jobnet", hits: [hit("Platform Engineer")], totalAvailable: 812 });
  harness.searchJobindex.mockResolvedValue({ board: "jobindex", hits: [hit("Backend Developer")], totalAvailable: 40 });
  harness.searchFreehire.mockResolvedValue({ board: "freehire", hits: [hit("Go Engineer")], totalAvailable: 7 });
  harness.searchJobdanmark.mockResolvedValue({ board: "jobdanmark", hits: [hit("Systemudvikler")], totalAvailable: 55 });
  harness.sealSearchResult.mockReturnValue("sealed-result-token");
});

describe("the search boundary", () => {
  it("refuses a signed-out caller before any board is contacted", async () => {
    /*
     * The load-bearing security case. If the tenant check ran after the
     * fan-out, an anonymous request would make this server fetch job boards on
     * the caller's behalf — an open proxy wearing a search page.
     */
    harness.requireActiveOrganization.mockRejectedValue(
      new SupabaseAuthenticationError("authentication_required", "Authentication is required."),
    );

    const response = await POST(searchRequest({ text: "engineer" }));

    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(harness.searchJobnet).not.toHaveBeenCalled();
    expect(harness.searchJobindex).not.toHaveBeenCalled();
    expect(harness.searchFreehire).not.toHaveBeenCalled();
    expect(harness.searchJobdanmark).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    const response = await POST(
      new Request("https://factory.example/api/job-seeker/search", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ text: "engineer" }),
      }),
    );
    expect(response.ok).toBe(false);
    expect(harness.searchJobnet).not.toHaveBeenCalled();
  });

  it("requires something to search for", async () => {
    const response = await POST(searchRequest({ text: "  ", location: null }));
    expect(response.status).toBe(400);
    expect(harness.searchJobnet).not.toHaveBeenCalled();
  });

  it("refuses a board it cannot read rather than silently ignoring it", async () => {
    const response = await POST(searchRequest({ text: "engineer", boards: ["linkedin"] }));
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("board_unknown");
  });

  it("gates the board list on authentication too", async () => {
    harness.requireActiveOrganization.mockRejectedValue(
      new SupabaseAuthenticationError("authentication_required", "Authentication is required."),
    );
    const response = await GET();
    expect(response.status).toBeGreaterThanOrEqual(401);
  });
});

describe("searching across boards", () => {
  it("returns each board's hits with the board's own total", async () => {
    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as {
      results: Array<{ board: string; totalAvailable: number | null; hits: unknown[] }>;
      failures: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.results).toHaveLength(4);
    // Not hits.length: a person who sees 1 of 812 knows this is a sample.
    expect(payload.results.find((r) => r.board === "jobnet")?.totalAvailable).toBe(812);
    expect(payload.results[0]?.hits[0]).toMatchObject({ saveToken: "sealed-result-token" });
    expect(payload.failures).toEqual([]);
  });

  it("binds each save token to the signed-in organization, person, board and job", async () => {
    await POST(searchRequest({ text: "engineer", boards: ["jobnet"] }));
    expect(harness.sealSearchResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: activeOrganizationId,
      userId: "user-1",
      board: "jobnet",
      job: expect.objectContaining({ title: "Platform Engineer" }),
    }));
  });

  it("keeps the boards that answered when one fails, and names the one that did not", async () => {
    harness.searchJobindex.mockRejectedValue(
      new BoardSearchError("board_unreachable", "jobindex", "Jobindex is rate limiting this search."),
    );

    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as {
      results: Array<{ board: string }>;
      failures: Array<{ board: string; code: string; message: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.results.map((r) => r.board).sort()).toEqual(["freehire", "jobdanmark", "jobnet"]);
    expect(payload.failures).toHaveLength(1);
    expect(payload.failures[0]).toMatchObject({ board: "jobindex", code: "board_unreachable" });
    expect(payload.failures[0]?.message).toMatch(/rate limiting/);
  });

  it("does not repeat an unexpected error's text, which may carry internals", async () => {
    harness.searchJobindex.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as { failures: Array<{ message: string }> };

    expect(payload.failures[0]?.message).not.toContain("ECONNREFUSED");
    expect(payload.failures[0]?.message).not.toContain("10.0.0.5");
    expect(payload.failures[0]?.message).toContain("Jobindex");
  });

  it("always sends a failures array, so an absent key never has to be guessed at", async () => {
    const payload = (await (await POST(searchRequest({ text: "engineer" }))).json()) as Record<string, unknown>;
    expect(Array.isArray(payload.failures)).toBe(true);
  });

  it("stores nothing: a search is a read", async () => {
    // The client is handed over with no table access used. If searching ever
    // starts writing, every glanced-at posting lands in someone's job list.
    const client = { from: vi.fn(), rpc: vi.fn() };
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client,
    });

    await POST(searchRequest({ text: "engineer" }));

    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("passes a location through to the boards", async () => {
    await POST(searchRequest({ text: "engineer", location: "2100" }));
    expect(harness.searchJobnet).toHaveBeenCalledWith(
      expect.objectContaining({ text: "engineer", location: "2100" }),
    );
  });
});
