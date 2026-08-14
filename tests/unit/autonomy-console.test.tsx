import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutonomyConsole } from "@/components/autonomy-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

// A fresh Response per call: a body can only be read once.
function stubFetch(bySuffix: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => {
    const key = Object.keys(bySuffix).find((suffix) => input.includes(suffix));
    return Promise.resolve(jsonResponse(key ? bySuffix[key] : {}));
  }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("autonomy console", () => {
  it("says nothing could run when no executor is connected", async () => {
    stubFetch({
      "/status": {
        status: [{
          projectId: "p1", projectName: "Storefront", autonomousMode: false,
          riskCeiling: "green", riskCeilingSource: "organization",
          killSwitchActive: true, releaseFrozen: false, executorConnected: false,
          actions: { enabled: 0, total: 9 }, decisionsRecorded: 3,
          lastDecisionAt: "2026-08-14T10:00:00.000Z",
        }],
      },
    });

    render(<AutonomyConsole />);

    // Nine OFF flags alone could read as "ready but idle".
    expect(await screen.findByText(/No executor is connected/)).toBeInTheDocument();
    expect(screen.getByText("Kill switch ON")).toBeInTheDocument();
    expect(screen.getByText(/0 of 9 automatic actions enabled/)).toBeInTheDocument();
  });

  it("shows why a decision was refused", async () => {
    stubFetch({
      "/decisions": {
        decisions: [{
          id: "d1", projectName: "Storefront", action: "merge", decision: "NOT_APPROVED",
          risk: "yellow", riskEscalated: false, headSha: "abcdef1234567",
          blockers: ["MERGE_EXECUTOR_NOT_CONNECTED"], reachedStage: "merge",
          policyVersion: "v1", hadAuthor: true, hadApprover: false,
          independentApproval: false, decidedAt: "2026-08-14T10:00:00.000Z",
        }],
      },
    });

    render(<AutonomyConsole />);

    // A refusal without its reason is not an audit trail.
    expect(await screen.findByText(/MERGE_EXECUTOR_NOT_CONNECTED/)).toBeInTheDocument();
    expect(screen.getByText("not approved")).toBeInTheDocument();
  });

  it("distinguishes an independent approval from a self-approval", async () => {
    stubFetch({
      "/decisions": {
        decisions: [{
          id: "d2", projectName: "Storefront", action: "review",
          decision: "APPROVED_AUTOMATICALLY", risk: "green", riskEscalated: false,
          headSha: null, blockers: [], reachedStage: "review", policyVersion: "v1",
          hadAuthor: true, hadApprover: true, independentApproval: false,
          decidedAt: "2026-08-14T10:00:00.000Z",
        }],
      },
    });

    render(<AutonomyConsole />);

    // The rule the phase turns on, stated rather than implied.
    expect(await screen.findByText(/Approver and author are the same person/))
      .toBeInTheDocument();
  });

  it("flags a risk escalation past the declaration", async () => {
    stubFetch({
      "/decisions": {
        decisions: [{
          id: "d3", projectName: "Storefront", action: "deploy",
          decision: "OWNER_APPROVAL_REQUIRED", risk: "red", riskEscalated: true,
          headSha: null, blockers: ["OWNER_APPROVAL_REQUIRED"], reachedStage: "deploy",
          policyVersion: "v1", hadAuthor: true, hadApprover: false,
          independentApproval: false, decidedAt: "2026-08-14T10:00:00.000Z",
        }],
      },
    });

    render(<AutonomyConsole />);

    expect(await screen.findByText(/escalated past the declaration/)).toBeInTheDocument();
  });

  it("offers no control that would enable an action", async () => {
    stubFetch({ "/status": { status: [] }, "/decisions": { decisions: [] } });

    const { container } = render(<AutonomyConsole />);
    await screen.findByText("No projects yet");

    // Enabling an automatic action is a RED change needing its own migration,
    // so this surface must not present a switch it cannot honour.
    const toggles = container.querySelectorAll('input[type="checkbox"], [role="switch"]');
    expect(toggles).toHaveLength(0);
  });
});
