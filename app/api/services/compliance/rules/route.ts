import { z } from "zod";

import {
  CRM_COMPLIANCE_RULE_COLUMNS,
  CRM_JURISDICTION_PATTERN,
  toComplianceRuleView,
  type CrmComplianceRuleRow,
} from "@/lib/services/crm";
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
 * Jurisdiction rules: this workspace's own record of what each place it
 * operates in requires. Nothing here privileges one state — a rule is a
 * row, written by the people who know their regulator, and the application
 * boundary holds records to whichever rule they name.
 */

const createSchema = z
  .object({
    jurisdiction: z
      .string()
      .trim()
      .regex(CRM_JURISDICTION_PATTERN, "A jurisdiction code, like US-OR or CA-ON."),
    label: z.string().trim().min(1).max(120),
    retentionYears: z.number().int().min(1).max(100),
    requiresApplicatorLicense: z.boolean().default(true),
    requiresTargetPest: z.boolean().default(false),
    requiresApplicationRate: z.boolean().default(false),
    requiresTreatedArea: z.boolean().default(false),
    notes: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_compliance_rules")
      .select(CRM_COMPLIANCE_RULE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("jurisdiction", { ascending: true })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({
      rules: ((data ?? []) as unknown as CrmComplianceRuleRow[]).map(toComplianceRuleView),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_rules_unavailable", message: "The jurisdiction rules could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_compliance_rules")
      .insert({
        organization_id: activeOrganization.id,
        jurisdiction: payload.jurisdiction,
        label: payload.label,
        retention_years: payload.retentionYears,
        requires_applicator_license: payload.requiresApplicatorLicense,
        requires_target_pest: payload.requiresTargetPest,
        requires_application_rate: payload.requiresApplicationRate,
        requires_treated_area: payload.requiresTreatedArea,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_COMPLIANCE_RULE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "jurisdiction_already_configured",
              message: "That jurisdiction already has a rule in this workspace.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { rule: toComplianceRuleView(data as unknown as CrmComplianceRuleRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_rule",
            message: error.issues[0]?.message ?? "The rule could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_rule_not_recorded", message: "The rule could not be recorded." } },
      { status: 500 },
    );
  }
}
