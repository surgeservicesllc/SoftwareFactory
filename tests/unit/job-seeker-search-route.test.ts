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
  searchJSearch: vi.fn(),
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
vi.mock("@/lib/job-seeker/board-search/jsearch", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/job-seeker/board-search/jsearch")>();
  return { ...original, jsearchAdapter: { ...original.jsearchAdapter, search: harness.searchJSearch } };
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
  // The aggregator's key gate: tests that turn it on stub the env; every
  // other test runs unconfigured, exactly like a deployment without the key.
  vi.unstubAllEnvs();
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

  it("stores no results: the only table write is the per-board metering event", async () => {
    // If searching ever starts writing anything else, every glanced-at
    // posting could land in someone's job list. The one legitimate table
    // write is the search-events audit the credit meter counts; the other
    // bookkeeping — the posting sightings ledger (ADR-241) — crosses a
    // definer function and holds public facts about postings, never the
    // person's results.
    const client = stubClient();
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client,
    });

    await POST(searchRequest({ text: "engineer" }));

    expect(client.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      "record_posting_sightings",
      "read_posting_sightings",
    ]);
    const recorded = client.rpc.mock.calls[0]?.[1] as { p_sightings: Array<{ url: string; source: string }> };
    // Thirteen boards answered one hit each, all with the same URL: one
    // sighting per URL, so the ledger counts a posting once per search.
    expect(recorded.p_sightings).toHaveLength(1);
    expect(recorded.p_sightings[0]).toMatchObject({ url: "https://jobnet.dk/find-job/1", source: "jobnet", postedOn: "2026-08-20" });
    // The person's own recorded postings are read once for company memory
    // (ADR-245); the metering event stays the only write.
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(["job_seeker_jobs", "job_seeker_search_events"]);
    expect(client.insert).toHaveBeenCalledTimes(1);
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

  type RadiusPayload = UnifiedPayload & {
    unified: {
      radius:
        | { applied: true; radiusKm: number; center: { name: string; country: string }; excluded: number; unresolvedKept: number; remoteKept: number }
        | { applied: false; reason: string }
        | null;
    };
  };

  it("applies a radius honestly: near kept, provably far dropped, unknown kept and counted", async () => {
    const placed = (title: string, location: string) => ({
      ...hit(title),
      job: { ...hit(title).job, externalId: `id-${title}`, location },
    });
    harness.searchRemotive.mockResolvedValue({ board: "remotive", hits: [placed("Nearby Role", "Malmö")], totalAvailable: 1 });
    harness.searchRemoteok.mockResolvedValue({ board: "remoteok", hits: [placed("Far Role", "Berlin")], totalAvailable: 1 });
    harness.searchJobicy.mockResolvedValue({ board: "jobicy", hits: [placed("Somewhere Role", "Multiple offices")], totalAvailable: 1 });

    const response = await POST(searchRequest({
      text: "role",
      location: "Copenhagen",
      radiusKm: 50,
      boards: ["remotive", "remoteok", "jobicy"],
    }));
    const payload = (await response.json()) as RadiusPayload;

    expect(payload.unified.hits.map((h) => h.job.title).sort()).toEqual(["Nearby Role", "Somewhere Role"]);
    expect(payload.unified.radius).toEqual({
      applied: true,
      radiusKm: 50,
      center: { name: "Copenhagen", country: "DK" },
      excluded: 1,
      unresolvedKept: 1,
      remoteKept: 0,
    });
  });

  it("centres a radius on a US ZIP code, showing the resolved place with the ZIP", async () => {
    const placed = (title: string, location: string) => ({
      ...hit(title),
      job: { ...hit(title).job, externalId: `id-${title}`, location },
    });
    harness.searchRemotive.mockResolvedValue({ board: "remotive", hits: [placed("Austin Role", "Austin")], totalAvailable: 1 });
    harness.searchRemoteok.mockResolvedValue({ board: "remoteok", hits: [placed("Dallas Role", "Dallas")], totalAvailable: 1 });

    const response = await POST(searchRequest({
      text: "role",
      location: "78701",
      radiusKm: 25,
      boards: ["remotive", "remoteok"],
    }));
    const payload = (await response.json()) as RadiusPayload;

    expect(payload.unified.hits.map((h) => h.job.title)).toEqual(["Austin Role"]);
    expect(payload.unified.radius).toEqual({
      applied: true,
      radiusKm: 25,
      center: { name: "Austin, TX 78701", country: "US" },
      excluded: 1,
      unresolvedKept: 0,
      remoteKept: 0,
    });
  });

  it("reports an unknown centre as not applied rather than failing or silently narrowing", async () => {
    const response = await POST(searchRequest({
      text: "role",
      location: "Anywhere in the EU",
      radiusKm: 50,
      boards: ["remotive"],
    }));
    const payload = (await response.json()) as RadiusPayload;

    expect(payload.unified.hits).toHaveLength(1);
    expect(payload.unified.radius).toMatchObject({ applied: false });
    expect((payload.unified.radius as { reason: string }).reason).toContain("Anywhere in the EU");
  });

  it("refuses a radius with no place to measure from", async () => {
    const response = await POST(searchRequest({ text: "role", radiusKm: 50 }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toBe("A distance needs a place to measure from.");
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

describe("the credential-gated aggregator", () => {
  it("does not exist to the search until its key does", async () => {
    const listed = (await (await GET()).json()) as {
      boards: Array<{ key: string }>;
      sources: Array<{ key: string; status: string }>;
    };
    expect(listed.boards.map((board) => board.key)).not.toContain("jsearch");
    expect(listed.sources.find((source) => source.key === "jsearch")?.status)
      .toBe("needs_credentials");

    const response = await POST(searchRequest({ text: "engineer" }));
    expect(response.status).toBe(200);
    expect(harness.searchJSearch).not.toHaveBeenCalled();

    // Asking for it by name is an unknown board, not a silent skip.
    const named = await POST(searchRequest({ text: "engineer", boards: ["jsearch"] }));
    expect(named.status).toBe(400);
  });

  it("joins the fan-out when the key exists, each hit naming the site that hosts it", async () => {
    vi.stubEnv("JSEARCH_RAPIDAPI_KEY", "test-key");
    harness.searchJSearch.mockResolvedValue({
      board: "jsearch",
      hits: [
        { ...hit("Marketing Manager (LI)"), publisher: "LinkedIn" },
        { ...hit("Marketing Manager (IN)"), publisher: "Indeed" },
      ],
      totalAvailable: null,
    });

    const listed = (await (await GET()).json()) as {
      boards: Array<{ key: string }>;
      sources: Array<{ key: string; status: string; note: string }>;
    };
    expect(listed.boards.map((board) => board.key)).toContain("jsearch");
    const resolved = listed.sources.find((source) => source.key === "jsearch");
    expect(resolved?.status).toBe("live");
    expect(resolved?.note).toContain("Connected");

    const response = await POST(searchRequest({ text: "marketing manager" }));
    const payload = (await response.json()) as {
      results: Array<{ board: string; hits: Array<{ publisher?: string | null }> }>;
      unified: { hits: Array<{ sources: Array<{ board: string; boardName: string }> }> };
    };
    expect(response.status).toBe(200);
    const aggregated = payload.results.find((result) => result.board === "jsearch");
    expect(aggregated?.hits.map((entry) => entry.publisher)).toEqual(["LinkedIn", "Indeed"]);

    // The unified badge says which site hosts the posting, not just which
    // door it came through: "LinkedIn (JSearch)", never a bare aggregator.
    const badges = payload.unified.hits
      .flatMap((card) => card.sources)
      .filter((source) => source.board === "jsearch")
      .map((source) => source.boardName)
      .sort();
    expect(badges).toEqual(["Indeed (JSearch)", "LinkedIn (JSearch)"]);
  });
});

describe("freshness (ADR-241)", () => {
  it("attaches a verdict to every card from the board's dates when the ledger cannot be read, and says so", async () => {
    // The stub's rpc answers nothing, which is what an unapplied migration
    // looks like from the route: the verdict falls back to the board's own
    // posting date and the basis line names the fallback.
    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as {
      unified: {
        hits: Array<{ freshness: { level: string; postedDaysAgo: number | null; reasons: string[] } }>;
        freshnessBasis: string;
      };
    };
    expect(response.status).toBe(200);
    expect(payload.unified.freshnessBasis).toContain("board's own dates only");
    expect(payload.unified.hits.length).toBeGreaterThan(0);
    for (const card of payload.unified.hits) {
      expect(["fresh", "aging", "stale", "unknown"]).toContain(card.freshness.level);
      expect(card.freshness.reasons[0]).toMatch(/^Posted \d+ days? ago by the board's own date\.$/);
    }
  });

  it("reads the ledger back and lets an old first sighting overrule a fresh-looking date", async () => {
    const client = stubClient();
    client.rpc.mockImplementation(async (fn: string) => {
      if (fn === "read_posting_sightings") {
        return {
          data: [{
            url_key: "e6c2ce6ec4e6c5e0b2a2b2e6f1a1c1d1", // replaced below
            first_seen_at: new Date(Date.now() - 80 * 86_400_000).toISOString(),
            last_seen_at: new Date().toISOString(),
            times_seen: 12,
            earliest_posted_on: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
            latest_posted_on: "2026-08-20",
            reposts: 3,
            closes_on: null,
          }],
          error: null,
        };
      }
      return { data: 1, error: null };
    });
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client,
    });
    const { postingUrlKey } = await import("@/lib/job-seeker/board-search/posting-key");
    const key = postingUrlKey("https://jobnet.dk/find-job/1");
    // The stub above cannot know the key at definition time; patch it in.
    const original = client.rpc.getMockImplementation()!;
    client.rpc.mockImplementation(async (fn: string, args: unknown) => {
      const answer = await original(fn, args) as { data: unknown; error: null };
      if (fn === "read_posting_sightings") {
        (answer.data as Array<{ url_key: string }>)[0]!.url_key = key;
        expect((args as { p_url_keys: string[] }).p_url_keys).toContain(key);
      }
      return answer;
    });

    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as {
      unified: {
        hits: Array<{ freshness: { level: string; reposts: number; timesSeen: number; reasons: string[] } }>;
        freshnessBasis: string;
      };
    };
    expect(response.status).toBe(200);
    expect(payload.unified.freshnessBasis).toContain("sightings ledger");
    const card = payload.unified.hits[0]!;
    expect(card.freshness.level).toBe("stale");
    expect(card.freshness.reposts).toBe(3);
    expect(card.freshness.timesSeen).toBe(12);
    expect(card.freshness.reasons).toContain("Re-dated 3 times since first seen (the posting date moved forward).");
    expect(card.freshness.reasons.some((reason) => reason.startsWith("First seen here 80 days ago, on 12 searches."))).toBe(true);
  });

  it("keeps answering when the ledger refuses both calls", async () => {
    const client = stubClient();
    client.rpc.mockRejectedValue(new Error("function record_posting_sightings does not exist"));
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client,
    });
    const response = await POST(searchRequest({ text: "engineer" }));
    const payload = (await response.json()) as { unified: { hits: unknown[]; freshnessBasis: string } };
    expect(response.status).toBe(200);
    expect(payload.unified.hits.length).toBeGreaterThan(0);
    expect(payload.unified.freshnessBasis).toContain("could not be read");
  });
});

describe("posting signals (ADR-242)", () => {
  it("attaches every signal to the card and honours the signal filters", async () => {
    const base = hit("Data Entry Clerk");
    harness.searchRemotive.mockResolvedValue({
      board: "remotive",
      hits: [{
        ...base,
        job: {
          ...base.job,
          url: "https://remotive.com/jobs/apex-1",
          company: "Apex Recruiting",
          description: "Fully remote. Contact us on Telegram to start. We cannot sponsor visas.",
          salaryText: "$30 per hour",
        },
      }],
      totalAvailable: 1,
    });

    type Payload = {
      unified: {
        hits: Array<{
          job: { company: string };
          signals: {
            redFlags: Array<{ code: string; phrase: string }>;
            agency: { likely: boolean; phrase: string | null };
            sponsorship: { state: string | null };
            workModel: { model: string | null; derived: boolean };
            salary: { annualized: number | null } | null;
            completeness: { score: number };
          };
        }>;
      };
    };
    const open = (await (await POST(searchRequest({ text: "engineer" }))).json()) as Payload;
    const card = open.unified.hits.find((entry) => entry.job.company === "Apex Recruiting")!;
    expect(card.signals.redFlags).toEqual([{ code: "off_platform_messaging", label: expect.any(String), phrase: "Telegram" }]);
    expect(card.signals.agency).toEqual({ likely: true, phrase: "Recruiting" });
    expect(card.signals.sponsorship.state).toBe("stated_no");
    expect(card.signals.workModel).toMatchObject({ model: "remote", derived: true });
    expect(card.signals.salary?.annualized).toBe(62_400);
    expect(card.signals.completeness.score).toBe(4);

    const noFlags = (await (await POST(searchRequest({ text: "engineer", filters: { hideRedFlags: true } }))).json()) as Payload;
    expect(noFlags.unified.hits.some((entry) => entry.job.company === "Apex Recruiting")).toBe(false);

    const noAgencies = (await (await POST(searchRequest({ text: "engineer", filters: { excludeAgencies: true } }))).json()) as Payload;
    expect(noAgencies.unified.hits.some((entry) => entry.job.company === "Apex Recruiting")).toBe(false);

    const statedNo = (await (await POST(searchRequest({ text: "engineer", filters: { sponsorship: "stated_no" } }))).json()) as Payload;
    expect(statedNo.unified.hits.map((entry) => entry.job.company)).toEqual(["Apex Recruiting"]);
  });
});

describe("company memory on every card (ADR-245)", () => {
  /** A PostgREST-shaped chain for the one read the memory makes. */
  function chain(result: unknown) {
    const node: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order"]) {
      node[method] = vi.fn(() => node);
    }
    node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return node;
  }

  it("says what your own rows say about the company, and where that came from", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: activeOrganizationId },
      user: { id: "user-1" },
      client: {
        from: vi.fn((table: string) =>
          table === "job_seeker_jobs"
            ? chain({
                data: [
                  {
                    id: "j1", company: "Nordisk Teknik A/S", title: "Engineer", discovered_at: "2026-08-01T00:00:00Z",
                    job_seeker_matches: { qualified: true },
                    job_seeker_applications: { stage: "CLOSED", applied_at: "2026-08-10T00:00:00Z", closed_reason: "no_response" },
                  },
                  { id: "j2", company: "Elsewhere ApS", title: "Lead", discovered_at: "2026-08-02T00:00:00Z", job_seeker_matches: null, job_seeker_applications: null },
                ],
                error: null,
              })
            : { insert }),
        rpc: vi.fn(),
      },
    });

    const payload = (await (await POST(searchRequest({ text: "engineer", boards: ["jobnet"] }))).json()) as {
      unified: { hits: Array<{ history: { recorded: number; applied: number; sentence: string } | null }>; historyBasis: string };
    };
    expect(payload.unified.hits[0]!.history).toEqual({
      company: "Nordisk Teknik A/S",
      recorded: 1,
      applied: 1,
      sentence: "You applied to Nordisk Teknik A/S on 2026-08-10; closed with no response.",
    });
    expect(payload.unified.historyBasis).toContain("(2 recorded)");
  });

  it("answers null and says so when your record could not be read — the search still answers", async () => {
    // The default stub client has no select at all: the read throws, and is caught.
    const payload = (await (await POST(searchRequest({ text: "engineer", boards: ["jobnet"] }))).json()) as {
      unified: { hits: Array<{ history: unknown }>; historyBasis: string };
    };
    expect(payload.unified.hits).toHaveLength(1);
    expect(payload.unified.hits[0]!.history).toBeNull();
    expect(payload.unified.historyBasis).toBe("Your history with each company could not be read for this search.");
  });
});
