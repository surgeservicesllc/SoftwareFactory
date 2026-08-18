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
      "Secrets",
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

  it("carries the brand at every width, at the top of the navigation column", () => {
    /*
     * This was `xl:hidden` — drawer only — because the marketing header sits
     * directly above the console and renders the same mark, so a desktop
     * sidebar logo is a second copy one row apart. That is a real observation
     * and it lost to an explicit instruction: the owner's reference shows the
     * mark at the top left of the sidebar, aligned with the menu, and asked
     * for it there. A decision the owner has made is not one to re-derive.
     */
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const mark = screen.getByRole("link", { name: /ai software factory console home/i });
    expect(mark).toHaveAttribute("href", "/solutions");
    expect(mark.className).not.toContain("hidden");
  });
});

describe("the navigation column against the owner's reference", () => {
  it("puts the mark above the menu and in line with it", () => {
    // The reference aligns the wordmark with the labels beneath it, not with
    // the rows' boxes — the rows carry their padding inside a rounded
    // background, so matching the box would leave the mark visibly out of line.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const mark = screen.getByRole("link", { name: /ai software factory console home/i });
    const navigation = screen.getByRole("navigation", { name: "Console" });

    expect(mark.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(mark.className).toContain("px-2");
  });

  it("makes a group's label and chevron one highlighted row", () => {
    // The reference shows one block per group. Painting only the link left a
    // pill that stopped short of the chevron, reading as two controls sharing
    // a line rather than one row.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const chevron = within(navigation).getByRole("button", {
      name: /expand projects subpages/i,
    });
    const projects = within(navigation).getByRole("link", { name: "Projects" });

    // Same row element, and that row is what carries the background.
    expect(chevron.parentElement).toBe(projects.parentElement?.parentElement);
    expect(chevron.parentElement?.className).toMatch(/rounded-lg/);
    // The link itself must not paint a second background inside that row.
    expect(projects.className).not.toContain("bg-[var(--accent-surface)]");
  });

  it("leads the actions with New Project as a button, then the shortcuts", () => {
    // The reference gives New Project a button of its own rather than a fourth
    // identical link, because it is the action people come here to take.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const newProject = within(navigation).getByRole("link", { name: "New Project" });

    expect(newProject.className).toContain("btn");
    expect(within(navigation).getByText("Quick actions")).toBeInTheDocument();
    expect(within(navigation).getByText(/automate\. build\. ship\./i)).toBeInTheDocument();
  });
});

describe("what the navigation takes from the reference, and what it does not", () => {
  /**
   * The owner's reference lists nine top-level destinations. This records how
   * ours relates to it, so the differences read as decisions rather than as
   * drift — and so a future session cannot quietly re-litigate either one.
   */
  const REFERENCE_ORDER = [
    "Overview",
    "Projects",
    "Pipelines",
    "Bots",
    "Runs",
    "Reports",
    "Integrations",
    "Secrets",
    "Settings",
  ] as const;

  it("carries every destination the reference names, in its order", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    const labels = within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    const positions = REFERENCE_ORDER.map((label) => labels.indexOf(label));

    expect(positions.some((index) => index < 0), `missing: ${
      REFERENCE_ORDER.filter((_, index) => positions[index] < 0).join(", ")
    }`).toBe(false);
    // Same relative order as the reference, whatever sits between them.
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("points Secrets at the surface that manages credentials", () => {
    // Added once the provider credential vault existed. Before that the entry
    // would have been a link to a page invented to justify the label.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(
      within(screen.getByRole("navigation", { name: "Console" }))
        .getByRole("link", { name: "Secrets" }),
    ).toHaveAttribute("href", "/solutions/settings#providers");
  });

  it("keeps Watch and Advanced, which the reference does not show", () => {
    /*
     * A deliberate departure, and the reason is the other half of the same
     * instruction: these hold Operations, Activity, Files, Agents, Resources,
     * AgentOS and Autonomy, all of which are real pages. Matching the image
     * exactly would mean deleting the only way to reach them, and "do not
     * remove functionality" is not a rule the picture overrides.
     */
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    expect(within(navigation).getByRole("link", { name: "Watch" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Advanced" })).toBeInTheDocument();
  });
});
