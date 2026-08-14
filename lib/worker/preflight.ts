import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CodexAuthResolution } from "@/lib/worker/auth";

const execFileAsync = promisify(execFile);
const EXPECTED_CODEX_VERSION = "codex-cli 0.147.0";
const MAXIMUM_RESPONSE_BYTES = 65_536;

export class WorkerPreflightError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WorkerPreflightError";
  }
}

type RunCommand = (
  file: string,
  args: readonly string[],
  options: { env: Readonly<Record<string, string>>; maxBuffer: number; timeout: number },
) => Promise<{ stdout: string }>;

function credentialFreeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const allowed: Record<string, string> = {};
  for (const name of [
    "PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
    "TEMP", "TMP", "HOME", "USERPROFILE", "CI", "NO_COLOR",
  ]) {
    const value = environment[name];
    if (value !== undefined) allowed[name] = value;
  }
  return allowed;
}

async function defaultRunCommand(
  file: string,
  args: readonly string[],
  options: { env: Readonly<Record<string, string>>; maxBuffer: number; timeout: number },
) {
  const result = await execFileAsync(file, [...args], {
    ...options,
    encoding: "utf8",
    env: options.env as unknown as NodeJS.ProcessEnv,
  });
  return { stdout: String(result.stdout) };
}

export async function verifyWorkerProviderAccess(input: {
  auth: CodexAuthResolution;
  model: string;
  executeProbe?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
  fetcher?: typeof fetch;
  runCommand?: RunCommand;
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(input.model)) {
    throw new WorkerPreflightError("invalid_model", "The configured Codex model name is invalid.");
  }

  const runCommand = input.runCommand ?? defaultRunCommand;
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const commandOptions = {
    env: credentialFreeEnvironment(input.environment ?? process.env),
    maxBuffer: 64 * 1_024,
    timeout: 15_000,
  } as const;
  let version: string;
  try {
    version = (await runCommand(
      command,
      ["--no-install", "codex", "--version"],
      commandOptions,
    )).stdout.trim();
    await runCommand(
      command,
      ["--no-install", "codex", "exec", "--help"],
      commandOptions,
    );
  } catch {
    throw new WorkerPreflightError(
      "codex_cli_unavailable",
      "The pinned Codex CLI could not start.",
    );
  }
  if (version !== EXPECTED_CODEX_VERSION) {
    throw new WorkerPreflightError(
      "codex_cli_version_mismatch",
      "The installed Codex CLI version does not match the reviewed release.",
    );
  }

  // The whole point of subscription mode is that no request reaches the billed
  // API surface — not on a turn, and not on a preflight either. Verifying the
  // pinned CLI is the last check this mode performs. Credential *usability* is
  // proven by the run itself; a preflight that called the API to prove a
  // zero-token configuration would defeat what it was checking.
  if (input.auth.mode === "subscription") return;

  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      `https://api.openai.com/v1/models/${encodeURIComponent(input.model)}`,
      {
        headers: { Authorization: `Bearer ${input.auth.apiKey ?? ""}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new WorkerPreflightError(
      "openai_unavailable",
      "OpenAI model access could not be verified.",
    );
  }
  if (!response.ok) {
    throw await classifiedHttpError(response, "model access");
  }
  await verifyResponseDescriptor(response, {
    expectedId: input.model,
    expectedObject: "model",
    expectedStatus: null,
  });

  if (!input.executeProbe) return;

  try {
    response = await (input.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.auth.apiKey ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "Return exactly READY.", max_output_tokens: 128, model: input.model, store: false }),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new WorkerPreflightError(
      "openai_unavailable",
      "OpenAI execution preflight could not be completed.",
    );
  }
  if (!response.ok) {
    throw await classifiedHttpError(response, "execution preflight");
  }
  await verifyResponseDescriptor(response, {
    expectedId: null,
    expectedObject: "response",
    expectedStatus: "completed",
  });
}

async function classifiedHttpError(response: Response, operation: string) {
  let classification = "unclassified";
  try {
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength <= MAXIMUM_RESPONSE_BYTES) {
      const text = await response.text();
      if (text.length <= MAXIMUM_RESPONSE_BYTES) {
        const body = JSON.parse(text) as { error?: { code?: unknown; type?: unknown } };
        const candidate = typeof body.error?.code === "string"
          ? body.error.code
          : body.error?.type;
        if (typeof candidate === "string" && /^[a-z0-9_.-]{1,80}$/i.test(candidate)) {
          classification = candidate.toLowerCase();
        }
      }
    }
  } catch {
    classification = "unclassified";
  }
  return new WorkerPreflightError(
    `openai_http_${response.status}_${classification}`,
    `OpenAI ${operation} returned HTTP ${response.status} (${classification}).`,
  );
}

async function verifyResponseDescriptor(
  response: Response,
  expected: { expectedId: string | null; expectedObject: string; expectedStatus: string | null },
) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAXIMUM_RESPONSE_BYTES) {
    throw new WorkerPreflightError(
      "openai_response_too_large",
      "OpenAI returned an oversized execution response.",
    );
  }
  const responseText = await response.text();
  if (responseText.length > MAXIMUM_RESPONSE_BYTES) {
    throw new WorkerPreflightError(
      "openai_response_too_large",
      "OpenAI returned an oversized execution response.",
    );
  }
  let descriptor: { id?: unknown; object?: unknown; status?: unknown };
  try {
    descriptor = JSON.parse(responseText) as {
      id?: unknown;
      object?: unknown;
      status?: unknown;
    };
  } catch {
    throw new WorkerPreflightError(
      "openai_invalid_response",
      "OpenAI returned an invalid execution response.",
    );
  }
  if ((expected.expectedId === null ? typeof descriptor.id !== "string" : descriptor.id !== expected.expectedId)
    || descriptor.object !== expected.expectedObject
    || (expected.expectedStatus !== null && descriptor.status !== expected.expectedStatus)) {
    throw new WorkerPreflightError(
      "openai_execution_mismatch",
      "OpenAI returned an unexpected execution response.",
    );
  }
}
