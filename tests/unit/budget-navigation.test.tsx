import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetShell } from "@/components/budget/shell";
import {
  BUDGET_NAVIGATION,
  BUDGET_ROOT,
  isBudgetPath,
  isCurrentBudgetPath,
} from "@/components/budget/navigation";

/**
 * The Budget Tracker's own navigation.
 *
 * The requirement behind these tests was explicit: this section gets its own
 * left navigation and does not leverage the others. So the cases below check
 * both halves — that the rail exists and works, and that it is genuinely
 * separate from `AppShell`, the console navigation and the Job Seeker's.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const harness = vi.hoisted(() => ({ pathname: "/BudgetTracker" }));
vi.mock("next/navigation", () => ({ usePathname: () => harness.pathname }));

afterEach(() => {
  harness.pathname = "/BudgetTracker";
});

describe("the Budget Tracker's navigation is its own", () => {
  it("imports nothing from the other navigations", () => {
    /*
     * The point of the separate module. If this list ever grows an import of
     * `lib/navigation` or the Job Seeker's, the two products start
     * constraining each other's wayfinding, which is what the owner asked
     * against.
     */
    // Import lines only. The prose above them names the other navigations on
    // purpose, to say why this one is separate.
    const imports = (path: string) =>
      source(path)
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line) || /^\s*}?\s*from ["']/.test(line))
        .join("\n");

    const navigation = imports("components/budget/navigation.ts");
    expect(navigation).not.toMatch(/lib\/navigation/);
    expect(navigation).not.toMatch(/job-seeker/);
    expect(navigation).not.toMatch(/app-shell/);
  });

  it("renders its own shell rather than AppShell", () => {
    const shellImports = source("components/budget/shell.tsx")
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*}?\s*from ["']/.test(line))
      .join("\n");
    expect(shellImports).not.toMatch(/app-shell/);
    expect(shellImports).not.toMatch(/job-seeker/);
    expect(shellImports).toMatch(/budget\/navigation/);
  });

  it("sits outside the portal route group, so it inherits no console sidebar", () => {
    // `(portal)/layout.tsx` renders AppShell. While the page lived there, the
    // rail beside a household's finances was the control plane's.
    const layout = source("app/(budget)/layout.tsx");
    expect(layout).toMatch(/<BudgetShell>/);
    // The console's shell is imported by the portal group and not by this one.
    expect(layout).not.toMatch(/import \{ AppShell \}/);
    expect(source("app/(portal)/layout.tsx")).toMatch(/import \{ AppShell \}/);
  });

  it("gates every destination from one layout", () => {
    const layout = source("app/(budget)/BudgetTracker/layout.tsx");
    expect(layout).toMatch(/requirePortalViewer\("\/BudgetTracker"\)/);
  });

  it("has a page behind every entry it lists", () => {
    // A navigation entry with no route is a 404 that looks like a feature.
    for (const item of BUDGET_NAVIGATION) {
      const segment = item.href === BUDGET_ROOT ? "" : `/${item.href.slice(BUDGET_ROOT.length + 1)}`;
      expect(() => source(`app/(budget)/BudgetTracker${segment}/page.tsx`)).not.toThrow();
    }
  });
});

describe("isCurrentBudgetPath", () => {
  it("marks only the entry actually being viewed", () => {
    // Prefix matching would make the root claim every child, lighting up
    // "Overview" on all five pages.
    expect(isCurrentBudgetPath(BUDGET_ROOT, "/BudgetTracker")).toBe(true);
    expect(isCurrentBudgetPath(BUDGET_ROOT, "/BudgetTracker/accounts")).toBe(false);
    expect(isCurrentBudgetPath("/BudgetTracker/accounts", "/BudgetTracker/accounts")).toBe(true);
  });
});

describe("isBudgetPath", () => {
  it("recognises the section and nothing else", () => {
    expect(isBudgetPath("/BudgetTracker")).toBe(true);
    expect(isBudgetPath("/BudgetTracker/bills")).toBe(true);
    expect(isBudgetPath("/budgettracker")).toBe(false);
    expect(isBudgetPath("/solutions")).toBe(false);
    expect(isBudgetPath(null)).toBe(false);
  });
});

describe("BudgetShell", () => {
  it("lists every section in the rail", () => {
    render(<BudgetShell><p>content</p></BudgetShell>);
    const rail = screen.getByRole("navigation", { name: "Budget Tracker sections" });
    const labels = within(rail).getAllByRole("link").map((link) => link.textContent ?? "");
    for (const item of BUDGET_NAVIGATION) {
      expect(labels.some((label) => label.startsWith(item.label))).toBe(true);
    }
  });

  it("marks the current section, and only that one", () => {
    harness.pathname = "/BudgetTracker/transactions";
    render(<BudgetShell><p>content</p></BudgetShell>);
    const rail = screen.getByRole("navigation", { name: "Budget Tracker sections" });
    const current = within(rail)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toMatch(/^Transactions/);
  });

  it("renders the page beside the rail", () => {
    render(<BudgetShell><p>the page</p></BudgetShell>);
    expect(screen.getByText("the page")).toBeInTheDocument();
  });

  it("says there is no bank connection, where the rail is always visible", () => {
    // The honesty label belongs somewhere permanent, not only on a panel a
    // person may never open.
    render(<BudgetShell><p>content</p></BudgetShell>);
    expect(screen.getByText(/no bank connection/i)).toBeInTheDocument();
  });
});
