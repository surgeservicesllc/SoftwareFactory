import type { CompiledNode } from "@/lib/graph/compiler";
import { dedupeBy, normalizeKey, rankSeverity, sortByRank } from "@/lib/graph/reducers";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import type { NodeInputs } from "@/lib/worker/graph-run";

/**
 * The worker's DETERMINISTIC executor.
 *
 * Deduplicating, ranking, and merging findings is work code does perfectly,
 * repeatably, and for free — handing it to a model costs a subscription turn
 * and introduces the one failure code does not have: quietly inventing or
 * dropping a row. Until now the worker sent every node to the CLI, model
 * tier NONE included; this routes a reduce node through the engine's own
 * reducers instead.
 *
 * Scope honesty: the analysis worker wires deterministic execution for
 * finding reduction only. A DETERMINISTIC node whose inputs carry no
 * findings arrays fails with the reason — deterministically, so no retry —
 * rather than being quietly handed to a model.
 */

type UpstreamFinding = Readonly<Record<string, unknown>> & {
  readonly title: string;
  readonly severity: string;
};

function usableFindings(output: unknown): { findings: UpstreamFinding[]; unusable: number } | null {
  if (typeof output !== "object" || output === null) return null;
  const raw = (output as { findings?: unknown }).findings;
  if (!Array.isArray(raw)) return null;
  const findings: UpstreamFinding[] = [];
  let unusable = 0;
  for (const row of raw) {
    if (
      row !== null
      && typeof row === "object"
      && typeof (row as { title?: unknown }).title === "string"
      && typeof (row as { severity?: unknown }).severity === "string"
    ) {
      findings.push(row as UpstreamFinding);
    } else {
      // A malformed row is counted, never silently dropped: the reduction's
      // output says how much of its input it could not use.
      unusable += 1;
    }
  }
  return { findings, unusable };
}

export function executeDeterministicNode(
  node: CompiledNode,
  inputs: NodeInputs,
): NodeExecutionResult {
  const started = Date.now();

  const sources: string[] = [];
  const unusableInputs: string[] = [];
  const collected: Array<UpstreamFinding & { source: string }> = [];
  let unusableRows = 0;

  for (const [nodeKey, output] of Object.entries(inputs.outputs)) {
    const parsed = usableFindings(output);
    if (parsed === null) {
      unusableInputs.push(nodeKey);
      continue;
    }
    sources.push(nodeKey);
    unusableRows += parsed.unusable;
    for (const finding of parsed.findings) {
      collected.push({ ...finding, source: nodeKey });
    }
  }

  if (sources.length === 0) {
    return {
      status: "FAILED",
      // Deterministic means deterministic: the same inputs would fail the
      // same way, so a retry is a waste by definition.
      retryable: false,
      error:
        `Deterministic node ${node.nodeKey} (${node.capability}) has no reducible inputs: `
        + "none of its upstream outputs carry a findings array. The analysis worker wires "
        + "deterministic execution for finding reduction only; this node needs a different "
        + "execution path.",
      latencyMs: Date.now() - started,
    };
  }

  // First occurrence wins in the dedupe, so the earliest evidence survives;
  // the sort is stable, highest severity first.
  const deduped = dedupeBy(collected, (finding) => {
    const location = typeof finding.location === "string" ? finding.location : "";
    return `${normalizeKey(finding.title)}::${normalizeKey(location)}`;
  });
  const ranked = sortByRank(deduped.items, (finding) => rankSeverity(finding.severity));

  return {
    status: "SUCCEEDED",
    provider: "deterministic",
    output: {
      findings: ranked,
      stats: deduped.stats,
      sources,
      // Honesty travels in-band with the reduction: what arrived malformed,
      // which inputs carried nothing reducible, and which never arrived.
      unusable_rows: unusableRows,
      unusable_inputs: unusableInputs,
      missing_inputs: inputs.missing,
    },
    latencyMs: Date.now() - started,
  };
}
