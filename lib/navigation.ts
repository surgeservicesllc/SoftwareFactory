/**
 * Global navigation, as a function of who is looking.
 *
 * Signed out, the header advertises the product. Signed in, it becomes a way
 * to get back into the work, so the console destinations join the public ones
 * and the calls to action turn into an account area.
 *
 * This module is deliberately free of `server-only`: both the server layouts
 * and the client header import it, and it holds no secret — the entries are
 * link labels. Showing a link is not granting access; each destination still
 * enforces its own authorization.
 */

export type NavItem = {
  readonly label: string;
  readonly href: string;
};

/**
 * Public pages, always present.
 *
 * `Solutions` is the console entry point the public site hands off to, so it
 * belongs here rather than only in the signed-in set — dropping it would leave
 * a signed-out visitor no way to reach the dashboard from the navigation.
 */
export const PUBLIC_NAV: readonly NavItem[] = [
  { label: "Platform", href: "/platform" },
  { label: "Features", href: "/features" },
  { label: "Solutions", href: "/solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
  { label: "About", href: "/about" },
];

/**
 * Added once there is a verified session.
 *
 * `Dashboard` points at the same route as the public `Solutions` entry. Signed
 * in it is the more useful name, so `globalNavigation` keeps this one and drops
 * the public duplicate rather than rendering two links to one destination.
 */
export const SIGNED_IN_NAV: readonly NavItem[] = [
  { label: "Dashboard", href: "/solutions" },
  { label: "Projects", href: "/solutions/projects" },
  { label: "Runs", href: "/solutions/runs" },
  { label: "Activity", href: "/solutions/activity" },
];

/** Added only for a confirmed super administrator. */
export const SUPER_ADMIN_NAV: readonly NavItem[] = [{ label: "Admin", href: "/solutions/admin" }];

/**
 * The global navigation for a viewer.
 *
 * Signed in, the console entries lead so the work comes before the marketing
 * pages; signed out, only the public pages exist.
 */
export function globalNavigation(options: {
  signedIn: boolean;
  isSuperAdmin?: boolean;
}): readonly NavItem[] {
  if (!options.signedIn) return PUBLIC_NAV;

  const consoleEntries = [
    ...SIGNED_IN_NAV,
    ...(options.isSuperAdmin ? SUPER_ADMIN_NAV : []),
  ];
  const claimed = new Set(consoleEntries.map((entry) => entry.href));

  return [...consoleEntries, ...PUBLIC_NAV.filter((entry) => !claimed.has(entry.href))];
}
