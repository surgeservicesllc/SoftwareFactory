import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { boardSearchKeys } from "@/lib/job-seeker/board-search/registry";
import { insertScoredJob, loadEvaluationInputs } from "@/lib/job-seeker/record";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import {
  SearchResultTokenError,
  verifySearchResult,
} from "@/lib/job-seeker/search-result-token";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Save a search result into the job list.
 *
 * This is the persistence half of Search, and it deliberately owns none of
 * the recording logic. `insertScoredJob` is the same evaluate → job → match →
 * application chain the manual record route and the import route already run,
 * so a job saved from a board is scored by the same rules, enters the pipeline
 * at the same honest stage, and is deduplicated by the same unique index as
 * one typed in by hand. A second copy of that chain here would be a second
 * definition of what recording means, and the two would drift.
 *
 * What Search contributes is `source`: the board key rather than `manual`, so
 * a person can always see where a job in their list came from. That column's
 * own comment calls honest attribution "the anti-fabrication rule in column
 * form", and this is the case it was written for.
 *
 * ## The client does not get to say what it found
 *
 * The posting is re-validated here against the same bounds the table enforces.
 * A search result travelled through the browser to get back, so treating it as
 * trusted would let a crafted request write anything into the job list under a
 * board's name — attribution that cannot be trusted is worse than none.
 */

const saveSchema = z
  .object({
    board: z.string().trim().min(1).max(64),
    resultToken: z.string().trim().min(1).max(2_048),
    job: z
      .object({
        externalId: z.string().trim().min(1).max(200).nullish(),
        /*
         * `.url()` alone is not enough: `javascript:alert(1)` is a perfectly
         * valid URL and this value becomes an `href` on the jobs page. The
         * column's own CHECK is `^https?://`, so anything else would be
         * refused by PostgreSQL anyway — but as a database error at insert
         * time rather than as a clear refusal here, and after the value had
         * already been treated as a link.
         */
        url: z
          .string()
          .trim()
          .url()
          .max(800)
          .refine((value) => /^https?:\/\//i.test(value), { message: "A job link must be http or https." })
          .nullish(),
        title: z.string().trim().min(1).max(300),
        company: z.string().trim().min(1).max(300),
        salaryText: z.string().trim().min(1).max(200).nullish(),
        location: z.string().trim().min(1).max(200).nullish(),
        workModel: z.enum(["remote", "hybrid", "onsite"]).nullish(),
        description: z.string().trim().max(30_000).nullish(),
      })
      .strict(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    // Authenticate before parsing or classifying caller-controlled content so
    // a signed-out request receives only the normal auth boundary response.
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const parsed = saveSchema.safeParse(await readBoundedJson(request, 128_000));
    if (!parsed.success) {
      throw new ApiRequestError(
        422,
        "invalid_job",
        parsed.error.issues[0]?.message ?? "The job payload is not valid.",
      );
    }

    /*
     * `source` must be a board this deployment can actually read. Accepting
     * any string would let a caller attribute a job to a board that was never
     * queried, and the column's CHECK would happily store it.
     */
    if (!boardSearchKeys().includes(parsed.data.board)) {
      throw new ApiRequestError(400, "board_unknown", `There is no board called "${parsed.data.board}".`);
    }

    const sensitive = findSensitiveData(parsed.data.job);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The job appears to contain a credential-shaped value at ${sensitive.path}; it was not saved.`,
      );
    }

    try {
      verifySearchResult({
        token: parsed.data.resultToken,
        organizationId: activeOrganization.id,
        userId: user.id,
        board: parsed.data.board,
        job: {
          externalId: parsed.data.job.externalId ?? null,
          url: parsed.data.job.url ?? null,
          title: parsed.data.job.title,
          company: parsed.data.job.company,
          salaryText: parsed.data.job.salaryText ?? null,
          location: parsed.data.job.location ?? null,
          workModel: parsed.data.job.workModel ?? null,
          description: parsed.data.job.description ?? null,
        },
      });
    } catch (error) {
      if (error instanceof SearchResultTokenError) {
        throw new ApiRequestError(
          422,
          "search_result_invalid",
          "This search result is no longer valid. Run the search again before saving it.",
        );
      }
      throw error;
    }
    const inputs = await loadEvaluationInputs(client, activeOrganization.id);

    const outcome = await insertScoredJob(client, {
      organizationId: activeOrganization.id,
      userId: user.id,
      source: parsed.data.board,
      job: {
        externalId: parsed.data.job.externalId ?? null,
        url: parsed.data.job.url ?? null,
        title: parsed.data.job.title,
        company: parsed.data.job.company,
        salaryText: parsed.data.job.salaryText ?? null,
        location: parsed.data.job.location ?? null,
        workModel: parsed.data.job.workModel ?? null,
        description: parsed.data.job.description ?? null,
      },
      inputs,
    });

    if (outcome.outcome === "duplicate") {
      /*
       * 200, not 409. Saving the same posting twice is a person clicking the
       * same result again, not a failed request — and the honest answer is
       * that it is already in their list, which is exactly the state they
       * wanted. The route says which so the page can say so too.
       */
      return jsonNoStore({ saved: false, reason: "already_saved" });
    }

    return jsonNoStore(
      { saved: true, jobId: outcome.jobId, score: outcome.score, qualified: outcome.qualified },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    const database = databaseErrorResponse(error as { code?: string; message?: string });
    if (database) return database;
    return jsonNoStore(
      { error: { code: "save_failed", message: "The job could not be saved." } },
      { status: 500 },
    );
  }
}
