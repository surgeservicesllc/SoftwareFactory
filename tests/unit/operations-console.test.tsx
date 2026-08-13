import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperationsConsole } from "@/components/operations-console";

vi.mock("@/lib/supabase/browser-config", () => ({
  isBrowserSupabaseConfigured: () => true,
}));

const overview = {
  role: "owner",
  executionAllowed: false,
  summary: {
    projectsTotal: 2,
    projectsHealthy: 0,
    projectsDegraded: 0,
    projectsCritical: 1,
    projectsUnknown: 1,
    projectsPaused: 0,
    projectsFrozen: 1,
    openIncidents: 1,
    openSev1: 1,
    openSev2: 0,
    incidentsResolved24h: 0,
    failedDeployments24h: 0,
    rollbacks24h: 1,
    failedRollbacks24h: 1,
    repairsOpen: 1,
    ownerAttention: 1,
    connectedMonitors: 1,
    pendingEvents: 0,
  },
  projects: [
    {
      id: "project-observed",
      name: "Storefront",
      status: "active",
      healthState: "critical",
      healthReason: "Critical: 1 failing monitor(s) past threshold and 1 open SEV1 incident(s).",
      healthComputedAt: "2026-08-13T10:00:00.000Z",
      releasesFrozen: true,
      operationsStopped: false,
      ownerAttentionRequired: true,
      connectedMonitors: 1,
      openIncidents: 1,
    },
    {
      id: "project-unobserved",
      name: "Internal tools",
      status: "active",
      healthState: "unknown",
      healthReason: "No connected production monitor is enabled, so health cannot be evidenced.",
      healthComputedAt: null,
      releasesFrozen: false,
      operationsStopped: false,
      ownerAttentionRequired: false,
      connectedMonitors: 0,
      openIncidents: 0,
    },
  ],
  incidents: [
    {
      id: "incident-1",
      projectId: "project-observed",
      projectName: "Storefront",
      title: "Production health is failing",
      severity: "sev1",
      status: "investigating",
      source: "uptime",
      symptoms: "Expected HTTP 200 but received 503.",
      impact: "Production is unavailable for all users.",
      occurrenceCount: 3,
      detectedAt: "2026-08-13T09:00:00.000Z",
      resolvedAt: null,
      ownerAttentionRequired: true,
      rootCause: null,
      correctiveAction: null,
      autoCreated: true,
    },
  ],
  monitors: [
    {
      id: "monitor-1",
      projectId: "project-observed",
      projectName: "Storefront",
      name: "Production health",
      signalKind: "uptime",
      provider: "http",
      targetUrl: "https://example.com/health",
      connectionState: "connected",
      connectionLabel: "Connected",
      unavailableReason: null,
      enabled: true,
      lastOutcome: "fail",
      lastObservedAt: "2026-08-13T09:59:00.000Z",
      consecutiveFailures: 2,
      failureThreshold: 2,
    },
    {
      id: "monitor-2",
      projectId: "project-observed",
      projectName: "Storefront",
      name: "Vercel deployments",
      signalKind: "deployment",
      provider: "vercel",
      targetUrl: null,
      connectionState: "not_connected",
      connectionLabel: "Not Connected",
      unavailableReason: "No connected adapter for provider vercel in Phase 1E.",
      enabled: false,
      lastOutcome: "unknown",
      lastObservedAt: null,
      consecutiveFailures: 0,
      failureThreshold: 2,
    },
  ],
  providers: [
    {
      id: "http",
      label: "Direct HTTPS probe",
      connected: true,
      statusLabel: "Connected",
      supports: ["uptime"],
      unavailableReason: null,
      unblockedBy: null,
    },
    {
      id: "vercel",
      label: "Vercel deployments",
      connected: false,
      statusLabel: "Not Connected",
      supports: ["deployment"],
      unavailableReason: "No Vercel API connection exists.",
      unblockedBy: "An owner-authorized Vercel connection with a server-only token.",
    },
  ],
  journeys: [
    {
      id: "journey-1",
      projectName: "Storefront",
      monitorId: "monitor-3",
      name: "Checkout",
      profile: "critical",
      baseUrl: "https://example.com",
      stepCount: 4,
      writeSteps: 1,
      enabled: true,
      connectionLabel: "Connected",
      lastOutcome: "pass",
      lastObservedAt: "2026-08-13T09:58:00.000Z",
    },
  ],
  auditEvents: [
    {
      id: "audit-1",
      projectId: "project-observed",
      kind: "freeze.activated",
      entityType: "release_freeze",
      summary: "Autonomous releases frozen by SEV1 incident.",
      createdAt: "2026-08-13T09:01:00.000Z",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Operations console", () => {
  it("tells a signed-out visitor to sign in instead of showing empty operations data", () => {
    render(<OperationsConsole authenticated={false} />);
    expect(screen.getByRole("heading", { name: /sign in to see production operations/i })).toBeInTheDocument();
  });

  it("shows real health with its reason and never presents an unobserved project as healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(overview), { status: 200 })),
    );

    render(<OperationsConsole authenticated />);

    await waitFor(() => expect(screen.getByText("Storefront")).toBeInTheDocument());
    expect(screen.getByText(/1 failing monitor\(s\) past threshold/)).toBeInTheDocument();
    expect(screen.getByText(/health cannot be evidenced/)).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.getAllByText("Releases frozen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Owner attention").length).toBeGreaterThan(0);
  });

  it("labels an unconnected monitor and provider as Not Connected with the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(overview), { status: 200 })),
    );

    render(<OperationsConsole authenticated />);

    await waitFor(() => expect(screen.getAllByText("Not Connected").length).toBeGreaterThan(0));
    expect(screen.getByText(/no connected adapter for provider vercel/i)).toBeInTheDocument();
    expect(screen.getByText(/no vercel api connection exists/i)).toBeInTheDocument();
    expect(screen.getByText(/owner-authorized vercel connection/i)).toBeInTheDocument();
  });

  it("offers a run-check button only for a connected monitor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(overview), { status: 200 })),
    );

    render(<OperationsConsole authenticated />);

    await waitFor(() => expect(screen.getByText("Production health")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /run check now/i })).toHaveLength(1);
  });

  it("surfaces the incident with its severity and deduplicated occurrence count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(overview), { status: 200 })),
    );

    render(<OperationsConsole authenticated />);

    await waitFor(() => expect(screen.getByText("Production health is failing")).toBeInTheDocument());
    expect(screen.getByText("SEV1")).toBeInTheDocument();
    expect(screen.getByText(/3 occurrences/)).toBeInTheDocument();
    expect(screen.getByText("Detected automatically")).toBeInTheDocument();
  });

  it("says plainly that a declared synthetic write is recorded but not executed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(overview), { status: 200 })),
    );

    render(<OperationsConsole authenticated />);

    await waitFor(() => expect(screen.getByText("Checkout")).toBeInTheDocument());
    expect(screen.getByText(/critical profile · 4 steps/)).toBeInTheDocument();
    expect(screen.getByText(/1 declared write step recorded but not executed/)).toBeInTheDocument();
  });

  it("reports an unavailable source instead of inferring a healthy portfolio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 })),
    );

    render(<OperationsConsole authenticated />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /operations data is unavailable/i })).toBeInTheDocument(),
    );
  });
});
