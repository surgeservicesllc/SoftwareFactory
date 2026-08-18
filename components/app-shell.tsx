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
  KeyRound,
  type LucideIcon,
  Menu,
  PlugZap,
  Plus,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/cn";
import { globalNavigation } from "@/lib/navigation";

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
  /*
   * The reference lists Secrets, and an earlier revision left it out on the
   * grounds that nothing backed it. That was true then and is not now: the
   * provider credential vault (migrations `20260814002500`/`002600`) stores
   * sealed material, and the settings page's `#providers` section is where an
   * owner connects and rotates it. The entry points at the surface that
   * actually manages secrets rather than at a page invented to justify it.
   */
  { label: "Secrets", href: "/solutions/settings#providers", icon: KeyRound },
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
 * a real control that starts work: the add-project form, the composer, and
 * repository authorization.
 *
 * A "View Documentation" shortcut sat here and was removed by owner request
 * (2026-08-17). It pointed at `/resources` on the marketing site — the only
 * entry in this list that left the console rather than doing something in it,
 * and reading is not a quick action. The marketing pages are unchanged and
 * still reachable from the public navigation.
 */
/** The one action the design gives a button of its own. */
const primaryAction: NavigationItem = {
  label: "New Project",
  href: "/solutions/projects#add-project",
  icon: Plus,
};

const quickActions: readonly NavigationItem[] = [
  { label: "Give a bot work", href: "/solutions/bot-manager", icon: Bot },
  { label: "Import Repository", href: "/solutions/connections", icon: GitBranch },
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
  /**
   * True when an enclosing row already paints the state.
   *
   * A group's row is the link plus its chevron, and the owner's reference
   * highlights the whole row as one block. Painting the background here as
   * well would draw a pill that stops before the chevron — two controls where
   * the design shows one.
   */
  inRow = false,
  /**
   * The collapsed rail: the glyph alone, the label still announced.
   *
   * `sr-only` rather than dropping the text, because an icon-only link with no
   * accessible name is an unlabelled link — and `title` alone does not
   * reliably reach a screen reader.
   */
  compact = false,
}: {
  item: NavigationItem;
  active: boolean;
  nested?: boolean;
  onNavigate?: () => void;
  inRow?: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={compact ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center rounded-lg text-sm font-medium transition-colors",
        compact ? "justify-center px-0" : "gap-3 px-3",
        !compact && nested && "min-h-9 pl-9 text-[13px]",
        inRow
          ? cn("flex-1", active ? "text-[var(--accent-text)]" : "text-muted")
          : active
            ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
            : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      <span className={compact ? "sr-only" : undefined}>{item.label}</span>
    </Link>
  );
}

function Navigation({
  onNavigate,
  isSuperAdmin = false,
  compact = false,
}: {
  onNavigate?: () => void;
  isSuperAdmin?: boolean;
  compact?: boolean;
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
          if (subpages.length === 0 || compact) {
            /*
             * The rail carries destinations, not disclosure. A chevron there
             * would open a submenu with nowhere to go but over the content —
             * which is the one thing the layout must never do — so a group in
             * the rail is its own link, and its highlight still shows when a
             * subpage is the current page. Expanding the rail brings the
             * chevrons back.
             */
            return (
              <li key={entry.label}>
                <NavigationLink
                  item={entry}
                  active={entryActive}
                  onNavigate={onNavigate}
                  compact={compact}
                />
              </li>
            );
          }
          const containsCurrentPage = subpages.some(
            (subpage) => isActiveHref(pathname, subpage.href),
          ) || isActiveHref(pathname, entry.href);
          const expanded = overrides[entry.label] ?? containsCurrentPage;
          return (
            <li key={entry.label}>
              {/*
                One row, one highlight. The reference shows a group's label and
                its chevron inside a single block; painting only the link left a
                pill that stopped short of the chevron and read as two separate
                controls sharing a line.
              */}
              <div
                className={cn(
                  "flex items-center rounded-lg pr-1 transition-colors",
                  entryActive
                    ? "bg-[var(--accent-surface)]"
                    : "hover:bg-surface-raised",
                )}
              >
                <div className="min-w-0 flex-1">
                  <NavigationLink item={entry} active={entryActive} onNavigate={onNavigate} inRow />
                </div>
                <button
                  type="button"
                  onClick={() => toggleGroup(entry.label, expanded)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.label} subpages`}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                    entryActive ? "text-[var(--accent-text)]" : "text-muted hover:text-foreground",
                  )}
                >
                  <ChevronDown
                    className={cn("size-4 transition-transform", !expanded && "-rotate-90")}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {/*
                A grid row that animates from 0fr to 1fr.
                
                Height cannot be transitioned from `auto`, and hard-coding one
                would be a number that goes stale the first time a subpage is
                added. A collapsed grid track does the same job and stays
                correct: the submenu animates to exactly its own height. It is
                `invisible` while closed so its links leave the tab order —
                `overflow-hidden` alone hides them from the eye but not from
                the keyboard. Motion is dropped entirely for anyone who asked
                for that.
              */}
              <div
                /*
                 * Hidden by attribute, not only by paint.
                 *
                 * The animation needs the submenu to stay mounted, and a
                 * mounted-but-clipped list is still in the accessibility tree
                 * and still tabbable. `inert` removes it from both; the
                 * `aria-hidden` beside it says the same thing to anything that
                 * does not implement `inert` yet, and to a test environment
                 * with no stylesheet — where `invisible` is just a class name
                 * and every collapsed destination would otherwise read as
                 * present.
                 */
                inert={!expanded}
                aria-hidden={expanded ? undefined : "true"}
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
                  expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <ul
                  className={cn(
                    "overflow-hidden",
                    expanded ? "mt-0.5 space-y-0.5" : "invisible",
                  )}
                >
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
              </div>
            </li>
          );
        })}
      </ul>

      {isSuperAdmin ? (
        <div>
          {compact ? null : <p className="label mb-2 px-3">{superAdminGroup.heading}</p>}
          <ul className="space-y-0.5">
            {superAdminGroup.items.map((item) => (
              <li key={item.href}>
                <NavigationLink
                  item={item}
                  active={isActiveHref(pathname, item.href)}
                  onNavigate={onNavigate}
                  compact={compact}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        The owner's design leads this section with New Project as a button
        rather than one more link in a list — it is the action people come to
        the sidebar to take, and a row of identical links gives it no more
        weight than "Import Repository".
      */}
      <div className="space-y-3">
        <Link
          href={primaryAction.href}
          onClick={onNavigate}
          title={compact ? primaryAction.label : undefined}
          className={cn(
            "btn btn-secondary flex min-h-11 w-full items-center justify-center",
            compact ? "px-0" : "gap-2",
          )}
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          <span className={compact ? "sr-only" : undefined}>{primaryAction.label}</span>
        </Link>

        <div>
          {compact ? null : <p className="label mb-2 px-3">Quick actions</p>}
          <ul className="space-y-0.5">
            {quickActions.map((action) => (
              <li key={action.label}>
                <NavigationLink
                  item={action}
                  active={false}
                  onNavigate={onNavigate}
                  compact={compact}
                />
              </li>
            ))}
          </ul>
        </div>

        {/*
          The design closes the column with this card. It states what the
          product is for rather than reporting anything, so it carries no
          numbers — a panel that looked like a readout but was decorative
          would be exactly what AGENTS.md forbids.
        */}
        {compact ? null : (
          <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-surface)] px-3 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--accent-text)]">
              <Rocket className="size-4 shrink-0" aria-hidden="true" />
              Automate. Build. Ship.
            </p>
            <p className="mt-1.5 text-[13px] leading-5 text-muted">
              Let AI handle the repetitive work so you can focus on what matters.
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}

function Sidebar({
  onNavigate,
  viewer,
  compact = false,
  /**
   * The site's own destinations, listed at the foot of the drawer.
   *
   * Only the drawer: on a wide screen the global header is on the page and
   * these links are already visible in it. On a phone that header hides its
   * menu button so there is one hamburger rather than two, which means this
   * list is the only route to Platform, Pricing and the rest — so it is not
   * decoration, it is what makes suppressing the other button safe.
   */
  siteLinks,
}: {
  onNavigate?: () => void;
  viewer: ShellViewer;
  compact?: boolean;
  siteLinks?: readonly { readonly label: string; readonly href: string }[];
}) {
  /*
   * The navigation starts at the top of the column.
   *
   * Two blocks used to sit above it and both were removed by owner request
   * (2026-08-17): a wordmark, which the site header one row above already
   * renders, and a "Collapse navigation" toggle. Nothing replaces them — the
   * menu is what the column is for, so it begins where they were.
   */
  return (
    <div className={cn("flex h-full flex-col overflow-y-auto py-5", compact ? "px-2" : "px-3")}>
      <Navigation
        onNavigate={onNavigate}
        isSuperAdmin={viewer.isSuperAdmin}
        compact={compact}
      />
      {siteLinks?.length ? (
        <div className="mt-6">
          <p className="label mb-2 px-3">Site</p>
          <ul className="space-y-0.5">
            {siteLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={onNavigate}
                  className="flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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

/*
 * Three tiers, not two.
 *
 * The persistent column used to exist only from 1280px up, so everything below
 * it — including a landscape tablet — got the phone's drawer and no standing
 * navigation at all. That is not "reduce the sidebar footprint"; it is the
 * mobile treatment applied to a screen with room to spare. From 1024px the
 * column is present as the rail, and from 1280px the person's own choice
 * decides. Read as a store for the same reason the preference is: a media
 * query has no server answer, and guessing at one during render hydrates into
 * a mismatch.
 */
const EXPANDABLE_QUERY = "(min-width: 1280px)";

function subscribeToExpandable(listener: () => void) {
  // jsdom has no `matchMedia`, and a shell that throws on render there would
  // take every component test down with it.
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(EXPANDABLE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readExpandable() {
  // An environment that cannot answer the query gets the widest tier: the
  // fallback should be the fullest navigation, never the most reduced one.
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia(EXPANDABLE_QUERY).matches;
}

export function AppShell({
  children,
  viewer = SIGNED_OUT_VIEWER,
}: Readonly<{ children: React.ReactNode; viewer?: ShellViewer }>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  /*
   * Width alone decides the column's form now.
   *
   * A stored per-person preference used to widen it back on request, but its
   * only control was the "Collapse navigation" button the owner removed, so
   * the preference became a value nothing could set. Between 1024 and 1279
   * the rail is still the only form that fits beside content; from 1280 the
   * column is full width.
   */
  const expandable = useSyncExternalStore(subscribeToExpandable, readExpandable, () => true);
  const compact = !expandable;

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    /*
     * One number, declared once, read by both the column and the content.
     *
     * The width lived twice — `w-64` on the aside and `xl:pl-64` on the main —
     * so narrowing the sidebar meant editing two values that had no way to
     * disagree loudly. As a custom property the content's available width is
     * derived from the column's actual width rather than kept in step with it
     * by hand, which is what "recalculate the usable space" has to mean if it
     * is to survive the next change to either.
     */
    <div
      className="min-h-screen"
      style={{ "--sidebar-w": compact ? "4rem" : "16rem" } as React.CSSProperties}
    >
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-[var(--accent-ink)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "fixed bottom-0 left-0 top-[var(--shell-top,0px)] z-40 hidden border-r border-line bg-surface lg:block",
          "w-[var(--sidebar-w)] transition-[width] duration-200 ease-out motion-reduce:transition-none",
        )}
      >
        <Sidebar viewer={viewer} compact={compact} />
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
      <header className="fixed inset-x-0 top-[var(--shell-top,0px)] z-30 flex h-16 items-center gap-3 border-b border-line bg-background px-4 lg:hidden">
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
        <div className="fixed inset-0 z-50 lg:hidden">
          {/*
            A click-away, not a control. It carried the same accessible name
            as the X inside the drawer, so "Close console navigation" matched
            two elements — the scrim, which the drawer covers on the left and
            which therefore cannot always receive a click, and the button
            people actually mean. `aria-hidden` with `tabIndex={-1}` keeps the
            behaviour and leaves exactly one named way to close.
          */}
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
            tabIndex={-1}
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
            <Sidebar
              onNavigate={() => setMobileOpen(false)}
              viewer={viewer}
              siteLinks={globalNavigation({
                signedIn: viewer.signedIn,
                isSuperAdmin: viewer.isSuperAdmin,
              })}
            />
          </aside>
        </div>
      ) : null}

      <main
        id="main-content"
        className={cn(
          "min-h-screen pt-16 lg:pl-[var(--sidebar-w)] lg:pt-0",
          "transition-[padding] duration-200 ease-out motion-reduce:transition-none",
        )}
      >
        <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
