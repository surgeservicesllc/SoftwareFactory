import { z } from "zod";

import {
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { undeclaredModels, type ModelRow } from "@/lib/resources/candidates";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

type QueryResult<Row> = { data: Row[] | null; error: { message: string } | null };

/**
 * Declare what the Resource Manager needs to know about a model.
 *
 * Without this the two columns added by `20260814000220` could only be set by a
 * hand-written UPDATE, which left routing permanently unable to find an
 * eligible worker for demanding work. That refusal is correct — undeclared
 * fails closed — but it was not a state anyone could leave.
 *
 * `null` clears a declaration rather than being rejected, because an owner who
 * realises they declared the wrong tier needs to be able to withdraw the claim
 * instead of substituting another guess.
 */

const declareSchema = z
  .object({
    provider: z.enum(["anthropic", "openai"]),
    model: z.string().trim().min(1).max(128),
    // `null` is a withdrawal; omitting the field is also a withdrawal, because
    // the underlying function sets rather than merges — there is no way to say
    // "leave the other one alone", and pretending otherwise would make a
    // partial request silently clear the field it did not mention.
    strengthTier: z.enum(["economical", "balanced", "strong"]).nullable(),
    contextLimitTokens: z.number().int().min(1).max(100_000_000).nullable(),
  })
  .strict();

type DeclarationRow = {
  declared_provider: string;
  declared_model: string;
  declared_strength_tier: string | null;
  declared_context_limit_tokens: number | null;
  fully_declared: boolean;
};

/** Which configured models still lack a declaration, and are therefore unroutable. */
export async function GET() {
  try {
    const context = await operationsContext();

    const models: QueryResult<ModelRow> = await context.client
      .from("provider_model_configurations")
      .select("provider,model,capabilities,enabled,strength_tier,context_limit_tokens")
      .eq("organization_id", context.activeOrganization.id);
    if (models.error) return databaseErrorResponse(models.error);

    const rows = models.data ?? [];
    const undeclared = undeclaredModels(rows);

    return jsonNoStore({
      models: rows.map((row) => ({
        provider: row.provider,
        model: row.model,
        enabled: row.enabled,
        strengthTier: row.strength_tier,
        contextLimitTokens: row.context_limit_tokens,
        fullyDeclared: row.strength_tier !== null && row.context_limit_tokens !== null,
      })),
      undeclared,
      // Stated rather than left to be inferred from an empty routing result.
      note: undeclared.length === 0
        ? "Every configured model is declared."
        : "An undeclared model cannot take work that requires a strong model, and cannot be shown to fit any context. Routing will refuse it until both values are declared.",
    });
  } catch (error) {
    return operationsFailure(error, "model_declarations_failed", "The model declarations could not be read.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = declareSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return invalidRequest(
        "Provide a provider, model, strength tier and context limit. Send null for either to withdraw that declaration.",
      );
    }

    const context = await operationsContext();
    // Declaring a tier decides what work the model may be given, so it carries
    // the same authority as configuring the model itself.
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data, error } = await context.client
      .rpc("declare_model_characteristics", {
        p_organization_id: context.activeOrganization.id,
        p_provider: parsed.data.provider,
        p_model: parsed.data.model,
        p_strength_tier: parsed.data.strengthTier,
        p_context_limit_tokens: parsed.data.contextLimitTokens,
      })
      .single();

    if (error) return databaseErrorResponse(error);
    const row = data as DeclarationRow;

    return jsonNoStore({
      provider: row.declared_provider,
      model: row.declared_model,
      strengthTier: row.declared_strength_tier,
      contextLimitTokens: row.declared_context_limit_tokens,
      fullyDeclared: row.fully_declared,
      note: row.fully_declared
        ? "This model can now be routed to, subject to its declared capabilities."
        : "This model is still undeclared in part, so routing will continue to refuse it.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "model_declaration_failed", "The model declaration could not be saved.");
  }
}
