// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyRadius,
  foldPlaceName,
  haversineKm,
  resolvePlace,
} from "@/lib/job-seeker/board-search/geo";
import type { UnifiedHit } from "@/lib/job-seeker/board-search/unify";

/**
 * The radius filter's honesty depends on three things: the fold matching
 * the dataset build exactly, resolution behaving predictably on real
 * inputs (native names, exonyms, comma-suffixed strings), and the keep
 * rules — remote kept, unresolvable kept, only the provably-far dropped.
 */

function hit(location: string | null, workModel: "remote" | "hybrid" | "onsite" | null): UnifiedHit {
  return {
    job: {
      externalId: "x",
      url: "https://example.com/j",
      title: "Marketer",
      company: "Acme",
      salaryText: null,
      location,
      workModel,
      description: null,
    },
    publishedOn: null,
    closesOn: null,
    sources: [],
    primarySourceIndex: 0,
  } as unknown as UnifiedHit;
}

describe("foldPlaceName", () => {
  it("folds case, diacritics, Nordic letters and punctuation the way the dataset build does", () => {
    expect(foldPlaceName("København")).toBe("kobenhavn");
    expect(foldPlaceName("Århus C")).toBe("arhus c");
    expect(foldPlaceName("  München / Bayern ")).toBe("munchen bayern");
    expect(foldPlaceName("Zürich")).toBe("zurich");
    expect(foldPlaceName("Łódź")).toBe("lodz");
  });
});

describe("resolvePlace", () => {
  it("resolves English names, native names and abbreviations from the index", () => {
    expect(resolvePlace("Copenhagen")?.country).toBe("DK");
    expect(resolvePlace("København")?.country).toBe("DK");
    expect(resolvePlace("München")?.country).toBe("DE");
    expect(resolvePlace("NYC")?.country).toBe("US");
  });

  it("falls back to comma segments, so 'City, Country' strings resolve", () => {
    expect(resolvePlace("Copenhagen, Denmark")?.name).toBe("Copenhagen");
    expect(resolvePlace("Malmö, Sweden")?.country).toBe("SE");
  });

  it("answers null for what the index does not know, never a guess", () => {
    expect(resolvePlace("Anywhere in the World")).toBeNull();
    expect(resolvePlace("EU only")).toBeNull();
    expect(resolvePlace("")).toBeNull();
  });
});

describe("haversineKm", () => {
  it("measures a known pair within tolerance", () => {
    const copenhagen = { lat: 55.6759, lng: 12.5655 };
    const malmo = { lat: 55.6059, lng: 13.0007 };
    const km = haversineKm(copenhagen, malmo);
    expect(km).toBeGreaterThan(20);
    expect(km).toBeLessThan(35);
    expect(haversineKm(copenhagen, copenhagen)).toBe(0);
  });
});

describe("applyRadius", () => {
  const copenhagen = resolvePlace("Copenhagen")!;

  it("keeps the near, drops the provably far, and never drops the unknown", () => {
    const hits = [
      hit("Malmö", "onsite"), // ~28 km away: inside 50, outside 10
      hit("Berlin", "hybrid"), // ~355 km away: outside both
      hit("Remote", "remote"), // no distance: always kept
      hit("Three offices worldwide", "onsite"), // unresolvable: kept, counted
      hit(null, null), // no place at all: kept, counted
    ];

    const wide = applyRadius(hits, copenhagen, 50);
    expect(wide.hits).toHaveLength(4);
    expect(wide.excluded).toBe(1);
    expect(wide.remoteKept).toBe(1);
    expect(wide.unresolvedKept).toBe(2);

    const tight = applyRadius(hits, copenhagen, 10);
    expect(tight.hits).toHaveLength(3);
    expect(tight.excluded).toBe(2);
  });
});
