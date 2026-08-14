// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { anchorClaim, recordAnchor, recordClaimAnchoring, type SupabaseLike } from "@/lib/graph/anchor-store";
import type { Anchor } from "@/lib/graph/anchors";

function anchor(overrides: Partial<Anchor> = {}): Anchor {
  return {
    kind: "test_run",
    source: "vitest in node:22",
    observedAt: "2026-08-14T12:00:00.000Z",
    passed: true,
    reference: null,
    detail: "tests passed",
    ...overrides,
  };
}

function client(
  responses: Record<string, { data: unknown; error: { message: string } | null }>,
): SupabaseLike & { calls: { name: string; params: Record<string, unknown> }[] } {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return responses[name] ?? { data: null, error: { message: `no stub for ${name}` } };
    }),
  };
}

describe("recording an anchor", () => {
  it("sends the observation time rather than the time of recording", async () => {
    const db = client({ record_anchor: { data: "anchor-1", error: null } });

    await recordAnchor(db, { graphRunId: "run-1", anchor: anchor(), nodeRunId: "node-run-1" });

    // Freshness is judged against when the world was seen. Sending "now" would
    // quietly make an hour-old CI result look current.
    expect(db.calls[0].params.p_observed_at).toBe("2026-08-14T12:00:00.000Z");
    expect(db.calls[0].params.p_node_run_id).toBe("node-run-1");
  });

  it("preserves a state-only observation as null rather than false", async () => {
    const db = client({ record_anchor: { data: "anchor-1", error: null } });

    await recordAnchor(db, {
      graphRunId: "run-1",
      anchor: anchor({ kind: "http_health", passed: null }),
    });

    // Coercing null to false would turn "unknown" into "failed".
    expect(db.calls[0].params.p_passed).toBeNull();
  });

  it("throws rather than swallowing a failed write", async () => {
    const db = client({ record_anchor: { data: null, error: { message: "not_a_member" } } });

    // A dropped observation makes a graph look better evidenced than it is.
    await expect(
      recordAnchor(db, { graphRunId: "run-1", anchor: anchor() }),
    ).rejects.toThrow(/not_a_member/);
  });
});

describe("recording a claim's anchoring", () => {
  it("returns the database's verdict, not the caller's hope", async () => {
    const db = client({
      record_claim_anchoring: {
        data: [{ claim_id: "claim-1", anchored: false, reason: "contradicts the claim" }],
        error: null,
      },
    });

    const result = await recordClaimAnchoring(db, {
      nodeRunId: "node-run-1",
      claim: "TESTS_PASS",
      anchorIds: ["anchor-1"],
    });

    expect(result.anchored).toBe(false);
    expect(result.reason).toContain("contradicts");
  });

  it("treats an unreadable verdict as unanchored", async () => {
    const db = client({
      record_claim_anchoring: { data: [{ claim_id: "claim-1" }], error: null },
    });

    const result = await recordClaimAnchoring(db, {
      nodeRunId: "node-run-1",
      claim: "TESTS_PASS",
      anchorIds: [],
    });

    // An absent answer must never read as support.
    expect(result.anchored).toBe(false);
  });

  it("throws when no verdict comes back at all", async () => {
    const db = client({ record_claim_anchoring: { data: [], error: null } });

    await expect(
      recordClaimAnchoring(db, { nodeRunId: "n", claim: "BUILD_SUCCEEDS", anchorIds: [] }),
    ).rejects.toThrow(/no verdict/);
  });
});

describe("anchoring a claim end to end", () => {
  it("stores every observation, including the ones that refute the claim", async () => {
    let issued = 0;
    const db = client({
      record_anchor: { data: "anchor", error: null },
      record_claim_anchoring: {
        data: [{ claim_id: "claim-1", anchored: false, reason: "contradicts the claim" }],
        error: null,
      },
    });
    db.rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      db.calls.push({ name, params });
      if (name === "record_anchor") return { data: `anchor-${(issued += 1)}`, error: null };
      return {
        data: [{ claim_id: "claim-1", anchored: false, reason: "contradicts the claim" }],
        error: null,
      };
    });

    const result = await anchorClaim(db, {
      graphRunId: "run-1",
      nodeRunId: "node-run-1",
      claim: "TESTS_PASS",
      anchors: [anchor(), anchor({ passed: false, source: "CI", kind: "ci_check" })],
    });

    const anchorCalls = db.calls.filter((call) => call.name === "record_anchor");
    // The failing observation is stored too: it is the reason the claim failed,
    // and dropping it would leave the refusal unexplained.
    expect(anchorCalls).toHaveLength(2);

    const anchoringCall = db.calls.find((call) => call.name === "record_claim_anchoring")!;
    expect(anchoringCall.params.p_anchor_ids).toEqual(["anchor-1", "anchor-2"]);
    expect(result.anchored).toBe(false);
  });
});
