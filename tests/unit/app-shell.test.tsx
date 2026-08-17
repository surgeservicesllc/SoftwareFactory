import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/solutions",
  // The signed-in variants render SignOutButton, which uses the router.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("AppShell navigation", () => {
  it("renders the owner's ordered destinations, closed", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const links = within(navigation).getAllByRole("link").map((link) => link.textContent);

    // The exact structure the owner specified, now closed on arrival: the
    // top-level destinations in order, with each group's subpages behind its
    // chevron rather than listed. Subpages with no backing page (per-user
    // project lists, a secrets store) are deliberately absent rather than
    // linked to nothing.
    expect(links).toEqual([
      "Overview",
      "AI Factory",
      "Projects",
      "Pipelines",
      "Bots",
      "Runs",
      "Reports",
      "Integrations",
      "Settings",
      "Watch",
      "Advanced",
      // Quick actions land on real controls that start work: the add-project
      // form, the composer, and repository authorization. A "View
      // Documentation" shortcut out to the marketing site was removed by
      // owner request; this list is what asserts it stays gone.
      "New Project", "Give a bot work", "Import Repository",
    ]);

    expect(within(navigation).getByText("Quick actions")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "New Project" })).toHaveAttribute(
      "href",
      "/solutions/projects#add-project",
    );
  });

  it("resolves every subpage to a real page once its group is opened", async () => {
    // These hrefs are the reason the group exists. Closed-by-default hides
    // them, so they are asserted after opening rather than dropped.
    const user = userEvent.setup();
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    for (const group of [/projects/i, /bots/i, /settings/i]) {
      await user.click(
        within(navigation).getByRole("button", { name: new RegExp(`expand ${group.source} subpages`, "i") }),
      );
    }

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

  it("lets a person open a subpage group and fold it again", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const toggle = within(navigation).getByRole("button", { name: "Expand Projects subpages" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(within(navigation).getByRole("link", { name: "All Projects" })).toBeInTheDocument();
    // Opening one group leaves the others closed: expanding is a choice about
    // that group, not a mode the whole menu enters.
    expect(within(navigation).queryByRole("link", { name: "Templates" })).not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Collapse Projects subpages" }));
    expect(within(navigation).queryByRole("link", { name: "All Projects" })).not.toBeInTheDocument();
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

describe("navigation opens closed, and the brand sits with the menu", () => {
  it("starts every group collapsed rather than listing every destination", async () => {
    render(<AppShell viewer={{ signedIn: true, email: "a@b.test" }}>content</AppShell>);

    // Arriving should not dump every subpage on someone. The group headers are
    // present; their children are not.
    const projects = screen.getByRole("button", { name: /expand projects subpages/i });
    expect(projects).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /^archived$/i })).not.toBeInTheDocument();
  });

  it("opens a group on request and closes it again", async () => {
    const user = userEvent.setup();
    render(<AppShell viewer={{ signedIn: true }}>content</AppShell>);

    await user.click(screen.getByRole("button", { name: /expand projects subpages/i }));
    expect(await screen.findByRole("link", { name: /^archived$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /collapse projects subpages/i }));
    expect(screen.queryByRole("link", { name: /^archived$/i })).not.toBeInTheDocument();
  });

  it("carries the brand for the drawer, and hides it where the header already shows one", () => {
    // Both halves matter and they pull in opposite directions.
    //
    // The mark exists because the mobile drawer is a full-screen overlay above
    // the header, so an open drawer covers the only other copy — that is the
    // defect that brought this component back after it was first deleted.
    //
    // It is hidden at `xl` because there the sidebar sits directly beneath the
    // header, which renders the same mark unconditionally: two identical logos
    // one row apart.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const mark = screen.getByRole("link", { name: /ai software factory console home/i });
    expect(mark).toHaveAttribute("href", "/solutions");
    expect(mark.className).toContain("xl:hidden");
  });
});
