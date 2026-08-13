import "server-only";

import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Shared boundary for the operations routes.
 *
 * Each route resolves the caller's exact active organization, reads or writes
 * only through the audited RPCs, and returns `no-store`. Concentrating the
 * failure envelope here keeps one route from leaking a database message that
 * another route redacts.
 */

export type OperationsContext = Awaited<ReturnType<typeof requireActiveOrganization>>;

export async function operationsContext(): Promise<OperationsContext> {
  return requireActiveOrganization();
}

export function operationsFailure(error: unknown, code: string, message: string): Response {
  const boundaryResponse = supabaseBoundaryErrorResponse(error);
  if (boundaryResponse) return boundaryResponse;
  return jsonNoStore({ error: { code, message } }, { status: 500 });
}

export function requireOwner(context: OperationsContext): Response | null {
  if (context.activeOrganization.role !== "owner") {
    return jsonNoStore(
      {
        error: {
          code: "owner_required",
          message: "Organization owner access is required for this control.",
        },
      },
      { status: 403 },
    );
  }
  return null;
}

export function requireManager(context: OperationsContext): Response | null {
  const role = context.activeOrganization.role;
  if (role !== "owner" && role !== "admin") {
    return jsonNoStore(
      {
        error: {
          code: "manager_required",
          message: "Organization owner or administrator access is required.",
        },
      },
      { status: 403 },
    );
  }
  return null;
}

export function invalidRequest(message: string): Response {
  return jsonNoStore({ error: { code: "invalid_request", message } }, { status: 400 });
}

/**
 * Every operations response repeats the execution truth. A surface that can
 * describe a rollback must never be ambiguous about whether one can happen.
 */
export const OPERATIONS_EXECUTION_ENVELOPE = Object.freeze({
  executionAllowed: false,
  deploymentExecutor: "not_connected",
  rollbackExecutor: "not_connected",
  repairWorker: "not_connected",
});
