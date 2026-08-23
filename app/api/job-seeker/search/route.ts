import { z } from "zod";

import {
  IMPORT_ERROR_STATUS,
  ImportSourceError,
  listSearchAdapters,
} from "@/lib/job-seeker/import-adapters";
import { FREEHIRE_MAX_RESULTS } from "@/lib/job-seeker/portals/freehire";
import { insertScoredJob, loadEvaluationInputs } from "@/lib/job-seeker/record";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Keyword job search: "who is hiring for this", recorded.
 *
 * This is the search sibling of `/api/job-seeker/import`, which reads one
 * company's board by identifier. They are separate routes because they take
 * genuinely different input, and folding a query into a field named
 * `identifier` would make the schema lie about what it accepts. Everything
 * after the fetch is the same code: the same evaluate → job → match →
 * application chain, the same duplicate index, the same credential scan, and
 * the same counted outcomes — so a searched posting and an imported one are
 * the same kind of record, distinguished only by the `source` that names
 * where it came from.
 *
 * Every number in the response counts something that happened. The
 * provider's own total is reported alongside how many this bounded request
 * considered, so a capped search never presents itself as the whole market.
 */

const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

const searchSchema = z
  .object({
    source: z.enum(["freehire"]),
    keywords: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(120).nullish(),
    country: z.string().trim().regex(COUNTRY_PATTERN).nullish(),
    workMode: z.enum(["remote", "hybrid", "onsite"]).nullish(),
    postedWithinDays: z.number().int().min(1).max(365).nullish(),
    limit: z.number().int().min(1).max(FREEHIRE_MAX_RESULTS).default(20),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = searchSchema.parse(await readBoundedJson(request, 4 * 1024));

    const adapter = listSearchAdapters().find((entry) => entry.key === payload.source);
    if (!adapter?.searchPostings) {
      return jsonNoStore(
        {
          error: {
            code: "search_source_unavailable",
            message: "This source has no search integration.",
          },
        },
        { status: 422 },
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();

    const found = await adapter.searchPostings({
      keywords: payload.keywords,
      city: payload.city ?? null,
      country: payload.country ?? null,
      workMode: payload.workMode ?? null,
      postedWithinDays: payload.postedWithinDays ?? null,
      limit: payload.limit,
    });
    const inputs = await loadEvaluationInputs(client, activeOrganization.id);

    let recorded = 0;
    let duplicates = 0;
    let skippedSensitive = 0;
    let qualified = 0;
    for (const posting of found.postings) {
      // Third-party text should never smuggle a credential-shaped value into
      // the database; a posting that trips the scanner is skipped and
      // counted, not silently dropped.
      if (findSensitiveData(posting)) {
        skippedSensitive += 1;
        continue;
      }
      const result = await insertScoredJob(client, {
        organizationId: activeOrganization.id,
        userId: user.id,
        source: payload.source,
        job: posting,
        inputs,
      });
      if (result.outcome === "recorded") {
        recorded += 1;
        if (result.qualified) qualified += 1;
      } else {
        // A posting already on this person's board is not a failed search.
        // Searching the same terms twice should be safe and boring.
        duplicates += 1;
      }
    }

    return jsonNoStore({
      source: payload.source,
      keywords: payload.keywords,
      totalAvailable: found.totalAvailable,
      considered: found.postings.length,
      recorded,
      duplicates,
      skippedSensitive,
      qualified,
    });
  } catch (error) {
    if (error instanceof ImportSourceError) {
      return jsonNoStore(
        { error: { code: error.code, message: error.message } },
        { status: IMPORT_ERROR_STATUS[error.code] },
      );
    }
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_search",
            message: "Name a supported source and what you are searching for.",
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    if (error && typeof error === "object" && "code" in error && "message" in error) {
      return databaseErrorResponse(error as { code: string; message: string });
    }
    return jsonNoStore(
      { error: { code: "search_failed", message: "The job search could not be completed." } },
      { status: 500 },
    );
  }
}
