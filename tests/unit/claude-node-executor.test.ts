// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const executeMock = vi.fn();
vi.mock("@/lib/providers/claude-cli-transport", () => ({
  executeClaudeThroughCli: (...args: unknown[]) => executeMock(...args),
}));

import type { CompiledNode } from "@/lib/graph/compiler";
import {
  buildClaudeNodeExecutor,
  defaultModelForNode,
  isCapacityRefusal,
} from "@/lib/worker/claude-node-executor";
import type { ClaudeAuthResolution } from "@/lib/providers/claude-auth";

/**
 * The executor's pure obligations, without a CLI: upstream outputs travel
 * into the node's prompt (an edge is a data dependency, not a scheduling
 * hint), and a provider capacity refusal is classified as "not now" — never
 * retried within the run — instead of being mistaken for a wrong answer.
 */

const node = {
  nodeKey: "synthesize",
  job: "Synthesize the three inspections",
  capability: "synthesis",
  modelTier: "STRONG",
  risk: "GREEN",
  timeoutMs: 180_000,
  maxAttempts: 2,
} as unknown as CompiledNode;

const auth = { kind: "oauth-token" } as unknown as ClaudeAuthResolution;

const options = {
  goal: "Prove the executor",
  projectName: "SoftwareFactory",
  repositoryFullName: "example/repository",
  defaultBranch: "main",
  workingDirectory: "/tmp",
} as const;

function capturedTask(): string {
  const call = executeMock.mock.calls.at(-1);
  return (call?.[1] as { task: string }).task;
}

beforeEach(() => {
  executeMock.mockReset();
});

describe("isCapacityRefusal", () => {
  it("recognises the refusals that mean 'not now'", () => {
    expect(isCapacityRefusal("Claude Code returned an error result: You've hit your session limit · resets 7:30am (UTC)")).toBe(true);
    expect(isCapacityRefusal("HTTP 429 Too Many Requests")).toBe(true);
    expect(isCapacityRefusal("The upstream is overloaded")).toBe(true);
  });

  it("leaves genuine failures classified as failures", () => {
    expect(isCapacityRefusal("The model returned malformed JSON")).toBe(false);
    expect(isCapacityRefusal("getaddrinfo ENOTFOUND api.anthropic.com")).toBe(false);
    expect(isCapacityRefusal("The area could not be read.")).toBe(false);
  });
});

describe("buildClaudeNodeExecutor", () => {
  it("folds upstream outputs and missing inputs into the task prompt", async () => {
    executeMock.mockResolvedValue({ text: '{"ok":true}', inputTokens: 1200, outputTokens: 300 });
    const executor = buildClaudeNodeExecutor(auth, options);

    const result = await executor(node, 1, {
      outputs: { inspect_a: { finding: "the config drifts" } },
      missing: ["inspect_b"],
    });

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    // Real usage travels with the result so the graph's token budget can bind.
    expect(result.tokensUsed).toBe(1500);
    // The measured turn envelope (run 32228988434 exhausted the old 8) and
    // the read-only tool surface travel with every call.
    expect(executeMock.mock.calls.at(-1)?.[4]).toMatchObject({
      maxTurns: 24,
      allowedTools: ["Read", "Glob", "Grep"],
    });
    const task = capturedTask();
    expect(task).toContain("Synthesize the three inspections");
    expect(task).toContain('Input from upstream node "inspect_a"');
    expect(task).toContain("the config drifts");
    expect(task).toContain("Missing inputs: upstream node(s) inspect_b");
    expect(task).toContain("state this incompleteness explicitly");
  });

  it("sends the bare job when the node has no incoming edges", async () => {
    executeMock.mockResolvedValue({ text: "plain answer", inputTokens: 100, outputTokens: 20 });
    const executor = buildClaudeNodeExecutor(auth, options);

    await executor(node, 1, { outputs: {}, missing: [] });

    expect(capturedTask()).toBe("Synthesize the three inspections");
  });

  it("classifies a session-limit refusal as capacity withheld, never retryable", async () => {
    executeMock.mockRejectedValue(
      new Error("Claude Code returned an error result: You've hit your session limit · resets 7:30am (UTC)"),
    );
    const executor = buildClaudeNodeExecutor(auth, options);

    const result = await executor(node, 1);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.capacityWithheld).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it("keeps ordinary transport failures retryable on early attempts", async () => {
    executeMock.mockRejectedValue(new Error("The CLI exited before answering."));
    const executor = buildClaudeNodeExecutor(auth, options);

    const result = await executor(node, 1);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.capacityWithheld).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

describe("defaultModelForNode", () => {
  it("tiers models by declared complexity", () => {
    expect(defaultModelForNode({ ...node, modelTier: "ECONOMY" } as unknown as CompiledNode)).toBe("claude-haiku-4-5");
    expect(defaultModelForNode({ ...node, modelTier: "STANDARD", capability: "extraction" } as unknown as CompiledNode)).toBe("claude-sonnet-5");
    expect(defaultModelForNode(node)).toBe("claude-opus-5");
  });
});
