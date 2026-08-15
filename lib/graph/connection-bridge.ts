import "server-only";

import { evaluateConnectionIdentity } from "@/lib/connections/routable-candidates";
import type { RoutingResult } from "@/lib/connections/identity-router";
import type { CompiledNode } from "@/lib/graph/compiler";

/**
 * The bridge between a graph node and the Phase 2D Identity Router.
 *
 * `provider-bridge.ts` answers "which provider and task kind" for a node and
 * is deliberately pure. This module answers the separate question 2D exists
 * to ask — "which connection identity" — and is deliberately impure, because
 * the answer lives in the connection registry. Keeping them apart preserves
 * the provider bridge's no-client property and mirrors the factory-wide rule
 * that provider selection and identity selection are different decisions.
 *
 * Only a MODEL node has a connection identity to resolve: its execution is a
 * provider call on some account's budget (`inference.advisory`). A
 * DETERMINISTIC or ANCHOR node never reaches the registry at all — asking for
 * an identity for one is a caller bug, reported as such rather than answered
 * with a guess, exactly like `assertNodeMayCallProvider` on the provider side.
 */

type TenantClient = Parameters<typeof evaluateConnectionIdentity>[0];

export type NodeConnectionIdentity =
  | { readonly mode: "not_applicable"; readonly reason: string }
  | { readonly mode: "error"; readonly reason: string }
  | { readonly mode: "legacy"; readonly reason: string }
  | { readonly mode: "routed"; readonly result: RoutingResult };

export async function connectionIdentityForNode(
  client: TenantClient,
  projectId: string,
  node: Pick<CompiledNode, "executor" | "nodeKey">,
): Promise<NodeConnectionIdentity> {
  if (node.executor !== "MODEL") {
    return {
      mode: "not_applicable",
      reason: `Node ${node.nodeKey} is ${node.executor} and has no provider connection identity to resolve.`,
    };
  }

  const identity = await evaluateConnectionIdentity(client, projectId, "inference.advisory");
  if (identity.mode === "error") {
    return { mode: "error", reason: identity.message };
  }
  if (identity.mode === "legacy") {
    return { mode: "legacy", reason: identity.reason };
  }
  return { mode: "routed", result: identity.result };
}
