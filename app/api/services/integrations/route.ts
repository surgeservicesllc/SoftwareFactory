import { z } from "zod";

import {
  CRM_INTEGRATION_PROVIDERS,
  integrationStanding,
  toIntegrationStatusView,
  type CrmIntegrationStatusRow,
} from "@/lib/services/crm";
import { ApiRequestError, jsonNoStore, readBoundedJson, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Which provider capabilities this workspace actually has.
 *
 * There is no `status` in the request or the response that a caller could
 * set. `live` comes from `crm_integration_status`, which derives it from a
 * sealed credential really existing — so this route cannot be used to
 * claim a capability, only to configure the intention to have one.
 *
 * There is also no credential field anywhere in this file. Supplying one
 * is the vault's business (`open_provider_connect_session`), which never
 * lets the value through a browser round-trip in the clear.
 */

const upsertSchema = z
  .object({
    provider: z.enum(CRM_INTEGRATION_PROVIDERS as unknown as [string, ...string[]]),
    credentialPurpose: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, "A purpose name, lower-case with underscores."),
    displayLabel: z.string().trim().min(1).max(120).nullish(),
    enabled: z.boolean().default(false),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_integration_status", {
      p_organization_id: activeOrganization.id,
    });
    if (error) throw error;

    const providers = ((data ?? []) as CrmIntegrationStatusRow[])
      .map(toIntegrationStatusView)
      .map((status) => ({ ...status, standing: integrationStanding(status) }));

    return jsonNoStore({
      providers,
      counts: {
        total: providers.length,
        live: providers.filter((provider) => provider.live).length,
        /*
         * Configured and credentialled but switched off, versus configured
         * and still waiting for a credential. Counted apart because the
         * owner's next step is different: one is a decision, the other is
         * an account somebody has to open.
         */
        paused: providers.filter((provider) => provider.standing === "paused").length,
        awaitingCredential: providers.filter(
          (provider) => provider.standing === "awaiting_credential",
        ).length,
        notConfigured: providers.filter((provider) => provider.standing === "not_configured").length,
        failing: providers.filter((provider) => provider.standing === "failing").length,
      },
    });
  } catch (error) {
    return failure(error, "invalid_integration_query", "integrations_unavailable",
      "Your integrations could not be loaded.");
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = upsertSchema.parse(await readBoundedJson(request, 16_000));
    const { client, activeOrganization, user } = await requireActiveOrganization();

    const { error } = await client
      .from("crm_service_integrations")
      .upsert(
        {
          organization_id: activeOrganization.id,
          provider: payload.provider,
          credential_purpose: payload.credentialPurpose,
          display_label: payload.displayLabel ?? null,
          enabled: payload.enabled,
          settings: payload.settings,
          created_by: user.id,
        } as never,
        { onConflict: "organization_id,provider" },
      );
    if (error) {
      // The schema refuses anything that looks like a key in the label or
      // the settings blob. That refusal is the operator's answer — it
      // means they pasted a credential where metadata goes.
      if (/no_secret|text_has_likely_secret/.test(error.message ?? "")) {
        return jsonNoStore(
          {
            error: {
              code: "credential_in_metadata",
              message:
                "That looks like a credential. Connect the provider instead — this record holds only its name and settings.",
            },
          },
          { status: 422 },
        );
      }
      throw error;
    }

    // Re-read rather than echoing the write: `live` is derived, and the
    // caller must never be handed a status this route composed itself.
    const { data, error: readError } = await client.rpc("crm_integration_status", {
      p_organization_id: activeOrganization.id,
    });
    if (readError) throw readError;

    const status = ((data ?? []) as CrmIntegrationStatusRow[])
      .map(toIntegrationStatusView)
      .find((row) => row.provider === payload.provider);

    return jsonNoStore({
      provider:
        status === undefined
          ? null
          : { ...status, standing: integrationStanding(status) },
    });
  } catch (error) {
    return failure(error, "invalid_integration", "integration_not_saved",
      "That integration could not be saved.");
  }
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
