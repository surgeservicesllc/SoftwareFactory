import { z } from "zod";

import {
  CRM_APPLICATION_COLUMNS,
  toApplicationView,
  type CrmApplicationRow,
} from "@/lib/services/crm";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The audit-ready service report: every application in a window, resolved
 * into the names an inspector reads — customer, site, product with its EPA
 * number, technician with the license they held that day, device, quantity,
 * rate, area, pest.
 *
 * Two shapes from one query, so the CSV a workspace hands a regulator and
 * the table it reviewed on screen are the same rows: `format=csv` streams
 * the file, anything else returns JSON.
 */

const querySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    propertyId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    technicianId: z.string().uuid().optional(),
    targetPest: z.string().trim().min(1).max(120).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

const CSV_HEADERS = [
  "applied_at",
  "customer",
  "site",
  "address",
  "product",
  "epa_registration_number",
  "lot_number",
  "device",
  "device_barcode",
  "technician",
  "applicator_license",
  "method",
  "target_pest",
  "quantity",
  "unit",
  "application_rate",
  "treated_area",
  "location",
  "note",
  "supersedes",
] as const;

/**
 * RFC 4180 quoting, plus the spreadsheet-injection guard: a cell beginning
 * =, +, - or @ is prefixed with a single quote so a regulator opening the
 * export in Excel reads text, never a formula.
 */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      accountId: url.searchParams.get("accountId") ?? undefined,
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      productId: url.searchParams.get("productId") ?? undefined,
      technicianId: url.searchParams.get("technicianId") ?? undefined,
      targetPest: url.searchParams.get("targetPest") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      format: url.searchParams.get("format") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_report_query", message: "The report query is invalid." } },
        { status: 400 },
      );
    }
    const { client, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    let query = client
      .from("crm_applications")
      .select(CRM_APPLICATION_COLUMNS)
      .eq("organization_id", organizationId)
      .order("applied_at", { ascending: false })
      .limit(5000);
    if (parsed.data.accountId) query = query.eq("account_id", parsed.data.accountId);
    if (parsed.data.propertyId) query = query.eq("property_id", parsed.data.propertyId);
    if (parsed.data.productId) query = query.eq("product_id", parsed.data.productId);
    if (parsed.data.technicianId) query = query.eq("technician_id", parsed.data.technicianId);
    if (parsed.data.targetPest) query = query.eq("target_pest", parsed.data.targetPest);
    if (parsed.data.from) query = query.gte("applied_at", `${parsed.data.from}T00:00:00Z`);
    if (parsed.data.to) query = query.lte("applied_at", `${parsed.data.to}T23:59:59Z`);

    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);
    const applications = ((data ?? []) as unknown as CrmApplicationRow[]).map(toApplicationView);

    // The names an inspector reads, resolved org-scoped under RLS.
    const [accounts, properties, products, lots, technicians, devices] = await Promise.all([
      client.from("crm_accounts").select("id, name").eq("organization_id", organizationId).limit(1000),
      client.from("crm_properties").select("id, label, address").eq("organization_id", organizationId).limit(1000),
      client
        .from("crm_products")
        .select("id, name, epa_registration_number")
        .eq("organization_id", organizationId)
        .limit(1000),
      client.from("crm_product_lots").select("id, lot_number").eq("organization_id", organizationId).limit(1000),
      client
        .from("crm_technicians")
        .select("id, first_name, last_name")
        .eq("organization_id", organizationId)
        .limit(1000),
      client.from("crm_devices").select("id, label, barcode").eq("organization_id", organizationId).limit(1000),
    ]);
    for (const result of [accounts, properties, products, lots, technicians, devices]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    const accountName = new Map(
      ((accounts.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
    );
    const property = new Map(
      ((properties.data ?? []) as { id: string; label: string; address: string }[]).map((row) => [row.id, row]),
    );
    const product = new Map(
      ((products.data ?? []) as { id: string; name: string; epa_registration_number: string | null }[]).map(
        (row) => [row.id, row],
      ),
    );
    const lotNumber = new Map(
      ((lots.data ?? []) as { id: string; lot_number: string }[]).map((row) => [row.id, row.lot_number]),
    );
    const technicianName = new Map(
      ((technicians.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((row) => [
        row.id,
        `${row.first_name} ${row.last_name}`,
      ]),
    );
    const device = new Map(
      ((devices.data ?? []) as { id: string; label: string; barcode: string }[]).map((row) => [row.id, row]),
    );

    const rows = applications.map((application) => ({
      applied_at: application.appliedAt,
      customer: accountName.get(application.accountId) ?? null,
      site: property.get(application.propertyId)?.label ?? null,
      address: property.get(application.propertyId)?.address ?? null,
      product: product.get(application.productId)?.name ?? null,
      epa_registration_number: product.get(application.productId)?.epa_registration_number ?? null,
      lot_number: application.lotId === null ? null : lotNumber.get(application.lotId) ?? null,
      device: application.deviceId === null ? null : device.get(application.deviceId)?.label ?? null,
      device_barcode: application.deviceId === null ? null : device.get(application.deviceId)?.barcode ?? null,
      technician: technicianName.get(application.technicianId) ?? null,
      applicator_license: application.applicatorLicense,
      method: application.method,
      target_pest: application.targetPest,
      quantity: application.quantity,
      unit: application.unit,
      application_rate: application.applicationRate,
      treated_area: application.treatedArea,
      location: application.locationNote,
      note: application.note,
      supersedes: application.supersedesId,
    }));

    if (parsed.data.format === "csv") {
      const csv = [
        CSV_HEADERS.join(","),
        ...rows.map((row) => CSV_HEADERS.map((header) => csvCell(row[header])).join(",")),
      ].join("\r\n");
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="service-report-${stamp}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    return jsonNoStore({
      rows,
      count: rows.length,
      // Admitted, not silently cut: a wider window is the reader's move.
      truncated: applications.length >= 5000,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_report_unavailable", message: "The service report could not be built." } },
      { status: 500 },
    );
  }
}
