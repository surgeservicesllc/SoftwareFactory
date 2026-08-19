import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Renaming an AI account changes its label and nothing else — provider,
 * credential slot, sessions, and bots are untouched. The database enforces
 * the same constraints the create path does, uniqueness included.
 */

export const runtime = "nodejs";

const requestSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { accountId } = await params;
    if (!z.string().uuid().safeParse(accountId).success) {
      return jsonNoStore(
        { error: { code: "invalid_account", message: "The account identifier is invalid." } },
        { status: 400 },
      );
    }

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_name",
            message: "The account name must be between 1 and 80 characters.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can rename an AI account." } },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("rename_ai_account", {
      p_organization_id: activeOrganization.id,
      p_ai_account_id: accountId,
      p_display_name: parsed.data.name,
    });
    if (error) {
      /*
       * One friendly sentence the shared policy cannot write, then the shared
       * policy. `23505` is not on its client-safe list — a raw unique-violation
       * message names a constraint — so the collision is translated here and
       * everything else goes through the vetted path, which passes the
       * database's own words for the codes it recognises and stays generic
       * otherwise.
       */
      if ((error as { code?: string }).code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "rename_failed",
              message: "Another account already uses that name.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }

    return jsonNoStore({ renamed: data === true });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "rename_failed",
      "The account could not be renamed.",
    );
  }
}
