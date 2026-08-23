import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Write the fields a person accepted from a resume reading onto their profile.
 *
 * The route keeps no authority check of its own. `apply_resume_extraction`
 * already refuses an unauthenticated caller, a reading that belongs to someone
 * else, a second application of the same reading, an unknown field name, and a
 * reading of a file that could not be read — each with its own SQLSTATE and
 * its own sentence. `databaseErrorResponse` classifies those, so the caller
 * receives the refusal this repository actually wrote rather than a paraphrase
 * that could drift away from the rule it describes.
 */

const bodySchema = z.object({
  /**
   * The fields the person ticked. Bounded to the thirteen the profile has, so
   * a malformed request is refused here rather than by a CHECK deep in a
   * function; the database refuses unknown names too, and this is the cheaper
   * of the two places to notice.
   */
  fields: z
    .array(
      z.enum([
        "fullName",
        "email",
        "phone",
        "linkedinUrl",
        "location",
        "summary",
        "employmentHistory",
        "education",
        "accomplishments",
        "skills",
        "certifications",
        "technologies",
        "industries",
      ]),
    )
    .min(1, "Choose at least one field to apply.")
    .max(13),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ extractionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { extractionId } = await params;
    if (!z.string().uuid().safeParse(extractionId).success) {
      throw new ApiRequestError(400, "invalid_extraction", "The reading id is not valid.");
    }

    const body = bodySchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!body.success) {
      throw new ApiRequestError(
        422,
        "invalid_fields",
        body.error.issues[0]?.message ?? "Choose at least one field to apply.",
      );
    }
    // The same field ticked twice is one write, not an error.
    const fields = [...new Set(body.data.fields)];

    const { client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("apply_resume_extraction", { p_extraction_id: extractionId, p_fields: fields })
      .single<{ extraction_id: string; applied_fields: string[]; applied_at: string }>();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      applied: {
        extractionId: data.extraction_id,
        fields: data.applied_fields,
        appliedAt: data.applied_at,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      {
        error: {
          code: "resume_apply_unavailable",
          message: "Those fields could not be applied just now.",
        },
      },
      { status: 500 },
    );
  }
}
