import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/solutions",
  // The signed-in variants render SignOutButton, which uses the router.
  // `replace` belongs here as much as the other two: sign-out calls it, and
  // its absence only stayed invisible while no test clicked the button.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
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
      // Job Seeker was removed by owner instruction (2026-08-23): it is a
      // different product, not a console destination, and it is still reached
      // from the top-level product switcher. Its absence here is asserted.
      //
      // Lifecycle is the Agentic SDLC across every run — deliberately its own
      // destination rather than a subpage of AI Factory. AI Factory is the
      // *setup journey* (connect a repository, assign bots, issue a command);
      // Lifecycle is where the work stands. Naming either one the other would
      // be an untruth in the navigation, so they sit side by side.
      "Lifecycle",
      "Runs",
      "Operations",
      "Reports",
      "Integrations",
      "Secrets",
      "Settings",
      "Advanced",
      // The list ends at the navigation. The owner marked the whole action
      // block on the live page — New Project, the Quick actions shortcuts and
      // the promotional card — and asked for it gone, so the column is
      // destinations and nothing else. This list is what asserts it stays gone.
    ]);
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

describe("navigation opens closed, and the menu starts the column", () => {
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

  it("carries no mark of its own", () => {
    /*
     * This assertion has been inverted twice, so the history is the point.
     *
     * The mark was drawer-only, then restored at every width against a
     * reference image, and is now gone entirely — the owner boxed it on the
     * live page and asked for it removed, along with the "Collapse
     * navigation" toggle beneath it. The site header one row above still
     * renders the identity, so nothing is lost by its absence here.
     *
     * Asserted as absence rather than deleted, because the column is what
     * this file describes: a future session that adds a block above the menu
     * should have to change a test that says not to.
     */
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(
      screen.queryByRole("link", { name: /ai software factory console home/i }),
    ).not.toBeInTheDocument();
  });

  it("starts the navigation at the top of the column", () => {
    // "Move the navigation up" is the other half of the same instruction, and
    // it is what the removals were for. The menu must be the column's first
    // child, not merely present somewhere below whatever replaced them.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    expect(navigation.parentElement?.firstElementChild).toBe(navigation);
  });
});

describe("the navigation column against the owner's reference", () => {
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

  it("carries no action block beneath the navigation", () => {
    /*
     * Every part of what the owner marked, asserted by absence.
     *
     * Named individually rather than by counting children: a count passes if
     * one of the five comes back under a different name, and the point of this
     * test is that none of them returns. New Project is checked by role as
     * well as by text, because it was a link styled as a button and a text
     * query alone would miss it if it came back as a real `button`.
     */
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    expect(within(navigation).queryByRole("link", { name: "New Project" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "New Project" })).toBeNull();
    expect(within(navigation).queryByText("Quick actions")).toBeNull();
    expect(within(navigation).queryByText("Give a bot work")).toBeNull();
    expect(within(navigation).queryByText("Import Repository")).toBeNull();
    expect(within(navigation).queryByText(/automate\. build\. ship\./i)).toBeNull();
    expect(
      within(navigation).queryByText(/let ai handle the repetitive work/i),
    ).toBeNull();
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

  it("keeps Advanced, which the reference does not show", () => {
    /*
     * A deliberate departure, and the reason is the other half of the same
     * instruction: this holds Files, Agents, Resources, AgentOS and Autonomy,
     * all of which are real pages. Matching the image exactly would mean
     * deleting the only way to reach them, and "do not remove functionality"
     * is not a rule the picture overrides.
     *
     * `Watch` was the other such group and is gone (2026-08-19, owner
     * instruction). It is not the same case: its two children both survived
     * the removal, so nothing became unreachable — see below.
     */
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    expect(within(navigation).getByRole("link", { name: "Advanced" })).toBeInTheDocument();
  });

  it("drops the Watch group without stranding either page it held", () => {
    /*
     * Removing a group is only safe if its destinations survive it, and these
     * did, by two different routes:
     *
     *   Operations was promoted to a top-level destination of its own, above
     *   Reports, which is where the owner asked for it.
     *
     *   Activity is still reached from Bots as "Bot Activity" — the same
     *   `/solutions/activity` page under the name that says whose activity it
     *   is. That entry pre-dates this change and is why removing the
     *   duplicate costs nothing.
     */
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    expect(within(navigation).queryByRole("link", { name: "Watch" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: /watch subpages/i }))
      .not.toBeInTheDocument();

    expect(within(navigation).getByRole("link", { name: "Operations" }))
      .toHaveAttribute("href", "/solutions/operations");
  });

  it("puts Operations directly above Reports", () => {
    // The position is the instruction, so it is asserted as adjacency rather
    // than as mere presence somewhere in the column.
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const labels = within(screen.getByRole("navigation", { name: "Console" }))
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(labels.indexOf("Reports")).toBe(labels.indexOf("Operations") + 1);
  });
});

/*
 * Retracting the column, and the two questions that gate it.
 *
 * jsdom has no `matchMedia` at all, which is why every test above sees the
 * full column and no control: the shell treats "cannot say how this device is
 * driven" as "not a pointer device". These stub it to model the real cases.
 */
describe("retracting the column on a pointer device", () => {
  function stubDevice({ wide, pointer }: { wide: boolean; pointer: boolean }) {
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      // The shell asks two questions; each stub answers the one it was asked.
      matches: query.includes("min-width") ? wide : pointer,
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    return listeners;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("offers the control on a wide pointer device", () => {
    stubDevice({ wide: true, pointer: true });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(
      screen.getByRole("button", { name: /collapse navigation/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("withholds it from a touch device, which has the drawer instead", () => {
    // A phone or tablet closes the drawer rather than narrowing a column, so a
    // retract control there would act on something that is not on screen.
    stubDevice({ wide: true, pointer: false });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(
      screen.queryByRole("button", { name: /collapse navigation|expand navigation/i }),
    ).not.toBeInTheDocument();
  });

  it("withholds it below the width where both forms fit", () => {
    // Between 1024 and 1279 the rail is the only form that fits beside
    // content, so the width decides and there is nothing to offer.
    stubDevice({ wide: false, pointer: true });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(
      screen.queryByRole("button", { name: /collapse navigation|expand navigation/i }),
    ).not.toBeInTheDocument();
  });

  it("retracts and expands again, and remembers which", async () => {
    const user = userEvent.setup();
    stubDevice({ wide: true, pointer: true });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    await user.click(screen.getByRole("button", { name: /collapse navigation/i }));

    const expand = await screen.findByRole("button", { name: /expand navigation/i });
    expect(expand).toHaveAttribute("aria-pressed", "true");
    // The choice outlives the render, or it is not a preference.
    expect(window.localStorage.getItem("softwarefactory:sidebar-compact")).toBe("1");

    await user.click(expand);
    expect(
      await screen.findByRole("button", { name: /collapse navigation/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("softwarefactory:sidebar-compact")).toBe("0");
  });

  it("collapses the account panel to one working glyph", async () => {
    /*
     * The owner asked for the whole signed-in block to become a single "S"
     * that still works. Both halves are asserted: the panel's reporting is
     * gone, and what replaces it is the sign-out control itself rather than a
     * decorative letter next to a hidden button.
     *
     * Found by role and accessible name, not by the letter — a button whose
     * only text is "S" has no accessible name, and querying for "S" would
     * pass on exactly the broken version this guards against.
     */
    const user = userEvent.setup();
    stubDevice({ wide: true, pointer: true });
    render(
      <AppShell viewer={{ signedIn: true, email: "owner@example.org", isSuperAdmin: true }}>
        content
      </AppShell>,
    );

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse navigation/i }));

    expect(screen.queryByText("Signed in")).toBeNull();
    expect(screen.queryByText("owner@example.org")).toBeNull();
    expect(screen.queryByText(/super admin/i)).toBeNull();

    const glyph = await screen.findByRole("button", { name: "Sign out" });
    expect(glyph).toHaveTextContent("S");
    expect(glyph).toBeEnabled();
  });

  it("signs out from the glyph, so the rail's only account control works", async () => {
    // "Functional" was the word in the request, so it is asserted by clicking:
    // the collapsed control must reach the sign-out endpoint, not merely exist.
    const user = userEvent.setup();
    stubDevice({ wide: true, pointer: true });
    const calls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(
      <AppShell viewer={{ signedIn: true, email: "owner@example.org" }}>content</AppShell>,
    );
    await user.click(screen.getByRole("button", { name: /collapse navigation/i }));
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(calls).toContain("/api/auth/sign-out");
  });

  it("offers the way in as the same glyph when signed out", async () => {
    const user = userEvent.setup();
    stubDevice({ wide: true, pointer: true });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    expect(screen.getByText("Signed out")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse navigation/i }));

    expect(screen.queryByText("Signed out")).toBeNull();
    const glyph = await screen.findByRole("link", { name: "Sign in" });
    expect(glyph).toHaveTextContent("S");
    expect(glyph).toHaveAttribute("href", "/auth/sign-in");
  });

  it("keeps every destination reachable while retracted", async () => {
    // A reduced column is not a hidden one. The labels go to `sr-only`, so the
    // accessible name is what proves they survived.
    const user = userEvent.setup();
    stubDevice({ wide: true, pointer: true });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    await user.click(screen.getByRole("button", { name: /collapse navigation/i }));
    const navigation = screen.getByRole("navigation", { name: "Console" });

    for (const label of ["Overview", "Projects", "Runs", "Settings"]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("puts the control below the menu, never above it", () => {
    /*
     * The position is the point, not an incidental. The owner removed this
     * control from the head of the column and asked for the menu to move up;
     * bringing it back above the menu would undo that instruction while
     * appearing to satisfy this one.
     */
    stubDevice({ wide: true, pointer: true });
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);

    const navigation = screen.getByRole("navigation", { name: "Console" });
    const control = screen.getByRole("button", { name: /collapse navigation/i });

    expect(navigation.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(navigation.parentElement?.firstElementChild).toBe(navigation);
  });
});
