import { z } from "zod";

import { ImportSourceError, listImportAdapters } from "@/lib/job-seeker/import-adapters";
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
 * Import postings from a public board, identified by the user, and record
 * each one through the same evaluate → job → match → application chain as
 * manual recording. Every count in the response is a count of something
 * that actually happened: the provider's true total, how many this bounded
 * request considered, how many were newly recorded, how many the duplicate
 * index refused, and how many were skipped because their content tripped
 * the credential scanner.
 */

const importSchema = z
  .object({
    source: z.enum(["greenhouse", "lever"]),
    identifier: z.string().trim().min(1).max(64),
  })
  .strict();

const IMPORT_ERROR_STATUS = {
  identifier_invalid: 422,
  source_not_found: 404,
  provider_error: 502,
  provider_unreachable: 502,
} as const;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = importSchema.parse(await readBoundedJson(request, 4 * 1024));

    const adapter = listImportAdapters().find((entry) => entry.key === payload.source);
    if (!adapter?.fetchPostings) {
      return jsonNoStore(
        { error: { code: "import_source_unavailable", message: "This source has no import integration." } },
        { status: 422 },
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();

    const fetched = await adapter.fetchPostings(payload.identifier);
    const inputs = await loadEvaluationInputs(client, activeOrganization.id);

    let imported = 0;
    let duplicates = 0;
    let skippedSensitive = 0;
    for (const posting of fetched.postings) {
      // Public content should never smuggle a credential-shaped value into
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
      if (result.outcome === "recorded") imported += 1;
      else duplicates += 1;
    }

    return jsonNoStore({
      source: payload.source,
      identifier: payload.identifier.trim().toLowerCase(),
      company: fetched.company,
      totalAvailable: fetched.totalAvailable,
      considered: fetched.postings.length,
      imported,
      duplicates,
      skippedSensitive,
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
        { error: { code: "invalid_import", message: "Name a supported source and an identifier." } },
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
      { error: { code: "import_failed", message: "The import could not be completed." } },
      { status: 500 },
    );
  }
}
