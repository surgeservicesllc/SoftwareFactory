import type { CompiledNode } from "@/lib/graph/compiler";
import {
  maxOutputTokensForNode,
  taskKindForNode,
} from "@/lib/graph/provider-bridge";
import { storeZodSchema } from "@/lib/graph/stored-schema";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import type { NodeInputs } from "@/lib/worker/graph-run";
import type { ClaudeAuthResolution } from "@/lib/providers/claude-auth";
import { executeClaudeThroughCli } from "@/lib/providers/claude-cli-transport";
import type { ProviderRunRequest } from "@/lib/providers/types";
import {
  renderGrokClaimContextForPrompt,
  type GrokClaimContext,
} from "@/lib/worker/grok-claim-context";

/**
 * The worker's node executor: one bounded job through the subscription
 * transport — the same path the graph live canary proved with three parallel
 * inspectors. Read-only tools only: this executor runs analysis graphs
 * (audits, reviews, syntheses); a node that must WRITE files goes through
 * the Phase 1C workspace path with its isolation and draft-PR discipline,
 * not through here, and saying so is what keeps parallel nodes collision-
 * proof by construction.
 */

export type NodeExecutorOptions = Readonly<{
  goal: string;
  projectName: string;
  repositoryFullName: string;
  defaultBranch: string;
  workingDirectory: string;
  /** Present only on exact admitted Grok protocol-v3 claims. */
  initialContext?: GrokClaimContext | null;
  /** Model per node tier; the tiering decision stays with the caller. */
  modelForNode?: (node: CompiledNode) => string;
  maxTurns?: number;
}>;

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Turns a graph node may spend finding, reading, and answering.
 *
 * Measured from production drains rather than guessed: at eight, four of five
 * inspectors exhausted the budget mid-exploration on every attempt. Exported
 * so a test can prove the transport's ceiling actually honours it — a declared
 * budget silently clamped is a change that looks made and is not.
 */
export const GRAPH_NODE_MAX_TURNS = 24;

/**
 * Implementation is not find-read-answer: the node surveys the repository
 * before it can describe a build. Drain run 32821441484 (graph run f200de80)
 * exhausted 24 turns twice on the lifecycle's implement node while its nine
 * upstream stages reused cleanly — the budget, not the work, was the failure.
 */
export const IMPLEMENTATION_NODE_MAX_TURNS = 48;

/** The turn budget a node's kind of work actually needs. */
export function turnsForNode(node: Pick<CompiledNode, "capability">): number {
  return node.capability === "implementation"
    ? IMPLEMENTATION_NODE_MAX_TURNS
    : GRAPH_NODE_MAX_TURNS;
}

/** Cheaper models for repetitive extraction; the strongest for synthesis. */
export function defaultModelForNode(node: CompiledNode): string {
  if (node.modelTier === "ECONOMY") return "claude-haiku-4-5";
  if (node.modelTier === "STANDARD") return "claude-sonnet-5";
  return DEFAULT_MODEL;
}

/**
 * A refusal that will not pass until a limit resets: session limits, rate
 * limits, 429. Retrying seconds later burns attempts the reset would have
 * honoured, so these are never retried inside the run.
 */
export function isQuotaRefusal(message: string): boolean {
  return /session limit|rate limit|too many requests|quota|\b429\b/i.test(message);
}

/**
 * A momentary upstream overload: 529, "Overloaded", "capacity". The provider's
 * own message says to try again in a moment, and this is the only failure class
 * that says so — so it keeps its attempts rather than being spent on the first.
 *
 * Runs 28b4dedf and bfb6e0e7 are why this is separated out. Six nodes across
 * them died on 529 with exactly one attempt each, because the old single
 * predicate below classified an overload as a limit and the executor spends no
 * attempts on a limit. The most retryable error the provider returns was the
 * only one never retried.
 */
export function isTransientOverload(message: string): boolean {
  return /overloaded|capacity|\b529\b/i.test(message);
}

/**
 * A provider refusal that means "not now", not "wrong". Both kinds still mean
 * the attempt was never fuelled, which is what the run's void decision reads:
 * a lifecycle whose every terminal failure was capacity answered nothing,
 * however many attempts it spent finding that out.
 */
export function isCapacityRefusal(message: string): boolean {
  return isQuotaRefusal(message) || isTransientOverload(message);
}

/** Enough to carry real findings; bounded so one verbose upstream cannot
 * drown the prompt. Truncation is labeled, never silent. */
const MAX_INPUT_CHARS = 20_000;

function renderInputs(inputs: NodeInputs | undefined): string | null {
  if (!inputs) return null;
  const parts: string[] = [];
  for (const [nodeKey, value] of Object.entries(inputs.outputs)) {
    let serialized: string;
    try {
      serialized = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      serialized = String(value);
    }
    parts.push(
      serialized.length > MAX_INPUT_CHARS
        ? `Input from upstream node "${nodeKey}" (truncated after ${MAX_INPUT_CHARS} characters):\n${serialized.slice(0, MAX_INPUT_CHARS)}`
        : `Input from upstream node "${nodeKey}":\n${serialized}`,
    );
  }
  if (inputs.missing.length > 0) {
    parts.push(
      `Missing inputs: upstream node(s) ${inputs.missing.join(", ")} produced no output. `
      + "Work with what arrived, and state this incompleteness explicitly in your answer.",
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function buildClaudeNodeExecutor(
  auth: ClaudeAuthResolution,
  options: NodeExecutorOptions,
): (node: CompiledNode, attempt: number, inputs?: NodeInputs) => Promise<NodeExecutionResult> {
  const pickModel = options.modelForNode ?? defaultModelForNode;

  return async (node, attempt, inputs) => {
    const model = pickModel(node);
    const startedAt = Date.now();
    let requiredOutputSchema: Readonly<Record<string, unknown>>;
    try {
      if (!node.outputSchema) {
        throw new Error("the compiled node carries no output schema");
      }
      requiredOutputSchema = storeZodSchema(node.outputSchema);
    } catch (error) {
      return {
        status: "FAILED",
        retryable: false,
        error: `Node ${node.nodeKey}'s output contract cannot be sent to the provider: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const request: ProviderRunRequest = {
      runId: `graph-node-${node.nodeKey}-${startedAt}`,
      taskKind: taskKindForNode(node),
      agentRole: "orchestrator",
      agentId: `graph-node-${node.nodeKey}`,
      instructions: node.job,
      context: {
        projectName: options.projectName,
        repositoryFullName: options.repositoryFullName,
        defaultBranch: options.defaultBranch,
        riskLevel: node.risk,
        priorArtifacts: [],
        memoryExcerpts: [],
      },
      model,
      // The tier owns the completion ceiling. A hard-coded 4,000 made the
      // declared ECONOMY/STANDARD/STRONG contract decorative and could cut a
      // strong synthesis to one quarter of its approved envelope.
      maxOutputTokens: maxOutputTokensForNode(node),
      timeoutMs: node.timeoutMs,
    };

    const system = [
      `You are one node in an execution graph working toward: ${options.goal}`,
      `Your single bounded job: ${node.job}`,
      "Answer from what your tools actually return. If you cannot complete the job, say so plainly instead of guessing.",
      "Respond with one JSON value matching this exact JSON Schema and nothing else:",
      JSON.stringify(requiredOutputSchema),
    ].join("\n");

    // An edge is a data dependency: what upstream nodes produced travels
    // into this node's prompt, or the fan-in would run blind.
    const renderedInputs = renderInputs(inputs);
    const renderedContext = options.initialContext
      ? renderGrokClaimContextForPrompt(options.initialContext)
      : null;
    const task = [node.job, renderedContext, renderedInputs].filter(
      (value): value is string => value !== null,
    ).join("\n\n");

    // The node's declared timeout has to be enforced by somebody. The
    // transport only mirrors the signal it is handed and starts no timer of
    // its own, and this executor used to hand it a controller nothing ever
    // aborted — so `timeoutMs` was a number in a contract that bounded
    // nothing, and a hung call would hold its concurrency slot until the
    // workflow itself was killed, leaving the run RUNNING until the
    // two-hour reclaim swept it. The timer below is that enforcement.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), node.timeoutMs);

    try {
      const execution = await executeClaudeThroughCli(
        request,
        { system, task },
        controller.signal,
        auth,
        {
          workingDirectory: options.workingDirectory,
          allowedTools: ["Read", "Glob", "Grep"],
          outputSchema: requiredOutputSchema,
          // Turns bound the exploration; the deadline above bounds the wall
          // clock. The transport clamps this to its own ceiling, which is why
          // the capability budgets are pinned against that ceiling in tests
          // rather than merely declared here.
          maxTurns: options.maxTurns ?? turnsForNode(node),
        },
      );

      let output: unknown;
      try {
        output = JSON.parse(execution.text);
      } catch {
        // A non-JSON answer is still an answer; it travels as text rather
        // than being discarded, and the contract layer decides its fate.
        output = { text: execution.text };
      }

      return {
        status: "SUCCEEDED",
        output,
        provider: "anthropic",
        model,
        latencyMs: Date.now() - startedAt,
        // The transport reports real usage; discarding it would let the
        // graph's token budget never bind. Cost stays unstated — the
        // subscription is not per-token billed, and an invented price would
        // be budgeted against.
        tokensUsed: execution.inputTokens + execution.outputTokens,
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "The node execution failed.";
      // An abort here is this executor's own deadline, not an outside
      // cancellation, and saying so is the difference between "someone
      // stopped this" and "this node needs more time than it was given".
      const timedOut = controller.signal.aborted;
      const message = timedOut
        ? `The node exceeded its ${Math.round(node.timeoutMs / 1000)}s timeout and was stopped.`
        : rawMessage;
      const capacityWithheld = isCapacityRefusal(message);
      // A quota refusal names its own reset hour: nothing this run can do will
      // change the answer, so it is never retried here. An overload is the
      // opposite — the provider asks to be tried again — and it keeps the same
      // attempts a transport failure gets. Both still count as capacity
      // withheld, so an exhausted overload leaves the graph claimable rather
      // than recorded as an answer it never gave.
      const quotaExhausted = isQuotaRefusal(message);
      return {
        status: "FAILED",
        error: message,
        // A transport or timeout failure may pass on retry; the runner's
        // policy bounds how often that optimism is allowed to cost a turn.
        retryable: !quotaExhausted && attempt < 3,
        capacityWithheld,
        provider: "anthropic",
        model,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(deadline);
    }
  };
}
