import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  readProviderCredential,
  resolveProviderConfiguration,
} from "@/lib/providers/config";

import {
  RESUME_SYSTEM_PROMPT,
  extractByPattern,
  mergeProposals,
  parseModelProposal,
  resumeExtractionPrompt,
  type ExtractionOutcome,
} from "@/lib/job-seeker/resume-extract";

/**
 * The AI review of a resume.
 *
 * The pattern pass always runs. The model is an enrichment on top of it, never
 * a prerequisite — so a person on a deployment with no provider credential
 * still gets their contact details, skills and sections filled in, and is told
 * plainly that the deeper read did not happen rather than being shown a
 * spinner that never resolves or an error that looks like their file was bad.
 *
 * `reviewStatus` is the honest label for the surface: `reviewed` means a model
 * actually read the document, `pattern_only` means it did not and says why.
 * Nothing here ever reports a model read that did not happen.
 */

export type ResumeReviewStatus = "reviewed" | "pattern_only";

export type ResumeReview = ExtractionOutcome & {
  readonly status: ResumeReviewStatus;
  /** The model that read the resume, or null when none did. */
  readonly model: string | null;
  /** Secret-free explanation, shown to the person when status is pattern_only. */
  readonly detail: string;
};

/** Bounded so one upload cannot become an unbounded bill or a hung request. */
const MAX_OUTPUT_TOKENS = 4_096;
const REVIEW_TIMEOUT_MS = 90_000;

export type AnthropicFactory = (apiKey: string, baseUrl: string | null) => {
  messages: {
    create: (body: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  };
};

const defaultFactory: AnthropicFactory = (apiKey, baseUrl) =>
  new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) }) as never;

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

/**
 * Read a resume: patterns first, then the model if one is reachable.
 *
 * Every model failure degrades to the pattern result rather than propagating.
 * A person who uploaded a valid resume should not be told it failed because a
 * provider was rate limited — they should get what could be read, and the
 * reason the rest did not happen.
 */
export async function reviewResume(
  text: string,
  factory: AnthropicFactory = defaultFactory,
): Promise<ResumeReview> {
  const pattern = extractByPattern(text);

  const configuration = resolveProviderConfiguration("anthropic");
  /*
   * `configured` answers "is there a usable credential", which is a different
   * question from "may this be used". An owner who sets ANTHROPIC_PROVIDER_DISABLED
   * has switched outbound calls off deliberately, and a valid key sitting in the
   * environment does not overrule that. Reading only `configured` here would have
   * called the provider anyway — an off switch that does nothing.
   */
  const usable = configuration.configured && !configuration.disabled;
  const credential = usable ? readProviderCredential("anthropic") : null;
  const model = configuration.defaultModel;

  if (!credential || !model) {
    return {
      ...pattern,
      status: "pattern_only",
      model: null,
      // resolveProviderConfiguration's reason names an environment variable,
      // never a value, and is safe to show.
      detail:
        configuration.unavailableReason
        ?? "No model provider is configured on this server, so only pattern extraction ran.",
    };
  }

  try {
    const client = factory(credential, configuration.baseUrl);
    const response = await client.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: RESUME_SYSTEM_PROMPT,
        messages: [{ role: "user", content: resumeExtractionPrompt(text) }],
      },
      { timeout: REVIEW_TIMEOUT_MS },
    );

    const proposal = parseModelProposal(textOfResponse(response));
    if (proposal === null) {
      return {
        ...pattern,
        status: "pattern_only",
        model: null,
        detail: "The model answered, but not with a resume this could read. Pattern extraction was used instead.",
      };
    }

    return {
      ...mergeProposals(pattern, proposal),
      status: "reviewed",
      model,
      detail: `Reviewed by ${model}.`,
    };
  } catch (error) {
    /*
     * The message is included because it names the failure a person or an
     * owner can act on — a rate limit, a bad key, a timeout. The resume text
     * is never part of it, and provider SDK errors do not echo request bodies.
     */
    return {
      ...pattern,
      status: "pattern_only",
      model: null,
      detail: `The model review did not complete (${
        error instanceof Error ? error.message : "unknown error"
      }). Pattern extraction was used instead.`,
    };
  }
}
