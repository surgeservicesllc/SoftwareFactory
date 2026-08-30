import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { seedDemoData } from "@/lib/services/demo-seed";
import { SEED_SCALES } from "@/lib/services/seed-generator";
import { runSeed } from "@/lib/services/seed-runner";
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
 *
 * Two shapes. The default `book` is the curated narrative clientele: small
 * enough to read end to end, written to present the product. `full` is the
 * test corpus — hundreds of rows in every table, spanning years, covering
 * every status and stage, for exercising dashboards, reports and pagination
 * against something the size of a real book of business.
 */

const requestSchema = z
  .object({ scale: z.enum(["book", ...SEED_SCALES]).default("book") })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    // An empty body means the curated book, so the existing caller is
    // unchanged and a scale is opt-in.
    const raw = await readBoundedJson(request, 2_000).catch(() => ({}));
    const parsed = requestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_seed_scale", message: "Unknown seed scale." } },
        { status: 422 },
      );
    }
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

    const outcome =
      parsed.data.scale === "book"
        ? await seedDemoData(client, activeOrganization.id, user.id)
        : await runSeed(client, activeOrganization.id, user.id, parsed.data.scale);
    if ("error" in outcome) return databaseErrorResponse(outcome.error);
    return jsonNoStore({ scale: parsed.data.scale, seeded: outcome.seeded }, { status: 201 });
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
