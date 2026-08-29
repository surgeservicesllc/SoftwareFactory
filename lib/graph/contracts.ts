import { z } from "zod";

import {
  DEFAULT_RETRY_POLICY,
  type ResourceRef,
  type RetryPolicy,
  type RiskLevel,
} from "@/lib/graph/types";

/**
 * Node contracts.
 *
 * A contract is what makes a graph composable rather than a chain of hopeful
 * prose. It states what a node consumes, what it must produce, what it touches,
 * and what it costs — so a downstream node can be scheduled against a promise
 * rather than a guess, and so an output that does not honour the promise is
 * rejected instead of silently corrupting everything after it.
 *
 * The rule that matters: **free-form prose is not an acceptable output when a
 * downstream node needs structured data.** `validateNodeOutput` enforces that
 * against the declared schema rather than trusting the producing agent.
 */

/** How a node does its work. Not every node needs a model. */
export const NODE_EXECUTORS = [
  /** Deterministic code. Cheaper, faster, and exactly repeatable. */
  "DETERMINISTIC",
  /** A provider call routed through the Phase 2A layer. */
  "MODEL",
  /** A non-AI anchor: a test run, a CI result, an HTTP probe, a DB query. */
  "ANCHOR",
] as const;
export type NodeExecutor = (typeof NODE_EXECUTORS)[number];

/**
 * Capability the node needs, used to pick an agent and a model tier.
 *
 * Tiering is the point of §17: extraction and dedupe should not run on the
 * strongest model, and architecture should not run on the cheapest.
 */
export const NODE_CAPABILITIES = [
  "planning",
  "architecture",
  "implementation",
  "extraction",
  "review",
  "security_review",
  "qa",
  "synthesis",
  "reporting",
  // The look-before-you-build trio (2026-08-23). Discovery finds what already
  // exists; evaluation scores the survivors on one rubric; decision weighs
  // USE/CONNECT/ADAPT/FORK/BUILD and picks. Their outputs are the typed
  // stage packages in lib/graph/stage-packages.ts, and their existence is
  // what let the DISCOVERY/EVALUATION/DECISION stages grow (ADR-136).
  "discovery",
  "evaluation",
  "decision",
  /*
   * Two build-side specialists (2026-08-29), and the bar for being here is
   * behaving differently rather than being differently named. `database` work
   * touches migrations and RLS, so it runs on a stronger tier than a component
   * edit. `deployment` changes what is running in front of users, and asks a
   * provider for a verdict rather than a proposal.
   *
   * `deployment` closes a real defect rather than adding a label. The
   * DEPLOYMENT stage had no capability of its own, so it borrowed
   * `implementation` — a release step was tiered, prompted and risk-scored as
   * if it were writing a feature.
   *
   * Frontend, backend and integration work deliberately did *not* get values
   * here. All three are the same reasoning at the same tier against the same
   * task kind, so a capability each would be a label that changes nothing.
   * What actually differs between them is which files they may touch, and
   * that is a role — see lib/sdlc/agent-roster.ts.
   */
  "database",
  "deployment",
] as const;
export type NodeCapability = (typeof NODE_CAPABILITIES)[number];

/**
 * Model strength a capability warrants.
 *
 * `NONE` means the node should not call a model at all — the work is
 * deterministic and a model would only add cost, latency, and the chance of
 * inventing something.
 */
export const MODEL_TIERS = ["NONE", "ECONOMY", "STANDARD", "STRONG"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/**
 * Declared preference per capability. This is configuration, not a benchmark
 * claim: it says what this system is willing to spend where, and routing may
 * still override it for availability or policy.
 */
export const CAPABILITY_MODEL_TIER: Readonly<Record<NodeCapability, ModelTier>> =
  Object.freeze({
    planning: "STRONG",
    architecture: "STRONG",
    implementation: "STANDARD",
    // Extraction is structure-shuffling. A strong model is money burned.
    extraction: "ECONOMY",
    review: "STRONG",
    security_review: "STRONG",
    qa: "STANDARD",
    synthesis: "STRONG",
    reporting: "STANDARD",
    // Discovery is breadth — read, list, label — and does not need the
    // strongest model. Evaluation and decision are judgment, and a wrong
    // judgment here misdirects every stage after it.
    discovery: "STANDARD",
    evaluation: "STRONG",
    decision: "STRONG",
    // Schema work is judgement: a migration that drops a grant or loosens RLS
    // is not recoverable by a retry, so it does not run cheap.
    database: "STRONG",
    // A deploy step reasons about whether release preconditions actually hold.
    // Getting that wrong ships a regression to users.
    deployment: "STRONG",
  });

export type NodeContract = {
  readonly nodeId: string;
  /** What this node is for, in one line, for the graph UI and audit trail. */
  readonly job: string;
  readonly executor: NodeExecutor;
  readonly capability: NodeCapability;
  /** Explicit override; otherwise derived from the capability. */
  readonly modelTier?: ModelTier;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  readonly dependsOn: readonly string[];
  readonly reads: readonly ResourceRef[];
  readonly writes: readonly ResourceRef[];
  readonly risk: RiskLevel;
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  /** Node-level ceiling; the graph budget still applies on top. */
  readonly maxConcurrency?: number;
  /**
   * A tolerant fan-in runs once every dependency has settled, with whatever
   * inputs actually completed — instead of being blocked by the first failed
   * upstream. It still refuses to run on nothing, and its executor receives
   * the missing set so the output states its own incompleteness. Off by
   * default: an implementation step genuinely needs its inputs; tolerance is
   * for synthesis and reporting, where a partial view stated as partial
   * beats no view at all.
   */
  readonly toleratesPartialInputs?: boolean;
};

export function modelTierFor(contract: NodeContract): ModelTier {
  if (contract.executor !== "MODEL") return "NONE";
  return contract.modelTier ?? CAPABILITY_MODEL_TIER[contract.capability];
}

export type ValidationOutcome<T = unknown> =
  | { readonly valid: true; readonly value: T }
  | {
      readonly valid: false;
      readonly code: "SCHEMA_VIOLATION" | "PROSE_WHERE_STRUCTURE_REQUIRED";
      readonly message: string;
      readonly issues: readonly string[];
    };

/**
 * Does this schema demand structure rather than a blob of text?
 *
 * A node declaring `z.string()` output is happy with prose. A node declaring an
 * object or array is not, and handing it a string is the specific failure §3
 * calls out — an agent narrating instead of answering.
 *
 * Decided by asking the schema rather than by reading Zod's internals: if a
 * plain string parses, the contract accepts prose. That survives Zod version
 * changes, which introspecting `_def.typeName` did not.
 */
function requiresStructure(schema: z.ZodTypeAny): boolean {
  return !schema.safeParse("probe").success;
}

/**
 * Validate a node's output against its contract.
 *
 * Returns a result rather than throwing: the scheduler decides whether to
 * retry, fall back, or fail the node, and that decision belongs to the retry
 * policy rather than to a stack unwind.
 */
export function validateNodeOutput<T = unknown>(
  contract: Pick<NodeContract, "nodeId" | "outputSchema">,
  output: unknown,
): ValidationOutcome<T> {
  if (typeof output === "string" && requiresStructure(contract.outputSchema)) {
    return {
      valid: false,
      code: "PROSE_WHERE_STRUCTURE_REQUIRED",
      message: `Node ${contract.nodeId} returned prose, but its contract requires structured output.`,
      issues: ["Expected an object or array conforming to the output schema."],
    };
  }

  const parsed = contract.outputSchema.safeParse(output);
  if (parsed.success) return { valid: true, value: parsed.data as T };

  return {
    valid: false,
    code: "SCHEMA_VIOLATION",
    message: `Node ${contract.nodeId} produced output its contract rejects.`,
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
}

/**
 * Validate a handoff against the *receiving* node's input contract (§19).
 *
 * Checking on arrival rather than on departure is what stops a producer's idea
 * of "done" from silently differing from the consumer's idea of "usable".
 */
export function validateHandoffInput<T = unknown>(
  receiving: NodeContract,
  input: unknown,
): ValidationOutcome<T> {
  const parsed = receiving.inputSchema.safeParse(input);
  if (parsed.success) return { valid: true, value: parsed.data as T };

  return {
    valid: false,
    code: "SCHEMA_VIOLATION",
    message: `Handoff into ${receiving.nodeId} does not satisfy its input contract.`,
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
}

/** Should this failure be retried, given the contract and attempts so far? */
export function shouldRetry(
  contract: NodeContract,
  attemptsMade: number,
): boolean {
  return attemptsMade < contract.retry.maxAttempts;
}

export function defineNode(
  contract: Omit<NodeContract, "retry" | "timeoutMs"> &
    Partial<Pick<NodeContract, "retry" | "timeoutMs">>,
): NodeContract {
  return Object.freeze({
    timeoutMs: 180_000,
    retry: DEFAULT_RETRY_POLICY,
    ...contract,
  });
}
