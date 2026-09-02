import {
  summarizeHygiene,
  toContactHygieneView,
  type CrmContactHygieneRow,
} from "@/lib/services/trust";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Every contact the book should not trust as it stands, with the reasons,
 * computed live by `crm_contact_hygiene` under the caller's RLS. Nothing
 * here deletes or "cleans": a flagged contact is a person's call, made on
 * the account page.
 */

const CONTACT_CEILING = 1000;

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const read = await client
      .rpc("crm_contact_hygiene", { p_organization: activeOrganization.id })
      .limit(CONTACT_CEILING);
    if (read.error) return databaseErrorResponse(read.error);
    const contacts = ((read.data ?? []) as unknown as CrmContactHygieneRow[]).map(toContactHygieneView);
    return jsonNoStore({
      contacts,
      summary: summarizeHygiene(contacts),
      ceiling: { contacts: CONTACT_CEILING, reached: contacts.length >= CONTACT_CEILING },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_hygiene_unavailable", message: "The hygiene report could not be read." } },
      { status: 500 },
    );
  }
}
