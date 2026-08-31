import { z } from "zod";

import {
  CRM_PORTAL_ROLES,
  CRM_PORTAL_USER_COLUMNS,
  toPortalUserView,
  type CrmPortalUserRow,
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
 * The staff side of the customer portal: who has been invited, who ever
 * signed in, and who has been switched off.
 *
 * Inviting somebody here creates the LINK, not the login. The row carries
 * no `user_id` until a real Supabase auth user is attached, and the schema
 * refuses an "activated" row without one — so an invitation can never be
 * mistaken for an account somebody is actually using.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    email: z.string().trim().email().max(320),
    contactId: z.string().uuid().nullish(),
    role: z.enum(CRM_PORTAL_ROLES as unknown as [string, ...string[]]).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    portalUserId: z.string().uuid(),
    role: z.enum(CRM_PORTAL_ROLES as unknown as [string, ...string[]]).optional(),
    /** Switching this off closes the door on the next call, not at next sign-in. */
    active: z.boolean().optional(),
    contactId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [portalUsers, accounts] = await Promise.all([
      client
        .from("crm_portal_users")
        .select(CRM_PORTAL_USER_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("active", { ascending: false })
        .order("invited_at", { ascending: false })
        .limit(500),
      client
        .from("crm_accounts")
        .select("id, name")
        .eq("organization_id", activeOrganization.id)
        .limit(5000),
    ]);
    if (portalUsers.error) return databaseErrorResponse(portalUsers.error);
    if (accounts.error) return databaseErrorResponse(accounts.error);

    const accountRows = (accounts.data ?? []) as { id: string; name: string }[];
    const accountNames = new Map(accountRows.map((row) => [row.id, row.name]));

    const users = ((portalUsers.data ?? []) as unknown as CrmPortalUserRow[])
      .map(toPortalUserView)
      .map((user) => ({ ...user, accountName: accountNames.get(user.accountId) ?? null }));

    const invited = users.filter((user) => user.state === "invited").length;
    const active = users.filter((user) => user.state === "active").length;

    return jsonNoStore({
      portalUsers: users,
      counts: {
        total: users.length,
        active,
        invited,
        suspended: users.filter((user) => user.state === "suspended").length,
        /*
         * Invitations sent that nobody ever accepted, and the number of
         * accounts with no portal login at all. Both are the
         * uncomfortable denominators of a portal rollout, and neither is
         * visible from a count of who signed in.
         */
        neverSignedIn: users.filter((user) => user.lastSeenAt === null).length,
        accountsWithoutPortal:
          accountRows.length -
          new Set(users.filter((user) => user.active).map((user) => user.accountId)).size,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_portal_users_unavailable", message: "Portal logins could not be listed." } },
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
      .from("crm_portal_users")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        contact_id: payload.contactId ?? null,
        email: payload.email,
        role: payload.role ?? "viewer",
        created_by: user.id,
      })
      .select(CRM_PORTAL_USER_COLUMNS)
      .single();
    if (error) return portalUserWriteError(error);

    return jsonNoStore(
      { portalUser: toPortalUserView(data as unknown as CrmPortalUserRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_portal_user", "crm_portal_user_not_recorded", "The invitation could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.role !== undefined) changes.role = payload.role;
    if (payload.active !== undefined) changes.active = payload.active;
    if (payload.contactId !== undefined) changes.contact_id = payload.contactId;

    const { data, error } = await client
      .from("crm_portal_users")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.portalUserId)
      .select(CRM_PORTAL_USER_COLUMNS)
      .maybeSingle();
    if (error) return portalUserWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "portal_user_not_found", message: "No such portal login in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ portalUser: toPortalUserView(data as unknown as CrmPortalUserRow) });
  } catch (error) {
    return failure(error, "invalid_portal_user_change", "crm_portal_user_not_updated", "The portal login could not be updated.");
  }
}

function portalUserWriteError(error: { code?: string }) {
  if (error.code === "23505") {
    return jsonNoStore(
      {
        error: {
          code: "portal_user_exists",
          message: "That address already has a portal invitation on this account.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return jsonNoStore(
      {
        error: {
          code: "reference_not_found",
          message: "That account or contact is not in this workspace.",
        },
      },
      { status: 404 },
    );
  }
  if (error.code === "23514") {
    return jsonNoStore(
      {
        error: {
          code: "portal_user_refused",
          message: "The record was refused — an activated portal login must have a real sign-in behind it.",
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
    return jsonNoStore({ error: { code: invalidCode, message: error.issues[0]?.message ?? message } }, { status: 422 });
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
