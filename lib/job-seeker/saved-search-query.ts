import { z } from "zod";

import { SENIORITY_LEVELS } from "@/lib/job-seeker/board-search/unify";

/**
 * The one definition of what a saved search stores.
 *
 * The CRUD route validates browser input against this before persisting, and
 * the alert engine parses the stored jsonb back through it before acting — so
 * a query that saves is a query that runs, and a stored document that has
 * drifted from this shape is rejected loudly rather than half-obeyed.
 */

export const savedSearchQuerySchema = z
  .object({
    text: z.string().trim().max(200).default(""),
    location: z.string().trim().max(120).nullish(),
    boards: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    sort: z.enum(["returned", "newest", "salary", "match"]).optional(),
    filters: z
      .object({
        keywordMode: z.enum(["and", "or"]).optional(),
        keywords: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
        excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
        excludeCompanies: z.array(z.string().trim().min(1).max(120)).max(16).optional(),
        workModel: z.enum(["remote", "hybrid", "onsite"]).nullish(),
        /** Title-derived; optional so queries saved before it exist still parse. */
        seniority: z.enum(SENIORITY_LEVELS).nullish(),
        salaryMinimum: z.number().int().min(0).max(10_000_000).nullish(),
        requireSalary: z.boolean().optional(),
        postedWithinDays: z.number().int().min(1).max(365).nullish(),
        minimumScore: z.number().int().min(0).max(100).nullish(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SavedSearchQuery = z.infer<typeof savedSearchQuerySchema>;
