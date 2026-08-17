// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveDatabaseCredential } = await import("@/lib/connections/connection-credential");
const { connectionIdentityForNode } = await import("@/lib/graph/connection-bridge");

const projectId = "11111111-1111-4111-8111-111111111111";
const databaseA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const databaseB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const inference = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Row = Record<string, unknown>;

/** A thenable PostgREST-shaped builder resolving to fixed rows per table. */
function client(tables: Record<string, Row[]>) {
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      in: vi.fn(() => builder),
      then: (resolve: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  return { from } as unknown as Parameters<typeof resolveDatabaseCredential>[0] & {
    from: typeof from;
  };
}

function connection(id: string, capabilities: string[], secretReference: string): Row {
  return {
    active_leases: 0,
    capabilities,
    external_account_label: null,
    health: "connected",
    id,
    max_concurrency: null,
    provider: "supabase",
    secret_reference: secretReference,
    status: "connected",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDatabaseCredential", () => {
  it("resolves two projects to two different database credentials", async () => {
    // The multi-database structural proof for 2D goal 4: same process, two
    // routed Supabase connections, two different referenced secrets.
    vi.stubEnv("FACTORY_DB_A", "postgres://a.example/db");
    vi.stubEnv("FACTORY_DB_B", "postgres://b.example/db");

    const first = await resolveDatabaseCredential(
      client({
        agent_runs: [],
        connections: [connection(databaseA, ["database.read"], "env://FACTORY_DB_A")],
        project_connections: [
          { capability: "database.read", connection_id: databaseA, priority: 10 },
        ],
        provider_capacity_limits: [],
      }),
      projectId,
      "read",
    );
    const second = await resolveDatabaseCredential(
      client({
        agent_runs: [],
        connections: [connection(databaseB, ["database.read"], "env://FACTORY_DB_B")],
        project_connections: [
          { capability: "database.read", connection_id: databaseB, priority: 10 },
        ],
        provider_capacity_limits: [],
      }),
      projectId,
      "read",
    );

    expect(first).toMatchObject({
      connectionId: databaseA, outcome: "resolved", token: "postgres://a.example/db",
    });
    expect(second).toMatchObject({
      connectionId: databaseB, outcome: "resolved", token: "postgres://b.example/db",
    });
  });

  it("keeps read and migrate as separate authorizations", async () => {
    // A connection mapped and declared only for reads must not resolve for a
    // migration — schema changes are the higher privilege, and inferring it
    // from read access would be the router guessing.
    vi.stubEnv("FACTORY_DB_A", "postgres://a.example/db");
    const readOnly = client({
      agent_runs: [],
      connections: [connection(databaseA, ["database.read"], "env://FACTORY_DB_A")],
      project_connections: [
        { capability: "database.read", connection_id: databaseA, priority: 10 },
      ],
      provider_capacity_limits: [],
    });

    expect((await resolveDatabaseCredential(readOnly, projectId, "read")).outcome).toBe("resolved");
    const migrate = await resolveDatabaseCredential(readOnly, projectId, "migrate");
    expect(migrate.outcome).toBe("refused");
    expect((migrate as { reason: string }).reason).toMatch(/refused/);
  });
});

describe("connectionIdentityForNode", () => {
  const routable = {
    agent_runs: [],
    connections: [connection(inference, ["inference.advisory"], "env://UNUSED")],
    project_connections: [
      { capability: "inference.advisory", connection_id: inference, priority: 10 },
    ],
    provider_capacity_limits: [],
  };

  it("routes a MODEL node to the project's inference connection", async () => {
    const result = await connectionIdentityForNode(client(routable), projectId, {
      executor: "MODEL",
      nodeKey: "review-1",
    });
    expect(result.mode).toBe("routed");
    const routed = result as { result: { outcome: string; connectionId?: string } };
    expect(routed.result).toMatchObject({ connectionId: inference, outcome: "SELECTED" });
  });

  it("never consults the registry for a node that is not MODEL", async () => {
    for (const executor of ["DETERMINISTIC", "ANCHOR"] as const) {
      const mock = client(routable);
      const result = await connectionIdentityForNode(mock, projectId, {
        executor,
        nodeKey: "compute-1",
      });
      expect(result.mode).toBe("not_applicable");
      expect((result as { reason: string }).reason).toContain(executor);
      expect(mock.from).not.toHaveBeenCalled();
    }
  });

  it("reports a legacy project as legacy rather than inventing an identity", async () => {
    const result = await connectionIdentityForNode(
      client({
        agent_runs: [],
        connections: [],
        project_connections: [{ capability: null, connection_id: inference, priority: 100 }],
        provider_capacity_limits: [],
      }),
      projectId,
      { executor: "MODEL", nodeKey: "review-1" },
    );
    expect(result.mode).toBe("legacy");
  });
});
