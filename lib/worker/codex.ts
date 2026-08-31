import type { CodexOptions, ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CodexAuthResolution } from "@/lib/worker/auth";
import { controlledProcessEnvironment } from "@/lib/worker/env";
import { hasLikelySecret, redactText } from "@/lib/worker/redact";
import type { WorkerEvent, WorkerJob, WorkerUsage } from "@/lib/worker/types";
import type { PreparedWorkspace } from "@/lib/worker/workspace";

const responseSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    tests: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
    risks: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
  },
  required: ["summary", "tests", "risks"],
  additionalProperties: false,
} as const;

const modelShellEnvironmentNames = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "TERM",
  "CI",
  "GIT_TERMINAL_PROMPT",
  "NEXT_TELEMETRY_DISABLED",
  "NO_COLOR",
] as const;

const modelShellEnvironmentFilters = {
  CODEX_API_KEY: "exclude",
  OPENAI_API_KEY: "exclude",
  PATH: "include",
  SYSTEMROOT: "include",
  WINDIR: "include",
  COMSPEC: "include",
  PATHEXT: "include",
  TEMP: "include",
  TMP: "include",
  HOME: "include",
  USERPROFILE: "include",
  LANG: "include",
  LC_ALL: "include",
  TERM: "include",
  CI: "include",
  GIT_TERMINAL_PROMPT: "include",
  NEXT_TELEMETRY_DISABLED: "include",
  NO_COLOR: "include",
} as const;

function modelShellEnvironment(environment: Readonly<Record<string, string>>) {
  const allowed: Record<string, string> = {};
  for (const name of modelShellEnvironmentNames) {
    const value = environment[name];
    if (value !== undefined) allowed[name] = value;
  }
  return allowed;
}

/**
 * Write the subscription credential into the per-run CODEX_HOME.
 *
 * The per-run home is deliberately fresh, so the CLI cannot pick up ambient
 * credentials from the machine. That isolation is what makes seeding necessary:
 * there is nothing to find unless this puts it there. The file is written
 * owner-only, inside a directory that is removed with the run.
 */
export async function seedCodexHome(codexHome: string, authJson: string): Promise<void> {
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(path.join(codexHome, "auth.json"), authJson, { encoding: "utf8", mode: 0o600 });
}

export function codexHomeFor(workspace: PreparedWorkspace): string {
  return path.join(workspace.runDirectory, "codex-home");
}

export function codexClientOptions(
  auth: CodexAuthResolution,
  workspace: PreparedWorkspace,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CodexOptions {
  const codexHome = codexHomeFor(workspace);
  const clientEnvironment = {
    ...controlledProcessEnvironment(environment),
    CODEX_HOME: codexHome,
    HOME: codexHome,
    USERPROFILE: codexHome,
  };

  return {
    // Omitted entirely in subscription mode. Passing `undefined` rather than a
    // key is what keeps the run off per-token API billing: the CLI then falls
    // back to the auth.json this run seeded.
    ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
    env: clientEnvironment,
    config: {
      allow_login_shell: false,
      shell_environment_policy: {
        inherit: "none",
        experimental_use_profile: false,
        // Despite its name, false enables Codex's built-in KEY/SECRET/TOKEN exclusions.
        ignore_default_excludes: false,
        set: modelShellEnvironment(clientEnvironment),
        filters: modelShellEnvironmentFilters,
      },
    },
  };
}

type ThreadLike = {
  readonly id: string | null;
  runStreamed(input: string, options?: { outputSchema?: unknown; signal?: AbortSignal }): Promise<{
    events: AsyncGenerator<ThreadEvent>;
  }>;
};

export type CodexClientLike = {
  startThread(options: ThreadOptions): ThreadLike;
  resumeThread(id: string, options: ThreadOptions): ThreadLike;
};

export type CodexTurnResult = Readonly<{
  threadId: string;
  summary: string;
  tests: readonly string[];
  risks: readonly string[];
  usage: WorkerUsage;
}>;

export interface CodexSession {
  readonly threadId: string | null;
  readonly usage: WorkerUsage;
  readonly turns: number;
  run(prompt: string, signal: AbortSignal, onEvent: (event: WorkerEvent) => Promise<void>): Promise<CodexTurnResult>;
}

export class CodexBudgetError extends Error {
  readonly code = "budget_exhausted";

  constructor(message: string) {
    super(message);
    this.name = "CodexBudgetError";
  }
}

function zeroUsage(): WorkerUsage {
  return Object.freeze({
    turns: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
}

function addUsage(left: WorkerUsage, event: Extract<ThreadEvent, { type: "turn.completed" }>): WorkerUsage {
  return Object.freeze({
    turns: left.turns,
    inputTokens: left.inputTokens + event.usage.input_tokens,
    cachedInputTokens: left.cachedInputTokens + event.usage.cached_input_tokens,
    outputTokens: left.outputTokens + event.usage.output_tokens,
    reasoningOutputTokens: left.reasoningOutputTokens + event.usage.reasoning_output_tokens,
  });
}

function eventProjection(event: ThreadEvent): WorkerEvent | null {
  if (event.type === "thread.started") {
    return { kind: "agent_event", message: "Codex thread started." };
  }
  if (event.type === "turn.started") {
    return { kind: "agent_event", message: "Codex turn started." };
  }
  if (event.type === "turn.completed") {
    return {
      kind: "agent_event",
      message: "Codex turn completed.",
      details: {
        inputTokens: event.usage.input_tokens,
        outputTokens: event.usage.output_tokens,
        reasoningOutputTokens: event.usage.reasoning_output_tokens,
      },
    };
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return { kind: "agent_event", message: "Codex reported a terminal turn error." };
  }
  if (event.type !== "item.completed") return null;
  switch (event.item.type) {
    case "command_execution":
      return {
        kind: "agent_event",
        message: "Codex completed a workspace command.",
        details: {
          status: event.item.status,
          exitCode: event.item.exit_code ?? null,
        },
      };
    case "file_change":
      return {
        kind: "agent_event",
        message: "Codex applied a repository file change.",
        details: { status: event.item.status, fileCount: event.item.changes.length },
      };
    case "todo_list":
      return {
        kind: "agent_event",
        message: "Codex updated its bounded work plan.",
        details: {
          itemCount: event.item.items.length,
          completedCount: event.item.items.filter((item) => item.completed).length,
        },
      };
    case "mcp_tool_call":
      return { kind: "agent_event", message: "Codex completed an isolated tool call." };
    case "web_search":
      return { kind: "agent_event", message: "Codex completed a web search." };
    case "error":
      return { kind: "agent_event", message: "Codex reported a non-fatal item error." };
    case "agent_message":
    case "reasoning":
      return null;
  }
}

function taskPrompt(job: WorkerJob) {
  const criteria = job.acceptanceCriteria.length
    ? job.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")
    : "1. Implement the requested change and preserve existing behavior outside its scope.";
  return [
    "You are the Codex engineering worker for one pre-authorized SoftwareFactory run.",
    `Logical role: ${job.agentRole}. Risk classification: ${job.risk.toUpperCase()}.`,
    `Repository: ${job.repository.owner}/${job.repository.name}.`,
    `Exact base branch/SHA: ${job.repository.baseBranch} @ ${job.repository.baseSha}.`,
    "The worker already created an isolated factory/* branch in a disposable Git workspace.",
    "Read AGENTS.md and all repository-required context before material changes.",
    "Work only inside the current repository. Never access credentials, change .git metadata, push, open/approve/merge a PR, deploy, or modify provider settings.",
    "Network access is disabled. Do not attempt to enable it.",
    "Inspect first, implement the smallest complete change, run focused checks where useful, and review your final diff.",
    "Do not claim a test passed unless you ran it. The worker independently runs full deterministic validation after you finish.",
    "Owner command:",
    job.prompt,
    "Acceptance criteria:",
    criteria,
    "Finish with a concise structured summary, tests run, and residual risks.",
  ].join("\n\n");
}

function safeEvidenceList(value: unknown) {
  if (!Array.isArray(value)) return Object.freeze([] as string[]);
  return Object.freeze(value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, 20)
    .map((entry) => redactText(entry.trim(), { maximumLength: 500 }))
    .filter((entry) => !hasLikelySecret(entry)));
}

function parseStructuredResult(value: string) {
  try {
    const parsed = JSON.parse(value) as { summary?: unknown; tests?: unknown; risks?: unknown };
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      return Object.freeze({
        summary: redactText(parsed.summary.trim(), { maximumLength: 2_000 }),
        tests: safeEvidenceList(parsed.tests),
        risks: safeEvidenceList(parsed.risks),
      });
    }
  } catch {
    // The SDK normally enforces the schema; retain a safe fallback if it does not.
  }
  return Object.freeze({
    summary: redactText(value || "Codex completed without a summary.", { maximumLength: 2_000 }),
    tests: Object.freeze([] as string[]),
    risks: Object.freeze([] as string[]),
  });
}

export class CodexSdkAdapter {
  constructor(
    private readonly auth: CodexAuthResolution,
    private readonly clientFactory: (
      auth: CodexAuthResolution,
      workspace: PreparedWorkspace,
    ) => CodexClientLike,
  ) {}

  static async create(auth: CodexAuthResolution) {
    const { Codex } = await import("@openai/codex-sdk");
    return new CodexSdkAdapter(
      auth,
      (resolved, workspace) => new Codex(codexClientOptions(resolved, workspace)),
    );
  }

  /**
   * Values that must never survive into a persisted error message.
   *
   * In subscription mode the credential is a JSON document containing OAuth
   * tokens, so the individual token values are redacted rather than the whole
   * blob — a provider error is unlikely to quote the file verbatim, but very
   * capable of quoting one token out of it.
   */
  private redactionSecrets(): string[] {
    if (this.auth.apiKey) return [this.auth.apiKey];
    if (!this.auth.authJson) return [];

    const secrets: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === "string" && value.trim().length >= 8) secrets.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    try {
      collect(JSON.parse(this.auth.authJson));
    } catch {
      // Resolution already validated the shape; a parse failure here means the
      // value cannot be decomposed, so fall back to redacting it whole.
      return [this.auth.authJson];
    }
    return secrets;
  }

  /**
   * Place the subscription credential where the CLI will look, before any turn
   * runs. A no-op in api_key mode, where the SDK carries the key directly.
   */
  async prepare(workspace: PreparedWorkspace): Promise<void> {
    if (this.auth.authJson) {
      await seedCodexHome(codexHomeFor(workspace), this.auth.authJson);
    }
  }

  createSession(job: WorkerJob, workspace: PreparedWorkspace): CodexSession {
    const client = this.clientFactory(this.auth, workspace);
    const hasExactPhase1cAdmission = job.executionAdmission?.lane === "phase1c"
      && job.executionAdmission.provider === "openai";
    const threadOptions: ThreadOptions = {
      model: job.model,
      workingDirectory: workspace.directory,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      // A current Phase 1C admission binds the exact model. Some admitted
      // OpenAI models do not accept the legacy high-effort override, so let
      // the model/CLI select its supported default for that exact route.
      ...(hasExactPhase1cAdmission ? {} : { modelReasoningEffort: "high" }),
    };
    let thread: ThreadLike | null = null;
    let attemptUsage = zeroUsage();
    let cumulativeUsage = Object.freeze({ ...job.priorUsage });
    let turnCount = 0;

    return {
      get threadId() { return thread?.id ?? null; },
      get usage() { return cumulativeUsage; },
      get turns() { return cumulativeUsage.turns; },
      run: async (prompt, signal, onEvent) => {
        if (turnCount >= job.budget.maximumTurns) {
          throw new CodexBudgetError("The Codex turn budget is exhausted.");
        }
        if (attemptUsage.inputTokens >= job.budget.maximumInputTokens
          || attemptUsage.outputTokens >= job.budget.maximumOutputTokens) {
          throw new CodexBudgetError("The Codex token budget is exhausted.");
        }
        const estimatedPromptTokens = Math.ceil(prompt.length / 4);
        if (attemptUsage.inputTokens + estimatedPromptTokens > job.budget.maximumInputTokens) {
          throw new CodexBudgetError("The next Codex turn would exceed the input token budget.");
        }

        thread ??= client.startThread(threadOptions);
        turnCount += 1;
        cumulativeUsage = Object.freeze({
          ...cumulativeUsage,
          turns: cumulativeUsage.turns + 1,
        });
        const streamed = await thread.runStreamed(prompt, { outputSchema: responseSchema, signal });
        let finalResponse = "";
        let terminalFailure: string | null = null;
        const iterator = streamed.events[Symbol.asyncIterator]();
        let completedIteration = false;
        try {
          while (true) {
            let next: IteratorResult<ThreadEvent>;
            try {
              next = await iterator.next();
            } catch (error) {
              // The CLI can emit a useful, structured terminal error and then
              // exit non-zero with only a generic stderr trailer. Preserve the
              // safe provider message without masking event persistence errors.
              if (terminalFailure) {
                throw new Error(redactText(terminalFailure, {
                  maximumLength: 1_000,
                  secrets: this.redactionSecrets(),
                }));
              }
              throw error;
            }
            if (next.done) {
              completedIteration = true;
              break;
            }
            const event = next.value;
            if (event.type === "item.completed" && event.item.type === "agent_message") {
              finalResponse = event.item.text;
            }
            if (event.type === "turn.completed") {
              attemptUsage = addUsage(attemptUsage, event);
              cumulativeUsage = addUsage(cumulativeUsage, event);
            }
            if (event.type === "turn.failed") terminalFailure = event.error.message;
            if (event.type === "error") terminalFailure = event.message;
            const projection = eventProjection(event);
            if (projection) await onEvent(projection);
          }
        } finally {
          if (!completedIteration) {
            try {
              await iterator.return?.(undefined);
            } catch {
              // Preserve the primary provider or persistence failure. The
              // worker process still has its outer abort and hard timeout.
            }
          }
        }
        if (terminalFailure) {
          throw new Error(redactText(terminalFailure, {
            maximumLength: 1_000,
            secrets: this.redactionSecrets(),
          }));
        }
        const threadId = thread.id;
        if (!threadId) throw new Error("Codex did not return a resumable thread id.");
        if (attemptUsage.inputTokens > job.budget.maximumInputTokens
          || attemptUsage.outputTokens > job.budget.maximumOutputTokens) {
          throw new CodexBudgetError("Codex exceeded the configured token budget.");
        }
        const structured = parseStructuredResult(finalResponse);
        return Object.freeze({
          threadId,
          ...structured,
          usage: cumulativeUsage,
        });
      },
    };
  }

  initialPrompt(job: WorkerJob) {
    return taskPrompt(job);
  }
}
