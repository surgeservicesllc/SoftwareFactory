import { z } from "zod";

import { CRM_CONTACT_COLUMNS, toContactView, type CrmContactRow } from "@/lib/services/crm";
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
 * Add a person to an account. The composite foreign key in the schema is
 * what makes cross-organization attachment impossible; this route's
 * organization filter is how an honest insert satisfies it.
 */

const paramsSchema = z.object({ accountId: z.string().uuid() }).strict();

const contactSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100).nullish(),
    role: z.string().trim().min(1).max(120).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    phone: z.string().trim().regex(/^[0-9+() .\-]{7,32}$/).nullish(),
    isPrimary: z.boolean().default(false),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_account_id", message: "The account id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = contactSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_contacts")
      .insert({
        organization_id: activeOrganization.id,
        account_id: parsed.data.accountId,
        first_name: payload.firstName,
        last_name: payload.lastName ?? null,
        role: payload.role ?? null,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        is_primary: payload.isPrimary,
      })
      .select(CRM_CONTACT_COLUMNS)
      .single();
    if (error) {
      // The composite FK refuses an account outside this organization — or
      // one that does not exist. Both read as the same honest answer.
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "account_not_found", message: "No such account in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ contact: toContactView(data as unknown as CrmContactRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_contact",
            message: error.issues[0]?.message ?? "The contact could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_contact_not_recorded", message: "The contact could not be recorded." } },
      { status: 500 },
    );
  }
}
