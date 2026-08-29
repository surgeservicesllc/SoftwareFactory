// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  EMPTY_LINKOUT_QUERY,
  buildLinkoutUrl,
  fillLinkTemplate,
  linkoutCarriesFilters,
} from "@/lib/job-seeker/board-search/linkout";

/**
 * The deep links are the wiring LinkedIn and Indeed actually permit, so the
 * URLs must be exact: every mapped filter lands in the parameter the site's
 * own search UI reads, and everything a site cannot express stays off the
 * URL — never bent into a parameter that means something else.
 */

const LINKEDIN = "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}";
const INDEED = "https://www.indeed.com/jobs?q={query}&l={location}";

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("the LinkedIn deep link", () => {
  it("carries every mappable filter in LinkedIn's own parameters", () => {
    const url = buildLinkoutUrl("linkedin_jobs", LINKEDIN, {
      text: "growth marketing",
      location: "Copenhagen",
      radiusKm: 50,
      postedWithinDays: 7,
      workModel: "remote",
      seniority: "senior",
      salaryMinimum: 90_000,
    });
    const search = params(url);
    expect(url.startsWith("https://www.linkedin.com/jobs/search/?")).toBe(true);
    expect(search.get("keywords")).toBe("growth marketing");
    expect(search.get("location")).toBe("Copenhagen");
    // 50 km ≈ 31 miles.
    expect(search.get("distance")).toBe("31");
    // Posted within 7 days, in LinkedIn's r+seconds form.
    expect(search.get("f_TPR")).toBe("r604800");
    // Remote is work type 2.
    expect(search.get("f_WT")).toBe("2");
    // "senior" is LinkedIn's mid-senior level 4.
    expect(search.get("f_E")).toBe("4");
    // $90k floor → the $80k+ bucket (3): a superset, never a mislabeled cut.
    expect(search.get("f_SB2")).toBe("3");
  });

  it("leaves unmappable values off the URL instead of bending them", () => {
    const url = buildLinkoutUrl("linkedin_jobs", LINKEDIN, {
      ...EMPTY_LINKOUT_QUERY,
      text: "engineering manager",
      // LinkedIn has no "manager" level; no radius without a place; $30k is
      // below the lowest salary bucket.
      seniority: "manager",
      radiusKm: 25,
      salaryMinimum: 30_000,
    });
    const search = params(url);
    expect(search.get("f_E")).toBeNull();
    expect(search.get("distance")).toBeNull();
    expect(search.get("f_SB2")).toBeNull();
    expect(search.get("keywords")).toBe("engineering manager");
  });

  it("matches the plain template's meaning when no filters are set", () => {
    const url = buildLinkoutUrl("linkedin_jobs", LINKEDIN, {
      ...EMPTY_LINKOUT_QUERY,
      text: "engineer",
    });
    const search = params(url);
    expect(search.get("keywords")).toBe("engineer");
    expect(search.get("location")).toBe("");
    expect([...search.keys()]).toEqual(["keywords", "location"]);
  });
});

describe("the Indeed deep link", () => {
  it("carries place, radius and posted date as parameters, salary and remote in the query text", () => {
    const url = buildLinkoutUrl("indeed", INDEED, {
      text: "seo specialist",
      location: "Austin",
      radiusKm: 40,
      postedWithinDays: 3,
      workModel: "remote",
      seniority: null,
      salaryMinimum: 75_000,
    });
    const search = params(url);
    expect(url.startsWith("https://www.indeed.com/jobs?")).toBe(true);
    // Indeed's own search tips: salary and "remote" belong in the what-box.
    expect(search.get("q")).toBe("seo specialist $75,000 remote");
    expect(search.get("l")).toBe("Austin");
    // 40 km ≈ 24.9 miles → snapped UP to Indeed's 25, never narrowed.
    expect(search.get("radius")).toBe("25");
    expect(search.get("fromage")).toBe("3");
  });

  it("caps the radius at Indeed's largest choice and skips it without a place", () => {
    const far = buildLinkoutUrl("indeed", INDEED, {
      ...EMPTY_LINKOUT_QUERY,
      text: "x",
      location: "Denver",
      radiusKm: 500,
    });
    expect(params(far).get("radius")).toBe("100");

    const nowhere = buildLinkoutUrl("indeed", INDEED, {
      ...EMPTY_LINKOUT_QUERY,
      text: "x",
      radiusKm: 40,
    });
    expect(params(nowhere).get("radius")).toBeNull();
  });
});

describe("every other link-out source", () => {
  it("keeps its own template, filled with query and location only", () => {
    const template = "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query}&locT=&locKeyword={location}";
    const url = buildLinkoutUrl("glassdoor", template, {
      ...EMPTY_LINKOUT_QUERY,
      text: "brand manager",
      location: "New York",
      salaryMinimum: 120_000,
    });
    expect(url).toBe(fillLinkTemplate(template, "brand manager", "New York"));
    // No invented parameters: the filter stays behind on sites without a
    // verified mapping.
    expect(url.includes("120")).toBe(false);
  });

  it("says which links carry filters, so the UI can label them honestly", () => {
    expect(linkoutCarriesFilters("linkedin_jobs")).toBe(true);
    expect(linkoutCarriesFilters("indeed")).toBe(true);
    expect(linkoutCarriesFilters("glassdoor")).toBe(false);
  });
});
