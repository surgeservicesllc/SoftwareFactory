"use client";

import {
  Activity,
  Bot,
  Boxes,
  CircleGauge,
  ClipboardList,
  Cpu,
  FileText,
  FolderKanban,
  Gauge,
  Fingerprint,
  GitBranch,
  HeartPulse,
  Menu,
  PlugZap,
  ScrollText,
  Settings,
  ShieldCheck,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/cn";

/**
 * The console shell renders for signed-out visitors too — individual pages
 * fail closed on their own — so it states which case it is in rather than
 * implying a session that does not exist.
 */
export type ShellViewer = {
  readonly signedIn: boolean;
  readonly email?: string | null;
  readonly displayName?: string | null;
  readonly isSuperAdmin?: boolean;
};

const SIGNED_OUT_VIEWER: ShellViewer = { signedIn: false };

/** Destinations only a confirmed super administrator sees. */
const superAdminGroup = {
  heading: "Administration",
  items: [{ label: "Admin", href: "/admin", icon: ShieldCheck }],
} as const;

/**
 * Grouped by how an owner actually moves through the product, not by which
 * phase built each console. The ungrouped block at the top is the daily path
 * in journey order — see what's happening, give a goal, manage projects,
 * follow the work, read the summary. "Watch" is production monitoring.
 * "Advanced" holds the technical consoles: every one keeps its full function
 * (nothing is removed for simplicity), but none of them is required to run
 * the factory day to day, so they no longer crowd the primary path.
 *
 * Every destination reads live tenant records; an empty page says it is
 * empty rather than showing illustrative rows.
 */
const navigationGroups = [
  {
    heading: null,
    items: [
      { label: "Dashboard", href: "/solutions", icon: CircleGauge },
      { label: "Bot Manager", href: "/solutions/bot-manager", icon: Bot },
      { label: "Projects", href: "/solutions/projects", icon: FolderKanban },
      { label: "Runs", href: "/solutions/runs", icon: GitBranch },
      { label: "Reports", href: "/solutions/reports", icon: ScrollText },
    ],
  },
  {
    heading: "Watch",
    items: [
      { label: "Operations", href: "/solutions/operations", icon: HeartPulse },
      { label: "Activity", href: "/solutions/activity", icon: Activity },
    ],
  },
  {
    heading: "Advanced",
    items: [
      { label: "Files", href: "/solutions/files", icon: FileText },
      { label: "Backlog", href: "/solutions/backlog", icon: ClipboardList },
      { label: "Workflows", href: "/solutions/workflows", icon: Workflow },
      { label: "Agents", href: "/solutions/agents", icon: Boxes },
      { label: "Resources", href: "/solutions/resources", icon: Cpu },
      { label: "AgentOS", href: "/solutions/agentos", icon: Fingerprint },
      { label: "Autonomy", href: "/solutions/autonomy", icon: Gauge },
    ],
  },
  {
    heading: "Setup",
    items: [
      { label: "Connections", href: "/solutions/connections", icon: PlugZap },
      { label: "Settings", href: "/solutions/settings", icon: Settings },
    ],
  },
] as const;

function Navigation({
  onNavigate,
  isSuperAdmin = false,
}: {
  onNavigate?: () => void;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const groups = isSuperAdmin ? [...navigationGroups, superAdminGroup] : navigationGroups;

  // Named "Console" rather than "Primary": on /solutions the marketing global
  // navigation is also on the page, and two landmarks sharing an accessible
  // name give screen-reader users no way to tell them apart.
  return (
    <nav aria-label="Console" className="flex-1 space-y-6">
      {groups.map((group, groupIndex) => (
        <div key={group.heading ?? `group-${groupIndex}`}>
          {group.heading ? <p className="label mb-2 px-3">{group.heading}</p> : null}
          <ul className="space-y-0.5">
            {group.items.map(({ label, href, icon: Icon }) => {
              const isActive = href === "/solutions" ? pathname === href : pathname.startsWith(href);
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

function Sidebar({
  onNavigate,
  viewer,
}: {
  onNavigate?: () => void;
  viewer: ShellViewer;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-5">
      {/* No brand here. The marketing global navigation renders directly above
          this shell and already carries it, so a second logo one row down was
          the same identity twice with nothing to distinguish them. */}
      <Navigation onNavigate={onNavigate} isSuperAdmin={viewer.isSuperAdmin} />
      {viewer.signedIn ? (
        <div className="mt-6 rounded-lg border border-line px-3 py-3">
          <p className="label mb-1">Signed in</p>
          <p className="truncate text-sm text-foreground" title={viewer.email ?? undefined}>
            {viewer.displayName ?? viewer.email ?? "Account"}
          </p>
          {viewer.isSuperAdmin ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--accent-border)] bg-[var(--accent-surface)] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-text)]">
              <ShieldCheck className="size-3" aria-hidden="true" />
              Super admin
            </p>
          ) : null}
          <SignOutButton className="btn btn-secondary btn-sm mt-3 w-full justify-center" />
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-line px-3 py-3">
          <p className="label mb-1">Signed out</p>
          <p className="text-sm text-muted">
            These pages need an account. Sign in to see your own projects and runs.
          </p>
          <Link href="/auth/sign-in" className="btn btn-primary btn-sm mt-3 w-full justify-center">
            Sign in
          </Link>
        </div>
      )}
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

export function AppShell({
  children,
  viewer = SIGNED_OUT_VIEWER,
}: Readonly<{ children: React.ReactNode; viewer?: ShellViewer }>) {
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

      <aside className="fixed bottom-0 left-0 top-[var(--shell-top,0px)] z-40 hidden w-64 border-r border-line bg-surface xl:block">
        <Sidebar viewer={viewer} />
      </aside>

      {/*
        Mobile only. On desktop this bar held a status line, a super-admin badge,
        the signed-in email and a sign-out button -- every one of which the global
        navigation immediately above already showed, so the page opened with the
        same identity stated twice and sixty-four pixels of chrome between the
        reader and the content.

        It survives on small screens because it carries the button that opens the
        navigation drawer, which has no other entry point.

        The workspace chip that used to sit beside that button is gone: the
        marketing global navigation directly above already carries the brand,
        so the chip restated it one row down and cost a full row of height on
        the narrowest screens for nothing.
      */}
      <header className="fixed inset-x-0 top-[var(--shell-top,0px)] z-30 flex h-16 items-center gap-3 border-b border-line bg-background px-4 xl:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="btn btn-secondary size-10 px-0"
          aria-label="Open console navigation"
          aria-expanded={mobileOpen}
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-label="Close console navigation"
          />
          <aside className="safe-area-bottom absolute inset-y-0 left-0 w-[min(88vw,300px)] border-r border-line bg-surface">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="btn btn-secondary absolute right-3 top-4 size-9 px-0"
              aria-label="Close console navigation"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} viewer={viewer} />
          </aside>
        </div>
      ) : null}

      <main id="main-content" className="min-h-screen pt-16 xl:pl-64 xl:pt-0">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
