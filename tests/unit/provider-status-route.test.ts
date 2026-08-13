// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  loadProviderStatus: vi.fn(),
  maybeSingle: vi.fn(),
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/providers/config", () => ({
  resolveProviderConfiguration: vi.fn((provider: string) => ({
    provider,
    defaultModel: provider === "anthropic" ? "claude-opus-5" : null,
  })),
}));
vi.mock("@/lib/providers/service", () => ({
  loadProviderStatus: harness.loadProviderStatus,
}));
vi.mock("@/lib/supabase/tenant", () => ({
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { GET } from "@/app/api/providers/route";

const organization = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Factory",
  role: "owner",
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.loadProviderStatus.mockResolvedValue([]);
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: organization,
    client: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: harness.maybeSingle }),
        }),
      }),
    },
  });
});

describe("provider status route consent boundary", () => {
  it("uses an explicit local disabled snapshot and never requests a live probe while OFF", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { ai_provider_execution_enabled: false },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(harness.loadProviderStatus).toHaveBeenCalledOnce();
    const health = harness.loadProviderStatus.mock.calls[0]?.[2];
    expect(health).toEqual([
      expect.objectContaining({ provider: "anthropic", state: "disabled", latencyMs: null }),
      expect.objectContaining({ provider: "openai", state: "disabled", latencyMs: null }),
    ]);
    expect(await response.json()).toMatchObject({ executionEnabled: false });
  });

  it("allows the live status path only after the owner switch is ON", async () => {
    harness.maybeSingle.mockResolvedValue({
      data: { ai_provider_execution_enabled: true },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(harness.loadProviderStatus).toHaveBeenCalledWith(
      expect.anything(),
      organization.id,
      undefined,
    );
  });

  it("does not enter provider status loading after an organization lookup failure", async () => {
    harness.maybeSingle.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(harness.loadProviderStatus).not.toHaveBeenCalled();
  });
});
