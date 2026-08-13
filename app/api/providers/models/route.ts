import { z } from "zod";

import { ProviderError } from "@/lib/providers/errors";
import { getProviderAdapter } from "@/lib/providers/registry";
import { listModelConfigurations } from "@/lib/providers/service";
import { isProviderId, PROVIDER_IDS } from "@/lib/providers/types";
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

const upsertModelSchema = z
  .object({
    provider: z.enum(PROVIDER_IDS),
    model: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    displayName: z.string().trim().min(1).max(160),
    capabilities: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    inputCostPerMillionMicros: z.number().int().min(0).max(1_000_000_000_000).nullable().default(null),
    outputCostPerMillionMicros: z.number().int().min(0).max(1_000_000_000_000).nullable().default(null),
  })
  .strict();

/**
 * Model discovery.
 *
 * With `?provider=`, this asks the provider for its live catalogue so an owner
 * selects a real identifier rather than typing a guess. Without it, this
 * returns the organization's configured catalogue.
 */
export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const requestedProvider = new URL(request.url).searchParams.get("provider");

    if (!requestedProvider) {
      return jsonNoStore({
        configuredModels: await listModelConfigurations(client, activeOrganization.id),
      });
    }

    if (!isProviderId(requestedProvider)) {
      return jsonNoStore(
        { error: { code: "unknown_provider", message: "The provider is not recognized." } },
        { status: 400 },
      );
    }

    try {
      const models = await getProviderAdapter(requestedProvider).listModels();
      return jsonNoStore({ provider: requestedProvider, models });
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError("unknown", "Model discovery failed.", requestedProvider);

      return jsonNoStore(
        {
          provider: requestedProvider,
          models: [],
          error: { code: providerError.code, message: providerError.message },
        },
        { status: providerError.code === "not_configured" || providerError.code === "disabled" ? 409 : 502 },
      );
    }
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "Model discovery failed safely." } },
      { status: 500 },
    );
  }
}

/** Create or update one entry in the organization's model catalogue. */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = upsertModelSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_model_configuration",
            message: "The model configuration is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .rpc("upsert_provider_model_configuration", {
        p_organization_id: activeOrganization.id,
        p_provider: parsed.data.provider,
        p_model: parsed.data.model,
        p_display_name: parsed.data.displayName,
        p_capabilities: parsed.data.capabilities,
        p_enabled: parsed.data.enabled,
        p_is_default: parsed.data.isDefault,
        p_input_cost_per_million_micros: parsed.data.inputCostPerMillionMicros,
        p_output_cost_per_million_micros: parsed.data.outputCostPerMillionMicros,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ configuration: data }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "The model configuration failed safely." } },
      { status: 500 },
    );
  }
}
