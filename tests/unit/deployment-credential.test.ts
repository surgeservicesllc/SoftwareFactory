// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveDeploymentCredential } = await import("@/lib/connections/deployment-credential");

const projectId = "11111111-1111-4111-8111-111111111111";
const teamA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const teamB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

/** A thenable PostgREST-shaped builder resolving to fixed rows per table. */
function client(tables: Record<string, Row[]>) {
  return {
    from: vi.fn((table: string) => {
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
    }),
  } as unknown as Parameters<typeof resolveDeploymentCredential>[0];
}

function vercelConnection(id: string, secretReference: string): Row {
  return {
    active_leases: 0,
    capabilities: ["deploy.preview", "deploy.production"],
    external_account_label: `team-${id.slice(0, 1)}`,
    health: "connected",
    id,
    max_concurrency: null,
    provider: "vercel",
    secret_reference: secretReference,
    status: "connected",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDeploymentCredential", () => {
  it("resolves two projects to two different accounts' tokens", async () => {
    // The multi-account structural proof for 2D goal 3: the same process, two
    // routed connections, two different credentials — no ambient token
    // involved anywhere.
    vi.stubEnv("VERCEL_TOKEN_TEAM_A", "token-team-a");
    vi.stubEnv("VERCEL_TOKEN_TEAM_B", "token-team-b");

    const clientA = client({
      agent_runs: [],
      connections: [vercelConnection(teamA, "env://VERCEL_TOKEN_TEAM_A")],
      project_connections: [
        { capability: "deploy.preview", connection_id: teamA, priority: 10 },
      ],
      provider_capacity_limits: [],
    });
    const clientB = client({
      agent_runs: [],
      connections: [vercelConnection(teamB, "env://VERCEL_TOKEN_TEAM_B")],
      project_connections: [
        { capability: "deploy.preview", connection_id: teamB, priority: 10 },
      ],
      provider_capacity_limits: [],
    });

    const first = await resolveDeploymentCredential(clientA, projectId, "preview");
    const second = await resolveDeploymentCredential(clientB, projectId, "preview");

    expect(first).toMatchObject({ connectionId: teamA, outcome: "resolved", token: "token-team-a" });
    expect(second).toMatchObject({ connectionId: teamB, outcome: "resolved", token: "token-team-b" });
  });

  it("reports a legacy project as legacy, never inventing a connection", async () => {
    const result = await resolveDeploymentCredential(
      client({
        agent_runs: [],
        connections: [],
        project_connections: [{ capability: null, connection_id: teamA, priority: 100 }],
        provider_capacity_limits: [],
      }),
      projectId,
      "preview",
    );
    expect(result.outcome).toBe("legacy");
  });

  it("passes the router's refusal through by name", async () => {
    // The mapping names a capability the connection does not declare.
    const connection = vercelConnection(teamA, "env://VERCEL_TOKEN_TEAM_A");
    connection.capabilities = ["deploy.preview"];
    const result = await resolveDeploymentCredential(
      client({
        agent_runs: [],
        connections: [connection],
        project_connections: [
          { capability: "deploy.production", connection_id: teamA, priority: 10 },
        ],
        provider_capacity_limits: [],
      }),
      projectId,
      "production",
    );
    expect(result.outcome).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/identity router refused/);
  });

  it("reports an unresolvable secret reference without leaking anything", async () => {
    const result = await resolveDeploymentCredential(
      client({
        agent_runs: [],
        connections: [vercelConnection(teamA, "vault://factory/vercel")],
        project_connections: [
          { capability: "deploy.preview", connection_id: teamA, priority: 10 },
        ],
        provider_capacity_limits: [],
      }),
      projectId,
      "preview",
    );
    expect(result.outcome).toBe("unavailable");
    expect(result).not.toHaveProperty("token");
    expect((result as { reason: string }).reason).toMatch(/client exists/);
  });
});
