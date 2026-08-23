import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportSourceError, listSearchAdapters } from "@/lib/job-seeker/import-adapters";
import {
  FREEHIRE_MAX_RESULTS,
  buildFreehireQuery,
  formatSalary,
  freehireBaseUrl,
  normalizeDescription,
  searchFreehire,
  toImportedJob,
} from "@/lib/job-seeker/portals/freehire";

/**
 * The freehire search adapter's contract.
 *
 * The shapes asserted here were verified against the live endpoint on
 * 2026-08-23 (`GET /api/v1/agent/jobs/search`, HTTP 200): the envelope is
 * `{data, meta}`, `meta.total` is the whole corpus match count, and
 * `description_format` genuinely changes the body — the same posting comes
 * back as `<h2>The Reality</h2>…` under `html` and as prose under `text`.
 * That last fact is why the markup guard below is a real case and not a
 * hypothetical one.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_QUERY = {
  keywords: "platform engineer",
  city: null,
  country: null,
  workMode: null,
  postedWithinDays: null,
  limit: 20,
} as const;

describe("buildFreehireQuery", () => {
  it("asks for plain-text descriptions and keyword ranking", () => {
    const params = buildFreehireQuery(BASE_QUERY);
    expect(params.get("q")).toBe("platform engineer");
    // Verified live: `html` returns markup for the same posting, so asking
    // for text is what keeps a stored description readable.
    expect(params.get("description_format")).toBe("text");
    expect(params.get("include_description")).toBe("true");
    expect(params.get("semantic_ratio")).toBe("0");
    expect(params.get("offset")).toBe("0");
  });

  it("caps the page size at what one request may record", () => {
    expect(buildFreehireQuery({ ...BASE_QUERY, limit: 5_000 }).get("limit"))
      .toBe(String(FREEHIRE_MAX_RESULTS));
    expect(buildFreehireQuery({ ...BASE_QUERY, limit: 0 }).get("limit")).toBe("1");
  });

  it("sends only the filters that were actually set", () => {
    const bare = buildFreehireQuery(BASE_QUERY);
    expect(bare.has("cities")).toBe(false);
    expect(bare.has("countries")).toBe(false);
    expect(bare.has("work_mode")).toBe(false);
    expect(bare.has("posted_within_days")).toBe(false);

    const filtered = buildFreehireQuery({
      ...BASE_QUERY,
      city: "Austin",
      country: "US",
      workMode: "remote",
      postedWithinDays: 14,
    });
    expect(filtered.get("cities")).toBe("Austin");
    // The provider's country facet is lowercase ISO-3166 alpha-2.
    expect(filtered.get("countries")).toBe("us");
    expect(filtered.get("work_mode")).toBe("remote");
    expect(filtered.get("posted_within_days")).toBe("14");
  });

  it("drops a country that is not an alpha-2 code rather than sending a guess", () => {
    // "United States" is not a facet value. Sending it would return nothing
    // and read as "no jobs there" instead of "that filter was never applied".
    expect(buildFreehireQuery({ ...BASE_QUERY, country: "United States" }).has("countries"))
      .toBe(false);
  });
});

describe("freehireBaseUrl", () => {
  it("defaults to the hosted API and honours a self-hosted override", () => {
    expect(freehireBaseUrl({} as NodeJS.ProcessEnv)).toBe("https://freehire.me");
    expect(freehireBaseUrl({
      SOFTWAREFACTORY_FREEHIRE_API_URL: "http://localhost:8080/",
    } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:8080");
  });
});

describe("normalizeDescription", () => {
  it("passes prose through untouched, including angle brackets in it", () => {
    const prose = "Own the C++ <-> Python interop layer.\n\nShip weekly.";
    expect(normalizeDescription(prose)).toBe(prose);
  });

  it("renders markup to text when a provider answers with HTML anyway", () => {
    // The live API's `html` format, which a self-hosted instance may serve
    // even when asked for text.
    const html = "<h2>The Reality</h2><p>An 11pm Slack message</p><ul><li>On call</li></ul>";
    const text = normalizeDescription(html);
    expect(text).toContain("The Reality");
    expect(text).toContain("On call");
    expect(text).not.toContain("<");
  });

  it("returns null for nothing rather than an empty string", () => {
    expect(normalizeDescription("   ")).toBeNull();
    expect(normalizeDescription(null)).toBeNull();
    expect(normalizeDescription(42)).toBeNull();
  });
});

describe("formatSalary", () => {
  it("states only figures the posting carries", () => {
    expect(formatSalary({ salary_min: 180000, salary_max: 220000, salary_currency: "USD" }))
      .toBe("USD 180,000–220,000");
    expect(formatSalary({ salary_min: 180000 })).toBe("180,000");
    expect(formatSalary({ salary_max: 220000, salary_currency: "EUR" })).toBe("EUR 220,000");
  });

  it("stays null when no figure exists instead of inventing a phrase", () => {
    // A filler like "competitive" would read as a stated salary to a person
    // and as "no readable figure" to evaluateJob — data-shaped, and false.
    expect(formatSalary({})).toBeNull();
    expect(formatSalary(undefined)).toBeNull();
    expect(formatSalary({ salary_currency: "USD" })).toBeNull();
  });
});

describe("toImportedJob", () => {
  it("maps a live-shaped posting onto what job_seeker_jobs stores", () => {
    const [job] = toImportedJob({
      public_slug: "platform-engineer-hyperbound-xxwolaag",
      url: "https://jobs.ashbyhq.com/hyperbound/9179fa2e",
      title: "Platform Engineer",
      company: "Hyperbound",
      location: "San Francisco",
      work_mode: "onsite",
      description: "Own the public API.",
      enrichment: { salary_min: 180000, salary_max: 220000, salary_currency: "USD" },
    });
    expect(job).toEqual({
      externalId: "platform-engineer-hyperbound-xxwolaag",
      url: "https://jobs.ashbyhq.com/hyperbound/9179fa2e",
      title: "Platform Engineer",
      company: "Hyperbound",
      salaryText: "USD 180,000–220,000",
      location: "San Francisco",
      workModel: "onsite",
      description: "Own the public API.",
    });
  });

  it("drops a posting missing anything the row requires", () => {
    // title and company are NOT NULL; the slug is what the dedupe index uses
    // to tell a re-run from a genuinely different job.
    expect(toImportedJob({ public_slug: "a", company: "Acme" })).toEqual([]);
    expect(toImportedJob({ public_slug: "a", title: "Engineer" })).toEqual([]);
    expect(toImportedJob({ title: "Engineer", company: "Acme" })).toEqual([]);
  });

  it("refuses a url that is not http(s) rather than storing it", () => {
    const [job] = toImportedJob({
      public_slug: "a", title: "Engineer", company: "Acme",
      url: "javascript:alert(1)",
    });
    expect(job.url).toBeNull();
  });

  it("reads remote out of the location when the provider states no work mode", () => {
    const [job] = toImportedJob({
      public_slug: "a", title: "Engineer", company: "Acme", location: "Remote (US)",
    });
    expect(job.workModel).toBe("remote");
  });

  it("bounds every field to what the column accepts", () => {
    const [job] = toImportedJob({
      public_slug: "s".repeat(400),
      title: "t".repeat(400),
      company: "c".repeat(400),
      location: "l".repeat(400),
      description: "d".repeat(40_000),
    });
    expect(job.externalId).toHaveLength(200);
    expect(job.title).toHaveLength(300);
    expect(job.company).toHaveLength(300);
    expect(job.location).toHaveLength(200);
    expect(job.description).toHaveLength(30_000);
  });
});

describe("searchFreehire", () => {
  it("returns the provider's own total alongside what it recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      data: [
        { public_slug: "a", title: "Platform Engineer", company: "Acme" },
        { public_slug: "b", title: "Staff Engineer", company: "Globex" },
      ],
      // Live value for a broad query was 73242 — the cap is nowhere near it,
      // so the response has to say so or it implies the market is two jobs.
      meta: { total: 73242 },
    })));
    const found = await searchFreehire(BASE_QUERY);
    expect(found.postings).toHaveLength(2);
    expect(found.totalAvailable).toBe(73242);
    expect(found.company).toBe("platform engineer");
  });

  it("never reports fewer available than it actually returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      data: [{ public_slug: "a", title: "Engineer", company: "Acme" }],
      meta: {},
    })));
    expect((await searchFreehire(BASE_QUERY)).totalAvailable).toBe(1);
  });

  it("reports a missing endpoint as a misconfiguration, not as no matches", async () => {
    // A 404 here is a self-hosted instance without the search surface.
    // "No jobs found" would hide that behind a plausible answer.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "not found" }, 404)));
    await expect(searchFreehire(BASE_QUERY)).rejects.toMatchObject({
      code: "source_not_found",
    });
  });

  it("reports an unreadable body as a provider error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: "not an array" })));
    await expect(searchFreehire(BASE_QUERY)).rejects.toBeInstanceOf(ImportSourceError);
  });

  it("retries a rate limit once and uses the retry's answer", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ public_slug: "a", title: "Engineer", company: "Acme" }],
        meta: { total: 1 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const found = await searchFreehire(BASE_QUERY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(found.postings).toHaveLength(1);
  });

  it("gives up after the retry rather than hammering a failing provider", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "boom" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchFreehire(BASE_QUERY)).rejects.toMatchObject({ code: "provider_error" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an unreachable provider rather than an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    await expect(searchFreehire(BASE_QUERY)).rejects.toMatchObject({
      code: "provider_unreachable",
    });
  });

  it("records at most the bounded number of postings from one search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      data: Array.from({ length: FREEHIRE_MAX_RESULTS + 25 }, (_, index) => ({
        public_slug: `slug-${index}`, title: "Engineer", company: "Acme",
      })),
      meta: { total: 5_000 },
    })));
    const found = await searchFreehire(BASE_QUERY);
    expect(found.postings).toHaveLength(FREEHIRE_MAX_RESULTS);
    expect(found.totalAvailable).toBe(5_000);
  });
});

describe("listSearchAdapters", () => {
  it("registers freehire as a keyless search adapter with a real implementation", () => {
    const [freehire, ...rest] = listSearchAdapters();
    expect(rest).toEqual([]);
    expect(freehire.key).toBe("freehire");
    expect(freehire.mode).toBe("search");
    expect(freehire.configured).toBe(true);
    expect(freehire.requiredConfiguration).toEqual([]);
    expect(typeof freehire.searchPostings).toBe("function");
    // A search adapter takes a query, not a company identifier. Carrying
    // both would let the page render the wrong control for it.
    expect(freehire.fetchPostings).toBeUndefined();
    expect(freehire.identifierLabel).toBeUndefined();
  });
});
