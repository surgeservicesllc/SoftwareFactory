import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { assessFreshness, toSighting, type Sighting } from "@/lib/job-seeker/board-search/freshness";
import { postingUrlKey } from "@/lib/job-seeker/board-search/posting-key";
import {
  RECHECK_REUSE_MINUTES,
  RecheckRefusedError,
  recheckPosting,
  refuseUrl,
} from "@/lib/job-seeker/board-search/recheck";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Still open? (ADR-249). One bounded read of a posting's URL on the
 * person's request, recorded on the shared sightings row and folded into
 * the freshness verdict. Only URLs this product has already returned from
 * a search are rechecked — the ledger is the allow-list, so this endpoint
 * cannot be pointed at an arbitrary address — and a check under ten
 * minutes old is reused rather than repeated.
 */

const schema = z
  .object({
    url: z.string().trim().min(1).max(2_000),
    publishedOn: z.string().trim().min(1).max(40).nullish(),
    closesOn: z.string().trim().min(1).max(40).nullish(),
  })
  .strict();

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client } = await requireActiveOrganization();
    const parsed = schema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      throw new ApiRequestError(400, "recheck_invalid", parsed.error.issues[0]?.message ?? "The request was not valid.");
    }
    const refusal = refuseUrl(parsed.data.url);
    if (refusal !== null) throw new ApiRequestError(400, "recheck_refused", refusal);

    const key = postingUrlKey(parsed.data.url);
    const read = await client.rpc("read_posting_sightings", { p_url_keys: [key] });
    if (read.error) {
      throw new ApiRequestError(503, "sightings_unavailable", "The sightings ledger could not be read.");
    }
    const row = (Array.isArray(read.data) ? read.data : [])[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new ApiRequestError(404, "posting_unseen", "This product has not seen that posting; a search that returns it records it first.");
    }
    let sighting: Sighting = toSighting(row);
    const now = new Date();
    const reused = sighting.lastCheckedAt !== null && minutesSince(sighting.lastCheckedAt, now) < RECHECK_REUSE_MINUTES;

    if (!reused) {
      const outcome = await recheckPosting(parsed.data.url);
      const recorded = await client.rpc("record_posting_recheck", {
        p_url_key: key,
        p_status: outcome.status,
        p_http_status: outcome.httpStatus,
        p_note: outcome.note,
      });
      const updated = (Array.isArray(recorded?.data) ? recorded.data : [])[0] as Record<string, unknown> | undefined;
      if (recorded?.error || !updated) {
        throw new ApiRequestError(503, "recheck_not_recorded", "The recheck ran but could not be recorded.");
      }
      sighting = toSighting({ ...row, ...updated });
    }

    return jsonNoStore({
      urlKey: key,
      reused,
      recheck: {
        status: sighting.lastCheckStatus,
        note: sighting.lastCheckNote,
        checkedAt: sighting.lastCheckedAt,
        minutesAgo: sighting.lastCheckedAt === null ? null : minutesSince(sighting.lastCheckedAt, now),
      },
      freshness: assessFreshness({
        publishedOn: parsed.data.publishedOn ?? null,
        closesOn: parsed.data.closesOn ?? null,
        sighting,
        now,
      }),
    });
  } catch (error) {
    if (error instanceof RecheckRefusedError) {
      return requestErrorResponse(new ApiRequestError(400, "recheck_refused", error.message));
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "recheck_failed", message: "The posting could not be rechecked." } },
      { status: 500 },
    );
  }
}
