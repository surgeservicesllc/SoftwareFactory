import { describe, expect, it } from "vitest";

import { describeDrainOutcome } from "@/lib/graph/drain-report";
import { describeClaimOutcome } from "@/lib/worker/drain-report";

describe("a one-shot worker states what it did", () => {
  it("says nothing was claimable rather than leaving the log silent", () => {
    // The defect this replaces: the codex worker's log ended at "is ready",
    // so a green job that executed a run read identically to a green job that
    // found none.
    expect(describeClaimOutcome(0)).toContain("No claimable run");
    expect(describeDrainOutcome(0)).toContain("No planned graph");
  });

  it("counts what it took, and does not claim the work succeeded", () => {
    // A claimed run that failed is still finished by this worker. Reporting it
    // as a success here would contradict the run record.
    expect(describeClaimOutcome(1)).toContain("1 durable run");
    expect(describeClaimOutcome(1)).not.toMatch(/succe/i);
    expect(describeClaimOutcome(3)).toContain("3 durable runs");
  });

  it("pluralises the graph count", () => {
    expect(describeDrainOutcome(1)).toContain("1 graph;");
    expect(describeDrainOutcome(4)).toContain("4 graphs;");
  });
});
