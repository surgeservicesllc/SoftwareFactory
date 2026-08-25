import { describe, expect, it } from "vitest";

import { shortRunId } from "@/lib/graph/run-label";

describe("shortRunId", () => {
  const runId = "050b35e5-9eb6-4527-a10c-6a87b20f70a9";

  it("names a run the way the AI Factory breadcrumb names it", () => {
    expect(shortRunId(runId)).toBe("050b35e5");
  });

  it("gives the same label whether or not the list's analysis prefix is present", () => {
    // The whole point: one run, one name, on both surfaces.
    expect(shortRunId(`analysis:${runId}`)).toBe(shortRunId(runId));
  });

  it("returns what it has when an id is shorter than the label", () => {
    expect(shortRunId("abc")).toBe("abc");
    expect(shortRunId("")).toBe("");
  });
});
