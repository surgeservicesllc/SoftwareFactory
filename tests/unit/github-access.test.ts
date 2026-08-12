// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/tenant", () => ({
  requireActiveOrganization: vi.fn(),
}));

import {
  requireGitHubConnection,
  requireMatchingActiveOrganization,
} from "@/lib/github/access";

const activeOrganizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

type Filter = { column: string; table: string; value: unknown };

function createConnectionClient(connectionOrganizationId: string) {
  const filters: Filter[] = [];
  const client = {
    from(table: string) {
      const queryFilters = new Map<string, unknown>();
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, table, value });
          queryFilters.set(column, value);
          return builder;
        },
        async maybeSingle() {
          if (table === "connections") {
            const matches = queryFilters.get("id") === connectionId
              && queryFilters.get("provider") === "github"
              && queryFilters.get("organization_id") === connectionOrganizationId;
            return {
              data: matches
                ? {
                  id: connectionId,
                  organization_id: connectionOrganizationId,
                  provider: "github",
                  status: "connected",
                }
                : null,
              error: null,
            };
          }
          if (table === "organization_members") {
            return {
              data: queryFilters.get("organization_id") === connectionOrganizationId
                && queryFilters.get("user_id") === userId
                ? { role: "owner" }
                : null,
              error: null,
            };
          }
          if (table === "github_installations") {
            return {
              data: queryFilters.get("organization_id") === connectionOrganizationId
                && queryFilters.get("connection_id") === connectionId
                ? {
                  id: "55555555-5555-4555-8555-555555555555",
                  external_installation_id: 12345,
                  status: "active",
                }
                : null,
              error: null,
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, filters };
}

describe("GitHub active-organization authorization", () => {
  it("rejects an installation state for a different active organization", () => {
    expect(() => requireMatchingActiveOrganization(
      activeOrganizationId,
      otherOrganizationId,
    )).toThrow(expect.objectContaining({
      code: "active_organization_mismatch",
      status: 403,
    }));
  });

  it("fails closed before loading an installation from another organization", async () => {
    const { client, filters } = createConnectionClient(otherOrganizationId);

    await expect(requireGitHubConnection(
      client,
      userId,
      activeOrganizationId,
      connectionId,
    )).rejects.toMatchObject({
      code: "github_connection_not_found",
      status: 404,
    });

    expect(filters).toContainEqual({
      column: "organization_id",
      table: "connections",
      value: activeOrganizationId,
    });
    expect(filters.some((filter) => filter.table === "github_installations")).toBe(false);
  });

  it("returns a connection only when connection, membership, and installation share the active organization", async () => {
    const { client, filters } = createConnectionClient(activeOrganizationId);

    await expect(requireGitHubConnection(
      client,
      userId,
      activeOrganizationId,
      connectionId,
    )).resolves.toMatchObject({
      connectionId,
      installationId: 12345,
      organizationId: activeOrganizationId,
      role: "owner",
    });

    expect(filters.filter(
      (filter) => filter.column === "organization_id"
        && filter.value === activeOrganizationId,
    ).map((filter) => filter.table)).toEqual([
      "connections",
      "organization_members",
      "github_installations",
    ]);
  });
});
