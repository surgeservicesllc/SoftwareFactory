// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import { artifactKindForNode, repositoryMismatch } from "@/lib/worker/graph-run";

/**
 * An artifact's kind is the difference between evidence and a view built on
 * it. Storing every output as RAW would leave a reviewer unable to tell an
 * inspector's findings from the reduction that folded them.
 */
const node = (executor: string, capability: string) =>
  ({ executor, capability }) as unknown as CompiledNode;

describe("artifactKindForNode", () => {
  it("separates evidence, reduction, and synthesis by what the node declares", () => {
    expect(artifactKindForNode(node("MODEL", "extraction"))).toBe("RAW");
    expect(artifactKindForNode(node("MODEL", "review"))).toBe("RAW");
    expect(artifactKindForNode(node("DETERMINISTIC", "extraction"))).toBe("REDUCED");
    expect(artifactKindForNode(node("MODEL", "synthesis"))).toBe("SYNTHESIS");
    expect(artifactKindForNode(node("MODEL", "reporting"))).toBe("SYNTHESIS");
  });

  it("labels anchor evidence as measured, whatever it was asked to do", () => {
    expect(artifactKindForNode(node("ANCHOR", "qa"))).toBe("ANCHOR");
    // The anchor rule wins: a measured result is not a synthesis.
    expect(artifactKindForNode(node("ANCHOR", "synthesis"))).toBe("ANCHOR");
  });
});

describe("repositoryMismatch", () => {
  it("refuses a graph whose project is bound to another repository", () => {
    const detail = repositoryMismatch("acme/other", "surgeservicesllc/SoftwareFactory");
    expect(detail).toContain("bound to acme/other");
    expect(detail).toContain("checked out on surgeservicesllc/SoftwareFactory");
  });

  it("accepts the same repository regardless of case", () => {
    expect(repositoryMismatch("SurgeServicesLLC/SoftwareFactory", "surgeservicesllc/softwarefactory")).toBeNull();
  });

  it("has nothing to contradict when either side is unknown", () => {
    // A project with no repository linked, and a worker that cannot name its
    // own checkout, are both silence — not evidence of a mismatch.
    expect(repositoryMismatch(null, "surgeservicesllc/SoftwareFactory")).toBeNull();
    expect(repositoryMismatch("acme/other", undefined)).toBeNull();
    expect(repositoryMismatch("  ", "  ")).toBeNull();
  });
});
