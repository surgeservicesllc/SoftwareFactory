// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createClientMock,
}));

import {
  authProviderFailureStatus,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth";

describe("Supabase verified session boundary", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("distinguishes provider outages and throttling from client auth failures", () => {
    expect(authProviderFailureStatus({ status: 400 }, 401)).toBe(401);
    expect(authProviderFailureStatus({ status: 429 }, 401)).toBe(429);
    expect(authProviderFailureStatus({ status: 503 }, 401)).toBe(503);
    expect(authProviderFailureStatus(null, 400)).toBe(503);
  });

  it("returns only a user verified through auth.getUser", async () => {
    const user = { id: "00000000-0000-4000-8000-000000000001" };
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      },
    };
    createClientMock.mockResolvedValue(client);

    await expect(requireAuthenticatedUser()).resolves.toEqual({ client, user });
    expect(client.auth.getUser).toHaveBeenCalledOnce();
  });

  it("fails with 401 for a missing or rejected session", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { status: 401 },
        }),
      },
    });

    await expect(requireAuthenticatedUser()).rejects.toMatchObject({
      code: "authentication_required",
      status: 401,
    });
  });

  it("fails with 503 rather than authorizing when verification is unavailable", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { status: 0 },
        }),
      },
    });

    await expect(requireAuthenticatedUser()).rejects.toMatchObject({
      code: "authentication_unavailable",
      status: 503,
    });
  });
});
