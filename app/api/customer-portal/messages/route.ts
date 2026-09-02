import { z } from "zod";

import {
  toPortalMessageMineView,
  type CrmPortalMessageMineRow,
} from "@/lib/services/customers-side";
import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * The customer's side of the thread: read it, write to it, and mark what
 * staff wrote as seen. Every call goes through a definer scoped to the
 * caller's own account; the table itself is never the customer's to read.
 */

const sendSchema = z
  .object({
    body: z.string().trim().min(1, "Write something.").max(2000),
    requestId: z.string().uuid().nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_messages_mine");
    if (error) throw error;
    const messages = ((data ?? []) as CrmPortalMessageMineRow[]).map(toPortalMessageMineView);
    return jsonNoStore({
      messages,
      counts: {
        total: messages.length,
        unreadFromStaff: messages.filter((message) => message.authorKind === "staff" && message.readAt === null).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_messages_unavailable", "Your messages could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = sendSchema.parse(await readBoundedJson(request, 16_000));
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_message_send", {
      p_body: payload.body,
      p_request: payload.requestId ?? null,
    });
    if (error) {
      if (/not on this account/i.test(error.message ?? "")) {
        return jsonNoStore({ error: { code: "request_not_on_account", message: "That request is not on your account." } }, { status: 404 });
      }
      throw error;
    }
    return jsonNoStore({ messageId: data as string }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_message", message: error.issues[0]?.message ?? "The message could not be sent." } },
        { status: 422 },
      );
    }
    return portalErrorResponse(error, "portal_message_not_sent", "Your message could not be sent.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_messages_mark_read");
    if (error) throw error;
    return jsonNoStore({ marked: Number(data ?? 0) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return portalErrorResponse(error, "portal_messages_not_marked", "Your messages could not be marked read.");
  }
}
