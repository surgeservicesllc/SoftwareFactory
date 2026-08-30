// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvedSourceCatalogue, catalogueSource } from "@/lib/job-seeker/board-search/catalogue";
import {
  JSEARCH_KEY_ENV,
  jsearchAdapter,
  jsearchConfigured,
  searchJSearch,
  toJSearchHits,
  toJSearchSalaryText,
} from "@/lib/job-seeker/board-search/jsearch";
import {
  availableBoardSearchAdapters,
  BOARD_SEARCH_ADAPTERS,
  boardSearchAdapter,
} from "@/lib/job-seeker/board-search/registry";

/**
 * The aggregator that carries LinkedIn and Indeed postings inline — and the
 * gate that keeps it honest. The rules under test: without the key the board
 * is not offered anywhere (registry, lookup, catalogue); with the key it is
 * offered everywhere, in lockstep; every parsed hit names its publisher; and
 * a refusal or unknown shape is a loud failure, never invented results.
 *
 * The parser is pinned to JSearch's documented v2 envelope. The 13 open
 * boards were probed live before their parsers were written; a keyed board
 * cannot be, so the fixture below is the documented shape and the first
 * live search after the owner sets the key is the probe — drift surfaces
 * through the same per-board failure channel every board uses.
 */

const query = { text: "marketing manager", location: "Copenhagen", limit: 25 } as const;

const fixture = {
  status: "OK",
  request_id: "abc",
  data: [
    {
      job_id: "li-1",
      job_title: "Marketing Manager",
      employer_name: "Acme ApS",
      job_publisher: "LinkedIn",
      job_apply_link: "https://www.linkedin.com/jobs/view/12345",
      job_description: "<p>Own the funnel.</p>",
      job_is_remote: false,
      job_posted_at_datetime_utc: "2026-08-28T09:15:00.000Z",
      job_city: "Copenhagen",
      job_state: "Capital Region",
      job_country: "DK",
      job_min_salary: 60000,
      job_max_salary: 80000,
      job_salary_currency: "DKK",
      job_salary_period: "YEAR",
    },
    {
      job_id: "in-2",
      job_title: "Growth Marketer",
      employer_name: "Widget Co",
      job_publisher: "Indeed",
      job_apply_link: "https://www.indeed.com/viewjob?jk=abc",
      job_is_remote: true,
      job_posted_at_datetime_utc: "2026-08-29T00:00:00.000Z",
      job_country: "US",
    },
    // No title: not a job a person can act on; dropped, never renamed.
    { job_id: "x-3", employer_name: "Nameless Inc", job_publisher: "Glassdoor" },
  ],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the JSearch gate", () => {
  it("is not offered anywhere without its key, and everywhere with it — in lockstep", () => {
    vi.stubEnv(JSEARCH_KEY_ENV, "");
    expect(jsearchConfigured()).toBe(false);
    expect(availableBoardSearchAdapters().map((a) => a.key)).not.toContain("jsearch");
    expect(boardSearchAdapter("jsearch")).toBeNull();
    expect(resolvedSourceCatalogue().find((s) => s.key === "jsearch")?.status)
      .toBe("needs_credentials");

    vi.stubEnv(JSEARCH_KEY_ENV, "test-key");
    expect(jsearchConfigured()).toBe(true);
    expect(availableBoardSearchAdapters().map((a) => a.key)).toContain("jsearch");
    expect(boardSearchAdapter("jsearch")).toBe(jsearchAdapter);
    const resolved = resolvedSourceCatalogue().find((s) => s.key === "jsearch");
    expect(resolved?.status).toBe("live");
    expect(resolved?.adapterKey).toBe("jsearch");
    expect(resolved?.note).toContain("LinkedIn");
  });

  it("never changes the always-on registry: the 13 open boards stand regardless of keys", () => {
    vi.stubEnv(JSEARCH_KEY_ENV, "test-key");
    expect(BOARD_SEARCH_ADAPTERS.map((a) => a.key)).not.toContain("jsearch");
    expect(availableBoardSearchAdapters()).toHaveLength(BOARD_SEARCH_ADAPTERS.length + 1);
  });

  it("the static catalogue row is Not Connected and names the exact variable", () => {
    const row = catalogueSource("jsearch");
    expect(row?.status).toBe("needs_credentials");
    expect(row?.note).toContain(JSEARCH_KEY_ENV);
    expect(row?.adapterKey).toBeUndefined();
  });

  it("a direct call without the key refuses in plain words instead of calling anything", async () => {
    vi.stubEnv(JSEARCH_KEY_ENV, "");
    const fetchImpl = vi.fn();
    await expect(searchJSearch(query, { fetchImpl })).rejects.toThrow(/Not Connected/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the JSearch request", () => {
  it("folds the place into the documented query pattern and spends exactly one page", async () => {
    vi.stubEnv(JSEARCH_KEY_ENV, "test-key");
    let requested = new URL("https://invalid.example/");
    let keyHeader: string | null = null;
    let hostHeader: string | null = null;
    await searchJSearch(query, {
      fetchImpl: async (input, init) => {
        requested = new URL(String(input));
        const headers = new Headers(init?.headers);
        keyHeader = headers.get("x-rapidapi-key");
        hostHeader = headers.get("x-rapidapi-host");
        return json({ status: "OK", data: [] });
      },
    });

    expect(requested.host).toBe("jsearch.p.rapidapi.com");
    expect(requested.pathname).toBe("/search");
    expect(requested.searchParams.get("query")).toBe("marketing manager jobs in Copenhagen");
    // One request per search: the free plan is ~200 a month, and a fan-out
    // that quietly spent several per search would exhaust the key in days.
    expect(requested.searchParams.get("num_pages")).toBe("1");
    expect(keyHeader).toBe("test-key");
    expect(hostHeader).toBe("jsearch.p.rapidapi.com");
  });

  it("searches without a place, and with a place alone", async () => {
    vi.stubEnv(JSEARCH_KEY_ENV, "test-key");
    const queries: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL) => {
      queries.push(new URL(String(input)).searchParams.get("query") ?? "");
      return json({ status: "OK", data: [] });
    };
    await searchJSearch({ text: "designer", location: null, limit: 10 }, { fetchImpl });
    await searchJSearch({ text: "", location: "Berlin", limit: 10 }, { fetchImpl });
    expect(queries).toEqual(["designer jobs", "jobs in Berlin"]);
  });
});

describe("the JSearch parser", () => {
  it("names each posting's publisher — the LinkedIn and Indeed words the results exist for", () => {
    const hits = toJSearchHits(fixture, 25);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.publisher).toBe("LinkedIn");
    expect(hits[0]?.job.url).toBe("https://www.linkedin.com/jobs/view/12345");
    expect(hits[0]?.job.company).toBe("Acme ApS");
    expect(hits[0]?.job.location).toBe("Copenhagen, Capital Region, DK");
    expect(hits[0]?.publishedOn).toBe("2026-08-28");
    expect(hits[1]?.publisher).toBe("Indeed");
    // Remote is stated as a boolean; true is remote and false is unstated.
    expect(hits[1]?.job.workModel).toBe("remote");
    expect(hits[0]?.job.workModel).toBeNull();
  });

  it("says salary as the posting says it, and nothing when it says nothing", () => {
    expect(toJSearchSalaryText(fixture.data[0] as never)).toBe("DKK 60000–80000 per year");
    expect(toJSearchSalaryText(fixture.data[1] as never)).toBeNull();
  });

  it("caps at the asked-for limit", () => {
    expect(toJSearchHits(fixture, 1)).toHaveLength(1);
  });

  it("fails loudly on a refusal or an unknown shape, never inventing an empty answer", async () => {
    vi.stubEnv(JSEARCH_KEY_ENV, "test-key");
    await expect(searchJSearch(query, {
      fetchImpl: async () => json({ status: "ERROR", error: { message: "You are not subscribed to this API." } }),
    })).rejects.toThrow(/not subscribed/i);
    await expect(searchJSearch(query, {
      fetchImpl: async () => json({ status: "OK" }),
    })).rejects.toThrow(/without a job list/);
  });
});
