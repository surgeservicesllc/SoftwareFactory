import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ProviderExecution } from "@/lib/providers/base-adapter";
import { PROVIDER_RESULT_JSON_SCHEMA } from "@/lib/providers/contract";
import { ProviderError } from "@/lib/providers/errors";
import type { ProviderRunRequest } from "@/lib/providers/types";
import { type CodexAuthResolution } from "@/lib/worker/auth";

/**
 * Reach Codex on the owner's ChatGPT subscription, for one advisory task.
 *
 * The Claude side of Phase 2A already had this shape: a second *transport*
 * behind the same adapter, not a second provider. This is its counterpart, and
 * it exists so provider fallback can be demonstrated without either provider
 * costing per-token credit — a fallback that only works when one side is billed
 * is not a fallback this project can use.
 *
 * ## It reuses Phase 1C's auth rather than restating it
 *
 * `lib/worker/auth.ts` already decides how Codex authenticates, and it decides
 * it carefully: subscription by default, an API key only under an explicit
 * opt-in, and an API key pasted into the subscription slot refused by shape. A
 * second copy of that reasoning here would be a second policy, and the two would
 * drift — the cost rule would then hold on whichever path someone happened to
 * audit. So `resolveCodexAuth` is imported, not reimplemented.
 *
 * That also honours the standing instruction not to build a second AI worker.
 * Phase 1C owns multi-turn agentic Codex execution. This runs exactly one turn
 * and returns a structured artifact; it cannot write a repository, and it is not
 * an agent.
 *
 * ## The per-run home is the isolation
 *
 * A machine running SoftwareFactory may itself be signed in to Codex. Inheriting
 * that would make a run succeed on credentials nobody configured, and the
 * success would prove nothing — not that the configured credential works, not
 * that an unconfigured deployment fails closed. Each run gets a fresh
 * `CODEX_HOME` seeded only with the resolved credential, removed in a `finally`.
 */

const MAX_TURNS = 1;

export interface CodexCliTransportOptions {
  /** Working directory the run is scoped to. */
  readonly workingDirectory: string;
  /** Injected for tests; defaults to the real SDK. */
  readonly clientFactory?: (options: CodexClientOptions) => CodexClientLike;
}

export type CodexClientOptions = {
  readonly env: Record<string, string>;
};

export type CodexThreadEventLike =
  | { readonly type: "item.completed"; readonly item: { readonly type: string; readonly text?: string } }
  | { readonly type: "turn.completed"; readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly cached_input_tokens?: number } }
  | { readonly type: "turn.failed"; readonly error?: { readonly message?: string } }
  | { readonly type: "error"; readonly message?: string }
  | { readonly type: string };

export type CodexThreadLike = {
  readonly id: string | null;
  runStreamed(
    input: string,
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<{ events: AsyncIterable<CodexThreadEventLike> }>;
};

export type CodexClientLike = {
  startThread(options: Record<string, unknown>): CodexThreadLike;
};

async function loadSdkClient(options: CodexClientOptions): Promise<CodexClientLike> {
  const { Codex } = await import("@openai/codex-sdk");
  // No `apiKey` field at all in subscription mode. Passing `undefined` would be
  // equivalent, but omitting it makes the intent unmistakable to a reader
  // checking whether this path can bill.
  return new Codex({ env: options.env }) as unknown as CodexClientLike;
}

/**
 * Run one advisory task through the Codex CLI and return the raw round trip.
 *
 * Parsing and validation stay in `BaseProviderAdapter`, so this path produces
 * exactly the artifact the API path produces — which is the whole point of it
 * being a transport rather than a provider.
 */
export async function executeCodexThroughCli(
  request: ProviderRunRequest,
  prompts: { readonly system: string; readonly task: string },
  signal: AbortSignal,
  auth: CodexAuthResolution,
  options: CodexCliTransportOptions,
): Promise<ProviderExecution> {
  const codexHome = path.join(tmpdir(), `softwarefactory-codex-${randomUUID()}`);

  try {
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    if (auth.authJson) {
      await writeFile(path.join(codexHome, "auth.json"), auth.authJson, {
        encoding: "utf8",
        mode: 0o600,
      });
    }

    const clientEnv = {
        // Built, not inherited: see the note above. Only what the CLI needs to
        // run, plus the home this run seeded.
      PATH: process.env.PATH ?? "",
      HOME: codexHome,
      CODEX_HOME: codexHome,
      ...(auth.apiKey ? { OPENAI_API_KEY: auth.apiKey } : {}),
    };
    const client = options.clientFactory
      ? options.clientFactory({ env: clientEnv })
      : await loadSdkClient({ env: clientEnv });

    const thread = client.startThread({
      model: request.model,
      workingDirectory: options.workingDirectory,
      // An advisory task reads and answers. It must not be able to change
      // anything, and Phase 2A runs are analysis-only by contract.
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      maxTurns: MAX_TURNS,
    });

    let streamed: { events: AsyncIterable<CodexThreadEventLike> };
    try {
      streamed = await thread.runStreamed(`${prompts.system}\n\n${prompts.task}`, {
        outputSchema: PROVIDER_RESULT_JSON_SCHEMA,
        signal,
      });
    } catch (error) {
      throw new ProviderError(
        "upstream_unavailable",
        error instanceof Error ? error.message : "Codex could not be started.",
        "openai",
      );
    }

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens: number | null = null;
    let terminal: string | null = null;

    for await (const event of streamed.events) {
      if (event.type === "item.completed") {
        const item = (event as { item: { type: string; text?: string } }).item;
        if (item.type === "agent_message" && typeof item.text === "string") text = item.text;
      } else if (event.type === "turn.completed") {
        const usage = (event as { usage?: Record<string, number> }).usage;
        inputTokens += usage?.input_tokens ?? 0;
        outputTokens += usage?.output_tokens ?? 0;
        if (usage?.cached_input_tokens !== undefined) {
          cachedInputTokens = (cachedInputTokens ?? 0) + usage.cached_input_tokens;
        }
      } else if (event.type === "turn.failed") {
        terminal = (event as { error?: { message?: string } }).error?.message ?? "Codex turn failed.";
      } else if (event.type === "error") {
        terminal = (event as { message?: string }).message ?? "Codex reported an error.";
      }
    }

    if (terminal) {
      // A usage ceiling is not a fault and must not read as one: it resolves by
      // waiting, and reporting it as a provider outage would send an operator
      // looking for a misconfiguration that does not exist.
      const quotaExhausted = /usage limit|quota|purchase more credits/i.test(terminal);
      throw new ProviderError(
        quotaExhausted ? "rate_limited" : "upstream_unavailable",
        terminal,
        "openai",
      );
    }

    if (!text.trim()) {
      throw new ProviderError("invalid_response", "Codex returned an empty response.", "openai");
    }

    return Object.freeze({
      providerRunId: thread.id,
      text,
      inputTokens,
      outputTokens,
      cachedInputTokens,
    });
  } finally {
    // The credential lives only as long as the run that needed it.
    await rm(codexHome, { recursive: true, force: true }).catch(() => {});
  }
}

/** A description safe for logs: never the credential itself. */
export function describeCodexTransport(auth: CodexAuthResolution): string {
  return auth.zeroToken
    ? "Codex runs on the owner's ChatGPT subscription through the CLI. No per-token API billing is possible."
    : "Codex runs against the OpenAI API with a configured key. Every turn is billed per token.";
}
