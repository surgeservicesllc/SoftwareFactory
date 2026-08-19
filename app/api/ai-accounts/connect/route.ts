import { z } from "zod";

import {
  isBrokerProviderId,
  listAiAccounts,
  planConnect,
} from "@/lib/ai-accounts/broker";
import { wakeAuthBrokerWorker } from "@/lib/ai-accounts/dispatch";
import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { isCredentialStoreConfigured } from "@/lib/server/secret-box";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Connect, without a command.
 *
 * The person clicks Connect; this decides which account that means (reuse a
 * not-yet-connected one, create one on a free slot, or refuse because all
 * slots are live), opens a broker session on it, and returns the session id
 * the console polls. From here the worker drives the provider's real login
 * and the browser only ever watches state change — nothing is copied, pasted
 * into a terminal, or "checked now".
 */

export const runtime = "nodejs";

const requestSchema = z.object({
  provider: z.string().min(1).max(40),
  /** Reconnect an account by name; omitted for a plain Connect. */
  accountId: z.string().uuid().optional(),
}).strict();

const SESSION_TTL_SECONDS = 900;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success || !isBrokerProviderId(parsed.data.provider)) {
      return jsonNoStore(
        { error: { code: "invalid_request", message: "Choose a provider that offers sign-in." } },
        { status: 400 },
      );
    }

    // Refused before anything is created: a session whose credential could
    // never be stored would fail minutes later with no explanation.
    if (!isCredentialStoreConfigured()) {
      return jsonNoStore(
        {
          error: {
            code: "credential_store_not_configured",
            message:
              "SOFTWAREFACTORY_CREDENTIAL_KEY is not set, so a signed-in credential could not be stored.",
          },
        },
        { status: 503 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner" && activeOrganization.role !== "admin") {
      return jsonNoStore(
        { error: { code: "forbidden", message: "Only an owner or admin can connect an AI account." } },
        { status: 403 },
      );
    }

    const accounts = await listAiAccounts(client, activeOrganization.id);
    const plan = planConnect(parsed.data.provider, accounts, parsed.data.accountId);

    if (plan.kind === "full") {
      return jsonNoStore(
        {
          error: {
            code: "accounts_full",
            message: "All account slots for this provider are already connected.",
          },
        },
        { status: 409 },
      );
    }

    let accountId: string;
    if (plan.kind === "reuse") {
      accountId = plan.accountId;

      // Resume, don't duplicate: a refresh mid-sign-in (or a double click)
      // returns the session that already exists instead of superseding the
      // one a worker may be driving and restarting the person's progress.
      const open = await client.rpc("find_open_ai_auth_session", {
        p_organization_id: activeOrganization.id,
        p_ai_account_id: accountId,
      });
      const openRow = ((open.data ?? []) as Array<{
        open_session_id: string;
        open_expires_at: string;
      }>)[0];
      if (!open.error && openRow) {
        return jsonNoStore({
          accountId,
          sessionId: openRow.open_session_id,
          expiresInSeconds: Math.max(
            0,
            Math.floor((new Date(openRow.open_expires_at).getTime() - Date.now()) / 1000),
          ),
          resumed: true,
          workerWoken: false,
        });
      }
    } else {
      const created = await client.rpc("create_ai_account", {
        p_organization_id: activeOrganization.id,
        p_provider: parsed.data.provider,
        p_auth_method: "subscription",
        p_display_name: plan.displayName,
        p_credential_purpose: plan.purpose,
      });
      if (created.error || typeof created.data !== "string") {
        return jsonNoStore(
          { error: { code: "account_create_failed", message: "The AI account could not be added." } },
          { status: 403 },
        );
      }
      accountId = created.data;
    }

    const opened = await client.rpc("open_ai_auth_session", {
      p_organization_id: activeOrganization.id,
      p_ai_account_id: accountId,
      p_ttl_seconds: SESSION_TTL_SECONDS,
    });
    if (opened.error || typeof opened.data !== "string") {
      return jsonNoStore(
        { error: { code: "connect_session_failed", message: "The sign-in could not be started." } },
        { status: 403 },
      );
    }

    // Best-effort: a failed wake is not a failed connect — the workflow's
    // schedule picks the session up, just later. The flag lets the console
    // set expectations honestly.
    const workerWoken = await wakeAuthBrokerWorker(client, activeOrganization.id);

    return jsonNoStore({
      accountId,
      sessionId: opened.data,
      expiresInSeconds: SESSION_TTL_SECONDS,
      workerWoken,
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "connect_session_failed",
      "The sign-in could not be started.",
    );
  }
}
