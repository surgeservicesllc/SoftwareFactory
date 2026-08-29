// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  searchJobnet: vi.fn(),
  searchJobindex: vi.fn(),
  searchFreehire: vi.fn(),
  searchJobdanmark: vi.fn(),
  searchRemotive: vi.fn(),
  searchRemoteok: vi.fn(),
  searchJobicy: vi.fn(),
  searchHimalayas: vi.fn(),
  searchArbeitnow: vi.fn(),
  searchWeworkremotely: vi.fn(),
  searchThemuse: vi.fn(),
  searchWorkingnomads: vi.fn(),
  searchJobspresso: vi.fn(),
  sealSearchResult: vi.fn(),
  loadEvaluationInputs: vi.fn(),
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
/*
 * Every adapter in the registry is mocked here, so this file must grow with
 * the registry: an unmocked adapter would try a real network fetch from a
 * unit test — an egress the suite exists to prevent.
 */
vi.mock("@/lib/job-seeker/board-search/remotive", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/remotive")>();
  return { ...original, remotiveAdapter: { ...original.remotiveAdapter, search: harness.searchRemotive } };
});
vi.mock("@/lib/job-seeker/board-search/remoteok", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/remoteok")>();
  return { ...original, remoteokAdapter: { ...original.remoteokAdapter, search: harness.searchRemoteok } };
});
vi.mock("@/lib/job-seeker/board-search/jobicy", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/jobicy")>();
  return { ...original, jobicyAdapter: { ...original.jobicyAdapter, search: harness.searchJobicy } };
});
vi.mock("@/lib/job-seeker/board-search/himalayas", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/himalayas")>();
  return { ...original, himalayasAdapter: { ...original.himalayasAdapter, search: harness.searchHimalayas } };
});
vi.mock("@/lib/job-seeker/board-search/arbeitnow", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/arbeitnow")>();
  return { ...original, arbeitnowAdapter: { ...original.arbeitnowAdapter, search: harness.searchArbeitnow } };
});
vi.mock("@/lib/job-seeker/board-search/weworkremotely", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/weworkremotely")>();
  return {
    ...original,
    weworkremotelyAdapter: { ...original.weworkremotelyAdapter, search: harness.searchWeworkremotely },
  };
});
vi.mock("@/lib/job-seeker/board-search/themuse", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/themuse")>();
  return { ...original, themuseAdapter: { ...original.themuseAdapter, search: harness.searchThemuse } };
});
vi.mock("@/lib/job-seeker/board-search/workingnomads", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/workingnomads")>();
  return {
    ...original,
    workingnomadsAdapter: { ...original.workingnomadsAdapter, search: harness.searchWorkingnomads },
  };
});
vi.mock("@/lib/job-seeker/board-search/jobspresso", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/jobspresso")>();
  return { ...original, jobspressoAdapter: { ...original.jobspressoAdapter, search: harness.searchJobspresso } };
});
vi.mock("@/lib/job-seeker/search-result-token", () => ({
  sealSearchResult: harness.sealSearchResult,
}));
vi.mock("@/lib/job-seeker/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-seeker/record")>()),
  loadEvaluationInputs: harness.loadEvaluationInputs,
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

function stubClient() {
  const insert = vi.fn(async (_rows: unknown) => ({ error: null }));
  const from = vi.fn((_table: string) => ({ insert }));
  return { from, insert, rpc: vi.fn() };
}

const RECORDED_PROFILE = {
  profileRecorded: true,
  profile: {
    skills: ["TypeScript"],
    technologies: ["PostgreSQL"],
    industries: ["Software"],
    employmentTitles: ["Platform Engineer"],
    hasLeadershipEvidence: true,
    salaryTarget: null,
    location: "Copenhagen",
    workArrangement: "any",
    openToRelocation: false,
  },
  preferences: {
    targetTitles: ["Marketing Manager"],
    compensationMinimum: null,
    locations: ["Copenhagen"],
    workArrangements: [],
    industries: [],
    exclusions: [],
    qualificationThreshold: 80,
  },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: activeOrganizationId },
    user: { id: "user-1" },
    client: stubClient(),
  });
  harness.loadEvaluationInputs.mockResolvedValue(RECORDED_PROFILE);
  harness.searchJobnet.mockResolvedValue({ board: "jobnet", hits: [hit("Platform Engineer")], totalAvailable: 812 });
  harness.searchJobindex.mockResolvedValue({ board: "jobindex", hits: [hit("Backend Developer")], totalAvailable: 40 });
  harness.searchFreehire.mockResolvedValue({ board: "freehire", hits: [hit("Go Engineer")], totalAvailable: 7 });
  harness.searchJobdanmark.mockResolvedValue({ board: "jobdanmark", hits: [hit("Systemudvikler")], totalAvailable: 55 });
  harness.searchRemotive.mockResolvedValue({ board: "remotive", hits: [hit("Growth Marketer")], totalAvailable: 19 });
  harness.searchRemoteok.mockResolvedValue({ board: "remoteok", hits: [hit("Marketing Manager")], totalAvailable: 33 });
  harness.searchJobicy.mockResolvedValue({ board: "jobicy", hits: [hit("SEO Lead")], totalAvailable: 5 });
  harness.searchHimalayas.mockResolvedValue({ board: "himalayas", hits: [hit("Brand Designer")], totalAvailable: null });
  harness.searchArbeitnow.mockResolvedValue({ board: "arbeitnow", hits: [hit("Werkstudent Marketing")], totalAvailable: 10 });
  harness.searchWeworkremotely.mockResolvedValue({ board: "weworkremotely", hits: [hit("Content Lead")], totalAvailable: 2 });
  harness.searchThemuse.mockResolvedValue({ board: "themuse", hits: [hit("Care Manager")], totalAvailable: null });
  harness.searchWorkingnomads.mockResolvedValue({ board: "workingnomads", hits: [hit("Video Producer")], totalAvailable: 1 });
  harness.searchJobspresso.mockResolvedValue({ board: "jobspresso", hits: [hit("Product Designer")], totalAvailable: 3 });
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
    expect(payload.results).toHaveLength(13);
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
    expect(payload.results.map((r) => r.board).sort()).toEqual([
      "arbeitnow",
      "freehire",
      "himalayas",
      "jobdanmark",
      "jobicy",
      "jobnet",
      "jobspresso",
      "remoteok",
      "remotive",
      "themuse",
      "weworkremotely",
      "workingnomads",
    ]);
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

  it("stores no results: the only write is the per-board metering event", async () => {
    // If searching ever starts writing anything else, every glanced-at
    // posting could land in someone's job list. The one legitimate write is
    // the search-events audit the credit meter counts.
    const client = stubClient();
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client,
    });

    await POST(searchRequest({ text: "engineer" }));

    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(["job_seeker_search_events"]);
    const rows = client.insert.mock.calls[0]?.[0] as Array<{ board: string; results_returned: number | null }>;
    expect(rows).toHaveLength(13);
    expect(rows.every((row) => row.results_returned === 1)).toBe(true);
  });

  it("keeps answering when the metering insert fails", async () => {
    const client = stubClient();
    client.insert.mockRejectedValue(new Error("events table missing"));
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client,
    });

    const response = await POST(searchRequest({ text: "engineer" }));
    expect(response.status).toBe(200);
  });

  it("passes a location through to the boards", async () => {
    await POST(searchRequest({ text: "engineer", location: "2100" }));
    expect(harness.searchJobnet).toHaveBeenCalledWith(
      expect.objectContaining({ text: "engineer", location: "2100" }),
    );
  });
});

describe("the unified view", () => {
  type UnifiedPayload = {
    unified: {
      hits: Array<{
        job: { title: string; company: string; salaryText: string | null };
        sources: Array<{ board: string; saveToken: string }>;
      }>;
      dedupedFrom: number;
      beforeFilters: number;
    };
  };

  it("collapses the same job across boards into one card that keeps both save tokens", async () => {
    const samePosting = (salaryText: string | null) => ({
      ...hit("Growth Marketer"),
      job: { ...hit("Growth Marketer").job, salaryText },
    });
    harness.searchRemotive.mockResolvedValue({ board: "remotive", hits: [samePosting(null)], totalAvailable: 1 });
    harness.searchRemoteok.mockResolvedValue({
      board: "remoteok",
      hits: [samePosting("USD 90000–120000")],
      totalAvailable: 1,
    });
    // Distinct tokens per seal, so the card can be shown to carry both.
    let seal = 0;
    harness.sealSearchResult.mockImplementation(() => `token-${(seal += 1)}`);

    const response = await POST(searchRequest({ text: "growth", boards: ["remotive", "remoteok"] }));
    const payload = (await response.json()) as UnifiedPayload;

    expect(payload.unified.dedupedFrom).toBe(2);
    expect(payload.unified.hits).toHaveLength(1);
    const [card] = payload.unified.hits;
    // The copy that stated a salary wins the card; the other board's link and
    // token stay attached, so saving from either attributes correctly.
    expect(card.job.salaryText).toBe("USD 90000–120000");
    expect(card.sources.map((s) => s.board).sort()).toEqual(["remoteok", "remotive"]);
    expect(new Set(card.sources.map((s) => s.saveToken)).size).toBe(2);
  });

  it("applies result-level filters to the unified set and reports what they removed", async () => {
    const response = await POST(
      searchRequest({
        text: "engineer",
        filters: { keywords: ["marketing"], keywordMode: "and" },
      }),
    );
    const payload = (await response.json()) as UnifiedPayload;

    // Thirteen boards each returned one distinct posting; two carry
    // "marketing" in their titles ("Growth Marketer" does not — it says
    // Marketer).
    expect(payload.unified.dedupedFrom).toBe(13);
    expect(payload.unified.beforeFilters).toBe(13);
    expect(
      payload.unified.hits.every((h) =>
        `${h.job.title}`.toLowerCase().includes("marketing"),
      ),
    ).toBe(true);
    expect(payload.unified.hits.length).toBeGreaterThan(0);
    expect(payload.unified.hits.length).toBeLessThan(13);
  });

  it("drops unknown-salary hits only when the filter demands a stated salary", async () => {
    const lax = (await (
      await POST(searchRequest({ text: "engineer", filters: { salaryMinimum: 50_000 } }))
    ).json()) as UnifiedPayload;
    // Every fixture hit has salaryText null: unknown is kept, not guessed at.
    expect(lax.unified.hits).toHaveLength(13);

    const strict = (await (
      await POST(searchRequest({ text: "engineer", filters: { salaryMinimum: 50_000, requireSalary: true } }))
    ).json()) as UnifiedPayload;
    expect(strict.unified.hits).toHaveLength(0);
  });

  it("scores every unified card from the recorded profile, evidence attached", async () => {
    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as {
      unified: {
        hits: Array<{ job: { title: string }; match: { score: number; reasons: string[]; gaps: string[]; qualified: boolean } | null }>;
        matchBasis: { computed: boolean };
      };
    };

    expect(payload.unified.matchBasis.computed).toBe(true);
    expect(payload.unified.hits.every((h) => h.match !== null)).toBe(true);
    // "Platform Engineer" matches the recorded employment title exactly, so
    // its experience component and reason must say so.
    const platform = payload.unified.hits.find((h) => h.job.title === "Platform Engineer");
    expect(platform?.match?.score).toBeGreaterThan(0);
    expect(platform?.match?.reasons.join(" ")).toMatch(/Platform Engineer/);
  });

  it("says no scores exist when no profile is recorded, and never invents them", async () => {
    harness.loadEvaluationInputs.mockResolvedValue({ ...RECORDED_PROFILE, profileRecorded: false });

    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as {
      unified: { hits: Array<{ match: unknown }>; matchBasis: { computed: boolean; reason?: string } };
    };

    expect(payload.unified.matchBasis.computed).toBe(false);
    expect(payload.unified.hits.every((h) => h.match === null)).toBe(true);
  });

  it("filters by minimum match score, and refuses that filter without a profile", async () => {
    const all = (await (
      await POST(searchRequest({ text: "engineer", filters: { minimumScore: 0 } }))
    ).json()) as { unified: { hits: unknown[] } };
    expect(all.unified.hits.length).toBeGreaterThan(0);

    const impossible = (await (
      await POST(searchRequest({ text: "engineer", filters: { minimumScore: 100 } }))
    ).json()) as { unified: { hits: unknown[] } };
    expect(impossible.unified.hits).toHaveLength(0);

    harness.loadEvaluationInputs.mockResolvedValue({ ...RECORDED_PROFILE, profileRecorded: false });
    const refused = await POST(searchRequest({ text: "engineer", filters: { minimumScore: 50 } }));
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("match_score_needs_profile");
  });

  it("refuses a filter it does not recognise instead of silently ignoring it", async () => {
    const response = await POST(
      searchRequest({ text: "engineer", filters: { minimumVibes: 11 } }),
    );
    expect(response.status).toBe(400);
    expect(harness.searchJobnet).not.toHaveBeenCalled();
  });
});
