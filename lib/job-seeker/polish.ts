import "server-only";

import {
  defaultAnthropicFactory,
  modelLane,
  modelLaneCredential,
  textOfResponse,
  type AnthropicFactory,
} from "@/lib/job-seeker/model-lane";
import { checkPolish, describeCheck, type PolishCheck } from "@/lib/job-seeker/polish-check";

/**
 * Polish that cannot invent (ADR-248): the fact-only resume or cover
 * letter is handed to the model to be reworded for clarity and flow, and
 * what comes back is checked term by term against that baseline before
 * anything is stored. A variant that adds a skill, a number or a name
 * the record does not contain is rejected with the additions named;
 * without a usable credential the lane is **Not Connected**.
 */

export type DocumentKind = "resume" | "cover_letter";

const MAX_OUTPUT_TOKENS = 4_096;
const POLISH_TIMEOUT_MS = 90_000;
const MAX_POLISHED_LENGTH = 20_000;

export const POLISH_SYSTEM_PROMPT = [
  "You edit a job candidate's document for clarity, flow and concision.",
  "Rewrite only. Keep every fact exactly: do not add, change or remove any skill, tool, employer, job title, date, number, certification, achievement or contact detail; do not add any that the text does not contain.",
  "Keep the same sections and order, plain text, no markdown, no commentary. Answer with the rewritten document and nothing else.",
].join(" ");

export function polishPrompt(kind: DocumentKind, baseline: string): string {
  const label = kind === "resume" ? "an ATS-safe plain-text resume" : "a short cover letter";
  return `Rewrite ${label} below for clarity and flow, keeping every fact and adding none.\n\n---\n${baseline.slice(0, 30_000)}\n---`;
}

export type PolishOutcome =
  | Readonly<{ status: "polished"; model: string; content: string; check: PolishCheck; detail: string }>
  | Readonly<{ status: "rejected"; model: string; content: string; check: PolishCheck; detail: string }>
  | Readonly<{ status: "not_connected"; model: null; detail: string }>
  | Readonly<{ status: "failed"; model: string; detail: string }>;

export function polishAvailability(): Readonly<{ available: boolean; model: string | null; detail: string }> {
  const lane = modelLane();
  return {
    available: lane.available,
    model: lane.model,
    detail: lane.available
      ? `Polished by ${lane.model} when you ask, then checked term by term against the fact-only version; a variant that adds anything is not saved.`
      : lane.unavailableReason ?? "No model provider is configured on this server.",
  };
}

/** The model's answer as a document: a fenced block unwrapped, bounded, trimmed. */
export function parsePolished(text: string): string | null {
  const fenced = /```[a-z]*\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim().slice(0, MAX_POLISHED_LENGTH);
  return body.length >= 40 ? body : null;
}

export async function generatePolishedDocument(
  input: Readonly<{ kind: DocumentKind; baseline: string; profileTerms: readonly string[] }>,
  factory: AnthropicFactory = defaultAnthropicFactory,
): Promise<PolishOutcome> {
  const availability = polishAvailability();
  const lane = modelLane();
  const credential = modelLaneCredential();
  const model = availability.model;
  if (!credential || !model) {
    return { status: "not_connected", model: null, detail: availability.detail };
  }
  try {
    const client = factory(credential, lane.baseUrl);
    const response = await client.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: POLISH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: polishPrompt(input.kind, input.baseline) }],
      },
      { timeout: POLISH_TIMEOUT_MS },
    );
    const content = parsePolished(textOfResponse(response));
    if (content === null) {
      return { status: "failed", model, detail: "The model answered, but not with a document this could read. Nothing was saved." };
    }
    const check = checkPolish(content, input.baseline, input.profileTerms);
    if (!check.passed) {
      return {
        status: "rejected",
        model,
        content,
        check,
        detail: `${model} added things your record does not contain, so nothing was saved. ${describeCheck(check)}`,
      };
    }
    return {
      status: "polished",
      model,
      content,
      check,
      detail: `Polished by ${model}; ${describeCheck(check)}`,
    };
  } catch (error) {
    return {
      status: "failed",
      model,
      detail: `The model did not answer (${error instanceof Error ? error.message : "unknown error"}). Nothing was saved.`,
    };
  }
}
