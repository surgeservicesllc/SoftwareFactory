import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Untyped on purpose: every one of these stands in for a module whose real
 * signature the page imports, and pinning a narrow return type here would make
 * the mock, rather than the page, decide what a viewer can be.
 */
const {
  closeDecisionGate,
  isDecisionGateOpen,
  listOrganizationMemberships,
  readViewer,
  redirect,
} = vi.hoisted(() => ({
  closeDecisionGate: vi.fn(),
  isDecisionGateOpen: vi.fn(),
  listOrganizationMemberships: vi.fn(),
  readViewer: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/viewer", () => ({ readViewer }));
vi.mock("@/lib/auth/decision-gate", () => ({
  DECISION_PATH: "/decision",
  closeDecisionGate,
  isDecisionGateOpen,
  openDecisionGate: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/tenant", () => ({ listOrganizationMemberships }));
// The three live cards each own their own tested states; this page's job is
// to place them, so they are stood in for rather than driven again here.
vi.mock("@/components/getting-started", () => ({
  GettingStarted: () => <div data-testid="getting-started" />,
}));
vi.mock("@/components/decision-overview", () => ({
  DecisionOverview: () => <div data-testid="decision-overview" />,
}));
vi.mock("@/components/recent-activity-card", () => ({
  RecentActivityCard: () => <div data-testid="recent-activity" />,
}));

import DecisionPage from "@/app/decision/page";

/**
 * The screen every sign-in lands on.
 *
 * Two things are worth pinning: the three gates in front of it, in the order
 * that makes each one meaningful, and the fact that choosing is a form
 * submission rather than a link — a link would let Next.js prefetch the
 * destination, and a prefetch that closed the gate would dismiss the page
 * before the person had read it.
 */

async function renderPage() {
  render(await DecisionPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  closeDecisionGate.mockResolvedValue(undefined);
  isDecisionGateOpen.mockResolvedValue(true);
  listOrganizationMemberships.mockResolvedValue([{ organizationId: "org-1" }]);
  readViewer.mockResolvedValue({
    signedIn: true,
    email: "owner@example.org",
    displayName: "A Person",
    emailConfirmed: true,
    isSuperAdmin: false,
  });
});

describe("the decision page", () => {
  it("offers the two products, each as a submitted choice rather than a link", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "AI Software Factory" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Job Seeker" })).toBeInTheDocument();

    for (const label of ["Open the Software Factory", "Open Job Seeker"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("type", "submit");
      expect(button.closest("form")).not.toBeNull();
    }

    // A link here would be prefetched, and a prefetch that closed the gate
    // would dismiss the chooser on the person's behalf.
    expect(screen.queryByRole("link", { name: /Open the Software Factory/ })).not.toBeInTheDocument();
  });

  it("greets the person and places the three live cards", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Welcome back, A Person" }))
      .toBeInTheDocument();
    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(screen.getByTestId("decision-overview")).toBeInTheDocument();
    expect(screen.getByTestId("recent-activity")).toBeInTheDocument();
  });

  it("falls back to the email, and then to no name at all", async () => {
    readViewer.mockResolvedValue({
      signedIn: true,
      email: "owner@example.org",
      displayName: null,
      emailConfirmed: true,
      isSuperAdmin: false,
    });
    const { unmount } = render(await DecisionPage());
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back, owner@example.org" }))
      .toBeInTheDocument();
    unmount();

    // A verified session with neither name nor address is unusual but not
    // impossible, and greeting someone by an empty string is worse than not
    // greeting them by name at all.
    readViewer.mockResolvedValue({
      signedIn: true,
      email: null,
      displayName: null,
      emailConfirmed: true,
      isSuperAdmin: false,
    });
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in, and asks to come back here", async () => {
    readViewer.mockResolvedValue({ signedIn: false });

    await expect(DecisionPage()).rejects.toThrow("NEXT_REDIRECT:/auth/sign-in?next=/decision");
    // The gates run in order: nothing else is consulted for someone with no
    // session at all.
    expect(listOrganizationMemberships).not.toHaveBeenCalled();
    expect(isDecisionGateOpen).not.toHaveBeenCalled();
  });

  it("sends someone with no workspace through onboarding and back", async () => {
    listOrganizationMemberships.mockResolvedValue([]);

    await expect(DecisionPage()).rejects.toThrow("NEXT_REDIRECT:/auth/onboarding?next=/decision");
    expect(isDecisionGateOpen).not.toHaveBeenCalled();
  });

  it("is not reachable once the gate is closed — the owner's 'initial login only'", async () => {
    isDecisionGateOpen.mockResolvedValue(false);

    await expect(DecisionPage()).rejects.toThrow("NEXT_REDIRECT:/solutions");
  });
});
