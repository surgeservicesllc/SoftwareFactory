import { z } from "zod";

import {
  CRM_PORTAL_MESSAGE_COLUMNS,
  summarizeThreads,
  toPortalMessageView,
  type CrmPortalMessageRow,
} from "@/lib/services/customers-side";
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
 * The staff side of the thread. A message is immutable once sent (the
 * table's trigger says so); the only thing staff change afterwards is the
 * read mark on what a customer wrote. Staff write as themselves — the
 * insert policy refuses a message signed by anybody else, or one that
 * claims to be the customer's.
 */

const MESSAGE_CEILING = 500;

const sendSchema = z
  .object({
    accountId: z.string().uuid(),
    body: z.string().trim().min(1, "Write something.").max(2000),
    requestId: z.string().uuid().nullish(),
  })
  .strict();

const readSchema = z.object({ messageId: z.string().uuid() }).strict();

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const accountId = new URL(request.url).searchParams.get("accountId");
    let query = client
      .from("crm_portal_messages")
      .select(CRM_PORTAL_MESSAGE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("sent_at", { ascending: accountId !== null })
      .limit(MESSAGE_CEILING);
    if (accountId !== null) query = query.eq("account_id", accountId);
    const read = await query;
    if (read.error) return databaseErrorResponse(read.error);
    const messages = ((read.data ?? []) as unknown as CrmPortalMessageRow[]).map(toPortalMessageView);
    return jsonNoStore({
      accountId,
      messages,
      summary: summarizeThreads(messages),
      ceiling: { messages: MESSAGE_CEILING, reached: messages.length >= MESSAGE_CEILING },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_messages_unavailable", message: "The messages could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = sendSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization, user } = await requireActiveOrganization();
    const write = await client
      .from("crm_portal_messages")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        request_id: payload.requestId ?? null,
        author_kind: "staff",
        author_user_id: user.id,
        body: payload.body,
      })
      .select(CRM_PORTAL_MESSAGE_COLUMNS)
      .single();
    if (write.error) return databaseErrorResponse(write.error);
    return jsonNoStore({ message: toPortalMessageView(write.data as unknown as CrmPortalMessageRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_message", message: error.issues[0]?.message ?? "The message could not be sent." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_message_not_sent", message: "The message could not be sent." } },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = readSchema.parse(await readBoundedJson(request, 1_000));
    const { client, activeOrganization } = await requireActiveOrganization();
    const write = await client
      .from("crm_portal_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.messageId)
      .eq("author_kind", "customer")
      .is("read_at", null)
      .select(CRM_PORTAL_MESSAGE_COLUMNS)
      .maybeSingle();
    if (write.error) return databaseErrorResponse(write.error);
    if (!write.data) {
      return jsonNoStore(
        { error: { code: "message_not_marked", message: "That message is not an unread customer message in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ message: toPortalMessageView(write.data as unknown as CrmPortalMessageRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_message", message: "Name the message." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_message_not_marked", message: "The message could not be marked read." } },
      { status: 500 },
    );
  }
}
