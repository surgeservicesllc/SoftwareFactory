"use client";

import {
  Activity,
  Bot,
  Boxes,
  BriefcaseBusiness,
  CircleGauge,
  ClipboardList,
  FileText,
  FolderKanban,
  GitBranch,
  HeartPulse,
  Menu,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Grouped by what you are trying to do. Every destination now reads live
 * tenant records, so there is no longer a "demo only" section to separate —
 * an empty page says it is empty rather than showing illustrative rows.
 */
const navigationGroups = [
  {
    heading: null,
    items: [
      { label: "Dashboard", href: "/", icon: CircleGauge },
      { label: "Operations", href: "/operations", icon: HeartPulse },
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "Files", href: "/files", icon: FileText },
    ],
  },
  {
    heading: "Work",
    items: [
      { label: "Bot Manager", href: "/bot-manager", icon: Bot },
      { label: "Backlog", href: "/backlog", icon: ClipboardList },
      { label: "Runs", href: "/runs", icon: GitBranch },
      { label: "Agents", href: "/agents", icon: Boxes },
    ],
  },
  {
    heading: "Evidence & setup",
    items: [
      { label: "Reports", href: "/reports", icon: ScrollText },
      { label: "Activity", href: "/activity", icon: Activity },
      { label: "Connections", href: "/connections", icon: PlugZap },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
] as const;

function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-lg"
      aria-label="SoftwareFactory dashboard"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-[var(--accent-ink)]">
        <BriefcaseBusiness className="size-[18px]" strokeWidth={2.4} aria-hidden="true" />
      </span>
      <span className="font-semibold tracking-[-0.01em] text-foreground">SoftwareFactory</span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex-1 space-y-6">
      {navigationGroups.map((group, groupIndex) => (
        <div key={group.heading ?? `group-${groupIndex}`}>
          {group.heading ? <p className="label mb-2 px-3">{group.heading}</p> : null}
          <ul className="space-y-0.5">
            {group.items.map(({ label, href, icon: Icon }) => {
              const isActive = href === "/" ? pathname === href : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
                        : "text-muted hover:bg-surface-raised hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-5">
      <div className="mb-7 px-2">
        <Logo />
      </div>
      <Navigation onNavigate={onNavigate} />
      <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-line px-3 py-3 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <p>
          Safety lock on. SoftwareFactory can read your repository and open draft pull requests. It
          cannot merge, deploy, or run anything on its own.
        </p>
      </div>
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-[var(--accent-ink)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-line bg-surface xl:block">
        <Sidebar />
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-background px-4 xl:left-64 xl:px-8">
        <div className="flex items-center gap-3 xl:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="btn btn-secondary size-10 px-0"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <Logo />
        </div>
        <div className="hidden items-center gap-2 text-sm text-muted xl:flex">
          <ShieldCheck className="size-4 text-accent" aria-hidden="true" />
          Execution locked — nothing runs without you
        </div>
        <Link href="/auth/sign-in" className="btn btn-secondary btn-sm">
          <UserRound className="size-4" aria-hidden="true" />
          Account
        </Link>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="safe-area-bottom absolute inset-y-0 left-0 w-[min(88vw,300px)] border-r border-line bg-surface">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="btn btn-secondary absolute right-3 top-4 size-9 px-0"
              aria-label="Close navigation"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main id="main-content" className="min-h-screen pt-16 xl:pl-64">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
