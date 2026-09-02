import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { readProviderCredential, resolveProviderConfiguration } from "@/lib/providers/config";

/**
 * The one gate every model lane in the Job Seeker passes through
 * (ADR-246, ADR-248), on the resume review's pattern (ADR-115): a lane
 * is usable only when the Anthropic provider is configured, not
 * switched off by the owner, and has a model selected. The reason a lane
 * is not usable names an environment variable and never a value, so it
 * is safe to print as **Not Connected**.
 */

export type AnthropicFactory = (apiKey: string, baseUrl: string | null) => {
  messages: {
    create: (body: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  };
};

export const defaultAnthropicFactory: AnthropicFactory = (apiKey, baseUrl) =>
  new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) }) as never;

export type ModelLane = Readonly<{
  available: boolean;
  model: string | null;
  baseUrl: string | null;
  /** Why the lane is not usable; null when it is. Names a variable, never a value. */
  unavailableReason: string | null;
}>;

export function modelLane(): ModelLane {
  const configuration = resolveProviderConfiguration("anthropic");
  const available = configuration.configured && !configuration.disabled && configuration.defaultModel !== null;
  return {
    available,
    model: available ? configuration.defaultModel : null,
    baseUrl: configuration.baseUrl,
    unavailableReason: available
      ? null
      : configuration.unavailableReason ?? "No model provider is configured on this server.",
  };
}

/** The credential, handed only to the SDK constructor; null when the lane is not usable. */
export function modelLaneCredential(): string | null {
  return modelLane().available ? readProviderCredential("anthropic") : null;
}

/** Pull the text out of a Messages response without trusting its shape. */
export function textOfResponse(response: unknown): string {
  const content = (response as { content?: unknown })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}
