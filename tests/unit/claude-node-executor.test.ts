// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const executeMock = vi.fn();
vi.mock("@/lib/providers/claude-cli-transport", () => ({
  executeClaudeThroughCli: (...args: unknown[]) => executeMock(...args),
}));

import type { CompiledNode } from "@/lib/graph/compiler";
import {
  buildClaudeNodeExecutor,
  defaultModelForNode,
  GRAPH_NODE_MAX_TURNS,
  IMPLEMENTATION_NODE_MAX_TURNS,
  isCapacityRefusal,
  isQuotaRefusal,
  isTransientOverload,
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
  inputSchema: z.unknown(),
  outputSchema: z.object({ ok: z.boolean() }),
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

function capturedSystem(): string {
  const call = executeMock.mock.calls.at(-1);
  return (call?.[1] as { system: string }).system;
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

  it("separates a limit that must wait for a reset from an overload that must not", () => {
    const sessionLimit = "You've hit your session limit · resets 7:30am (UTC)";
    const overload = "API Error: 529 Overloaded. This is a server-side issue, usually temporary";

    expect(isQuotaRefusal(sessionLimit)).toBe(true);
    expect(isTransientOverload(sessionLimit)).toBe(false);

    expect(isTransientOverload(overload)).toBe(true);
    expect(isQuotaRefusal(overload)).toBe(false);

    // The union still answers what it always answered: both are "not now".
    expect(isCapacityRefusal(sessionLimit)).toBe(true);
    expect(isCapacityRefusal(overload)).toBe(true);
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
      maxTurns: GRAPH_NODE_MAX_TURNS,
      allowedTools: ["Read", "Glob", "Grep"],
      outputSchema: expect.objectContaining({
        type: "object",
        required: ["ok"],
      }),
    });
    expect(capturedSystem()).toContain("this exact JSON Schema");
    expect(capturedSystem()).toContain('"required":["ok"]');
    const task = capturedTask();
    expect(task).toContain("Synthesize the three inspections");
    expect(task).toContain('Input from upstream node "inspect_a"');
    expect(task).toContain("the config drifts");
    expect(task).toContain("Missing inputs: upstream node(s) inspect_b");
    expect(task).toContain("state this incompleteness explicitly");
  });

  it("grants an implementation node its larger measured turn budget", async () => {
    // Run 32821441484 exhausted 24 turns twice on the implement node while
    // every scout fit comfortably: implementation surveys before it answers.
    executeMock.mockResolvedValue({ text: '{"ok":true}', inputTokens: 10, outputTokens: 5 });
    const executor = buildClaudeNodeExecutor(auth, options);

    await executor(
      { ...(node as object), nodeKey: "implement", capability: "implementation" } as CompiledNode,
      1,
    );

    expect(executeMock.mock.calls.at(-1)?.[4]).toMatchObject({
      maxTurns: IMPLEMENTATION_NODE_MAX_TURNS,
    });
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

  it("retries a 529 overload, because the provider asked to be tried again", async () => {
    // Runs 28b4dedf and bfb6e0e7 lost six nodes to 529 with one attempt each.
    // An overload and a session limit are both "not now", but only one of them
    // has a reset hour to wait for; spending zero attempts on the other threw
    // away the retry the provider's own message requested.
    executeMock.mockRejectedValue(
      new Error(
        "Claude Code returned an error result: API Error: 529 Overloaded. This is a "
        + "server-side issue, usually temporary — try again in a moment.",
      ),
    );
    const executor = buildClaudeNodeExecutor(auth, options);

    const result = await executor(node, 1);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(true);
    // Still capacity withheld: if every attempt is refused the run answered
    // nothing, and a lifecycle must stay claimable rather than be recorded
    // as having failed on the merits.
    expect(result.capacityWithheld).toBe(true);
  });

  it("stops retrying an overload once the attempts are spent", async () => {
    executeMock.mockRejectedValue(new Error("API Error: 529 Overloaded."));
    const executor = buildClaudeNodeExecutor(auth, options);

    const result = await executor(node, 3);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(false);
    expect(result.capacityWithheld).toBe(true);
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

describe("the node deadline", () => {
  it("stops a node that outlives its declared timeout, and says which limit it hit", async () => {
    // The transport starts no timer of its own; it only mirrors the signal it
    // is handed. Before this, the executor handed it a controller nothing
    // aborted, so timeoutMs bounded nothing and a hung call held its
    // concurrency slot until the workflow was killed.
    executeMock.mockImplementation((_r: unknown, _p: unknown, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("The Claude run was cancelled.")), { once: true });
      }));

    const quick = { ...node, timeoutMs: 40 } as unknown as CompiledNode;
    const result = await buildClaudeNodeExecutor(auth, options)(quick, 1);

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toBe("The node exceeded its 0s timeout and was stopped.");
    // A timeout may not recur, so it stays retryable — unlike a capacity
    // refusal, which will not pass until the window resets.
    expect(result.retryable).toBe(true);
    expect(result.capacityWithheld).toBe(false);
  });

  it("leaves a prompt answer inside the deadline untouched", async () => {
    executeMock.mockResolvedValue({ text: '{"ok":true}', inputTokens: 10, outputTokens: 5 });
    const result = await buildClaudeNodeExecutor(auth, options)(node, 1);
    expect(result.status).toBe("SUCCEEDED");
  });
});

describe("defaultModelForNode", () => {
  it("tiers models by declared complexity", () => {
    expect(defaultModelForNode({ ...node, modelTier: "ECONOMY" } as unknown as CompiledNode)).toBe("claude-haiku-4-5");
    expect(defaultModelForNode({ ...node, modelTier: "STANDARD", capability: "extraction" } as unknown as CompiledNode)).toBe("claude-sonnet-5");
    expect(defaultModelForNode(node)).toBe("claude-opus-5");
  });
});
