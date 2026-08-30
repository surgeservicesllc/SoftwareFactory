"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bug, Menu, X } from "lucide-react";

import {
  SERVICES_NAVIGATION,
  SERVICES_ROOT,
  isCurrentServicesPath,
} from "@/components/services/navigation";
import { ServicesSearch } from "@/components/services/search";
import { cn } from "@/lib/cn";

/**
 * The Services CRM's own chrome, on the Budget Tracker's pattern: a product
 * in its own route group with its own rail, never the console's sidebar —
 * and, uniquely, its own `services-theme` scope: this is the product a pest
 * company's own staff and customers see, so it trades the console's dark
 * workspace for a light client-facing ground. A labelled left rail on large
 * screens, a drawer under them, and a brand block that names the product
 * once. The global header above moves a person between products; this moves
 * them inside one.
 */
export function ServicesShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = SERVICES_NAVIGATION.map((item) => ({
    ...item,
    current: isCurrentServicesPath(item.href, pathname),
  }));

  return (
    <div className="services-theme min-h-screen">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="services-nav-drawer"
          className="btn btn-secondary px-2.5 py-1.5"
        >
          <Menu className="size-4" aria-hidden="true" />
          <span className="sr-only">Open Services sections</span>
        </button>
        <ServicesBrand compact />
      </div>

      {drawerOpen ? (
        <div className="services-theme fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close Services sections"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            id="services-nav-drawer"
            className="safe-area-bottom absolute inset-y-0 left-0 w-[min(88vw,300px)] overflow-y-auto border-r border-line bg-surface p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <ServicesBrand compact />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="btn btn-secondary px-2 py-1"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <ServicesSearch onNavigate={() => setDrawerOpen(false)} />
            <ServicesNavList
              items={items}
              label="Services sections"
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <aside
        className="services-theme fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-line bg-surface p-4 lg:block"
        style={{ top: "var(--shell-top, 0px)" }}
      >
        <Link href={SERVICES_ROOT} className="mb-5 block px-1">
          <ServicesBrand />
        </Link>
        <ServicesSearch />
        <ServicesNavList items={items} label="Services sections" />
        <p className="mt-6 px-2 text-xs leading-relaxed text-faint">
          The pest-services CRM. Every figure comes from records this workspace
          made; sections appear here as they are built and wired, never before.
        </p>
      </aside>

      <main className="px-4 py-6 sm:px-6 lg:pl-[calc(16rem+1.5rem)] lg:pr-6">{children}</main>
    </div>
  );
}

function ServicesBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-sm"
        aria-hidden="true"
      >
        <Bug className="size-4.5" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-semibold text-foreground">Services</span>
        {compact ? null : (
          <span className="block text-[11px] font-medium uppercase tracking-wide text-faint">
            Pest Services CRM
          </span>
        )}
      </span>
    </span>
  );
}

type ServicesNavEntry = (typeof SERVICES_NAVIGATION)[number] & { readonly current: boolean };

function ServicesNavList({
  items,
  label,
  onNavigate,
}: {
  items: readonly ServicesNavEntry[];
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
                  "flex items-start gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  current
                    ? "bg-[var(--accent-surface)] font-medium text-foreground shadow-[inset_2px_0_0_var(--accent)]"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", current ? "text-[var(--accent)]" : "text-faint")}
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
