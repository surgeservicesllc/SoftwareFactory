import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const subscribeSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    source: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9-]{0,40}$/)
      .optional(),
  })
  .strict();

/**
 * Newsletter subscribe.
 *
 * Writes go through `subscribe_to_newsletter`, a SECURITY DEFINER function that
 * revalidates the address and is idempotent per email. The response is
 * deliberately identical for a new and an existing address so this endpoint
 * cannot be used to test whether someone is already subscribed.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = subscribeSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_email", message: "Enter a valid email address." } },
        { status: 400 },
      );
    }
    if (findSensitiveData(parsed.data)) {
      return jsonNoStore(
        { error: { code: "invalid_email", message: "Enter a valid email address." } },
        { status: 400 },
      );
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("subscribe_to_newsletter", {
      p_email: parsed.data.email,
      p_source: parsed.data.source ?? "resources",
    });

    if (error) {
      if (error.code === "22023") {
        return jsonNoStore(
          { error: { code: "invalid_email", message: "Enter a valid email address." } },
          { status: 400 },
        );
      }
      return jsonNoStore(
        {
          error: {
            code: "subscription_unavailable",
            message: "Subscriptions are unavailable right now. Please try again later.",
          },
        },
        { status: 503 },
      );
    }

    return jsonNoStore({ status: "subscribed" }, { status: 202 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return jsonNoStore(
      {
        error: {
          code: "subscription_unavailable",
          message: "Subscriptions are unavailable right now. Please try again later.",
        },
      },
      { status: 503 },
    );
  }
}
