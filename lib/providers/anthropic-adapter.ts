import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { BaseProviderAdapter, type ProviderExecution } from "@/lib/providers/base-adapter";
import {
  describeClaudeAuth,
  tryResolveClaudeAuth,
  type ClaudeAuthFailure,
} from "@/lib/providers/claude-auth";
import {
  executeClaudeThroughCli,
  type ClaudeQueryFn,
} from "@/lib/providers/claude-cli-transport";
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
 * How Claude is currently reachable.
 *
 * `unavailable` is separate from `disabled` on purpose. Disabled is a decision
 * someone made; unavailable is a configuration that has not been completed. A
 * surface that showed both as "off" would hide which one an owner can fix.
 */
export interface ClaudeTransportStatus {
  readonly kind: "subscription" | "api_key" | "unavailable" | "disabled";
  /** True when this transport cannot consume per-token API credit. */
  readonly zeroToken: boolean;
  readonly detail: string;
  readonly failureCode?: ClaudeAuthFailure;
}

/**
 * The health probe: the smallest request that still proves a live round trip.
 *
 * It bypasses the structured-result schema deliberately. The transport returns
 * raw text and `BaseProviderAdapter` does the parsing, so a probe that only
 * needs "did Claude answer" can ask for one word rather than a full artifact.
 */
const HEALTH_PROBE_TIMEOUT_MS = 60_000;
const HEALTH_PROBE_SYSTEM = "Reply with exactly one word and nothing else.";
const HEALTH_PROBE_PROMPT = "Reply with the single word: OK";
const EMPTY_PROBE_CONTEXT = Object.freeze({
  projectName: "SoftwareFactory health probe",
  repositoryFullName: null,
  defaultBranch: null,
  riskLevel: "GREEN" as const,
  priorArtifacts: Object.freeze([]),
  memoryExcerpts: Object.freeze([]),
});

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
 * Claude adapter, with two transports behind one identity.
 *
 * **Subscription (default).** Execution goes through the Claude Code CLI, which
 * authenticates from credential material minted by the owner's own login. No
 * per-token API credit is consumed, which is what lets normal operation cost
 * nothing beyond the subscription the owner already has.
 *
 * **API key (opt-in).** The official `@anthropic-ai/sdk` against
 * `ANTHROPIC_API_KEY`. Every request is billed per token, so it is never
 * selected implicitly — `resolveClaudeAuth` refuses to reach it by accident.
 *
 * Both are the same provider: same id, same capabilities, same structured
 * result, same run registry. A transport is how the round trip travels, not
 * what answered, and nothing downstream needs to know which one ran. That is
 * deliberate — Phase 2A requires one provider abstraction, and a second
 * pipeline for the free path would have quietly become a second provider.
 *
 * No browser session, consumer login, or stored password is involved in either
 * path.
 */
export class AnthropicProviderAdapter extends BaseProviderAdapter {
  readonly id = PROVIDER;
  readonly displayName = PROVIDER_LABELS[PROVIDER];
  readonly capabilities = CAPABILITIES;

  private readonly configuration: ProviderRuntimeConfiguration;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly transportOverride: ClaudeQueryFn | null;

  constructor(
    configuration: ProviderRuntimeConfiguration = resolveProviderConfiguration(PROVIDER),
    options: {
      readonly environment?: Readonly<Record<string, string | undefined>>;
      /** Injected for tests; the real SDK is loaded lazily otherwise. */
      readonly queryFn?: ClaudeQueryFn;
    } = {},
  ) {
    super();
    this.configuration = configuration;
    this.environment = options.environment ?? process.env;
    this.transportOverride = options.queryFn ?? null;
  }

  get defaultModel(): string | null {
    return this.configuration.defaultModel;
  }

  /**
   * Which transport this adapter would use, and why.
   *
   * Exposed because a surface has to be able to say *how* Claude is reached
   * without guessing, and because "connected" alone does not distinguish a free
   * subscription run from a billed API one — which is exactly the distinction
   * the owner is entitled to see before work is dispatched.
   */
  claudeTransport(): ClaudeTransportStatus {
    if (this.configuration.disabled) {
      return Object.freeze({
        kind: "disabled" as const,
        zeroToken: true,
        detail: this.configuration.unavailableReason ?? "The provider is disabled.",
      });
    }

    const resolved = tryResolveClaudeAuth(this.environment);
    if ("failure" in resolved) {
      // An API key present without the opt-in resolves here as a *failure*, not
      // as a usable billed transport. That is the point: the billed path has to
      // be chosen, never fallen into.
      return Object.freeze({
        kind: "unavailable" as const,
        zeroToken: true,
        detail: resolved.failure.message,
        failureCode: resolved.failure.code,
      });
    }

    return Object.freeze({
      kind: resolved.resolution.mode === "subscription" ? ("subscription" as const) : ("api_key" as const),
      zeroToken: resolved.resolution.zeroToken,
      detail: describeClaudeAuth(resolved.resolution),
    });
  }

  async checkHealth(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const transport = this.claudeTransport();

    if (transport.kind === "disabled" || transport.kind === "unavailable") {
      return Object.freeze({
        provider: PROVIDER,
        state: transport.kind === "disabled" ? ("disabled" as const) : ("not_configured" as const),
        checkedAt,
        detail: transport.detail,
        latencyMs: null,
        defaultModel: this.configuration.defaultModel,
      });
    }

    if (transport.kind === "subscription") {
      return this.checkSubscriptionHealth(checkedAt);
    }

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

  /**
   * Prove the subscription transport with a real round trip.
   *
   * There is no catalogue endpoint to ping here, and a check that only confirmed
   * the credential parses would report **Connected** for a revoked token. The
   * cheapest honest probe is the smallest real query, so that is what this is:
   * one turn, no tools, a two-token answer. It costs a subscription request and
   * no API credit.
   */
  private async checkSubscriptionHealth(checkedAt: string): Promise<ProviderHealth> {
    const resolved = tryResolveClaudeAuth(this.environment);
    if ("failure" in resolved) {
      return Object.freeze({
        provider: PROVIDER,
        state: "not_configured" as const,
        checkedAt,
        detail: resolved.failure.message,
        latencyMs: null,
        defaultModel: this.configuration.defaultModel,
      });
    }

    const startedMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
    try {
      const execution = await executeClaudeThroughCli(
        {
          runId: `health-${Date.now()}`,
          taskKind: "status_report",
          agentRole: "orchestrator",
          agentId: "health-probe",
          instructions: HEALTH_PROBE_PROMPT,
          context: EMPTY_PROBE_CONTEXT,
          model: this.configuration.defaultModel ?? "claude-opus-5",
          maxOutputTokens: 64,
          timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
        },
        { system: HEALTH_PROBE_SYSTEM, task: HEALTH_PROBE_PROMPT },
        controller.signal,
        resolved.resolution,
        {
          workingDirectory: process.cwd(),
          allowedTools: [],
          ...(this.transportOverride ? { queryFn: this.transportOverride } : {}),
        },
      );

      const answered = execution.text.trim().length > 0;
      return Object.freeze({
        provider: PROVIDER,
        state: answered ? ("connected" as const) : ("error" as const),
        checkedAt,
        detail: answered
          ? `Claude answered a live request through the ${describeClaudeAuth(resolved.resolution)}`
          : "Claude returned an empty response to the health probe.",
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
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<readonly ProviderModel[]> {
    const transport = this.claudeTransport();
    if (transport.kind === "subscription") {
      // The CLI exposes no model catalogue. Returning an empty list would read
      // as "this provider has no models", which is false and would be believed;
      // a named refusal says the enumeration is unavailable while the provider
      // is not. Models reach routing through the owner's Phase 2C declaration.
      throw new ProviderError(
        "capability_unsupported",
        "The Claude subscription transport cannot enumerate the model catalogue. Declare the models "
        + "you intend to route to instead, through POST /api/resources/models.",
        PROVIDER,
      );
    }

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
    const transport = this.claudeTransport();

    if (transport.kind === "disabled") {
      throw new ProviderError("disabled", transport.detail, PROVIDER);
    }
    if (transport.kind === "subscription") {
      const resolved = tryResolveClaudeAuth(this.environment);
      if ("failure" in resolved) {
        throw new ProviderError("not_configured", resolved.failure.message, PROVIDER);
      }
      return executeClaudeThroughCli(request, prompts, signal, resolved.resolution, {
        workingDirectory: process.cwd(),
        ...(this.transportOverride ? { queryFn: this.transportOverride } : {}),
      });
    }
    if (transport.kind === "unavailable") {
      throw new ProviderError("not_configured", transport.detail, PROVIDER);
    }

    // api_key transport, opted into explicitly.
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
