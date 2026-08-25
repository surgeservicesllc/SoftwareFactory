// @vitest-environment node

import { describe, expect, it } from "vitest";

import { toFreehireHits, toSalaryText, toWorkModel } from "@/lib/job-seeker/board-search/freehire";

/**
 * Freehire is the only board that fills work arrangement and salary, so it is
 * the only one where those two fields can be wrong rather than merely absent.
 * That is what these cases are about.
 */

const job = {
  public_slug: "senior-go-engineer-acme",
  title: "Senior Go Engineer",
  company: "Acme Remote",
  location: "Remote (EU)",
  url: "https://freehire.me/jobs/senior-go-engineer-acme",
  posted_at: "2026-08-19T09:00:00Z",
  work_mode: "remote",
  description: "<p>Go and Postgres.</p>",
  enrichment: { salary_min: 700_000, salary_max: 900_000, salary_currency: "DKK" },
};

describe("the freehire mapper", () => {
  it("reads the work arrangement rather than guessing it", () => {
    const [hit] = toFreehireHits({ data: [job] }, 10);
    expect(hit?.job.workModel).toBe("remote");
    expect(hit?.job.salaryText).toBe("DKK 700000–900000");
    expect(hit?.publishedOn).toBe("2026-08-19");
  });

  it("drops an unrecognised arrangement instead of coercing it", () => {
    /*
     * A posting recorded as "remote" because the facet said something this
     * code did not recognise is a wrong fact about someone's job. Null is
     * only a missing one.
     */
    expect(toWorkModel("flexible")).toBeNull();
    expect(toWorkModel("REMOTE")).toBe("remote");
    expect(toWorkModel(null)).toBeNull();
    expect(toWorkModel(42)).toBeNull();
  });

  it("says nothing about salary when the posting does not", () => {
    expect(toSalaryText(undefined)).toBeNull();
    expect(toSalaryText({})).toBeNull();
    expect(toSalaryText({ salary_min: 500_000 })).toBe("500000");
    expect(toSalaryText({ salary_max: 900_000, salary_currency: "EUR" })).toBe("EUR 900000");
  });

  it("drops an untitled posting rather than naming it '(untitled)'", () => {
    // The source defaulted this, which is right for a CLI listing and wrong
    // for a stored row: a job in someone's list under a name nobody chose.
    const hits = toFreehireHits({ data: [{ ...job, title: null }, job] }, 10);
    expect(hits).toHaveLength(1);
  });

  it("refuses a non-http url", () => {
    const [hit] = toFreehireHits({ data: [{ ...job, url: "javascript:alert(1)" }] }, 10);
    expect(hit?.job.url).toBeNull();
  });
});
