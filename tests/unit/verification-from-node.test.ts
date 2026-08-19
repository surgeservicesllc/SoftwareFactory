// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import { deriveVerdict, verificationLensFor } from "@/lib/worker/verification-from-node";

const node = (capability: string) => ({ capability }) as unknown as CompiledNode;

describe("verificationLensFor", () => {
  it("names the lens for capabilities whose job is judging other work", () => {
    expect(verificationLensFor(node("review"))).toBe("correctness");
    expect(verificationLensFor(node("security_review"))).toBe("security");
    expect(verificationLensFor(node("qa"))).toBe("acceptance_criteria");
  });

  it("gives no lens to capabilities that produce rather than judge", () => {
    // An extraction or synthesis node makes work; it does not review it, and
    // recording its output as a verdict would invent a review nobody did.
    expect(verificationLensFor(node("extraction"))).toBeNull();
    expect(verificationLensFor(node("synthesis"))).toBeNull();
    expect(verificationLensFor(node("implementation"))).toBeNull();
  });
});

describe("deriveVerdict", () => {
  it("treats a blocked reviewer as BLOCK, carrying its stated reason", () => {
    const derived = deriveVerdict({ blocked: true, blocked_reason: "The diff was unreadable." });
    expect(derived).toEqual({ verdict: "BLOCK", evidence: ["The diff was unreadable."] });
  });

  it("rejects on a high or critical finding and cites it", () => {
    const derived = deriveVerdict({
      blocked: false,
      findings: [
        { title: "Unbounded query", severity: "high" },
        { title: "Stale comment", severity: "low" },
      ],
    });
    expect(derived?.verdict).toBe("REJECT");
    expect(derived?.evidence).toEqual(["high: Unbounded query", "low: Stale comment"]);
  });

  it("warns when findings exist but none are severe", () => {
    expect(deriveVerdict({ findings: [{ title: "Naming", severity: "low" }] })?.verdict).toBe("WARN");
  });

  it("passes only on an explicit empty finding set", () => {
    expect(deriveVerdict({ findings: [] })).toEqual({
      verdict: "PASS",
      evidence: ["The reviewer reported no findings."],
    });
  });

  it("declines to guess when the output cannot be read", () => {
    // Absence of evidence is not evidence of passing. A fabricated PASS is
    // the worst row this table could hold, so unreadable output yields none.
    expect(deriveVerdict({ text: "I looked at it and it seemed fine" })).toBeNull();
    expect(deriveVerdict("prose")).toBeNull();
    expect(deriveVerdict(null)).toBeNull();
  });
});
