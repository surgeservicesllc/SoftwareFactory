import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import {
  requireActiveOrganization,
  type OrganizationMembership,
} from "@/lib/supabase/tenant";

/**
 * Shared boundary for tenant-scoped route handlers.
 *
 * Every handler resolves the authenticated user and the exact active
 * organization before touching data, and every failure maps to the same
 * fail-closed responses. Keeping this in one place stops a new route from
 * quietly skipping a check that the rest of the surface enforces.
 */

export type TenantContext = {
  readonly activeOrganization: OrganizationMembership;
  readonly client: SupabaseClient;
  readonly user: User;
};

export function isOrganizationManager(membership: OrganizationMembership): boolean {
  return membership.role === "owner" || membership.role === "admin";
}

export async function withTenant(
  handler: (context: TenantContext) => Promise<Response>,
  failure: { code: string; message: string },
): Promise<Response> {
  try {
    const { activeOrganization, client, user } = await requireActiveOrganization();
    return await handler({ activeOrganization, client, user });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore({ error: failure }, { status: 500 });
  }
}

/**
 * The Supabase client is untyped in this project, so a select with embedded
 * relations widens to a union that includes its error shape. These helpers
 * narrow a result once, at the boundary, instead of casting at each field.
 */
export function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

export function row<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}

/** PostgREST returns an embedded relation as either an object or a one-item array. */
export function embedded<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

export function forbidden(message: string) {
  return jsonNoStore(
    { error: { code: "forbidden", message } },
    { status: 403 },
  );
}

export function invalidRequest(code: string, message: string, fields?: unknown) {
  return jsonNoStore(
    { error: fields === undefined ? { code, message } : { code, message, fields } },
    { status: 400 },
  );
}
