import { z } from "zod";

import {
  CRM_CODE_PATTERN,
  CRM_POSTAL_PATTERN,
  CRM_REGION_PATTERN,
  CRM_TERRITORY_COLUMNS,
  toTerritoryView,
  type CrmTerritoryRow,
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
 * Territories: the map the sales motion is measured on. A territory belongs
 * to a branch, is worked by a rep, and is defined by the postal codes it
 * covers — the same shape the schema CHECKs, so a code that would be
 * refused by the database is refused here by name instead.
 *
 * Codes are upper-cased and de-duplicated on the way in. A territory listed
 * twice for the same postal code is not two territories.
 */

const postalSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => CRM_POSTAL_PATTERN.test(value), {
    message: "A postal code: letters, digits, spaces and dashes, up to eleven characters.",
  });

const createSchema = z
  .object({
    branchId: z.string().uuid(),
    repId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().regex(CRM_CODE_PATTERN, "A short code: letters, digits and dashes."),
    city: z.string().trim().min(1).max(120).nullish(),
    region: z.string().trim().regex(CRM_REGION_PATTERN, "A two-letter region code.").nullish(),
    postalCodes: z.array(postalSchema).max(400).default([]),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    territoryId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    repId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    city: z.string().trim().min(1).max(120).nullable().optional(),
    region: z.string().trim().regex(CRM_REGION_PATTERN).nullable().optional(),
    postalCodes: z.array(postalSchema).max(400).optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

const unique = (codes: string[]) => Array.from(new Set(codes));

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_territories")
      .select(CRM_TERRITORY_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(500);
    if (error) return databaseErrorResponse(error);

    const territories = ((data ?? []) as unknown as CrmTerritoryRow[]).map(toTerritoryView);
    const accounts = await client
      .from("crm_accounts")
      .select("territory_id")
      .eq("organization_id", activeOrganization.id)
      .limit(5000);
    if (accounts.error) return databaseErrorResponse(accounts.error);

    const counts: Record<string, number> = {};
    for (const row of (accounts.data ?? []) as { territory_id: string | null }[]) {
      if (row.territory_id === null) continue;
      counts[row.territory_id] = (counts[row.territory_id] ?? 0) + 1;
    }

    return jsonNoStore({
      territories: territories.map((territory) => ({
        ...territory,
        accountCount: counts[territory.id] ?? 0,
      })),
      counts: {
        total: territories.length,
        active: territories.filter((territory) => territory.active).length,
        // A territory nobody works is a gap in coverage, not a detail.
        unworked: territories.filter((territory) => territory.active && territory.repId === null).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_territories_unavailable", message: "Territories could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_territories")
      .insert({
        organization_id: activeOrganization.id,
        branch_id: payload.branchId,
        rep_id: payload.repId ?? null,
        name: payload.name,
        code: payload.code,
        city: payload.city ?? null,
        region: payload.region ?? null,
        postal_codes: unique(payload.postalCodes),
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_TERRITORY_COLUMNS)
      .single();
    if (error) return territoryWriteError(error);
    return jsonNoStore({ territory: toTerritoryView(data as unknown as CrmTerritoryRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_territory", "crm_territory_not_recorded", "The territory could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.branchId !== undefined) changes.branch_id = payload.branchId;
    if (payload.repId !== undefined) changes.rep_id = payload.repId;
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.city !== undefined) changes.city = payload.city;
    if (payload.region !== undefined) changes.region = payload.region;
    if (payload.postalCodes !== undefined) changes.postal_codes = unique(payload.postalCodes);
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.active !== undefined) changes.active = payload.active;

    const { data, error } = await client
      .from("crm_territories")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.territoryId)
      .select(CRM_TERRITORY_COLUMNS)
      .maybeSingle();
    if (error) return territoryWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "territory_not_found", message: "No such territory in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ territory: toTerritoryView(data as unknown as CrmTerritoryRow) });
  } catch (error) {
    return failure(error, "invalid_territory_change", "crm_territory_not_updated", "The territory could not be updated.");
  }
}

function territoryWriteError(error: { code?: string }) {
  if (error.code === "23505") {
    return jsonNoStore(
      {
        error: {
          code: "territory_code_taken",
          message: "That territory code is already in use in this workspace.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return jsonNoStore(
      { error: { code: "reference_not_found", message: "That branch or rep is not in this workspace." } },
      { status: 404 },
    );
  }
  if (error.code === "23514") {
    return jsonNoStore(
      {
        error: {
          code: "territory_refused",
          message: "The territory was refused — check the postal codes and the region code.",
        },
      },
      { status: 409 },
    );
  }
  return databaseErrorResponse(error as Parameters<typeof databaseErrorResponse>[0]);
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
