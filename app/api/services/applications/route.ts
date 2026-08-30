import { z } from "zod";

import {
  CRM_APPLICATION_COLUMNS,
  CRM_APPLICATION_METHODS,
  CRM_MEASURE_UNITS,
  toApplicationView,
  type CrmApplicationRow,
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
 * The application log: what was applied, where, at what rate, by whom under
 * which license, from which lot. Append-only by grant — a correction is a
 * new record naming the one it supersedes, never an edit.
 *
 * The applicator's license is COPIED onto the record from the technician's
 * roster entry at the moment of recording. A license may be renewed or
 * corrected later; this record must still say what was true that day.
 *
 * When a jurisdiction is named, its configured rule decides which fields
 * are required — the workspace's own rows, never one state hardcoded here.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    productId: z.string().uuid(),
    technicianId: z.string().uuid(),
    lotId: z.string().uuid().nullish(),
    deviceId: z.string().uuid().nullish(),
    workOrderId: z.string().uuid().nullish(),
    method: z.enum(CRM_APPLICATION_METHODS),
    quantity: z.number().positive().max(1_000_000),
    unit: z.enum(CRM_MEASURE_UNITS),
    targetPest: z.string().trim().min(1).max(120).nullish(),
    applicationRate: z.string().trim().min(1).max(200).nullish(),
    treatedArea: z.string().trim().min(1).max(300).nullish(),
    locationNote: z.string().trim().min(1).max(300).nullish(),
    note: z.string().trim().min(1).max(1000).nullish(),
    appliedAt: z.string().datetime().optional(),
    supersedesId: z.string().uuid().nullish(),
    /** Which configured jurisdiction rule to hold this record to. */
    jurisdiction: z.string().trim().min(2).max(13).optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    propertyId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    technicianId: z.string().uuid().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      accountId: url.searchParams.get("accountId") ?? undefined,
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      productId: url.searchParams.get("productId") ?? undefined,
      technicianId: url.searchParams.get("technicianId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_applications_query", message: "The application query is invalid." } },
        { status: 400 },
      );
    }
    const { client, activeOrganization } = await requireActiveOrganization();

    let query = client
      .from("crm_applications")
      .select(CRM_APPLICATION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("applied_at", { ascending: false })
      .limit(500);
    if (parsed.data.accountId) query = query.eq("account_id", parsed.data.accountId);
    if (parsed.data.propertyId) query = query.eq("property_id", parsed.data.propertyId);
    if (parsed.data.productId) query = query.eq("product_id", parsed.data.productId);
    if (parsed.data.technicianId) query = query.eq("technician_id", parsed.data.technicianId);
    if (parsed.data.from) query = query.gte("applied_at", `${parsed.data.from}T00:00:00Z`);
    if (parsed.data.to) query = query.lte("applied_at", `${parsed.data.to}T23:59:59Z`);

    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({
      applications: ((data ?? []) as unknown as CrmApplicationRow[]).map(toApplicationView),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_applications_unavailable", message: "The application log could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    // The license as it stands right now, copied onto the record.
    const technician = await client
      .from("crm_technicians")
      .select("id, license_number, active")
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.technicianId)
      .maybeSingle();
    if (technician.error) return databaseErrorResponse(technician.error);
    if (!technician.data) {
      return jsonNoStore(
        { error: { code: "technician_not_found", message: "No such technician in this workspace." } },
        { status: 404 },
      );
    }
    const applicatorLicense = (technician.data as { license_number: string | null }).license_number;

    /*
     * Jurisdiction rules are the workspace's own rows. When one is named,
     * its required fields are checked before anything is written — an
     * incomplete legal record is refused, not quietly stored.
     */
    if (payload.jurisdiction) {
      const rule = await client
        .from("crm_compliance_rules")
        .select(
          "jurisdiction, label, requires_applicator_license, requires_target_pest, requires_application_rate, requires_treated_area, active",
        )
        .eq("organization_id", activeOrganization.id)
        .eq("jurisdiction", payload.jurisdiction)
        .maybeSingle();
      if (rule.error) return databaseErrorResponse(rule.error);
      if (!rule.data) {
        return jsonNoStore(
          {
            error: {
              code: "jurisdiction_not_configured",
              message: `No rule is configured for ${payload.jurisdiction} in this workspace.`,
            },
          },
          { status: 404 },
        );
      }
      const configured = rule.data as unknown as CrmComplianceRuleRow;
      const missing: string[] = [];
      if (configured.requires_applicator_license && !applicatorLicense) missing.push("applicator license");
      if (configured.requires_target_pest && !payload.targetPest) missing.push("target pest");
      if (configured.requires_application_rate && !payload.applicationRate) missing.push("application rate");
      if (configured.requires_treated_area && !payload.treatedArea) missing.push("treated area");
      if (missing.length > 0) {
        return jsonNoStore(
          {
            error: {
              code: "jurisdiction_requirements_unmet",
              message: `${configured.label} requires ${missing.join(", ")}.`,
            },
            missing,
          },
          { status: 422 },
        );
      }
    }

    const { data, error } = await client
      .from("crm_applications")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId,
        product_id: payload.productId,
        technician_id: payload.technicianId,
        lot_id: payload.lotId ?? null,
        device_id: payload.deviceId ?? null,
        work_order_id: payload.workOrderId ?? null,
        applicator_license: applicatorLicense,
        method: payload.method,
        quantity: payload.quantity,
        unit: payload.unit,
        target_pest: payload.targetPest ?? null,
        application_rate: payload.applicationRate ?? null,
        treated_area: payload.treatedArea ?? null,
        location_note: payload.locationNote ?? null,
        note: payload.note ?? null,
        ...(payload.appliedAt ? { applied_at: payload.appliedAt } : {}),
        supersedes_id: payload.supersedesId ?? null,
        created_by: user.id,
      })
      .select(CRM_APPLICATION_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message:
                "The account, property, product, lot, device or work order is not in this workspace — and the property must belong to the account.",
            },
          },
          { status: 404 },
        );
      }
      // The lot drawdown raises check_violation for a unit mismatch or an
      // over-draw; both are the caller's to correct, not a server fault.
      if (error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "lot_cannot_supply",
              message: error.message.includes("unit")
                ? "The application's unit does not match the lot's unit."
                : "The lot does not hold enough for this application.",
            },
          },
          { status: 422 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { application: toApplicationView(data as unknown as CrmApplicationRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_application",
            message: error.issues[0]?.message ?? "The application could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_application_not_recorded", message: "The application could not be recorded." } },
      { status: 500 },
    );
  }
}
