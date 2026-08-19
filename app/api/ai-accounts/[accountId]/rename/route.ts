import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
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
      const code = (error as { code?: string }).code;
      return jsonNoStore(
        {
          error: {
            code: "rename_failed",
            message: code === "23505"
              ? "Another account already uses that name."
              : "The account could not be renamed.",
            detail: code ?? "unknown",
          },
        },
        { status: code === "23505" ? 409 : 403 },
      );
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
