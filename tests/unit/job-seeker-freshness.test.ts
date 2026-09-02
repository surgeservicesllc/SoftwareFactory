import { describe, expect, it } from "vitest";

import {
  assessFreshness,
  FRESH_UNDER_DAYS,
  freshnessLabel,
  REPOSTS_FOR_STALE,
  STALE_FROM_DAYS,
  toSighting,
  type Sighting,
} from "@/lib/job-seeker/board-search/freshness";
import { postingUrlKey } from "@/lib/job-seeker/board-search/posting-key";

/**
 * The freshness verdict, checked where a wrong answer would look plausible:
 * a re-dated posting reading as new, a closed posting reading as open, a
 * posting with no date reading as fresh. Every sentence is asserted exactly,
 * because the sentence is the product — a badge with no number is the thing
 * the boards already show.
 */

const NOW = new Date("2026-09-02T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function sighting(overrides: Partial<Sighting> = {}): Sighting {
  return {
    firstSeenAt: `${daysAgo(3)}T00:00:00Z`,
    lastSeenAt: `${daysAgo(0)}T00:00:00Z`,
    timesSeen: 2,
    earliestPostedOn: null,
    latestPostedOn: null,
    reposts: 0,
    closesOn: null,
    ...overrides,
  };
}

describe("assessFreshness", () => {
  it("calls a posting fresh from the board's own date and says the number", () => {
    const verdict = assessFreshness({ publishedOn: daysAgo(5), closesOn: null, sighting: null, now: NOW });
    expect(verdict.level).toBe("fresh");
    expect(verdict.postedDaysAgo).toBe(5);
    expect(verdict.reasons).toEqual(["Posted 5 days ago by the board's own date."]);
  });

  it("ages at the printed threshold and goes stale at the next one", () => {
    expect(assessFreshness({ publishedOn: daysAgo(FRESH_UNDER_DAYS - 1), closesOn: null, sighting: null, now: NOW }).level).toBe("fresh");
    expect(assessFreshness({ publishedOn: daysAgo(FRESH_UNDER_DAYS), closesOn: null, sighting: null, now: NOW }).level).toBe("aging");
    expect(assessFreshness({ publishedOn: daysAgo(STALE_FROM_DAYS - 1), closesOn: null, sighting: null, now: NOW }).level).toBe("aging");
    expect(assessFreshness({ publishedOn: daysAgo(STALE_FROM_DAYS), closesOn: null, sighting: null, now: NOW }).level).toBe("stale");
  });

  it("does not believe a re-dated posting: the earliest date ever seen wins", () => {
    const verdict = assessFreshness({
      publishedOn: daysAgo(3),
      closesOn: null,
      sighting: sighting({
        firstSeenAt: `${daysAgo(70)}T00:00:00Z`,
        timesSeen: 9,
        earliestPostedOn: daysAgo(72),
        latestPostedOn: daysAgo(3),
        reposts: 1,
      }),
      now: NOW,
    });
    expect(verdict.level).toBe("stale");
    expect(verdict.postedDaysAgo).toBe(72);
    expect(verdict.firstSeenDaysAgo).toBe(70);
    expect(verdict.reasons).toEqual([
      `The board now dates it ${daysAgo(3)}, but it was first dated ${daysAgo(72)}: 72 days ago.`,
      "First seen here 70 days ago, on 9 searches.",
      "Re-dated 1 time since first seen (the posting date moved forward).",
    ]);
  });

  it("calls two re-datings stale however recent the current date is", () => {
    const verdict = assessFreshness({
      publishedOn: daysAgo(2),
      closesOn: null,
      sighting: sighting({ firstSeenAt: `${daysAgo(10)}T00:00:00Z`, earliestPostedOn: daysAgo(10), latestPostedOn: daysAgo(2), reposts: REPOSTS_FOR_STALE, timesSeen: 4 }),
      now: NOW,
    });
    expect(verdict.level).toBe("stale");
    expect(verdict.reasons).toContain("Re-dated 2 times since first seen (the posting date moved forward).");
  });

  it("calls a posting stale once its stated closing date has passed", () => {
    const verdict = assessFreshness({ publishedOn: daysAgo(4), closesOn: daysAgo(2), sighting: null, now: NOW });
    expect(verdict.level).toBe("stale");
    expect(verdict.reasons).toEqual([
      "Posted 4 days ago by the board's own date.",
      `The stated closing date ${daysAgo(2)} has passed.`,
    ]);
  });

  it("keeps a posting whose closing date is still ahead", () => {
    const verdict = assessFreshness({ publishedOn: daysAgo(4), closesOn: daysAgo(-10), sighting: null, now: NOW });
    expect(verdict.level).toBe("fresh");
    expect(verdict.reasons).toEqual(["Posted 4 days ago by the board's own date."]);
  });

  it("uses the ledger when the board states no date at all", () => {
    const verdict = assessFreshness({
      publishedOn: null,
      closesOn: null,
      sighting: sighting({ firstSeenAt: `${daysAgo(30)}T00:00:00Z`, timesSeen: 4 }),
      now: NOW,
    });
    expect(verdict.level).toBe("aging");
    expect(verdict.postedDaysAgo).toBeNull();
    expect(verdict.reasons).toEqual(["First seen here 30 days ago, on 4 searches."]);
  });

  it("never assumes fresh: no date and no earlier sighting is unknown, and says why", () => {
    const verdict = assessFreshness({ publishedOn: null, closesOn: null, sighting: null, now: NOW });
    expect(verdict.level).toBe("unknown");
    expect(verdict.reasons).toEqual([
      "The board states no posting date and this product has not seen the posting before.",
    ]);
  });

  it("labels only the levels a person needs warning about", () => {
    expect(freshnessLabel("stale")).toBe("Likely stale");
    expect(freshnessLabel("aging")).toBe("Aging");
    expect(freshnessLabel("fresh")).toBeNull();
    expect(freshnessLabel("unknown")).toBeNull();
  });
});

describe("postingUrlKey", () => {
  it("is a 32-hex md5 of the trimmed URL, so two spellings of one URL share a row", () => {
    const key = postingUrlKey("https://boards.example/jobs/1");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(postingUrlKey("  https://boards.example/jobs/1 \n")).toBe(key);
    expect(postingUrlKey("https://boards.example/jobs/2")).not.toBe(key);
  });
});

describe("toSighting", () => {
  it("maps a ledger row column for column, defaulting counts to zero", () => {
    expect(toSighting({
      first_seen_at: "2026-08-01T00:00:00+00:00",
      last_seen_at: "2026-09-01T00:00:00+00:00",
      times_seen: "7",
      earliest_posted_on: "2026-07-30",
      latest_posted_on: null,
      reposts: null,
      closes_on: "2026-09-30",
    })).toEqual({
      firstSeenAt: "2026-08-01T00:00:00+00:00",
      lastSeenAt: "2026-09-01T00:00:00+00:00",
      timesSeen: 7,
      earliestPostedOn: "2026-07-30",
      latestPostedOn: null,
      reposts: 0,
      closesOn: "2026-09-30",
    });
  });
});
