"use client";

import {
  Activity,
  Bot,
  Boxes,
  ChevronDown,
  CircleGauge,
  ClipboardList,
  Cpu,
  FileText,
  FolderKanban,
  FolderOpen,
  Gauge,
  Fingerprint,
  GitBranch,
  HeartPulse,
  type LucideIcon,
  Menu,
  PlugZap,
  Plus,
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
import { BrandMark } from "@/components/brand-mark";
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
 * Owner-ordered structure (2026-08-17): top-level destinations with
 * expandable subpage groups, mirroring the provided design. Labels follow
 * that design — Overview, Bots, Integrations — while every href stays a real,
 * existing page; the design's subpages with no backing capability (per-user
 * project lists, a secrets store) are deliberately absent rather than linked
 * to nothing.
 *
 * Every destination reads live tenant records; an empty page says it is
 * empty rather than showing illustrative rows.
 */
type NavigationItem = { label: string; href: string; icon: LucideIcon };
type NavigationEntry = NavigationItem & { subpages?: readonly NavigationItem[] };

const navigationEntries: readonly NavigationEntry[] = [
  { label: "Overview", href: "/solutions", icon: CircleGauge },
  // The guided end-to-end journey over the live flows (owner order,
  // 2026-08-17): sits directly under Overview.
  { label: "AI Factory", href: "/solutions/ai-factory", icon: Workflow },
  {
    label: "Projects",
    href: "/solutions/projects",
    icon: FolderKanban,
    subpages: [
      { label: "All Projects", href: "/solutions/projects", icon: FolderKanban },
      // The portfolio as collapsible rows; same live records, reached from a
      // list-first posture. Shared with Me / Starred still have no backing
      // model and stay absent.
      { label: "My Projects", href: "/solutions/myprojects", icon: FolderOpen },
      { label: "Archived", href: "/solutions/projects?filter=archived", icon: ClipboardList },
    ],
  },
  {
    label: "Pipelines",
    href: "/solutions/pipelines",
    icon: Workflow,
    subpages: [
      // Active and All are live lifecycle views over saved commands; the
      // workflows page carries each template's full compiled preview. The
      // design's Schedules subpage has no scheduler model yet and stays out.
      { label: "Active", href: "/solutions/pipelines", icon: HeartPulse },
      { label: "All Pipelines", href: "/solutions/pipelines?view=all", icon: Workflow },
      { label: "Templates", href: "/solutions/workflows", icon: Workflow },
      { label: "Backlog", href: "/solutions/backlog", icon: ClipboardList },
    ],
  },
  {
    label: "Bots",
    href: "/solutions/bot-manager",
    icon: Bot,
    subpages: [
      { label: "Connect Bot", href: "/solutions/bot-manager#connect", icon: Plus },
      { label: "My Bots", href: "/solutions/bot-manager", icon: Bot },
      // Recorded provider-subscription windows per account (ADR-076).
      { label: "Bot Usage", href: "/solutions/bot-usage", icon: Gauge },
      // Bot work lands in the activity feed; the same page also sits under
      // Watch, which is deliberate — both readings are true.
      { label: "Bot Activity", href: "/solutions/activity", icon: Activity },
    ],
  },
  { label: "Runs", href: "/solutions/runs", icon: GitBranch },
  { label: "Reports", href: "/solutions/reports", icon: ScrollText },
  { label: "Integrations", href: "/solutions/connections", icon: PlugZap },
  {
    label: "Settings",
    href: "/solutions/settings",
    icon: Settings,
    subpages: [
      { label: "General", href: "/solutions/settings", icon: Settings },
      // Provider configuration lives on the settings page; the anchor lands
      // there. Members/Teams/Permissions/Billing from the design have no
      // backing surfaces yet and are deliberately absent.
      { label: "Bots & Integrations", href: "/solutions/settings#providers", icon: PlugZap },
    ],
  },
  {
    label: "Watch",
    href: "/solutions/operations",
    icon: HeartPulse,
    subpages: [
      { label: "Operations", href: "/solutions/operations", icon: HeartPulse },
      { label: "Activity", href: "/solutions/activity", icon: Activity },
    ],
  },
  {
    label: "Advanced",
    href: "/solutions/files",
    icon: Boxes,
    subpages: [
      { label: "Files", href: "/solutions/files", icon: FileText },
      { label: "Agents", href: "/solutions/agents", icon: Boxes },
      { label: "Resources", href: "/solutions/resources", icon: Cpu },
      { label: "AgentOS", href: "/solutions/agentos", icon: Fingerprint },
      { label: "Autonomy", href: "/solutions/autonomy", icon: Gauge },
    ],
  },
] as const;

/**
 * The shortcuts under the navigation, from the same design. Each one lands on
 * a real control: the add-project form, the composer, repository
 * authorization, and the public documentation pages.
 */
const quickActions: readonly NavigationItem[] = [
  { label: "New Project", href: "/solutions/projects#add-project", icon: Plus },
  { label: "Give a bot work", href: "/solutions/bot-manager", icon: Bot },
  { label: "Import Repository", href: "/solutions/connections", icon: GitBranch },
  { label: "View Documentation", href: "/resources", icon: FileText },
] as const;

/**
 * Active-state from the pathname alone. Hrefs carrying a query string (filter
 * views of a page) are never marked current — the page itself states which
 * filter it is showing — so the plain view's link stays the single current
 * marker for that path.
 */
function isActiveHref(pathname: string, href: string) {
  if (href.includes("?") || href.includes("#")) return false;
  return href === "/solutions" ? pathname === href : pathname.startsWith(href);
}

function NavigationLink({
  item,
  active,
  nested = false,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        nested && "min-h-9 pl-9 text-[13px]",
        active
          ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function Navigation({
  onNavigate,
  isSuperAdmin = false,
}: {
  onNavigate?: () => void;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  /*
   * Closed by default, with one exception that keeps the two requirements from
   * contradicting each other: the group containing the current page opens
   * itself. "Start collapsed" is about not dumping every destination on
   * arrival; "preserve active-page highlighting" is about always being able to
   * see where you are. Collapsing the group you are standing in would satisfy
   * the first by breaking the second.
   *
   * An explicit toggle always wins over that default, so a person who folds the
   * group they are in keeps it folded.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string, isOpen: boolean) =>
    setOverrides((current) => ({ ...current, [label]: !isOpen }));

  // Named "Console" rather than "Primary": on /solutions the marketing global
  // navigation is also on the page, and two landmarks sharing an accessible
  // name give screen-reader users no way to tell them apart.
  return (
    <nav aria-label="Console" className="flex-1 space-y-6">
      <ul className="space-y-0.5">
        {navigationEntries.map((entry) => {
          const subpages = entry.subpages ?? [];
          const entryActive = isActiveHref(pathname, entry.href)
            || subpages.some((subpage) => isActiveHref(pathname, subpage.href));
          if (subpages.length === 0) {
            return (
              <li key={entry.label}>
                <NavigationLink item={entry} active={entryActive} onNavigate={onNavigate} />
              </li>
            );
          }
          const containsCurrentPage = subpages.some(
            (subpage) => isActiveHref(pathname, subpage.href),
          ) || isActiveHref(pathname, entry.href);
          const expanded = overrides[entry.label] ?? containsCurrentPage;
          return (
            <li key={entry.label}>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <NavigationLink item={entry} active={entryActive} onNavigate={onNavigate} />
                </div>
                <button
                  type="button"
                  onClick={() => toggleGroup(entry.label, expanded)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.label} subpages`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("size-4 transition-transform", !expanded && "-rotate-90")}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {expanded ? (
                <ul className="mt-0.5 space-y-0.5">
                  {subpages.map((subpage) => (
                    <li key={subpage.label}>
                      <NavigationLink
                        item={subpage}
                        nested
                        active={isActiveHref(pathname, subpage.href)}
                        onNavigate={onNavigate}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isSuperAdmin ? (
        <div>
          <p className="label mb-2 px-3">{superAdminGroup.heading}</p>
          <ul className="space-y-0.5">
            {superAdminGroup.items.map((item) => (
              <li key={item.href}>
                <NavigationLink
                  item={item}
                  active={isActiveHref(pathname, item.href)}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="label mb-2 px-3">Quick actions</p>
        <ul className="space-y-0.5">
          {quickActions.map((action) => (
            <li key={action.label}>
              <NavigationLink item={action} active={false} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * The console brand, in the one place it is not already on screen.
 *
 * This has been removed once before and had to come back, so the reasoning is
 * worth stating precisely rather than repeating the argument.
 *
 * On a wide screen the sidebar sits directly beneath the site header, which
 * renders the same mark unconditionally — two identical logos stacked, one row
 * apart. That is the duplication, and `xl:hidden` is what removes it.
 *
 * Below `xl` the sidebar is a drawer: `fixed inset-0 z-50` over an overlay,
 * above the header's `z-30`. An open drawer therefore *covers* the header, and
 * a drawer with no mark is a full-screen navigation with no identity — which is
 * exactly the defect that brought this component back the first time. So the
 * mark stays there, and only there.
 */
function FactoryMark() {
  return (
    <BrandMark
      href="/solutions"
      label="AI Software Factory console home"
      tone="console"
      className="mb-6 px-2 xl:hidden"
    />
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
      <FactoryMark />
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
