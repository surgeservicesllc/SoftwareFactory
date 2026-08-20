import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Contacts a person has researched and recorded: recruiters, hiring
 * managers, relevant executives. Recorded by the person, attributed to a
 * source when one is named — never scraped or invented by this system.
 */

const createContactSchema = z
  .object({
    applicationId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(200).nullish(),
    source: z.string().trim().min(1).max(200).nullish(),
    linkedinUrl: z.string().trim().url().startsWith("https://").max(400).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    notes: z.string().trim().max(4000).nullish(),
  })
  .strict();

const CONTACT_COLUMNS = "id, application_id, name, role, source, linkedin_url, email, notes, created_at";

type ContactRow = {
  id: string;
  application_id: string | null;
  name: string;
  role: string | null;
  source: string | null;
  linkedin_url: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

function toView(row: ContactRow) {
  return {
    id: row.id,
    applicationId: row.application_id,
    name: row.name,
    role: row.role,
    source: row.source,
    linkedinUrl: row.linkedin_url,
    email: row.email,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_contacts")
      .select(CONTACT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ contacts: ((data ?? []) as ContactRow[]).map(toView) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_contacts_unavailable", message: "Contacts could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createContactSchema.parse(await readBoundedJson(request, 32_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The contact appears to contain a credential-shaped value at ${sensitive.path}; remove it and save again.`,
      );
    }
    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_contacts")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        application_id: payload.applicationId ?? null,
        name: payload.name,
        role: payload.role ?? null,
        source: payload.source ?? null,
        linkedin_url: payload.linkedinUrl ?? null,
        email: payload.email ?? null,
        notes: payload.notes ?? null,
      })
      .select(CONTACT_COLUMNS)
      .single<ContactRow>();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ contact: toView(data) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_contact", message: "The contact payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_contacts_unavailable", message: "The contact could not be saved." } },
      { status: 500 },
    );
  }
}
