import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the factory can close over it: most tests want the site root, and
// the current-destination cases need to stand somewhere specific.
const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { SiteHeader } from "@/components/marketing/site-header";
import { globalNavigation, PUBLIC_NAV, SIGNED_IN_NAV } from "@/lib/navigation";

function primaryNav() {
  return within(screen.getByRole("navigation", { name: "Primary" }));
}

describe("globalNavigation", () => {
  it("shows only public pages when signed out", () => {
    expect(globalNavigation({ signedIn: false })).toEqual(PUBLIC_NAV);
  });

  it("keeps Solutions reachable when signed out", () => {
    // Regression: an earlier revision moved Solutions into the signed-in set,
    // which left a signed-out visitor no navigation route to the console at
    // all. The browser suite caught it; this keeps it caught cheaply.
    expect(PUBLIC_NAV.map((item) => item.href)).toContain("/solutions");
    expect(globalNavigation({ signedIn: false }).map((i) => i.label)).toContain("Solutions");
  });

  it("renders one link per destination when signed in", () => {
    // Dashboard and Solutions are the same route; two links to it is a bug.
    const hrefs = globalNavigation({ signedIn: true, isSuperAdmin: true }).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.filter((href) => href === "/solutions")).toHaveLength(1);
  });

  it("replaces the marketing pages with the console destinations once signed in", () => {
    const items = globalNavigation({ signedIn: true });
    const hrefs = items.map((item) => item.href);

    for (const item of SIGNED_IN_NAV) expect(hrefs).toContain(item.href);
    expect(hrefs).not.toContain("/solutions/admin");

    // Signing in swaps the vocabulary rather than concatenating two of them.
    // The header used to read Dashboard, Projects, Runs, Activity, Admin,
    // Platform, Features, Pricing, Resources, About -- the second half selling
    // the product to someone already inside it.
    for (const item of PUBLIC_NAV) {
      if (item.href === "/solutions") continue; // Dashboard is the same route.
      expect(hrefs).not.toContain(item.href);
    }
  });

  it("never puts Administration in the global navigation, for anyone", () => {
    // Owner request, 2026-08-23. Admin is a page inside the console, not a
    // third product, and the console column already lists it for the viewers
    // who have it. A super administrator now sees exactly what everyone else
    // sees up here.
    expect(globalNavigation({ signedIn: true, isSuperAdmin: true })).toEqual(
      globalNavigation({ signedIn: true }),
    );
    expect(globalNavigation({ signedIn: true, isSuperAdmin: true }).map((i) => i.href))
      .not.toContain("/solutions/admin");

    // The role is meaningless without a session.
    expect(globalNavigation({ signedIn: false, isSuperAdmin: true })).toEqual(PUBLIC_NAV);
  });

  it("names the factory the way the product names itself", () => {
    // Owner request, 2026-08-23: the header entry reads "Software Factory".
    // Budget Tracker joined on 2026-08-29, also by owner request.
    expect(SIGNED_IN_NAV.map((item) => item.label)).toEqual([
      "Software Factory",
      "Job Seeker",
      "Budget Tracker",
    ]);
  });
});

describe("SiteHeader", () => {
  it("offers sign-in and no console links when signed out", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get Started Free" })).toBeInTheDocument();
    expect(primaryNav().queryByRole("link", { name: "Software Factory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("swaps the calls to action for an account area once signed in", () => {
    render(
      <SiteHeader viewer={{ signedIn: true, email: "person@example.org", displayName: "A Person" }} />,
    );

    expect(primaryNav().getByRole("link", { name: "Software Factory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Console" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
    expect(screen.getByText("A Person")).toBeInTheDocument();

    // The signed-out calls to action must be gone, not merely duplicated.
    expect(screen.queryByRole("link", { name: "Sign In" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Get Started Free" })).not.toBeInTheDocument();
  });

  it("shows the super admin badge without an Admin destination beside it", () => {
    const { unmount } = render(
      <SiteHeader viewer={{ signedIn: true, email: "person@example.org" }} />,
    );
    expect(primaryNav().queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByText("Super admin")).not.toBeInTheDocument();
    unmount();

    render(
      <SiteHeader viewer={{ signedIn: true, email: "boss@example.org", isSuperAdmin: true }} />,
    );
    // The badge still says who is looking; the link is gone from the header.
    // Losing a link is not losing access — /solutions/admin enforces its own.
    expect(screen.getByText("Super admin")).toBeInTheDocument();
    expect(primaryNav().queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("falls back to the email when no display name is set", () => {
    render(<SiteHeader viewer={{ signedIn: true, email: "person@example.org" }} />);
    expect(screen.getByText("person@example.org")).toBeInTheDocument();
  });

  it("orders the signed-in navigation the way the owner's design does", () => {
    // The products, and nothing else — not the marketing pages that used to
    // trail this list, and not Admin, which the owner removed on 2026-08-23.
    // A super administrator is rendered here precisely because their header
    // must look the same as everyone else's.
    render(
      <SiteHeader viewer={{ signedIn: true, email: "boss@example.org", isSuperAdmin: true }} />,
    );

    expect(primaryNav().getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Software Factory",
      "Job Seeker",
      "Budget Tracker",
    ]);
  });

  it("wires the products at the exact addresses the owner named", () => {
    /*
     * The hrefs are the instruction, not an implementation detail, so they are
     * asserted literally rather than through the module that supplies them.
     *
     * `Software Factory` is `/solutions` — the console entry point — and not
     * `/solutions/ai-factory`, which is a page inside the console that happens
     * to share the name.
     */
    render(
      <SiteHeader viewer={{ signedIn: true, email: "boss@example.org", isSuperAdmin: true }} />,
    );

    expect(primaryNav().getByRole("link", { name: "Software Factory" }))
      .toHaveAttribute("href", "/solutions");
    expect(primaryNav().getByRole("link", { name: "Job Seeker" }))
      .toHaveAttribute("href", "/job-seeker");
    /*
     * The capitalised path is the instruction too. Next.js routes are
     * case-sensitive, so `/budgettracker` would 404 while looking correct in
     * a diff — this asserts the spelling the page actually answers to.
     */
    expect(primaryNav().getByRole("link", { name: "Budget Tracker" }))
      .toHaveAttribute("href", "/BudgetTracker");
  });

  it("drops the console's inner pages from the header", () => {
    // Projects, Runs and Activity were a short, arbitrary excerpt of the
    // console's own column. The column still lists them; the header names the
    // products instead.
    render(<SiteHeader viewer={{ signedIn: true, email: "person@example.org" }} />);

    for (const label of ["Projects", "Runs", "Activity", "Dashboard"]) {
      expect(primaryNav().queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  afterEach(() => {
    route.pathname = "/";
  });

  it("marks exactly one destination current on a nested console page", () => {
    /*
     * The admin page used to have its own header entry nested under
     * `/solutions`, and a plain prefix test marked both current — two links
     * claiming `aria-current="page"`, two underlines drawn at once. The entry
     * is gone; what must still hold is that standing deep inside the console
     * lights exactly one product, and it is the product you are in.
     */
    route.pathname = "/solutions/admin";
    render(
      <SiteHeader viewer={{ signedIn: true, email: "boss@example.org", isSuperAdmin: true }} />,
    );

    const current = primaryNav()
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current.map((link) => link.textContent)).toEqual(["Software Factory"]);
  });

  it("keeps Software Factory current inside the console", () => {
    // The console's own pages sit under /solutions, and the header should go
    // on saying which product you are in while you move around inside it.
    route.pathname = "/solutions/ai-factory";
    render(<SiteHeader viewer={{ signedIn: true, email: "person@example.org" }} />);

    const current = primaryNav()
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current.map((link) => link.textContent)).toEqual(["Software Factory"]);
  });

  it("marks the current destination and underlines only that one", () => {
    render(<SiteHeader viewer={{ signedIn: false }} />);

    const current = primaryNav()
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    // The mock pathname is "/", which is no navigation entry, so nothing is
    // current. An always-current first item would look right and be wrong.
    expect(current).toHaveLength(0);
  });
});

describe("the brand mark", () => {
  it("is one labelled link, so the lockup is not spelled out line by line", () => {
    render(<SiteHeader />);

    const brand = screen.getAllByRole("link", { name: /ai factory home/i });
    expect(brand.length).toBeGreaterThan(0);
    expect(brand[0]).toHaveAttribute("href", "/");
  });

  it("is drawn in one place, and nowhere else keeps a copy", async () => {
    /*
     * Two hand-drawn copies is how one product ends up with two logos that
     * disagree about their own colours on the same page.
     *
     * This used to also require the console shell to import `BrandMark`. It no
     * longer renders a mark at all (ADR-090), so that half asserted a caller
     * rather than the rule. The rule is the path data: whoever draws the mark
     * imports the component, and no file inlines the artwork — which is what
     * has to hold if the sidebar ever carries one again.
     */
    const shell = await import("@/components/app-shell");
    expect(shell).toBeDefined();

    const source = await import("node:fs/promises");
    const header = await source.readFile("components/marketing/site-header.tsx", "utf8");
    const sidebar = await source.readFile("components/app-shell.tsx", "utf8");

    expect(header).toContain("@/components/brand-mark");
    // The console column renders no mark; what matters is that it has not
    // grown a private one.
    expect(sidebar).not.toContain("@/components/brand-mark");
    expect(header).not.toContain("M20 1.5 37 11v22L20 42.5 3 33V11z");
    expect(sidebar).not.toContain("M20 1.5 37 11v22L20 42.5 3 33V11z");
  });
});
