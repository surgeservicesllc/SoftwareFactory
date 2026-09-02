import { z } from "zod";

import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The documents a job search has produced: tailored resumes, cover letters,
 * and application answers.
 *
 * Every row is written by generation against a specific application, and the
 * table keeps every version rather than overwriting — so this lists history,
 * not just the latest. Reads are RLS-scoped to the person, not merely to the
 * organization: a colleague cannot see another person's cover letter.
 */

const KINDS = ["resume", "cover_letter", "answers"] as const;
const kindSchema = z.enum(KINDS);

type DocumentRow = {
  id: string;
  application_id: string;
  kind: string;
  version: number;
  origin?: string | null;
  model?: string | null;
  content: string;
  created_at: string;
  job_seeker_applications: {
    stage: string;
    job_seeker_jobs: { title: string; company: string } | null;
  } | null;
};

export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get("kind");
    const kind = requested === null ? null : kindSchema.safeParse(requested);
    if (kind && !kind.success) {
      return jsonNoStore(
        { error: { code: "invalid_kind", message: `A document kind is one of ${KINDS.join(", ")}.` } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    let query = client
      .from("job_seeker_documents")
      .select(
        "id, application_id, kind, version, content, created_at, origin, model, "
        + "job_seeker_applications ( stage, job_seeker_jobs ( title, company ) )",
      )
      .eq("organization_id", activeOrganization.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (kind?.success) query = query.eq("kind", kind.data);

    const { data, error } = await query;
    if (error) throw error;

    return jsonNoStore({
      documents: ((data ?? []) as unknown as DocumentRow[]).map((row) => {
        const job = row.job_seeker_applications?.job_seeker_jobs ?? null;
        return {
          id: row.id,
          applicationId: row.application_id,
          kind: row.kind,
          version: row.version,
          origin: row.origin ?? "baseline",
          model: row.model ?? null,
          createdAt: row.created_at,
          stage: row.job_seeker_applications?.stage ?? null,
          title: job?.title ?? null,
          company: job?.company ?? null,
          /*
           * A preview, not the document. The list is a list; sending 60k
           * characters per row to render four lines of it is waste, and the
           * full text has its own read when a person opens one.
           */
          preview: row.content.slice(0, 280),
          characters: row.content.length,
        };
      }),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_documents_unavailable", message: "Documents could not be listed." } },
      { status: 500 },
    );
  }
}
