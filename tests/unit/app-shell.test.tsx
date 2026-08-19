import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/solutions" }));

describe("AppShell navigation", () => {
  it("leads with the owner's daily path and keeps every console reachable", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const links = within(navigation).getAllByRole("link").map((link) => link.textContent);

    // The ungrouped block opens in journey order: see what's happening, give a
    // goal, manage projects, follow the work, read the summary.
    expect(links.slice(0, 5)).toEqual(["Dashboard", "Bot Manager", "Projects", "Runs", "Reports"]);

    // The technical consoles keep full function under Advanced — present, not
    // removed, and not crowding the primary path.
    expect(within(navigation).getByText("Advanced")).toBeInTheDocument();
    for (const label of [
      "Operations", "Activity", "Files", "Backlog", "Workflows", "Agents",
      "Resources", "AgentOS", "Autonomy", "Connections", "Settings",
    ]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("carries no brand of its own, and keeps the drawer opener that has no other entry point", () => {
    // The marketing global navigation renders directly above this shell and
    // already states the identity. The sidebar logo went first; the mobile
    // header's workspace chip followed. What must never disappear with them is
    // the button that opens the navigation drawer on small screens.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(
      screen.queryByRole("link", { name: /softwarefactory dashboard/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open console navigation/i }),
    ).toBeInTheDocument();
  });
});
