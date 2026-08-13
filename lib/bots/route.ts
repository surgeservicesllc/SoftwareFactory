import "server-only";

import { BotCredentialError } from "@/lib/bots/credentials";
import { BotFabricQueryError, canManageBotFabric } from "@/lib/bots/service";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Shared authorization and error plumbing for bot fabric routes.
 *
 * Mutating the fabric is an owner/administrator action. The database functions
 * repeat this check inside their own trusted boundary; this layer exists so the
 * browser gets a precise status instead of an opaque database error.
 */

export class BotFabricForbiddenError extends Error {
  readonly code = "bot_fabric_forbidden";
  readonly status = 403;

  constructor() {
    super("Organization owner or administrator access is required.");
    this.name = "BotFabricForbiddenError";
  }
}

export async function requireBotFabricManager() {
  const context = await requireActiveOrganization();
  if (!canManageBotFabric(context.activeOrganization.role)) {
    throw new BotFabricForbiddenError();
  }
  return context;
}

export function botFabricErrorResponse(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): Response {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof BotFabricForbiddenError) {
    return jsonNoStore({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof BotCredentialError) {
    return jsonNoStore({ error: { code: error.code, message: error.message } }, { status: 400 });
  }
  if (error instanceof BotFabricQueryError) {
    return databaseErrorResponse(error.databaseError);
  }

  const boundaryResponse = supabaseBoundaryErrorResponse(error);
  if (boundaryResponse) return boundaryResponse;

  return jsonNoStore(
    { error: { code: fallbackCode, message: fallbackMessage } },
    { status: 500 },
  );
}

/** Map the database's uniqueness and lookup errors onto browser-facing text. */
export function botMutationErrorResponse(error: { code?: string; message?: string }): Response {
  if (error.code === "23505") {
    return jsonNoStore(
      {
        error: {
          code: "bot_fabric_conflict",
          message: "That name or slug is already used in this organization.",
        },
      },
      { status: 409 },
    );
  }
  return databaseErrorResponse(error);
}
