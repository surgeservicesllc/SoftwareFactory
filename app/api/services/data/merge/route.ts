import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  isClientSafeDatabaseErrorCode,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Merge two accounts. The database does the whole thing in one statement
 * and refuses the two collisions it cannot decide (a portal login with the
 * same email on both sides; a live autopay on both). Its refusal is
 * returned in its own words.
 */

const schema = z.object({ survivorId: z.string().uuid(), loserId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = schema.parse(await readBoundedJson(request, 8_000));
    const { client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_merge_accounts", {
      p_survivor: payload.survivorId,
      p_loser: payload.loserId,
    });
    if (error) {
      if (isClientSafeDatabaseErrorCode(error.code)) {
        return jsonNoStore({ error: { code: "merge_refused", message: error.message } }, { status: 409 });
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ merged: { survivorId: payload.survivorId, loserId: payload.loserId }, counts: data ?? {} });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_merge", message: "Two account ids are required." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "crm_merge_failed", message: "The accounts could not be merged." } }, { status: 500 });
  }
}
