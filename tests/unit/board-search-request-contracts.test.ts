// @vitest-environment node

import { describe, expect, it } from "vitest";

import { searchFreehire } from "@/lib/job-seeker/board-search/freehire";
import { searchJobindex } from "@/lib/job-seeker/board-search/jobindex";
import { searchJobnet } from "@/lib/job-seeker/board-search/jobnet";
import { BOARD_SEARCH_ADAPTERS } from "@/lib/job-seeker/board-search/registry";

const query = { text: "software engineer", location: "London", limit: 2 } as const;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("live board request contracts", () => {
  it("uses Jobnet's current BFF path and named publication sort", async () => {
    let requested = new URL("https://invalid.example/");
    let csrf: string | null = null;
    await searchJobnet(query, {
      fetchImpl: async (input, init) => {
        requested = new URL(String(input));
        csrf = new Headers(init?.headers).get("x-csrf");
        return json({ jobAds: [], totalJobAdCount: 0 });
      },
    });

    expect(requested?.pathname).toBe("/bff/FindJob/Search");
    expect(requested?.searchParams.get("orderType")).toBe("PublicationDate");
    expect(requested?.searchParams.get("searchString")).toBe("software engineer London");
    expect(csrf).toBe("1");
  });

  it("uses Freehire's cities filter rather than its ignored location parameter", async () => {
    let requested = new URL("https://invalid.example/");
    await searchFreehire(query, {
      fetchImpl: async (input) => {
        requested = new URL(String(input));
        return json({ data: [], meta: { total: 0 } });
      },
    });

    expect(requested?.searchParams.getAll("cities")).toEqual(["London"]);
    expect(requested?.searchParams.has("location")).toBe(false);
  });

  it("does not pass a free-text place as Jobindex's internal supid", async () => {
    let requested = new URL("https://invalid.example/");
    await searchJobindex(query, {
      fetchImpl: async (input) => {
        requested = new URL(String(input));
        return new Response(
          '<html><script>var Stash = {"searchResponse":{"results":[],"hitcount":0}};</script></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      },
    });

    expect(requested?.searchParams.get("q")).toBe("software engineer");
    expect(requested?.searchParams.has("supid")).toBe(false);
    expect(requested?.searchParams.has("location")).toBe(false);
  });

  it("fails loudly when Jobindex has rows but none match the known shape", async () => {
    await expect(searchJobindex(query, {
      fetchImpl: async () => new Response(
        '<html><script>var Stash = {"searchResponse":{"results":[{"unknown":true}],"hitcount":1}};</script></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    })).rejects.toThrow(/shape this search cannot read/i);
  });

  it("declares exactly which adapter cannot honor free-text location", () => {
    expect(
      Object.fromEntries(BOARD_SEARCH_ADAPTERS.map((adapter) => [adapter.key, adapter.supportsLocation])),
    ).toEqual({
      jobnet: true,
      jobindex: false,
      jobdanmark: true,
      freehire: true,
      // The 2026-08-29 expansion: remote-first boards whose APIs have no
      // location parameter — the candidate-location facts they do state land
      // in each hit's `location` field instead of being pretended upstream.
      remotive: false,
      remoteok: false,
      jobicy: false,
      himalayas: false,
      arbeitnow: false,
      weworkremotely: false,
    });
  });
});
