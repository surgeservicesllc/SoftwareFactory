import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ProviderExecution } from "@/lib/providers/base-adapter";
import {
  claudeRedactionSecrets,
  describeClaudeAuth,
  type ClaudeAuthResolution,
} from "@/lib/providers/claude-auth";
import { PROVIDER_RESULT_JSON_SCHEMA } from "@/lib/providers/contract";
import { ProviderError } from "@/lib/providers/errors";
import type { ProviderRunRequest } from "@/lib/providers/types";
import { controlledProcessEnvironment } from "@/lib/worker/env";

/**
 * Execute one Phase 2A advisory task through the Claude Code CLI.
 *
 * This is a *transport*, not a second provider. The Anthropic adapter still owns
 * the identity, the capability declaration, the run registry, and the structured
 * result contract; all this changes is how the round trip reaches Claude. Phase
 * 2A's requirement is one common provider abstraction, so a second orchestration
 * pipeline would be the wrong answer even where it would be easier.
 *
 * ## Why the environment is built rather than inherited
 *
 * The single most important line in this file is the one that does *not* spread
 * `process.env` into the child.
 *
 * A machine running SoftwareFactory may itself be signed in to Claude — the
 * development container for this repository is. Inherit its environment and the
 * CLI authenticates with whatever ambient credential it finds, the run succeeds,
 * and the success proves nothing: not that the configured credential works, not
 * that an unconfigured deployment fails closed, not that the owner's
 * subscription is the one being used. It would be a canary that is green
 * because the cage is open.
 *
 * So the child gets `controlledProcessEnvironment` — the same allowlist the
 * Codex worker uses, carrying no `ANTHROPIC_*` and no `CLAUDE_*` — plus exactly
 * the credential this resolution carries, and a per-run `CLAUDE_CONFIG_DIR`
 * that starts empty. If SoftwareFactory did not supply a working credential, the
 * run fails. That is the property worth having.
 *
 * ## Why the schema is passed, not described
 *
 * The API transport carries `PROVIDER_RESULT_JSON_SCHEMA` in `output_config`,
 * where the provider enforces it. The system prompt in `contract.ts` therefore
 * only has to say "reply with a single JSON object matching the required
 * schema" — it never includes the schema, because on that path it does not need
 * to.
 *
 * Reusing those prompts here without `outputFormat` was a real defect, and the
 * live canary caught it on its first run. Claude did the work correctly, read
 * the right files, and returned well-formed JSON in a schema it invented —
 * `{task, project, answer: {...}}` instead of
 * `{summary, findings, recommendations, …}` — because it had been told to match
 * a schema nobody ever showed it. `parseProviderResult` rejected it, as it
 * should: the artifact would have been discarded after a full run.
 *
 * So the schema travels with the request, and the answer is read from
 * `structured_output` rather than the free-text `result`. Enforcement, not
 * persuasion — the same guarantee the API path already had.
 *
 * ## Why the tools are read-only
 *
 * Phase 2A's boundary is analysis: a provider run never writes a repository,
 * merges, deploys, or approves. Reading is not writing, and a review that cannot
 * open the file it reviews is worth little, so the default tool set is
 * `Read`/`Glob`/`Grep` and every mutating or executing tool is denied by name as
 * well as omitted. Denying explicitly matters because `allowedTools` is a filter
 * over an evolving built-in set: a tool added to a future CLI would be absent
 * from an allowlist but is also absent from a denylist, so the two together are
 * narrower than either alone.
 */

/** Read-only inspection. No Bash, no Write, no Edit, no network fetch. */
const DEFAULT_ALLOWED_TOOLS: readonly string[] = Object.freeze(["Read", "Glob", "Grep"]);

/**
 * Denied by name as well as omitted from the allowlist. Belt and braces, because
 * these are the tools whose accidental availability would breach the Phase 2A
 * boundary rather than merely widen it.
 */
const DENIED_TOOLS: readonly string[] = Object.freeze([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
]);

/**
 * One turn. An advisory task is a single question with a single structured
 * answer; a multi-turn loop here would be an agent, which is Phase 1C's job and
 * explicitly not a second worker to be built in 2A.
 */
const MAX_TURNS = 1;

export interface ClaudeCliTransportOptions {
  /** Working directory the read-only tools are scoped to. */
  readonly workingDirectory: string;
  readonly allowedTools?: readonly string[];
  /** Injected for tests; defaults to the real SDK. */
  readonly queryFn?: ClaudeQueryFn;
}

/** The slice of the Agent SDK this transport uses. */
export type ClaudeQueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<ClaudeSdkMessage>;

export type ClaudeSdkMessage =
  | {
      type: "result";
      subtype: string;
      is_error: boolean;
      result?: string;
      structured_output?: unknown;
      session_id?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
  | { type: string; [key: string]: unknown };

function isResultMessage(
  message: ClaudeSdkMessage,
): message is Extract<ClaudeSdkMessage, { type: "result" }> {
  return message.type === "result";
}

/**
 * Redact every secret this resolution carries out of a string bound for an
 * audit trail. A CLI failure can quote its own environment back at you.
 */
function redact(text: string, auth: ClaudeAuthResolution): string {
  let redacted = text;
  for (const secret of claudeRedactionSecrets(auth)) {
    if (secret.length >= 8) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

/**
 * Seed a fresh config directory with the subscription credential.
 *
 * The directory is per-run and starts empty, so the CLI cannot pick up ambient
 * credentials from the machine. That isolation is what makes seeding necessary:
 * there is nothing to find unless this puts it there.
 */
async function seedConfigDirectory(configDir: string, credentialsJson: string): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(configDir, ".credentials.json"), credentialsJson, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function childEnvironment(
  auth: ClaudeAuthResolution,
  configDir: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    ...controlledProcessEnvironment(),
    CLAUDE_CONFIG_DIR: configDir,
    HOME: configDir,
    // Nothing in an advisory run needs telemetry or an update check, and both
    // are outbound requests from a process holding a credential.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
  };

  if (auth.oauthToken) environment.CLAUDE_CODE_OAUTH_TOKEN = auth.oauthToken;
  // Set only in api_key mode, which the owner opted into explicitly. In
  // subscription mode this key is absent from the child entirely, so there is no
  // credential present that could bill per token.
  if (auth.apiKey) environment.ANTHROPIC_API_KEY = auth.apiKey;

  return environment;
}

async function loadSdkQuery(): Promise<ClaudeQueryFn> {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    return sdk.query as unknown as ClaudeQueryFn;
  } catch {
    throw new ProviderError(
      "not_configured",
      "The Claude Agent SDK is not installed on the server, so no Claude execution is possible.",
      "anthropic",
    );
  }
}

/**
 * Run one advisory task and return the raw round trip. Parsing and validation
 * stay in `BaseProviderAdapter`, so this path produces exactly the artifact the
 * API path produces.
 */
export async function executeClaudeThroughCli(
  request: ProviderRunRequest,
  prompts: { readonly system: string; readonly task: string },
  signal: AbortSignal,
  auth: ClaudeAuthResolution,
  options: ClaudeCliTransportOptions,
): Promise<ProviderExecution> {
  const queryFn = options.queryFn ?? (await loadSdkQuery());
  const configDir = path.join(tmpdir(), `softwarefactory-claude-${randomUUID()}`);

  try {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    if (auth.credentialsJson) await seedConfigDirectory(configDir, auth.credentialsJson);

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });

    let text = "";
    let sessionId: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens: number | null = null;
    let sawResult = false;
    let failureSubtype: string | null = null;

    try {
      const stream = queryFn({
        prompt: prompts.task,
        options: {
          model: request.model,
          systemPrompt: prompts.system,
          cwd: options.workingDirectory,
          allowedTools: [...(options.allowedTools ?? DEFAULT_ALLOWED_TOOLS)],
          disallowedTools: [...DENIED_TOOLS],
          permissionMode: "default",
          maxTurns: MAX_TURNS,
          // The schema travels with the request, not merely as a sentence in the
          // system prompt. See the note on SCHEMA_ENFORCEMENT below.
          outputFormat: { type: "json_schema", schema: PROVIDER_RESULT_JSON_SCHEMA },
          env: childEnvironment(auth, configDir),
          abortController: controller,
          pathToClaudeCodeExecutable: process.env.SOFTWAREFACTORY_CLAUDE_EXECUTABLE || undefined,
        },
      });

      for await (const message of stream) {
        if (!isResultMessage(message)) continue;
        sawResult = true;
        if (message.is_error) {
          failureSubtype = message.subtype;
          continue;
        }
        // `structured_output` is the schema-enforced object. `result` is the
        // model's free text, which is a fallback rather than the answer: it is
        // what the model would have said without enforcement, and on this
        // transport that is exactly what cannot be trusted to match.
        text =
          message.structured_output !== undefined && message.structured_output !== null
            ? JSON.stringify(message.structured_output)
            : (message.result ?? "");
        sessionId = message.session_id ?? null;
        inputTokens = message.usage?.input_tokens ?? 0;
        outputTokens = message.usage?.output_tokens ?? 0;
        cachedInputTokens = message.usage?.cache_read_input_tokens ?? null;
      }
    } finally {
      signal.removeEventListener("abort", abort);
    }

    if (signal.aborted) {
      throw new ProviderError("cancelled", "The Claude run was cancelled.", "anthropic");
    }
    if (failureSubtype) {
      throw new ProviderError(
        failureSubtype === "error_max_turns"
        || failureSubtype === "error_max_structured_output_retries"
          ? "invalid_response"
          : "upstream_unavailable",
        redact(`Claude ended the run with ${failureSubtype}.`, auth),
        "anthropic",
      );
    }
    if (!sawResult) {
      // The stream ending without a result is a distinct failure from a result
      // that says it failed, and conflating them would hide a crashed CLI.
      throw new ProviderError(
        "upstream_unavailable",
        "The Claude CLI stream ended without returning a result.",
        "anthropic",
      );
    }

    return Object.freeze({
      providerRunId: sessionId,
      text,
      inputTokens,
      outputTokens,
      cachedInputTokens,
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const message = error instanceof Error ? error.message : "The Claude CLI failed.";
    throw new ProviderError("upstream_unavailable", redact(message, auth), "anthropic");
  } finally {
    // The credential must not outlive the run, whatever happened to it.
    await rm(configDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Describe the transport for a surface, without naming any credential value. */
export function describeClaudeTransport(auth: ClaudeAuthResolution): string {
  return describeClaudeAuth(auth);
}
