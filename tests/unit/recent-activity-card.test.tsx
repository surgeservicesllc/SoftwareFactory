import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecentActivityCard } from "@/components/recent-activity-card";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("RecentActivityCard", () => {
  it("does not issue a protected request for a server-confirmed signed-out visitor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<RecentActivityCard authenticated={false} />);

    expect(await screen.findByText(/Sign in to see what has happened/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads bounded activity for an authenticated visitor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ events: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<RecentActivityCard authenticated />);

    expect(await screen.findByText(/Nothing yet/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/activity?limit=5", { cache: "no-store" });
  });
});
