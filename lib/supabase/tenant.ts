import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const ACTIVE_ORGANIZATION_COOKIE = "softwarefactory-active-organization";

const organizationRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
});
const membershipRowSchema = z.object({
  organization_id: z.string().uuid(),
  role: organizationRoleSchema,
  organizations: z.union([organizationSchema, z.array(organizationSchema).length(1)]),
});

export type OrganizationMembership = {
  id: string;
  name: string;
  role: z.infer<typeof organizationRoleSchema>;
  slug: string;
};

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export class SupabaseTenantError extends Error {
  readonly code:
    | "membership_query_failed"
    | "membership_data_invalid"
    | "organization_onboarding_required"
    | "organization_selection_required"
    | "active_organization_forbidden";
  readonly status: 403 | 409 | 503;

  constructor(
    code: SupabaseTenantError["code"],
    message: string,
    status: SupabaseTenantError["status"],
  ) {
    super(message);
    this.name = "SupabaseTenantError";
    this.code = code;
    this.status = status;
  }
}

export function parseOrganizationMembershipRows(
  rows: unknown,
): OrganizationMembership[] {
  const parsed = z.array(membershipRowSchema).safeParse(rows);
  if (!parsed.success) {
    throw new SupabaseTenantError(
      "membership_data_invalid",
      "Organization membership data was invalid.",
      503,
    );
  }

  return parsed.data.map((row) => {
    const organization = Array.isArray(row.organizations)
      ? row.organizations[0]
      : row.organizations;

    return {
      id: organization.id,
      name: organization.name,
      role: row.role,
      slug: organization.slug,
    };
  });
}

export async function listOrganizationMemberships(
  client: ServerClient,
  userId: string,
): Promise<OrganizationMembership[]> {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id,role,organizations!inner(id,name,slug)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new SupabaseTenantError(
      "membership_query_failed",
      "Organization memberships could not be loaded.",
      503,
    );
  }

  return parseOrganizationMembershipRows(data ?? []);
}

export function chooseActiveOrganization(
  memberships: OrganizationMembership[],
  requestedOrganizationId: string | null | undefined,
): OrganizationMembership | null {
  if (requestedOrganizationId) {
    return (
      memberships.find((membership) => membership.id === requestedOrganizationId) ??
      null
    );
  }

  return memberships.length === 1 ? memberships[0] : null;
}

export async function readActiveOrganizationId(): Promise<string | null> {
  const value = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  return z.string().uuid().safeParse(value).success ? (value ?? null) : null;
}

export async function setActiveOrganizationId(organizationId: string) {
  if (!z.string().uuid().safeParse(organizationId).success) {
    throw new SupabaseTenantError(
      "active_organization_forbidden",
      "The active organization is invalid.",
      403,
    );
  }

  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearActiveOrganizationId() {
  (await cookies()).delete(ACTIVE_ORGANIZATION_COOKIE);
}

export async function requireActiveOrganization(client?: ServerClient) {
  const authenticated = await requireAuthenticatedUser(client);
  const memberships = await listOrganizationMemberships(
    authenticated.client,
    authenticated.user.id,
  );
  const requestedId = await readActiveOrganizationId();
  const activeOrganization = chooseActiveOrganization(memberships, requestedId);

  if (memberships.length === 0) {
    throw new SupabaseTenantError(
      "organization_onboarding_required",
      "Create an organization before accessing tenant data.",
      409,
    );
  }
  if (requestedId && !activeOrganization) {
    throw new SupabaseTenantError(
      "active_organization_forbidden",
      "The selected organization is no longer available to this user.",
      403,
    );
  }
  if (!activeOrganization) {
    throw new SupabaseTenantError(
      "organization_selection_required",
      "Select an active organization before accessing tenant data.",
      409,
    );
  }

  return {
    ...authenticated,
    activeOrganization,
    memberships,
  };
}
