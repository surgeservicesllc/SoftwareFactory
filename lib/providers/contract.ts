import { z } from "zod";

import { ProviderError } from "@/lib/providers/errors";
import type {
  ProviderId,
  ProviderRunRequest,
  ProviderStructuredResult,
  ProviderTaskKind,
} from "@/lib/providers/types";

/**
 * The provider-neutral request and response contract.
 *
 * Both adapters send the same instruction shape and validate the same result
 * schema, so a routing decision changes which model answers without changing
 * what SoftwareFactory stores. Everything here is pure and unit tested.
 */

/**
 * JSON Schema for the structured artifact. Constrained to the subset both
 * providers accept for schema-enforced output: object types, enums, anyOf,
 * `required` on every property, and `additionalProperties: false`.
 */
export const PROVIDER_RESULT_JSON_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "One paragraph stating the outcome of the task.",
    },
    findings: {
      type: "array",
      description: "Discrete observations. Empty when there is nothing to report.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short label for the finding." },
          detail: { type: "string", description: "What was observed and why it matters." },
          severity: { type: "string", enum: ["info", "low", "medium", "high"] },
        },
        required: ["title", "detail", "severity"],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: "array",
      description: "Concrete next actions for the owner. Empty when none apply.",
      items: { type: "string" },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    blocked: {
      type: "boolean",
      description: "True when the supplied context is insufficient to answer.",
    },
    blocked_reason: {
      description: "Why the task could not be completed. Null when not blocked.",
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
  required: ["summary", "findings", "recommendations", "confidence", "blocked", "blocked_reason"],
  additionalProperties: false,
} as const);

const findingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(4000),
  severity: z.enum(["info", "low", "medium", "high"]),
});

const resultSchema = z.object({
  summary: z.string().trim().min(1).max(8000),
  findings: z.array(findingSchema).max(50),
  recommendations: z.array(z.string().trim().min(1).max(2000)).max(50),
  confidence: z.enum(["low", "medium", "high"]),
  blocked: z.boolean(),
  blocked_reason: z.string().trim().min(1).max(2000).nullable(),
});

/**
 * Parse and validate a provider's raw text output into the structured
 * artifact. Provider output is untrusted: anything that does not validate is
 * an `invalid_response` failure rather than a partially-trusted record.
 */
export function parseProviderResult(
  rawText: string,
  provider: ProviderId,
): ProviderStructuredResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new ProviderError("invalid_response", "The provider returned an empty response.", provider);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonObject(trimmed));
  } catch {
    throw new ProviderError(
      "invalid_response",
      "The provider response was not valid JSON in the agreed result schema.",
      provider,
    );
  }

  const parsed = resultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ProviderError(
      "invalid_response",
      "The provider response did not match the agreed result schema.",
      provider,
    );
  }

  return Object.freeze({
    summary: parsed.data.summary,
    findings: Object.freeze(parsed.data.findings.map((finding) => Object.freeze({ ...finding }))),
    recommendations: Object.freeze([...parsed.data.recommendations]),
    confidence: parsed.data.confidence,
    blocked: parsed.data.blocked,
    blockedReason: parsed.data.blocked_reason,
  });
}

/**
 * Tolerate a model that wraps the object in a fenced code block. Anything
 * beyond that is treated as a schema failure rather than repaired.
 */
function extractJsonObject(text: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/u.exec(text);
  return (fenced?.[1] ?? text).trim();
}

const TASK_KIND_BRIEFS: Record<ProviderTaskKind, string> = {
  plan: "Produce an implementation plan: the outcome, the ordered work, the acceptance criteria, and the risks.",
  architecture_review:
    "Assess the architectural approach: boundaries, data flow, failure modes, and whether it fits the stated constraints.",
  implementation_proposal:
    "Propose a concrete implementation: which files change, what each change does, and how it would be verified. Describe the change; do not attempt to apply it.",
  implementation_review:
    "Review the proposed implementation for correctness, scope, regressions, and missing tests.",
  security_review:
    "Review for security and data-handling problems: authorization, tenancy, secret handling, injection, and untrusted input.",
  qa_assessment:
    "Assess test coverage and validation: what is verified, what is not, and what evidence a reviewer would still need.",
  status_report:
    "Summarize the current state for an owner: what happened, what is blocked, and the decisions that need a person.",
};

/**
 * The system prompt. It states the operating context and the hard boundary,
 * and leaves method to the model.
 */
export function buildSystemPrompt(request: ProviderRunRequest): string {
  return [
    "You are executing one bounded task for SoftwareFactory, an AI software-engineering control plane.",
    `You are acting as the ${request.agentRole} agent. That is an operating role inside SoftwareFactory, not an account or a login.`,
    "",
    "Boundary: you produce analysis only. You have no repository, deployment, merge, or approval access, and nothing you write is applied automatically. A person reviews your artifact and decides what to do with it.",
    "",
    "Ground every claim in the context you were given. Where the context is insufficient, set blocked to true and say what is missing rather than assuming. Never include credentials, tokens, or private keys in your output.",
    "",
    "Reply with a single JSON object matching the required schema, and nothing else.",
  ].join("\n");
}

/** The user message: the task, its context, and the recorded prior artifacts. */
export function buildTaskPrompt(request: ProviderRunRequest): string {
  const { context } = request;
  const sections: string[] = [
    `# Task: ${request.taskKind}`,
    TASK_KIND_BRIEFS[request.taskKind],
    "",
    "# Objective",
    request.instructions.trim(),
    "",
    "# Project context",
    `- Project: ${context.projectName}`,
    `- Repository: ${context.repositoryFullName ?? "Not Connected"}`,
    `- Default branch: ${context.defaultBranch ?? "unknown"}`,
    `- Declared risk: ${context.riskLevel}`,
  ];

  if (context.memoryExcerpts.length > 0) {
    sections.push(
      "",
      "# Repository memory",
      "These excerpts are the project's own standing instructions. Treat them as constraints.",
    );
    for (const excerpt of context.memoryExcerpts) {
      sections.push("", `## ${excerpt.path}`, excerpt.excerpt.trim());
    }
  }

  if (context.priorArtifacts.length > 0) {
    sections.push(
      "",
      "# Prior work in this run",
      "Each entry is a recorded artifact from an earlier step. Build on them; do not repeat them.",
    );
    for (const artifact of context.priorArtifacts) {
      sections.push(
        "",
        `## ${artifact.taskKind} (${artifact.agentRole} agent, run ${artifact.runId})`,
        artifact.summary.trim(),
      );
    }
  }

  return sections.join("\n");
}

/** Bound the prompt so a large context cannot silently inflate cost. */
export const MAX_PROMPT_CHARACTERS = 120_000;

export function assertPromptWithinBounds(prompt: string, provider: ProviderId): void {
  if (prompt.length > MAX_PROMPT_CHARACTERS) {
    throw new ProviderError(
      "request_rejected",
      `The assembled prompt exceeds the ${MAX_PROMPT_CHARACTERS} character limit.`,
      provider,
    );
  }
}
