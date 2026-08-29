"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, Wallet, X } from "lucide-react";

import {
  BUDGET_NAVIGATION,
  BUDGET_ROOT,
  isCurrentBudgetPath,
} from "@/components/budget/navigation";
import { cn } from "@/lib/cn";

/**
 * The Budget Tracker's own chrome.
 *
 * This is not `AppShell` with a different list passed in, and it deliberately
 * is not reachable from it: the Budget Tracker sits in its own route group so
 * the console's sidebar never renders here. Sharing that shell would mean this
 * product's wayfinding is decided by the control plane's — its icon set, its
 * compact-mode preference, its drawer, its idea of what a section is.
 *
 * What it keeps instead is small and its own: a labelled left rail on large
 * screens, a drawer under them, and a heading that names the product once.
 * The global header above this (rendered by the route group's layout) is the
 * separate thing that moves a person *between* products; this moves them
 * inside one.
 */
export function BudgetShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = BUDGET_NAVIGATION.map((item) => ({
    ...item,
    current: isCurrentBudgetPath(item.href, pathname),
  }));

  return (
    <div className="min-h-screen">
      {/* Small screens: a bar with the product name and the drawer trigger. */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="budget-nav-drawer"
          className="btn btn-secondary px-2.5 py-1.5"
        >
          <Menu className="size-4" aria-hidden="true" />
          <span className="sr-only">Open Budget Tracker sections</span>
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wallet className="size-4 text-[var(--accent)]" aria-hidden="true" />
          Budget Tracker
        </span>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close Budget Tracker sections"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            id="budget-nav-drawer"
            className="safe-area-bottom absolute inset-y-0 left-0 w-[min(88vw,300px)] overflow-y-auto border-r border-line bg-surface p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Wallet className="size-4 text-[var(--accent)]" aria-hidden="true" />
                Budget Tracker
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="btn btn-secondary px-2 py-1"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            {/*
              Closing on the link itself rather than on a pathname effect: a
              drawer left open across a route change covers the page it just
              navigated to, which reads as the link having failed.
            */}
            <BudgetNavList
              items={items}
              label="Budget Tracker sections"
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      {/* Large screens: a permanent rail. */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-line bg-surface p-4 lg:block"
        style={{ top: "var(--shell-top, 0px)" }}
      >
        <Link
          href={BUDGET_ROOT}
          className="mb-5 flex items-center gap-2 px-2 text-sm font-semibold text-foreground"
        >
          <Wallet className="size-4 text-[var(--accent)]" aria-hidden="true" />
          Budget Tracker
        </Link>
        <BudgetNavList items={items} label="Budget Tracker sections" />
        <p className="mt-6 px-2 text-xs leading-relaxed text-faint">
          Figures come from rows you record. There is no bank connection, so nothing refreshes on
          its own.
        </p>
      </aside>

      <main className="px-4 py-6 sm:px-6 lg:pl-[calc(16rem+1.5rem)] lg:pr-6">{children}</main>
    </div>
  );
}

type BudgetNavEntry = (typeof BUDGET_NAVIGATION)[number] & { readonly current: boolean };

function BudgetNavList({
  items,
  label,
  onNavigate,
}: {
  items: readonly BudgetNavEntry[];
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const current = item.current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-start gap-3 rounded-md px-2.5 py-2 text-sm",
                  current
                    ? "bg-[var(--accent-soft)] font-medium text-foreground"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", current && "text-[var(--accent)]")}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">{item.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
