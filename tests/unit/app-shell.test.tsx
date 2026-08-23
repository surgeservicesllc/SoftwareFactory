import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { SDLC_LIFECYCLE } from "@/lib/sdlc/lifecycle";

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

    // Five destinations, in the order a person meets them: where things stand,
    // what they are working on, the factory itself, the machinery underneath
    // it, and the settings that configure all of it. Each group's subpages sit
    // behind its chevron rather than being listed on arrival.
    //
    // This replaced a flat list of thirteen — Bots beside Secrets beside
    // Advanced — which described the pages that happened to exist rather than
    // the product.
    expect(links).toEqual([
      "Overview",
      "Projects",
      "AI Factory",
      "Operations",
      "System",
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

    for (const group of [/projects/i, /operations/i, /system/i]) {
      await user.click(
        within(navigation).getByRole("button", { name: new RegExp(`expand ${group.source} subpages`, "i") }),
      );
    }

    expect(within(navigation).getByRole("link", { name: "Archived" })).toHaveAttribute(
      "href",
      "/solutions/projects?filter=archived",
    );
    // The subpages that survive are the ones with a real surface behind them;
    // each lands on the page (or page section) that exists.
    expect(within(navigation).getByRole("link", { name: "Artifacts" })).toHaveAttribute(
      "href",
      "/solutions/artifacts",
    );
    expect(within(navigation).getByRole("link", { name: "Bots" })).toHaveAttribute(
      "href",
      "/solutions/bot-manager",
    );
    expect(within(navigation).getByRole("link", { name: "Secrets" })).toHaveAttribute(
      "href",
      "/solutions/settings#providers",
    );
    expect(within(navigation).getByRole("link", { name: "Activity" })).toHaveAttribute(
      "href",
      "/solutions/activity",
    );
  });

  it("opens AI Factory onto the ten stages, numbered and in lifecycle order", async () => {
    /*
     * The numbering is the navigation's whole claim to being organised around
     * the lifecycle, and it is derived from the lifecycle table rather than
     * restated in the shell — so this asserts against that table. A stage
     * renamed in one place and not the other would otherwise surface as a link
     * to a page that 404s.
     */
    const user = userEvent.setup();
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    await user.click(
      within(navigation).getByRole("button", { name: /expand ai factory subpages/i }),
    );

    expect(SDLC_LIFECYCLE).toHaveLength(10);
    for (const definition of SDLC_LIFECYCLE) {
      expect(
        within(navigation).getByRole("link", {
          name: `${definition.number} ${definition.title}`,
        }),
      ).toHaveAttribute("href", `/solutions/factory/${definition.slug}`);
    }
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
    expect(within(navigation).queryByRole("link", { name: "Artifacts" })).not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Collapse Projects subpages" }));
    expect(within(navigation).queryByRole("link", { name: "All Projects" })).not.toBeInTheDocument();
  });

  it("shows the Administration section only to a super admin", () => {
    const { unmount } = render(<AppShell viewer={{ signedIn: true, isSuperAdmin: true }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });
    expect(within(navigation).getByText("Administration")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Admin" }))
      .toHaveAttribute("href", "/solutions/admin");
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
   * The current reference is the ten-stage lifecycle brief: five primary
   * destinations, the ten stages under AI Factory, five named surfaces under
   * Operations, and three under System. This records how ours relates to it, so
   * the differences read as decisions rather than as drift — and so a future
   * session cannot quietly re-litigate either one.
   */
  const PRIMARY = ["Overview", "Projects", "AI Factory", "Operations", "System"] as const;
  const OPERATIONS = ["Runs", "Agents", "Pipelines", "Artifacts", "Reports"] as const;
  const SYSTEM = ["Integrations", "Secrets", "Settings"] as const;

  async function openGroup(name: RegExp) {
    const user = userEvent.setup();
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });
    await user.click(within(navigation).getByRole("button", { name }));
    return navigation;
  }

  it("carries the five primary destinations in the reference's order", () => {
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });

    const labels = within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(labels).toEqual([...PRIMARY]);
  });

  it("puts the reference's five operational surfaces first, in its order", async () => {
    const navigation = await openGroup(/expand operations subpages/i);
    const labels = within(navigation)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    const positions = OPERATIONS.map((label) => labels.indexOf(label));

    expect(positions.some((index) => index < 0), `missing: ${
      OPERATIONS.filter((_, index) => positions[index] < 0).join(", ")
    }`).toBe(false);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps four surfaces under Operations that the reference does not name", async () => {
    /*
     * A deliberate departure, and the reason is the other half of the same
     * instruction. Bots, Bot Usage, Templates and Health are real pages with
     * real records behind them. Listing only the reference's five would have
     * been closer to the brief and would have left four working pages
     * reachable by URL alone — and "do not remove functionality" is not a rule
     * the list overrides.
     */
    const navigation = await openGroup(/expand operations subpages/i);
    for (const label of ["Bots", "Bot Usage", "Templates", "Activity", "Health"]) {
      expect(within(navigation).getByRole("link", { name: label }), label).toBeInTheDocument();
    }
  });

  it("carries the reference's three System entries, and the four it does not name", async () => {
    const navigation = await openGroup(/expand system subpages/i);
    for (const label of SYSTEM) {
      expect(within(navigation).getByRole("link", { name: label }), label).toBeInTheDocument();
    }
    // Files, Resources, AgentOS and Autonomy were what the old "Advanced"
    // group held. They configure the system, so this is where they went rather
    // than out of the column.
    for (const label of ["Files", "Resources", "AgentOS", "Autonomy"]) {
      expect(within(navigation).getByRole("link", { name: label }), label).toBeInTheDocument();
    }
  });

  it("points Secrets at the surface that manages credentials", async () => {
    // Added once the provider credential vault existed. Before that the entry
    // would have been a link to a page invented to justify the label.
    const navigation = await openGroup(/expand system subpages/i);
    expect(within(navigation).getByRole("link", { name: "Secrets" }))
      .toHaveAttribute("href", "/solutions/settings#providers");
  });

  it("strands nothing the flat list used to reach", async () => {
    /*
     * The regrouping's one real risk. Every page that had a link before must
     * still have one, or the reorganisation quietly deleted a destination while
     * looking like a tidy-up.
     *
     * Job Seeker is the single deliberate exception and it is not stranded: it
     * is a different product with its own navigation that replaces this column
     * while you are inside it, and the global header carries it for everyone
     * signed in. Listing it here as well was the header and the column
     * disagreeing about what the console contains.
     */
    const user = userEvent.setup();
    render(<AppShell viewer={{ signedIn: false }}>content</AppShell>);
    const navigation = screen.getByRole("navigation", { name: "Console" });
    for (const group of [/projects/i, /ai factory/i, /operations/i, /system/i]) {
      await user.click(
        within(navigation).getByRole("button", { name: new RegExp(`expand ${group.source} subpages`, "i") }),
      );
    }

    const hrefs = new Set(
      within(navigation).getAllByRole("link").map((link) => link.getAttribute("href")),
    );
    for (const href of [
      "/solutions",
      "/solutions/projects",
      "/solutions/myprojects",
      "/solutions/portfolio",
      "/solutions/backlog",
      "/solutions/ai-factory",
      "/solutions/pipelines",
      "/solutions/workflows",
      "/solutions/bot-manager",
      "/solutions/bot-usage",
      "/solutions/activity",
      "/solutions/runs",
      "/solutions/reports",
      "/solutions/operations",
      "/solutions/connections",
      "/solutions/settings",
      "/solutions/files",
      "/solutions/agents",
      "/solutions/resources",
      "/solutions/agentos",
      "/solutions/autonomy",
    ]) {
      expect(hrefs.has(href), `${href} lost its only link`).toBe(true);
    }

    expect(within(navigation).queryByRole("link", { name: "Job Seeker" })).not.toBeInTheDocument();
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

    // The retracted rail carries the five primary destinations. Their
    // subpages are behind a chevron the rail deliberately does not render —
    // a submenu there would have nowhere to open but over the content.
    for (const label of ["Overview", "Projects", "AI Factory", "Operations", "System"]) {
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
