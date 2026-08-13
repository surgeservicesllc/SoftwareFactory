// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { GET, activityEvidenceFromMetadata } from "@/app/api/activity/route";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";

const activeOrganizationId = "10000000-0000-4000-8000-000000000001";

function request(query = "") {
  return new Request(`https://factory.example/api/activity${query}`);
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.rpc.mockResolvedValue({ data: [], error: null });
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: activeOrganizationId },
    client: { rpc: harness.rpc },
  });
});

describe("activity metadata redaction", () => {
  it("returns only bounded allowlisted evidence", () => {
    const evidence = activityEvidenceFromMetadata({
      action: "opened",
      conclusion: "success",
      delivery_id: "delivery-123",
      external_resource_id: 98765,
      github_actor: { avatar_url: "https://tracking.example/pixel", login: "safe-actor", token: "secret" },
      payload: { authorization: "Bearer secret", nested: { prompt: "private" } },
      repository: "example/application",
      resource_number: 42,
      resource_type: "pull_request",
      source: "github",
      state_transition: "applied",
      status: "completed",
      token: "must-not-leave",
    });

    expect(evidence).toEqual({
      action: "opened",
      actorLogin: "safe-actor",
      conclusion: "success",
      resources: [
        { id: "example/application", type: "repository" },
        { id: "delivery-123", type: "delivery" },
        { id: "98765", type: "pull_request" },
        { id: "42", type: "pull_request number" },
      ],
      source: "github",
      stateTransition: "applied",
      status: "completed",
    });
    expect(JSON.stringify(evidence)).not.toMatch(/secret|authorization|avatar|payload|token|prompt/i);
  });

  it("rejects nested, oversized, control-character, and invalid actor values", () => {
    expect(activityEvidenceFromMetadata({
      action: { nested: "value" },
      github_actor: { login: "not a valid github login" },
      repository: "x".repeat(161),
      state_transition: "line\nbreak",
      status: ["completed"],
    })).toEqual({
      action: null,
      actorLogin: null,
      conclusion: null,
      resources: [],
      source: "softwarefactory",
      stateTransition: null,
      status: null,
    });
  });

  it("derives a bounded internal state transition without exposing the rest of metadata", () => {
    expect(activityEvidenceFromMetadata({
      from: "off",
      ignored: "do not return this",
      operation: "update",
      provider: "github",
      to: "on",
    })).toMatchObject({
      action: "update",
      source: "github",
      stateTransition: "off -> on",
    });
  });
});

describe("GET /api/activity", () => {
  it("reads only the bounded activity RPC for the exact active organization", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: [
        {
          actor_display_name: "Factory Owner",
          actor_user_id: "00000000-0000-4000-8000-000000000101",
          description: "GitHub pull request changed",
          entity_id: "30000000-0000-4000-8000-000000000001",
          entity_type: "github_webhook_delivery",
          event_type: "project.updated",
          evidence: {
            action: "opened",
            arbitrary_blob: "must-not-leave",
            conclusion: "success",
            delivery_id: "delivery-123",
            github_actor: { avatar_url: "https://tracking.example/pixel", login: "safe-actor" },
            payload: { private_context: "must-not-leave" },
            repository: "example/application",
            resource_number: 42,
            resource_type: "pull_request",
            source: "github",
            state_transition: "processed",
            status: "open",
          },
          id: "40000000-0000-4000-8000-000000000001",
          occurred_at: "2026-08-13T12:00:00.000Z",
          project_id: "20000000-0000-4000-8000-000000000001",
          project_name: "SoftwareFactory",
        },
        {
          actor_display_name: null,
          actor_user_id: null,
          description: "GitHub check status changed",
          entity_id: null,
          entity_type: "github_webhook_delivery",
          event_type: "project.updated",
          evidence: {
            github_actor: { login: "provider-actor" },
            source: "github",
            status: "completed",
          },
          id: "40000000-0000-4000-8000-000000000002",
          occurred_at: "2026-08-13T11:59:00.000Z",
          project_id: null,
          project_name: null,
        },
      ],
      error: null,
    });

    const response = await GET(request("?limit=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.rpc).toHaveBeenCalledWith("list_activity", {
      p_limit: 25,
      p_organization_id: activeOrganizationId,
    });
    expect(body).toEqual({
      activeOrganizationId,
      events: [
        {
          actor: {
            displayName: "Factory Owner",
            id: "00000000-0000-4000-8000-000000000101",
            source: "softwarefactory",
          },
          description: "GitHub pull request changed",
          entity: {
            id: "30000000-0000-4000-8000-000000000001",
            type: "github_webhook_delivery",
          },
          eventType: "project.updated",
          evidence: {
            action: "opened",
            conclusion: "success",
            resources: [
              { id: "example/application", type: "repository" },
              { id: "delivery-123", type: "delivery" },
              { id: "42", type: "pull_request number" },
            ],
            source: "github",
            stateTransition: "processed",
            status: "open",
          },
          id: "40000000-0000-4000-8000-000000000001",
          occurredAt: "2026-08-13T12:00:00.000Z",
          project: { id: "20000000-0000-4000-8000-000000000001", name: "SoftwareFactory" },
        },
        {
          actor: { displayName: "@provider-actor", id: null, source: "github" },
          description: "GitHub check status changed",
          entity: { id: null, type: "github_webhook_delivery" },
          eventType: "project.updated",
          evidence: {
            action: null,
            conclusion: null,
            resources: [],
            source: "github",
            stateTransition: null,
            status: "completed",
          },
          id: "40000000-0000-4000-8000-000000000002",
          occurredAt: "2026-08-13T11:59:00.000Z",
          project: null,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(
      /arbitrary_blob|must-not-leave|avatar_url|private_context|tracking\.example|payload/,
    );
    expectNoStore(response);
  });

  it.each(["?limit=0", "?limit=101", "?limit=not-a-number"])(
    "rejects invalid query %s before resolving tenant state",
    async (query) => {
      const response = await GET(request(query));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "invalid_activity_query",
          message: "The activity query is invalid.",
        },
      });
      expect(harness.requireActiveOrganization).not.toHaveBeenCalled();
      expect(harness.rpc).not.toHaveBeenCalled();
      expectNoStore(response);
    },
  );

  it("preserves the authentication boundary without querying activity", async () => {
    harness.requireActiveOrganization.mockRejectedValueOnce(new SupabaseAuthenticationError(
      "authentication_required",
      "Authentication is required.",
    ));

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication is required.",
      },
    });
    expect(harness.rpc).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("returns an empty bounded list", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activeOrganizationId,
      events: [],
    });
    expect(harness.rpc).toHaveBeenCalledWith("list_activity", {
      p_limit: 50,
      p_organization_id: activeOrganizationId,
    });
    expectNoStore(response);
  });

  it("redacts database failures and preserves no-store", async () => {
    harness.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "private database topology" },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "database_error",
        message: "The control-plane database request failed.",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/topology|XX000/);
    expectNoStore(response);
  });
});
