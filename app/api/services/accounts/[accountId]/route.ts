import { z } from "zod";

import {
  CRM_ACCOUNT_COLUMNS,
  CRM_ACCOUNT_STATUSES,
  CRM_CONTACT_COLUMNS,
  CRM_PROPERTY_COLUMNS,
  CRM_TIMELINE_COLUMNS,
  toAccountView,
  toContactView,
  toPropertyView,
  toTimelineView,
  type CrmAccountRow,
  type CrmContactRow,
  type CrmPropertyRow,
  type CrmTimelineRow,
} from "@/lib/services/crm";
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
 * One account's 360-degree record: the account itself, its people, its
 * properties, and the newest slice of its immutable timeline. PATCH corrects
 * fields and moves the lifecycle status — the status-change history line is
 * written by the database trigger in the same transaction, never by this
 * route, so the audit trail cannot be forgotten by a caller.
 */

const paramsSchema = z.object({ accountId: z.string().uuid() }).strict();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(CRM_ACCOUNT_STATUSES).optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().regex(/^[0-9+() .\-]{7,32}$/).nullable().optional(),
    source: z.string().trim().min(1).max(120).nullable().optional(),
    billingAddress: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

const TIMELINE_PAGE = 100;

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_account_id", message: "The account id is not a UUID." } },
        { status: 400 },
      );
    }
    const { client, activeOrganization } = await requireActiveOrganization();

    const account = await client
      .from("crm_accounts")
      .select(CRM_ACCOUNT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.accountId)
      .maybeSingle();
    if (account.error) return databaseErrorResponse(account.error);
    if (!account.data) {
      return jsonNoStore(
        { error: { code: "account_not_found", message: "No such account in this workspace." } },
        { status: 404 },
      );
    }

    const [contacts, properties, timeline] = await Promise.all([
      client
        .from("crm_contacts")
        .select(CRM_CONTACT_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("account_id", parsed.data.accountId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(100),
      client
        .from("crm_properties")
        .select(CRM_PROPERTY_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("account_id", parsed.data.accountId)
        .order("created_at", { ascending: true })
        .limit(100),
      client
        .from("crm_timeline_events")
        .select(CRM_TIMELINE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("account_id", parsed.data.accountId)
        .order("occurred_at", { ascending: false })
        .limit(TIMELINE_PAGE + 1),
    ]);
    if (contacts.error) return databaseErrorResponse(contacts.error);
    if (properties.error) return databaseErrorResponse(properties.error);
    if (timeline.error) return databaseErrorResponse(timeline.error);

    const timelineRows = (timeline.data ?? []) as unknown as CrmTimelineRow[];
    return jsonNoStore({
      account: toAccountView(account.data as unknown as CrmAccountRow),
      contacts: ((contacts.data ?? []) as unknown as CrmContactRow[]).map(toContactView),
      properties: ((properties.data ?? []) as unknown as CrmPropertyRow[]).map(toPropertyView),
      timeline: timelineRows.slice(0, TIMELINE_PAGE).map(toTimelineView),
      // Admitted, not silently cut: the reader learns there is older history.
      timelineTruncated: timelineRows.length > TIMELINE_PAGE,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_account_unavailable", message: "The account could not be read." } },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.status !== undefined) changes.status = payload.status;
    if (payload.email !== undefined) changes.email = payload.email;
    if (payload.phone !== undefined) changes.phone = payload.phone;
    if (payload.source !== undefined) changes.source = payload.source;
    if (payload.billingAddress !== undefined) changes.billing_address = payload.billingAddress;
    if (payload.notes !== undefined) changes.notes = payload.notes;

    const { data, error } = await client
      .from("crm_accounts")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", parsed.data.accountId)
      .select(CRM_ACCOUNT_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "account_not_found", message: "No such account in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ account: toAccountView(data as unknown as CrmAccountRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_account_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_account_not_updated", message: "The account could not be updated." } },
      { status: 500 },
    );
  }
}
