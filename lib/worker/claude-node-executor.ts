import type { CompiledNode } from "@/lib/graph/compiler";
import { taskKindForNode } from "@/lib/graph/provider-bridge";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import type { NodeInputs } from "@/lib/worker/graph-run";
import type { ClaudeAuthResolution } from "@/lib/providers/claude-auth";
import { executeClaudeThroughCli } from "@/lib/providers/claude-cli-transport";
import type { ProviderRunRequest } from "@/lib/providers/types";

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

/** Cheaper models for repetitive extraction; the strongest for synthesis. */
export function defaultModelForNode(node: CompiledNode): string {
  if (node.modelTier === "ECONOMY") return "claude-haiku-4-5";
  if (node.modelTier === "STANDARD" && node.capability === "extraction") return "claude-sonnet-5";
  return DEFAULT_MODEL;
}

/**
 * A provider refusal that means "not now", not "wrong": session limits, rate
 * limits, overload. Retrying seconds later burns attempts a reset would have
 * honoured, so these are classified rather than treated as node failures.
 */
export function isCapacityRefusal(message: string): boolean {
  return /session limit|rate limit|too many requests|overloaded|capacity|\b429\b|\b529\b/i.test(message);
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
      maxOutputTokens: 4_000,
      timeoutMs: node.timeoutMs,
    };

    const system = [
      `You are one node in an execution graph working toward: ${options.goal}`,
      `Your single bounded job: ${node.job}`,
      "Answer from what your tools actually return. If you cannot complete the job, say so plainly instead of guessing.",
      "Respond with the requested structured output only.",
    ].join("\n");

    // An edge is a data dependency: what upstream nodes produced travels
    // into this node's prompt, or the fan-in would run blind.
    const renderedInputs = renderInputs(inputs);
    const task = renderedInputs === null ? node.job : `${node.job}\n\n${renderedInputs}`;

    try {
      const execution = await executeClaudeThroughCli(
        request,
        { system, task },
        new AbortController().signal,
        auth,
        {
          workingDirectory: options.workingDirectory,
          allowedTools: ["Read", "Glob", "Grep"],
          // The node's own timeoutMs remains the hard stop; this bounds the
          // exploration inside it. The transport clamps to its own ceiling,
          // which is why GRAPH_NODE_MAX_TURNS is pinned against that ceiling
          // in tests rather than merely declared here.
          maxTurns: options.maxTurns ?? GRAPH_NODE_MAX_TURNS,
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
      const message = error instanceof Error ? error.message : "The node execution failed.";
      const capacityWithheld = isCapacityRefusal(message);
      return {
        status: "FAILED",
        error: message,
        // A transport or timeout failure may pass on retry; the runner's
        // policy bounds how often that optimism is allowed to cost a turn.
        // A capacity refusal will not pass until the limit resets, so it is
        // never retried within the run.
        retryable: !capacityWithheld && attempt < 3,
        capacityWithheld,
        provider: "anthropic",
        model,
        latencyMs: Date.now() - startedAt,
      };
    }
  };
}
