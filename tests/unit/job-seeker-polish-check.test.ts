import { describe, expect, it } from "vitest";

import { checkPolish, describeCheck } from "@/lib/job-seeker/polish-check";

/**
 * The non-fabrication check (ADR-248): rewording passes, adding fails,
 * and every addition is named with its kind.
 */

const BASELINE = [
  "Dana Reyes",
  "dana@example.com · Austin, TX",
  "SUMMARY",
  "Platform engineer with 8 years running Kubernetes and PostgreSQL.",
  "EXPERIENCE",
  "Staff Engineer — Acme (2019 – present)",
  "• Ran Kubernetes for 40 services.",
].join("\n");

describe("checkPolish", () => {
  it("passes a rewording that keeps every fact", () => {
    const polished = [
      "Dana Reyes",
      "dana@example.com · Austin, TX",
      "SUMMARY",
      "A platform engineer with 8 years of Kubernetes and PostgreSQL operations.",
      "EXPERIENCE",
      "Staff Engineer — Acme (2019 – present)",
      "• Operated Kubernetes across 40 services.",
    ].join("\n");
    const check = checkPolish(polished, BASELINE, ["Kubernetes", "PostgreSQL"]);
    expect(check.passed).toBe(true);
    expect(check.violations).toEqual([]);
    expect(check.verified.terms).toBe(2);
    expect(check.verified.numbers).toBeGreaterThanOrEqual(3);
    expect(describeCheck(check)).toMatch(/verified against the fact-only baseline; nothing added\.$/);
  });

  it("fails on an added skill, an added number and an added name, naming each", () => {
    const polished = [
      "Dana Reyes",
      "SUMMARY",
      "Platform engineer with 12 years running Kubernetes, Terraform and PostgreSQL at Google scale.",
      "EXPERIENCE",
      "Staff Engineer — Acme (2019 – present)",
    ].join("\n");
    const check = checkPolish(polished, BASELINE, ["Kubernetes", "PostgreSQL"]);
    expect(check.passed).toBe(false);
    expect(check.violations).toEqual(expect.arrayContaining([
      { kind: "term", value: "Terraform" },
      { kind: "number", value: "12" },
      { kind: "name", value: "Google" },
    ]));
    expect(check.violations.map((violation) => violation.value)).not.toContain("Kubernetes");
    expect(check.violations.map((violation) => violation.value)).not.toContain("Acme");
    expect(describeCheck(check)).toContain("Terraform (term)");
    expect(describeCheck(check)).toContain("12 (number)");
    expect(describeCheck(check)).toContain("Google (name)");
  });

  it("accepts a profile term the baseline happened not to print, and does not flag sentence-initial words", () => {
    const polished = "Dana Reyes\nSUMMARY\nSeasoned engineer. Docker underpins the platform work at Acme.";
    const check = checkPolish(polished, BASELINE, ["Docker"]);
    expect(check.passed).toBe(true);
    // "Seasoned" and "Docker" open their sentences; "Reyes" and "Acme" mid-sentence are in the baseline.
    expect(check.verified.names).toBe(2);
  });

  it("treats a thousands separator as the same number", () => {
    const check = checkPolish("Served 1,200 customers.", "Served 1200 customers.");
    expect(check.passed).toBe(true);
  });
});
