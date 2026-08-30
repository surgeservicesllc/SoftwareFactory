// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  SOURCE_CATALOGUE,
  catalogueSource,
  liveCatalogueSources,
} from "@/lib/job-seeker/board-search/catalogue";
import { BOARD_SEARCH_ADAPTERS, boardSearchAdapter } from "@/lib/job-seeker/board-search/registry";

/**
 * The catalogue is a set of claims about what this product does with each
 * source. These cases hold the claims to their definitions, so the file
 * cannot drift into advertising a connection the registry does not have —
 * or hiding one it does.
 */

describe("the source catalogue", () => {
  it("carries at least the researched fifty: 25+ general and 25 marketing", () => {
    // The goal's floor is 25 general + 25 marketing; live additions may grow
    // the general list past it (2026-08-29: The Muse, Working Nomads and
    // Jobspresso joined as live; 2026-08-30: the JSearch aggregator row —
    // the credentialed door for inline LinkedIn/Indeed — took general to 28
    // of 53).
    expect(SOURCE_CATALOGUE).toHaveLength(53);
    expect(SOURCE_CATALOGUE.filter((s) => s.focus === "general")).toHaveLength(28);
    expect(SOURCE_CATALOGUE.filter((s) => s.focus === "marketing")).toHaveLength(25);
  });

  it("gives every source a unique, slug-shaped key", () => {
    const keys = SOURCE_CATALOGUE.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      // The same shape job_seeker_jobs.source enforces, so a live source's
      // key can be stored as attribution without translation.
      expect(key).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
  });

  it("claims live only for sources the registry genuinely serves", () => {
    const live = SOURCE_CATALOGUE.filter((s) => s.status === "live");
    for (const source of live) {
      expect(source.adapterKey, `${source.key} claims live without an adapter`).toBeDefined();
      expect(
        boardSearchAdapter(source.adapterKey ?? ""),
        `${source.key} names adapter ${source.adapterKey}, which the registry does not have`,
      ).not.toBeNull();
      // A live row's key IS its adapter key, so saving attributes correctly.
      expect(source.key).toBe(source.adapterKey);
    }
    expect(liveCatalogueSources()).toHaveLength(live.length);
  });

  it("lists every registry adapter exactly once, so no connection goes unadvertised", () => {
    const liveKeys = SOURCE_CATALOGUE.filter((s) => s.status === "live").map((s) => s.adapterKey);
    const registryKeys = BOARD_SEARCH_ADAPTERS.map((a) => a.key);
    expect([...liveKeys].sort()).toEqual([...registryKeys].sort());
  });

  it("keeps non-live sources honest about what they are", () => {
    for (const source of SOURCE_CATALOGUE) {
      expect(source.note.length, `${source.key} has no note`).toBeGreaterThan(20);
      if (source.status !== "live") {
        expect(source.adapterKey, `${source.key} is not live but names an adapter`).toBeUndefined();
      }
      if (source.status === "external_link" || source.status === "needs_credentials") {
        expect(source.searchUrl, `${source.key} has no link to open`).toMatch(/^https:\/\//);
      }
      if (source.searchUrl !== undefined) {
        // Templates may interpolate only the two documented placeholders.
        const placeholders = source.searchUrl.match(/\{[^}]*\}/g) ?? [];
        for (const p of placeholders) {
          expect(["{query}", "{location}"]).toContain(p);
        }
      }
    }
  });

  it("looks sources up by key", () => {
    expect(catalogueSource("remotive")?.status).toBe("live");
    expect(catalogueSource("linkedin_jobs")?.status).toBe("external_link");
    expect(catalogueSource("nonexistent")).toBeNull();
  });
});
