import { NODE_CAPABILITIES, type NodeCapability } from "@/lib/graph/contracts";

function isNodeCapability(token: string): token is NodeCapability {
  return (NODE_CAPABILITIES as readonly string[]).includes(token);
}

export const GROK_CAPABILITY_ALIASES: Readonly<Record<string, readonly NodeCapability[]>> =
  Object.freeze({
    planning: ["planning"], architecture: ["architecture"], implementation: ["implementation"],
    coding: ["implementation"], api: ["implementation"], backend: ["implementation"],
    frontend: ["implementation"], ui: ["implementation"], migrations: ["implementation"],
    extraction: ["extraction"], review: ["review"], audit: ["review"],
    "security-review": ["security_review"], security: ["security_review"],
    authorization: ["security_review"], secrets: ["security_review"],
    qa: ["qa"], testing: ["qa"], tests: ["qa"], validation: ["qa"],
    regression: ["qa"], coverage: ["qa"], synthesis: ["synthesis"],
    summarization: ["synthesis"], reporting: ["reporting"], discovery: ["discovery"],
    research: ["discovery"], evaluation: ["evaluation"], decision: ["decision"],
  });

/**
 * Convert role vocabulary into the one canonical capability set admitted by
 * Grok. `*` is an explicit generalist declaration: it expands to the complete
 * fixed engine vocabulary and is never persisted as a magic wildcard.
 */
export function normalizeGrokCapabilities(
  declaredCapabilities: readonly string[],
): readonly NodeCapability[] {
  const normalized = new Set<NodeCapability>();
  for (const declared of declaredCapabilities) {
    const token = declared.trim().toLowerCase();
    if (token === "*") {
      for (const capability of NODE_CAPABILITIES) normalized.add(capability);
      continue;
    }
    // A canonical name is always its own alias, so normalizing an already
    // normalized list is the identity. The roster normalizes a role once and
    // the planner normalizes the roster again; `security_review` is the one
    // canonical name the alias table does not spell, and before this line the
    // second pass dropped it and every intent was refused for want of a
    // security reviewer.
    if (isNodeCapability(token)) {
      normalized.add(token);
      continue;
    }
    for (const capability of GROK_CAPABILITY_ALIASES[token] ?? []) {
      normalized.add(capability);
    }
  }
  return Object.freeze([...normalized].sort());
}
