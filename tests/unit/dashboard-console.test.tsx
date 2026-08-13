import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardConsole } from "@/components/dashboard-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const dashboardPayload = {
  windowDays: 30,
  portfolio: { total: 3, connected: 2, healthy: 2, degraded: 1, disconnected: 1 },
  workforce: { available: 11, active: 1, queuedRuns: 2, failedRuns: 1 },
  engineering: {
    tasksInProgress: 2,
    tasksCompleted: 8,
    pullRequestsCreated: 4,
    pullRequestsMerged: 1,
    pullRequestsWaiting: 3,
    ciFailures: 1,
    testsPassed: 208,
    issuesDiscovered: 5,
    securityFindings: 2,
  },
  production: {
    availability: "unavailable",
    deployments: 0,
    deploymentFailures: 0,
    rollbacks: 0,
    openIncidents: 0,
  },
  ownerAttention: [
    {
      kind: "run_failed",
      title: "1 failed run",
      detail: "Review the failure evidence before resubmitting the work.",
      href: "/runs?status=failed",
      severity: "danger",
    },
  ],
  executionEnabled: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

describe("DashboardConsole", () => {
  it("does not present live counts to a signed-out visitor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "unauthorized" } }, 401)),
    );

    render(<DashboardConsole />);

    expect(await screen.findByText("Sign in to view the dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Connected projects")).not.toBeInTheDocument();
  });

  it("does not issue a request when Supabase is unconfigured in the browser", async () => {
    vi.unstubAllEnvs();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardConsole />);

    expect(await screen.findByText("Sign in to view the dashboard")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("directs an organization-setup response to onboarding rather than showing zeroes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "organization_selection_required" } }, 409)),
    );

    render(<DashboardConsole />);

    expect(await screen.findByText("Select an organization")).toBeInTheDocument();
    expect(screen.queryByText("Connected projects")).not.toBeInTheDocument();
  });

  it("renders live portfolio, workforce, and owner attention from tenant records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/dashboard")) return jsonResponse(dashboardPayload);
        if (url.startsWith("/api/activity")) return jsonResponse({ events: [] });
        return jsonResponse({
          hasActivity: false,
          report: { title: "t", summary: "s", posture: "stable", metrics: {}, recommendations: [] },
        });
      }),
    );

    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Connected projects").closest("article")).toHaveTextContent("2");
    });
    expect(screen.getByText("Available agents").closest("article")).toHaveTextContent("11");
    expect(screen.getByText("Security findings").closest("article")).toHaveTextContent("2");
    expect(screen.getByText("1 failed run")).toBeInTheDocument();
    expect(screen.queryByText("Demo Data")).not.toBeInTheDocument();
  });

  it("reports unavailable production telemetry instead of a confident zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/dashboard")) return jsonResponse(dashboardPayload);
        if (url.startsWith("/api/activity")) return jsonResponse({ events: [] });
        return jsonResponse({
          hasActivity: false,
          report: { title: "t", summary: "s", posture: "stable", metrics: {}, recommendations: [] },
        });
      }),
    );

    render(<DashboardConsole />);

    expect(await screen.findByText(/No deployment provider is connected/)).toBeInTheDocument();
    expect(screen.queryByText("Deployments")).not.toBeInTheDocument();
  });

  it("states that execution is locked until an owner enables it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/dashboard")) return jsonResponse(dashboardPayload);
        if (url.startsWith("/api/activity")) return jsonResponse({ events: [] });
        return jsonResponse({
          hasActivity: false,
          report: { title: "t", summary: "s", posture: "stable", metrics: {}, recommendations: [] },
        });
      }),
    );

    render(<DashboardConsole />);

    expect(await screen.findByText("Execution locked by design.")).toBeInTheDocument();
  });
});
