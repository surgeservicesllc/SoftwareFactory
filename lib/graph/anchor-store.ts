import "server-only";

import type { Anchor, AnchoredClaim } from "@/lib/graph/anchors";

/**
 * Durable evidence for the graph engine.
 *
 * `lib/graph/anchors.ts` is a pure model of what counts as evidence, which is
 * what makes it testable — and also what made it insufficient on its own. A
 * claim checked in memory and then discarded leaves the next reader no way to
 * see what it rested on, and a run's report ends up asserting "the tests pass"
 * with the observation that justified it already gone.
 *
 * This module is the missing half. Two things about it are deliberate:
 *
 * - **It does not decide.** `recordClaimAnchoring` sends anchor IDs and reads
 *   back the database's verdict. The acceptable-kind mapping and the
 *   passed/failed logic live in SQL because that is the security boundary: a
 *   caller able to declare what counts as evidence could anchor anything with
 *   anything. The duplication with `anchors.ts` is paid for by a drift test.
 *
 * - **A write failure is loud.** A lost observation is worse than a missing one,
 *   because the claim it would have refuted stays on the record looking
 *   supported. Reads fail soft; writes throw.
 */

/**
 * The narrow slice of the Supabase client this module uses.
 *
 * Named explicitly rather than structurally matching the generated client,
 * which makes the inferred union deep enough that TypeScript gives up.
 */
export interface SupabaseLike {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type StoredClaim = {
  readonly claimId: string;
  readonly anchored: boolean;
  readonly reason: string;
};

/**
 * Store one observation.
 *
 * `observedAt` is when the world was seen, not when this ran. Freshness is
 * judged against it, so passing "now" for a CI result observed an hour ago
 * would quietly make stale evidence look current.
 */
export async function recordAnchor(
  client: SupabaseLike,
  input: {
    readonly graphRunId: string;
    readonly anchor: Anchor;
    readonly nodeRunId?: string | null;
  },
): Promise<string> {
  const { data, error } = await client.rpc("record_anchor", {
    p_graph_run_id: input.graphRunId,
    p_kind: input.anchor.kind,
    p_source: input.anchor.source,
    p_observed_at: input.anchor.observedAt,
    p_detail: input.anchor.detail,
    p_passed: input.anchor.passed,
    p_reference: input.anchor.reference,
    p_node_run_id: input.nodeRunId ?? null,
  });

  if (error) {
    // Hard failure on purpose: a dropped observation makes a graph look better
    // evidenced than it is.
    throw new Error(`Failed to record ${input.anchor.kind} anchor: ${error.message}`);
  }

  return String(data);
}

/**
 * Ask the database whether a claim is supported, and record its answer.
 *
 * The return value is the database's verdict, not the caller's. A caller that
 * wanted to know in advance should use `checkClaimAnchored`, which applies the
 * same rules in memory — but only this result is durable, and only this one is
 * authoritative.
 */
export async function recordClaimAnchoring(
  client: SupabaseLike,
  input: {
    readonly nodeRunId: string;
    readonly claim: AnchoredClaim;
    readonly anchorIds: readonly string[];
  },
): Promise<StoredClaim> {
  const { data, error } = await client.rpc("record_claim_anchoring", {
    p_node_run_id: input.nodeRunId,
    p_claim: input.claim,
    p_anchor_ids: [...input.anchorIds],
  });

  if (error) {
    throw new Error(`Failed to record anchoring for ${input.claim}: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error(`record_claim_anchoring returned no verdict for ${input.claim}.`);
  }

  const record = row as { claim_id?: unknown; anchored?: unknown; reason?: unknown };
  return {
    claimId: String(record.claim_id ?? ""),
    // Defaulting to false rather than true: an unreadable verdict must not read
    // as support.
    anchored: record.anchored === true,
    reason: typeof record.reason === "string" ? record.reason : "No reason recorded.",
  };
}

/**
 * Record several observations and then ask about a claim, in one call.
 *
 * The common shape: a node finishes, its validation and CI results become
 * anchors, and the claim it wants to make is checked against them.
 */
export async function anchorClaim(
  client: SupabaseLike,
  input: {
    readonly graphRunId: string;
    readonly nodeRunId: string;
    readonly claim: AnchoredClaim;
    readonly anchors: readonly Anchor[];
  },
): Promise<StoredClaim> {
  const anchorIds: string[] = [];
  for (const anchor of input.anchors) {
    anchorIds.push(
      await recordAnchor(client, {
        graphRunId: input.graphRunId,
        anchor,
        nodeRunId: input.nodeRunId,
      }),
    );
  }

  // Every observation is stored, including the contradicting ones. The database
  // links only the supporting ones to the claim, but the refuting evidence has
  // to survive — it is the reason the claim failed.
  return recordClaimAnchoring(client, {
    nodeRunId: input.nodeRunId,
    claim: input.claim,
    anchorIds,
  });
}
