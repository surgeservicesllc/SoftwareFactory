import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { SOURCE_CATALOGUE } from "@/lib/job-seeker/board-search/catalogue";
import { BOARD_SEARCH_ADAPTERS, boardSearchAdapter } from "@/lib/job-seeker/board-search/registry";
import { BoardSearchError, type BoardSearchQuery } from "@/lib/job-seeker/board-search/types";
import {
  applyUnifiedFilters,
  dedupeAcrossBoards,
  type UnifiedFilters,
} from "@/lib/job-seeker/board-search/unify";
import { evaluateJob, EVALUATION_METHOD_LABEL } from "@/lib/job-seeker/evaluate";
import { loadEvaluationInputs } from "@/lib/job-seeker/record";
import { sealSearchResult } from "@/lib/job-seeker/search-result-token";
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
 * ## Results are never stored here
 *
 * A search reads. Results are returned and not stored, because storing every
 * result of every search would fill a person's job list with postings they
 * glanced at and rejected. Saving is a separate, deliberate act against
 * `POST /api/job-seeker/search/save`. The one write this route makes is a
 * metering event per board queried (`job_seeker_search_events`) — an
 * immutable audit of the asking that the discovery page's credit meter
 * counts, never a copy of what came back.
 *
 * ## One board failing is not the search failing
 *
 * Boards are queried together and settled independently. A board that is down
 * or rate-limiting is reported by name with its reason, beside the results
 * from the boards that answered. Failing the whole request because one of five
 * boards is unreachable throws away four good answers; silently omitting it
 * would tell a person they had searched everywhere when they had not.
 */

const filtersSchema = z
  .object({
    keywordMode: z.enum(["and", "or"]).default("and"),
    keywords: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
    excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
    excludeCompanies: z.array(z.string().trim().min(1).max(120)).max(16).default([]),
    workModel: z.enum(["remote", "hybrid", "onsite"]).nullish(),
    salaryMinimum: z.number().int().min(0).max(10_000_000).nullish(),
    requireSalary: z.boolean().default(false),
    postedWithinDays: z.number().int().min(1).max(365).nullish(),
    /**
     * Keep only unified hits whose computed match score reaches this. Scores
     * come from the recorded Career Profile; asking for this filter without a
     * recorded profile is refused rather than silently ignored.
     */
    minimumScore: z.number().int().min(0).max(100).nullish(),
  })
  .strict();

const searchSchema = z
  .object({
    text: z.string().trim().max(200).default(""),
    location: z.string().trim().min(1).max(120).nullish(),
    /** Per board, not in total; the page shows each board's results separately. */
    limit: z.number().int().min(1).max(50).default(25),
    boards: z.array(z.string().trim().min(1).max(64)).min(1).max(16).optional(),
    /**
     * Result-level filters, applied to the unified set after boards answer.
     * They refine what came back; the boards are still queried by `text`,
     * because most cannot express these conditions upstream.
     */
    filters: filtersSchema.optional(),
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
        supportsLocation: adapter.supportsLocation,
      })),
      /*
       * The full researched catalogue: connected boards plus every source
       * that is credential-gated, link-out only, or refused — each with the
       * honest reason. The picker renders this so nobody has to wonder why
       * a famous board is not a checkbox.
       */
      sources: SOURCE_CATALOGUE,
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
    const { activeOrganization, user, client } = await requireActiveOrganization();

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
    const taggedForUnify: Parameters<typeof dedupeAcrossBoards>[0][number][] = [];
    settled.forEach((outcome, index) => {
      const adapter = adapters[index]!;
      if (outcome.status === "fulfilled") {
        const withTokens = outcome.value.hits.map((hit) => ({
          ...hit,
          saveToken: sealSearchResult({
            organizationId: activeOrganization.id,
            userId: user.id,
            board: adapter.key,
            job: hit.job,
          }),
        }));
        results.push({
          board: adapter.key,
          boardName: adapter.name,
          totalAvailable: outcome.value.totalAvailable,
          hits: withTokens,
          locationApplied: query.location === null || adapter.supportsLocation,
        });
        for (const hit of withTokens) {
          taggedForUnify.push({
            board: adapter.key,
            boardName: adapter.name,
            hit: { job: hit.job, publishedOn: hit.publishedOn, closesOn: hit.closesOn },
            saveToken: hit.saveToken,
          });
        }
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

    /*
     * The unified view: the same hits collapsed across boards (same company
     * and title is one card carrying every source's link and save token),
     * then narrowed by the request's result-level filters. The per-board
     * `results` stay in the response untouched — the raw material is never
     * hidden behind the refinement, and the counts let the UI say honestly
     * how many cards the filters removed.
     */
    const filters: UnifiedFilters | null = parsed.data.filters
      ? {
          keywordMode: parsed.data.filters.keywordMode,
          keywords: parsed.data.filters.keywords,
          excludeKeywords: parsed.data.filters.excludeKeywords,
          excludeCompanies: parsed.data.filters.excludeCompanies,
          workModel: parsed.data.filters.workModel ?? null,
          salaryMinimum: parsed.data.filters.salaryMinimum ?? null,
          requireSalary: parsed.data.filters.requireSalary,
          postedWithinDays: parsed.data.filters.postedWithinDays ?? null,
        }
      : null;
    const deduped = dedupeAcrossBoards(taggedForUnify);
    const filtered = filters === null ? deduped : applyUnifiedFilters(deduped, filters);

    /*
     * AI matching: every unified card is scored against the recorded Career
     * Profile and preferences — one load, deterministic arithmetic, reasons
     * and gaps attached to every number. A workspace without a profile row
     * gets `match: null` and a basis saying so; scores computed over nothing
     * would be numbers wearing authority they do not have.
     */
    const evaluation = await loadEvaluationInputs(client, activeOrganization.id);
    const minimumScore = parsed.data.filters?.minimumScore ?? null;
    if (minimumScore !== null && !evaluation.profileRecorded) {
      throw new ApiRequestError(
        422,
        "match_score_needs_profile",
        "Record your Career Profile before filtering by match score — scores are computed from it.",
      );
    }
    const scored = filtered.map((hit) => ({
      ...hit,
      match: evaluation.profileRecorded
        ? evaluateJob(evaluation.profile, evaluation.preferences, {
            title: hit.job.title,
            company: hit.job.company,
            description: hit.job.description,
            salaryText: hit.job.salaryText,
            location: hit.job.location,
            workModel: hit.job.workModel,
          })
        : null,
    }));
    const unifiedHits = minimumScore === null
      ? scored
      : scored.filter((hit) => hit.match !== null && hit.match.score >= minimumScore);

    /*
     * Metering: one immutable event per board actually queried, so the
     * discovery page's credit meter counts something real. This is the one
     * write in the search path — an audit of the asking, never a copy of the
     * results. Logging failure must not fail a search that already answered.
     */
    const eventRows = adapters.map((adapter, index) => ({
      organization_id: activeOrganization.id,
      user_id: user.id,
      board: adapter.key,
      query: { text: query.text, location: query.location, limit: query.limit },
      results_returned:
        settled[index]?.status === "fulfilled"
          ? (settled[index] as PromiseFulfilledResult<{ hits: readonly unknown[] }>).value.hits.length
          : null,
    }));
    try {
      await client.from("job_seeker_search_events").insert(eventRows);
    } catch {
      // The searches answered; a meter that missed a tick stays a meter.
    }

    return jsonNoStore({
      query: { text: query.text, location: query.location, limit: query.limit },
      results,
      /*
       * Always present, even when empty. A caller that has to guess whether
       * the key is missing because nothing failed or because the shape
       * changed will eventually guess wrong and hide a failure.
       */
      failures,
      unified: {
        hits: unifiedHits,
        dedupedFrom: taggedForUnify.length,
        beforeFilters: deduped.length,
        /** How scores were produced, or that none could be. */
        matchBasis: evaluation.profileRecorded
          ? { computed: true as const, method: EVALUATION_METHOD_LABEL }
          : { computed: false as const, reason: "No Career Profile is recorded yet." },
      },
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
