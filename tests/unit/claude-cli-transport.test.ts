// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveClaudeAuth } from "@/lib/providers/claude-auth";
import {
  executeClaudeThroughCli,
  resolveMaxTurns,
  type ClaudeQueryFn,
  type ClaudeSdkMessage,
} from "@/lib/providers/claude-cli-transport";
import type { ProviderRunRequest } from "@/lib/providers/types";
import { GRAPH_NODE_MAX_TURNS } from "@/lib/worker/claude-node-executor";

/**
 * What the transport must guarantee, tested against a captured invocation
 * rather than a real CLI.
 *
 * The live canary proves Claude answers. These prove the things a live run
 * cannot: that a run *without* a configured credential fails rather than
 * quietly succeeding on the machine's own, that the schema travels with the
 * request, and that no credential reaches an audit trail.
 */

const OAUTH_TOKEN = "sk-ant-oat01-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const REQUEST: ProviderRunRequest = {
  runId: "run-1",
  taskKind: "status_report",
  agentRole: "orchestrator",
  agentId: "agent-1",
  instructions: "Summarize the project.",
  context: {
    projectName: "SoftwareFactory",
    repositoryFullName: "owner/repo",
    defaultBranch: "main",
    riskLevel: "GREEN",
    priorArtifacts: [],
    memoryExcerpts: [],
  },
  model: "claude-opus-5",
  maxOutputTokens: 1_000,
  timeoutMs: 30_000,
};

const PROMPTS = { system: "system prompt", task: "task prompt" };

const VALID_ARTIFACT = {
  summary: "A summary.",
  findings: [{ title: "A finding", detail: "Some detail.", severity: "info" }],
  recommendations: ["Do the thing."],
  confidence: "high",
  blocked: false,
  blocked_reason: null,
};

/** Capture what the transport asked the SDK to do. */
function capturingQuery(messages: ClaudeSdkMessage[]): {
  queryFn: ClaudeQueryFn;
  calls: { prompt: string; options: Record<string, unknown> }[];
} {
  const calls: { prompt: string; options: Record<string, unknown> }[] = [];
  const queryFn: ClaudeQueryFn = (params) => {
    calls.push({ prompt: params.prompt, options: params.options });
    return (async function* () {
      for (const message of messages) yield message;
    })();
  };
  return { queryFn, calls };
}

function successResult(overrides: Record<string, unknown> = {}): ClaudeSdkMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "session-abc",
    structured_output: VALID_ARTIFACT,
    usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 10 },
    ...overrides,
  } as ClaudeSdkMessage;
}

const SUBSCRIPTION = resolveClaudeAuth({
  SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
});

async function run(
  messages: ClaudeSdkMessage[],
  options: { signal?: AbortSignal; auth?: typeof SUBSCRIPTION } = {},
) {
  const { queryFn, calls } = capturingQuery(messages);
  const execution = await executeClaudeThroughCli(
    REQUEST,
    PROMPTS,
    options.signal ?? new AbortController().signal,
    options.auth ?? SUBSCRIPTION,
    { workingDirectory: process.cwd(), queryFn },
  );
  return { execution, calls };
}

describe("the child environment", () => {
  it("carries the configured credential and nothing ambient", async () => {
    const { calls } = await run([successResult()]);
    const environment = calls[0].options.env as Record<string, string>;

    expect(environment.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH_TOKEN);

    // The property that makes a green canary mean something: a machine that is
    // itself signed in to Claude must not lend its credentials to the run.
    // Anything matching these would let an unconfigured deployment succeed.
    const ambient = Object.keys(environment).filter(
      (key) =>
        (key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_")) &&
        key !== "CLAUDE_CODE_OAUTH_TOKEN" &&
        key !== "CLAUDE_CONFIG_DIR" &&
        key !== "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    );
    expect(ambient).toEqual([]);
  });

  it("never puts an API key in the child in subscription mode", async () => {
    const { calls } = await run([successResult()]);
    const environment = calls[0].options.env as Record<string, string>;

    // No credential capable of per-token billing is present at all, so the
    // zero-token guarantee does not depend on the CLI preferring one over
    // the other.
    expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("points the CLI at a per-run config directory", async () => {
    const { calls } = await run([successResult()]);
    const environment = calls[0].options.env as Record<string, string>;

    expect(environment.CLAUDE_CONFIG_DIR).toContain("softwarefactory-claude-");
    expect(environment.HOME).toBe(environment.CLAUDE_CONFIG_DIR);
  });
});

describe("the request", () => {
  it("carries the result schema rather than describing it", async () => {
    const { calls } = await run([successResult()]);
    const format = calls[0].options.outputFormat as { type: string; schema: Record<string, unknown> };

    // The defect the live canary caught: without this, Claude answers in a
    // schema of its own invention and the artifact is discarded after a full
    // run.
    expect(format.type).toBe("json_schema");
    expect(format.schema.required).toEqual([
      "summary",
      "findings",
      "recommendations",
      "confidence",
      "blocked",
      "blocked_reason",
    ]);
  });

  it("allows reading and denies every mutating tool", async () => {
    const { calls } = await run([successResult()]);
    const allowed = calls[0].options.allowedTools as string[];
    const denied = calls[0].options.disallowedTools as string[];

    expect(allowed).toEqual(["Read", "Glob", "Grep"]);
    for (const tool of ["Bash", "Write", "Edit", "WebFetch"]) {
      expect(allowed).not.toContain(tool);
      // Denied by name as well as omitted, because `allowedTools` is a filter
      // over a built-in set that grows.
      expect(denied).toContain(tool);
    }
  });

  it("runs exactly one turn", async () => {
    const { calls } = await run([successResult()]);
    expect(calls[0].options.maxTurns).toBe(1);
  });

  it("passes the routed model rather than letting the CLI choose", async () => {
    const { calls } = await run([successResult()]);
    expect(calls[0].options.model).toBe("claude-opus-5");
  });
});

describe("the response", () => {
  it("prefers the schema-enforced object over the free text", async () => {
    const { execution } = await run([
      successResult({ result: "some prose the model also emitted" }),
    ]);

    // `result` is what the model would have said without enforcement, which on
    // this transport is exactly what cannot be trusted to match.
    expect(JSON.parse(execution.text)).toEqual(VALID_ARTIFACT);
  });

  it("falls back to the free text when no structured output is present", async () => {
    const { execution } = await run([
      successResult({ structured_output: null, result: JSON.stringify(VALID_ARTIFACT) }),
    ]);

    expect(JSON.parse(execution.text)).toEqual(VALID_ARTIFACT);
  });

  it("reports usage and the session id", async () => {
    const { execution } = await run([successResult()]);

    expect(execution.inputTokens).toBe(100);
    expect(execution.outputTokens).toBe(40);
    expect(execution.cachedInputTokens).toBe(10);
    expect(execution.providerRunId).toBe("session-abc");
  });
});

describe("failures", () => {
  it("distinguishes a stream that ended from one that reported an error", async () => {
    // A CLI that crashed emits no result at all. Conflating that with a result
    // that says it failed would hide the crash.
    await expect(run([])).rejects.toThrow(/ended without returning a result/i);
  });

  it("treats exhausted structured-output retries as an invalid response", async () => {
    await expect(
      run([
        {
          type: "result",
          subtype: "error_max_structured_output_retries",
          is_error: true,
        } as ClaudeSdkMessage,
      ]),
    ).rejects.toThrow(/error_max_structured_output_retries/);
  });

  it("reports a cancelled run as cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(run([successResult()], { signal: controller.signal })).rejects.toThrow(
      /cancelled/i,
    );
  });

  it("never leaks the credential into an error message", async () => {
    const queryFn: ClaudeQueryFn = () =>
      (async function* (): AsyncGenerator<ClaudeSdkMessage> {
        // A CLI failure can quote its own environment back at you, and this
        // string is written to an audit trail.
        throw new Error(`spawn failed with CLAUDE_CODE_OAUTH_TOKEN=${OAUTH_TOKEN}`);
      })();

    await expect(
      executeClaudeThroughCli(REQUEST, PROMPTS, new AbortController().signal, SUBSCRIPTION, {
        workingDirectory: process.cwd(),
        queryFn,
      }),
    ).rejects.toThrow(/\[redacted\]/);

    await expect(
      executeClaudeThroughCli(REQUEST, PROMPTS, new AbortController().signal, SUBSCRIPTION, {
        workingDirectory: process.cwd(),
        queryFn,
      }),
    ).rejects.not.toThrow(new RegExp(OAUTH_TOKEN));
  });
});


/**
 * The turn budget is a cost bound, so its edges are tested rather than trusted.
 *
 * Phase 2B needed more than one turn for nodes that must find, read and answer;
 * Phase 2A needed the bound to stay a bound. Both hold only if the default is
 * untouched and the ceiling actually clamps.
 */
describe("the declared turn budget", () => {
  it("gives one turn to a caller that does not ask", () => {
    // Every advisory caller is in this branch, so their cost is unchanged.
    expect(resolveMaxTurns(undefined)).toBe(1);
  });

  it("honours a declared budget within the ceiling", () => {
    expect(resolveMaxTurns(6)).toBe(6);
  });

  it("clamps rather than throwing when a caller asks for too many", () => {
    // Throwing would turn a cost preference into an outage, which is a worse
    // failure than quietly getting fewer turns than requested.
    expect(resolveMaxTurns(500)).toBe(24);
    // Production runs 32228988434, 32230345648 and 32254860997 all failed
    // inspectors with "Reached maximum number of turns (8)" while the graph
    // executor declared more: the ceiling clamped it away without a word, so
    // raising the executor alone looked like a fix and was not. If either
    // number moves without the other, this fails rather than the next drain.
    expect(resolveMaxTurns(GRAPH_NODE_MAX_TURNS)).toBe(GRAPH_NODE_MAX_TURNS);
  });

  it("refuses to go below one, however it is asked", () => {
    expect(resolveMaxTurns(0)).toBe(1);
    expect(resolveMaxTurns(-4)).toBe(1);
    expect(resolveMaxTurns(2.7)).toBe(2);
    expect(resolveMaxTurns(Number.NaN)).toBe(1);
    expect(resolveMaxTurns(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
