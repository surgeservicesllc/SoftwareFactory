import "server-only";

import { jsonNoStore } from "@/lib/server/http";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";

/**
 * The customer side of the CRM.
 *
 * A portal caller is signed in but is NOT a member of the organization
 * whose data they are reading, so none of the staff-side tenancy helpers
 * apply — `requireActiveOrganization` would refuse them, correctly, and
 * there is deliberately no portal equivalent that grants an organization.
 *
 * Instead every read here goes through the reviewed SECURITY DEFINER
 * functions in `20260830001800_customer_portal.sql`, which resolve the
 * caller to exactly one account and filter by it. This module adds no
 * authority of its own: it authenticates, calls a function, and returns
 * what the function returned. If the function returns nothing, the answer
 * is nothing.
 */

export type PortalIdentity = {
  organizationId: string;
  accountId: string;
  portalUserId: string;
  role: "viewer" | "payer";
};

type PortalMeRow = {
  organization_id: string;
  account_id: string;
  portal_user_id: string;
  role: "viewer" | "payer";
};

export class PortalAccessError extends Error {
  constructor() {
    super("No portal access.");
    this.name = "PortalAccessError";
  }
}

/**
 * Resolves the signed-in caller to their one account, or refuses.
 *
 * `crm_portal_me()` takes no argument, so this cannot be pointed at
 * somebody else's login even by a caller who controls every input.
 */
export async function requirePortalUser() {
  const { client, user } = await requireAuthenticatedUser();
  const { data, error } = await client.rpc("crm_portal_me");
  if (error) throw error;

  const rows = (data ?? []) as PortalMeRow[];
  const row = rows[0];
  if (!row) throw new PortalAccessError();

  return {
    client,
    user,
    identity: {
      organizationId: row.organization_id,
      accountId: row.account_id,
      portalUserId: row.portal_user_id,
      role: row.role,
    } satisfies PortalIdentity,
  };
}

/**
 * A portal route's single failure translation.
 *
 * "You are not a portal user" and "you are a portal user with nothing on
 * this account" must not be told apart from the outside, so the refusal is
 * one flat 403 with no detail in it.
 */
export function portalErrorResponse(error: unknown, code: string, message: string): Response {
  if (error instanceof PortalAccessError) {
    return jsonNoStore(
      {
        error: {
          code: "portal_access_required",
          message: "This page is for customers with a portal invitation.",
        },
      },
      { status: 403 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code, message } }, { status: 500 });
}
