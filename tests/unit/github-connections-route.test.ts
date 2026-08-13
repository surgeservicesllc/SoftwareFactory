// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const harness = vi.hoisted(() => ({
  errors: {} as Record<string, { code?: string; message?: string } | null>,
  queries: [] as Array<{
    column?: string;
    operation: "eq" | "from" | "in" | "order" | "select";
    table: string;
    value?: unknown;
  }>,
  requireUser: vi.fn(),
  rows: {} as Record<string, Row[]>,
}));

vi.mock("@/lib/github/access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/access")>();
  return {
    ...original,
    requireGitHubUser: harness.requireUser,
  };
});

import { GET } from "@/app/api/github/connections/route";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";
import { SupabaseTenantError } from "@/lib/supabase/tenant";

const activeOrganizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function queryFor(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let ordering: { ascending: boolean; column: string } | null = null;

  const query = {
    eq(column: string, value: unknown) {
      harness.queries.push({ column, operation: "eq", table, value });
      filters.push((row) => row[column] === value);
      return query;
    },
    in(column: string, values: unknown[]) {
      harness.queries.push({ column, operation: "in", table, value: values });
      filters.push((row) => values.includes(row[column]));
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      harness.queries.push({ column, operation: "order", table, value: options });
      ordering = { ascending: options.ascending, column };
      return query;
    },
    select(columns: string) {
      harness.queries.push({ operation: "select", table, value: columns });
      return query;
    },
    then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
      onFulfilled?: ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const error = harness.errors[table] ?? null;
      let rows = (harness.rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (ordering) {
        const direction = ordering.ascending ? 1 : -1;
        const column = ordering.column;
        rows = [...rows].sort((left, right) => String(left[column] ?? "")
          .localeCompare(String(right[column] ?? "")) * direction);
      }
      return Promise.resolve({ data: error ? null : rows, error }).then(onFulfilled, onRejected);
    },
  };

  return query;
}

const supabase = {
  from: vi.fn((table: string) => {
    harness.queries.push({ operation: "from", table });
    return queryFor(table);
  }),
};

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}

function connection(overrides: Row = {}): Row {
  return {
    created_at: "2026-08-12T20:00:00.000Z",
    error_message: "database-only diagnostic must not leave the server",
    external_account_label: "example-org",
    id: "connection-connected",
    last_verified_at: "2026-08-12T20:01:00.000Z",
    name: "GitHub · example-org",
    organization_id: activeOrganizationId,
    provider: "github",
    status: "connected",
    ...overrides,
  };
}

function installation(overrides: Row = {}): Row {
  return {
    account_avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    account_login: "example-org",
    account_type: "Organization",
    connection_id: "connection-connected",
    external_installation_id: 101,
    id: "installation-connected",
    installed_at: "2026-08-12T20:00:00.000Z",
    last_synced_at: "2026-08-12T20:01:00.000Z",
    organization_id: activeOrganizationId,
    permissions: { contents: "write", metadata: "read", pull_requests: "write" },
    repository_selection: "selected",
    status: "active",
    subscribed_events: ["installation", "installation_repositories"],
    suspended_at: null,
    target_type: "Organization",
    ...overrides,
  };
}

function repository(overrides: Row = {}): Row {
  return {
    archived: false,
    default_branch: "main",
    disabled: false,
    external_repository_id: 501,
    full_name: "example-org/application",
    github_updated_at: "2026-08-12T20:02:00.000Z",
    html_url: "https://github.com/example-org/application",
    id: "repository-connected",
    installation_id: "installation-connected",
    last_synced_at: "2026-08-12T20:03:00.000Z",
    organization_id: activeOrganizationId,
    private: true,
    pushed_at: "2026-08-12T20:02:30.000Z",
    selected: true,
    visibility: "private",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.errors = {};
  harness.queries = [];
  harness.rows = {
    connections: [connection()],
    github_installations: [installation()],
    github_repositories: [repository()],
  };
  harness.requireUser.mockResolvedValue({
    activeOrganization: {
      id: activeOrganizationId,
      name: "Active Organization",
      role: "viewer",
      slug: "active-organization",
    },
    supabase,
    user: { id: userId },
  });
});

describe("GitHub connections route", () => {
  it("preserves the authentication boundary and does not query tenant data", async () => {
    harness.requireUser.mockRejectedValueOnce(new SupabaseAuthenticationError(
      "authentication_required",
      "Authentication is required.",
    ));

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication is required.",
      },
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("preserves active-organization selection conflicts and does not query tenant data", async () => {
    harness.requireUser.mockRejectedValueOnce(new SupabaseTenantError(
      "organization_selection_required",
      "Select an active organization before accessing tenant data.",
      409,
    ));

    const response = await GET();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "organization_selection_required",
        message: "Select an active organization before accessing tenant data.",
      },
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("binds every database read to the exact active organization and related record ids", async () => {
    harness.rows.connections.push(connection({
      id: "other-tenant-connection",
      organization_id: otherOrganizationId,
    }));
    harness.rows.github_installations.push(installation({
      connection_id: "other-tenant-connection",
      id: "other-tenant-installation",
      organization_id: otherOrganizationId,
    }));
    harness.rows.github_repositories.push(repository({
      full_name: "other-org/private-repository",
      id: "other-tenant-repository",
      installation_id: "other-tenant-installation",
      organization_id: otherOrganizationId,
    }));

    const response = await GET();
    const body = await response.json() as { connections: Array<{ id: string; repositories: Row[] }> };

    expect(response.status).toBe(200);
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]?.id).toBe("connection-connected");
    expect(body.connections[0]?.repositories).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("other-tenant");
    expect(JSON.stringify(body)).not.toContain("other-org/private-repository");

    for (const table of ["connections", "github_installations", "github_repositories"]) {
      expect(harness.queries).toContainEqual({
        column: "organization_id",
        operation: "eq",
        table,
        value: activeOrganizationId,
      });
    }
    expect(harness.queries).toContainEqual({
      column: "connection_id",
      operation: "in",
      table: "github_installations",
      value: ["connection-connected"],
    });
    expect(harness.queries).toContainEqual({
      column: "installation_id",
      operation: "in",
      table: "github_repositories",
      value: ["installation-connected"],
    });
    expectNoStore(response);
  });

  it("returns a connected installation and only selected, active repositories", async () => {
    harness.rows.github_repositories.push(
      repository({
        external_repository_id: 502,
        full_name: "example-org/not-selected",
        id: "not-selected",
        selected: false,
      }),
      repository({
        archived: true,
        external_repository_id: 503,
        full_name: "example-org/archived",
        id: "archived",
      }),
      repository({
        disabled: true,
        external_repository_id: 504,
        full_name: "example-org/disabled",
        id: "disabled",
      }),
      repository({
        external_repository_id: 505,
        full_name: "example-org/wrong-installation",
        id: "wrong-installation",
        installation_id: "unrelated-installation",
      }),
    );

    const response = await GET();
    const body = await response.json() as { connections: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.connections).toEqual([
      expect.objectContaining({
        account: {
          avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
          login: "example-org",
          type: "Organization",
        },
        id: "connection-connected",
        installation: expect.objectContaining({ id: 101, suspendedAt: null }),
        repositories: [expect.objectContaining({
          fullName: "example-org/application",
          id: 501,
          selected: true,
        })],
        status: "connected",
        statusLabel: "Connected",
        statusReason: null,
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /example-org\/not-selected|example-org\/archived|example-org\/disabled|example-org\/wrong-installation/,
    );
    expect(JSON.stringify(body)).not.toContain("database-only diagnostic");
    expect(JSON.stringify(body)).not.toContain("error_message");
    expectNoStore(response);
  });

  it("maps disabled, suspended, and errored records to truthful safe states", async () => {
    harness.rows.connections = [
      connection({ id: "connection-disabled", status: "disabled" }),
      connection({ id: "connection-suspended" }),
      connection({ id: "connection-error", status: "error" }),
    ];
    harness.rows.github_installations = [
      installation({ connection_id: "connection-disabled", id: "installation-disabled" }),
      installation({
        connection_id: "connection-suspended",
        id: "installation-suspended",
        suspended_at: "2026-08-12T21:00:00.000Z",
      }),
      installation({ connection_id: "connection-error", id: "installation-error" }),
    ];
    harness.rows.github_repositories = [];

    const response = await GET();
    const body = await response.json() as {
      connections: Array<{ id: string; status: string; statusLabel: string; statusReason: string | null }>;
    };
    const byId = Object.fromEntries(body.connections.map((item) => [item.id, item]));

    expect(byId["connection-disabled"]).toMatchObject({
      status: "not_connected",
      statusLabel: "Not Connected",
      statusReason: "This connection was disconnected in SoftwareFactory.",
    });
    expect(byId["connection-suspended"]).toMatchObject({
      status: "error",
      statusLabel: "Error",
      statusReason: "The GitHub App installation is suspended.",
    });
    expect(byId["connection-error"]).toMatchObject({
      status: "error",
      statusLabel: "Error",
      statusReason: "GitHub access could not be verified. Reconnect or synchronize the installation.",
    });
    expect(JSON.stringify(body)).not.toContain("database-only diagnostic");
    expectNoStore(response);
  });

  it("maps and redacts database failures without weakening no-store", async () => {
    harness.errors.github_installations = {
      code: "XX000",
      message: "sensitive database topology and credentials",
    };

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "internal_error",
        message: "The GitHub request failed safely.",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/topology|credentials|XX000/);
    expectNoStore(response);
  });
});
