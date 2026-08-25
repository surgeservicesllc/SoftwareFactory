// @vitest-environment node

import { describe, expect, it } from "vitest";

import { extractCity, toIsoDate, toJobdanmarkHits } from "@/lib/job-seeker/board-search/jobdanmark";

/**
 * Jobdanmark's two pieces of real domain knowledge: a date written the Danish
 * way round, and a city buried in a postal address. Both are cheap to get
 * subtly wrong and expensive to notice, which is what these pin.
 */

const item = {
  title: "Systemudvikler",
  companyName: "Kolding Software ApS",
  companyAddress: "Lautruphoej 2, 2750 Ballerup",
  publishedDate: "20-08-2026",
  applicationDeadline: "15-09-2026",
  url: "/job/systemudvikler-kolding-2026",
};

describe("jobdanmark dates", () => {
  it("reads DD-MM-YYYY the way Jobdanmark means it", () => {
    // 08-09-2026 is 8 September, not 9 August. Getting this backwards produces
    // a plausible date, which is why it needs a test rather than a glance.
    expect(toIsoDate("08-09-2026")).toBe("2026-09-08");
    expect(toIsoDate("20-08-2026")).toBe("2026-08-20");
  });

  it("drops a shape it does not recognise instead of passing it through", () => {
    /*
     * The source let an unknown value flow onward so it stayed visible in the
     * terminal. Here it would be stored and rendered as a date, and a wrong
     * date is worse than a missing one.
     */
    expect(toIsoDate("næste uge")).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(20_260_820)).toBeNull();
  });

  it("still accepts an ISO date, in case the board changes its mind", () => {
    expect(toIsoDate("2026-08-20T09:00:00Z")).toBe("2026-08-20");
  });
});

describe("jobdanmark addresses", () => {
  it("takes the city after the postcode", () => {
    expect(extractCity("Lautruphoej 2, 2750 Ballerup")).toBe("Ballerup");
    expect(extractCity("2670, Greve")).toBe("Greve");
  });

  it("does not mistake a four-digit street number for a postcode", () => {
    // The source's own edge case: "Vejlevej 1234, 7100 Vejle" must resolve to
    // Vejle, not to the text after the street number.
    expect(extractCity("Vejlevej 1234, 7100 Vejle")).toBe("Vejle");
  });

  it("answers null rather than guessing when there is no postcode", () => {
    expect(extractCity("Hovedgaden")).toBeNull();
    expect(extractCity(null)).toBeNull();
  });
});

describe("the jobdanmark mapper", () => {
  it("uses the slug as identity and makes the link absolute", () => {
    const [hit] = toJobdanmarkHits({ items: [item] }, 10);
    expect(hit?.job.externalId).toBe("systemudvikler-kolding-2026");
    expect(hit?.job.url).toBe("https://jobdanmark.dk/job/systemudvikler-kolding-2026");
    expect(hit?.job.location).toBe("Ballerup");
    expect(hit?.publishedOn).toBe("2026-08-20");
    expect(hit?.closesOn).toBe("2026-09-15");
  });

  it("drops a posting it cannot identify", () => {
    const hits = toJobdanmarkHits({ items: [{ ...item, url: null }, item] }, 10);
    expect(hits).toHaveLength(1);
  });

  it("honours the limit", () => {
    const hits = toJobdanmarkHits(
      { items: [item, { ...item, url: "/job/b" }, { ...item, url: "/job/c" }] },
      2,
    );
    expect(hits).toHaveLength(2);
  });
});
