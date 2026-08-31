import { z } from "zod";

import {
  CRM_STOCK_MOVEMENT_KINDS,
  toStockBalanceView,
  type CrmStockBalanceRow,
} from "@/lib/services/crm";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 * Where the material physically is (ADR-213).
 *
 * The read derives every balance from the movement ledger, so a truck's
 * stock is exactly what was put there minus what left. The write records
 * one movement through the database function that holds the lot while it
 * checks — the check and the insert have to be one thing, or two
 * technicians drawing the last of a lot both pass.
 *
 * The database's refusals are the useful part of this surface: "that
 * location holds 40.000 fl_oz of this lot; 50.000 cannot be taken from it"
 * tells a dispatcher what to do. Each is carried back with its own status.
 */


/**
 * Names for the places a balance sits in, read from the same book through
 * the same policies. The SQL returns identities; a surface that showed a
 * uuid where a technician expects "TRUCK-04" would be unusable.
 */
async function label(
  client: SupabaseClient,
  balances: ReturnType<typeof toStockBalanceView>[],
): Promise<
  | { ok: true; balances: (ReturnType<typeof toStockBalanceView> & {
      locationKind: "branch" | "equipment"; locationLabel: string;
    })[] }
  | { ok: false; error: { code?: string; message?: string } }
> {
  const branchIds = [...new Set(balances.map((row) => row.branchId).filter(Boolean))] as string[];
  const equipmentIds = [...new Set(balances.map((row) => row.equipmentId).filter(Boolean))] as string[];

  const names = new Map<string, string>();
  if (branchIds.length > 0) {
    const branches = await client.from("crm_branches").select("id, name").in("id", branchIds);
    if (branches.error) return { ok: false, error: branches.error };
    for (const row of (branches.data ?? []) as { id: string; name: string }[]) {
      names.set(row.id, row.name);
    }
  }
  if (equipmentIds.length > 0) {
    const equipment = await client
      .from("crm_equipment").select("id, asset_tag, name").in("id", equipmentIds);
    if (equipment.error) return { ok: false, error: equipment.error };
    for (const row of (equipment.data ?? []) as { id: string; asset_tag: string; name: string }[]) {
      names.set(row.id, `${row.asset_tag} · ${row.name}`);
    }
  }

  return {
    ok: true,
    balances: balances.map((balance) => ({
      ...balance,
      locationKind: balance.branchId === null ? ("equipment" as const) : ("branch" as const),
      locationLabel: names.get((balance.branchId ?? balance.equipmentId) as string) ?? "unknown",
    })),
  };
}

const lotSchema = z.object({ lotId: z.string().uuid().optional() }).strict();

const moveSchema = z
  .object({
    lotId: z.string().uuid(),
    kind: z.enum(CRM_STOCK_MOVEMENT_KINDS),
    quantity: z.number().positive().max(1_000_000),
    fromBranchId: z.string().uuid().nullish(),
    fromEquipmentId: z.string().uuid().nullish(),
    toBranchId: z.string().uuid().nullish(),
    toEquipmentId: z.string().uuid().nullish(),
    applicationId: z.string().uuid().nullish(),
    note: z.string().trim().min(1).max(300).nullish(),
  })
  .strict()
  .refine((body) => (body.fromBranchId ? 1 : 0) + (body.fromEquipmentId ? 1 : 0) <= 1, {
    message: "A movement comes from one place.",
  })
  .refine((body) => (body.toBranchId ? 1 : 0) + (body.toEquipmentId ? 1 : 0) <= 1, {
    message: "A movement goes to one place.",
  });

const REFUSALS: { pattern: RegExp; code: string; status: number }[] = [
  { pattern: /no such product lot/i, code: "lot_not_found", status: 404 },
  { pattern: /cannot be taken from it/i, code: "insufficient_stock", status: 409 },
  { pattern: /already drawn stock/i, code: "application_already_drawn", status: 409 },
  { pattern: /names the application it served/i, code: "consumption_needs_application", status: 422 },
  { pattern: /not recorded against this lot/i, code: "application_lot_mismatch", status: 409 },
  { pattern: /they must agree/i, code: "quantity_disagrees", status: 409 },
  { pattern: /moves a positive quantity/i, code: "invalid_quantity", status: 422 },
];

export async function GET(request: Request) {
  try {
    const parsed = lotSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_lot_id", message: "The lot id is not a UUID." } },
        { status: 400 },
      );
    }
    const { client } = await requireActiveOrganization();

    const balances = await client.rpc("crm_stock_on_hand", {
      p_lot: parsed.data.lotId ?? null,
    });
    if (balances.error) return databaseErrorResponse(balances.error);

    const rows = ((balances.data ?? []) as unknown as CrmStockBalanceRow[])
      .map(toStockBalanceView)
      // A place emptied to zero is not stock; it is a row the ledger still
      // remembers, and showing it as a holding would misreport the truck.
      .filter((balance) => balance.quantity !== 0);

    const labelled = await label(client, rows);
    if (!labelled.ok) return databaseErrorResponse(labelled.error);

    return jsonNoStore({
      balances: labelled.balances,
      counts: {
        locations: new Set(rows.map((row) => row.branchId ?? row.equipmentId)).size,
        lots: new Set(rows.map((row) => row.lotId)).size,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_stock_unavailable", message: "Stock could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = moveSchema.parse(await readBoundedJson(request, 8_000));
    const { client } = await requireActiveOrganization();

    const recorded = await client.rpc("crm_stock_record_movement", {
      p_lot: payload.lotId,
      p_kind: payload.kind,
      p_quantity: payload.quantity,
      p_from_branch: payload.fromBranchId ?? null,
      p_from_equipment: payload.fromEquipmentId ?? null,
      p_to_branch: payload.toBranchId ?? null,
      p_to_equipment: payload.toEquipmentId ?? null,
      p_application: payload.applicationId ?? null,
      p_note: payload.note ?? null,
    });
    if (recorded.error) {
      const message = recorded.error.message ?? "";
      const refusal = REFUSALS.find((candidate) => candidate.pattern.test(message));
      if (refusal) {
        return jsonNoStore({ error: { code: refusal.code, message } }, { status: refusal.status });
      }
      return databaseErrorResponse(recorded.error);
    }

    // Re-read rather than adjusting a number here: the balance is derived,
    // and a second arithmetic in this file is a second chance to disagree.
    const balances = await client.rpc("crm_stock_on_hand", { p_lot: payload.lotId });
    if (balances.error) return databaseErrorResponse(balances.error);

    const labelled = await label(
      client,
      ((balances.data ?? []) as unknown as CrmStockBalanceRow[])
        .map(toStockBalanceView)
        .filter((balance) => balance.quantity !== 0),
    );
    if (!labelled.ok) return databaseErrorResponse(labelled.error);

    return jsonNoStore(
      { movementId: recorded.data as string, balances: labelled.balances },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_movement",
            message: error.issues[0]?.message ?? "That movement could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_stock_not_recorded", message: "The movement could not be recorded." } },
      { status: 500 },
    );
  }
}
