import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import {
  buildOutreachDraft,
  type ProfileForDocuments,
} from "@/lib/job-seeker/documents";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Outreach drafts, for human review. Generated from recorded facts only,
 * stored as 'draft', and never marked sent by anything in this system —
 * no send integration exists, and the schema refuses 'sent' without a
 * sent_at for exactly that reason.
 */

const draftSchema = z
  .object({
    contactId: z.string().uuid(),
    applicationId: z.string().uuid(),
  })
  .strict();

const OUTREACH_COLUMNS = "id, contact_id, application_id, subject, body, status, sent_at, created_at";

type OutreachRow = {
  id: string;
  contact_id: string;
  application_id: string | null;
  subject: string | null;
  body: string;
  status: string;
  sent_at: string | null;
  created_at: string;
};

function toView(row: OutreachRow) {
  return {
    id: row.id,
    contactId: row.contact_id,
    applicationId: row.application_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_outreach")
      .select(OUTREACH_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ outreach: ((data ?? []) as OutreachRow[]).map(toView) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_outreach_unavailable", message: "Outreach drafts could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = draftSchema.parse(await readBoundedJson(request, 8_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const [{ data: contact, error: contactError }, { data: application, error: applicationError }, { data: profileRow, error: profileError }] =
      await Promise.all([
        client
          .from("job_seeker_contacts")
          .select("id, name, role")
          .eq("organization_id", activeOrganization.id)
          .eq("id", payload.contactId)
          .maybeSingle<{ id: string; name: string; role: string | null }>(),
        client
          .from("job_seeker_applications")
          .select("id, job_id")
          .eq("organization_id", activeOrganization.id)
          .eq("id", payload.applicationId)
          .maybeSingle<{ id: string; job_id: string }>(),
        client
          .from("job_seeker_profiles")
          .select("full_name, email, phone, linkedin_url, location, summary, skills, technologies, certifications, employment_history, education")
          .eq("organization_id", activeOrganization.id)
          .maybeSingle(),
      ]);
    if (contactError) return databaseErrorResponse(contactError);
    if (applicationError) return databaseErrorResponse(applicationError);
    if (profileError) return databaseErrorResponse(profileError);
    if (!contact || !application) {
      return jsonNoStore(
        { error: { code: "not_found", message: "The contact or application does not exist or is not yours." } },
        { status: 404 },
      );
    }
    if (!profileRow) {
      return jsonNoStore(
        { error: { code: "profile_required", message: "Outreach drafts are written from your career profile only; complete it first." } },
        { status: 409 },
      );
    }

    const { data: jobRow, error: jobError } = await client
      .from("job_seeker_jobs")
      .select("title, company, description")
      .eq("id", application.job_id)
      .single<{ title: string; company: string; description: string | null }>();
    if (jobError) return databaseErrorResponse(jobError);

    const profile: ProfileForDocuments = {
      fullName: profileRow.full_name,
      email: profileRow.email,
      phone: profileRow.phone,
      linkedinUrl: profileRow.linkedin_url,
      location: profileRow.location,
      summary: profileRow.summary,
      skills: (profileRow.skills ?? []) as string[],
      technologies: (profileRow.technologies ?? []) as string[],
      certifications: (profileRow.certifications ?? []) as string[],
      employmentHistory: (profileRow.employment_history ?? []) as ProfileForDocuments["employmentHistory"],
      education: (profileRow.education ?? []) as ProfileForDocuments["education"],
    };
    const draft = buildOutreachDraft(profile, jobRow, { name: contact.name, role: contact.role });

    const { data, error } = await client
      .from("job_seeker_outreach")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        contact_id: contact.id,
        application_id: application.id,
        subject: draft.subject,
        body: draft.body,
        status: "draft",
      })
      .select(OUTREACH_COLUMNS)
      .single<OutreachRow>();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ outreach: toView(data) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_outreach", message: "The outreach payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_outreach_unavailable", message: "The outreach draft could not be created." } },
      { status: 500 },
    );
  }
}
