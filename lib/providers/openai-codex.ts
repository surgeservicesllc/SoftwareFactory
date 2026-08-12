import "server-only";

import { parseWorkerResult, workerResultJsonSchema } from "@/lib/providers/contract";
import { WORKER_SYSTEM_INSTRUCTIONS, buildWorkerPrompt } from "@/lib/providers/prompt";
import {
  ProviderError,
  type ProviderConfigurationStatus,
  type ProviderRunStatus,
  type WorkerProvider,
  type WorkerRunHandle,
  type WorkerRunRequest,
  type WorkerRunResult,
  type WorkerRunSnapshot,
} from "@/lib/providers/types";

/**
 * OpenAI Codex worker adapter.
 *
 * Uses the supported server-side Responses API with a bearer credential read
 * only from server environment settings. Background mode gives the durable
 * worker a real create/poll/cancel lifecycle so a run never depends on one long
 * HTTP request or an open browser.
 *
 * This adapter never writes to a repository. It returns a proposal that the
 * server validates and commits through the existing hardened GitHub boundary.
 */

export const OPENAI_CODEX_PROVIDER_KEY = "openai_codex";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const RESULT_SCHEMA_NAME = "software_factory_worker_result";

export const OPENAI_CODEX_MODELS = [
  "gpt-5-codex",
  "gpt-5",
  "gpt-5-mini",
] as const;

type OpenAiResponseStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete";

type OpenAiResponse = {
  id?: string;
  status?: OpenAiResponseStatus;
  error?: { message?: string; code?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    status?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function readCredential(): string | null {
  const value = process.env.OPENAI_API_KEY?.trim();
  return value ? value : null;
}

function baseUrl(): string {
  const configured = process.env.OPENAI_BASE_URL?.trim();
  if (!configured) return DEFAULT_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ProviderError(
      "provider_not_configured",
      "OPENAI_BASE_URL must be a valid URL.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new ProviderError(
      "provider_not_configured",
      "OPENAI_BASE_URL must use HTTPS.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

function requireCredential(): string {
  const credential = readCredential();
  if (!credential) {
    throw new ProviderError(
      "provider_not_configured",
      "The OpenAI Codex worker is Not Connected because OPENAI_API_KEY is not configured.",
    );
  }
  return credential;
}

function mapHttpFailure(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      "provider_rejected",
      "OpenAI rejected the server credential. Rotate OPENAI_API_KEY and retry.",
    );
  }
  if (status === 429) {
    return new ProviderError(
      "provider_rate_limit",
      "OpenAI rate limited this request.",
      true,
    );
  }
  if (status >= 500) {
    return new ProviderError(
      "provider_outage",
      `OpenAI returned ${status}.`,
      true,
    );
  }
  // Bounded, non-credential excerpt so a bad request stays diagnosable.
  return new ProviderError(
    "provider_rejected",
    `OpenAI rejected the request (${status}): ${body.slice(0, 300)}`,
  );
}

async function callOpenAi(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<OpenAiResponse> {
  const credential = requireCredential();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        ...(process.env.OPENAI_ORGANIZATION?.trim()
          ? { "OpenAI-Organization": process.env.OPENAI_ORGANIZATION.trim() }
          : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderError(
      "provider_outage",
      error instanceof Error && error.name === "AbortError"
        ? "The OpenAI request timed out."
        : "The OpenAI request could not be completed.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) throw mapHttpFailure(response.status, text);

  try {
    return JSON.parse(text) as OpenAiResponse;
  } catch {
    throw new ProviderError(
      "provider_invalid_output",
      "OpenAI returned a response that was not valid JSON.",
    );
  }
}

function normalizeStatus(status: OpenAiResponseStatus | undefined): ProviderRunStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "in_progress":
      return "running";
    case "completed":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "incomplete":
      return "failed";
    default:
      return "running";
  }
}

function collectOutputText(response: OpenAiResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.type !== "reasoning") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

export const openAiCodexProvider: WorkerProvider = {
  key: OPENAI_CODEX_PROVIDER_KEY,
  label: "OpenAI Codex",
  defaultModel: OPENAI_CODEX_MODELS[0],
  models: OPENAI_CODEX_MODELS,

  isConfigured() {
    return readCredential() !== null;
  },

  describeConfiguration(): ProviderConfigurationStatus {
    if (!readCredential()) {
      return {
        state: "not_connected",
        label: "Not Connected",
        detail:
          "No server-side OpenAI credential is present, so no Codex run can start.",
        ownerAction:
          "Add a server-only OPENAI_API_KEY to the Vercel production environment, redeploy, then verify this connection.",
      };
    }
    return {
      state: "configured",
      label: "Configured",
      detail:
        "A server-side OpenAI credential is present. Configured does not prove connectivity; verify the connection to observe a live provider response.",
      ownerAction: null,
    };
  },

  async createRun(request: WorkerRunRequest): Promise<WorkerRunHandle> {
    const response = await callOpenAi("/responses", {
      method: "POST",
      body: {
        model: request.model,
        background: true,
        store: true,
        max_output_tokens: request.maxOutputTokens,
        instructions: WORKER_SYSTEM_INSTRUCTIONS,
        input: buildWorkerPrompt(request),
        metadata: { software_factory_run_id: request.runId },
        text: {
          format: {
            type: "json_schema",
            name: RESULT_SCHEMA_NAME,
            strict: true,
            schema: workerResultJsonSchema,
          },
        },
      },
    });

    if (!response.id) {
      throw new ProviderError(
        "provider_invalid_output",
        "OpenAI did not return a response identifier.",
      );
    }

    return {
      providerKey: OPENAI_CODEX_PROVIDER_KEY,
      externalRunId: response.id,
      model: request.model,
    };
  },

  async getRun(handle: WorkerRunHandle): Promise<WorkerRunSnapshot> {
    const response = await callOpenAi(
      `/responses/${encodeURIComponent(handle.externalRunId)}`,
      { method: "GET" },
    );

    const status = normalizeStatus(response.status);
    const errorMessage = response.error?.message
      ?? (response.status === "incomplete"
        ? `The provider stopped early: ${response.incomplete_details?.reason ?? "unknown reason"}.`
        : null);

    return {
      status,
      handle,
      errorMessage: status === "failed" ? (errorMessage ?? "The provider run failed.") : null,
      // Only coarse status labels are surfaced; provider reasoning is never persisted.
      progress: [`provider status: ${response.status ?? "unknown"}`],
    };
  },

  async cancelRun(handle: WorkerRunHandle): Promise<void> {
    try {
      await callOpenAi(
        `/responses/${encodeURIComponent(handle.externalRunId)}/cancel`,
        { method: "POST" },
      );
    } catch (error) {
      // A run that already reached a terminal state cannot be cancelled. That is
      // not a failure of the cancellation request.
      if (error instanceof ProviderError && error.code === "provider_rejected") return;
      throw error;
    }
  },

  async getResult(handle: WorkerRunHandle): Promise<WorkerRunResult> {
    const response = await callOpenAi(
      `/responses/${encodeURIComponent(handle.externalRunId)}`,
      { method: "GET" },
    );

    if (normalizeStatus(response.status) !== "succeeded") {
      throw new ProviderError(
        "provider_invalid_output",
        "The provider run has not completed, so no result is available.",
      );
    }

    const outputText = collectOutputText(response);
    if (!outputText.trim()) {
      throw new ProviderError(
        "provider_invalid_output",
        "The provider returned an empty result.",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(outputText);
    } catch {
      throw new ProviderError(
        "provider_invalid_output",
        "The provider result was not valid JSON.",
      );
    }

    try {
      return parseWorkerResult(payload);
    } catch (error) {
      throw new ProviderError(
        "provider_invalid_output",
        `The provider result did not satisfy the worker contract: ${
          error instanceof Error ? error.message.slice(0, 300) : "unknown error"
        }`,
      );
    }
  },
};
