import "server-only";

import OpenAI from "openai";

import { BaseProviderAdapter, type ProviderExecution } from "@/lib/providers/base-adapter";
import {
  readProviderCredential,
  resolveProviderConfiguration,
  type ProviderRuntimeConfiguration,
} from "@/lib/providers/config";
import { PROVIDER_RESULT_JSON_SCHEMA } from "@/lib/providers/contract";
import { ProviderError, connectionStateForError, toProviderError } from "@/lib/providers/errors";
import {
  PROVIDER_LABELS,
  type ProviderCapability,
  type ProviderHealth,
  type ProviderId,
  type ProviderModel,
  type ProviderRunRequest,
} from "@/lib/providers/types";

const PROVIDER: ProviderId = "openai";

const CAPABILITIES: readonly ProviderCapability[] = Object.freeze([
  "planning",
  "architecture_analysis",
  "code_authoring",
  "code_review",
  "security_review",
  "qa_analysis",
  "reporting",
  "structured_output",
]);

const RESULT_FORMAT_NAME = "softwarefactory_artifact";

/**
 * OpenAI / Codex adapter built on the official `openai` SDK Responses API.
 *
 * Unlike the Anthropic adapter there is no built-in default model: this
 * codebase has no verified OpenAI model catalogue, so guessing an identifier
 * would produce confident failures at run time. The owner names a model with
 * `OPENAI_DEFAULT_MODEL`, and `listModels()` enumerates the real options from
 * the account once a credential is present. Until a model is selected the
 * provider reports **Not Configured**.
 */
export class OpenAIProviderAdapter extends BaseProviderAdapter {
  readonly id = PROVIDER;
  readonly displayName = PROVIDER_LABELS[PROVIDER];
  readonly capabilities = CAPABILITIES;

  private readonly configuration: ProviderRuntimeConfiguration;

  constructor(configuration: ProviderRuntimeConfiguration = resolveProviderConfiguration(PROVIDER)) {
    super();
    this.configuration = configuration;
  }

  get defaultModel(): string | null {
    return this.configuration.defaultModel;
  }

  async checkHealth(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const unavailable = this.unavailableError({ requireModel: false });
    if (unavailable) {
      return Object.freeze({
        provider: PROVIDER,
        state: connectionStateForError(unavailable.code),
        checkedAt,
        detail: unavailable.message,
        latencyMs: null,
        defaultModel: this.configuration.defaultModel,
      });
    }

    const startedMs = Date.now();
    try {
      await this.client().models.list();
      const latencyMs = Date.now() - startedMs;

      // A reachable credential without a selected model is still unusable.
      if (!this.configuration.defaultModel) {
        return Object.freeze({
          provider: PROVIDER,
          state: "not_configured",
          checkedAt,
          detail:
            "The credential reached OpenAI, but OPENAI_DEFAULT_MODEL is not set so no model is selected.",
          latencyMs,
          defaultModel: null,
        });
      }

      return Object.freeze({
        provider: PROVIDER,
        state: "connected",
        checkedAt,
        detail: "The OpenAI model catalogue responded to a live request.",
        latencyMs,
        defaultModel: this.configuration.defaultModel,
      });
    } catch (error) {
      const providerError = toProviderError(error, PROVIDER);
      return Object.freeze({
        provider: PROVIDER,
        state: connectionStateForError(providerError.code),
        checkedAt,
        detail: providerError.message,
        latencyMs: Date.now() - startedMs,
        defaultModel: this.configuration.defaultModel,
      });
    }
  }

  async listModels(): Promise<readonly ProviderModel[]> {
    const unavailable = this.unavailableError({ requireModel: false });
    if (unavailable) throw unavailable;

    try {
      const page = await this.client().models.list();
      return Object.freeze(
        page.data.map((model) =>
          Object.freeze({
            id: model.id,
            displayName: model.id,
            // The OpenAI models endpoint does not publish context or output
            // limits, so these stay null rather than being invented.
            maxInputTokens: null,
            maxOutputTokens: null,
          }),
        ),
      );
    } catch (error) {
      throw toProviderError(error, PROVIDER);
    }
  }

  protected async performRequest(
    request: ProviderRunRequest,
    prompts: { readonly system: string; readonly task: string },
    signal: AbortSignal,
  ): Promise<ProviderExecution> {
    const unavailable = this.unavailableError({ requireModel: true });
    if (unavailable) throw unavailable;

    let response: OpenAI.Responses.Response;
    try {
      response = await this.client().responses.create(
        {
          model: request.model,
          instructions: prompts.system,
          input: prompts.task,
          max_output_tokens: request.maxOutputTokens,
          text: {
            format: {
              type: "json_schema",
              name: RESULT_FORMAT_NAME,
              strict: true,
              schema: PROVIDER_RESULT_JSON_SCHEMA as unknown as Record<string, unknown>,
            },
          },
        },
        { signal, timeout: request.timeoutMs },
      );
    } catch (error) {
      throw toProviderError(error, PROVIDER);
    }

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason ?? "unknown";
      throw new ProviderError(
        reason === "content_filter" ? "request_rejected" : "invalid_response",
        reason === "content_filter"
          ? "OpenAI declined this request on content-policy grounds."
          : "The response ended before the artifact was complete.",
        PROVIDER,
      );
    }
    if (response.status === "failed") {
      throw new ProviderError("upstream_unavailable", "OpenAI reported the response as failed.", PROVIDER);
    }

    return Object.freeze({
      providerRunId: response.id,
      text: response.output_text,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
    });
  }

  private unavailableError({ requireModel }: { requireModel: boolean }): ProviderError | null {
    if (this.configuration.disabled) {
      return new ProviderError(
        "disabled",
        this.configuration.unavailableReason ?? "The provider is disabled.",
        PROVIDER,
      );
    }
    if (!this.configuration.configured) {
      return new ProviderError(
        "not_configured",
        this.configuration.unavailableReason ?? "OPENAI_API_KEY is not set on the server.",
        PROVIDER,
      );
    }
    if (requireModel && !this.configuration.defaultModel) {
      return new ProviderError(
        "not_configured",
        "OPENAI_DEFAULT_MODEL is not set, so no OpenAI model is selected.",
        PROVIDER,
      );
    }
    return null;
  }

  private client(): OpenAI {
    const apiKey = readProviderCredential(PROVIDER);
    if (!apiKey) {
      throw new ProviderError("not_configured", "OPENAI_API_KEY is not set on the server.", PROVIDER);
    }
    return new OpenAI({
      apiKey,
      ...(this.configuration.baseUrl ? { baseURL: this.configuration.baseUrl } : {}),
      timeout: this.configuration.requestTimeoutMs,
      maxRetries: 0,
    });
  }
}
