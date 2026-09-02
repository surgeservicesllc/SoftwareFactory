import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { readProviderCredential, resolveProviderConfiguration } from "@/lib/providers/config";

/**
 * Model-written interview questions (ADR-246): the one generated section
 * of the prep sheet, kept in its own lane so the deterministic sheet never
 * depends on it and so its label is always honest. Without a usable
 * provider credential the section reads **Not Connected** with the
 * variable that would enable it; with one, the questions arrive labeled
 * with the model that wrote them and a reminder that none of them is a
 * recorded fact. The call is made only when the person asks — a page
 * open never bills.
 */

export const MAX_QUESTIONS = 10;
const MAX_OUTPUT_TOKENS = 1_024;
const QUESTIONS_TIMEOUT_MS = 60_000;
const MAX_QUESTION_LENGTH = 300;

export type ModelQuestions =
  | Readonly<{ status: "generated"; model: string; questions: string[]; detail: string }>
  | Readonly<{ status: "not_connected"; model: null; questions: []; detail: string }>
  | Readonly<{ status: "failed"; model: string; questions: []; detail: string }>;

export type AnthropicFactory = (apiKey: string, baseUrl: string | null) => {
  messages: {
    create: (body: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  };
};

const defaultFactory: AnthropicFactory = (apiKey, baseUrl) =>
  new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) }) as never;

export const QUESTIONS_SYSTEM_PROMPT = [
  "You prepare a job candidate for an interview.",
  "Given a job posting and the candidate's recorded facts, write the questions an interviewer for this role is most likely to ask.",
  "Ground every question in the posting text or the candidate facts given. Do not invent facts about the company, the role or the candidate.",
  `Answer with a JSON array of at most ${MAX_QUESTIONS} strings and nothing else.`,
].join(" ");

export type QuestionsInput = Readonly<{
  title: string;
  company: string;
  description: string | null;
  strengths: readonly string[];
  gaps: readonly string[];
}>;

export function interviewQuestionsPrompt(input: QuestionsInput): string {
  return [
    `Role: ${input.title} at ${input.company}.`,
    `Posting text:\n${(input.description ?? "(no description recorded)").slice(0, 12_000)}`,
    `Candidate's recorded strengths the posting names: ${input.strengths.length > 0 ? input.strengths.join(", ") : "(none)"}.`,
    `Terms the posting names that the candidate's profile does not: ${input.gaps.length > 0 ? input.gaps.join(", ") : "(none)"}.`,
  ].join("\n\n");
}

/** Whether the model lane is usable, said without naming any value. */
export function modelQuestionsAvailability(): Readonly<{ available: boolean; model: string | null; detail: string }> {
  const configuration = resolveProviderConfiguration("anthropic");
  const usable = configuration.configured && !configuration.disabled && configuration.defaultModel !== null;
  return {
    available: usable,
    model: usable ? configuration.defaultModel : null,
    detail: usable
      ? `Questions are written by ${configuration.defaultModel} when you ask; none of them is a recorded fact.`
      : configuration.unavailableReason
        ?? "No model provider is configured on this server.",
  };
}

/** Pull the text out of a Messages response without trusting its shape. */
function textOfResponse(response: unknown): string {
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

/** A JSON array of strings, fenced or bare; null when the answer is anything else. */
export function parseQuestions(text: string): string[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const questions = parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.slice(0, MAX_QUESTION_LENGTH))
    .slice(0, MAX_QUESTIONS);
  return questions.length > 0 ? questions : null;
}

export async function generateInterviewQuestions(
  input: QuestionsInput,
  factory: AnthropicFactory = defaultFactory,
): Promise<ModelQuestions> {
  const availability = modelQuestionsAvailability();
  const configuration = resolveProviderConfiguration("anthropic");
  const credential = availability.available ? readProviderCredential("anthropic") : null;
  const model = availability.model;
  if (!credential || !model) {
    return { status: "not_connected", model: null, questions: [], detail: availability.detail };
  }
  try {
    const client = factory(credential, configuration.baseUrl);
    const response = await client.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: QUESTIONS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: interviewQuestionsPrompt(input) }],
      },
      { timeout: QUESTIONS_TIMEOUT_MS },
    );
    const questions = parseQuestions(textOfResponse(response));
    if (questions === null) {
      return { status: "failed", model, questions: [], detail: "The model answered, but not with a list of questions this could read." };
    }
    return {
      status: "generated",
      model,
      questions,
      detail: `Written by ${model} from the posting and your recorded facts — check each against the posting; none of them is a recorded fact.`,
    };
  } catch (error) {
    // The message names a failure an owner can act on; the prompt is never part of it.
    return {
      status: "failed",
      model,
      questions: [],
      detail: `The model did not answer (${error instanceof Error ? error.message : "unknown error"}).`,
    };
  }
}
