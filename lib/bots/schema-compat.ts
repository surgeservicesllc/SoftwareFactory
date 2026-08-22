/**
 * PostgREST/PostgreSQL feature detection for an app-first deployment window.
 *
 * These predicates are deliberately narrower than "the request failed". A
 * compatibility retry is allowed only when the exact column or RPC requested
 * by the new application is not present yet. Authorization, constraint,
 * concurrency, and malformed-catalog failures must keep their original error
 * and fail closed.
 */

export type DatabaseFeatureError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function errorText(error: DatabaseFeatureError): string {
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isMissingDatabaseFunction(
  error: unknown,
  functionName: string,
): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as DatabaseFeatureError;
  if (candidate.code === "PGRST202") {
    // PGRST202 is emitted by PostgREST only when the RPC requested at this
    // call site is absent from its schema cache.
    return true;
  }
  return candidate.code === "42883"
    && errorText(candidate).includes(functionName.toLowerCase());
}

export function isMissingDatabaseColumn(
  error: unknown,
  columnName: string,
): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as DatabaseFeatureError;
  if (candidate.code !== "42703" && candidate.code !== "PGRST204") return false;
  return errorText(candidate).includes(columnName.toLowerCase());
}
