import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/solutions",
  // The signed-in variants render SignOutButton, which uses the router.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("AppShell navigation", () => {
  it("renders the owner's ordered destinations with their subpages expanded", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const links = within(navigation).getAllByRole("link").map((link) => link.textContent);

    // The exact structure the owner specified (2026-08-17): top-level
    // destinations in this order, subpage groups expanded by default so every
    // destination is one tap away, then the quick actions. Subpages with no
    // backing page (per-user project lists, a secrets store) are deliberately
    // absent rather than linked to nothing.
    expect(links).toEqual([
      "Overview",
      "Projects", "All Projects", "My Projects", "Archived",
      "Pipelines", "Templates", "Backlog",
      "Bots", "Connect Bot", "My Bots", "Bot Usage", "Bot Activity",
      "Runs",
      "Reports",
      "Integrations",
      "Settings", "General", "Bots & Integrations",
      "Watch", "Operations", "Activity",
      "Advanced", "Files", "Agents", "Resources", "AgentOS", "Autonomy",
      // Quick actions land on real controls: the add-project form, the
      // composer, repository authorization, and the documentation pages.
      "New Project", "Give a bot work", "Import Repository", "View Documentation",
    ]);

    expect(within(navigation).getByText("Quick actions")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "New Project" })).toHaveAttribute(
      "href",
      "/solutions/projects#add-project",
    );
    expect(within(navigation).getByRole("link", { name: "Archived" })).toHaveAttribute(
      "href",
      "/solutions/projects?filter=archived",
    );
    // The design subpages that survive are the ones with a real surface
    // behind them; each lands on the page (or page section) that exists.
    expect(within(navigation).getByRole("link", { name: "Connect Bot" })).toHaveAttribute(
      "href",
      "/solutions/bot-manager#connect",
    );
    expect(within(navigation).getByRole("link", { name: "Bots & Integrations" })).toHaveAttribute(
      "href",
      "/solutions/settings#providers",
    );
    expect(within(navigation).getByRole("link", { name: "Bot Activity" })).toHaveAttribute(
      "href",
      "/solutions/activity",
    );
  });

  it("lets a person fold a subpage group and reopen it", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const toggle = within(navigation).getByRole("button", { name: "Collapse Projects subpages" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(within(navigation).queryByRole("link", { name: "All Projects" })).not.toBeInTheDocument();
    // Collapsing one group leaves the others alone.
    expect(within(navigation).getByRole("link", { name: "Templates" })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Expand Projects subpages" }));
    expect(within(navigation).getByRole("link", { name: "All Projects" })).toBeInTheDocument();
  });

  it("shows the Administration section only to a super admin", () => {
    const { unmount } = render(<AppShell viewer={{ signedIn: true, isSuperAdmin: true }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });
    expect(within(navigation).getByText("Administration")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    unmount();

    render(<AppShell viewer={{ signedIn: true }}>content</AppShell>);
    expect(
      within(screen.getByRole("navigation", { name: "Console" })).queryByRole("link", { name: "Admin" }),
    ).not.toBeInTheDocument();
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
