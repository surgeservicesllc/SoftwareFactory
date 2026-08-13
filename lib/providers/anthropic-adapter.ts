import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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

const PROVIDER: ProviderId = "anthropic";

/**
 * Capabilities this adapter declares. Declaring a capability is a statement
 * that the adapter can carry the task shape end to end, not a quality claim.
 */
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

/**
 * Anthropic Messages API adapter.
 *
 * Uses the official `@anthropic-ai/sdk`. Authentication is a server-side API
 * key read from the environment; no browser session, consumer login, or stored
 * password is involved anywhere in this path.
 */
export class AnthropicProviderAdapter extends BaseProviderAdapter {
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
    const unavailable = this.unavailableError();
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
      await this.client().models.list({ limit: 1 });
      return Object.freeze({
        provider: PROVIDER,
        state: "connected",
        checkedAt,
        detail: "The Anthropic model catalogue responded to a live request.",
        latencyMs: Date.now() - startedMs,
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
    const unavailable = this.unavailableError();
    if (unavailable) throw unavailable;

    try {
      const page = await this.client().models.list({ limit: 100 });
      return Object.freeze(
        page.data.map((model) =>
          Object.freeze({
            id: model.id,
            displayName: model.display_name,
            maxInputTokens: model.max_input_tokens,
            maxOutputTokens: model.max_tokens,
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
    const unavailable = this.unavailableError();
    if (unavailable) throw unavailable;

    let response: Anthropic.Message;
    try {
      response = await this.client().messages.create(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: prompts.system,
          messages: [{ role: "user", content: prompts.task }],
          thinking: { type: "adaptive" },
          output_config: {
            effort: "high",
            format: {
              type: "json_schema",
              schema: PROVIDER_RESULT_JSON_SCHEMA as unknown as Record<string, unknown>,
            },
          },
        },
        { signal, timeout: request.timeoutMs },
      );
    } catch (error) {
      throw toProviderError(error, PROVIDER);
    }

    // A refusal is a content decision, not a transport failure. It must reach
    // the owner rather than be retried on another provider.
    if (response.stop_reason === "refusal") {
      throw new ProviderError(
        "request_rejected",
        `Anthropic declined this request${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}.`,
        PROVIDER,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new ProviderError(
        "invalid_response",
        "The response hit the output token ceiling before the artifact was complete.",
        PROVIDER,
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return Object.freeze({
      providerRunId: response.id,
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens,
    });
  }

  private unavailableError(): ProviderError | null {
    if (this.configuration.disabled) {
      return new ProviderError(
        "disabled",
        this.configuration.unavailableReason ?? "The provider is disabled.",
        PROVIDER,
      );
    }
    if (!this.configuration.configured || !this.configuration.defaultModel) {
      return new ProviderError(
        "not_configured",
        this.configuration.unavailableReason ?? "The provider is not configured.",
        PROVIDER,
      );
    }
    return null;
  }

  private client(): Anthropic {
    const apiKey = readProviderCredential(PROVIDER);
    if (!apiKey) {
      throw new ProviderError("not_configured", "ANTHROPIC_API_KEY is not set on the server.", PROVIDER);
    }
    return new Anthropic({
      apiKey,
      ...(this.configuration.baseUrl ? { baseURL: this.configuration.baseUrl } : {}),
      timeout: this.configuration.requestTimeoutMs,
      // Retry and fallback policy belongs to the routing engine, which records
      // every attempt. The SDK must not retry behind its back.
      maxRetries: 0,
    });
  }
}
