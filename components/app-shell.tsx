"use client";

import {
  Activity,
  Bot,
  Boxes,
  ChevronDown,
  CircleGauge,
  ClipboardList,
  Cpu,
  DraftingCompass,
  Eye,
  FileText,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  Gauge,
  Fingerprint,
  GitBranch,
  Hammer,
  HeartPulse,
  KeyRound,
  type LucideIcon,
  Menu,
  PanelLeft,
  PlugZap,
  Plus,
  Rocket,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Split,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/cn";
import { globalNavigation } from "@/lib/navigation";
import { isJobSeekerPath, JOB_SEEKER_NAVIGATION } from "@/lib/job-seeker/navigation";
import { JobSeekerSidebarProfile } from "@/components/job-seeker/sidebar-profile";

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
  // The guided end-to-end journey over the live flows: renamed to the
  // owner's 2026-08-24 design — setup first, then the running factory.
  { label: "01. Factory Setup", href: "/solutions/ai-factory", icon: Workflow },
  /*
   * The running factory: the owner's ten-step process, one page per step,
   * each over the newest full-lifecycle run. The group's own href lands on
   * step one; the ten subpages are the ten steps in the owner's vocabulary
   * (lib/sdlc/factory-steps.ts maps them onto the eleven lifecycle stages).
   */
  {
    label: "02. AI Factory",
    href: "/solutions/factory/requirement",
    icon: Cpu,
    subpages: [
      { label: "1. Requirement", href: "/solutions/factory/requirement", icon: ClipboardList },
      { label: "2. Discover", href: "/solutions/factory/discover", icon: Search },
      { label: "3. Evaluate", href: "/solutions/factory/evaluate", icon: Scale },
      { label: "4. Decide", href: "/solutions/factory/decide", icon: Split },
      { label: "5. Architect", href: "/solutions/factory/architect", icon: DraftingCompass },
      { label: "6. Build", href: "/solutions/factory/build", icon: Hammer },
      { label: "7. Review", href: "/solutions/factory/review", icon: Eye },
      { label: "8. Test", href: "/solutions/factory/test", icon: FlaskConical },
      { label: "9. Deploy", href: "/solutions/factory/deploy", icon: Rocket },
      { label: "10. Monitor", href: "/solutions/factory/monitor", icon: Activity },
    ],
  },
  // Where a lifecycle is launched from. This page spent a week reachable
  // only as a Pipelines subpage named "Templates" — a second name for a page
  // everything else (its own title, the guide, the Pipelines console's link)
  // calls Workflows — and the owner reported it as "there is no Workflow
  // page". One page, one name, top level (owner fix, 2026-08-24).
  { label: "Workflows", href: "/solutions/workflows", icon: Workflow },
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
      // Active and All are live lifecycle views over saved commands. The
      // design's Schedules subpage has no scheduler model yet and stays out.
      // Workflows is deliberately NOT repeated here: it had lived only here,
      // under the alias "Templates", and one page under two names is how the
      // owner came to report that the Workflows page did not exist.
      { label: "Active", href: "/solutions/pipelines", icon: HeartPulse },
      { label: "All Pipelines", href: "/solutions/pipelines?view=all", icon: Workflow },
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
  /*
   * Job Seeker is deliberately absent from this list (owner instruction,
   * 2026-08-23).
   *
   * It is a different product, not a page of the factory console: it lives
   * outside /solutions, is hard-gated and person-scoped, and its data is
   * private to the person even within the organization. Listing it here put
   * a second product in the middle of the console's own destinations. It is
   * still reached from the top-level product switcher, which is where a
   * different product belongs.
   */
  /*
   * The lifecycle, distinct from AI Factory above it.
   *
   * AI Factory is the setup journey — connect a repository, assign bots,
   * issue a command. This is where the work *stands*: the eight stages a
   * graph moves through, across every run. Naming either one the other would
   * be an untruth in the navigation.
   */
  { label: "Lifecycle", href: "/solutions/lifecycle", icon: Workflow },
  { label: "Runs", href: "/solutions/runs", icon: GitBranch },
  /*
   * Operations, promoted out of a group and placed above Reports by owner
   * instruction (2026-08-19).
   *
   * It was the first subpage of a "Watch" group whose only other child was
   * Activity. A group holding one destination anybody wants costs a click and
   * a disclosure to reach it, and names a category rather than a place. The
   * group is gone; Activity went with it, and is still reached from Bots as
   * "Bot Activity", which points at the same page.
   */
  { label: "Operations", href: "/solutions/operations", icon: HeartPulse },
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
/**
 * Active-state from the pathname alone. Hrefs carrying a query string (filter
 * views of a page) are never marked current — the page itself states which
 * filter it is showing — so the plain view's link stays the single current
 * marker for that path.
 */
/*
 * A section root matches exactly; everything else matches by prefix.
 *
 * `/job-seeker` is the Overview group's own href *and* the prefix of every
 * other Job Seeker destination, so prefix-matching it would light Overview up
 * while someone stood in Resume Library. The group still highlights from its
 * children — `entryActive` ors the subpages in — which is the behaviour the
 * design shows and the reason this exactness costs nothing.
 */
const SECTION_ROOTS = new Set(["/solutions", "/job-seeker"]);

function isActiveHref(pathname: string, href: string) {
  if (href.includes("?") || href.includes("#")) return false;
  return SECTION_ROOTS.has(href) ? pathname === href : pathname.startsWith(href);
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
   * Job Seeker is a different product, not a page of the console.
   *
   * A person here is managing a job search; Projects, Bots, Runs and Secrets
   * are noise against that task, and the owner's design shows a navigation of
   * its own. So the shell swaps the whole set while the path is under
   * `/job-seeker` rather than appending a group to the console's list.
   */
  const jobSeeker = isJobSeekerPath(pathname);
  const entries: readonly NavigationEntry[] = jobSeeker
    ? JOB_SEEKER_NAVIGATION
    : navigationEntries;
  const navigationLabel = jobSeeker ? "Job Seeker" : "Console";
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
    <nav aria-label={navigationLabel} className="flex-1 space-y-6">
      <ul className="space-y-0.5">
        {entries.map((entry) => {
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
    </nav>
  );
}

function Sidebar({
  onNavigate,
  viewer,
  compact = false,
  onToggleCompact,
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
  /**
   * Absent wherever retracting is not on offer: the mobile drawer, which
   * closes rather than narrows, and any device without a hovering pointer.
   */
  onToggleCompact?: () => void;
  siteLinks?: readonly { readonly label: string; readonly href: string }[];
}) {
  // The same check `Navigation` makes: the career-profile card belongs to
  // the Job Seeker section, and nowhere else.
  const sidebarPathname = usePathname();
  const jobSeeker = isJobSeekerPath(sidebarPathname);
  /*
   * The navigation starts at the top of the column, and the retract control
   * ends it.
   *
   * Two blocks used to sit above the menu and both were removed by owner
   * request (2026-08-17): a wordmark, which the site header one row above
   * already renders, and this toggle. The toggle was then asked for again, on
   * pointer devices — so it is back, at the foot of the column rather than the
   * head of it. That is the whole reason for the position: the instruction
   * that removed it was about the space above the menu, and returning it there
   * would undo the thing that was actually wanted.
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
      {/*
        Whose search this is.

        The Job Seeker section is scoped to one person, so naming them is part
        of saying what you are looking at. Absent on the rail for the same
        reason the account panel is: a 4rem column cannot show a name, a role
        and four contact lines without truncating each into something
        misleading.
      */}
      {jobSeeker && !compact ? <JobSeekerSidebarProfile /> : null}
      {/*
        The account panel, and the single glyph it becomes on the rail.

        Collapsed, the owner asked for the whole block — the heading, the
        address, the super-admin badge and the button — to become one "S" that
        still works. So the rail keeps the panel's *action* and drops its
        reporting: the address and the badge are description, and a 4rem column
        cannot show either without truncating it into something misleading.
        What it must not drop is the ability to leave, which is why the glyph is
        the button rather than a decorative avatar beside a hidden one.

        Signed out, the same square is the way in. One shape in one place,
        whichever state the viewer is in, so the rail does not move its only
        account control depending on who is looking.
      */}
      {compact ? (
        <div className="mt-6 flex justify-center">
          {viewer.signedIn ? (
            <SignOutButton
              compact
              className="btn btn-secondary flex size-10 items-center justify-center rounded-lg p-0 font-mono text-sm font-bold"
            />
          ) : (
            <Link
              href="/auth/sign-in"
              aria-label="Sign in"
              title="Sign in"
              className="btn btn-primary flex size-10 items-center justify-center rounded-lg p-0 font-mono text-sm font-bold"
            >
              S
            </Link>
          )}
        </div>
      ) : viewer.signedIn ? (
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

      {onToggleCompact ? (
        <div className="mt-4 border-t border-line pt-3">
          {/*
            The name changes with the state, so it always says what the click
            will do rather than what the column currently is; `aria-pressed`
            carries the state itself.
          */}
          <button
            type="button"
            onClick={onToggleCompact}
            aria-pressed={compact}
            title={compact ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "flex min-h-9 w-full items-center rounded-lg text-sm font-medium text-muted",
              "transition-colors hover:bg-surface-raised hover:text-foreground",
              compact ? "justify-center px-0" : "gap-2 px-3",
            )}
          >
            <PanelLeft
              className={cn("size-4 shrink-0 transition-transform", compact && "rotate-180")}
              aria-hidden="true"
            />
            <span className={compact ? "sr-only" : undefined}>
              {compact ? "Expand navigation" : "Collapse navigation"}
            </span>
          </button>
        </div>
      ) : null}
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
const COMPACT_STORAGE_KEY = "softwarefactory:sidebar-compact";

/*
 * The retract preference is an external store, so it is read as one.
 *
 * `localStorage` does not exist on the server, and a component that reads it
 * during render hydrates into a mismatch. Reading it in an effect and calling
 * `setState` is the usual workaround and is worse: it is a render the person
 * sees at the wrong width. A store with a server snapshot says the same thing
 * without either problem, and the `storage` listener means a second tab does
 * not disagree with the first about a choice made once.
 */
const compactListeners = new Set<() => void>();

function subscribeToCompact(listener: () => void) {
  compactListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    compactListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readCompact() {
  try {
    return window.localStorage.getItem(COMPACT_STORAGE_KEY) === "1";
  } catch {
    // A blocked or full storage is not a reason to fail to render a page.
    return false;
  }
}

function writeCompact(next: boolean) {
  try {
    window.localStorage.setItem(COMPACT_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Same: the preference is a convenience, never a precondition.
  }
  for (const listener of compactListeners) listener();
}

/*
 * "On a Windows or macOS device", asked as a capability rather than a name.
 *
 * The owner wants the column to retract on a computer and not on a phone or
 * tablet, and the honest way to ask that is how the device is driven, not what
 * it is called. Reading the platform out of the user agent gets this wrong in
 * both directions: iPadOS reports `MacIntel` in `navigator.platform`, so a
 * tablet would be served the desktop control, and `navigator.userAgentData` is
 * Chromium-only, so Safari and Firefox on the very machines this is for would
 * fall to a string that browsers have been freezing for years.
 *
 * A pointer that hovers is what Windows and macOS have and what touch devices
 * do not, so it is the same question with a reliable answer — and it keeps
 * Linux and ChromeOS desktops working, which naming two platforms would have
 * broken for no reason anyone wanted.
 */
const POINTER_DESKTOP_QUERY = "(hover: hover) and (pointer: fine)";

function subscribeToPointerDesktop(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(POINTER_DESKTOP_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readPointerDesktop() {
  /*
   * Unlike the width query, the safe answer here is "no".
   *
   * The widest tier is the right fallback for a layout, because the fullest
   * navigation is never the wrong thing to show. A control is different: an
   * environment that cannot say how it is driven should not be handed a
   * desktop affordance on the chance that it is one.
   */
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(POINTER_DESKTOP_QUERY).matches;
}

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
  const expandable = useSyncExternalStore(subscribeToExpandable, readExpandable, () => true);
  const pointerDesktop = useSyncExternalStore(
    subscribeToPointerDesktop,
    readPointerDesktop,
    () => false,
  );
  const chosenCompact = useSyncExternalStore(subscribeToCompact, readCompact, () => false);
  /*
   * Two reasons the column can be a rail, and only one of them is a choice.
   *
   * Between 1024 and 1279 the rail is the only form that fits beside content,
   * so the width decides and the person does not get a say. From 1280 there is
   * room for either, and on a pointer device they choose.
   *
   * The stored preference is read through `canRetract` rather than on its own:
   * someone who retracts the column on a desktop and later opens the same
   * account on a tablet would otherwise arrive at a rail with no control to
   * widen it, because the control is the thing that device does not get.
   */
  const canRetract = expandable && pointerDesktop;
  const compact = !expandable || (canRetract && chosenCompact);

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
        <Sidebar
          viewer={viewer}
          compact={compact}
          onToggleCompact={canRetract ? () => writeCompact(!compact) : undefined}
        />
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
