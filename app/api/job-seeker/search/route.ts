import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { BOARD_SEARCH_ADAPTERS, boardSearchAdapter } from "@/lib/job-seeker/board-search/registry";
import { BoardSearchError, type BoardSearchQuery } from "@/lib/job-seeker/board-search/types";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Search across the job boards Search can actually read.
 *
 * Authenticated and tenant-scoped like every other job-seeker route:
 * `requireActiveOrganization` first, so a signed-out or workspace-less caller
 * is refused before a single outbound request is made. That order matters —
 * the alternative lets an anonymous caller use this endpoint to make the
 * server fetch arbitrary job boards on their behalf.
 *
 * ## Nothing is written here
 *
 * A search reads. Results are returned and not stored, because storing every
 * result of every search would fill a person's job list with postings they
 * glanced at and rejected. Saving is a separate, deliberate act against
 * `POST /api/job-seeker/search/save`.
 *
 * ## One board failing is not the search failing
 *
 * Boards are queried together and settled independently. A board that is down
 * or rate-limiting is reported by name with its reason, beside the results
 * from the boards that answered. Failing the whole request because one of five
 * boards is unreachable throws away four good answers; silently omitting it
 * would tell a person they had searched everywhere when they had not.
 */

const searchSchema = z
  .object({
    text: z.string().trim().max(200).default(""),
    location: z.string().trim().min(1).max(120).nullish(),
    /** Per board, not in total; the page shows each board's results separately. */
    limit: z.number().int().min(1).max(50).default(25),
    boards: z.array(z.string().trim().min(1).max(64)).min(1).max(10).optional(),
  })
  .strict()
  .refine((value) => value.text.length > 0 || (value.location ?? "").length > 0, {
    message: "Give a search term or a location.",
    path: ["text"],
  });

export async function GET() {
  /*
   * The board list is itself authenticated. It names what this deployment can
   * read, which is deployment shape rather than public information.
   */
  try {
    await requireActiveOrganization();
    return jsonNoStore({
      boards: BOARD_SEARCH_ADAPTERS.map((adapter) => ({
        key: adapter.key,
        name: adapter.name,
        summary: adapter.summary,
        coverage: adapter.coverage,
      })),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "boards_unavailable", message: "The board list could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    await requireActiveOrganization();

    const body = await readBoundedJson(request);
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiRequestError(
        400,
        "search_invalid",
        parsed.error.issues[0]?.message ?? "The search was not valid.",
      );
    }

    const requested = parsed.data.boards ?? BOARD_SEARCH_ADAPTERS.map((adapter) => adapter.key);
    const adapters = requested.map((key) => {
      const adapter = boardSearchAdapter(key);
      if (adapter === null) {
        throw new ApiRequestError(400, "board_unknown", `There is no board called "${key}".`);
      }
      return adapter;
    });

    const query: BoardSearchQuery = {
      text: parsed.data.text,
      location: parsed.data.location ?? null,
      limit: parsed.data.limit,
    };

    const settled = await Promise.allSettled(adapters.map((adapter) => adapter.search(query)));

    const results: unknown[] = [];
    const failures: unknown[] = [];
    settled.forEach((outcome, index) => {
      const adapter = adapters[index]!;
      if (outcome.status === "fulfilled") {
        results.push({
          board: adapter.key,
          boardName: adapter.name,
          totalAvailable: outcome.value.totalAvailable,
          hits: outcome.value.hits,
        });
        return;
      }
      /*
       * Only a BoardSearchError's message is safe to show. Anything else is an
       * unexpected throw whose text may carry internals, so it is reported as
       * the board failing without repeating what it said.
       */
      const reason = outcome.reason;
      failures.push({
        board: adapter.key,
        boardName: adapter.name,
        code: reason instanceof BoardSearchError ? reason.code : "board_unreachable",
        message:
          reason instanceof BoardSearchError
            ? reason.message
            : `${adapter.name} could not be searched.`,
      });
    });

    return jsonNoStore({
      query: { text: query.text, location: query.location, limit: query.limit },
      results,
      /*
       * Always present, even when empty. A caller that has to guess whether
       * the key is missing because nothing failed or because the shape
       * changed will eventually guess wrong and hide a failure.
       */
      failures,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "search_failed", message: "The search could not be run." } },
      { status: 500 },
    );
  }
}
