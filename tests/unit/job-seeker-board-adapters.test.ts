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
  fetchHimalayasJobs,
  himalayasSalary,
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

/**
 * One reply per call, in order, for adapters that make more than one.
 *
 * Arbeitnow walks pages, so a single-response stub cannot express either the
 * thing worth testing (a match found on a later page) or the failure mode
 * worth protecting (a later page erroring must not discard an earlier one).
 * Returns the recorded request URLs so a test can assert how far it walked.
 */
function stubSequence(replies: readonly { body: unknown; status?: number }[]) {
  const urls: string[] = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return urls;
}

describe("the registry", () => {
  it("offers ten working boards, every one of them keyless", () => {
    const adapters = listImportAdapters({} as NodeJS.ProcessEnv);
    const working = adapters.filter((adapter) => adapter.mode === "public");

    expect(working).toHaveLength(11);
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

describe("pay, where the board publishes it", () => {
  /*
   * Both of these were being fetched and discarded. Ashby's request already
   * carries `includeCompensation=true`, and Breezy's payload has always had a
   * `salary` string — the adapters simply hardcoded null. Found by probing all
   * eleven boards live and noticing which came back without pay.
   */
  it("takes Ashby's own formatted range", async () => {
    stub({ jobs: [{
      id: "ash-1",
      title: "Security Engineer, Cloud",
      location: "New York",
      jobUrl: "https://jobs.ashbyhq.com/ramp/ash-1",
      compensation: { compensationTierSummary: "$211.4K – $290.6K • Offers Equity" },
      shouldDisplayCompensationOnJobPostings: true,
    }] });
    const result = await fetchAshbyBoard("ramp");

    expect(result.postings[0]?.salaryText).toBe("$211.4K – $290.6K • Offers Equity");
  });

  /*
   * The employer's own decision, and it is theirs to make: 5 of the 139 roles
   * on the board this was written against opt out. Publishing a range they
   * chose to withhold would be republishing something they declined to.
   */
  it("withholds pay the employer chose not to display", async () => {
    stub({ jobs: [{
      id: "ash-2",
      title: "Staff Engineer",
      location: "New York",
      jobUrl: "https://jobs.ashbyhq.com/ramp/ash-2",
      compensation: { compensationTierSummary: "$211.4K – $290.6K" },
      shouldDisplayCompensationOnJobPostings: false,
    }] });
    const result = await fetchAshbyBoard("ramp");

    expect(result.postings[0]?.salaryText).toBeNull();
  });

  it("takes Breezy's salary string", async () => {
    stub([{
      id: "bz-1",
      name: "Employee #12",
      salary: "$120K – $150K / year",
      url: "https://breezy.breezy.hr/p/bz-1",
    }]);
    const result = await fetchBreezyBoard("breezy");

    expect(result.postings[0]?.salaryText).toBe("$120K – $150K / year");
  });

  it("leaves pay null where the board does not send it", async () => {
    stub([{ id: "bz-2", name: "Open Position", url: "https://breezy.breezy.hr/p/bz-2" }]);
    const result = await fetchBreezyBoard("breezy");

    expect(result.postings[0]?.salaryText).toBeNull();
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

  /*
   * Both of the following were written from a live account (blueground, 25
   * postings), and both are regressions rather than hypotheticals: the adapter
   * originally read `workplace` and `location.region`, neither of which
   * Workable's widget actually sends. The payload below is the real shape,
   * trimmed.
   */
  it("reads telecommuting, because there is no workplace field to read", async () => {
    stub({
      name: "Blueground",
      jobs: [
        {
          shortcode: "0FD01ABC66",
          title: "Business Development Representative",
          city: "",
          state: "",
          country: "United States",
          telecommuting: true,
          url: "https://apply.workable.com/j/0FD01ABC66",
        },
        {
          shortcode: "SECOND1234",
          title: "Full-Stack Software Engineer",
          city: "Athens",
          state: "Attica",
          country: "Greece",
          telecommuting: false,
          url: "https://apply.workable.com/j/SECOND1234",
        },
      ],
    });
    const result = await fetchWorkableBoard("blueground");

    expect(result.postings[0]?.workModel).toBe("remote");
    // `false` covers hybrid too, so it is not evidence of onsite and must not
    // become one — the location rule stays the only other source.
    expect(result.postings[1]?.workModel).toBeNull();
  });

  it("keeps the region, which lives in a flat state field", async () => {
    stub({
      name: "Blueground",
      jobs: [{
        shortcode: "SECOND1234",
        title: "Full-Stack Software Engineer",
        city: "Athens",
        state: "Attica",
        country: "Greece",
        telecommuting: false,
        url: "https://apply.workable.com/j/SECOND1234",
      }],
    });
    const result = await fetchWorkableBoard("blueground");

    expect(result.postings[0]?.location).toBe("Athens, Attica, Greece");
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

  /*
   * The defect pagination fixed. Reading only page one meant a term whose
   * matches sat further in returned nothing, and the board looked empty when
   * it was not — Arbeitnow answers ~175 postings a page and does have a
   * `links.next`.
   */
  it("keeps walking to find a match a later page holds", async () => {
    const page = (slug: string, title: string, next: string | null) => ({
      body: {
        data: [{ slug, title, company_name: "Acme", location: "Berlin", url: `https://arbeitnow.com/jobs/${slug}`, remote: false }],
        links: next ? { next } : {},
      },
    });
    const urls = stubSequence([
      page("p1", "Designer", "https://www.arbeitnow.com/api/job-board-api?page=2"),
      page("p2", "Kotlin Engineer", "https://www.arbeitnow.com/api/job-board-api?page=3"),
      page("p3", "Analyst", null),
    ]);

    const result = await fetchArbeitnowJobs("kotlin");
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.title).toBe("Kotlin Engineer");
    expect(urls).toHaveLength(3);
    expect(urls[1]).toContain("page=2");
  });

  it("stops when the board says there is no next page", async () => {
    const urls = stubSequence([
      { body: { data: [{ slug: "only", title: "Kotlin Engineer", company_name: "Acme", location: "Berlin", url: "https://arbeitnow.com/jobs/only", remote: false }], links: {} } },
    ]);

    await fetchArbeitnowJobs("kotlin");
    expect(urls).toHaveLength(1);
  });

  /*
   * Found live: walking five pages made Arbeitnow rate-limit the search. A
   * later page failing must not throw away a first page that already answered
   * the question — but the first page failing has nothing to degrade to, so
   * that still surfaces the real reason.
   */
  it("returns what it found when a later page fails", async () => {
    stubSequence([
      { body: { data: [{ slug: "p1", title: "Kotlin Engineer", company_name: "Acme", location: "Berlin", url: "https://arbeitnow.com/jobs/p1", remote: false }], links: { next: "https://www.arbeitnow.com/api/job-board-api?page=2" } } },
      { body: { error: "rate limited" }, status: 429 },
    ]);

    const result = await fetchArbeitnowJobs("kotlin");
    expect(result.postings).toHaveLength(1);
    expect(result.totalAvailable).toBe(1);
  });

  it("still reports the reason when the first page fails", async () => {
    stubSequence([{ body: { error: "rate limited" }, status: 429 }]);
    await expect(fetchArbeitnowJobs("kotlin")).rejects.toThrow(/rate limiting/i);
  });

  it("stops early once it has enough to fill an import", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      slug: `job-${index}`,
      title: "Kotlin Engineer",
      company_name: "Acme",
      location: "Berlin",
      url: `https://arbeitnow.com/jobs/job-${index}`,
      remote: false,
    }));
    const urls = stubSequence([
      { body: { data: many, links: { next: "https://www.arbeitnow.com/api/job-board-api?page=2" } } },
    ]);

    const result = await fetchArbeitnowJobs("kotlin");
    expect(result.postings).toHaveLength(40);
    // One page was enough; a second request would be work nobody asked for.
    expect(urls).toHaveLength(1);
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

describe("Himalayas", () => {
  const job = {
    id: null,
    guid: "https://himalayas.app/companies/mercor/jobs/ai-safety-8397173048",
    title: "AI Safety Specialist",
    companyName: "mercor",
    locationRestrictions: ["Czechia", "Poland"],
    applicationLink: "https://himalayas.app/companies/mercor/jobs/ai-safety-8397173048",
    excerpt: "About the job. Mercor connects talent with AI labs.",
    minSalary: 60,
    maxSalary: 70,
    salaryCurrency: null,
  };

  it("keys on guid, because every posting arrives with a null id", async () => {
    /*
     * The live feed sends `id: null` on every job. Keying on it would drop the
     * whole import silently — the same failure Remotive's numeric ids caused,
     * reached by a different route, which is why this has its own case.
     */
    stub({ jobs: [job] });
    const result = await fetchHimalayasJobs("safety");

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.externalId).toBe(job.guid);
  });

  it("keeps every permitted country, not just the first", async () => {
    stub({ jobs: [job] });
    const result = await fetchHimalayasJobs("safety");
    // "Czechia" alone would misstate a role open across two countries.
    expect(result.postings[0]?.location).toBe("Czechia, Poland");
  });

  it("reports the salary as given, inventing neither currency nor period", () => {
    /*
     * The live feed carries minSalary 60 beside a null currency — an hourly
     * rate, not an annual one. "USD 60,000–70,000/yr" would be three invented
     * facts stacked on one real number.
     */
    expect(himalayasSalary(job)).toBe("60–70");
    expect(himalayasSalary({ ...job, salaryCurrency: "USD" })).toBe("USD 60–70");
    expect(himalayasSalary({ ...job, minSalary: null, maxSalary: null })).toBeNull();
  });
});
