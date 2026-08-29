// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAshbyBoard,
  fetchBreezyBoard,
  fetchSmartRecruitersBoard,
  fetchWorkableBoard,
} from "@/lib/job-seeker/boards/company-boards";
import {
  assertSearchTerm,
  fetchArbeitnowJobs,
  fetchJobicyJobs,
  fetchRemoteOkJobs,
  fetchRemotiveJobs,
} from "@/lib/job-seeker/boards/aggregators";
import { ImportSourceError, listImportAdapters } from "@/lib/job-seeker/import-adapters";

/**
 * The eight boards added beside Greenhouse and Lever.
 *
 * Every payload below is the shape the provider actually returned when it was
 * probed live, not one taken from documentation — several of these are
 * undocumented board endpoints, so a shape from a blog post would be a guess.
 * The tests themselves use fixtures rather than the network: a suite that
 * calls remoteok.com fails when someone else ships a change, and a suite that
 * fails for reasons outside this repository stops being read.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * A fresh Response per call, deliberately. A Response body can only be read
 * once, so handing the same object to two fetches makes the second fail with
 * "not JSON" — which reads as a provider bug and is a test bug. Learned by
 * writing it the other way first.
 */
function stub(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
}

describe("the registry", () => {
  it("offers ten working boards, every one of them keyless", () => {
    const adapters = listImportAdapters({} as NodeJS.ProcessEnv);
    const working = adapters.filter((adapter) => adapter.mode === "public");

    expect(working).toHaveLength(10);
    for (const adapter of working) {
      // A board a person can see is a board that will actually be called.
      expect(typeof adapter.fetchPostings, `${adapter.key} has no fetch`).toBe("function");
      expect(adapter.configured, `${adapter.key} not configured`).toBe(true);
      expect(adapter.requiredConfiguration, `${adapter.key} wants config`).toEqual([]);
      expect(adapter.identifierLabel, `${adapter.key} has no label`).toBeTruthy();
    }
  });

  it("keeps LinkedIn unconfigured and unimplemented", () => {
    const linkedin = listImportAdapters({} as NodeJS.ProcessEnv).find((a) => a.key === "linkedin");
    expect(linkedin?.configured).toBe(false);
    // Nothing to call means nothing that could invent a job.
    expect(linkedin?.fetchPostings).toBeUndefined();
  });

  it("gives every board a source key the job_seeker_jobs CHECK accepts", () => {
    // `source` is `^[a-z][a-z0-9_]{0,62}$`. A key that fails it would be
    // unsavable, and the failure would only appear on someone's first import.
    for (const adapter of listImportAdapters({} as NodeJS.ProcessEnv)) {
      expect(adapter.key, `${adapter.key} is not a storable source`).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
  });
});

describe("numeric provider ids", () => {
  it("keeps postings whose id arrived as a number", async () => {
    /*
     * The regression that live probing caught and unit tests had not: Remotive
     * and Jobicy send `id` as a JSON number, `boundedOrNull` refuses non-strings,
     * and every posting was dropped. Both boards reported finding jobs and
     * importing none — a silent empty result, not an error.
     */
    stub({ jobs: [{ id: 2091101, title: "Senior React Developer", company_name: "Lemon.io", url: "https://remotive.com/x" }] });
    const result = await fetchRemotiveJobs("react");

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.externalId).toBe("2091101");
  });
});

describe("Ashby", () => {
  const job = {
    id: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    title: "Security Engineer, Cloud",
    location: "New York, NY (HQ)",
    employmentType: "FullTime",
    jobUrl: "https://jobs.ashbyhq.com/Ramp/34413f8d",
    isRemote: true,
  };

  it("maps a posting and reads the remote flag rather than guessing", async () => {
    stub({ apiVersion: "1", jobs: [job] });
    const result = await fetchAshbyBoard("ramp");

    expect(result.postings[0]).toMatchObject({
      externalId: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
      title: "Security Engineer, Cloud",
      company: "ramp",
      workModel: "remote",
    });
  });

  it("says the board is missing rather than reporting an empty one", async () => {
    stub({ message: "not found" }, 404);
    await expect(fetchAshbyBoard("nope")).rejects.toMatchObject({ code: "source_not_found" });
  });
});

describe("SmartRecruiters", () => {
  it("builds the public apply URL its payload omits", async () => {
    stub(({
      totalFound: 2,
      content: [{ id: "744000", name: "Security Engineer", company: { name: "SmartRecruiters Inc" }, location: { city: "Kraków", country: "pl" } }],
    }));
    const result = await fetchSmartRecruitersBoard("smartrecruiters");

    expect(result.postings[0]?.url).toBe("https://jobs.smartrecruiters.com/smartrecruiters/744000");
    expect(result.postings[0]?.location).toBe("Kraków, pl");
    // The board's own total, not the page size.
    expect(result.totalAvailable).toBe(2);
  });
});

describe("Workable", () => {
  it("prefers the shortcode, which is what its public URLs use", async () => {
    stub({ name: "Deel", jobs: [{ id: 99, shortcode: "A1B2C3", title: "Engineer", url: "https://apply.workable.com/deel/j/A1B2C3" }] });
    const result = await fetchWorkableBoard("deel");

    expect(result.postings[0]?.externalId).toBe("A1B2C3");
    expect(result.company).toBe("Deel");
  });

  it("calls a rate limit a rate limit", async () => {
    /*
     * Observed live: Workable sits behind Cloudflare and starts answering 429
     * after a few requests in quick succession. On a shared server that is one
     * tenant throttling the next, and "answered HTTP 429" tells a person
     * nothing they can act on.
     */
    stub({ error: "rate limited" }, 429);
    await expect(fetchWorkableBoard("deel")).rejects.toThrow(/rate limiting/i);
  });
});

describe("Breezy", () => {
  it("reads its bare array and flattens the nested location", async () => {
    stub([{ id: "98323abf2296", name: "Employee #12", location: { city: "Austin", country: { name: "United States" } }, url: "https://breezy.breezy.hr/p/98323abf2296" }]);
    const result = await fetchBreezyBoard("breezy");

    expect(result.postings[0]?.location).toBe("Austin, United States");
  });

  it("treats a non-array answer as a board that is not there", async () => {
    // A parked subdomain answers 200 with an error object, not a 404.
    stub({ error: "not found" });
    await expect(fetchBreezyBoard("parked")).rejects.toMatchObject({ code: "source_not_found" });
  });
});

describe("Remote OK", () => {
  const legal = { legal: "API Terms of Service: Please link back...", warning: "..." };
  const job = { id: "1137195", position: "Senior Go Engineer", company: "Acme", location: "Worldwide", url: "https://remoteOK.com/remote-jobs/1137195", tags: ["golang"], salary_min: 100000, salary_max: 150000 };

  it("skips the terms-of-service object that leads its array", async () => {
    /*
     * Remote OK puts its API terms in element zero. A reader that maps the
     * array straight through imports a job with no title under no employer.
     */
    stub([legal, job]);
    const result = await fetchRemoteOkJobs("golang");

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.title).toBe("Senior Go Engineer");
  });

  it("links back to Remote OK's own URL, which their terms require", async () => {
    stub([legal, job]);
    const result = await fetchRemoteOkJobs("golang");

    expect(result.postings[0]?.url).toBe("https://remoteOK.com/remote-jobs/1137195");
    expect(result.postings[0]?.salaryText).toBe("USD 100000–150000");
  });

  it("matches on tags, not only the title", async () => {
    stub([legal, job]);
    // "golang" appears only in tags here; a title-only search would miss it.
    expect((await fetchRemoteOkJobs("golang")).postings).toHaveLength(1);
    expect((await fetchRemoteOkJobs("nothing-matches-this")).postings).toHaveLength(0);
  });
});

describe("Jobicy", () => {
  it("keeps the original listing URL its terms require, and reads salary", async () => {
    stub({ jobs: [{ id: 148333, jobTitle: "Data Director", companyName: "Liberty Mutual", jobGeo: "USA", url: "https://jobicy.com/jobs/148333", annualSalaryMin: 120000, annualSalaryMax: 160000, salaryCurrency: "USD" }] });
    const result = await fetchJobicyJobs("data");

    expect(result.postings[0]?.url).toBe("https://jobicy.com/jobs/148333");
    expect(result.postings[0]?.salaryText).toBe("USD 120000–160000");
    expect(result.postings[0]?.workModel).toBe("remote");
  });
});

describe("Arbeitnow", () => {
  it("filters the page itself, and says so by counting matches not the page", async () => {
    /*
     * Arbeitnow's board endpoint takes no query, so filtering happens here.
     * totalAvailable reports matches within the page — not Arbeitnow's whole
     * catalogue, which this adapter cannot see.
     */
    stub(({ data: [
      { slug: "a-berlin-1", title: "Backend Engineer", company_name: "Eye Security", location: "Berlin", url: "https://arbeitnow.com/jobs/a-berlin-1", remote: false },
      { slug: "b-munich-2", title: "Designer", company_name: "Other", location: "Munich", url: "https://arbeitnow.com/jobs/b-munich-2", remote: true },
    ] }));

    const result = await fetchArbeitnowJobs("berlin");
    expect(result.postings).toHaveLength(1);
    expect(result.totalAvailable).toBe(1);
  });
});

describe("search terms", () => {
  it("accepts the ordinary thing a person types", () => {
    // assertIdentifier forbids spaces; aggregators must not use it.
    expect(assertSearchTerm("  react   developer ")).toBe("react developer");
  });

  it("refuses an empty or oversized term", () => {
    expect(() => assertSearchTerm("   ")).toThrow(ImportSourceError);
    expect(() => assertSearchTerm("x".repeat(121))).toThrow(/120 characters/);
  });
});

describe("an empty board", () => {
  it("is an empty import, not an error", async () => {
    // "No remote React roles today" is a real answer.
    stub({ jobs: [] });
    const result = await fetchRemotiveJobs("nothing");
    expect(result.postings).toEqual([]);
    expect(result.totalAvailable).toBe(0);
  });
});
