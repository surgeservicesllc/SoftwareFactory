import type { CompiledNode } from "@/lib/graph/compiler";
import type { VerificationLens, VerificationVerdict } from "@/lib/graph/verification";

/**
 * Turning a reviewing node's answer into a recorded verdict.
 *
 * A graph's reviewing nodes were already running; what was missing was any
 * durable statement that a review had happened, of what, under which lens.
 * This derives that statement from the node's own structured output rather
 * than from a second model call — the review already happened, and asking
 * again would be paying twice for one opinion.
 *
 * Deliberately conservative: an output this cannot read yields no verdict at
 * all rather than a PASS. Absence of evidence is not evidence of passing,
 * and a fabricated PASS is the worst row this table could hold.
 */

/** Capabilities whose whole job is to judge someone else's work. */
const LENS_BY_CAPABILITY: Readonly<Record<string, VerificationLens>> = Object.freeze({
  review: "correctness",
  security_review: "security",
  qa: "acceptance_criteria",
});

export function verificationLensFor(node: Pick<CompiledNode, "capability">): VerificationLens | null {
  return LENS_BY_CAPABILITY[node.capability] ?? null;
}

type Finding = { severity?: unknown; title?: unknown };

function findingsOf(output: unknown): Finding[] | null {
  if (typeof output !== "object" || output === null) return null;
  const raw = (output as { findings?: unknown }).findings;
  return Array.isArray(raw) ? (raw as Finding[]) : null;
}

const SEVERITY_RANK: Readonly<Record<string, number>> = Object.freeze({
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
});

export type DerivedVerdict = {
  readonly verdict: VerificationVerdict;
  readonly evidence: readonly string[];
};

/**
 * A verdict, or null when the output does not support one.
 *
 * `blocked` is the reviewer saying it could not judge, which is a BLOCK and
 * not a failure of the subject. Otherwise the worst finding decides: high or
 * critical is a REJECT, anything else present is a WARN, and nothing found
 * is the only PASS this function will produce.
 */
export function deriveVerdict(output: unknown): DerivedVerdict | null {
  if (typeof output !== "object" || output === null) return null;

  const blocked = (output as { blocked?: unknown }).blocked;
  if (blocked === true) {
    const reason = (output as { blocked_reason?: unknown }).blocked_reason;
    return {
      verdict: "BLOCK",
      evidence: [typeof reason === "string" && reason.trim() ? reason : "The reviewer reported it could not judge this subject."],
    };
  }

  const findings = findingsOf(output);
  if (findings === null) return null;

  let worst = -1;
  const evidence: string[] = [];
  for (const finding of findings) {
    const severity = typeof finding.severity === "string" ? finding.severity.trim().toLowerCase() : "";
    const rank = SEVERITY_RANK[severity] ?? 0;
    worst = Math.max(worst, rank);
    if (typeof finding.title === "string" && finding.title.trim()) {
      // Evidence travels with the verdict; a verdict without it is an opinion.
      evidence.push(severity ? `${severity}: ${finding.title}` : finding.title);
    }
  }

  if (findings.length === 0) {
    return { verdict: "PASS", evidence: ["The reviewer reported no findings."] };
  }
  return { verdict: worst >= 3 ? "REJECT" : "WARN", evidence };
}
