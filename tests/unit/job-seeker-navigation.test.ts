import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isJobSeekerPath, JOB_SEEKER_NAVIGATION } from "@/lib/job-seeker/navigation";

/**
 * A navigation entry that leads nowhere is worse than an absent one: it
 * promises a destination and spends a click proving there isn't one. So every
 * href here is checked against the file that would serve it.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

function pageFileFor(href: string): string {
  const segment = href === "/job-seeker" ? "" : href.slice("/job-seeker".length);
  return resolve(repositoryRoot, `app/(portal)/job-seeker${segment}/page.tsx`);
}

describe("the Job Seeker navigation", () => {
  const entries = JOB_SEEKER_NAVIGATION.flatMap((entry) => [entry, ...(entry.subpages ?? [])]);

  it("leads every entry to a page that exists", () => {
    const missing = entries
      .filter((entry) => !existsSync(pageFileFor(entry.href)))
      .map((entry) => `${entry.label} → ${entry.href}`);
    expect(missing).toEqual([]);
  });

  it("starts at Overview, which is where /job-seeker lands", () => {
    expect(JOB_SEEKER_NAVIGATION[0]?.label).toBe("Overview");
    expect(JOB_SEEKER_NAVIGATION[0]?.href).toBe("/job-seeker");
  });

  it("carries the sections the design groups under Overview", () => {
    /*
     * Search and Follow-Up are not among the design's twelve top-level
     * destinations but are working pages, so this group is what keeps them
     * reachable. Everything else here is also a top-level entry, which is what
     * makes the group a table of contents rather than a second menu.
     */
    expect(JOB_SEEKER_NAVIGATION[0]?.subpages?.map((entry) => entry.label)).toEqual([
      "Search",
      "Job Discovery",
      "Applications",
      "Follow-Up",
      "Career Profile",
      "Job Preferences",
    ]);
  });

  it("names every destination in the owner's design", () => {
    /*
     * The owner's Job Discovery reference, top to bottom. Career Profile and
     * Job Preferences are top-level destinations, not only children of
     * Overview: a person configuring their search should not have to know they
     * live under a heading. Search is deliberately absent here and reachable
     * under Overview instead — the design does not show it, and dropping it
     * entirely would orphan a working page.
     */
    expect(JOB_SEEKER_NAVIGATION.map((entry) => entry.label)).toEqual([
      "Overview",
      "Job Discovery",
      "Applications",
      "Resume Library",
      "Cover Letters",
      // Beyond the design: the application kit (ADR-244), the one
      // destination every ATS form needs and no other page holds.
      "Application Kit",
      "Interview Tracker",
      "Contacts & Outreach",
      "Notes & Documents",
      "Analytics",
      "Career Profile",
      "Job Preferences",
      "Settings",
    ]);
  });

  it("claims the Job Seeker subtree and nothing that merely looks like it", () => {
    expect(isJobSeekerPath("/job-seeker")).toBe(true);
    expect(isJobSeekerPath("/job-seeker/resumes")).toBe(true);
    expect(isJobSeekerPath("/JobSearch")).toBe(true);
    expect(isJobSeekerPath("/Job-Search")).toBe(true);
    // A future `/job-seekers` route must not silently inherit this navigation.
    expect(isJobSeekerPath("/job-seekers")).toBe(false);
    expect(isJobSeekerPath("/solutions/ai-factory")).toBe(false);
    expect(isJobSeekerPath(null)).toBe(false);
  });

  it("points every href inside the section it belongs to", () => {
    const stray = entries.filter((entry) => !isJobSeekerPath(entry.href));
    expect(stray).toEqual([]);
  });
});
