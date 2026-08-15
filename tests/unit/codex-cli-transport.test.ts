// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executeCodexThroughCli,
  describeCodexTransport,
  type CodexClientLike,
  type CodexClientOptions,
  type CodexThreadEventLike,
} from "@/lib/providers/codex-cli-transport";
import { isProviderError } from "@/lib/providers/errors";
import type { ProviderRunRequest } from "@/lib/providers/types";
import type { CodexAuthResolution } from "@/lib/worker/auth";

const SUBSCRIPTION: CodexAuthResolution = Object.freeze({
  mode: "subscription",
  authJson: JSON.stringify({ tokens: { access_token: "subscription-token-value" } }),
  apiKey: null,
  zeroToken: true,
});

const API_KEY_MODE: CodexAuthResolution = Object.freeze({
  mode: "api_key",
  authJson: null,
  apiKey: "sk-proj-billing-key",
  zeroToken: false,
});

const REQUEST: ProviderRunRequest = {
  runId: "codex-0001",
  taskKind: "status_report",
  agentRole: "orchestrator",
  agentId: "test",
  instructions: "Report the state.",
  context: {
    projectName: "SoftwareFactory",
    repositoryFullName: "surgeservicesllc/SoftwareFactory",
    defaultBranch: "main",
    riskLevel: "GREEN",
    priorArtifacts: [],
    memoryExcerpts: [],
  },
  model: "gpt-5.3-codex",
  maxOutputTokens: 2_000,
  timeoutMs: 60_000,
};

const PROMPTS = { system: "You are advisory.", task: "Describe the project." };

function clientReturning(events: readonly CodexThreadEventLike[]) {
  const captured: { options?: Record<string, unknown>; env?: Record<string, string> } = {};
  const factory = (options: CodexClientOptions): CodexClientLike => {
    captured.env = options.env;
    return {
      startThread(threadOptions) {
        captured.options = threadOptions;
        return {
          id: "thread-1",
          async runStreamed() {
            return {
              events: (async function* () {
                for (const event of events) yield event;
              })(),
            };
          },
        };
      },
    };
  };
  return { factory, captured };
}

const ANSWER: CodexThreadEventLike[] = [
  { type: "item.completed", item: { type: "agent_message", text: '{"summary":"ok"}' } },
  { type: "turn.completed", usage: { input_tokens: 120, output_tokens: 40 } },
];

describe("the Codex advisory transport", () => {
  it("returns the round trip for the adapter to parse", async () => {
    const { factory } = clientReturning(ANSWER);
    const execution = await executeCodexThroughCli(
      REQUEST,
      PROMPTS,
      new AbortController().signal,
      SUBSCRIPTION,
      { workingDirectory: process.cwd(), clientFactory: factory },
    );

    // Parsing stays in BaseProviderAdapter, so this path produces exactly what
    // the API path produces — which is what makes it a transport rather than a
    // second provider.
    expect(execution.text).toBe('{"summary":"ok"}');
    expect(execution.inputTokens).toBe(120);
    expect(execution.outputTokens).toBe(40);
  });

  it("carries no billing credential into the child in subscription mode", async () => {
    const { factory, captured } = clientReturning(ANSWER);
    await executeCodexThroughCli(REQUEST, PROMPTS, new AbortController().signal, SUBSCRIPTION, {
      workingDirectory: process.cwd(),
      clientFactory: factory,
    });

    // The guarantee does not rest on the CLI preferring one credential over
    // another: there is no billing-capable credential in the process at all.
    expect(captured.env).toBeDefined();
    expect(captured.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(Object.keys(captured.env!)).toEqual(
      expect.arrayContaining(["PATH", "HOME", "CODEX_HOME"]),
    );
  });

  it("does not inherit the machine's ambient environment", async () => {
    process.env.SOFTWAREFACTORY_TRANSPORT_LEAK_CANARY = "must-not-appear";
    try {
      const { factory, captured } = clientReturning(ANSWER);
      await executeCodexThroughCli(REQUEST, PROMPTS, new AbortController().signal, SUBSCRIPTION, {
        workingDirectory: process.cwd(),
        clientFactory: factory,
      });

      // A run that succeeded on ambient credentials would prove nothing about
      // the configured ones, and would hide that an unconfigured deployment
      // fails closed.
      expect(captured.env).not.toHaveProperty("SOFTWAREFACTORY_TRANSPORT_LEAK_CANARY");
    } finally {
      delete process.env.SOFTWAREFACTORY_TRANSPORT_LEAK_CANARY;
    }
  });

  it("passes the key only in the opt-in billed mode", async () => {
    const { factory, captured } = clientReturning(ANSWER);
    await executeCodexThroughCli(REQUEST, PROMPTS, new AbortController().signal, API_KEY_MODE, {
      workingDirectory: process.cwd(),
      clientFactory: factory,
    });

    expect(captured.env?.OPENAI_API_KEY).toBe("sk-proj-billing-key");
  });

  it("runs read-only, so an advisory task cannot change anything", async () => {
    const { factory, captured } = clientReturning(ANSWER);
    await executeCodexThroughCli(REQUEST, PROMPTS, new AbortController().signal, SUBSCRIPTION, {
      workingDirectory: process.cwd(),
      clientFactory: factory,
    });

    expect(captured.options?.sandboxMode).toBe("read-only");
    expect(captured.options?.networkAccessEnabled).toBe(false);
    // One turn. Multi-turn agentic Codex belongs to Phase 1C, and duplicating it
    // here would be the second worker the directive forbids.
    expect(captured.options?.maxTurns).toBe(1);
  });

  it("reports an exhausted usage ceiling as rate limiting, not an outage", async () => {
    const { factory } = clientReturning([
      {
        type: "error",
        message:
          "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to "
          + "purchase more credits or try again at Aug 20th, 2026 10:05 AM.",
      },
    ]);

    const failure = await executeCodexThroughCli(
      REQUEST,
      PROMPTS,
      new AbortController().signal,
      SUBSCRIPTION,
      { workingDirectory: process.cwd(), clientFactory: factory },
    ).catch((error: unknown) => error);

    // A quota resolves by waiting. Calling it an outage sends an operator
    // hunting a misconfiguration that does not exist — which is exactly what
    // happened when this message first appeared in a real run.
    expect(isProviderError(failure)).toBe(true);
    expect((failure as { code: string }).code).toBe("rate_limited");
  });

  it("treats a terminal failure that is not a quota as an upstream problem", async () => {
    const { factory } = clientReturning([
      { type: "turn.failed", error: { message: "the sandbox could not be created" } },
    ]);

    const failure = await executeCodexThroughCli(
      REQUEST,
      PROMPTS,
      new AbortController().signal,
      SUBSCRIPTION,
      { workingDirectory: process.cwd(), clientFactory: factory },
    ).catch((error: unknown) => error);

    expect((failure as { code: string }).code).toBe("upstream_unavailable");
  });

  it("refuses an empty answer rather than storing one", async () => {
    const { factory } = clientReturning([{ type: "turn.completed", usage: {} }]);

    const failure = await executeCodexThroughCli(
      REQUEST,
      PROMPTS,
      new AbortController().signal,
      SUBSCRIPTION,
      { workingDirectory: process.cwd(), clientFactory: factory },
    ).catch((error: unknown) => error);

    expect((failure as { code: string }).code).toBe("invalid_response");
  });

  it("describes the mode without ever naming the credential", () => {
    const described = describeCodexTransport(SUBSCRIPTION);
    expect(described).toContain("subscription");
    expect(described).not.toContain("subscription-token-value");
    expect(describeCodexTransport(API_KEY_MODE)).not.toContain("sk-proj-billing-key");
  });
});
