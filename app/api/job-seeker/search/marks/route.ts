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
 * Personal marks on search results: favorite, hidden, viewed.
 *
 * Search results live on other people's websites, so the only durable key a
 * mark can hang on is the posting's URL — the same URL the result card links
 * to. One row per (person, workspace, URL, mark) under forced RLS
 * (20260829000400); the queries here filter on organization and person and
 * the policies beneath refuse anything they miss.
 *
 * Both directions are idempotent on purpose. Marking is an upsert that
 * ignores the duplicate, and unmarking deletes whatever is there and reports
 * how many rows that was — a person unfavoriting from a second tab whose
 * state has drifted is correcting state, not making an error, so there is no
 * 404 to show them.
 */

const markSchema = z.enum(["favorite", "hidden", "viewed"]);

/** Mirrors the table's check constraint: http(s) URL, at most 800 chars. */
const jobUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(800)
  .url()
  .regex(/^https?:\/\//, "Only http(s) result URLs can be marked.");

const writeSchema = z
  .object({
    jobUrl: jobUrlSchema,
    mark: markSchema,
  })
  .strict();

type Mark = z.infer<typeof markSchema>;

export async function GET() {
  try {
    const { activeOrganization, user, client } = await requireActiveOrganization();
    // Newest first so the cap, if it ever bites, drops the oldest marks —
    // stale viewed rows — rather than what the person just touched.
    const { data, error } = await client
      .from("job_seeker_result_marks")
      .select("job_url, mark")
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) return databaseErrorResponse(error);
    const marks: Record<Mark, string[]> = { favorite: [], hidden: [], viewed: [] };
    for (const row of (data ?? []) as Array<{ job_url: string; mark: Mark }>) {
      marks[row.mark].push(row.job_url);
    }
    return jsonNoStore({ marks });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "marks_unavailable", message: "Your marks could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = writeSchema.parse(await readBoundedJson(request, 4_000));
    const { activeOrganization, user, client } = await requireActiveOrganization();
    // ignoreDuplicates turns the unique constraint into idempotence: marking
    // what is already marked inserts nothing and is still success.
    const { error } = await client
      .from("job_seeker_result_marks")
      .upsert(
        {
          organization_id: activeOrganization.id,
          user_id: user.id,
          job_url: payload.jobUrl,
          mark: payload.mark,
        },
        {
          onConflict: "organization_id,user_id,job_url,mark",
          ignoreDuplicates: true,
        },
      );
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ marked: { jobUrl: payload.jobUrl, mark: payload.mark } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "mark_invalid",
            message: "The mark is not valid.",
            issues: error.issues.slice(0, 5),
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "mark_failed", message: "The mark could not be saved." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = writeSchema.parse(await readBoundedJson(request, 4_000));
    const { activeOrganization, user, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_result_marks")
      .delete()
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .eq("job_url", payload.jobUrl)
      .eq("mark", payload.mark)
      .select("id");
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ removed: (data ?? []).length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "mark_invalid", message: "The request is not valid." } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "mark_failed", message: "The mark could not be removed." } },
      { status: 500 },
    );
  }
}
