// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import {
  chooseActiveOrganization,
  parseOrganizationMembershipRows,
  SupabaseTenantError,
  type OrganizationMembership,
} from "@/lib/supabase/tenant";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";

const memberships: OrganizationMembership[] = [
  { id: firstId, name: "Factory One", role: "owner", slug: "factory-one" },
  { id: secondId, name: "Factory Two", role: "viewer", slug: "factory-two" },
];

describe("Supabase tenant selection", () => {
  it("maps only the allowlisted membership DTO fields", () => {
    expect(
      parseOrganizationMembershipRows([
        {
          organization_id: firstId,
          role: "owner",
          organizations: {
            id: firstId,
            name: "Factory One",
            slug: "factory-one",
            ignored_private_field: "never returned",
          },
        },
      ]),
    ).toEqual([memberships[0]]);
  });

  it("fails closed on malformed database membership data", () => {
    expect(() =>
      parseOrganizationMembershipRows([
        {
          organization_id: firstId,
          role: "super-admin",
          organizations: { id: firstId, name: "Unsafe", slug: "unsafe" },
        },
      ]),
    ).toThrow(SupabaseTenantError);
  });

  it("revalidates requested organization ids against memberships", () => {
    expect(chooseActiveOrganization(memberships, secondId)).toEqual(
      memberships[1],
    );
    expect(
      chooseActiveOrganization(
        memberships,
        "00000000-0000-4000-8000-000000000003",
      ),
    ).toBeNull();
  });

  it("auto-selects only when membership is unambiguous", () => {
    expect(chooseActiveOrganization([memberships[0]], null)).toEqual(
      memberships[0],
    );
    expect(chooseActiveOrganization(memberships, null)).toBeNull();
    expect(chooseActiveOrganization([], null)).toBeNull();
  });
});
