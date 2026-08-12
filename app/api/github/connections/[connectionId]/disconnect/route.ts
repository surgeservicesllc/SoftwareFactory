import { z } from "zod";

import { requireGitHubConnection, requireGitHubUser, requireOrganizationManager } from "@/lib/github/access";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const disconnectSchema = z.object({
  confirmation: z.literal("DISCONNECT GITHUB"),
  installationId: z.number().int().positive(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) {
      return jsonNoStore(
        { error: { code: "invalid_connection_id", message: "Connection id must be a UUID." } },
        { status: 400 },
      );
    }
    const parsed = disconnectSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "disconnect_confirmation_required",
            message: 'Type "DISCONNECT GITHUB" and confirm the current installation id.',
          },
        },
        { status: 400 },
      );
    }
    const { supabase, user } = await requireGitHubUser();
    const context = await requireGitHubConnection(
      supabase,
      user.id,
      connectionId,
      undefined,
      { allowInactive: true },
    );
    await requireOrganizationManager(supabase, user.id, context.organizationId);
    const { data, error } = await createSupabaseGitHubWebhookClient().rpc(
      "disconnect_github_connection",
      {
        p_actor_user_id: user.id,
        p_connection_id: connectionId,
        p_expected_installation_id: parsed.data.installationId,
      },
    );
    if (error) throw error;
    return jsonNoStore({
      affectedProjectCount: data as number,
      connectionId,
      historyPreserved: true,
      status: "not_connected",
      statusLabel: "Not Connected",
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
