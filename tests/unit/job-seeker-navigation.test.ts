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
    expect(JOB_SEEKER_NAVIGATION[0]?.subpages?.map((entry) => entry.label)).toEqual([
      "Career Profile",
      "Job Preferences",
      "Job Discovery",
      "Applications",
      "Follow-Up",
    ]);
  });

  it("names every destination in the owner's design", () => {
    expect(JOB_SEEKER_NAVIGATION.map((entry) => entry.label)).toEqual([
      "Overview",
      "Job Search",
      "Applications",
      "Resume Library",
      "Cover Letters",
      "Contacts & Outreach",
      "Interview Tracker",
      "Notes & Documents",
      "Skills & Improve",
      "Analytics",
      "Settings",
    ]);
  });

  it("claims the Job Seeker subtree and nothing that merely looks like it", () => {
    expect(isJobSeekerPath("/job-seeker")).toBe(true);
    expect(isJobSeekerPath("/job-seeker/resumes")).toBe(true);
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
