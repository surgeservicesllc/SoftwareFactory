import { botFabricErrorResponse } from "@/lib/bots/route";
import { listAiAccounts } from "@/lib/ai-accounts/broker";
import { findBotProvider } from "@/lib/bots/catalog";
import { jsonNoStore } from "@/lib/server/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * The organization's AI accounts, as the console shows them.
 *
 * Everything here is identity and lifecycle — provider, name, status, when it
 * last verified, what went wrong last. There is no credential column to leak
 * because the underlying table does not hold one.
 */

export const runtime = "nodejs";

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const rows = await listAiAccounts(client, activeOrganization.id);

    return jsonNoStore({
      accounts: rows.map((row) => ({
        id: row.account_id,
        provider: row.provider,
        providerLabel: findBotProvider(row.provider)?.label ?? row.provider,
        authMethod: row.auth_method,
        displayName: row.display_name,
        status: row.status,
        lastVerifiedAt: row.last_verified_at,
        lastError: row.last_error,
        createdAt: row.created_at,
      })),
      canManage: activeOrganization.role === "owner" || activeOrganization.role === "admin",
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "ai_accounts_unavailable",
      "AI accounts could not be listed.",
    );
  }
}
