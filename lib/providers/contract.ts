import { z } from "zod";

import { RISK_FACTORS, type RiskFactor } from "@/lib/risk";
import type { ProposedFileChange, WorkerRunResult } from "@/lib/providers/types";

/**
 * The structured output contract every worker provider must satisfy.
 *
 * Results are parsed and validated here rather than trusted as prose. A run is
 * never considered successful because a model said so.
 */

export const MAX_PROPOSED_FILES = 25;
export const MAX_FILE_CONTENT_BYTES = 256 * 1024;

const riskFactorKeys = Object.keys(RISK_FACTORS) as [RiskFactor, ...RiskFactor[]];

const proposedChangeSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .regex(/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/, "path must be a relative repository path"),
    action: z.enum(["create", "update"]),
    content: z.string().max(MAX_FILE_CONTENT_BYTES),
    expectedSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
    summary: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((change) => change.action !== "update" || change.expectedSha !== null, {
    message: "an update must carry the expected blob SHA",
    path: ["expectedSha"],
  })
  .refine((change) => !change.path.includes(".."), {
    message: "path traversal is not allowed",
    path: ["path"],
  });

export const workerResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    changes: z.array(proposedChangeSchema).max(MAX_PROPOSED_FILES),
    warnings: z.array(z.string().trim().min(1).max(300)).max(25),
    blockers: z.array(z.string().trim().min(1).max(300)).max(25),
    securityFindings: z.array(z.string().trim().min(1).max(300)).max(25),
    riskFactors: z.array(z.enum(riskFactorKeys)).max(riskFactorKeys.length),
    nextRecommendation: z.string().trim().max(2000).nullable(),
  })
  .strict();

export type WorkerResultPayload = z.infer<typeof workerResultSchema>;

export function parseWorkerResult(value: unknown): WorkerRunResult {
  const parsed = workerResultSchema.parse(value);
  const seen = new Set<string>();
  const changes: ProposedFileChange[] = [];

  for (const change of parsed.changes) {
    const normalizedPath = change.path.replace(/^\.\//, "");
    if (seen.has(normalizedPath)) {
      throw new Error(`the worker proposed the same path twice: ${normalizedPath}`);
    }
    seen.add(normalizedPath);
    changes.push({ ...change, path: normalizedPath });
  }

  return {
    summary: parsed.summary,
    changes,
    warnings: parsed.warnings,
    blockers: parsed.blockers,
    securityFindings: parsed.securityFindings,
    riskFactors: parsed.riskFactors,
    nextRecommendation: parsed.nextRecommendation,
  };
}

/**
 * JSON Schema mirror of `workerResultSchema` for providers that support strict
 * structured output. Keep the two definitions in step; the Zod schema stays the
 * authority because provider enforcement is never assumed.
 */
export const workerResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "changes",
    "warnings",
    "blockers",
    "securityFindings",
    "riskFactors",
    "nextRecommendation",
  ],
  properties: {
    summary: {
      type: "string",
      description: "What was changed and why, in plain language. No chain of thought.",
    },
    changes: {
      type: "array",
      maxItems: MAX_PROPOSED_FILES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "action", "content", "expectedSha", "summary"],
        properties: {
          path: { type: "string", description: "Repository-relative path." },
          action: { type: "string", enum: ["create", "update"] },
          content: { type: "string", description: "Complete new file content." },
          expectedSha: {
            type: ["string", "null"],
            description: "The current blob SHA for an update, or null for a create.",
          },
          summary: { type: "string", description: "One line describing this file change." },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" }, maxItems: 25 },
    blockers: { type: "array", items: { type: "string" }, maxItems: 25 },
    securityFindings: { type: "array", items: { type: "string" }, maxItems: 25 },
    riskFactors: {
      type: "array",
      maxItems: riskFactorKeys.length,
      items: { type: "string", enum: riskFactorKeys },
    },
    nextRecommendation: { type: ["string", "null"] },
  },
} as const;
