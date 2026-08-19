// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import { executeDeterministicNode } from "@/lib/worker/deterministic-node-executor";

/**
 * The reduce that never invents and never quietly drops: duplicates fold to
 * the earliest evidence, severity orders the result, and everything the
 * reduction could not use — malformed rows, unreducible inputs, inputs that
 * never arrived — is stated in the output rather than vanished.
 */

const node = {
  nodeKey: "reduce",
  capability: "extraction",
  executor: "DETERMINISTIC",
} as unknown as CompiledNode;

function finding(title: string, severity: string, location = "", evidence = "") {
  return { title, severity, location, evidence };
}

describe("executeDeterministicNode", () => {
  it("dedupes across inspectors and ranks by severity", () => {
    const result = executeDeterministicNode(node, {
      outputs: {
        inspect_a: { findings: [finding("Missing auth", "HIGH", "api.ts"), finding("Slow query", "LOW", "db.ts")] },
        inspect_b: { findings: [finding("missing  AUTH", "HIGH", "api.ts"), finding("No rollback", "CRITICAL", "deploy.ts")] },
      },
      missing: [],
    });

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    const output = result.output as {
      findings: Array<{ title: string; source: string }>;
      stats: { inputCount: number; outputCount: number };
      sources: string[];
    };
    // The duplicate folded to the FIRST occurrence — inspect_a's evidence.
    expect(output.stats).toMatchObject({ inputCount: 4, outputCount: 3 });
    expect(output.findings.map((f) => f.title)).toEqual(["No rollback", "Missing auth", "Slow query"]);
    expect(output.findings[1].source).toBe("inspect_a");
    expect(output.sources).toEqual(["inspect_a", "inspect_b"]);
    expect(result.provider).toBe("deterministic");
  });

  it("counts malformed rows and names unreducible inputs instead of hiding them", () => {
    const result = executeDeterministicNode(node, {
      outputs: {
        inspect_a: { findings: [finding("Real", "MEDIUM"), { note: "no title or severity" }] },
        inspect_b: { text: "I could not produce structured findings." },
      },
      missing: ["inspect_c"],
    });

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({
      unusable_rows: 1,
      unusable_inputs: ["inspect_b"],
      missing_inputs: ["inspect_c"],
    });
  });

  it("fails plainly, without retry, when nothing is reducible", () => {
    const result = executeDeterministicNode(node, {
      outputs: { upstream: { text: "prose only" } },
      missing: [],
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("no reducible inputs");
  });
});
