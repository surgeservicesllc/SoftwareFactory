import "server-only";

import type { CompiledNode } from "@/lib/graph/compiler";
import { taskKindForNode } from "@/lib/graph/provider-bridge";
import type { NodeExecutionResult } from "@/lib/graph/runner";
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

/** Cheaper models for repetitive extraction; the strongest for synthesis. */
export function defaultModelForNode(node: CompiledNode): string {
  if (node.modelTier === "ECONOMY") return "claude-haiku-4-5";
  if (node.modelTier === "STANDARD" && node.capability === "extraction") return "claude-sonnet-5";
  return DEFAULT_MODEL;
}

export function buildClaudeNodeExecutor(
  auth: ClaudeAuthResolution,
  options: NodeExecutorOptions,
): (node: CompiledNode, attempt: number) => Promise<NodeExecutionResult> {
  const pickModel = options.modelForNode ?? defaultModelForNode;

  return async (node, attempt) => {
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

    try {
      const execution = await executeClaudeThroughCli(
        request,
        { system, task: node.job },
        new AbortController().signal,
        auth,
        {
          workingDirectory: options.workingDirectory,
          allowedTools: ["Read", "Glob", "Grep"],
          maxTurns: options.maxTurns ?? 8,
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
      };
    } catch (error) {
      return {
        status: "FAILED",
        error: error instanceof Error ? error.message : "The node execution failed.",
        // A transport or timeout failure may pass on retry; the runner's
        // policy bounds how often that optimism is allowed to cost a turn.
        retryable: attempt < 3,
        provider: "anthropic",
        model,
        latencyMs: Date.now() - startedAt,
      };
    }
  };
}
