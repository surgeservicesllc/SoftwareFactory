import "server-only";

import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

const entityIdSchema = z.string().uuid();
const MAX_DETAIL_DEPTH = 16;
const MAX_DETAIL_ARRAY_ITEMS = 200;
const MAX_DETAIL_OBJECT_KEYS = 100;
const MAX_DETAIL_STRING_LENGTH = 20_000;
const MAX_DETAIL_JSON_BYTES = 256 * 1024;

type TenantRpcDetailConfig<Row, Detail> = {
  id: string;
  idParameter: string;
  itemKey: string;
  rpc: string;
  unavailableCode: string;
  unavailableMessage: string;
  shape: (row: Row) => Detail;
};

function browserKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Convert and defensively bound the database's safe projection. */
export function safeDetailProjection(value: unknown, depth = 0): unknown {
  if (depth > MAX_DETAIL_DEPTH) throw new Error("Detail projection is too deeply nested.");
  if (typeof value === "string") {
    if (value.length > MAX_DETAIL_STRING_LENGTH) throw new Error("Detail projection contains an oversized string.");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_DETAIL_ARRAY_ITEMS) throw new Error("Detail projection contains too many records.");
    return value.map((entry) => safeDetailProjection(entry, depth + 1));
  }
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  if (Object.keys(source).length > MAX_DETAIL_OBJECT_KEYS) {
    throw new Error("Detail projection contains too many fields.");
  }
  if (Object.keys(source).length === 1 && source.detail && typeof source.detail === "object") {
    return safeDetailProjection(source.detail, depth + 1);
  }

  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !["__proto__", "constructor", "prototype"].includes(key))
      .map(([key, entry]) => [browserKey(key), safeDetailProjection(entry, depth + 1)]),
  );
}

/**
 * Reads one entity through a caller-bound safe-projection RPC. The helper never
 * falls back to a base-table read: a missing RPC or denied membership fails
 * closed at the database boundary.
 */
export async function tenantRpcDetailResponse<Row, Detail>({
  id,
  idParameter,
  itemKey,
  rpc,
  unavailableCode,
  unavailableMessage,
  shape,
}: TenantRpcDetailConfig<Row, Detail>): Promise<Response> {
  const parsedId = entityIdSchema.safeParse(id);
  if (!parsedId.success) {
    return jsonNoStore(
      { error: { code: "invalid_entity_id", message: "The requested identifier is invalid." } },
      { status: 400 },
    );
  }

  try {
    const context = await requireActiveOrganization();
    const { data, error } = await context.client.rpc(rpc, {
      p_organization_id: context.activeOrganization.id,
      [idParameter]: parsedId.data,
    });
    if (error) return databaseErrorResponse(error);

    const value = Array.isArray(data) ? data[0] : data;
    if (!value || typeof value !== "object") {
      return jsonNoStore(
        { error: { code: "not_found", message: "The requested record was not found." } },
        { status: 404 },
      );
    }

    const detail = shape(value as Row);
    if (new TextEncoder().encode(JSON.stringify(detail)).byteLength > MAX_DETAIL_JSON_BYTES) {
      return jsonNoStore(
        { error: { code: "detail_too_large", message: "The requested detail exceeds the safe response limit." } },
        { status: 413 },
      );
    }

    return jsonNoStore({
      activeOrganizationId: context.activeOrganization.id,
      [itemKey]: detail,
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: unavailableCode, message: unavailableMessage } },
      { status: 500 },
    );
  }
}
