import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { seedDemoData } from "@/lib/services/demo-seed";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Seed the clearly-labeled Demo Data book of business into this workspace.
 *
 * Only an empty book accepts it: demo rows must never mix into a real
 * clientele, and the accounts table deliberately has no DELETE, so there is
 * no quiet way back out. Every insert goes through the caller's own
 * RLS-scoped session — the same live Supabase path every real record takes.
 */

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const existing = await client
      .from("crm_accounts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrganization.id);
    if (existing.error) return databaseErrorResponse(existing.error);
    if ((existing.count ?? 0) > 0) {
      return jsonNoStore(
        {
          error: {
            code: "book_not_empty",
            message:
              "Demo Data seeds only an empty workspace — this book already has accounts, and demo rows must never mix into a real clientele.",
          },
        },
        { status: 409 },
      );
    }

    const outcome = await seedDemoData(client, activeOrganization.id, user.id);
    if ("error" in outcome) return databaseErrorResponse(outcome.error);
    return jsonNoStore({ seeded: outcome.seeded }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "demo_seed_failed", message: "The demo data could not be seeded." } },
      { status: 500 },
    );
  }
}
