import { z } from "zod";

import { CRM_SCORING_MODELS, SCORING_DEFAULTS } from "@/lib/services/scoring";
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

/**
 * A workspace's overrides. PUT sets one (points and whether the rule is
 * on); DELETE removes it, which IS resetting to the default — there is no
 * "restore default" that writes the default down as if it were a choice.
 */

const putSchema = z
  .object({
    model: z.enum(CRM_SCORING_MODELS),
    ruleKey: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/, "Not a rule key."),
    points: z.number().int().min(-100).max(100),
    active: z.boolean().default(true),
    note: z.string().trim().min(1).max(300).nullish(),
  })
  .strict();

const deleteSchema = z
  .object({
    model: z.enum(CRM_SCORING_MODELS),
    ruleKey: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/, "Not a rule key."),
  })
  .strict();

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = putSchema.parse(await readBoundedJson(request, 8_000));
    const known = SCORING_DEFAULTS.some((rule) => rule.model === payload.model && rule.ruleKey === payload.ruleKey);
    if (!known) {
      return jsonNoStore(
        { error: { code: "unknown_rule", message: `No rule ${payload.ruleKey} in the ${payload.model} model.` } },
        { status: 404 },
      );
    }
    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_scoring_rules")
      .upsert(
        {
          organization_id: activeOrganization.id,
          model: payload.model,
          rule_key: payload.ruleKey,
          points: payload.points,
          active: payload.active,
          note: payload.note ?? null,
          created_by: user.id,
        },
        { onConflict: "organization_id,model,rule_key" },
      )
      .select("model, rule_key, points, active")
      .single();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({
      rule: { model: data.model, ruleKey: data.rule_key, points: data.points, active: data.active },
    });
  } catch (error) {
    return failure(error, "invalid_rule", "crm_scoring_rule_not_saved", "The rule could not be saved.");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = deleteSchema.parse(await readBoundedJson(request, 8_000));
    const { client, activeOrganization } = await requireActiveOrganization();
    const { error } = await client
      .from("crm_scoring_rules")
      .delete()
      .eq("organization_id", activeOrganization.id)
      .eq("model", payload.model)
      .eq("rule_key", payload.ruleKey);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ reset: { model: payload.model, ruleKey: payload.ruleKey } });
  } catch (error) {
    return failure(error, "invalid_rule", "crm_scoring_rule_not_reset", "The rule could not be reset.");
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
