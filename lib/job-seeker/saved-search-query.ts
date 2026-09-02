import { z } from "zod";

import { SPONSORSHIP_STATES } from "@/lib/job-seeker/board-search/signals";
import {
  INDUSTRIES,
  MARKETING_SPECIALTIES,
  SENIORITY_LEVELS,
} from "@/lib/job-seeker/board-search/unify";

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
    /** Kilometres around `location`; optional so older stored queries parse. */
    radiusKm: z.number().int().min(5).max(500).nullish(),
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
        /** Title-derived marketing specialty; optional for the same reason. */
        specialty: z.enum(MARKETING_SPECIALTIES).nullish(),
        /** Posting-text-derived industry; optional for the same reason. */
        industry: z.enum(INDUSTRIES).nullish(),
        salaryMinimum: z.number().int().min(0).max(10_000_000).nullish(),
        requireSalary: z.boolean().optional(),
        postedWithinDays: z.number().int().min(1).max(365).nullish(),
        minimumScore: z.number().int().min(0).max(100).nullish(),
        /** Posting signals (ADR-242); optional so earlier stored queries parse. */
        hideRedFlags: z.boolean().optional(),
        excludeAgencies: z.boolean().optional(),
        sponsorship: z.enum(SPONSORSHIP_STATES).nullish(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SavedSearchQuery = z.infer<typeof savedSearchQuerySchema>;
