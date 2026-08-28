import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: vi.fn(() => false) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser } })),
}));

import { readViewer, SIGNED_OUT } from "@/lib/auth/viewer";

describe("readViewer", () => {
  afterEach(() => {
    getUser.mockReset();
    vi.useRealTimers();
  });

  it("fails closed on a bounded deadline when Supabase never answers", async () => {
    vi.useFakeTimers();
    getUser.mockReturnValue(new Promise(() => undefined));

    const viewer = readViewer();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(viewer).resolves.toBe(SIGNED_OUT);
  });
});
