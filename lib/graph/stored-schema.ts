import { z } from "zod";

/**
 * The JSON-Schema representation persisted beside a graph node.
 *
 * Zod remains the in-process contract language. JSON Schema is the durable,
 * provider-neutral representation that survives the trip through Postgres and
 * can be reconstructed by a worker running in another process.
 */
export type StoredJsonSchema = Readonly<Record<string, unknown>>;

export type StoredSchemaResult =
  | { readonly ok: true; readonly schema: z.ZodType }
  | { readonly ok: false; readonly detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serialize a Zod contract without inventing a second hand-written schema.
 */
export function storeZodSchema(schema: z.ZodType): StoredJsonSchema {
  const stored = z.toJSONSchema(schema);
  if (!isRecord(stored)) {
    throw new Error("Zod produced a non-object JSON Schema.");
  }
  return stored;
}

/**
 * Does a stored schema constrain a value, rather than merely describe it?
 *
 * `{}` is valid JSON Schema, but accepts everything. It is useful for an
 * intentionally unknown root input and is unsafe for either a node output or
 * a non-root input: accepting it there would recreate the exact production
 * bypass this module closes.
 */
function hasValidationKeyword(schema: StoredJsonSchema): boolean {
  return [
    "$ref",
    "type",
    "const",
    "enum",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "if",
  ].some((keyword) => Object.hasOwn(schema, keyword));
}

/**
 * Rehydrate a stored JSON Schema. Invalid or unconstrained required contracts
 * are returned as explicit failures; callers must never widen them to
 * `z.unknown()` as a fallback.
 */
export function rehydrateStoredSchema(
  value: unknown,
  label: string,
  options: { readonly requireConstraint?: boolean } = {},
): StoredSchemaResult {
  if (!isRecord(value)) {
    return { ok: false, detail: `${label} is missing or is not a JSON Schema object.` };
  }
  if (options.requireConstraint === true && !hasValidationKeyword(value)) {
    return {
      ok: false,
      detail: `${label} is unconstrained; refusing to execute without a real contract.`,
    };
  }

  try {
    return {
      ok: true,
      schema: z.fromJSONSchema(
        value as Parameters<typeof z.fromJSONSchema>[0],
      ),
    };
  } catch (error) {
    return {
      ok: false,
      detail: `${label} is not a supported JSON Schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
