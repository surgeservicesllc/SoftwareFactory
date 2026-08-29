// @vitest-environment node

import { describe, expect, it } from "vitest";

import { extractStash, findSearchResponse, toJobindexHits } from "@/lib/job-seeker/board-search/jobindex";
import { jobnetTotal, toJobnetHits } from "@/lib/job-seeker/board-search/jobnet";
import { BoardSearchError } from "@/lib/job-seeker/board-search/types";

/**
 * The parsers, against payloads shaped like the boards' own.
 *
 * These are the files most likely to be wrong and least likely to look wrong:
 * a parser that quietly returns nothing is indistinguishable from a search
 * with no matches. So the cases that matter most here are the ones asserting
 * that malformed input *throws* rather than yielding an empty list.
 *
 * No network. Every board is represented by a fixture, because a test that
 * calls jobindex.dk fails when someone else's marketing team ships a change,
 * and a suite that fails for reasons outside the repository stops being read.
 */

describe("the jobnet parser", () => {
  const ad = {
    jobAdId: "5901234",
    title: "Senior Platform Engineer",
    hiringOrgName: "Nordisk Teknik A/S",
    postalDistrictName: "København K",
    municipality: "København",
    publicationDate: "2026-08-18T00:00:00",
    applicationDeadline: "2026-09-15T00:00:00",
    description: "<p>We need <b>Kubernetes</b>&nbsp;depth.</p>",
  };

  it("normalizes a posting into the shape job_seeker_jobs stores", () => {
    const [hit] = toJobnetHits({ jobAds: [ad] }, 10);
    expect(hit?.job).toMatchObject({
      externalId: "5901234",
      title: "Senior Platform Engineer",
      company: "Nordisk Teknik A/S",
      location: "København K",
      url: "https://jobnet.dk/find-job/5901234",
    });
    expect(hit?.publishedOn).toBe("2026-08-18");
    expect(hit?.closesOn).toBe("2026-09-15");
  });

  it("turns the description's HTML into text without running words together", () => {
    const [hit] = toJobnetHits({ jobAds: [ad] }, 10);
    // The &nbsp; between "Kubernetes" and "depth" must survive as a space.
    expect(hit?.job.description).toContain("Kubernetes depth");
    expect(hit?.job.description).not.toContain("<b>");
  });

  it("reads Jobnet's 1900-01-01 as no deadline rather than as a date", () => {
    const [hit] = toJobnetHits(
      { jobAds: [{ ...ad, applicationDeadline: "1900-01-01T00:00:00" }] },
      10,
    );
    expect(hit?.closesOn).toBeNull();
  });

  it("drops a posting with no title or no employer rather than inventing one", () => {
    /*
     * job_seeker_jobs requires both. A placeholder here is a fabricated
     * employer in a person's job list, which is the failure the source
     * column's own comment names.
     */
    const hits = toJobnetHits(
      { jobAds: [{ ...ad, hiringOrgName: "   " }, { ...ad, title: null }, ad] },
      10,
    );
    expect(hits).toHaveLength(1);
  });

  it("never returns more than asked for", () => {
    const hits = toJobnetHits({ jobAds: [ad, { ...ad, jobAdId: "2" }, { ...ad, jobAdId: "3" }] }, 2);
    expect(hits).toHaveLength(2);
  });

  it("reports the board's own total, and null when it did not say", () => {
    expect(jobnetTotal({ totalJobAdCount: 812 })).toBe(812);
    expect(jobnetTotal({})).toBeNull();
    // Not zero: "the board did not say" and "there are none" are different
    // answers and only one of them means the search was exhaustive.
    expect(jobnetTotal({ totalJobAdCount: "many" })).toBeNull();
  });
});

describe("the jobindex Stash extractor", () => {
  const wrap = (payload: string) => `<html><script>var Stash = ${payload};</script></html>`;

  it("lifts the payload out of the page", () => {
    expect(extractStash(wrap('{"a":1}'))).toEqual({ a: 1 });
  });

  it("survives braces and escaped quotes inside a job description", () => {
    /*
     * The whole reason this is a brace counter and not a regex. A description
     * containing `{` and `\"` would end the match early under any naive scan,
     * and every posting after it would be lost silently.
     */
    const payload = '{"results":[{"description":"Use {a: 1} and say \\"hi\\" } here"}]}';
    const stash = extractStash(wrap(payload)) as { results: { description: string }[] };
    expect(stash.results[0]?.description).toBe('Use {a: 1} and say "hi" } here');
  });

  it("throws rather than returning nothing when the blob is missing", () => {
    // The load-bearing case: a markup change must not read as "no matches".
    expect(() => extractStash("<html>no stash here</html>")).toThrow(BoardSearchError);
  });

  it("throws when the blob is cut off", () => {
    expect(() => extractStash('<html><script>var Stash = {"a":')).toThrow(/cut off/i);
  });

  it("throws when the blob is not valid JSON", () => {
    expect(() => extractStash(wrap("{not json}"))).toThrow(/not valid JSON/i);
  });
});

describe("finding jobindex's search response", () => {
  it("finds it wherever the component tree currently puts it", () => {
    const found = findSearchResponse({
      jobsearch: { result_app: { storeData: { searchResponse: { results: [], hitcount: 4 } } } },
    });
    expect(found?.hitcount).toBe(4);
  });

  it("looks through arrays too", () => {
    const found = findSearchResponse([{ x: { searchResponse: { results: [1] } } }]);
    expect(found?.results).toHaveLength(1);
  });

  it("ignores a searchResponse with no results array", () => {
    expect(findSearchResponse({ searchResponse: { hitcount: 3 } })).toBeNull();
  });

  it("gives up rather than hanging on a deeply nested payload", () => {
    let deep: Record<string, unknown> = { searchResponse: { results: [] } };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(findSearchResponse(deep)).toBeNull();
  });
});

describe("the jobindex row mapper", () => {
  const row = {
    tid: "h1234567",
    headline: "Backend Developer",
    company: "Kolding Software ApS",
    area: "Kolding",
    url: "/jobannonce/h1234567",
    date: "2026-08-20",
  };

  it("maps a row and makes its URL absolute", () => {
    const [hit] = toJobindexHits({ results: [row] }, 10);
    expect(hit?.job.url).toBe("https://www.jobindex.dk/jobannonce/h1234567");
    expect(hit?.job).toMatchObject({ title: "Backend Developer", company: "Kolding Software ApS" });
    expect(hit?.publishedOn).toBe("2026-08-20");
  });

  it("reads the nested company shape Jobindex serves today", () => {
    const [hit] = toJobindexHits(
      { results: [{ ...row, company: { name: "Kolding Software ApS" } }] },
      10,
    );
    expect(hit?.job.company).toBe("Kolding Software ApS");
  });

  it("skips a row it cannot identify rather than storing a partial job", () => {
    const hits = toJobindexHits({ results: [{ ...row, tid: null, id: null, url: null }, row] }, 10);
    expect(hits).toHaveLength(1);
  });

  it("refuses a non-http URL instead of passing it to a link", () => {
    // job_seeker_jobs.url has an `^https?://` CHECK; anything else must not
    // reach it, and a javascript: URL must never become an href.
    const [hit] = toJobindexHits({ results: [{ ...row, url: "javascript:alert(1)" }] }, 10);
    expect(hit?.job.url).toBeNull();
  });
});
